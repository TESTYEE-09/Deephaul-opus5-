import { RNG, hashInts } from '@shared/rng.ts';
import { TILE, PLAYER, DAY_LENGTH_SECONDS, AUDIO } from '@shared/constants.ts';
import { clamp, dist2D, dist3D, lerp, angleDelta } from '@shared/math.ts';
import { moonById, type MoonDef } from '@shared/content/moons.ts';
import { WEATHER, floodLevel, type WeatherId } from '@shared/content/weather.ts';
import { scrapById } from '@shared/content/scrap.ts';
import { equipmentById, EQUIPMENT_BY_ID } from '@shared/content/equipment.ts';
import { monsterById, type MonsterDef } from '@shared/content/monsters.ts';
import { generateFacility } from '@shared/facility/generate.ts';
import { NavGraph } from '@shared/facility/nav.ts';
import { cellIndex, isFloor, SIDE_DX, SIDE_DZ, type FacilityLayout } from '@shared/facility/types.ts';
import { generateExterior, makeTerrainSampler, type ExteriorLayout } from '@shared/world/exterior.ts';
import type { GameEvent } from '@shared/protocol.ts';
import {
  MODE,
  type DoorRuntime,
  type Monster,
  type NoiseEvent,
  type ServerPlayer,
  type WorldItem,
} from './types.ts';
import { runBrain } from './brains.ts';

export interface WorldOptions {
  moonId: string;
  weather: WeatherId;
  seed: number;
  dayIndex: number;
  /** The Company depot reuses the world container but has no site to salvage. */
  depot?: boolean;
}

/** Interior lives far away from the exterior so the two can never overlap. */
export const INTERIOR_ORIGIN_X = 20000;

export interface ShipBounds {
  x: number;
  y: number;
  z: number;
  halfW: number;
  halfD: number;
  height: number;
}

export class World {
  readonly moon: MoonDef;
  readonly weather: WeatherId;
  readonly seed: number;
  readonly layout: FacilityLayout;
  readonly exterior: ExteriorLayout;
  readonly nav: NavGraph;
  readonly terrainAt: (x: number, z: number) => number;
  readonly ship: ShipBounds;
  readonly depot: boolean;

  time = 0;
  /** 0..1 across the working day. */
  dayProgress = 0;
  breakerOn = false;

  items = new Map<number, WorldItem>();
  doors = new Map<number, DoorRuntime>();
  monsters = new Map<number, Monster>();
  noises: NoiseEvent[] = [];

  /** Set of item ids changed since the last item sync. */
  dirtyItems = new Set<number>();
  removedItems: number[] = [];
  dirtyDoors = new Set<number>();
  events: GameEvent[] = [];

  private nextItemId = 1;
  private nextMonsterId = 1;
  private rng: RNG;
  private indoorSpawnAt = 0;
  private outdoorSpawnAt = 0;
  private lightningAt = 0;
  private floorNodes: number[] = [];

  constructor(opts: WorldOptions) {
    this.moon = moonById(opts.moonId);
    this.weather = opts.weather;
    this.seed = opts.seed;
    this.rng = new RNG(hashInts(opts.seed, 0xa11e));
    this.depot = opts.depot ?? false;

    this.layout = generateFacility({
      seed: opts.seed,
      moon: this.moon,
      weather: opts.weather,
      dayIndex: opts.dayIndex,
    });
    this.exterior = generateExterior({
      seed: opts.seed,
      moon: this.moon,
      weather: opts.weather,
      layout: this.layout,
    });
    this.nav = new NavGraph(this.layout);
    this.terrainAt = makeTerrainSampler(this.exterior);
    this.floorNodes = this.nav.allNodes();

    this.ship = {
      x: this.exterior.ship.x,
      y: this.exterior.ship.y + 1.2,
      z: this.exterior.ship.z,
      halfW: 6.5,
      halfD: 5.0,
      height: 4.2,
    };

    // The depot has a counter and a shutter, not a facility full of salvage.
    if (!this.depot) for (const spawn of this.layout.scrap) {
      const def = scrapById(spawn.defId);
      this.addItem({
        kind: 'scrap',
        defId: spawn.defId,
        x: INTERIOR_ORIGIN_X + spawn.px,
        y: spawn.py,
        z: spawn.pz,
        rotY: spawn.rotY,
        level: spawn.level,
        value: spawn.value,
        weight: def.weight,
      });
    }

    for (const door of this.layout.doors) {
      this.doors.set(door.id, {
        id: door.id,
        state: door.kind === 'open' || door.kind === 'main' || door.kind === 'fire' ? 1 : 0,
        locked: door.kind === 'locked',
        powered: door.kind === 'powered',
        moveUntil: 0,
        cutProgress: 0,
      });
    }

    this.indoorSpawnAt = this.moon.power.indoorInterval[0] * 0.5;
    this.outdoorSpawnAt = this.moon.power.outdoorInterval[0] * 0.6;
    this.lightningAt = this.rng.range(20, 45);
  }

