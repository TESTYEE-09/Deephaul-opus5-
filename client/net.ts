import { PROTOCOL_VERSION, type ClientMessage, type DoorSnapshot, type InventorySlot, type MonsterSnapshot, type PlayerSnapshot, type ServerMessage, type ShipSnapshot, type WorldItemSnapshot } from '@shared/protocol.ts';
import type { WeatherId } from '@shared/content/weather.ts';
import { LocalSocket } from './solo.ts';

/** One interpolated remote entity. Local movement is predicted, not interpolated. */
export interface Interpolated<T> {
  prev: T;
  next: T;
  prevAt: number;
  nextAt: number;
}

export interface Expedition {
  moonId: string | null;
  weather: WeatherId | null;
  seed: number;
  day: number;
  phase: string;
}

type Listener = (msg: ServerMessage) => void;

export class NetClient {
  socket: WebSocket | null = null;
  playerId = -1;
  hostId = -1;
  connected = false;

  roster: { id: number; name: string; skin: number; ready: boolean; state: string }[] = [];
  players = new Map<number, Interpolated<PlayerSnapshot>>();
  monsters = new Map<number, Interpolated<MonsterSnapshot>>();
  items = new Map<number, WorldItemSnapshot>();
  doors = new Map<number, DoorSnapshot>();
  inventory: InventorySlot[] = [];
  heldSlot = 0;
  ship: ShipSnapshot | null = null;
  expedition: Expedition = { moonId: null, weather: null, seed: 0, day: 1, phase: 'orbit' };
  radar: { id: number; x: number; z: number; level: number; kind: string; name?: string }[] = [];
  bestiary: { unlocked: string[]; killedBy: string[] } = { unlocked: [], killedBy: [] };

  latency = 0;
  private listeners: Listener[] = [];
  private seq = 0;
  private lastSnapshotAt = 0;
  private snapshotInterval = 100;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  on(fn: Listener): void {
    this.listeners.push(fn);
  }

  connect(url: string, name: string, room: string, skin: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      // An empty server field means "host the authoritative server in this
      // tab": a web worker runs the same GameRoom as the Node server, which is
      // what makes the game playable on static hosting like GitHub Pages.
      const socket: WebSocket | LocalSocket =
        !url || url === 'local' ? new LocalSocket() : new WebSocket(url);
      this.socket = socket as WebSocket;

      socket.onopen = () => {
        this.connected = true;
        this.send({ t: 'hello', name, skin, version: PROTOCOL_VERSION, room });
        this.pingTimer = setInterval(() => this.send({ t: 'ping', time: performance.now() }), 3000);
      };

      socket.onmessage = (ev: { data: string }) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        this.ingest(msg);
        if (!settled && msg.t === 'welcome') {
          settled = true;
          resolve();
        }
      };

