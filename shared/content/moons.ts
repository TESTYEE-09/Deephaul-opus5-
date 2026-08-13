import type { WeatherId } from './weather.ts';

export type InteriorStyle = 'station' | 'factory' | 'mine' | 'sublevel';
export type BiomeId = 'ridge' | 'ash' | 'yard' | 'saltflat' | 'marsh' | 'crater' | 'bone';

export interface MoonDef {
  id: string;
  /** Catalog designation shown in the terminal, e.g. "41-RIDGE". */
  code: string;
  name: string;
  /** Route cost in credits. Free moons are the ones nobody insures. */
  cost: number;
  /** 0..5. Drives spawn budgets, quota expectations and terminal colour. */
  hazard: number;
  biome: BiomeId;
  /** One-line terminal blurb. */
  brief: string;
  /** Longer entry in the moon dossier. */
  dossier: string[];

  interior: {
    styles: InteriorStyle[];
    /** Number of grid cells the maze is allowed to occupy. */
    cells: [number, number];
    /** How aggressively the generator adds loops (0 = tree, 1 = very loopy). */
    loopiness: number;
    /** Chance a given room gets its lights working. */
    litChance: number;
    /** Chance a corridor gets a powered door / locked door respectively. */
    powerDoorChance: number;
    lockedChance: number;
  };

  exterior: {
    /** Half-extent of the playable exterior, metres. */
    size: number;
    /** Terrain roughness. */
    relief: number;
    /** How many main entrances vs fire exits. */
    mainEntrances: [number, number];
    fireExits: [number, number];
    /** Base fog density (per metre, exponential). */
    fog: number;
    /** Base ambient colour and daylight tint. */
    skyTop: number;
    skyBottom: number;
    sunColor: number;
    ambient: number;
    /** Scatter density for rocks/props, per 1000 sq metres. */
    clutter: number;
  };

  scrap: {
    /** Number of scrap pieces spawned in the facility. */
    count: [number, number];
    valueMultiplier: number;
    /** Bias toward heavier, more valuable pieces. */
    richness: number;
  };

  /** Creature power budget: the sim spends this to spawn things. */
  power: {
    indoorMax: number;
    outdoorMax: number;
    /** Seconds between spawn attempts, scaled by day progress. */
    indoorInterval: [number, number];
    outdoorInterval: [number, number];
  };

  /** Creature id -> spawn weight, split by where they live. */
  indoorPool: Record<string, number>;
  outdoorPool: Record<string, number>;

  weather: Partial<Record<WeatherId, number>>;
}

/**
 * Seven moons plus the Company depot. Ordered by how much they will kill you.
 * Route cost is deliberately steep at the top end: reaching the good moons is
 * itself a risk decision, because the credits could have been equipment.
 */