  // ------------------------------------------------------------------ items

  addItem(partial: Partial<WorldItem> & Pick<WorldItem, 'kind' | 'defId' | 'x' | 'y' | 'z' | 'level'>): WorldItem {
    const item: WorldItem = {
      id: this.nextItemId++,
      rotY: 0,
      value: 0,
      weight: 1,
      charge: 1,
      heldBy: -1,
      stowed: false,
      vx: 0,
      vy: 0,
      vz: 0,
      settled: true,
      nextNoiseAt: 0,
      deployed: false,
      deployedUntil: 0,
      ...partial,
    } as WorldItem;
    this.items.set(item.id, item);
    this.dirtyItems.add(item.id);
    return item;
  }

  removeItem(id: number): void {
    if (!this.items.delete(id)) return;
    this.dirtyItems.delete(id);
    this.removedItems.push(id);
  }

  itemsNear(x: number, y: number, z: number, level: number, radius: number): WorldItem[] {
    const out: WorldItem[] = [];
    for (const item of this.items.values()) {
      if (item.heldBy >= 0 || item.level !== level) continue;
      if (dist3D(item, { x, y, z }) <= radius) out.push(item);
    }
    return out;
  }

  // ------------------------------------------------------------------ doors

  isDoorPassable(doorId: number): boolean {
    const runtime = this.doors.get(doorId);
    if (!runtime) return true;
    if (runtime.state === 4 || runtime.state === 1) return true;
    return false;
  }

  /** Most creatures cannot work a handle; a few can. */
  canMonsterPass(def: MonsterDef, doorId: number): boolean {
    const runtime = this.doors.get(doorId);
    if (!runtime) return true;
    if (runtime.state === 1 || runtime.state === 4) return true;
    if (runtime.locked) return false;
    return !!def.flags?.opensDoors;
  }

  toggleDoor(id: number, wantOpen?: boolean): boolean {
    const door = this.doors.get(id);
    if (!door) return false;
    if (door.locked || door.state === 4) return false;
    if (door.powered && !this.breakerOn) return false;
    const open = wantOpen ?? door.state !== 1;
    door.state = open ? 1 : 0;
    door.moveUntil = this.time + 0.45;
    this.dirtyDoors.add(id);
    const pos = this.doorWorldPosition(id);
    if (pos) this.emitNoise(pos.x, pos.y, pos.z, pos.level, 1.5, -1);
    return true;
  }

  cutDoor(id: number, dt: number, cutSeconds: number): boolean {
    const door = this.doors.get(id);
    if (!door || door.state === 4) return false;
    door.cutProgress += dt;
    const pos = this.doorWorldPosition(id);
    if (pos) this.emitNoise(pos.x, pos.y, pos.z, pos.level, 3.2, -1);
    if (door.cutProgress >= cutSeconds) {
      door.state = 4;
      door.locked = false;
      this.dirtyDoors.add(id);
      return true;
    }
    return false;
  }

  doorWorldPosition(id: number): { x: number; y: number; z: number; level: number } | null {
    const spec = this.layout.doors.find((d) => d.id === id);
    if (!spec) return null;
    const grid = this.layout.levels[spec.level];
    return {
      x: INTERIOR_ORIGIN_X + (spec.x + 0.5 + SIDE_DX[spec.side] * 0.5) * TILE,
      y: grid.baseY + 1,
      z: (spec.z + 0.5 + SIDE_DZ[spec.side] * 0.5) * TILE,
      level: spec.level,
    };
  }

