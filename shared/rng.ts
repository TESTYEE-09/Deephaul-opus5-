/**
 * Deterministic PRNG. The whole game depends on this: the server sends a moon
 * seed, and every client rebuilds the exact same facility from it. If this
 * function ever drifts between builds, players end up walking through walls
 * that only exist on someone else's machine.
 */
export class RNG {
  private s: number;

  constructor(seed: number) {
    // Force to uint32 and avoid the degenerate 0 state.
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  /** mulberry32 — small, fast, good enough distribution for level gen. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick. `weight` defaults to reading `.weight` off the item. */
  weighted<T>(arr: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of arr) total += Math.max(0, weight(item));
    if (total <= 0) return arr[0];
    let roll = this.next() * total;
    for (const item of arr) {
      roll -= Math.max(0, weight(item));
      if (roll <= 0) return item;
    }
    return arr[arr.length - 1];
  }

  /** In-place Fisher-Yates. Returns the same array for chaining. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** Approximate normal distribution via sum of uniforms. */
  gaussian(mean = 0, stdev = 1): number {
    const u = (this.next() + this.next() + this.next() + this.next() - 2) * 1.4142;
    return mean + u * stdev;
  }

  /** Derive an independent stream so subsystems can't desync each other. */
  fork(salt: number): RNG {
    return new RNG(hashInts(this.s, salt >>> 0));
  }

  get state(): number {
    return this.s;
  }
}

export function hashInts(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic value noise in 1D — used for wind, flicker, creature idle drift. */
export function valueNoise1D(x: number, seed = 1337): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = fract01(hashInts(i, seed));
  const b = fract01(hashInts(i + 1, seed));
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

function fract01(h: number): number {
  return (h >>> 8) / 16777216;
}

/** 2D value noise, used for exterior terrain heightmaps. */
export function valueNoise2D(x: number, y: number, seed = 1337): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const tl = fract01(hashInts(hashInts(xi, yi), seed));
  const tr = fract01(hashInts(hashInts(xi + 1, yi), seed));
  const bl = fract01(hashInts(hashInts(xi, yi + 1), seed));
  const br = fract01(hashInts(hashInts(xi + 1, yi + 1), seed));
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const top = tl + (tr - tl) * sx;
  const bottom = bl + (br - bl) * sx;
  return top + (bottom - top) * sy;
}

/** Fractal brownian motion over valueNoise2D. */
export function fbm2D(x: number, y: number, octaves = 4, seed = 1337): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(x * freq, y * freq, seed + i * 7919) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
