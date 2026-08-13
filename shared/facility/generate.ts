import { RNG } from '../rng.ts';
import { TILE, CEIL_HEIGHT } from '../constants.ts';
import type { MoonDef, InteriorStyle } from '../content/moons.ts';
import { WEATHER, type WeatherId } from '../content/weather.ts';
import { SCRAP, type ScrapDef } from '../content/scrap.ts';
import { paletteFor, type PropPalette } from './dressing.ts';
import {
  type FacilityLayout,
  type LevelGrid,
  type RoomSpec,
  type RoomTag,
  type DoorSpec,
  type DoorKind,
  type Side,
  type HazardSpec,
  type PropSpec,
  type ScrapSpawn,
  type StairSpec,
  SIDE_DX,
  SIDE_DZ,
  OPPOSITE,
  cellIndex,
  isFloor,
} from './types.ts';

export interface GenerateOptions {
  seed: number;
  moon: MoonDef;
  weather: WeatherId;
  /** Expedition index, used to keep repeat visits from feeling identical. */
  dayIndex: number;
}

interface BspNode {
  x: number;
  z: number;
  w: number;
  d: number;
  left?: BspNode;
  right?: BspNode;
  room?: { x: number; z: number; w: number; d: number };
}

const MIN_LEAF = 6;
const MIN_ROOM = 2;

/** Weighted tag table. Corridors and entrances are assigned separately. */
const TAG_WEIGHTS: [RoomTag, number][] = [
  ['storage', 22],
  ['machine', 18],
  ['maintenance', 14],
  ['office', 11],
  ['hall', 9],
  ['server', 6],
  ['canteen', 5],
  ['dorm', 5],
  ['washroom', 4],
  ['admin', 4],
  ['pit', 3],
];

/** How much scrap a room type tends to hold, and how good it tends to be. */
const TAG_LOOT: Partial<Record<RoomTag, { count: number; quality: number }>> = {
  storage: { count: 2.6, quality: 0.9 },
  vault: { count: 2.2, quality: 2.4 },
  machine: { count: 1.5, quality: 1.1 },
  maintenance: { count: 1.3, quality: 0.9 },
  office: { count: 1.4, quality: 1.2 },
  admin: { count: 1.2, quality: 1.6 },
  canteen: { count: 1.3, quality: 0.8 },
  dorm: { count: 1.2, quality: 0.9 },
  washroom: { count: 0.7, quality: 0.6 },
  server: { count: 1.0, quality: 1.5 },
  hall: { count: 0.9, quality: 1.0 },
  generator: { count: 0.8, quality: 1.3 },
  pit: { count: 0.7, quality: 1.4 },
  entrance: { count: 0.5, quality: 0.5 },
  exit: { count: 0.4, quality: 0.6 },
  stairwell: { count: 0.3, quality: 0.8 },
  corridor: { count: 0.28, quality: 0.7 },
};

