import { TILE } from '../constants.ts';
import {
  type FacilityLayout,
  type Side,
  SIDE_DX,
  SIDE_DZ,
  cellIndex,
  isFloor,
} from './types.ts';

export interface NavNode {
  level: number;
  x: number;
  z: number;
}

/**
 * Navigation runs on the same cell grid the facility was generated from, so
 * there is no navmesh to bake and no chance of the AI's idea of the world
 * drifting from the collision geometry.
 */
export class NavGraph {
  readonly layout: FacilityLayout;
  /** Flattened per-level node ids so we can use plain typed arrays for search. */
  private readonly offsets: number[] = [];
  private readonly total: number;
  /** Neighbour ids, 4 per node, -1 for none. Includes stair links as a 5th. */
  private readonly neighbours: Int32Array;
  private readonly stairLink: Int32Array;
  /** Door id blocking each edge, or -1. */
  private readonly edgeDoor: Int32Array;

  constructor(layout: FacilityLayout) {
    this.layout = layout;
    let acc = 0;
    for (const level of layout.levels) {
      this.offsets.push(acc);
      acc += level.w * level.d;
    }
    this.total = acc;
    this.neighbours = new Int32Array(this.total * 4).fill(-1);
    this.stairLink = new Int32Array(this.total).fill(-1);
    this.edgeDoor = new Int32Array(this.total * 4).fill(-1);

    for (let li = 0; li < layout.levels.length; li++) {
      const grid = layout.levels[li];
      for (let z = 0; z < grid.d; z++) {
        for (let x = 0; x < grid.w; x++) {
          const ci = cellIndex(grid, x, z);
          if (grid.cells[ci] < 0) continue;
          const id = this.offsets[li] + ci;
          for (let s = 0 as Side; s < 4; s++) {
            const nx = x + SIDE_DX[s];
            const nz = z + SIDE_DZ[s];
            if (!isFloor(grid, nx, nz)) continue;
            const doorId = grid.doors[ci * 4 + s];
            const walled = (grid.walls[ci] & (1 << s)) !== 0;
            if (walled && doorId < 0) continue;
            this.neighbours[id * 4 + s] = this.offsets[li] + cellIndex(grid, nx, nz);
            this.edgeDoor[id * 4 + s] = doorId;
          }
        }
      }
    }

    for (const stair of layout.stairs) {
      const upper = layout.levels[stair.level];
      const lower = layout.levels[stair.level + 1];
      if (!upper || !lower) continue;
      if (!isFloor(upper, stair.x, stair.z) || !isFloor(lower, stair.x, stair.z)) continue;
      const a = this.offsets[stair.level] + cellIndex(upper, stair.x, stair.z);
      const b = this.offsets[stair.level + 1] + cellIndex(lower, stair.x, stair.z);
      this.stairLink[a] = b;
      this.stairLink[b] = a;
    }
  }

  get nodeCount(): number {
    return this.total;
  }

  id(level: number, x: number, z: number): number {
    const grid = this.layout.levels[level];
    if (!grid || x < 0 || z < 0 || x >= grid.w || z >= grid.d) return -1;
    const ci = cellIndex(grid, x, z);
    if (grid.cells[ci] < 0) return -1;
    return this.offsets[level] + ci;
  }

  node(id: number): NavNode | null {
    for (let li = this.layout.levels.length - 1; li >= 0; li--) {
      if (id >= this.offsets[li]) {
        const grid = this.layout.levels[li];
        const ci = id - this.offsets[li];
        return { level: li, x: ci % grid.w, z: Math.floor(ci / grid.w) };
      }
    }
    return null;
  }

  /** World position of a node's centre. */
  world(id: number): { x: number; y: number; z: number } | null {
    const n = this.node(id);
    if (!n) return null;
    return {
      x: (n.x + 0.5) * TILE,
      y: this.layout.levels[n.level].baseY,
      z: (n.z + 0.5) * TILE,
    };
  }

