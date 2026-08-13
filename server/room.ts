import { RNG, hashInts } from '@shared/rng.ts';
import {
  AUDIO,
  AUTOPILOT_FORCE_AT,
  AUTOPILOT_WARNING_AT,
  DAY_LENGTH_SECONDS,
  INVENTORY_SLOTS,
  PLAYER,
  RADAR,
  SHIP_DEPART_SECONDS,
  TICK_MS,
  TILE,
  carrySpeedFactor,
} from '@shared/constants.ts';
import { clamp, dist2D, dist3D, angleDelta } from '@shared/math.ts';
import { MOONS, moonById } from '@shared/content/moons.ts';
import { WEATHER, rollWeather, type WeatherId } from '@shared/content/weather.ts';
import { SCRAP_BY_ID, scrapById } from '@shared/content/scrap.ts';
import { EQUIPMENT_BY_ID, equipmentById } from '@shared/content/equipment.ts';
import { MONSTERS_BY_ID } from '@shared/content/monsters.ts';
import {
  FLAG_CROUCH,
  FLAG_LIGHT,
  FLAG_SPRINT,
  FLAG_WALKIE,
  PROTOCOL_VERSION,
  type ClientMessage,
  type DoorSnapshot,
  type InventorySlot,
  type MonsterSnapshot,
  type PlayerSnapshot,
  type RunPhase,
  type ServerMessage,
  type ShipSnapshot,
  type WorldItemSnapshot,
} from '@shared/protocol.ts';
import { World, INTERIOR_ORIGIN_X } from './sim/world.ts';
import { MODE, type ServerPlayer, type WorldItem } from './sim/types.ts';
import { provoke } from './sim/brains.ts';
import {
  driftSellRate,
  newRun,
  rechargeLockers,
  resolveDeadline,
  sellCargo,
  type RunState,
} from './economy.ts';
import { doorCode, runTerminal, type TerminalHost } from './terminal.ts';

export interface Connection {
  send(message: ServerMessage): void;
  close(): void;
}

interface Member {
  player: ServerPlayer;
  conn: Connection;
}

const DEPOT_COUNTER = { x: 19, z: -2 };

export class GameRoom {
  readonly id: string;
  run: RunState;
  phase: RunPhase = 'orbit';
  moonId: string | null = null;
  weather: WeatherId | null = null;
  world: World | null = null;
  forecast: Record<string, WeatherId> = {};
  seed = 0;

  private members = new Map<number, Member>();
  private nextPlayerId = 1;
  private hostId = -1;
  private tick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTime = Date.now();
  private departAt = 0;
  private autopilotWarned = false;
  private radarAt = 0;
  private deathsThisRun = 0;
  private onEmpty: (() => void) | null = null;
  /** Items sitting in the ship at the end of the last expedition. */
  private cargo: { defId: string; value: number; kind: 'scrap' | 'equipment' | 'body'; charge: number; name: string }[] = [];
  private saveHook: ((room: GameRoom) => void) | null = null;

  constructor(id: string, runSeed = Date.now()) {
    this.id = id;
    this.run = newRun(runSeed);
    this.seed = hashInts(runSeed >>> 0, 1);
    this.rollForecast();
    this.start();
  }

  setSaveHook(fn: (room: GameRoom) => void): void {
    this.saveHook = fn;
  }

  setOnEmpty(fn: () => void): void {
    this.onEmpty = fn;
  }

  get playerCount(): number {
    return this.members.size;
  }

  // ------------------------------------------------------------ connections

  join(conn: Connection, name: string, skin: number): number {
    const id = this.nextPlayerId++;
    const player: ServerPlayer = {
      id,
      name: sanitiseName(name) || `EMPLOYEE-${id}`,
      skin: clamp(Math.round(skin), 0, 7),
      ready: false,
      state: 'alive',
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      level: -1,
      flags: 0,
      health: PLAYER.maxHealth,
      stamina: 1,
      slots: new Array(this.slotCount()).fill(null),
      held: 0,
      grabbedBy: -1,
      lastInputAt: Date.now(),
      lastSeq: 0,
      noise: 0,
      speed: 0,
      lastHurtAt: 0,
      monitorTarget: -1,
      insideShip: true,
      diedAt: 0,
      causeOfDeath: '',
      connected: true,
    };
    this.members.set(id, { player, conn });
    if (this.hostId < 0) this.hostId = id;

    // A player joining mid-expedition arrives at the ship, alive but useless.
    if (this.world) {
      player.x = this.world.ship.x;
      player.y = this.world.ship.y;
      player.z = this.world.ship.z;
      if (this.phase === 'landed') player.state = 'spectating';
    }

    conn.send({ t: 'welcome', playerId: id, version: PROTOCOL_VERSION, room: this.id, hostId: this.hostId });
    this.sendRoster();
    this.sendExpedition(conn);
    this.sendItemsTo(conn, true);
    this.sendDoorsTo(conn);
    this.sendInventory(player);
    conn.send({ t: 'bestiary', unlocked: this.run.seen, killedBy: this.run.killedBy });
    conn.send({
      t: 'terminal',
      clear: true,
      lines: [
        'VANTOREX RECLAMATION GROUP',
        'SHIPBOARD TERMINAL ONLINE.',
        `EMPLOYEE ${player.name.toUpperCase()} REGISTERED.`,
        'TYPE HELP.',
      ],
    });
    this.broadcast({ t: 'chat', from: 'SYSTEM', fromId: -1, text: `${player.name} boarded.`, channel: 'system' });
    return id;
  }

  leave(id: number): void {
    const member = this.members.get(id);
    if (!member) return;
    // Drop whatever they were holding rather than deleting it from the run.
    if (this.world) {
      for (const slot of member.player.slots) {
        if (slot !== null) this.dropItem(member.player, member.player.slots.indexOf(slot), 0);
      }
    }
    this.members.delete(id);
    if (this.hostId === id) this.hostId = this.members.keys().next().value ?? -1;
    this.broadcast({ t: 'chat', from: 'SYSTEM', fromId: -1, text: `${member.player.name} disconnected.`, channel: 'system' });
    this.sendRoster();
    if (this.members.size === 0) this.onEmpty?.();
  }

  private slotCount(): number {
    return INVENTORY_SLOTS + (this.run.upgrades.includes('cargo-rack') ? 1 : 0);
  }

  private players(): ServerPlayer[] {
    return [...this.members.values()].map((m) => m.player);
  }

  private broadcast(message: ServerMessage): void {
    for (const m of this.members.values()) m.conn.send(message);
  }

  private sendRoster(): void {
    this.broadcast({
      t: 'roster',
      hostId: this.hostId,
      players: this.players().map((p) => ({ id: p.id, name: p.name, skin: p.skin, ready: p.ready, state: p.state })),
    });
  }

  private sendExpedition(conn?: Connection): void {
    const message: ServerMessage = {
      t: 'expedition',
      moonId: this.moonId,
      weather: this.weather,
      seed: this.seed,
      day: this.run.day,
      phase: this.phase,
    };
    if (conn) conn.send(message);
    else this.broadcast(message);
  }

  // ------------------------------------------------------------- main loop