export function generateFacility(opts: GenerateOptions): FacilityLayout {
  const { moon, weather } = opts;
  const rng = new RNG(opts.seed);
  const style: InteriorStyle = rng.pick(moon.interior.styles);
  const targetCells = rng.int(moon.interior.cells[0], moon.interior.cells[1]);

  // Bigger facilities get a sublevel, then a second one. That is where the good
  // scrap and the bad decisions live.
  const levelCount = targetCells > 290 ? 3 : targetCells > 130 || style === 'sublevel' || style === 'mine' ? 2 : 1;
  const perLevel = Math.ceil(targetCells / levelCount);

  const rooms: RoomSpec[] = [];
  const doors: DoorSpec[] = [];
  const levels: LevelGrid[] = [];
  let nextRoomId = 0;
  let nextDoorId = 0;

  for (let li = 0; li < levelCount; li++) {
    // Rooms plus their surrounding rock fill roughly a third of the grid,
    // so the side length has to over-provision to hit the cell target.
    const side = Math.max(14, Math.round(Math.sqrt(perLevel / 0.34)));
    const grid: LevelGrid = {
      index: li,
      w: side,
      d: side,
      baseY: -li * (CEIL_HEIGHT + 1.4),
      cells: new Int16Array(side * side).fill(-1),
      walls: new Uint8Array(side * side),
      doors: new Int16Array(side * side * 4).fill(-1),
    };

    const levelRng = rng.fork(0x5a17 + li);
    const root: BspNode = { x: 1, z: 1, w: side - 2, d: side - 2 };
    splitNode(root, levelRng, 0, MIN_LEAF);

    const leaves: BspNode[] = [];
    collectLeaves(root, leaves);

    // Carve one room per leaf.
    for (const leaf of leaves) {
      const maxW = leaf.w - 2;
      const maxD = leaf.d - 2;
      if (maxW < MIN_ROOM || maxD < MIN_ROOM) continue;
      const w = levelRng.int(MIN_ROOM, Math.min(maxW, 6));
      const d = levelRng.int(MIN_ROOM, Math.min(maxD, 6));
      const x = leaf.x + levelRng.int(1, leaf.w - w - 1);
      const z = leaf.z + levelRng.int(1, leaf.d - d - 1);
      leaf.room = { x, z, w, d };

      const id = nextRoomId++;
      const spec: RoomSpec = {
        id,
        level: li,
        x,
        z,
        w,
        d,
        tags: [levelRng.weighted(TAG_WEIGHTS, (t) => t[1])[0]],
        lit: false,
        depth: 0,
        seed: levelRng.int(0, 0x7fffffff),
      };
      rooms.push(spec);
      for (let cz = z; cz < z + d; cz++) {
        for (let cx = x; cx < x + w; cx++) grid.cells[cz * side + cx] = id;
      }
    }

    // Connect siblings, then add loops so the map is not a tree you can solve.
    connectNode(root, grid, levelRng, rooms, () => nextRoomId++, li);
    addLoops(grid, rooms, levelRng, moon.interior.loopiness, li, () => nextRoomId++);

    levels.push(grid);
  }

  // ------------------------------------------------------------------- walls
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  for (const grid of levels) buildWalls(grid, roomById);

  // ------------------------------------------------------------------- doors
  for (const grid of levels) {
    placeDoors(grid, roomById, rng, moon.interior.powerDoorChance, moon.interior.lockedChance, doors, () => nextDoorId++);
  }

  // --------------------------------------------------------------- entrances
  const anchors: FacilityLayout['anchors'] = [];
  const surface = levels[0];
  const mainCount = rng.int(moon.exterior.mainEntrances[0], moon.exterior.mainEntrances[1]);
  const fireCount = rng.int(moon.exterior.fireExits[0], moon.exterior.fireExits[1]);
  const usedBorders: { x: number; z: number }[] = [];

  for (let i = 0; i < mainCount + fireCount; i++) {
    const kind: 'main' | 'fire' = i < mainCount ? 'main' : 'fire';
    const spot = carveBorderEntrance(surface, rooms, rng, usedBorders, nextRoomId, kind);
    if (!spot) continue;
    if (spot.newRoom) {
      rooms.push(spot.newRoom);
      roomById.set(spot.newRoom.id, spot.newRoom);
      nextRoomId++;
    }
    const doorId = nextDoorId++;
    doors.push({ id: doorId, level: 0, x: spot.x, z: spot.z, side: spot.side, kind: kind === 'main' ? 'main' : 'fire', exteriorAnchor: anchors.length });
    surface.doors[cellIndex(surface, spot.x, spot.z) * 4 + spot.side] = doorId;
    surface.walls[cellIndex(surface, spot.x, spot.z)] &= ~(1 << spot.side);
    anchors.push({ doorId, kind });
    usedBorders.push({ x: spot.x, z: spot.z });
    const room = roomById.get(surface.cells[cellIndex(surface, spot.x, spot.z)]);
    if (room) room.tags = [kind === 'main' ? 'entrance' : 'exit'];
  }

  // ------------------------------------------------------------------ stairs
  const stairs: StairSpec[] = [];
  if (levels.length > 1) {
    const found = findStairSpots(levels, rng, 3);
    for (const s of found) {
      stairs.push(s);
      for (const li of [s.level, s.level + 1]) {
        const g = levels[li];
        const rid = g.cells[cellIndex(g, s.x, s.z)];
        const room = roomById.get(rid);
        if (room && !room.tags.includes('stairwell')) room.tags.push('stairwell');
      }
    }
  }

  // ------------------------------------------------- depth, lighting, specials
  computeDepth(levels, doors, stairs, rooms);
  assignSpecialRooms(rooms, rng, doors, levels);
  const litChance = moon.interior.litChance;
  for (const r of rooms) {
    if (r.tags.includes('entrance')) r.lit = true;
    else if (r.tags.includes('generator')) r.lit = true;
    else {
      const falloff = Math.max(0.25, 1 - r.depth * 0.012 - r.level * 0.18);
      r.lit = rng.bool(litChance * falloff);
    }
  }

  const breaker = pickBreaker(rooms, levels);

  // ----------------------------------------------------------------- hazards
  const hazards = placeHazards(levels, rooms, rng, style, moon.hazard);

  // ------------------------------------------------------------------- props
  const props = placeProps(levels, rooms, rng, style);

  // ------------------------------------------------------------------- scrap
  const weatherMult = WEATHER[weather].scrapValueMultiplier;
  const scrap = placeScrap(levels, rooms, rng, moon, weatherMult);

  // ------------------------------------------------------- nests, entry spawns
  const nests = pickNests(rooms, doors, levels, rng);
  const entrySpawns = doors
    .filter((d) => d.kind === 'main' || d.kind === 'fire')
    .map((d) => {
      const g = levels[d.level];
      return {
        doorId: d.id,
        level: d.level,
        px: (d.x + 0.5) * TILE,
        py: g.baseY,
        pz: (d.z + 0.5) * TILE,
        rotY: Math.atan2(-SIDE_DX[d.side], -SIDE_DZ[d.side]),
      };
    });

  const cellCount = levels.reduce((n, g) => n + g.cells.reduce((a, c) => a + (c >= 0 ? 1 : 0), 0), 0);

  return {
    seed: opts.seed,
    style,
    levels,
    rooms,
    doors,
    stairs,
    hazards,
    props,
    scrap,
    anchors,
    breaker,
    nests,
    entrySpawns,
    stats: {
      cellCount,
      roomCount: rooms.length,
      scrapValue: scrap.reduce((s, x) => s + x.value, 0),
    },
  };
}