  setBreaker(on: boolean): void {
    if (this.breakerOn === on) return;
    this.breakerOn = on;
    this.events.push({ t: 'event', e: 'breaker', on });
    // Powered doors slam to their default state when the grid changes.
    for (const spec of this.layout.doors) {
      const runtime = this.doors.get(spec.id);
      if (!runtime || !runtime.powered) continue;
      runtime.state = on ? 1 : 0;
      this.dirtyDoors.add(spec.id);
    }
  }

  // ------------------------------------------------------------------ noise

  emitNoise(x: number, y: number, z: number, level: number, loudness: number, source: number, fake = false): void {
    if (loudness < AUDIO.hearingFloor) return;
    this.noises.push({ x, y, z, level, loudness, at: this.time, source, fake });
  }

  // ---------------------------------------------------------------- terrain

  /** Ground height for any position, indoors or out. */
  groundAt(x: number, z: number, level: number): number {
    if (level < 0) return this.terrainAt(x, z);
    const grid = this.layout.levels[level];
    return grid ? grid.baseY : 0;
  }

  isInsideShip(x: number, y: number, z: number, level: number): boolean {
    if (level >= 0) return false;
    return (
      Math.abs(x - this.ship.x) < this.ship.halfW &&
      Math.abs(z - this.ship.z) < this.ship.halfD &&
      y > this.ship.y - 2 &&
      y < this.ship.y + this.ship.height
    );
  }

  /** Water surface height right now, or -Infinity when the moon is dry. */
  waterLevel(): number {
    const flags = WEATHER[this.weather].flags;
    if (flags.rising) return floodLevel(this.weather, this.dayProgress);
    return this.exterior.waterBase ?? -Infinity;
  }

  // ------------------------------------------------------------------- tick

  update(dt: number, players: ServerPlayer[], damage: (p: ServerPlayer, amount: number, cause: string) => void): void {
    this.time += dt;
    this.dayProgress = clamp(this.time / DAY_LENGTH_SECONDS, 0, 1);

    this.noises = this.noises.filter((n) => this.time - n.at < 1.2);

    this.updateItems(dt, players);
    this.updateHazards(dt, players, damage);
    this.updateWeather(dt, players, damage);
    this.updateSpawning(players);

    for (const monster of this.monsters.values()) {
      runBrain(this, monster, players, dt, damage);
    }
  }

  private updateItems(dt: number, players: ServerPlayer[]): void {
    for (const item of this.items.values()) {
      if (item.heldBy >= 0) continue;

      if (!item.settled) {
        item.vy -= PLAYER.gravity * dt;
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        item.z += item.vz * dt;
        const floor = this.groundAt(item.x, item.z, item.level) + 0.12;
        if (item.y <= floor) {
          const impact = Math.abs(item.vy);
          item.y = floor;
          item.vx = 0;
          item.vy = 0;
          item.vz = 0;
          item.settled = true;
          this.dirtyItems.add(item.id);
          this.emitNoise(item.x, item.y, item.z, item.level, Math.min(3.4, 0.7 + impact * 0.16), -1);
          if (item.kind === 'scrap') this.applyDropDamage(item, impact);
        } else {
          this.dirtyItems.add(item.id);
        }
      }

      // Noisy scrap gives away the crew's position on its own schedule. This is
      // the single funniest line of code in the project.
      if (item.kind === 'scrap' && item.nextNoiseAt <= this.time) {
        const def = scrapById(item.defId);
        const chance = def.flags?.noisy ?? 0;
        if (chance > 0) {
          item.nextNoiseAt = this.time + this.rng.range(14, 46) / Math.max(0.05, chance);
          if (item.heldBy < 0 || true) {
            const holder = item.heldBy >= 0 ? players.find((p) => p.id === item.heldBy) : null;
            const px = holder ? holder.x : item.x;
            const py = holder ? holder.y + 1 : item.y;
            const pz = holder ? holder.z : item.z;
            const level = holder ? holder.level : item.level;
            this.emitNoise(px, py, pz, level, 2.4, -1);
            this.events.push({ t: 'event', e: 'sound', kind: 'scrapNoise', defId: item.defId, x: px, y: py, z: pz, level });
          }
        } else {
          item.nextNoiseAt = this.time + 60;
        }
      }

      if (item.deployed && item.deployedUntil > 0 && this.time > item.deployedUntil) {
        item.deployed = false;
        this.dirtyItems.add(item.id);
      }
    }
  }

