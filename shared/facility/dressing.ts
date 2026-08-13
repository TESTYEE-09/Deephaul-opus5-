import type { InteriorStyle } from '../content/moons.ts';
import type { RoomTag } from './types.ts';

/**
 * Prop palettes. `where` decides how the placer positions a piece:
 *   wall    - flush against a wall, facing inward
 *   corner  - tucked into a room corner
 *   floor   - anywhere on the floor with clearance
 *   ceiling - hung from the ceiling
 *   edge    - along a corridor wall, small footprint
 */
export interface PropPalette {
  model: string;
  fit: number;
  where: 'wall' | 'corner' | 'floor' | 'ceiling' | 'edge';
  weight: number;
  /** Collision radius in metres; 0 = walk through it. */
  collide: number;
  light?: { color: number; intensity: number; range: number; flicker: number };
}

const STATION = 'kit.station';
const FACTORY = 'kit.factory';
const SCIFI = 'kit.scifi';
const HOUSE = 'prop.house';
const CYBER = 'prop.cyber';
const MARKET = 'prop.market';
const SURV = 'ext.survival';
const DUNGEON = 'kit.dungeon';

/** Shared industrial noise that suits any room in any facility style. */
const COMMON: PropPalette[] = [
  { model: `${STATION}/pipe`, fit: 3.2, where: 'wall', weight: 8, collide: 0 },
  { model: `${STATION}/pipe-bend`, fit: 2.2, where: 'corner', weight: 5, collide: 0 },
  { model: `${SCIFI}/Details_Pipes_Medium`, fit: 2.6, where: 'wall', weight: 6, collide: 0 },
  { model: `${SCIFI}/Details_Vent_2`, fit: 1.0, where: 'wall', weight: 6, collide: 0 },
  { model: `${SCIFI}/Details_Plate_Long`, fit: 2.2, where: 'wall', weight: 4, collide: 0 },
  { model: `${CYBER}/Cable_Thick`, fit: 2.6, where: 'wall', weight: 5, collide: 0 },
  { model: `${CYBER}/Support`, fit: 3.0, where: 'corner', weight: 4, collide: 0.3 },
  { model: `${STATION}/rocks`, fit: 1.0, where: 'floor', weight: 3, collide: 0 },
  { model: `${FACTORY}/warning-orange`, fit: 1.0, where: 'wall', weight: 4, collide: 0 },
  { model: `${FACTORY}/cog-c`, fit: 0.9, where: 'floor', weight: 3, collide: 0 },
];

