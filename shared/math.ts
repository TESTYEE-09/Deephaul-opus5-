/** Minimal vector math. The server has no Three.js, so both sides use these. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing. `rate` is per second. */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-rate * dt));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

export function dist2D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function dist2DSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function dist3D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function dist3DSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function angleTo(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function moveTowardsAngle(current: number, target: number, maxDelta: number): number {
  const d = angleDelta(current, target);
  return current + clamp(d, -maxDelta, maxDelta);
}

export function normalize2D(x: number, z: number): Vec2 {
  const len = Math.hypot(x, z);
  if (len < 1e-6) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}

/** Axis-aligned rectangle overlap test on the XZ plane. */
export function rectsOverlap(
  ax: number, az: number, aw: number, ad: number,
  bx: number, bz: number, bw: number, bd: number,
  pad = 0,
): boolean {
  return (
    ax - pad < bx + bw &&
    ax + aw + pad > bx &&
    az - pad < bz + bd &&
    az + ad + pad > bz
  );
}

/** Segment vs axis-aligned box on XZ. Used for line-of-sight against walls. */
export function segmentIntersectsRect(
  x1: number, z1: number, x2: number, z2: number,
  rx: number, rz: number, rw: number, rd: number,
): boolean {
  // Slab method in 2D.
  const dx = x2 - x1;
  const dz = z2 - z1;
  let tmin = 0;
  let tmax = 1;
  for (let axis = 0; axis < 2; axis++) {
    const p = axis === 0 ? x1 : z1;
    const d = axis === 0 ? dx : dz;
    const lo = axis === 0 ? rx : rz;
    const hi = axis === 0 ? rx + rw : rz + rd;
    if (Math.abs(d) < 1e-8) {
      if (p < lo || p > hi) return false;
    } else {
      let t1 = (lo - p) / d;
      let t2 = (hi - p) / d;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export function randomPointInAnnulus(rng: { range(a: number, b: number): number }, min: number, max: number): Vec2 {
  const a = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(rng.range(min * min, max * max));
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

export function roundTo(v: number, places = 2): number {
  const m = 10 ** places;
  return Math.round(v * m) / m;
}