  private applyDropDamage(item: WorldItem, impactSpeed: number): void {
    const def = scrapById(item.defId);
    const fragility = def.flags?.fragile ?? 0;
    if (fragility <= 0 || impactSpeed < 7) return;
    const loss = Math.min(0.75, ((impactSpeed - 7) / 16) * fragility);
    const before = item.value;
    item.value = Math.max(1, Math.round(item.value * (1 - loss)));
    if (item.value !== before) {
      this.dirtyItems.add(item.id);
      this.events.push({
        t: 'event',
        e: 'sound',
        kind: 'break',
        x: item.x,
        y: item.y,
        z: item.z,
        level: item.level,
        lost: before - item.value,
      });
    }
    if (def.flags?.explosive) {
      this.detonate(item, def.flags.explosive);
    }
  }

  detonate(item: WorldItem, power: number): void {
    const radius = 4 + power * 4;
    this.events.push({ t: 'event', e: 'sound', kind: 'explosion', x: item.x, y: item.y, z: item.z, level: item.level, radius });
    this.emitNoise(item.x, item.y, item.z, item.level, 12 * power, -1);
    for (const monster of this.monsters.values()) {
      if (monster.level !== item.level) continue;
      const d = dist3D(monster, item);
      if (d > radius) continue;
      this.hurtMonster(monster, 140 * power * (1 - d / radius));
    }
    this.removeItem(item.id);
  }

  private updateHazards(
    dt: number,
    players: ServerPlayer[],
    damage: (p: ServerPlayer, amount: number, cause: string) => void,
  ): void {
    for (const hazard of this.layout.hazards) {
      const grid = this.layout.levels[hazard.level];
      const hx = INTERIOR_ORIGIN_X + (hazard.x + 0.5) * TILE;
      const hz = (hazard.z + 0.5) * TILE;
      const hy = grid.baseY;

      let active = true;
      if (hazard.period > 0) {
        const phase = (this.time + hazard.phase) % hazard.period;
        active = hazard.kind === 'crusher' ? phase < 0.7 : phase < hazard.period * 0.42;
      }
      if (hazard.kind === 'pit') continue; // handled by falling, not proximity

      if (!active) continue;
      for (const player of players) {
        if (player.state !== 'alive' || player.level !== hazard.level) continue;
        const d = Math.hypot(player.x - hx, player.z - hz);
        if (d > hazard.radius || Math.abs(player.y - hy) > 3) continue;
        const dps = hazard.kind === 'crusher' ? hazard.damage : hazard.damage * dt;
        damage(player, dps, hazard.kind);
      }
    }
  }

  private updateWeather(
    dt: number,
    players: ServerPlayer[],
    damage: (p: ServerPlayer, amount: number, cause: string) => void,
  ): void {
    const flags = WEATHER[this.weather].flags;

    if (flags.lightning) {
      this.lightningAt -= dt;
      if (this.lightningAt <= 0) {
        this.lightningAt = this.rng.range(9, 26) * (1 - this.dayProgress * 0.4);
        this.strikeLightning(players, damage);
      }
    }

    const water = this.waterLevel();
    if (water > -50) {
      for (const player of players) {
        if (player.state !== 'alive' || player.level >= 0) continue;
        const depth = water - player.y;
        if (depth > 1.7) damage(player, 16 * dt, 'drowning');
      }
      // Items sitting in deep water on the surface are effectively lost value.
      for (const item of this.items.values()) {
        if (item.level >= 0 || item.heldBy >= 0 || item.stowed) continue;
        if (water - item.y > 2.2 && item.value > 1 && this.rng.bool(dt * 0.12)) {
          item.value = Math.max(1, Math.round(item.value * 0.985));
          this.dirtyItems.add(item.id);
        }
      }
    }
  }

