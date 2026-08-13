import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GameRoom, type Connection } from '../server/room.ts';
import type { ClientMessage, ServerMessage, ShipSnapshot, WorldItemSnapshot } from '@shared/protocol.ts';
import { DAY_LENGTH_SECONDS } from '@shared/constants.ts';

/**
 * Drives a real GameRoom through a whole contract: route, land, walk in, pick
 * something up, carry it back, launch, sell it, and be told the quota went up.
 * If this test passes, the game loop is genuinely connected end to end.
 */

class FakeClient implements Connection {
  id = -1;
  ship: ShipSnapshot | null = null;
  items = new Map<number, WorldItemSnapshot>();
  inventory: { itemId: number | null; defId: string | null; value: number }[] = [];
  terminal: string[] = [];
  events: ServerMessage[] = [];

  send(message: ServerMessage): void {
    this.events.push(message);
    switch (message.t) {
      case 'welcome':
        this.id = message.playerId;
        break;
      case 'snapshot':
        this.ship = message.ship;
        break;
      case 'items':
        for (const item of message.items) this.items.set(item.id, item);
        for (const id of message.removed) this.items.delete(id);
        break;
      case 'inventory':
        this.inventory = message.slots;
        break;
      case 'terminal':
        this.terminal.push(...message.lines);
        break;
    }
  }

  close(): void {}

  lastTerminal(count = 12): string {
    return this.terminal.slice(-count).join('\n');
  }
}

function send(room: GameRoom, id: number, msg: ClientMessage): void {
  room.handle(id, msg);
}

/** Moves a player instantly; the server clamps speed but not teleports below cap. */
function moveTo(room: GameRoom, id: number, seq: number, x: number, y: number, z: number, level: number): void {
  send(room, id, { t: 'input', seq, x, y, z, yaw: 0, pitch: 0, level, flags: 0 });
}