export const ROOM_PALETTES: Record<RoomTag, PropPalette[]> = {
  entrance: [
    { model: `${FACTORY}/structure-doorway-wide`, fit: 3.4, where: 'wall', weight: 4, collide: 0 },
    { model: `${STATION}/container`, fit: 1.6, where: 'wall', weight: 8, collide: 0.8 },
    { model: `${FACTORY}/screen-hanging-wide`, fit: 1.8, where: 'ceiling', weight: 5, collide: 0, light: { color: 0x66ccaa, intensity: 0.6, range: 6, flicker: 0.2 } },
    { model: `${CYBER}/Sign_Corner_Hazard`, fit: 1.2, where: 'wall', weight: 6, collide: 0 },
    { model: `${FACTORY}/indicator-special-lines`, fit: 3.6, where: 'floor', weight: 4, collide: 0 },
  ],
  exit: [
    { model: `${CYBER}/Sign_2`, fit: 1.2, where: 'wall', weight: 8, collide: 0 },
    { model: `${STATION}/container-flat`, fit: 1.4, where: 'wall', weight: 5, collide: 0.7 },
    { model: `${FACTORY}/warning-traffic`, fit: 1.1, where: 'wall', weight: 6, collide: 0 },
  ],
  hall: [
    { model: `${FACTORY}/pipe-large-long`, fit: 4.0, where: 'ceiling', weight: 8, collide: 0 },
    { model: `${FACTORY}/catwalk-straight`, fit: 4.0, where: 'ceiling', weight: 5, collide: 0 },
    { model: `${STATION}/structure-barrier`, fit: 2.0, where: 'floor', weight: 5, collide: 0.5 },
    { model: `${CYBER}/Support_Long`, fit: 3.4, where: 'corner', weight: 6, collide: 0.35 },
    { model: `${FACTORY}/crane`, fit: 4.5, where: 'ceiling', weight: 2, collide: 0 },
  ],
  storage: [
    { model: `${STATION}/container-tall`, fit: 2.4, where: 'wall', weight: 12, collide: 0.9 },
    { model: `${STATION}/container-wide`, fit: 2.2, where: 'wall', weight: 10, collide: 1.0 },
    { model: `${STATION}/container`, fit: 1.6, where: 'floor', weight: 10, collide: 0.8 },
    { model: `${FACTORY}/box-large`, fit: 1.3, where: 'floor', weight: 10, collide: 0.6 },
    { model: `${FACTORY}/box-long`, fit: 1.5, where: 'floor', weight: 8, collide: 0.6 },
    { model: `${SCIFI}/Props_Shelf_Tall`, fit: 2.6, where: 'wall', weight: 9, collide: 0.5 },
    { model: `${MARKET}/shelf-boxes`, fit: 2.0, where: 'wall', weight: 7, collide: 0.6 },
    { model: `${SURV}/box-large-open`, fit: 1.2, where: 'floor', weight: 6, collide: 0.5 },
  ],
  machine: [
    { model: `${FACTORY}/machine`, fit: 2.6, where: 'wall', weight: 10, collide: 1.1 },
    { model: `${FACTORY}/machine-window`, fit: 2.6, where: 'wall', weight: 8, collide: 1.1 },
    { model: `${FACTORY}/hopper-round`, fit: 3.0, where: 'corner', weight: 6, collide: 1.0 },
    { model: `${FACTORY}/conveyor-long`, fit: 4.0, where: 'floor', weight: 7, collide: 0.7 },
    { model: `${FACTORY}/piston-round`, fit: 2.4, where: 'wall', weight: 6, collide: 0.6 },
    { model: `${FACTORY}/robot-arm-a`, fit: 2.4, where: 'floor', weight: 4, collide: 0.6 },
    { model: `${FACTORY}/pipe-large-valve`, fit: 2.0, where: 'wall', weight: 6, collide: 0.4 },
    { model: `${FACTORY}/scanner-high`, fit: 3.0, where: 'floor', weight: 3, collide: 0.8, light: { color: 0xff6644, intensity: 0.8, range: 5, flicker: 0.5 } },
  ],
  office: [
    { model: `${HOUSE}/Drawer_2`, fit: 1.2, where: 'wall', weight: 9, collide: 0.6 },
    { model: `${HOUSE}/Shelf_Large`, fit: 2.0, where: 'wall', weight: 8, collide: 0.5 },
    { model: `${HOUSE}/Chair_2`, fit: 1.0, where: 'floor', weight: 8, collide: 0.35 },
    { model: `${STATION}/table`, fit: 1.8, where: 'floor', weight: 8, collide: 0.7 },
    { model: `${STATION}/computer-wide`, fit: 1.2, where: 'wall', weight: 7, collide: 0.4, light: { color: 0x5588ff, intensity: 0.5, range: 4, flicker: 0.35 } },
    { model: `${HOUSE}/Bookshelf`, fit: 2.2, where: 'wall', weight: 6, collide: 0.6 },
    { model: `${HOUSE}/Houseplant_5`, fit: 1.2, where: 'corner', weight: 5, collide: 0.3 },
    { model: `${HOUSE}/Trashcan_Small1`, fit: 0.6, where: 'corner', weight: 6, collide: 0.25 },
  ],
  admin: [
    { model: `${STATION}/display-wall-wide`, fit: 2.4, where: 'wall', weight: 8, collide: 0, light: { color: 0x44ddcc, intensity: 0.7, range: 5, flicker: 0.3 } },
    { model: `${STATION}/table-large`, fit: 2.6, where: 'floor', weight: 7, collide: 0.9 },
    { model: `${HOUSE}/Chair_4`, fit: 1.0, where: 'floor', weight: 8, collide: 0.35 },
    { model: `${CYBER}/Computer_Large`, fit: 1.8, where: 'wall', weight: 6, collide: 0.7 },
    { model: `${HOUSE}/Light_Chandelier`, fit: 1.2, where: 'ceiling', weight: 2, collide: 0, light: { color: 0xffddaa, intensity: 1.0, range: 8, flicker: 0.1 } },
  ],
  canteen: [
    { model: `${HOUSE}/Kitchen_Fridge`, fit: 2.0, where: 'wall', weight: 6, collide: 0.7 },
    { model: `${HOUSE}/Kitchen_Oven_Large`, fit: 1.6, where: 'wall', weight: 5, collide: 0.7 },
    { model: `${HOUSE}/Table_RoundLarge`, fit: 1.8, where: 'floor', weight: 8, collide: 0.8 },
    { model: `${HOUSE}/Chair_1`, fit: 1.0, where: 'floor', weight: 10, collide: 0.35 },
    { model: `${HOUSE}/Kitchen_Sink`, fit: 1.4, where: 'wall', weight: 5, collide: 0.6 },
    { model: `${MARKET}/freezers-standing`, fit: 2.2, where: 'wall', weight: 4, collide: 0.8 },
  ],
  washroom: [
    { model: `${HOUSE}/Bathroom_Sink`, fit: 1.0, where: 'wall', weight: 9, collide: 0.4 },
    { model: `${HOUSE}/Bathroom_Toilet2`, fit: 1.0, where: 'wall', weight: 8, collide: 0.4 },
    { model: `${HOUSE}/Bathroom_Shower1`, fit: 2.0, where: 'corner', weight: 6, collide: 0.5 },
    { model: `${HOUSE}/Bathroom_Mirror2`, fit: 1.0, where: 'wall', weight: 6, collide: 0 },
  ],
  server: [
    { model: `${SCIFI}/Props_Computer`, fit: 2.2, where: 'wall', weight: 12, collide: 0.7, light: { color: 0x44ff99, intensity: 0.4, range: 4, flicker: 0.6 } },
    { model: `${CYBER}/Computer_Large`, fit: 2.0, where: 'floor', weight: 9, collide: 0.7 },
    { model: `${SCIFI}/Props_Capsule`, fit: 2.2, where: 'floor', weight: 5, collide: 0.6 },
    { model: `${CYBER}/Cable_Long`, fit: 3.0, where: 'ceiling', weight: 8, collide: 0 },
    { model: `${STATION}/computer-system`, fit: 1.6, where: 'wall', weight: 8, collide: 0.5 },
  ],
  maintenance: [
    { model: `${FACTORY}/pipe-large-junction`, fit: 3.0, where: 'wall', weight: 9, collide: 0.5 },
    { model: `${FACTORY}/pipe-large-bend`, fit: 2.6, where: 'corner', weight: 8, collide: 0.4 },
    { model: `${SURV}/workbench`, fit: 1.8, where: 'wall', weight: 6, collide: 0.7 },
    { model: `${SURV}/barrel`, fit: 1.1, where: 'floor', weight: 9, collide: 0.45 },
    { model: `${SURV}/bucket`, fit: 0.5, where: 'floor', weight: 7, collide: 0 },
    { model: `${FACTORY}/lever-double`, fit: 1.0, where: 'wall', weight: 5, collide: 0 },
    { model: `${SCIFI}/Details_Output`, fit: 1.2, where: 'wall', weight: 6, collide: 0 },
  ],
  vault: [
    { model: `${SCIFI}/Props_Chest`, fit: 1.4, where: 'floor', weight: 10, collide: 0.6 },
    { model: `${SCIFI}/Props_ContainerFull`, fit: 1.8, where: 'wall', weight: 9, collide: 0.7 },
    { model: `${DUNGEON}/Pedestal`, fit: 1.2, where: 'floor', weight: 6, collide: 0.4 },
    { model: `${SCIFI}/Props_Statue`, fit: 2.6, where: 'corner', weight: 3, collide: 0.6 },
    { model: `${STATION}/table-display`, fit: 1.6, where: 'floor', weight: 6, collide: 0.6, light: { color: 0xffcc66, intensity: 0.6, range: 4, flicker: 0.05 } },
  ],
  generator: [
    { model: `${FACTORY}/machine-fortified`, fit: 3.2, where: 'wall', weight: 10, collide: 1.2 },
    { model: `${FACTORY}/hopper-high-square`, fit: 3.6, where: 'corner', weight: 6, collide: 1.0 },
    { model: `${FACTORY}/pipe-large-bump`, fit: 3.0, where: 'wall', weight: 8, collide: 0.5 },
    { model: `${CYBER}/Tank`, fit: 2.4, where: 'corner', weight: 6, collide: 0.8 },
    { model: `${FACTORY}/lever-single`, fit: 1.0, where: 'wall', weight: 6, collide: 0 },
  ],
  stairwell: [
    { model: `${STATION}/rail`, fit: 2.0, where: 'wall', weight: 8, collide: 0 },
    { model: `${CYBER}/Support_Long`, fit: 3.4, where: 'corner', weight: 6, collide: 0.3 },
    { model: `${SCIFI}/Details_Plate_Small`, fit: 1.2, where: 'wall', weight: 5, collide: 0 },
  ],
  pit: [
    { model: `${STATION}/rail-narrow`, fit: 2.0, where: 'wall', weight: 10, collide: 0 },
    { model: `${FACTORY}/warning-traffic`, fit: 1.0, where: 'wall', weight: 8, collide: 0 },
    { model: `${CYBER}/Rail_Long`, fit: 3.0, where: 'wall', weight: 7, collide: 0 },
  ],
  dorm: [
    { model: `${STATION}/bed-single`, fit: 2.0, where: 'wall', weight: 10, collide: 0.7 },
    { model: `${HOUSE}/Bed_Bunk`, fit: 2.4, where: 'wall', weight: 6, collide: 0.9 },
    { model: `${HOUSE}/NightStand_2`, fit: 0.8, where: 'wall', weight: 7, collide: 0.3 },
    { model: `${STATION}/container-flat`, fit: 1.2, where: 'floor', weight: 6, collide: 0.5 },
    { model: `${HOUSE}/Carpet_2`, fit: 2.4, where: 'floor', weight: 4, collide: 0 },
  ],
  corridor: [
    { model: `${SCIFI}/Details_Pipes_Small`, fit: 1.8, where: 'edge', weight: 10, collide: 0 },
    { model: `${SCIFI}/Details_Vent_4`, fit: 0.9, where: 'edge', weight: 8, collide: 0 },
    { model: `${CYBER}/Cable_Small`, fit: 1.6, where: 'edge', weight: 7, collide: 0 },
    { model: `${FACTORY}/arrow`, fit: 1.0, where: 'edge', weight: 5, collide: 0 },
    { model: `${STATION}/wall-switch`, fit: 0.5, where: 'edge', weight: 5, collide: 0 },
    { model: `${SURV}/barrel-open`, fit: 1.0, where: 'edge', weight: 4, collide: 0.4 },
  ],
};

