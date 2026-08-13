import type { RNG } from '../rng.ts';

export type WeatherId =
  | 'clear'
  | 'fog'
  | 'rain'
  | 'storm'
  | 'flooded'
  | 'flare'
  | 'eclipsed';

export interface WeatherDef {
  id: WeatherId;
  name: string;
  /** Shown on the terminal next to the moon name. */
  short: string;
  description: string;
  /** Terminal colour cue: 0 nominal, 1 caution, 2 hazard. */
  severity: 0 | 1 | 2;
  /** Multiplies exterior fog density. */
  fogMultiplier: number;
  /** Multiplies outdoor ambient light. */
  lightMultiplier: number;
  /** Scales the exterior creature power budget. */
  outdoorPowerMultiplier: number;
  /** Scales the indoor creature power budget. */
  indoorPowerMultiplier: number;
  /** Scales how fast creature spawn pressure ramps across the day. */
  dangerRampMultiplier: number;
  /** Extra scrap spawned - the Company pays hazard rates for a reason. */
  scrapValueMultiplier: number;
  /** Landing fee discount/premium applied to the moon's route cost. */
  routeCostMultiplier: number;
  flags: {
    lightning?: boolean;
    /** Water level rises over the day on the exterior and lower interior. */
    rising?: boolean;
    /** Radio and radar degrade badly. */
    interference?: boolean;
    /** Everything outdoors is hunting from the moment you land. */
    permanentNight?: boolean;
    /** Ground turns to mud: slower movement outdoors. */
    mud?: boolean;
    precipitation?: 'rain' | 'ash' | 'none';
  };
}

export const WEATHER: Record<WeatherId, WeatherDef> = {
  clear: {
    id: 'clear',
    name: 'Clear',
    short: 'CLR',
    description: 'Nominal conditions. No excuse for a bad haul.',
    severity: 0,
    fogMultiplier: 1,
    lightMultiplier: 1,
    outdoorPowerMultiplier: 1,
    indoorPowerMultiplier: 1,
    dangerRampMultiplier: 1,
    scrapValueMultiplier: 1,
    routeCostMultiplier: 1,
    flags: { precipitation: 'none' },
  },
  fog: {
    id: 'fog',
    name: 'Dense Fog',
    short: 'FOG',
    description: 'Visibility under twenty metres. Stay in earshot.',
    severity: 1,
    fogMultiplier: 3.6,
    lightMultiplier: 0.8,
    outdoorPowerMultiplier: 1.15,
    indoorPowerMultiplier: 1,
    dangerRampMultiplier: 1.1,
    scrapValueMultiplier: 1.1,
    routeCostMultiplier: 1,
    flags: { precipitation: 'none' },
  },
  rain: {
    id: 'rain',
    name: 'Rainfall',
    short: 'RAIN',
    description: 'Persistent rain. Ground is going soft. Sound carries badly.',
    severity: 1,
    fogMultiplier: 1.8,
    lightMultiplier: 0.72,
    outdoorPowerMultiplier: 1.05,
    indoorPowerMultiplier: 1,
    dangerRampMultiplier: 1,
    scrapValueMultiplier: 1.05,
    routeCostMultiplier: 1,
    flags: { precipitation: 'rain', mud: true },
  },
  storm: {
    id: 'storm',
    name: 'Electrical Storm',
    short: 'STRM',
    description: 'Charged cells overhead. Conductive cargo attracts strikes.',
    severity: 2,
    fogMultiplier: 2.2,
    lightMultiplier: 0.55,
    outdoorPowerMultiplier: 1.2,
    indoorPowerMultiplier: 1.05,
    dangerRampMultiplier: 1.15,
    scrapValueMultiplier: 1.25,
    routeCostMultiplier: 1,
    flags: { precipitation: 'rain', mud: true, lightning: true },
  },
  flooded: {
    id: 'flooded',
    name: 'Tidal Flooding',
    short: 'FLD',
    description: 'Water table rising through the day. Low ground will not stay walkable.',
    severity: 2,
    fogMultiplier: 2.4,
    lightMultiplier: 0.7,
    outdoorPowerMultiplier: 1.1,
    indoorPowerMultiplier: 1.1,
    dangerRampMultiplier: 1.05,
    scrapValueMultiplier: 1.3,
    routeCostMultiplier: 1,
    flags: { precipitation: 'rain', rising: true },
  },
  flare: {
    id: 'flare',
    name: 'Solar Flare',
    short: 'FLR',
    description: 'Ionised sky. Radar and radio are effectively useless today.',
    severity: 2,
    fogMultiplier: 1.2,
    lightMultiplier: 1.15,
    outdoorPowerMultiplier: 1.25,
    indoorPowerMultiplier: 1.15,
    dangerRampMultiplier: 1.2,
    scrapValueMultiplier: 1.35,
    routeCostMultiplier: 1,
    flags: { interference: true, precipitation: 'none' },
  },
  eclipsed: {
    id: 'eclipsed',
    name: 'Eclipse',
    short: 'ECL',
    description: 'No daylight cycle. Everything outside is awake and it is awake now.',
    severity: 2,
    fogMultiplier: 2.0,
    lightMultiplier: 0.14,
    outdoorPowerMultiplier: 3.2,
    indoorPowerMultiplier: 1.35,
    dangerRampMultiplier: 2.4,
    scrapValueMultiplier: 1.6,
    routeCostMultiplier: 1,
    flags: { permanentNight: true, precipitation: 'none' },
  },
};

export const WEATHER_IDS = Object.keys(WEATHER) as WeatherId[];

/**
 * Rolls tomorrow's weather for each moon. Weights come from the moon so a
 * "storm moon" really is stormy most of the time, but nowhere is ever safe.
 */
export function rollWeather(rng: RNG, weights: Partial<Record<WeatherId, number>>): WeatherId {
  const entries = WEATHER_IDS.map((id) => ({ id, w: weights[id] ?? 0 }));
  const total = entries.reduce((s, e) => s + e.w, 0);
  if (total <= 0) return 'clear';
  let roll = rng.next() * total;
  for (const e of entries) {
    roll -= e.w;
    if (roll <= 0) return e.id;
  }
  return 'clear';
}

/** Water height in metres above the exterior base plane, 0..1 day progress. */
export function floodLevel(weather: WeatherId, dayProgress: number): number {
  if (!WEATHER[weather].flags.rising) return -99;
  // Starts as ankle-deep puddles and ends chest-deep in the low ground.
  return -0.4 + dayProgress * 2.6;
}