export const MOONS: MoonDef[] = [
  {
    id: 'ridge',
    code: '41-RIDGE',
    name: 'Ridge',
    cost: 0,
    hazard: 1,
    biome: 'ridge',
    brief: 'Decommissioned survey outpost. Low yield, low incident rate.',
    dossier: [
      'Contract terminated 19 cycles ago following a routine budget review.',
      'Structure remains standing. Power grid intermittent.',
      'Recommended for crews with no prior surface experience.',
    ],
    interior: { styles: ['station'], cells: [78, 104], loopiness: 0.32, litChance: 0.62, powerDoorChance: 0.14, lockedChance: 0.06 },
    exterior: { size: 130, relief: 0.55, mainEntrances: [1, 1], fireExits: [1, 2], fog: 0.006, skyTop: 0x2a3a4a, skyBottom: 0x6b6f66, sunColor: 0xbfc8cf, ambient: 0.34, clutter: 6 },
    scrap: { count: [11, 16], valueMultiplier: 1.0, richness: 0.25 },
    power: { indoorMax: 5, outdoorMax: 5, indoorInterval: [22, 12], outdoorInterval: [30, 16] },
    indoorPool: { hoarder: 2, latchbug: 3, sifter: 2, tallow: 1, gnashling: 2 },
    outdoorPool: { nightbriar: 3, drifter: 2, pack_scur: 2 },
    weather: { clear: 45, fog: 20, rain: 18, storm: 6, flare: 5, eclipsed: 6 },
  },
  {
    id: 'cinder',
    code: '13-CINDER',
    name: 'Cinder',
    cost: 0,
    hazard: 2,
    biome: 'ash',
    brief: 'Ash flats over a burnt processing line. Modest yield.',
    dossier: [
      'Fire suppression failed during evacuation. Suppression logs were not recovered.',
      'Ash accumulation reduces footing and muffles sound above ground.',
      'Several sealed sections remain unsurveyed.',
    ],
    interior: { styles: ['station', 'factory'], cells: [104, 140], loopiness: 0.38, litChance: 0.5, powerDoorChance: 0.2, lockedChance: 0.1 },
    exterior: { size: 145, relief: 0.4, mainEntrances: [1, 1], fireExits: [1, 3], fog: 0.011, skyTop: 0x3a2f2c, skyBottom: 0x7a6a5c, sunColor: 0xd8b598, ambient: 0.3, clutter: 8 },
    scrap: { count: [13, 19], valueMultiplier: 1.15, richness: 0.32 },
    power: { indoorMax: 7, outdoorMax: 6, indoorInterval: [20, 10], outdoorInterval: [28, 14] },
    indoorPool: { hoarder: 3, latchbug: 3, sifter: 3, gnashling: 3, tallow: 2, mimicdoor: 1 },
    outdoorPool: { nightbriar: 3, drifter: 3, pack_scur: 3, hauler: 1 },
    weather: { clear: 30, fog: 22, rain: 14, storm: 12, flare: 8, eclipsed: 8, flooded: 6 },
  },
  {
    id: 'halden',
    code: '77-HALDEN',
    name: 'Halden',
    cost: 30,
    hazard: 3,
    biome: 'yard',
    brief: 'Full industrial complex. High density interior. Better rates.',
    dossier: [
      'Primary reclamation site. Complex extends below survey depth.',
      'Automated systems partially online. Do not assume a door is decorative.',
      'Incident rate is within acceptable parameters for the yield band.',
    ],
    interior: { styles: ['factory', 'station'], cells: [176, 232], loopiness: 0.46, litChance: 0.44, powerDoorChance: 0.3, lockedChance: 0.16 },
    exterior: { size: 165, relief: 0.35, mainEntrances: [1, 2], fireExits: [2, 4], fog: 0.009, skyTop: 0x22262e, skyBottom: 0x585c58, sunColor: 0xa8b2b8, ambient: 0.26, clutter: 12 },
    scrap: { count: [17, 25], valueMultiplier: 1.4, richness: 0.45 },
    power: { indoorMax: 10, outdoorMax: 8, indoorInterval: [18, 8], outdoorInterval: [24, 12] },
    indoorPool: { hoarder: 3, latchbug: 3, sifter: 3, gnashling: 3, tallow: 3, mimicdoor: 2, choirman: 2, weaver: 1 },
    outdoorPool: { nightbriar: 3, drifter: 3, pack_scur: 3, hauler: 2, lumen: 1 },
    weather: { clear: 26, fog: 20, rain: 16, storm: 14, flare: 8, eclipsed: 10, flooded: 6 },
  },
  {
    id: 'vor',
    code: '08-VOR',
    name: 'Vor',
    cost: 65,
    hazard: 3,
    biome: 'crater',
    brief: 'Permanent charge in the upper atmosphere. Conductive cargo advisory.',
    dossier: [
      'Atmospheric potential does not discharge to ground on its own schedule.',
      'Employees carrying conductive salvage on the surface are the preferred path.',
      'Company advises: put the metal down, or walk faster.',
    ],
    interior: { styles: ['factory', 'sublevel'], cells: [168, 214], loopiness: 0.42, litChance: 0.36, powerDoorChance: 0.34, lockedChance: 0.18 },
    exterior: { size: 155, relief: 0.9, mainEntrances: [1, 1], fireExits: [2, 3], fog: 0.014, skyTop: 0x1c2230, skyBottom: 0x4a5060, sunColor: 0x9fb0c8, ambient: 0.22, clutter: 10 },
    scrap: { count: [16, 24], valueMultiplier: 1.55, richness: 0.5 },
    power: { indoorMax: 11, outdoorMax: 9, indoorInterval: [17, 8], outdoorInterval: [22, 11] },
    indoorPool: { hoarder: 2, latchbug: 3, gnashling: 3, tallow: 3, mimicdoor: 2, choirman: 3, weaver: 2 },
    outdoorPool: { nightbriar: 3, drifter: 2, pack_scur: 3, hauler: 2, lumen: 3 },
    weather: { storm: 42, rain: 20, clear: 10, fog: 10, flare: 8, eclipsed: 10 },
  },
  {
    id: 'marrow',
    code: '52-MARROW',
    name: 'Marrow',
    cost: 110,
    hazard: 4,
    biome: 'marsh',
    brief: 'Tidal basin. Water table rises through the working day.',
    dossier: [
      'Lower levels flood on a predictable schedule. Predictable is not the same as slow.',
      'Salvage recovered from the sublevel carries a premium.',
      'Route timing is the employee’s responsibility.',
    ],
    interior: { styles: ['sublevel', 'mine'], cells: [216, 280], loopiness: 0.5, litChance: 0.3, powerDoorChance: 0.28, lockedChance: 0.2 },
    exterior: { size: 170, relief: 0.5, mainEntrances: [1, 2], fireExits: [2, 4], fog: 0.017, skyTop: 0x1b2a2c, skyBottom: 0x4c5b52, sunColor: 0x9ab0a4, ambient: 0.2, clutter: 14 },
    scrap: { count: [20, 29], valueMultiplier: 1.75, richness: 0.58 },
    power: { indoorMax: 13, outdoorMax: 10, indoorInterval: [15, 7], outdoorInterval: [20, 10] },
    indoorPool: { latchbug: 3, gnashling: 3, tallow: 3, mimicdoor: 2, choirman: 3, weaver: 3, sifter: 2, brinehound: 3 },
    outdoorPool: { nightbriar: 3, drifter: 3, pack_scur: 3, hauler: 3, lumen: 2, brinehound: 2 },
    weather: { flooded: 40, rain: 22, fog: 14, storm: 10, clear: 4, flare: 4, eclipsed: 6 },
  },
  {
    id: 'kessel',
    code: '90-KESSEL',
    name: 'Kessel',
    cost: 210,
    hazard: 5,
    biome: 'bone',
    brief: 'Deep reclamation. Yields are exceptional. Crew retention is not.',
    dossier: [
      'Site predates Company survey. Structures were adapted, not built.',
      'Recovery rate for deployed crews sits at thirty-one percent.',
      'Yield band justifies continued operations.',
    ],
    interior: { styles: ['mine', 'sublevel', 'factory'], cells: [300, 380], loopiness: 0.55, litChance: 0.22, powerDoorChance: 0.3, lockedChance: 0.17 },
    exterior: { size: 185, relief: 1.1, mainEntrances: [1, 2], fireExits: [2, 5], fog: 0.02, skyTop: 0x18141c, skyBottom: 0x453b46, sunColor: 0x9a8ea6, ambient: 0.16, clutter: 16 },
    scrap: { count: [24, 35], valueMultiplier: 2.2, richness: 0.72 },
    power: { indoorMax: 17, outdoorMax: 13, indoorInterval: [13, 6], outdoorInterval: [17, 8] },
    indoorPool: { gnashling: 3, tallow: 3, mimicdoor: 3, choirman: 3, weaver: 3, brinehound: 2, quarryman: 3, latchbug: 2 },
    outdoorPool: { nightbriar: 3, drifter: 3, pack_scur: 3, hauler: 3, lumen: 3, colossus: 2 },
    weather: { clear: 14, fog: 18, rain: 12, storm: 14, flare: 12, eclipsed: 22, flooded: 8 },
  },
  {
    id: 'obelis',
    code: '00-OBELIS',
    name: 'Obelis',
    cost: 400,
    hazard: 5,
    biome: 'saltflat',
    brief: 'Restricted. Yield uncapped. Do not request extraction support.',
    dossier: [
      'Designation retained from a survey the Company did not commission.',
      'No crew has completed a second contract here.',
      'Salvage recovered is not catalogued. It is simply weighed and paid.',
    ],
    interior: { styles: ['sublevel', 'mine', 'station'], cells: [372, 470], loopiness: 0.6, litChance: 0.16, powerDoorChance: 0.24, lockedChance: 0.2 },
    exterior: { size: 200, relief: 0.3, mainEntrances: [1, 1], fireExits: [2, 5], fog: 0.024, skyTop: 0x120f14, skyBottom: 0x3a3438, sunColor: 0x8e8896, ambient: 0.12, clutter: 9 },
    scrap: { count: [28, 42], valueMultiplier: 2.8, richness: 0.85 },
    power: { indoorMax: 22, outdoorMax: 17, indoorInterval: [11, 5], outdoorInterval: [14, 7] },
    indoorPool: { gnashling: 3, tallow: 3, mimicdoor: 3, choirman: 4, weaver: 3, quarryman: 3, brinehound: 2, hollow: 3 },
    outdoorPool: { nightbriar: 2, drifter: 3, pack_scur: 2, hauler: 3, lumen: 3, colossus: 4, hollow: 2 },
    weather: { eclipsed: 34, flare: 18, fog: 16, storm: 12, clear: 6, rain: 8, flooded: 6 },
  },
];

export const MOONS_BY_ID = new Map(MOONS.map((m) => [m.id, m]));

export function moonById(id: string): MoonDef {
  const m = MOONS_BY_ID.get(id);
  if (!m) throw new Error(`unknown moon: ${id}`);
  return m;
}

/** The Company depot. Not a moon: no facility, no creatures, no clock pressure. */
export const COMPANY = {
  id: 'company',
  code: '71-GORDION',
  name: 'Company Depot',
  brief: 'Sale point. Deliver salvage to the counter. Do not linger.',
} as const;