// ---------------------------------------------------------------------- BSP

function splitNode(node: BspNode, rng: RNG, depth: number, minLeaf: number): void {
  if (depth > 6) return;
  const canH = node.d >= minLeaf * 2;
  const canV = node.w >= minLeaf * 2;
  if (!canH && !canV) return;
  // Stop early sometimes so room sizes vary instead of forming a neat lattice.
  if (depth >= 2 && rng.bool(0.16)) return;

  const horizontal = canH && canV ? node.d > node.w * 1.15 ? true : node.w > node.d * 1.15 ? false : rng.bool() : canH;
  if (horizontal) {
    const cut = rng.int(minLeaf, node.d - minLeaf);
    node.left = { x: node.x, z: node.z, w: node.w, d: cut };
    node.right = { x: node.x, z: node.z + cut, w: node.w, d: node.d - cut };
  } else {
    const cut = rng.int(minLeaf, node.w - minLeaf);
    node.left = { x: node.x, z: node.z, w: cut, d: node.d };
    node.right = { x: node.x + cut, z: node.z, w: node.w - cut, d: node.d };
  }
  splitNode(node.left, rng, depth + 1, minLeaf);
  splitNode(node.right, rng, depth + 1, minLeaf);
}

function collectLeaves(node: BspNode, out: BspNode[]): void {
  if (!node.left && !node.right) {
    out.push(node);
    return;
  }
  if (node.left) collectLeaves(node.left, out);
  if (node.right) collectLeaves(node.right, out);
}

function nodeCenter(node: BspNode): { x: number; z: number } | null {
  if (node.room) {
    return { x: Math.floor(node.room.x + node.room.w / 2), z: Math.floor(node.room.z + node.room.d / 2) };
  }
  const a = node.left ? nodeCenter(node.left) : null;
  const b = node.right ? nodeCenter(node.right) : null;
  return a ?? b;
}

function connectNode(
  node: BspNode,
  grid: LevelGrid,
  rng: RNG,
  rooms: RoomSpec[],
  nextId: () => number,
  level: number,
): void {
  if (!node.left || !node.right) return;
  connectNode(node.left, grid, rng, rooms, nextId, level);
  connectNode(node.right, grid, rng, rooms, nextId, level);
  const a = nodeCenter(node.left);
  const b = nodeCenter(node.right);
  if (!a || !b) return;
  carveCorridor(grid, a, b, rng, rooms, nextId, level);
}

/** L-shaped corridor. Wide corridors show up occasionally as service halls. */
function carveCorridor(
  grid: LevelGrid,
  a: { x: number; z: number },
  b: { x: number; z: number },
  rng: RNG,
  rooms: RoomSpec[],
  nextId: () => number,
  level: number,
): void {
  const id = nextId();
  const corridor: RoomSpec = {
    id,
    level,
    x: Math.min(a.x, b.x),
    z: Math.min(a.z, b.z),
    w: Math.abs(b.x - a.x) + 1,
    d: Math.abs(b.z - a.z) + 1,
    tags: ['corridor'],
    lit: false,
    depth: 0,
    seed: rng.int(0, 0x7fffffff),
  };
  let carved = 0;
  const wide = rng.bool(0.18);

  const put = (x: number, z: number) => {
    if (x < 1 || z < 1 || x >= grid.w - 1 || z >= grid.d - 1) return;
    const ci = z * grid.w + x;
    if (grid.cells[ci] < 0) {
      grid.cells[ci] = id;
      carved++;
    }
  };

  const xFirst = rng.bool();
  const step = (from: number, to: number) => (from < to ? 1 : -1);
  if (xFirst) {
    for (let x = a.x; x !== b.x; x += step(a.x, b.x)) {
      put(x, a.z);
      if (wide) put(x, a.z + 1);
    }
    for (let z = a.z; z !== b.z; z += step(a.z, b.z)) {
      put(b.x, z);
      if (wide) put(b.x + 1, z);
    }
  } else {
    for (let z = a.z; z !== b.z; z += step(a.z, b.z)) {
      put(a.x, z);
      if (wide) put(a.x + 1, z);
    }
    for (let x = a.x; x !== b.x; x += step(a.x, b.x)) {
      put(x, b.z);
      if (wide) put(x, b.z + 1);
    }
  }
  put(b.x, b.z);
  if (carved > 0) rooms.push(corridor);
}