  private strikeLightning(
    players: ServerPlayer[],
    damage: (p: ServerPlayer, amount: number, cause: string) => void,
  ): void {
    // Lightning prefers the employee holding the most metal. It is not random.
    let best: { player: ServerPlayer; weight: number } | null = null;
    for (const player of players) {
      if (player.state !== 'alive' || player.level >= 0) continue;
      if (this.isInsideShip(player.x, player.y, player.z, player.level)) continue;
      let conductive = 0;
      for (const slot of player.slots) {
        if (slot === null) continue;
        const item = this.items.get(slot);
        if (!item || item.kind !== 'scrap') continue;
        const def = scrapById(item.defId);
        if (def.flags?.conductive) conductive += def.weight;
      }
      if (conductive <= 0) continue;
      if (!best || conductive > best.weight) best = { player, weight: conductive };
    }

    let x: number;
    let z: number;
    if (best && this.rng.bool(0.8)) {
      x = best.player.x + this.rng.range(-1.4, 1.4);
      z = best.player.z + this.rng.range(-1.4, 1.4);
    } else {
      x = this.rng.range(-this.exterior.size, this.exterior.size);
      z = this.rng.range(-this.exterior.size, this.exterior.size);
    }
    const y = this.terrainAt(x, z);
    this.events.push({ t: 'event', e: 'lightning', x, y, z });
    this.emitNoise(x, y, z, -1, 14, -1);

    for (const player of players) {
      if (player.state !== 'alive' || player.level >= 0) continue;
      const d = Math.hypot(player.x - x, player.z - z);
      if (d < 3.4) damage(player, 100, 'lightning');
      else if (d < 8) damage(player, 34 * (1 - (d - 3.4) / 4.6), 'lightning');
    }
    for (const monster of this.monsters.values()) {
      if (monster.level >= 0) continue;
      if (dist2D(monster, { x, y, z }) < 4) this.hurtMonster(monster, 220);
    }
  }

  // --------------------------------------------------------------- monsters

  currentPower(where: 'indoor' | 'outdoor'): number {
    let total = 0;
    for (const monster of this.monsters.values()) {
      if (monster.mode === MODE.dead) continue;
      const inside = monster.level >= 0;
      if ((where === 'indoor') === inside) total += monster.def.power;
    }
    return total;
  }

  private updateSpawning(players: ServerPlayer[]): void {
    if (this.depot) return;
    const w = WEATHER[this.weather];
    const ramp = 0.22 + this.dayProgress * 0.78 * w.dangerRampMultiplier;

    this.indoorSpawnAt -= 1 / 20;
    this.outdoorSpawnAt -= 1 / 20;

    if (this.indoorSpawnAt <= 0) {
      const interval = lerp(this.moon.power.indoorInterval[0], this.moon.power.indoorInterval[1], this.dayProgress);
      this.indoorSpawnAt = interval * this.rng.range(0.7, 1.35);
      const cap = this.moon.power.indoorMax * w.indoorPowerMultiplier * Math.min(1, ramp);
      if (this.currentPower('indoor') < cap) this.trySpawn('indoor', players);
    }

    if (this.outdoorSpawnAt <= 0) {
      const interval = lerp(this.moon.power.outdoorInterval[0], this.moon.power.outdoorInterval[1], this.dayProgress);
      this.outdoorSpawnAt = interval * this.rng.range(0.7, 1.35);
      const cap = this.moon.power.outdoorMax * w.outdoorPowerMultiplier * Math.min(1, ramp);
      if (this.currentPower('outdoor') < cap) this.trySpawn('outdoor', players);
    }
  }

  private trySpawn(where: 'indoor' | 'outdoor', players: ServerPlayer[]): void {
    const pool = where === 'indoor' ? this.moon.indoorPool : this.moon.outdoorPool;
    const entries = Object.entries(pool)
      .map(([id, weight]) => ({ def: monsterById(id), weight }))
      .filter((e) => {
        if (this.dayProgress < e.def.window[0] || this.dayProgress > e.def.window[1]) return false;
        const alive = [...this.monsters.values()].filter((m) => m.defId === e.def.id && m.mode !== MODE.dead).length;
        return alive < e.def.maxAlive;
      });
    if (!entries.length) return;

    const chosen = this.rng.weighted(entries, (e) => e.weight);
    const count = this.rng.int(chosen.def.groupSize[0], chosen.def.groupSize[1]);
    const anchor = where === 'indoor' ? this.pickIndoorSpawn(players) : this.pickOutdoorSpawn(players);
    if (!anchor) return;

    for (let i = 0; i < count; i++) {
      const jitterX = i === 0 ? 0 : this.rng.range(-4, 4);
      const jitterZ = i === 0 ? 0 : this.rng.range(-4, 4);
      this.spawnMonster(chosen.def, anchor.x + jitterX, anchor.z + jitterZ, anchor.level);
    }
  }