  private start(): void {
    this.timer = setInterval(() => this.step(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private step(): void {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.tick++;

    const players = this.players();
    for (const p of players) this.updatePlayerNoise(p, dt);

    if (this.world && (this.phase === 'landed' || this.phase === 'departing')) {
      this.world.update(dt, players, (p, amount, cause) => this.damagePlayer(p, amount, cause));
      this.updateEquipment(dt, players);
      this.checkAutopilot(dt);
      this.flushWorldEvents();
    } else if (this.phase === 'company') {
      this.updateEquipment(dt, players);
      if (this.world) {
        this.world.time += dt;
        this.flushWorldEvents();
      }
    } else {
      rechargeLockers(this.run, dt);
    }

    if (this.tick % 2 === 0) this.sendSnapshot();
    if (this.tick % 10 === 0) this.syncItems();
    if (this.world && this.world.time >= this.radarAt) {
      this.radarAt = this.world.time + RADAR.refreshSeconds;
      this.sendRadar();
    }
  }

  // -------------------------------------------------------------- messages

  handle(id: number, msg: ClientMessage): void {
    const member = this.members.get(id);
    if (!member) return;
    const p = member.player;

    switch (msg.t) {
      case 'input':
        this.applyInput(p, msg);
        break;

      case 'interact':
        this.handleInteract(p, msg.kind, msg.id);
        break;

      case 'equip':
        if (msg.slot >= 0 && msg.slot < p.slots.length) {
          p.held = msg.slot;
          this.sendInventory(p);
        }
        break;

      case 'drop':
        this.dropItem(p, msg.slot, msg.throwForce, msg.yaw, msg.pitch);
        break;

      case 'use':
        this.useItem(p, msg.slot, msg.down, msg.yaw, msg.pitch);
        break;

      case 'melee':
        this.melee(p, msg.slot, msg.yaw, msg.pitch);
        break;

      case 'noise':
        if (this.world) this.world.emitNoise(msg.x, msg.y, msg.z, msg.lvl, clamp(msg.level, 0, 6), p.id);
        break;

      // Falls and other purely local mishaps are reported by the client, since
      // it is the only thing that knows how the landing actually went.
      case 'selfDamage':
        this.damagePlayer(p, clamp(msg.amount, 0, 200), msg.cause);
        break;

      case 'enter':
        if (this.world) {
          this.world.emitNoise(p.x, p.y, p.z, p.level, 1.2, p.id);
          this.broadcast({ t: 'event', e: 'door', player: p.id, anchor: msg.anchor, inside: msg.inside });
        }
        break;

      case 'terminal':
        this.handleTerminal(p, msg.line);
        break;

      case 'chat':
        this.handleChat(p, msg.text);
        break;

      case 'voice':
        p.flags = msg.speaking ? p.flags | 16 : p.flags & ~16;
        if (msg.speaking && this.world) {
          const loudness = msg.walkie ? 2.6 : 1.4;
          this.world.emitNoise(p.x, p.y + 1.4, p.z, p.level, loudness, p.id);
        }
        break;

      case 'teleport':
        this.teleportPlayer(msg.target, msg.inverse);
        break;

      case 'monitor':
        p.monitorTarget = msg.target;
        break;

      case 'ready':
        p.ready = msg.ready;
        this.sendRoster();
        break;

      case 'rtc': {
        const target = this.members.get(msg.to);
        if (target) target.conn.send({ t: 'rtc', from: p.id, payload: msg.payload });
        break;
      }

      case 'ping':
        member.conn.send({ t: 'pong', time: msg.time });
        break;
    }
  }

  private applyInput(p: ServerPlayer, msg: Extract<ClientMessage, { t: 'input' }>): void {
    if (msg.seq <= p.lastSeq) return;
    p.lastSeq = msg.seq;

    const prevX = p.x;
    const prevZ = p.z;
    const now = Date.now();
    const dt = Math.max(0.016, (now - p.lastInputAt) / 1000);
    p.lastInputAt = now;

    // Movement is client-side for responsiveness; the server only rejects the
    // obviously impossible. Co-op games do not need to be cheat-proof, but a
    // desynced client should not be able to stand inside a wall forever.
    // Stepping through an entrance moves the player between two coordinate
    // spaces that are twenty kilometres apart, so a level change is always a
    // legitimate jump. Everything else has to obey a speed limit.
    const changedSpace = msg.level !== p.level;
    const maxStep = PLAYER.sprintSpeed * 2.2 * dt + 1.5;
    const requested = Math.hypot(msg.x - p.x, msg.z - p.z);
    if (!changedSpace && p.state === 'alive' && requested > maxStep && this.world) {
      const k = maxStep / requested;
      p.x += (msg.x - p.x) * k;
      p.z += (msg.z - p.z) * k;
      p.y = msg.y;
    } else {
      p.x = msg.x;
      p.y = msg.y;
      p.z = msg.z;
    }
    p.yaw = msg.yaw;
    p.pitch = msg.pitch;
    p.level = msg.level;
    p.flags = msg.flags;
    p.speed = Math.hypot(p.x - prevX, p.z - prevZ) / dt;
    if (this.world) p.insideShip = this.world.isInsideShip(p.x, p.y, p.z, p.level);

    // Being held means you are not going anywhere, whatever your client thinks.
    if (p.grabbedBy >= 0) {
      const snare = this.world?.monsters.get(p.grabbedBy);
      if (snare) {
        const d = dist2D(p, snare);
        if (d > 1.6) {
          const k = 1.6 / d;
          p.x = snare.x + (p.x - snare.x) * k;
          p.z = snare.z + (p.z - snare.z) * k;
        }
      } else {
        p.grabbedBy = -1;
      }
    }
  }

  private updatePlayerNoise(p: ServerPlayer, dt: number): void {
    if (!this.world || p.state !== 'alive') return;
    let noise: number = PLAYER.noiseIdle;
    if (p.speed > 0.4) {
      noise = (p.flags & FLAG_CROUCH) !== 0 ? PLAYER.noiseCrouch : (p.flags & FLAG_SPRINT) !== 0 ? PLAYER.noiseSprint : PLAYER.noiseWalk;
      noise *= clamp(p.speed / PLAYER.walkSpeed, 0.3, 1.6);
    }
    // Carrying heavy scrap makes you audibly heavier.
    const weight = this.carryWeight(p);
    noise *= 1 + weight / 90;
    p.noise = noise;

    // Emit at a steady cadence rather than every tick, so hearing checks see
    // discrete footfalls instead of a continuous smear.
    if (this.tick % 5 === 0) {
      this.world.emitNoise(p.x, p.y + 0.2, p.z, p.level, noise, p.id);
    }
  }

  private updateEquipment(dt: number, players: ServerPlayer[]): void {
    if (!this.world) return;
    for (const p of players) {
      if (p.state !== 'alive') continue;
      const itemId = p.slots[p.held];
      if (itemId === null) continue;
      const item = this.world.items.get(itemId);
      if (!item || item.kind !== 'equipment') continue;
      const def = EQUIPMENT_BY_ID.get(item.defId);
      if (!def || def.battery <= 0) continue;
      const draining =
        (def.kind === 'light' && (p.flags & FLAG_LIGHT) !== 0) ||
        (def.kind === 'comms' && (p.flags & FLAG_WALKIE) !== 0 && (p.flags & 16) !== 0);
      if (!draining) continue;
      item.charge = clamp(item.charge - dt / def.battery, 0, 1);
      if (item.charge <= 0) {
        this.sendTo(p, { t: 'event', e: 'notice', text: `${def.name} battery dead.` });
        this.sendInventory(p);
      }
      if (this.tick % 20 === 0) this.sendInventory(p);
    }

    // Deployed equipment burns down on its own clock.
    for (const item of this.world.items.values()) {
      if (!item.deployed) continue;
      const def = EQUIPMENT_BY_ID.get(item.defId);
      if (!def || def.battery <= 0) continue;
      item.charge = clamp(item.charge - dt / def.battery, 0, 1);
      if (item.charge <= 0) {
        item.deployed = false;
        this.world.dirtyItems.add(item.id);
      }
    }
  }

  // ------------------------------------------------------------ interaction

  private handleInteract(p: ServerPlayer, kind: string, id: number): void {
    if (p.state !== 'alive' && kind !== 'terminal') return;
    const world = this.world;

    switch (kind) {
      case 'item': {
        if (!world) return;
        const item = world.items.get(id);
        if (!item || item.heldBy >= 0) return;
        if (dist3D(p, item) > PLAYER.interactRange + 0.8) return;
        this.pickUp(p, item);
        break;
      }
      case 'door': {
        if (!world) return;
        world.toggleDoor(id);
        break;
      }
      case 'breaker': {
        if (!world || !world.layout.breaker) return;
        const b = world.layout.breaker;
        const bx = INTERIOR_ORIGIN_X + (b.x + 0.5) * TILE;
        const bz = (b.z + 0.5) * TILE;
        if (p.level !== b.level || Math.hypot(p.x - bx, p.z - bz) > 3.2) return;
        world.setBreaker(!world.breakerOn);
        break;
      }
      case 'ship': {
        // The lever by the hatch: land or launch depending on where we are.
        if (this.phase === 'landed' || this.phase === 'departing') this.beginDeparture('crew');
        else if (this.phase === 'orbit') this.land();
        else if (this.phase === 'company') this.beginDeparture('crew');
        break;
      }
      case 'charger': {
        if (!world) return;
        const itemId = p.slots[p.held];
        if (itemId === null) return;
        const item = world.items.get(itemId);
        if (!item || item.kind !== 'equipment') return;
        item.charge = 1;
        world.dirtyItems.add(item.id);
        this.sendInventory(p);
        this.sendTo(p, { t: 'event', e: 'notice', text: 'Recharged.' });
        break;
      }
    }
  }

  private carryWeight(p: ServerPlayer): number {
    if (!this.world) return 0;
    let total = 0;
    for (const slot of p.slots) {
      if (slot === null) continue;
      const item = this.world.items.get(slot);
      if (item) total += item.weight;
    }
    return total;
  }

  private pickUp(p: ServerPlayer, item: WorldItem): void {
    const world = this.world!;
    // Two-handed cargo takes the whole rig: you cannot also hold a torch.
    const scrapDef = item.kind === 'scrap' ? SCRAP_BY_ID.get(item.defId) : null;
    const equipDef = item.kind === 'equipment' ? EQUIPMENT_BY_ID.get(item.defId) : null;
    const twoHanded = item.kind === 'body' || !!scrapDef?.twoHanded || !!equipDef?.twoHanded;

    let slot = -1;
    if (p.slots[p.held] === null) slot = p.held;
    else slot = p.slots.findIndex((s) => s === null);
    if (slot < 0) {
      this.sendTo(p, { t: 'event', e: 'notice', text: 'Hands full.' });
      return;
    }

    item.heldBy = p.id;
    item.stowed = false;
    item.settled = true;
    p.slots[slot] = item.id;
    p.held = slot;
    world.dirtyItems.add(item.id);
    this.sendInventory(p);
    world.events.push({
      t: 'event',
      e: 'pickup',
      player: p.id,
      itemId: item.id,
      defId: item.defId,
      kind: item.kind,
      twoHanded,
    });
    world.emitNoise(p.x, p.y, p.z, p.level, 0.8, p.id);
  }

  private dropItem(p: ServerPlayer, slot: number, throwForce = 0, yaw = p.yaw, pitch = p.pitch): void {
    const world = this.world;
    if (!world) return;
    if (slot < 0 || slot >= p.slots.length) return;
    const itemId = p.slots[slot];
    if (itemId === null) return;
    const item = world.items.get(itemId);
    p.slots[slot] = null;
    if (!item) {
      this.sendInventory(p);
      return;
    }

    item.heldBy = -1;
    item.level = p.level;
    item.x = p.x + Math.sin(yaw) * 0.7;
    item.z = p.z + Math.cos(yaw) * 0.7;
    item.y = p.y + 1.1;
    if (throwForce > 0) {
      const force = clamp(throwForce, 0, 1) * 11;
      item.vx = Math.sin(yaw) * Math.cos(pitch) * force;
      item.vz = Math.cos(yaw) * Math.cos(pitch) * force;
      item.vy = -Math.sin(pitch) * force + 2.5;
      item.settled = false;
    } else {
      item.vx = 0;
      item.vy = 0;
      item.vz = 0;
      item.settled = false;
    }
    item.stowed = this.isInCargo(item.x, item.y, item.z, item.level);
    world.dirtyItems.add(item.id);
    this.sendInventory(p);
    world.events.push({ t: 'event', e: 'drop', player: p.id, itemId: item.id, defId: item.defId, thrown: throwForce > 0 });
  }

  private isInCargo(x: number, y: number, z: number, level: number): boolean {
    if (!this.world) return false;
    return this.world.isInsideShip(x, y, z, level);
  }

  private useItem(p: ServerPlayer, slot: number, down: boolean, yaw: number, pitch: number): void {
    const world = this.world;
    if (!world || p.state !== 'alive') return;
    const itemId = p.slots[slot];
    if (itemId === null) return;
    const item = world.items.get(itemId);
    if (!item || item.kind !== 'equipment') return;
    const def = EQUIPMENT_BY_ID.get(item.defId);
    if (!def) return;
    if (item.charge <= 0 && def.battery > 0) return;

    switch (def.id) {
      case 'stun-charge': {
        if (!down) return;
        item.charge = clamp(item.charge - 0.34, 0, 1);
        const radius = def.stats?.radius ?? 9;
        const cone = def.stats?.cone ?? 1.6;
        let hit = 0;
        for (const m of world.monsters.values()) {
          if (m.level !== p.level || m.mode === MODE.dead) continue;
          const d = dist2D(m, p);
          if (d > radius) continue;
          const toM = Math.atan2(m.x - p.x, m.z - p.z);
          if (Math.abs(angleDelta(yaw, toM)) > cone * 0.5) continue;
          if (!world.hasLineOfSight(p, m)) continue;
          world.stunMonster(m, (def.stats?.seconds ?? 1) * 6);
          hit++;
        }
        world.events.push({ t: 'event', e: 'sound', kind: 'stun', x: p.x, y: p.y, z: p.z, level: p.level, hit });
        world.emitNoise(p.x, p.y, p.z, p.level, 2.4, p.id);
        this.sendInventory(p);
        break;
      }
      case 'scanner': {
        if (!down) return;
        const range = def.stats?.range ?? 34;
        const blips: { x: number; z: number; value: number; level: number }[] = [];
        for (const it of world.items.values()) {
          if (it.kind !== 'scrap' || it.heldBy >= 0 || it.level !== p.level) continue;
          if (dist3D(it, p) > range) continue;
          blips.push({ x: it.x, z: it.z, value: it.value, level: it.level });
        }
        this.sendTo(p, { t: 'event', e: 'sound', kind: 'scannerPing', blips, x: p.x, y: p.y, z: p.z, level: p.level });
        world.emitNoise(p.x, p.y, p.z, p.level, 0.6, p.id);
        break;
      }
      case 'locksmith': {
        if (!down) return;
        const door = this.nearestDoor(p, 3.0);
        if (door === null) {
          this.sendTo(p, { t: 'event', e: 'notice', text: 'No door in reach.' });
          return;
        }
        const done = world.cutDoor(door, 0.25, def.stats?.cutSeconds ?? 4.5);
        if (done) this.sendTo(p, { t: 'event', e: 'notice', text: 'Lock cut.' });
        break;
      }
      case 'flare':
      case 'noisemaker':
      case 'floodlight':
      case 'ladder':
      case 'rope': {
        if (!down) return;
        this.deploy(p, slot, item, def.id);
        break;
      }
      case 'walkie':
        p.flags = down ? p.flags | FLAG_WALKIE : p.flags & ~FLAG_WALKIE;
        break;
      default:
        break;
    }
  }

  private deploy(p: ServerPlayer, slot: number, item: WorldItem, kind: string): void {
    const world = this.world!;
    p.slots[slot] = null;
    item.heldBy = -1;
    item.level = p.level;
    item.deployed = true;
    item.x = p.x + Math.sin(p.yaw) * 1.2;
    item.z = p.z + Math.cos(p.yaw) * 1.2;
    item.y = world.groundAt(item.x, item.z, item.level);
    item.settled = true;
    const def = EQUIPMENT_BY_ID.get(item.defId);
    item.deployedUntil = kind === 'flare' ? world.time + (def?.stats?.burnSeconds ?? 90) : 0;
    world.dirtyItems.add(item.id);
    this.sendInventory(p);
    world.events.push({ t: 'event', e: 'sound', kind: 'deploy', defId: item.defId, x: item.x, y: item.y, z: item.z, level: item.level });

    if (kind === 'noisemaker') {
      // Fires crew-shaped noise on a timer at a place nobody is standing.
      const noiseLevel = def?.stats?.noise ?? 3;
      const seconds = def?.stats?.seconds ?? 25;
      const start = world.time;
      const interval = setInterval(() => {
        if (!this.world || this.world !== world || world.time - start > seconds) {
          clearInterval(interval);
          world.removeItem(item.id);
          return;
        }
        world.emitNoise(item.x, item.y + 0.4, item.z, item.level, noiseLevel, -1, true);
        world.events.push({ t: 'event', e: 'sound', kind: 'decoyChirp', x: item.x, y: item.y, z: item.z, level: item.level });
      }, 1400);
    }
    if (kind === 'flare') {
      world.emitNoise(item.x, item.y, item.z, item.level, def?.stats?.noise ?? 1.6, -1);
    }
  }

  private nearestDoor(p: ServerPlayer, range: number): number | null {
    if (!this.world || p.level < 0) return null;
    let best: number | null = null;
    let bestD = range;
    for (const spec of this.world.layout.doors) {
      if (spec.level !== p.level) continue;
      const pos = this.world.doorWorldPosition(spec.id);
      if (!pos) continue;
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = spec.id;
      }
    }
    return best;
  }

  private melee(p: ServerPlayer, slot: number, yaw: number, pitch: number): void {
    const world = this.world;
    if (!world || p.state !== 'alive') return;
    const itemId = p.slots[slot];
    if (itemId === null) return;
    const item = world.items.get(itemId);
    if (!item || item.kind !== 'equipment') return;
    const def = EQUIPMENT_BY_ID.get(item.defId);
    if (!def || def.kind !== 'melee') return;

    const range = def.stats?.range ?? 2.2;
    const arc = def.stats?.arc ?? 1.1;
    const damage = def.stats?.damage ?? 30;
    world.emitNoise(p.x, p.y, p.z, p.level, 2.0, p.id);
    world.events.push({ t: 'event', e: 'sound', kind: 'swing', defId: def.id, x: p.x, y: p.y, z: p.z, level: p.level });

    let hits = 0;
    for (const m of world.monsters.values()) {
      if (m.level !== p.level || m.mode === MODE.dead) continue;
      const d = dist3D(m, p);
      if (d > range + m.def.fit * 0.35) continue;
      const toM = Math.atan2(m.x - p.x, m.z - p.z);
      if (Math.abs(angleDelta(yaw, toM)) > arc * 0.5) continue;
      const vuln = m.def.flags?.meleeVulnerability ?? 1;
      world.hurtMonster(m, damage * vuln);
      provoke(world, m, p);
      hits++;
      world.events.push({ t: 'event', e: 'damage', target: 'monster', id: m.id, defId: m.defId, amount: damage * vuln, x: m.x, y: m.y, z: m.z, level: m.level });
    }

    // A shovel is also a perfectly good way to break your own cargo.
    if (hits === 0) {
      for (const it of world.items.values()) {
        if (it.heldBy >= 0 || it.level !== p.level) continue;
        if (dist3D(it, p) > range) continue;
        const scrapDef = SCRAP_BY_ID.get(it.defId);
        if (scrapDef?.flags?.explosive && Math.random() < 0.5) world.detonate(it, scrapDef.flags.explosive);
      }
    }
  }

  // ---------------------------------------------------------------- damage

  private damagePlayer(p: ServerPlayer, amount: number, cause: string): void {
    if (p.state !== 'alive' || amount <= 0) return;
    p.health -= amount;
    p.lastHurtAt = Date.now();
    this.broadcast({ t: 'event', e: 'damage', target: 'player', id: p.id, amount, cause, x: p.x, y: p.y, z: p.z, level: p.level });

    const monsterDef = MONSTERS_BY_ID.get(cause);
    if (monsterDef && !this.run.seen.includes(cause)) {
      this.run.seen.push(cause);
      this.broadcast({ t: 'bestiary', unlocked: this.run.seen, killedBy: this.run.killedBy });
    }

    if (p.health <= 0) this.killPlayer(p, cause);
  }

  private killPlayer(p: ServerPlayer, cause: string): void {
    const world = this.world;
    p.health = 0;
    p.state = 'dead';
    p.diedAt = Date.now();
    p.causeOfDeath = cause;
    p.grabbedBy = -1;
    this.deathsThisRun++;
    this.run.casualties.push(p.name);

    if (MONSTERS_BY_ID.has(cause) && !this.run.killedBy.includes(cause)) {
      this.run.killedBy.push(cause);
      if (!this.run.seen.includes(cause)) this.run.seen.push(cause);
      this.broadcast({ t: 'bestiary', unlocked: this.run.seen, killedBy: this.run.killedBy });
    }

    if (world) {
      // Everything they carried hits the floor exactly where they did.
      for (let i = 0; i < p.slots.length; i++) {
        const itemId = p.slots[i];
        if (itemId === null) continue;
        const item = world.items.get(itemId);
        p.slots[i] = null;
        if (!item) continue;
        item.heldBy = -1;
        item.level = p.level;
        item.x = p.x + (Math.random() - 0.5) * 1.6;
        item.z = p.z + (Math.random() - 0.5) * 1.6;
        item.y = p.y + 0.8;
        item.settled = false;
        world.dirtyItems.add(item.id);
      }
      world.addItem({
        kind: 'body',
        defId: 'body',
        x: p.x,
        y: world.groundAt(p.x, p.z, p.level) + 0.1,
        z: p.z,
        level: p.level,
        rotY: p.yaw,
        value: 0,
        weight: 40,
        bodyOf: p.id,
        bodyName: p.name,
      });
      world.emitNoise(p.x, p.y, p.z, p.level, 3.2, -1);
    }

    this.sendInventory(p);
    this.broadcast({ t: 'event', e: 'death', id: p.id, name: p.name, cause, x: p.x, y: p.y, z: p.z, level: p.level });
    this.broadcast({
      t: 'chat',
      from: 'SYSTEM',
      fromId: -1,
      text: `${p.name} is no longer transmitting.`,
      channel: 'system',
    });
    this.sendRoster();
  }

  // ------------------------------------------------------- expedition flow

  private rollForecast(): void {
    const rng = new RNG(hashInts(this.seed, this.run.day * 7919));
    this.forecast = {};
    for (const moon of MOONS) this.forecast[moon.id] = rollWeather(rng, moon.weather);
  }

  private land(): { ok: boolean; message: string } {
    if (this.phase !== 'orbit') return { ok: false, message: 'ALREADY ON A SITE.' };
    if (!this.moonId) return { ok: false, message: 'NO ROUTE SET. USE ROUTE <NAME>.' };

    if (this.moonId === 'company') {
      this.phase = 'company';
      this.weather = 'clear';
      this.seed = hashInts(this.seed, 0xc0de + this.run.day);
      this.world = new World({ moonId: 'ridge', weather: 'clear', seed: this.seed, dayIndex: this.run.day, depot: true });
      this.spawnCrewAndLockers();
      this.sendExpedition();
      this.sendItems(true);
      this.sendDoors();
      this.broadcast({ t: 'terminal', lines: ['DOCKED AT DEPOT 71-GORDION.', 'PLACE SALVAGE ON THE COUNTER. TYPE SELL.'] });
      return { ok: true, message: 'DOCKING.' };
    }

    const moon = moonById(this.moonId);
    if (moon.cost > this.run.credits) {
      return { ok: false, message: `ROUTE DECLINED. ${moon.cost} CREDITS REQUIRED, ${this.run.credits} AVAILABLE.` };
    }
    this.run.credits -= moon.cost;

    this.weather = this.forecast[moon.id] ?? 'clear';
    this.seed = hashInts(this.seed, this.run.day * 104729 + 17);
    this.world = new World({ moonId: moon.id, weather: this.weather, seed: this.seed, dayIndex: this.run.day });
    this.phase = 'landed';
    this.departAt = 0;
    this.autopilotWarned = false;
    this.spawnCrewAndLockers();
    this.sendExpedition();
    this.sendItems(true);
    this.sendDoors();
    this.broadcast({
      t: 'terminal',
      lines: [
        `TOUCHDOWN: ${moon.code}`,
        `CONDITIONS: ${WEATHER[this.weather].name.toUpperCase()}`,
        WEATHER[this.weather].description,
        'AUTOPILOT WILL DEPART AT NIGHTFALL WITH OR WITHOUT THE CREW.',
      ],
    });
    return { ok: true, message: `DESCENDING TO ${moon.code}.` };
  }

  private spawnCrewAndLockers(): void {
    const world = this.world!;
    for (const p of this.players()) {
      p.state = 'alive';
      p.health = PLAYER.maxHealth;
      p.stamina = 1;
      p.level = -1;
      p.grabbedBy = -1;
      p.slots = new Array(this.slotCount()).fill(null);
      p.held = 0;
      p.x = world.ship.x + (Math.random() - 0.5) * 3;
      p.z = world.ship.z + (Math.random() - 0.5) * 2;
      p.y = world.ship.y;
      p.insideShip = true;
      p.causeOfDeath = '';
      this.sendInventory(p);
    }
    this.sendRoster();

    // Ship lockers materialise as real objects on the cargo floor.
    let i = 0;
    for (const locker of this.run.lockers) {
      const def = EQUIPMENT_BY_ID.get(locker.defId);
      if (!def) continue;
      const col = i % 4;
      const row = Math.floor(i / 4);
      world.addItem({
        kind: 'equipment',
        defId: locker.defId,
        x: world.ship.x - 3 + col * 1.5,
        y: world.ship.y + 0.1,
        z: world.ship.z - 2.4 + row * 1.1,
        level: -1,
        rotY: Math.random() * Math.PI * 2,
        value: 0,
        weight: def.weight,
        charge: locker.charge,
        stowed: true,
      });
      i++;
    }
    // Cargo carried over from the previous expedition stays aboard.
    for (const entry of this.cargo) {
      if (entry.kind === 'equipment') continue;
      const def = entry.kind === 'scrap' ? SCRAP_BY_ID.get(entry.defId) : null;
      world.addItem({
        kind: entry.kind,
        defId: entry.defId,
        x: world.ship.x + (Math.random() - 0.5) * 6,
        y: world.ship.y + 0.1,
        z: world.ship.z + 1.5 + (Math.random() - 0.5) * 2,
        level: -1,
        rotY: Math.random() * Math.PI * 2,
        value: entry.value,
        weight: def?.weight ?? 30,
        stowed: true,
        bodyName: entry.kind === 'body' ? entry.name : undefined,
      });
    }
    this.cargo = [];
  }

  private checkAutopilot(dt: number): void {
    const world = this.world;
    if (!world) return;

    if (this.phase === 'landed') {
      if (!this.autopilotWarned && world.dayProgress >= AUTOPILOT_WARNING_AT) {
        this.autopilotWarned = true;
        this.broadcast({ t: 'terminal', lines: ['AUTOPILOT ENGAGED. DEPARTURE IMMINENT.'] });
        this.broadcast({ t: 'event', e: 'notice', text: 'The ship is leaving.', severity: 2 });
      }
      if (world.dayProgress >= AUTOPILOT_FORCE_AT) this.beginDeparture('autopilot');
      return;
    }

    if (this.phase === 'departing' && Date.now() >= this.departAt) {
      this.completeExpedition();
    }
  }

  private beginDeparture(reason: string): void {
    if (this.phase === 'departing') return;
    this.phase = 'departing';
    this.departAt = Date.now() + SHIP_DEPART_SECONDS * 1000;
    this.sendExpedition();
    this.broadcast({
      t: 'terminal',
      lines: [reason === 'autopilot' ? 'AUTOPILOT: DEPARTING.' : 'LAUNCH SEQUENCE INITIATED.', 'HATCH CLOSING.'],
    });
    this.broadcast({ t: 'event', e: 'notice', text: 'Launching.', severity: 2 });
  }

  /** The moment the day is scored. Everything outside the hull is written off. */
  private completeExpedition(): void {
    const world = this.world;
    if (!world) return;

    let deaths = 0;
    let bodiesRecovered = 0;

    for (const p of this.players()) {
      const aboard = world.isInsideShip(p.x, p.y, p.z, p.level);
      if (p.state === 'alive' && !aboard) {
        // Left behind. The Company does not wait.
        this.killPlayer(p, 'left behind');
      }
    }

    // Score cargo: only what is physically inside the hull counts.
    this.cargo = [];
    for (const item of world.items.values()) {
      const aboard = item.heldBy >= 0
        ? (() => {
            const holder = this.players().find((pl) => pl.id === item.heldBy);
            return holder ? world.isInsideShip(holder.x, holder.y, holder.z, holder.level) : false;
          })()
        : world.isInsideShip(item.x, item.y, item.z, item.level);
      if (!aboard) continue;
      if (item.kind === 'equipment') continue;
      if (item.kind === 'body') {
        bodiesRecovered++;
        continue;
      }
      const def = SCRAP_BY_ID.get(item.defId);
      this.cargo.push({
        defId: item.defId,
        value: item.value,
        kind: 'scrap',
        charge: 1,
        name: def?.name ?? item.defId,
      });
    }

    // Equipment aboard survives; anything left on the moon is gone forever.
    const survivingLockers: RunState['lockers'] = [];
    for (const item of world.items.values()) {
      if (item.kind !== 'equipment') continue;
      const holder = item.heldBy >= 0 ? this.players().find((pl) => pl.id === item.heldBy) : null;
      const aboard = holder
        ? world.isInsideShip(holder.x, holder.y, holder.z, holder.level)
        : world.isInsideShip(item.x, item.y, item.z, item.level);
      if (aboard) survivingLockers.push({ defId: item.defId, charge: item.charge });
    }
    const lostGear = this.run.lockers.length - survivingLockers.length;
    this.run.lockers = survivingLockers;

    for (const p of this.players()) deaths += p.state === 'dead' ? 1 : 0;

    this.world = null;
    this.phase = 'orbit';
    this.moonId = null;
    this.weather = null;

    // The day advances whether or not it went well.
    this.run.day++;
    this.run.daysLeft--;
    driftSellRate(this.run, hashInts(this.seed, this.run.day));
    this.rollForecast();

    for (const p of this.players()) {
      p.state = 'alive';
      p.health = PLAYER.maxHealth;
      p.slots = new Array(this.slotCount()).fill(null);
      this.sendInventory(p);
    }
    this.deathsThisRun = deaths;
    this.pendingDeaths = deaths;
    this.pendingBodies = bodiesRecovered;

    const lines = [
      '--- EXPEDITION CLOSED ---',
      `CARGO ABOARD: ${this.cargo.length} OBJECTS, ${this.cargo.reduce((s, c) => s + c.value, 0)} CREDITS APPRAISED.`,
    ];
    if (deaths > 0) lines.push(`CREW LOST: ${deaths}. BODIES RECOVERED: ${bodiesRecovered}.`);
    if (lostGear > 0) lines.push(`EQUIPMENT WRITTEN OFF: ${lostGear}.`);
    lines.push(`DAYS UNTIL DEADLINE: ${this.run.daysLeft}`);
    this.broadcast({ t: 'terminal', lines });
    this.sendExpedition();
    this.sendRoster();
    this.sendItems(true);

    if (this.run.daysLeft <= 0) this.assessDeadline();
    this.saveHook?.(this);
  }

  private pendingDeaths = 0;
  private pendingBodies = 0;

  private assessDeadline(): void {
    const result = resolveDeadline(this.run);
    this.broadcast({ t: 'terminal', lines: ['', ...result.message] });
    if (!result.met) {
      this.phase = 'gameover';
      this.broadcast({ t: 'event', e: 'notice', text: 'CONTRACT TERMINATED', severity: 2 });
      this.sendExpedition();
    }
    this.saveHook?.(this);
  }

  private sellNow(): string[] {
    if (this.phase !== 'company') return ['SALE POINT NOT AVAILABLE. ROUTE TO THE DEPOT FIRST.'];
    const world = this.world;
    if (!world) return ['SALE POINT OFFLINE.'];

    const counterX = world.ship.x + DEPOT_COUNTER.x;
    const counterZ = world.ship.z + DEPOT_COUNTER.z;
    const onCounter: WorldItem[] = [];
    for (const item of world.items.values()) {
      if (item.kind !== 'scrap' || item.heldBy >= 0) continue;
      if (item.level >= 0) continue;
      if (Math.hypot(item.x - counterX, item.z - counterZ) > 4.5) continue;
      onCounter.push(item);
    }
    if (!onCounter.length) {
      return [
        'NOTHING ON THE COUNTER.',
        'SALVAGE MUST BE PHYSICALLY PRESENTED FOR APPRAISAL.',
      ];
    }

    const cargo = onCounter.map((i) => {
      const def = SCRAP_BY_ID.get(i.defId);
      return { name: def?.name ?? i.defId, value: i.value, anomalous: !!def?.flags?.anomalous };
    });
    const result = sellCargo(this.run, cargo, this.pendingDeaths, this.pendingBodies);
    this.pendingDeaths = 0;
    this.pendingBodies = 0;
    for (const item of onCounter) world.removeItem(item.id);
    this.syncItems();

    const lines = ['--- APPRAISAL ---'];
    for (const l of result.lines) lines.push(`${l.name.padEnd(30)} ${String(l.value).padStart(5)} -> ${String(l.paid).padStart(5)}`);
    lines.push(`BUY RATE: ${Math.round(result.rate * 100)}%`);
    if (result.deathPenalty > 0) lines.push(`CASUALTY DEDUCTION: -${result.deathPenalty}`);
    lines.push(`PAID: ${result.net} CREDITS`);
    lines.push(`QUOTA: ${this.run.quotaMet}/${this.run.quota}`);
    lines.push(`BALANCE: ${this.run.credits}`);
    this.broadcast({ t: 'event', e: 'sell', amount: result.net });
    this.saveHook?.(this);
    return lines;
  }

  // ------------------------------------------------------------- teleporter

  private teleportPlayer(targetId: number, inverse: boolean): void {
    const world = this.world;
    if (!world) return;
    const target = this.members.get(targetId)?.player;
    if (!target) return;

    if (inverse) {
      if (!this.run.upgrades.includes('inverse-teleporter')) return;
      const nodes = world.nav.allNodes();
      const pick = nodes[Math.floor(Math.random() * nodes.length)];
      const spot = world.nav.world(pick);
      const cell = world.nav.node(pick);
      if (!spot || !cell) return;
      target.x = INTERIOR_ORIGIN_X + spot.x;
      target.y = world.layout.levels[cell.level].baseY;
      target.z = spot.z;
      target.level = cell.level;
      this.broadcast({ t: 'event', e: 'teleport', player: targetId, inverse: true, x: target.x, y: target.y, z: target.z, level: target.level });
      return;
    }

    if (!this.run.upgrades.includes('teleporter')) return;
    if (target.state !== 'alive') return;
    // Everything they were carrying is left exactly where they were standing.
    for (let i = 0; i < target.slots.length; i++) {
      if (target.slots[i] !== null) this.dropItem(target, i, 0);
    }
    target.x = world.ship.x;
    target.y = world.ship.y;
    target.z = world.ship.z;
    target.level = -1;
    target.grabbedBy = -1;
    this.broadcast({ t: 'event', e: 'teleport', player: targetId, inverse: false, x: target.x, y: target.y, z: target.z, level: -1 });
  }

  // -------------------------------------------------------------- terminal

  private terminalHost(): TerminalHost {
    const room = this;
    return {
      run: this.run,
      phase: this.phase,
      moonId: this.moonId,
      weather: this.weather,
      forecast: this.forecast,
      dayProgress: this.world?.dayProgress ?? 0,
      seed: this.seed,
      crew: () =>
        room.players().map((p) => ({ name: p.name, state: p.state, health: p.health, level: p.level })),
      cargoManifest: () => {
        if (room.world) {
          const out: { name: string; value: number }[] = [];
          for (const item of room.world.items.values()) {
            if (item.kind !== 'scrap') continue;
            if (!room.world.isInsideShip(item.x, item.y, item.z, item.level)) continue;
            out.push({ name: SCRAP_BY_ID.get(item.defId)?.name ?? item.defId, value: item.value });
          }
          return out;
        }
        return room.cargo.map((c) => ({ name: c.name, value: c.value }));
      },
      scrapRemaining: () => {
        if (!room.world || room.phase !== 'landed') return null;
        let count = 0;
        let value = 0;
        for (const item of room.world.items.values()) {
          if (item.kind !== 'scrap') continue;
          if (room.world.isInsideShip(item.x, item.y, item.z, item.level)) continue;
          count++;
          value += item.value;
        }
        return { count, value };
      },
      poweredDoors: () => {
        if (!room.world) return [];
        return room.world.layout.doors
          .filter((d) => d.kind === 'powered')
          .map((d) => ({
            id: d.id,
            code: doorCode(room.seed, d.id),
            open: room.world!.doors.get(d.id)?.state === 1,
          }));
      },
      route: (moonId) => room.setRoute(moonId),
      launch: () => {
        if (room.phase === 'landed' || room.phase === 'company') {
          room.beginDeparture('crew');
          return { ok: true, message: 'LAUNCH SEQUENCE INITIATED.' };
        }
        return { ok: false, message: 'NOT ON A SITE.' };
      },
      land: () => room.land(),
      sell: () => room.sellNow(),
      toggleDoorByCode: (code) => {
        if (!room.world) return { ok: false, message: 'NO SITE.' };
        const match = room.world.layout.doors.find((d) => d.kind === 'powered' && doorCode(room.seed, d.id) === code);
        if (!match) return { ok: false, message: `NO DEVICE WITH CODE ${code}.` };
        if (!room.world.breakerOn) return { ok: false, message: 'SITE POWER IS DOWN. RESTORE THE BREAKER FIRST.' };
        room.world.toggleDoor(match.id);
        const open = room.world.doors.get(match.id)?.state === 1;
        return { ok: true, message: `${code}: ${open ? 'OPEN' : 'SHUT'}` };
      },
      setShipDoors: (open) => {
        room.broadcast({ t: 'event', e: 'notice', text: open ? 'Hatch open.' : 'Hatch closed.' });
        return open ? 'HATCH OPEN.' : 'HATCH CLOSED.';
      },
      horn: () => {
        if (!room.run.upgrades.includes('loud-horn')) return 'NO HORN INSTALLED.';
        if (!room.world) return 'NOT ON A SITE.';
        room.world.emitNoise(room.world.ship.x, room.world.ship.y, room.world.ship.z, -1, 9, -1);
        room.broadcast({ t: 'event', e: 'shipHorn', x: room.world.ship.x, y: room.world.ship.y, z: room.world.ship.z });
        return 'HORN.';
      },
      teleport: (name, inverse) => {
        const target = room.players().find((p) => p.name.toUpperCase().startsWith(name.toUpperCase()));
        if (!target) return { ok: false, message: `NO CREW MEMBER MATCHING "${name}".` };
        const upgrade = inverse ? 'inverse-teleporter' : 'teleporter';
        if (!room.run.upgrades.includes(upgrade as never)) return { ok: false, message: 'NOT INSTALLED.' };
        room.teleportPlayer(target.id, inverse);
        return { ok: true, message: inverse ? `INSERTING ${target.name.toUpperCase()}.` : `RECOVERING ${target.name.toUpperCase()}.` };
      },
    };
  }

  private setRoute(moonId: string): { ok: boolean; message: string } {
    if (this.phase !== 'orbit') return { ok: false, message: 'ROUTE LOCKED WHILE ON A SITE. LAUNCH FIRST.' };
    this.moonId = moonId;
    if (moonId === 'company') {
      return { ok: true, message: 'ROUTE SET: 71-GORDION DEPOT. TYPE LAND.' };
    }
    const moon = moonById(moonId);
    const w = WEATHER[this.forecast[moonId] ?? 'clear'];
    return {
      ok: true,
      message: `ROUTE SET: ${moon.code}. CONDITIONS ${w.name.toUpperCase()}. COST ${moon.cost}. TYPE LAND.`,
    };
  }

  private handleTerminal(p: ServerPlayer, line: string): void {
    const lines = runTerminal(this.terminalHost(), line);
    const clear = line.trim().toUpperCase() === 'CLEAR';
    this.broadcast({ t: 'terminal', lines: [`> ${line}`, ...lines], clear });
  }

  private handleChat(p: ServerPlayer, text: string): void {
    const clean = text.slice(0, 180);
    if (!clean.trim()) return;
    const onWalkie = (p.flags & FLAG_WALKIE) !== 0;
    for (const m of this.members.values()) {
      const other = m.player;
      const sameLevel = other.level === p.level;
      const d = sameLevel ? dist3D(other, p) : Infinity;
      const inRange = d < AUDIO.voiceRange;
      const otherWalkie = (other.flags & FLAG_WALKIE) !== 0;
      const spectator = other.state !== 'alive';
      if (inRange || (onWalkie && otherWalkie) || spectator || other.id === p.id) {
        m.conn.send({
          t: 'chat',
          from: p.name,
          fromId: p.id,
          text: clean,
          channel: inRange && !spectator ? 'local' : 'radio',
        });
      }
    }
    if (this.world && p.state === 'alive') {
      this.world.emitNoise(p.x, p.y + 1.4, p.z, p.level, onWalkie ? 2.6 : 1.5, p.id);
    }
  }

  // ------------------------------------------------------------- snapshots

  private sendTo(p: ServerPlayer, message: ServerMessage): void {
    this.members.get(p.id)?.conn.send(message);
  }

  private sendSnapshot(): void {
    const world = this.world;
    const players: PlayerSnapshot[] = this.players().map((p) => ({
      id: p.id,
      x: round(p.x),
      y: round(p.y),
      z: round(p.z),
      yaw: round(p.yaw, 3),
      pitch: round(p.pitch, 3),
      level: p.level,
      flags: p.flags | (p.grabbedBy >= 0 ? 32 : 0),
      health: Math.round(p.health),
      stamina: round(p.stamina, 2),
      state: p.state,
      held: p.held,
      skin: p.skin,
      name: p.name,
      carryWeight: round(this.carryWeight(p), 1),
    }));

    const monsters: MonsterSnapshot[] = world
      ? [...world.monsters.values()]
          .filter((m) => m.mode !== MODE.dead)
          .map((m) => ({
            id: m.id,
            defId: m.defId,
            x: round(m.x),
            y: round(m.y),
            z: round(m.z),
            yaw: round(m.yaw, 3),
            level: m.level,
            mode: m.mode,
            anim: round(m.anim, 2),
            health: Math.round(m.health),
          }))
      : [];

    const ship: ShipSnapshot = {
      phase: this.phase,
      dayProgress: round(world?.dayProgress ?? 0, 4),
      day: this.run.day,
      quota: this.run.quota,
      quotaMet: this.run.quotaMet,
      daysLeft: this.run.daysLeft,
      credits: this.run.credits,
      sellRate: round(this.run.sellRate, 2),
      moonId: this.moonId,
      weather: this.weather,
      doorsOpen: this.phase !== 'departing',
      autopilotIn:
        this.phase === 'landed' && world
          ? Math.max(0, (AUTOPILOT_FORCE_AT - world.dayProgress) * DAY_LENGTH_SECONDS)
          : this.phase === 'departing'
            ? Math.max(0, (this.departAt - Date.now()) / 1000)
            : -1,
      breakerOn: world?.breakerOn ?? false,
      cargoValue: this.cargoValue(),
      upgrades: this.run.upgrades,
    };

    this.broadcast({ t: 'snapshot', tick: this.tick, time: round(world?.time ?? 0, 2), players, monsters, ship });
  }

  private cargoValue(): number {
    if (this.world) {
      let total = 0;
      for (const item of this.world.items.values()) {
        if (item.kind !== 'scrap') continue;
        if (this.world.isInsideShip(item.x, item.y, item.z, item.level)) total += item.value;
      }
      return total;
    }
    return this.cargo.reduce((s, c) => s + c.value, 0);
  }

  private syncItems(): void {
    const world = this.world;
    if (!world) return;
    if (world.dirtyItems.size === 0 && world.removedItems.length === 0) return;
    const items: WorldItemSnapshot[] = [];
    for (const id of world.dirtyItems) {
      const item = world.items.get(id);
      if (!item) continue;
      items.push(this.itemSnapshot(item));
    }
    const removed = world.removedItems.slice();
    world.dirtyItems.clear();
    world.removedItems.length = 0;
    this.broadcast({ t: 'items', items, removed });
  }

  private itemSnapshot(item: WorldItem): WorldItemSnapshot {
    return {
      id: item.id,
      kind: item.kind,
      defId: item.defId,
      x: round(item.x),
      y: round(item.y),
      z: round(item.z),
      rotY: round(item.rotY, 3),
      level: item.level,
      value: item.value,
      weight: item.weight,
      charge: round(item.charge, 2),
      heldBy: item.heldBy,
      stowed: item.stowed,
    };
  }

  private sendItems(full: boolean): void {
    const world = this.world;
    if (!world) {
      this.broadcast({ t: 'items', items: [], removed: [] });
      return;
    }
    const items = [...world.items.values()].map((i) => this.itemSnapshot(i));
    this.broadcast({ t: 'items', items, removed: [] });
    world.dirtyItems.clear();
    world.removedItems.length = 0;
  }

  private sendItemsTo(conn: Connection, full: boolean): void {
    const world = this.world;
    const items = world ? [...world.items.values()].map((i) => this.itemSnapshot(i)) : [];
    conn.send({ t: 'items', items, removed: [] });
  }

  private sendDoors(): void {
    const world = this.world;
    if (!world) return;
    this.broadcast({ t: 'doors', doors: this.doorSnapshots() });
    world.dirtyDoors.clear();
  }

  private sendDoorsTo(conn: Connection): void {
    if (!this.world) return;
    conn.send({ t: 'doors', doors: this.doorSnapshots() });
  }

  private doorSnapshots(): DoorSnapshot[] {
    const world = this.world;
    if (!world) return [];
    return [...world.doors.values()].map((d) => ({
      id: d.id,
      state: d.state,
      locked: d.locked,
      powered: d.powered,
    }));
  }

  private sendInventory(p: ServerPlayer): void {
    const world = this.world;
    const slots: InventorySlot[] = p.slots.map((id) => {
      if (id === null || !world) {
        return { itemId: null, kind: null, defId: null, charge: 0, weight: 0, value: 0, twoHanded: false };
      }
      const item = world.items.get(id);
      if (!item) return { itemId: null, kind: null, defId: null, charge: 0, weight: 0, value: 0, twoHanded: false };
      const scrapDef = item.kind === 'scrap' ? SCRAP_BY_ID.get(item.defId) : null;
      const equipDef = item.kind === 'equipment' ? EQUIPMENT_BY_ID.get(item.defId) : null;
      return {
        itemId: item.id,
        kind: item.kind === 'body' ? 'scrap' : item.kind,
        defId: item.defId,
        charge: item.charge,
        weight: item.weight,
        value: item.value,
        twoHanded: item.kind === 'body' || !!scrapDef?.twoHanded || !!equipDef?.twoHanded,
      };
    });
    this.sendTo(p, { t: 'inventory', slots, held: p.held });
  }

  /**
   * The ship monitor. Deliberately imperfect: positions lag, indoor fixes
   * scatter, and a Choirman can put a name on a blip that is not a person.
   */
  private sendRadar(): void {
    const world = this.world;
    if (!world) return;
    const booster = this.run.upgrades.includes('signal-booster');
    const interference = WEATHER[this.weather ?? 'clear'].flags.interference;
    const blips: { id: number; x: number; z: number; level: number; kind: 'crew' | 'unknown' | 'ghost'; name?: string }[] = [];

    for (const p of this.players()) {
      if (p.state !== 'alive') continue;
      const distanceFromShip = Math.hypot(p.x - world.ship.x, p.z - world.ship.z);
      let jitter = p.level >= 0 ? RADAR.indoorJitter : 0.4;
      jitter *= booster ? 0.45 : 1;
      jitter *= interference ? 4.5 : 1;
      jitter *= 1 + Math.max(0, distanceFromShip - RADAR.degradeDistance) / 120;
      blips.push({
        id: p.id,
        x: round(p.x + (Math.random() - 0.5) * jitter * 2, 1),
        z: round(p.z + (Math.random() - 0.5) * jitter * 2, 1),
        level: p.level,
        kind: 'crew',
        name: p.name,
      });
    }

    // Creatures show as unidentified contacts, and only when close to a crewmate.
    for (const m of world.monsters.values()) {
      if (m.mode === MODE.dead) continue;
      const near = this.players().some(
        (p) => p.state === 'alive' && p.level === m.level && dist2D(p, m) < (booster ? 26 : 16),
      );
      if (!near) continue;
      blips.push({
        id: 10000 + m.id,
        x: round(m.x + (Math.random() - 0.5) * 6, 1),
        z: round(m.z + (Math.random() - 0.5) * 6, 1),
        level: m.level,
        kind: 'unknown',
      });
    }

    this.broadcast({ t: 'radar', blips });
  }

  private flushWorldEvents(): void {
    const world = this.world;
    if (!world || world.events.length === 0) return;
    for (const event of world.events) {
      if (event.e === 'radarBlip') {
        // Fake contacts go to the monitor as if they were crew.
        this.broadcast({
          t: 'radar',
          blips: [
            {
              id: 20000 + (event.id as number),
              x: round(event.x as number, 1),
              z: round(event.z as number, 1),
              level: event.level as number,
              kind: 'ghost',
              name: event.name as string,
            },
          ],
        });
        continue;
      }
      if (event.e === 'spawn') {
        const defId = event.defId as string;
        if (!this.run.seen.includes(defId)) {
          // Seen only once a player actually lays eyes on it, not on spawn.
        }
      }
      this.broadcast(event);
    }
    world.events.length = 0;

    // Bestiary unlock: anything a living crew member can currently see.
    for (const m of world.monsters.values()) {
      if (m.seen || m.mode === MODE.dead) continue;
      const spotted = this.players().some(
        (p) =>
          p.state === 'alive' &&
          p.level === m.level &&
          dist2D(p, m) < 24 &&
          Math.abs(angleDelta(p.yaw, Math.atan2(m.x - p.x, m.z - p.z))) < 0.9 &&
          world.hasLineOfSight(p, m),
      );
      if (!spotted) continue;
      m.seen = true;
      if (!this.run.seen.includes(m.defId)) {
        this.run.seen.push(m.defId);
        this.broadcast({ t: 'bestiary', unlocked: this.run.seen, killedBy: this.run.killedBy });
      }
    }
  }

  // ----------------------------------------------------------- persistence

  serialise() {
    return {
      version: PROTOCOL_VERSION,
      id: this.id,
      seed: this.seed,
      run: this.run,
      cargo: this.cargo,
    };
  }

  restore(data: ReturnType<GameRoom['serialise']>): void {
    if (!data || data.version !== PROTOCOL_VERSION) return;
    this.seed = data.seed;
    this.run = data.run;
    this.cargo = data.cargo ?? [];
    this.rollForecast();
  }
}

function round(v: number, places = 2): number {
  const m = 10 ** places;
  return Math.round(v * m) / m;
}

function sanitiseName(name: string): string {
  return name.replace(/[^\w \-.]/g, '').trim().slice(0, 16);
}