  /** Nearest walkable node to a world position on a given level. */
  nearest(level: number, wx: number, wz: number): number {
    const grid = this.layout.levels[level];
    if (!grid) return -1;
    const cx = Math.floor(wx / TILE);
    const cz = Math.floor(wz / TILE);
    const direct = this.id(level, cx, cz);
    if (direct >= 0) return direct;
    for (let r = 1; r <= 6; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const found = this.id(level, cx + dx, cz + dz);
          if (found >= 0) return found;
        }
      }
    }
    return -1;
  }

  /**
   * A*. `canPass` lets each creature decide what a door means to it: most
   * things are stopped by a shut door, a few are not.
   */
  path(from: number, to: number, canPass: (doorId: number) => boolean, maxNodes = 6000): number[] {
    if (from < 0 || to < 0) return [];
    if (from === to) return [from];

    const open: number[] = [from];
    const gScore = new Map<number, number>([[from, 0]]);
    const fScore = new Map<number, number>([[from, this.heuristic(from, to)]]);
    const cameFrom = new Map<number, number>();
    const closed = new Set<number>();
    let expanded = 0;

    while (open.length) {
      // Small maps; a linear scan beats the constant factor of a real heap here.
      let bestIdx = 0;
      let bestF = Infinity;
      for (let i = 0; i < open.length; i++) {
        const f = fScore.get(open[i]) ?? Infinity;
        if (f < bestF) {
          bestF = f;
          bestIdx = i;
        }
      }
      const current = open.splice(bestIdx, 1)[0];
      if (current === to) return this.reconstruct(cameFrom, current);
      closed.add(current);
      if (++expanded > maxNodes) break;

      const g = gScore.get(current) ?? Infinity;
      for (let s = 0; s < 5; s++) {
        const next = s < 4 ? this.neighbours[current * 4 + s] : this.stairLink[current];
        if (next < 0 || closed.has(next)) continue;
        if (s < 4) {
          const doorId = this.edgeDoor[current * 4 + s];
          if (doorId >= 0 && !canPass(doorId)) continue;
        }
        // Stairs cost more so creatures prefer level-flat routes when equal.
        const stepCost = s === 4 ? 3 : 1;
        const tentative = g + stepCost;
        if (tentative >= (gScore.get(next) ?? Infinity)) continue;
        cameFrom.set(next, current);
        gScore.set(next, tentative);
        fScore.set(next, tentative + this.heuristic(next, to));
        if (!open.includes(next)) open.push(next);
      }
    }
    return [];
  }

  private heuristic(a: number, b: number): number {
    const na = this.node(a);
    const nb = this.node(b);
    if (!na || !nb) return 0;
    return Math.abs(na.x - nb.x) + Math.abs(na.z - nb.z) + Math.abs(na.level - nb.level) * 4;
  }

  private reconstruct(cameFrom: Map<number, number>, current: number): number[] {
    const out = [current];
    let node = current;
    while (cameFrom.has(node)) {
      node = cameFrom.get(node)!;
      out.push(node);
    }
    return out.reverse();
  }

  /** BFS reachability from every entrance. Used by the generator's own tests. */
  reachableFromEntrances(canPass: (doorId: number) => boolean): Set<number> {
    const seen = new Set<number>();
    const queue: number[] = [];
    for (const spawn of this.layout.entrySpawns) {
      const id = this.id(spawn.level, Math.floor(spawn.px / TILE), Math.floor(spawn.pz / TILE));
      if (id >= 0 && !seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      for (let s = 0; s < 5; s++) {
        const next = s < 4 ? this.neighbours[current * 4 + s] : this.stairLink[current];
        if (next < 0 || seen.has(next)) continue;
        if (s < 4) {
          const doorId = this.edgeDoor[current * 4 + s];
          if (doorId >= 0 && !canPass(doorId)) continue;
        }
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  }

  /** Every walkable node id. */
  allNodes(): number[] {
    const out: number[] = [];
    for (let li = 0; li < this.layout.levels.length; li++) {
      const grid = this.layout.levels[li];
      for (let ci = 0; ci < grid.cells.length; ci++) {
        if (grid.cells[ci] >= 0) out.push(this.offsets[li] + ci);
      }
    }
    return out;
  }
}

/** Converts a node path into world waypoints, dropping collinear midpoints. */
export function pathToWaypoints(nav: NavGraph, path: number[]): { x: number; y: number; z: number }[] {
  const pts: { x: number; y: number; z: number }[] = [];
  for (const id of path) {
    const w = nav.world(id);
    if (w) pts.push(w);
  }
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const straight =
      Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) < 1e-4 && a.y === b.y && b.y === c.y;
    if (!straight) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
