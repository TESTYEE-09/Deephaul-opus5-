import { RNG, fbm2D, hashInts } from '../rng.ts';
import { clamp, smoothstep } from '../math.ts';
import type { BiomeId, MoonDef } from '../content/moons.ts';
import { WEATHER, type WeatherId } from '../content/weather.ts';
import type { FacilityLayout } from '../facility/types.ts';

export interface ExteriorProp {
  model: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  collide: number;
}

export interface EntranceStructure {
  /** Index into layout.anchors. */
  anchor: number;
  kind: 'main' | 'fire';
  x: number;
  z: number;
  y: number;
  /** Facing direction in radians; the door faces this way. */
  rotY: number;
  /** Building shell model, or null for a bare hatch. */
  model: string | null;
  scale: number;
}

export interface ExteriorLayout {
  seed: number;
  size: number;
  /** Ship landing pad centre. */
  ship: { x: number; y: number; z: number; rotY: number };
  entrances: EntranceStructure[];
  props: ExteriorProp[];
  /** Terrain sampling parameters, shared so client and server agree exactly. */
  terrain: { seed: number; relief: number; scale: number; amplitude: number };
  /** Flat radius around the ship and each entrance, in metres. */
  padRadius: number;
  /** Static water plane height, or null when the moon is dry. */
  waterBase: number | null;
}

const BIOME_PROPS: Record<BiomeId, { model: string; fit: number; weight: number; collide: number }[]> = {
  ridge: [
    { model: 'ext.survival/rock-a', fit: 2.4, weight: 14, collide: 1.2 },
    { model: 'ext.survival/rock-b', fit: 1.8, weight: 12, collide: 0.9 },
    { model: 'ext.survival/rock-c', fit: 1.4, weight: 10, collide: 0.7 },
    { model: 'ext.survival/rock-flat', fit: 2.2, weight: 8, collide: 0 },
    { model: 'ext.nature/CommonTree_Dead_1', fit: 6.0, weight: 7, collide: 0.6 },
    { model: 'ext.nature/CommonTree_Dead_3', fit: 5.4, weight: 6, collide: 0.6 },
    { model: 'ext.survival/tree-trunk', fit: 3.0, weight: 5, collide: 0.6 },
    { model: 'ext.survival/patch-grass', fit: 1.4, weight: 9, collide: 0 },
  ],
  ash: [
    { model: 'ext.nature/CommonTree_Dead_2', fit: 5.6, weight: 12, collide: 0.6 },
    { model: 'ext.nature/BirchTree_Dead_1', fit: 6.2, weight: 10, collide: 0.6 },
    { model: 'ext.survival/rock-sand-a', fit: 2.0, weight: 12, collide: 1.0 },
    { model: 'ext.survival/rock-sand-b', fit: 1.6, weight: 10, collide: 0.8 },
    { model: 'ext.survival/tree-log', fit: 3.2, weight: 6, collide: 0.5 },
    { model: 'ext.survival/campfire-pit', fit: 1.4, weight: 3, collide: 0 },
  ],
  yard: [
    { model: 'ext.industrial/detail-tank', fit: 6.0, weight: 8, collide: 2.4 },
    { model: 'ext.industrial/chimney-small', fit: 9.0, weight: 5, collide: 1.6 },
    { model: 'ext.street/Streetlight_Single', fit: 6.5, weight: 7, collide: 0.4 },
    { model: 'ext.street/Sign_Triangle', fit: 2.4, weight: 6, collide: 0.2 },
    { model: 'ext.survival/box-large', fit: 1.6, weight: 10, collide: 0.8 },
    { model: 'ext.survival/barrel', fit: 1.2, weight: 12, collide: 0.5 },
    { model: 'ext.survival/metal-panel', fit: 2.4, weight: 8, collide: 0 },
    { model: 'ext.survival/fence', fit: 2.6, weight: 9, collide: 0.4 },
  ],
  saltflat: [
    { model: 'ext.survival/rock-flat', fit: 3.0, weight: 14, collide: 0 },
    { model: 'ext.survival/rock-sand-c', fit: 1.6, weight: 10, collide: 0.7 },
    { model: 'ext.nature/CommonTree_Dead_5', fit: 5.0, weight: 4, collide: 0.6 },
    { model: 'ext.graveyard/pillar-obelisk', fit: 5.0, weight: 4, collide: 0.8 },
  ],
  marsh: [
    { model: 'ext.nature/CommonTree_Dead_4', fit: 6.4, weight: 11, collide: 0.6 },
    { model: 'ext.nature/Bush_2', fit: 1.6, weight: 12, collide: 0 },
    { model: 'ext.survival/patch-grass-large', fit: 2.4, weight: 14, collide: 0 },
    { model: 'ext.survival/rock-flat-grass', fit: 2.4, weight: 9, collide: 0.8 },
    { model: 'ext.survival/tree-log-small', fit: 2.2, weight: 7, collide: 0.5 },
  ],
  crater: [
    { model: 'ext.survival/rock-a', fit: 3.2, weight: 16, collide: 1.4 },
    { model: 'ext.survival/rock-b', fit: 2.4, weight: 14, collide: 1.0 },
    { model: 'ext.survival/resource-stone-large', fit: 2.0, weight: 8, collide: 0.9 },
    { model: 'ext.street/Streetlight_Double', fit: 7.0, weight: 3, collide: 0.4 },
    { model: 'ext.industrial/detail-tank', fit: 5.5, weight: 4, collide: 2.2 },
  ],
  bone: [
    { model: 'ext.graveyard/gravestone-cross', fit: 1.6, weight: 12, collide: 0.35 },
    { model: 'ext.graveyard/gravestone-roof', fit: 1.8, weight: 10, collide: 0.35 },
    { model: 'ext.graveyard/crypt-small', fit: 4.0, weight: 5, collide: 1.6 },
    { model: 'ext.graveyard/iron-fence-bar', fit: 2.0, weight: 9, collide: 0.2 },
    { model: 'ext.graveyard/column-large', fit: 5.0, weight: 5, collide: 0.9 },
    { model: 'ext.nature/CommonTree_Dead_2', fit: 6.0, weight: 8, collide: 0.6 },
    { model: 'ext.survival/rock-b', fit: 2.0, weight: 8, collide: 0.9 },
  ],
};