      socket.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('could not reach the server'));
        }
      };

      socket.onclose = () => {
        this.connected = false;
        if (this.pingTimer) clearInterval(this.pingTimer);
        if (!settled) {
          settled = true;
          reject(new Error('connection closed'));
        }
        for (const fn of this.listeners) {
          fn({ t: 'chat', from: 'SYSTEM', fromId: -1, text: 'Connection lost.', channel: 'system' });
        }
      };
    });
  }

  private ingest(msg: ServerMessage): void {
    const now = performance.now();
    switch (msg.t) {
      case 'welcome':
        this.playerId = msg.playerId;
        this.hostId = msg.hostId;
        break;

      case 'roster':
        this.roster = msg.players;
        this.hostId = msg.hostId;
        break;

      case 'expedition': {
        // A new moon (or orbit) means a new world with ids that restart at 1.
        // Without pruning, items from the previous moon that the new world does
        // not contain linger in the merge-by-id maps and render as ghosts at
        // their old positions.
        const changed = msg.moonId !== this.expedition.moonId || msg.seed !== this.expedition.seed;
        this.expedition = { moonId: msg.moonId, weather: msg.weather, seed: msg.seed, day: msg.day, phase: msg.phase };
        if (changed) {
          this.items.clear();
          this.doors.clear();
        }
        break;
      }

      case 'snapshot': {
        if (this.lastSnapshotAt > 0) {
          const gap = now - this.lastSnapshotAt;
          // Smoothed estimate so interpolation survives a hitching connection.
          this.snapshotInterval = this.snapshotInterval * 0.8 + gap * 0.2;
        }
        this.lastSnapshotAt = now;
        const arrive = now;
        const nextAt = now + Math.min(220, Math.max(60, this.snapshotInterval));

        const seenPlayers = new Set<number>();
        for (const p of msg.players) {
          seenPlayers.add(p.id);
          const existing = this.players.get(p.id);
          if (existing) {
            existing.prev = existing.next;
            existing.prevAt = arrive;
            existing.next = p;
            existing.nextAt = nextAt;
          } else {
            this.players.set(p.id, { prev: p, next: p, prevAt: arrive, nextAt });
          }
        }
        for (const id of [...this.players.keys()]) if (!seenPlayers.has(id)) this.players.delete(id);

        const seenMonsters = new Set<number>();
        for (const m of msg.monsters) {
          seenMonsters.add(m.id);
          const existing = this.monsters.get(m.id);
          if (existing) {
            existing.prev = existing.next;
            existing.prevAt = arrive;
            existing.next = m;
            existing.nextAt = nextAt;
          } else {
            this.monsters.set(m.id, { prev: m, next: m, prevAt: arrive, nextAt });
          }
        }
        for (const id of [...this.monsters.keys()]) if (!seenMonsters.has(id)) this.monsters.delete(id);

        this.ship = msg.ship;
        break;
      }

      case 'items':
        for (const item of msg.items) this.items.set(item.id, item);
        for (const id of msg.removed) this.items.delete(id);
        break;

      case 'doors':
        for (const door of msg.doors) this.doors.set(door.id, door);
        break;

      case 'inventory':
        this.inventory = msg.slots;
        this.heldSlot = msg.held;
        break;

      case 'radar':
        // Ghost blips arrive as one-off additions and expire on their own.
        for (const blip of msg.blips) {
          const idx = this.radar.findIndex((b) => b.id === blip.id);
          if (idx >= 0) this.radar[idx] = blip;
          else this.radar.push(blip);
        }
        if (msg.blips.length > 1) {
          const ids = new Set(msg.blips.map((b) => b.id));
          this.radar = this.radar.filter((b) => ids.has(b.id) || b.kind === 'ghost');
        }
        break;

      case 'bestiary':
        this.bestiary = { unlocked: msg.unlocked, killedBy: msg.killedBy };
        break;

      case 'pong':
        this.latency = performance.now() - msg.time;
        break;
    }
    for (const fn of this.listeners) fn(msg);
  }

  send(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  sendInput(x: number, y: number, z: number, yaw: number, pitch: number, level: number, flags: number): void {
    this.send({ t: 'input', seq: ++this.seq, x, y, z, yaw, pitch, level, flags });
  }

  /** Position of a remote entity, interpolated to render time. */
  static lerpSnapshot<T extends { x: number; y: number; z: number; yaw: number }>(
    entry: Interpolated<T>,
    now: number,
  ): { x: number; y: number; z: number; yaw: number; t: number } {
    const span = Math.max(1, entry.nextAt - entry.prevAt);
    const t = Math.min(1.35, Math.max(0, (now - entry.prevAt) / span));
    const a = entry.prev;
    const b = entry.next;
    let dyaw = b.yaw - a.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      yaw: a.yaw + dyaw * t,
      t,
    };
  }

  self(): PlayerSnapshot | null {
    return this.players.get(this.playerId)?.next ?? null;
  }
}

export const net = new NetClient();