function addLoops(
  grid: LevelGrid,
  rooms: RoomSpec[],
  rng: RNG,
  loopiness: number,
  level: number,
  nextId: () => number,
): void {
  const levelRooms = rooms.filter((r) => r.level === level && !r.tags.includes('corridor'));
  const attempts = Math.round(levelRooms.length * loopiness * 1.5);
  for (let i = 0; i < attempts; i++) {
    const a = rng.pick(levelRooms);
    const b = rng.pick(levelRooms);
    if (a === b) continue;
    const ac = { x: Math.floor(a.x + a.w / 2), z: Math.floor(a.z + a.d / 2) };
    const bc = { x: Math.floor(b.x + b.w / 2), z: Math.floor(b.z + b.d / 2) };
    const dist = Math.abs(ac.x - bc.x) + Math.abs(ac.z - bc.z);
    if (dist < 4 || dist > 18) continue;
    carveCorridor(grid, ac, bc, rng, rooms, nextId, level);
  }
}

// -------------------------------------------------------------------- walls

function buildWalls(grid: LevelGrid, roomById: Map<number, RoomSpec>): void {
  for (let z = 0; z < grid.d; z++) {
    for (let x = 0; x < grid.w; x++) {
      const ci = z * grid.w + x;
      const rid = grid.cells[ci];
      if (rid < 0) continue;
      let mask = 0;
      for (let s = 0 as Side; s < 4; s++) {
        const nx = x + SIDE_DX[s];
        const nz = z + SIDE_DZ[s];
        if (!isFloor(grid, nx, nz)) {
          mask |= 1 << s;
          continue;
        }
        const nrid = grid.cells[nz * grid.w + nx];
        if (nrid === rid) continue;
        const a = roomById.get(rid);
        const b = roomById.get(nrid);
        // Corridor-to-corridor joins stay wide open; anything else needs a door.
        if (a?.tags.includes('corridor') && b?.tags.includes('corridor')) continue;
        mask |= 1 << s;
      }
      grid.walls[ci] = mask;
    }
  }
}

function placeDoors(
  grid: LevelGrid,
  roomById: Map<number, RoomSpec>,
  rng: RNG,
  powerChance: number,
  lockChance: number,
  out: DoorSpec[],
  nextId: () => number,
): void {
  // Collect every wall segment that separates two different floor regions.
  const byPair = new Map<string, { x: number; z: number; side: Side }[]>();
  for (let z = 0; z < grid.d; z++) {
    for (let x = 0; x < grid.w; x++) {
      const ci = z * grid.w + x;
      const rid = grid.cells[ci];
      if (rid < 0) continue;
      for (let s = 0 as Side; s < 4; s++) {
        const nx = x + SIDE_DX[s];
        const nz = z + SIDE_DZ[s];
        if (!isFloor(grid, nx, nz)) continue;
        const nrid = grid.cells[nz * grid.w + nx];
        if (nrid === rid) continue;
        if ((grid.walls[ci] & (1 << s)) === 0) continue;
        const key = rid < nrid ? `${rid}:${nrid}` : `${nrid}:${rid}`;
        // Store the segment once, from the lower room id's side.
        if (rid > nrid) continue;
        const list = byPair.get(key) ?? [];
        list.push({ x, z, side: s });
        byPair.set(key, list);
      }
    }
  }

  for (const [key, segments] of byPair) {
    const [aId, bId] = key.split(':').map(Number);
    const a = roomById.get(aId);
    const b = roomById.get(bId);
    if (!a || !b) continue;
    rng.shuffle(segments);
    // One doorway usually; wide junctions get two so big rooms breathe.
    const count = segments.length >= 4 && rng.bool(0.35) ? 2 : 1;
    for (let i = 0; i < Math.min(count, segments.length); i++) {
      const seg = segments[i];
      const ci = cellIndex(grid, seg.x, seg.z);
      const nx = seg.x + SIDE_DX[seg.side];
      const nz = seg.z + SIDE_DZ[seg.side];
      const nci = cellIndex(grid, nx, nz);

      let kind: DoorKind = 'open';
      const roll = rng.next();
      const bothCorridor = a.tags.includes('corridor') && b.tags.includes('corridor');
      if (!bothCorridor) {
        if (roll < lockChance) kind = 'locked';
        else if (roll < lockChance + powerChance) kind = 'powered';
        else if (roll < lockChance + powerChance + 0.42) kind = 'door';
      }

      const id = nextId();
      out.push({ id, level: grid.index, x: seg.x, z: seg.z, side: seg.side, kind });
      grid.doors[ci * 4 + seg.side] = id;
      grid.doors[nci * 4 + OPPOSITE[seg.side]] = id;
      grid.walls[ci] &= ~(1 << seg.side);
      grid.walls[nci] &= ~(1 << OPPOSITE[seg.side]);
    }
  }
}