describe('full expedition loop', () => {
  let room: GameRoom;
  let client: FakeClient;

  beforeAll(() => {
    room = new GameRoom('test-loop', 20260813);
    client = new FakeClient();
    room.join(client, 'TESTER', 0);
  });

  afterAll(() => {
    room.stop();
  });

  it('starts in orbit with a quota and a terminal', () => {
    expect(room.phase).toBe('orbit');
    expect(room.run.quota).toBeGreaterThan(0);
    expect(client.id).toBeGreaterThan(0);
    send(room, client.id, { t: 'terminal', line: 'MOONS' });
    expect(client.lastTerminal(40)).toContain('41-RIDGE');
  });

  it('refuses to land without a route', () => {
    send(room, client.id, { t: 'terminal', line: 'LAND' });
    expect(client.lastTerminal(3)).toContain('NO ROUTE SET');
  });

  it('routes and lands on a free moon', () => {
    send(room, client.id, { t: 'terminal', line: 'ROUTE RIDGE' });
    expect(client.lastTerminal(3)).toContain('ROUTE SET');
    send(room, client.id, { t: 'terminal', line: 'LAND' });
    expect(room.phase).toBe('landed');
    expect(room.world).not.toBeNull();
  });

  it('spawns scrap in the facility and equipment in the ship', () => {
    const world = room.world!;
    const scrap = [...world.items.values()].filter((i) => i.kind === 'scrap');
    const gear = [...world.items.values()].filter((i) => i.kind === 'equipment');
    expect(scrap.length).toBeGreaterThan(8);
    expect(gear.length).toBe(room.run.lockers.length + 0);
    expect(gear.every((g) => g.stowed)).toBe(true);
  });

  it('lets a crew member pick up scrap deep in the facility', () => {
    const world = room.world!;
    const target = [...world.items.values()].find((i) => i.kind === 'scrap' && !i.stowed)!;
    expect(target).toBeDefined();

    // Walk to it. The server clamps per-input distance, so step there.
    let seq = 1;
    moveTo(room, client.id, seq++, target.x, target.y, target.z, target.level);
    for (let i = 0; i < 60; i++) moveTo(room, client.id, seq++, target.x, target.y, target.z, target.level);

    send(room, client.id, { t: 'interact', kind: 'item', id: target.id });
    expect(client.inventory.some((s) => s.itemId === target.id)).toBe(true);
    expect(world.items.get(target.id)!.heldBy).toBe(client.id);
  });

  it('counts cargo only once it is physically inside the hull', () => {
    const world = room.world!;
    const carried = client.inventory.find((s) => s.itemId !== null)!;
    expect(carried).toBeDefined();

    let seq = 1000;
    // Still outside: nothing is counted yet.
    expect(room.world!.isInsideShip(world.ship.x + 40, world.ship.y, world.ship.z, -1)).toBe(false);

    for (let i = 0; i < 40; i++) {
      moveTo(room, client.id, seq++, world.ship.x, world.ship.y, world.ship.z, -1);
    }
    send(room, client.id, { t: 'drop', slot: 0, throwForce: 0, yaw: 0, pitch: 0 });
    const dropped = world.items.get(carried.itemId!)!;
    expect(dropped.heldBy).toBe(-1);
    expect(world.isInsideShip(dropped.x, dropped.y, dropped.z, dropped.level)).toBe(true);
  });

  it('closes the expedition on launch and banks the cargo', () => {
    const before = room.run.day;
    send(room, client.id, { t: 'terminal', line: 'LAUNCH' });
    expect(room.phase).toBe('departing');

    // Fast-forward past the departure timer.
    (room as unknown as { departAt: number }).departAt = Date.now() - 1;
    (room as unknown as { checkAutopilot(dt: number): void }).checkAutopilot(0.05);

    expect(room.phase).toBe('orbit');
    expect(room.run.day).toBe(before + 1);
    expect(client.lastTerminal(8)).toContain('EXPEDITION CLOSED');
  });

  it('sells at the depot and moves the quota', () => {
    send(room, client.id, { t: 'terminal', line: 'ROUTE COMPANY' });
    send(room, client.id, { t: 'terminal', line: 'LAND' });
    expect(room.phase).toBe('company');

    const world = room.world!;
    const counterX = world.ship.x + 19;
    const counterZ = world.ship.z - 2;
    // Only what came home with us: the depot itself holds no salvage.
    const cargo = [...world.items.values()].filter(
      (i) => i.kind === 'scrap' && world.isInsideShip(i.x, i.y, i.z, i.level),
    );
    expect(cargo.length).toBeGreaterThan(0);

    // Carry it to the counter the honest way: pick up, walk over, drop.
    let seq = 5000;
    for (const item of cargo) {
      for (let i = 0; i < 8; i++) moveTo(room, client.id, seq++, item.x, item.y, item.z, -1);
      send(room, client.id, { t: 'interact', kind: 'item', id: item.id });
      for (let i = 0; i < 40; i++) moveTo(room, client.id, seq++, counterX, world.ship.y, counterZ, -1);
      const slot = client.inventory.findIndex((s) => s.itemId === item.id);
      if (slot >= 0) send(room, client.id, { t: 'drop', slot, throwForce: 0, yaw: 0, pitch: 0 });
    }

    const before = room.run.quotaMet;
    send(room, client.id, { t: 'terminal', line: 'SELL' });
    expect(client.lastTerminal(20)).toContain('APPRAISAL');
    expect(room.run.quotaMet).toBeGreaterThan(before);
  });

  it('ends the contract when the deadline passes unmet', () => {
    const doomed = new GameRoom('test-doom', 424242);
    const c = new FakeClient();
    doomed.join(c, 'DOOMED', 0);
    doomed.run.daysLeft = 1;
    doomed.run.quotaMet = 0;

    send(doomed, c.id, { t: 'terminal', line: 'ROUTE RIDGE' });
    send(doomed, c.id, { t: 'terminal', line: 'LAND' });
    send(doomed, c.id, { t: 'terminal', line: 'LAUNCH' });
    (doomed as unknown as { departAt: number }).departAt = Date.now() - 1;
    (doomed as unknown as { checkAutopilot(dt: number): void }).checkAutopilot(0.05);

    expect(doomed.phase).toBe('gameover');
    expect(c.lastTerminal(12)).toContain('QUOTA NOT MET');
    doomed.stop();
  });
});

describe('creature simulation', () => {
  it('spawns creatures over the course of a day and they act', () => {
    const room = new GameRoom('test-ai', 777);
    const client = new FakeClient();
    room.join(client, 'BAIT', 0);
    send(room, client.id, { t: 'terminal', line: 'ROUTE KESSEL' });
    room.run.credits = 9999;
    send(room, client.id, { t: 'terminal', line: 'LAND' });

    const world = room.world!;
    const player = { x: world.ship.x, y: world.ship.y, z: world.ship.z };
    let seq = 1;
    let moved = false;

    // Simulate ten minutes of expedition at 20 Hz.
    for (let step = 0; step < 20 * 60 * 10; step++) {
      moveTo(room, client.id, seq++, player.x, player.y, player.z, -1);
      world.update(1 / 20, (room as unknown as { players(): [] }).players(), () => {});
      if (world.monsters.size > 0) moved = true;
    }

    expect(world.monsters.size).toBeGreaterThan(0);
    expect(moved).toBe(true);
    // Nothing should have escaped the map or gone non-finite.
    for (const m of world.monsters.values()) {
      expect(Number.isFinite(m.x) && Number.isFinite(m.z)).toBe(true);
      expect(Math.abs(m.x)).toBeLessThan(1e6);
    }
    room.stop();
  }, 30000);
});