/** Extra flavour layered on by facility style. */
export const STYLE_PALETTES: Record<InteriorStyle, PropPalette[]> = {
  station: [
    { model: `${STATION}/structure-panel`, fit: 2.4, where: 'wall', weight: 6, collide: 0 },
    { model: `${SCIFI}/Details_Hexagon`, fit: 1.0, where: 'wall', weight: 4, collide: 0 },
  ],
  factory: [
    { model: `${FACTORY}/top-large-checkerboard`, fit: 3.8, where: 'ceiling', weight: 5, collide: 0 },
    { model: `${FACTORY}/conveyor-bars`, fit: 3.6, where: 'floor', weight: 5, collide: 0.5 },
    { model: `${FACTORY}/cog-a`, fit: 1.4, where: 'wall', weight: 4, collide: 0 },
  ],
  mine: [
    { model: `${SURV}/rock-a`, fit: 1.4, where: 'floor', weight: 9, collide: 0.5 },
    { model: `${SURV}/rock-b`, fit: 1.0, where: 'corner', weight: 8, collide: 0.4 },
    { model: `${SURV}/resource-stone`, fit: 0.8, where: 'floor', weight: 6, collide: 0 },
    { model: `${SURV}/tree-log`, fit: 2.2, where: 'wall', weight: 4, collide: 0.5 },
  ],
  sublevel: [
    { model: `${DUNGEON}/Cobweb`, fit: 1.6, where: 'corner', weight: 8, collide: 0 },
    { model: `${DUNGEON}/Barrel`, fit: 1.0, where: 'floor', weight: 7, collide: 0.45 },
    { model: `${DUNGEON}/Crate`, fit: 1.0, where: 'floor', weight: 7, collide: 0.45 },
    { model: `${DUNGEON}/Column`, fit: 3.2, where: 'corner', weight: 5, collide: 0.5 },
  ],
};

export function paletteFor(tags: RoomTag[], style: InteriorStyle): PropPalette[] {
  const out: PropPalette[] = [...COMMON, ...(STYLE_PALETTES[style] ?? [])];
  for (const tag of tags) out.push(...(ROOM_PALETTES[tag] ?? []));
  return out;
}

/** Ceiling light fixture per style, used when a room has working power. */
export const CEILING_LIGHTS: Record<InteriorStyle, { model: string; fit: number }> = {
  station: { model: `${STATION}/floor-detail`, fit: 1.2 },
  factory: { model: `${FACTORY}/screen-panel-flat`, fit: 1.4 },
  mine: { model: `${SURV}/campfire-stand`, fit: 0.9 },
  sublevel: { model: `${DUNGEON}/Torch`, fit: 0.9 },
};