// ---------------------------------------------------------------- entrances

function carveBorderEntrance(
  grid: LevelGrid,
  rooms: RoomSpec[],
  rng: RNG,
  used: { x: number; z: number }[],
  nextRoomId: number,
  kind: 'main' | 'fire',
): { x: number; z: number; side: Side; newRoom?: RoomSpec } | null {
  // Walk inward from a random border cell until we hit existing floor, carving
  // a stub corridor. That guarantees the door is reachable from the maze.
  for (let attempt = 0; attempt < 220; attempt++) {
    const side = rng.int(0, 3) as Side;
    let x: number;
    let z: number;
    if (side === 0) {
      x = rng.int(2, grid.w - 3);
      z = 1;
    } else if (side === 2) {
      x = rng.int(2, grid.w - 3);
      z = grid.d - 2;
    } else if (side === 1) {
      x = grid.w - 2;
      z = rng.int(2, grid.d - 3);
    } else {
      x = 1;
      z = rng.int(2, grid.d - 3);
    }
    if (used.some((u) => Math.abs(u.x - x) + Math.abs(u.z - z) < 8)) continue;

    const dx = -SIDE_DX[side];
    const dz = -SIDE_DZ[side];
    const stub: { x: number; z: number }[] = [];
    let cx = x;
    let cz = z;
    let hit = false;
    for (let step = 0; step < 12; step++) {
      if (cx < 1 || cz < 1 || cx >= grid.w - 1 || cz >= grid.d - 1) break;
      if (isFloor(grid, cx, cz)) {
        hit = true;
        break;
      }
      stub.push({ x: cx, z: cz });
      cx += dx;
      cz += dz;
    }
    if (!hit) continue;

    let newRoom: RoomSpec | undefined;
    if (stub.length > 0) {
      newRoom = {
        id: nextRoomId,
        level: grid.index,
        x: Math.min(...stub.map((s) => s.x)),
        z: Math.min(...stub.map((s) => s.z)),
        w: Math.max(1, Math.max(...stub.map((s) => s.x)) - Math.min(...stub.map((s) => s.x)) + 1),
        d: Math.max(1, Math.max(...stub.map((s) => s.z)) - Math.min(...stub.map((s) => s.z)) + 1),
        tags: [kind === 'main' ? 'entrance' : 'exit'],
        lit: kind === 'main',
        depth: 0,
        seed: rng.int(0, 0x7fffffff),
      };
      for (const c of stub) {
        const ci = cellIndex(grid, c.x, c.z);
        grid.cells[ci] = newRoom.id;
        grid.walls[ci] = 0b1111;
      }
      // Re-open the stub internally and into whatever it hit.
      for (let i = 0; i < stub.length; i++) {
        const c = stub[i];
        const ci = cellIndex(grid, c.x, c.z);
        for (let s = 0 as Side; s < 4; s++) {
          const nx2 = c.x + SIDE_DX[s];
          const nz2 = c.z + SIDE_DZ[s];
          if (!isFloor(grid, nx2, nz2)) continue;
          const nci = cellIndex(grid, nx2, nz2);
          if (grid.cells[nci] === newRoom.id || i === stub.length - 1) {
            grid.walls[ci] &= ~(1 << s);
            grid.walls[nci] &= ~(1 << OPPOSITE[s]);
          }
        }
      }
    }
    return { x, z, side, newRoom };
  }
  return null;
}

// ------------------------------------------------------------------- stairs

