import type { InteriorStyle } from '../content/moons.ts';

export type Side = 0 | 1 | 2 | 3; // N(+z-) E(+x) S(+z) W(-x)
export const SIDE_DX = [0, 1, 0, -1] as const;
export const SIDE_DZ = [-1, 0, 1, 0] as const;
export const OPPOSITE: readonly Side[] = [2, 3, 0, 1];

export type RoomTag =
  | 'entrance'
  | 'exit'
  | 'hall'
  | 'storage'
  | 'machine'
  | 'office'
  | 'admin'
  | 'canteen'
  | 'washroom'
  | 'server'
  | 'maintenance'
  | 'vault'
  | 'generator'
  | 'stairwell'
  | 'pit'
  | 'dorm'
  | 'corridor';

export type DoorKind = 'open' | 'door' | 'powered' | 'locked' | 'fire' | 'main';

export interface DoorSpec {
  id: number;
  level: number;
  x: number;
  z: number;
  side: Side;
  kind: DoorKind;
  /** Fire/main exits link to an exterior anchor index. */
  exteriorAnchor?: number;
  /** Powered doors are held open while the generator runs. */
  poweredOpen?: boolean;
}

export interface RoomSpec {
  id: number;
  level: number;
  x: number;
  z: number;
  w: number;
  d: number;
  tags: RoomTag[];
  /** Working ceiling lights. Unlit rooms are genuinely black. */
  lit: boolean;
  /** Distance in cells from the nearest main entrance. Drives loot value. */
  depth: number;
  /** Deterministic per-room seed for client-side dressing. */
  seed: number;
}

export interface StairSpec {
  id: number;
  /** Upper level index. Connects level -> level + 1 in the levels array. */
  level: number;
  x: number;
  z: number;
  /** Direction you face walking down. */
  side: Side;
}

export interface HazardSpec {
  id: number;
  kind: 'steam' | 'electric' | 'pit' | 'crusher' | 'gasleak' | 'coolant';
  level: number;
  x: number;
  z: number;
  /** Cycle period for intermittent hazards, seconds. */
  period: number;
  phase: number;
  damage: number;
  radius: number;
}

export interface PropSpec {
  /** Catalog model reference. */
  model: string;
  level: number;
  /** World-space position within the cell grid, in metres. */
  px: number;
  py: number;
  pz: number;
  rotY: number;
  scale: number;
  /** Blocks movement with this radius, or 0 for decorative. */
  collide: number;
  /** Optional emissive light attached to the prop. */
  light?: { color: number; intensity: number; range: number; flicker: number };
}

export interface ScrapSpawn {
  id: number;
  defId: string;
  level: number;
  px: number;
  py: number;
  pz: number;
  rotY: number;
  value: number;
}

export interface LevelGrid {
  index: number;
  w: number;
  d: number;
  /** Base world Y for this level's floor. */
  baseY: number;
  /** cell -> room id, or -1 for solid rock. */
  cells: Int16Array;
  /** Wall bitmask per cell: bit per Side set means a solid wall on that side. */
  walls: Uint8Array;
  /** Door id per (cell, side), or -1. Flattened as cell * 4 + side. */
  doors: Int16Array;
}

export interface FacilityLayout {
  seed: number;
  style: InteriorStyle;
  levels: LevelGrid[];
  rooms: RoomSpec[];
  doors: DoorSpec[];
  stairs: StairSpec[];
  hazards: HazardSpec[];
  props: PropSpec[];
  scrap: ScrapSpawn[];
  /** Exterior door anchor positions, filled in by the exterior generator. */
  anchors: { doorId: number; kind: 'main' | 'fire' }[];
  /** Cell index of the generator room's breaker, if the layout has one. */
  breaker: { level: number; x: number; z: number } | null;
  /** Cache spots used by thief-brained creatures. */
  nests: { level: number; x: number; z: number }[];
  /** Convenience: spawn point just inside each entrance. */
  entrySpawns: { doorId: number; level: number; px: number; py: number; pz: number; rotY: number }[];
  stats: { cellCount: number; roomCount: number; scrapValue: number };
}

export const cellIndex = (level: LevelGrid, x: number, z: number) => z * level.w + x;

export function inBounds(level: LevelGrid, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < level.w && z < level.d;
}

export function isFloor(level: LevelGrid, x: number, z: number): boolean {
  return inBounds(level, x, z) && level.cells[cellIndex(level, x, z)] >= 0;
}

/** Can something walk from (x,z) across `side`? Doors count as passable. */
export function edgeOpen(level: LevelGrid, x: number, z: number, side: Side): boolean {
  if (!inBounds(level, x, z)) return false;
  const ci = cellIndex(level, x, z);
  if (level.cells[ci] < 0) return false;
  const nx = x + SIDE_DX[side];
  const nz = z + SIDE_DZ[side];
  if (!isFloor(level, nx, nz)) return false;
  if (level.doors[ci * 4 + side] >= 0) return true;
  return (level.walls[ci] & (1 << side)) === 0;
}