  private pickIndoorSpawn(players: ServerPlayer[]): { x: number; z: number; level: number } | null {
    for (let attempt = 0; attempt < 80; attempt++) {
      const node = this.rng.pick(this.floorNodes);
      const world = this.nav.world(node);
      const cell = this.nav.node(node);
      if (!world || !cell) continue;
      const room = this.roomAt(cell.level, cell.x, cell.z);
      if (room && (room.tags.includes('entrance') || room.depth < 4)) continue;
      const wx = INTERIOR_ORIGIN_X + world.x;
      const tooClose = players.some(
        (p) => p.state === 'alive' && p.level === cell.level && Math.hypot(p.x - wx, p.z - world.z) < 22,
      );
      if (tooClose) continue;
      return { x: wx, z: world.z, level: cell.level };
    }
    return null;
  }

  private pickOutdoorSpawn(players: ServerPlayer[]): { x: number; z: number; level: number } | null {
    const size = this.exterior.size;
    for (let attempt = 0; attempt < 80; attempt++) {
      const x = this.rng.range(-size, size);
      const z = this.rng.range(-size, size);
      if (Math.hypot(x - this.ship.x, z - this.ship.z) < 46) continue;
      const tooClose = players.some((p) => p.state === 'alive' && p.level < 0 && Math.hypot(p.x - x, p.z - z) < 34);
      if (tooClose) continue;
      return { x, z, level: -1 };
    }
    return null;
  }

  spawnMonster(def: MonsterDef, x: number, z: number, level: number): Monster {
    const y = this.groundAt(x, z, level);
    const monster: Monster = {
      id: this.nextMonsterId++,
      defId: def.id,
      def,
      x,
      y,
      z,
      yaw: this.rng.range(0, Math.PI * 2),
      level,
      mode: def.brain === 'ambush' || def.brain === 'mimic' || def.brain === 'decoy' ? MODE.dormant : MODE.idle,
      anim: 0,
      health: def.health,
      stunUntil: 0,
      target: -1,
      lastKnown: null,
      path: [],
      pathIndex: 0,
      repathAt: 0,
      nextAttackAt: 0,
      windupUntil: 0,
      windupTarget: -1,
      home: { x, z, level },
      mem: {},
      carrying: [],
      nextVoiceAt: this.time + this.rng.range(2, def.voice.idleInterval || 10),
      spawnedAt: this.time,
      seen: false,
    };
    this.monsters.set(monster.id, monster);
    this.events.push({ t: 'event', e: 'spawn', id: monster.id, defId: def.id, x, y, z, level });
    return monster;
  }

  hurtMonster(monster: Monster, amount: number): void {
    if (monster.mode === MODE.dead) return;
    if (monster.def.health >= 9000) {
      // Effectively unkillable things still flinch, which is the only feedback
      // the player gets that hitting it was pointless.
      monster.mem.flinchUntil = this.time + 0.3;
      return;
    }
    monster.health -= amount;
    if (monster.health <= 0) {
      monster.mode = MODE.dead;
      this.events.push({ t: 'event', e: 'despawn', id: monster.id, defId: monster.defId, killed: true, x: monster.x, y: monster.y, z: monster.z, level: monster.level });
      for (const itemId of monster.carrying) {
        const item = this.items.get(itemId);
        if (!item) continue;
        item.heldBy = -1;
        item.x = monster.x;
        item.y = monster.y + 0.4;
        item.z = monster.z;
        item.level = monster.level;
        item.settled = false;
        this.dirtyItems.add(item.id);
      }
      monster.carrying = [];
      setTimeout(() => this.monsters.delete(monster.id), 4000);
    }
  }

  stunMonster(monster: Monster, seconds: number): void {
    const allowed = monster.def.flags?.stunSeconds ?? 0;
    if (allowed <= 0) return;
    monster.stunUntil = this.time + Math.min(seconds, allowed);
    monster.mode = MODE.stunned;
    monster.target = -1;
    this.events.push({ t: 'event', e: 'stun', id: monster.id, seconds: Math.min(seconds, allowed) });
  }