/** Buildings used as the visible shell around a facility entrance. */
const ENTRANCE_SHELLS: Record<'main' | 'fire', { model: string; fit: number }[]> = {
  main: [
    { model: 'ext.industrial/building-c', fit: 18 },
    { model: 'ext.industrial/building-h', fit: 20 },
    { model: 'ext.industrial/building-m', fit: 17 },
    { model: 'ext.industrial/building-q', fit: 19 },
  ],
  fire: [
    { model: 'ext.survival/structure-metal', fit: 4.5 },
    { model: 'ext.survival/structure-metal-doorway', fit: 4.5 },
    { model: 'ext.industrial/building-a', fit: 8 },
  ],
};

export interface ExteriorOptions {
  seed: number;
  moon: MoonDef;
  weather: WeatherId;
  layout: FacilityLayout;
}

export function generateExterior(opts: ExteriorOptions): ExteriorLayout {
  const { moon, weather, layout } = opts;
  const r = new RNG(hashInts(opts.seed, 0x51de));
  const size = moon.exterior.size;
  const terrain = {
    seed: hashInts(opts.seed, 0x7e44),
    relief: moon.exterior.relief,
    scale: 0.008,
    amplitude: 16 * moon.exterior.relief,
  };

  const ship = { x: 0, y: 0, z: 0, rotY: r.range(0, Math.PI * 2) };
  const padRadius = 14;

  // Facility sits at a walkable but meaningful distance. Too close and there is
  // no journey; too far and every trip is a chore.
  const facilityAngle = r.range(0, Math.PI * 2);
  const facilityDist = r.range(size * 0.42, size * 0.62);
  const facility = {
    x: Math.cos(facilityAngle) * facilityDist,
    z: Math.sin(facilityAngle) * facilityDist,
  };

  const entrances: EntranceStructure[] = [];
  for (let i = 0; i < layout.anchors.length; i++) {
    const anchor = layout.anchors[i];
    let x: number;
    let z: number;
    if (anchor.kind === 'main') {
      x = facility.x + r.range(-8, 8);
      z = facility.z + r.range(-8, 8);
    } else {
      // Fire exits ring the facility at varying distance, which is what makes
      // "we came out the wrong door" a survivable mistake instead of a fatal one.
      const a = r.range(0, Math.PI * 2);
      const d = r.range(26, 62);
      x = facility.x + Math.cos(a) * d;
      z = facility.z + Math.sin(a) * d;
    }
    x = clamp(x, -size + 20, size - 20);
    z = clamp(z, -size + 20, size - 20);
    const shell = r.pick(ENTRANCE_SHELLS[anchor.kind]);
    entrances.push({
      anchor: i,
      kind: anchor.kind,
      x,
      z,
      y: 0,
      rotY: Math.atan2(ship.x - x, ship.z - z) + r.range(-0.5, 0.5),
      model: shell.model,
      scale: shell.fit,
    });
  }

  // Terrain heights are resolved after placement so pads sit on real ground.
  const flatSpots = [
    { x: ship.x, z: ship.z, radius: padRadius },
    ...entrances.map((e) => ({ x: e.x, z: e.z, radius: 11 })),
  ];
  const sample = (x: number, z: number) => sampleTerrain(x, z, terrain, flatSpots);
  ship.y = sample(ship.x, ship.z);
  for (const e of entrances) e.y = sample(e.x, e.z);

  // ------------------------------------------------------------------- props
  const props: ExteriorProp[] = [];
  const palette = BIOME_PROPS[moon.biome];
  const area = (size * 2) ** 2;
  const count = Math.round((area / 1000) * moon.exterior.clutter * 0.11);
  for (let i = 0; i < count; i++) {
    const px = r.range(-size, size);
    const pz = r.range(-size, size);
    // Keep the landing pad and the door aprons clear so nothing traps the crew.
    if (Math.hypot(px - ship.x, pz - ship.z) < padRadius + 6) continue;
    if (entrances.some((e) => Math.hypot(px - e.x, pz - e.z) < 13)) continue;
    const def = r.weighted(palette, (p) => p.weight);
    props.push({
      model: def.model,
      x: px,
      y: sample(px, pz),
      z: pz,
      rotY: r.range(0, Math.PI * 2),
      scale: def.fit * r.range(0.75, 1.3),
      collide: def.collide,
    });
  }

  const waterBase = WEATHER[weather].flags.rising ? -3.0 : moon.biome === 'marsh' ? -1.6 : null;

  return { seed: opts.seed, size, ship, entrances, props, terrain, padRadius, waterBase };
}