function findStairSpots(levels: LevelGrid[], rng: RNG, wantPerPair: number): StairSpec[] {
  const out: StairSpec[] = [];
  for (let li = 0; li < levels.length - 1; li++) {
    const upper = levels[li];
    const lower = levels[li + 1];
    const candidates: { x: number; z: number }[] = [];
    for (let z = 1; z < Math.min(upper.d, lower.d) - 1; z++) {
      for (let x = 1; x < Math.min(upper.w, lower.w) - 1; x++) {
        if (isFloor(upper, x, z) && isFloor(lower, x, z)) candidates.push({ x, z });
      }
    }
    rng.shuffle(candidates);
    const before = out.length;
    for (const c of candidates) {
      if (out.length - before >= wantPerPair) break;
      if (out.some((s) => s.level === li && Math.abs(s.x - c.x) + Math.abs(s.z - c.z) < 8)) continue;
      out.push({ id: out.length, level: li, x: c.x, z: c.z, side: rng.int(0, 3) as Side });
    }
    // A level with no stairs at all would strand everything below it.
    if (out.length === before && candidates.length > 0) {
      out.push({ id: out.length, level: li, x: candidates[0].x, z: candidates[0].z, side: 0 });
    }
  }
  return out;
}

// -------------------------------------------------------------------- depth

function computeDepth(levels: LevelGrid[], doors: DoorSpec[], stairs: StairSpec[], rooms: RoomSpec[]): void {
  const key = (l: number, x: number, z: number) => `${l},${x},${z}`;
  const dist = new Map<string, number>();
  const queue: { l: number; x: number; z: number; d: number }[] = [];
  for (const door of doors) {
    if (door.kind !== 'main' && door.kind !== 'fire') continue;
    queue.push({ l: door.level, x: door.x, z: door.z, d: 0 });
    dist.set(key(door.level, door.x, door.z), 0);
  }
  if (queue.length === 0) {
    // No entrance carved: fall back to the top-left floor cell so depth is defined.
    outer: for (let z = 0; z < levels[0].d; z++) {
      for (let x = 0; x < levels[0].w; x++) {
        if (isFloor(levels[0], x, z)) {
          queue.push({ l: 0, x, z, d: 0 });
          dist.set(key(0, x, z), 0);
          break outer;
        }
      }
    }
  }

  const stairAt = new Map<string, StairSpec>();
  for (const s of stairs) {
    stairAt.set(key(s.level, s.x, s.z), s);
    stairAt.set(key(s.level + 1, s.x, s.z), s);
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const grid = levels[cur.l];
    for (let s = 0 as Side; s < 4; s++) {
      const nx = cur.x + SIDE_DX[s];
      const nz = cur.z + SIDE_DZ[s];
      if (!isFloor(grid, nx, nz)) continue;
      const ci = cellIndex(grid, cur.x, cur.z);
      const blocked = (grid.walls[ci] & (1 << s)) !== 0 && grid.doors[ci * 4 + s] < 0;
      if (blocked) continue;
      const k = key(cur.l, nx, nz);
      if (dist.has(k)) continue;
      dist.set(k, cur.d + 1);
      queue.push({ l: cur.l, x: nx, z: nz, d: cur.d + 1 });
    }
    const stair = stairAt.get(key(cur.l, cur.x, cur.z));
    if (stair) {
      const other = cur.l === stair.level ? stair.level + 1 : stair.level;
      if (levels[other] && isFloor(levels[other], cur.x, cur.z)) {
        const k = key(other, cur.x, cur.z);
        if (!dist.has(k)) {
          dist.set(k, cur.d + 3);
          queue.push({ l: other, x: cur.x, z: cur.z, d: cur.d + 3 });
        }
      }
    }
  }

  for (const room of rooms) {
    let best = 999;
    const grid = levels[room.level];
    for (let z = room.z; z < room.z + room.d; z++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (!isFloor(grid, x, z) || grid.cells[cellIndex(grid, x, z)] !== room.id) continue;
        const v = dist.get(key(room.level, x, z));
        if (v !== undefined && v < best) best = v;
      }
    }
    room.depth = best === 999 ? 40 : best;
  }
}

function assignSpecialRooms(rooms: RoomSpec[], rng: RNG, doors: DoorSpec[], levels: LevelGrid[]): void {
  const normal = rooms.filter((r) => !r.tags.includes('corridor') && !r.tags.includes('entrance') && !r.tags.includes('exit'));
  if (normal.length === 0) return;
  const byDepth = [...normal].sort((a, b) => b.depth - a.depth);

  // The generator room sits somewhere in the middle: worth walking to.
  const mid = normal.filter((r) => r.depth > 5);
  const gen = mid.length ? rng.pick(mid) : byDepth[0];
  gen.tags = ['generator'];

  // Vaults go behind locked doors, as deep as the map allows.
  const vaultCount = Math.min(2, Math.max(1, Math.floor(normal.length / 14)));
  for (let i = 0; i < vaultCount; i++) {
    const room = byDepth[i];
    if (!room || room === gen) continue;
    room.tags = ['vault'];
    // Force at least one of its doors to be locked.
    const roomDoors = doors.filter((d) => {
      const grid = levels[d.level];
      const ci = cellIndex(grid, d.x, d.z);
      const nx = d.x + SIDE_DX[d.side];
      const nz = d.z + SIDE_DZ[d.side];
      const nci = cellIndex(grid, nx, nz);
      return grid.cells[ci] === room.id || grid.cells[nci] === room.id;
    });
    if (roomDoors.length) rng.pick(roomDoors).kind = 'locked';
  }
}