  roomAt(level: number, cx: number, cz: number) {
    const grid = this.layout.levels[level];
    if (!grid || !isFloor(grid, cx, cz)) return null;
    const id = grid.cells[cellIndex(grid, cx, cz)];
    return this.layout.rooms.find((r) => r.id === id) ?? null;
  }

  /** True when the room the position sits in has working lights. */
  isLit(x: number, z: number, level: number): boolean {
    if (level < 0) return true;
    const cx = Math.floor((x - INTERIOR_ORIGIN_X) / TILE);
    const cz = Math.floor(z / TILE);
    const room = this.roomAt(level, cx, cz);
    return !!room?.lit && this.breakerOn;
  }

  /**
   * Line of sight on the cell grid. Doors block sight when shut, which is what
   * makes shutting one behind you meaningful.
   */
  hasLineOfSight(from: { x: number; z: number; level: number }, to: { x: number; z: number; level: number }): boolean {
    if (from.level !== to.level) return false;
    if (from.level < 0) return true; // exterior sight lines are handled by fog, not geometry
    const grid = this.layout.levels[from.level];
    if (!grid) return false;
    let x0 = (from.x - INTERIOR_ORIGIN_X) / TILE;
    let z0 = from.z / TILE;
    const x1 = (to.x - INTERIOR_ORIGIN_X) / TILE;
    const z1 = to.z / TILE;
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2);
    if (steps === 0) return true;
    const dx = (x1 - x0) / steps;
    const dz = (z1 - z0) / steps;
    let prevX = Math.floor(x0);
    let prevZ = Math.floor(z0);
    for (let i = 1; i <= steps; i++) {
      x0 += dx;
      z0 += dz;
      const cx = Math.floor(x0);
      const cz = Math.floor(z0);
      if (cx === prevX && cz === prevZ) continue;
      if (!isFloor(grid, cx, cz)) return false;
      // Crossing a cell boundary: check the wall between the two cells.
      const stepX = cx - prevX;
      const stepZ = cz - prevZ;
      const side = stepX === 1 ? 1 : stepX === -1 ? 3 : stepZ === 1 ? 2 : 0;
      const ci = cellIndex(grid, prevX, prevZ);
      const doorId = grid.doors[ci * 4 + side];
      if (doorId >= 0) {
        if (!this.isDoorPassable(doorId)) return false;
      } else if ((grid.walls[ci] & (1 << side)) !== 0) {
        return false;
      }
      prevX = cx;
      prevZ = cz;
    }
    return true;
  }

  /** Perception check shared by every sighted brain. */
  canSee(monster: Monster, player: ServerPlayer): boolean {
    const def = monster.def;
    if (def.senses.sight <= 0) return false;
    if (player.state !== 'alive') return false;
    if (monster.level !== player.level) return false;
    if (this.isInsideShip(player.x, player.y, player.z, player.level)) return false;

    let range = def.senses.sight;
    // Darkness cuts sight, crouching cuts it further, a lit torch gives it back.
    if (player.level >= 0 && !this.isLit(player.x, player.z, player.level)) range *= 0.55;
    if ((player.flags & 1) !== 0) range *= 0.6;
    if ((player.flags & 8) !== 0) range *= 1.5;

    const d = dist2D(monster, player);
    if (d > range) return false;

    if (def.senses.fov < 6.2) {
      const toPlayer = Math.atan2(player.x - monster.x, player.z - monster.z);
      if (Math.abs(angleDelta(monster.yaw, toPlayer)) > def.senses.fov * 0.5) return false;
    }
    return this.hasLineOfSight(monster, player);
  }

  /** Loudest noise this creature can currently hear, or null. */
  hears(monster: Monster): NoiseEvent | null {
    const def = monster.def;
    if (def.senses.hearing <= 0) return null;
    let best: NoiseEvent | null = null;
    let bestScore = 0;
    for (const noise of this.noises) {
      if (noise.level !== monster.level) continue;
      const d = dist3D(monster, noise);
      if (d > def.senses.hearing) continue;
      const attenuated = noise.loudness * (1 - d / def.senses.hearing);
      if (attenuated < def.senses.hearingFloor) continue;
      if (attenuated > bestScore) {
        bestScore = attenuated;
        best = noise;
      }
    }
    return best;
  }
}