/**
 * Terrain height at a world position. Both the client mesh and the server's
 * creature movement call this, so it must stay a pure function of its inputs.
 */
export function sampleTerrain(
  x: number,
  z: number,
  terrain: ExteriorLayout['terrain'],
  flatSpots: { x: number; z: number; radius: number }[],
): number {
  const base = fbm2D(x * terrain.scale, z * terrain.scale, 4, terrain.seed);
  const ridged = Math.abs(fbm2D(x * terrain.scale * 2.7, z * terrain.scale * 2.7, 3, terrain.seed + 991) - 0.5) * 2;
  let h = (base - 0.5) * terrain.amplitude + ridged * terrain.amplitude * 0.35 * terrain.relief;

  // Flatten toward zero near pads, with a soft skirt so it does not look stamped.
  for (const spot of flatSpots) {
    const d = Math.hypot(x - spot.x, z - spot.z);
    const t = 1 - smoothstep(spot.radius, spot.radius * 2.4, d);
    if (t > 0) h *= 1 - t;
  }
  return h;
}

/** Convenience wrapper that closes over an exterior layout's own flat spots. */
export function makeTerrainSampler(ext: ExteriorLayout): (x: number, z: number) => number {
  const flats = [
    { x: ext.ship.x, z: ext.ship.z, radius: ext.padRadius },
    ...ext.entrances.map((e) => ({ x: e.x, z: e.z, radius: 11 })),
  ];
  return (x: number, z: number) => sampleTerrain(x, z, ext.terrain, flats);
}