function pickBreaker(rooms: RoomSpec[], levels: LevelGrid[]): FacilityLayout['breaker'] {
  const gen = rooms.find((r) => r.tags.includes('generator'));
  if (!gen) return null;
  const grid = levels[gen.level];
  for (let z = gen.z; z < gen.z + gen.d; z++) {
    for (let x = gen.x; x < gen.x + gen.w; x++) {
      if (isFloor(grid, x, z) && grid.cells[cellIndex(grid, x, z)] === gen.id) {
        return { level: gen.level, x, z };
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ hazards

function placeHazards(
  levels: LevelGrid[],
  rooms: RoomSpec[],
  rng: RNG,
  style: InteriorStyle,
  moonHazard: number,
): HazardSpec[] {
  const out: HazardSpec[] = [];
  let id = 0;
  const budget = Math.round(6 + moonHazard * 4);
  const candidates = rooms.filter((r) => !r.tags.includes('entrance'));
  for (let i = 0; i < budget && candidates.length; i++) {
    const room = rng.pick(candidates);
    const grid = levels[room.level];
    const x = rng.int(room.x, room.x + room.w - 1);
    const z = rng.int(room.z, room.z + room.d - 1);
    if (!isFloor(grid, x, z)) continue;

    let kind: HazardSpec['kind'] = 'steam';
    const tag = room.tags[0];
    if (tag === 'generator' || tag === 'server') kind = rng.bool(0.6) ? 'electric' : 'coolant';
    else if (tag === 'machine') kind = rng.bool(0.45) ? 'crusher' : 'steam';
    else if (tag === 'pit') kind = 'pit';
    else if (style === 'mine' || style === 'sublevel') kind = rng.bool(0.5) ? 'gasleak' : 'pit';
    else kind = rng.bool(0.6) ? 'steam' : 'electric';

    out.push({
      id: id++,
      kind,
      level: room.level,
      x,
      z,
      period: kind === 'crusher' ? rng.range(3.2, 6.5) : kind === 'steam' ? rng.range(4, 9) : 0,
      phase: rng.range(0, 6),
      damage: kind === 'pit' ? 0 : kind === 'crusher' ? 100 : kind === 'electric' ? 35 : kind === 'gasleak' ? 12 : 18,
      radius: kind === 'pit' ? TILE * 0.48 : kind === 'crusher' ? 1.5 : 2.2,
    });
  }
  return out;
}

// -------------------------------------------------------------------- props

function placeProps(levels: LevelGrid[], rooms: RoomSpec[], rng: RNG, style: InteriorStyle): PropSpec[] {
  const out: PropSpec[] = [];
  for (const room of rooms) {
    const grid = levels[room.level];
    const palette = paletteFor(room.tags, style);
    if (!palette.length) continue;
    const roomRng = new RNG(room.seed);
    const cells: { x: number; z: number; freeSides: Side[] }[] = [];
    for (let z = room.z; z < room.z + room.d; z++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (!isFloor(grid, x, z) || grid.cells[cellIndex(grid, x, z)] !== room.id) continue;
        const ci = cellIndex(grid, x, z);
        const freeSides: Side[] = [];
        for (let s = 0 as Side; s < 4; s++) {
          if ((grid.walls[ci] & (1 << s)) !== 0 && grid.doors[ci * 4 + s] < 0) freeSides.push(s);
        }
        cells.push({ x, z, freeSides });
      }
    }
    if (!cells.length) continue;

    const isCorridor = room.tags.includes('corridor');
    const density = isCorridor ? 1.1 : 2.6;
    const count = Math.round(cells.length * density * roomRng.range(0.7, 1.25));

    for (let i = 0; i < count; i++) {
      const p: PropPalette = roomRng.weighted(palette, (x) => x.weight);
      if (isCorridor && p.where !== 'edge' && !roomRng.bool(0.25)) continue;
      const cell = roomRng.pick(cells);
      // Never block a doorway.
      const ci = cellIndex(grid, cell.x, cell.z);
      let nextToDoor = false;
      for (let s = 0 as Side; s < 4; s++) if (grid.doors[ci * 4 + s] >= 0) nextToDoor = true;
      if (nextToDoor && p.collide > 0 && !roomRng.bool(0.2)) continue;

      const cx = (cell.x + 0.5) * TILE;
      const cz = (cell.z + 0.5) * TILE;
      let px = cx;
      let pz = cz;
      let py = grid.baseY;
      let rotY = roomRng.range(0, Math.PI * 2);

      if (p.where === 'wall' || p.where === 'edge') {
        if (!cell.freeSides.length) continue;
        const side = roomRng.pick(cell.freeSides);
        const inset = TILE * 0.5 - Math.max(0.28, p.collide * 0.6);
        px = cx + SIDE_DX[side] * inset;
        pz = cz + SIDE_DZ[side] * inset;
        rotY = Math.atan2(-SIDE_DX[side], -SIDE_DZ[side]);
      } else if (p.where === 'corner') {
        if (cell.freeSides.length < 2) continue;
        const a = cell.freeSides[0];
        const b = cell.freeSides[1];
        px = cx + (SIDE_DX[a] + SIDE_DX[b]) * TILE * 0.32;
        pz = cz + (SIDE_DZ[a] + SIDE_DZ[b]) * TILE * 0.32;
      } else if (p.where === 'ceiling') {
        py = grid.baseY + CEIL_HEIGHT - p.fit * 0.5;
        px = cx + roomRng.range(-1, 1);
        pz = cz + roomRng.range(-1, 1);
      } else {
        px = cx + roomRng.range(-TILE * 0.28, TILE * 0.28);
        pz = cz + roomRng.range(-TILE * 0.28, TILE * 0.28);
      }

      out.push({
        model: p.model,
        level: room.level,
        px,
        py,
        pz,
        rotY,
        scale: p.fit * roomRng.range(0.9, 1.1),
        collide: p.collide,
        light: p.light,
      });
    }
  }
  return out;
}

// -------------------------------------------------------------------- scrap

function placeScrap(
  levels: LevelGrid[],
  rooms: RoomSpec[],
  rng: RNG,
  moon: MoonDef,
  weatherMult: number,
): ScrapSpawn[] {
  const total = rng.int(moon.scrap.count[0], moon.scrap.count[1]);
  const out: ScrapSpawn[] = [];
  const maxDepth = Math.max(1, ...rooms.map((r) => r.depth));

  const spots: { room: RoomSpec; x: number; z: number; weight: number; quality: number }[] = [];
  for (const room of rooms) {
    const grid = levels[room.level];
    const loot = TAG_LOOT[room.tags[0]] ?? { count: 1, quality: 1 };
    for (let z = room.z; z < room.z + room.d; z++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (!isFloor(grid, x, z) || grid.cells[cellIndex(grid, x, z)] !== room.id) continue;
        const depthFactor = 1 + (room.depth / maxDepth) * 1.6 + room.level * 0.4;
        spots.push({
          room,
          x,
          z,
          weight: loot.count * depthFactor,
          quality: loot.quality * depthFactor,
        });
      }
    }
  }
  if (!spots.length) return out;

  const pool = SCRAP;
  for (let i = 0; i < total; i++) {
    const spot = rng.weighted(spots, (s) => s.weight);
    // Quality biases toward heavy, valuable pieces the deeper you are.
    const bias = moon.scrap.richness * spot.quality;
    const def = rng.weighted(pool, (s: ScrapDef) => {
      if (s.rooms && !s.rooms.some((t) => spot.room.tags.includes(t as RoomTag))) return 0;
      if (s.moons && !s.moons.includes(moon.id)) return 0;
      const mid = (s.value[0] + s.value[1]) * 0.5;
      const richPull = 1 + bias * (mid / 120);
      return s.rarity * richPull;
    });

    const grid = levels[spot.room.level];
    const t = rng.next() ** Math.max(0.4, 1.1 - bias * 0.35);
    const raw = def.value[0] + (def.value[1] - def.value[0]) * t;
    const value = Math.max(1, Math.round(raw * moon.scrap.valueMultiplier * weatherMult));

    out.push({
      id: i,
      defId: def.id,
      level: spot.room.level,
      px: (spot.x + 0.5) * TILE + rng.range(-1.1, 1.1),
      py: grid.baseY + 0.1,
      pz: (spot.z + 0.5) * TILE + rng.range(-1.1, 1.1),
      rotY: rng.range(0, Math.PI * 2),
      value,
    });
  }
  return out;
}

function pickNests(rooms: RoomSpec[], doors: DoorSpec[], levels: LevelGrid[], rng: RNG) {
  const deadEnds = rooms
    .filter((r) => !r.tags.includes('corridor') && !r.tags.includes('entrance'))
    .sort((a, b) => b.depth - a.depth)
    .slice(0, 8);
  rng.shuffle(deadEnds);
  return deadEnds.slice(0, 3).map((r) => ({
    level: r.level,
    x: Math.floor(r.x + r.w / 2),
    z: Math.floor(r.z + r.d / 2),
  }));
}
