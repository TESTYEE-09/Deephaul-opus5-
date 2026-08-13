import * as THREE from 'three';
import { TILE, PLAYER, CEIL_HEIGHT } from '@shared/constants.ts';
import { clamp } from '@shared/math.ts';
import {
  SIDE_DX,
  SIDE_DZ,
  cellIndex,
  isFloor,
  type FacilityLayout,
  type Side,
} from '@shared/facility/types.ts';
import { makeTerrainSampler, type ExteriorLayout } from '@shared/world/exterior.ts';
import { INTERIOR_ORIGIN_X } from '../render/facility.ts';
import { SHIP } from '../render/ship.ts';

export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Collision runs against the same cell grid the facility was generated from and
 * the same terrain function the server uses. There is no collision mesh, so the
 * player can never end up on the wrong side of geometry the AI believes in.
 */
export class WorldCollision {
  layout: FacilityLayout | null = null;
  exterior: ExteriorLayout | null = null;
  terrain: (x: number, z: number) => number = () => 0;
  exteriorColliders: CircleCollider[] = [];
  interiorColliders: Map<number, CircleCollider[]> = new Map();
  shipBoxes: BoxCollider[] = [];
  shipPosition = new THREE.Vector3();
  /** Door id -> passable, mirrored from the network state. */
  doorOpen = new Map<number, boolean>();

  setWorld(layout: FacilityLayout, exterior: ExteriorLayout, shipPosition: THREE.Vector3): void {
    this.layout = layout;
    this.exterior = exterior;
    this.terrain = makeTerrainSampler(exterior);
    this.shipPosition.copy(shipPosition);

    this.interiorColliders.clear();
    for (const prop of layout.props) {
      if (prop.collide <= 0) continue;
      // Ceiling dressing never blocks anyone.
      if (prop.py > layout.levels[prop.level].baseY + 2.2) continue;
      const list = this.interiorColliders.get(prop.level) ?? [];
      list.push({ x: prop.px, z: prop.pz, r: prop.collide });
      this.interiorColliders.set(prop.level, list);
    }
  }

  /** Floor height under a position. */
  groundHeight(x: number, z: number, level: number): number {
    if (level >= 0) {
      const grid = this.layout?.levels[level];
      return grid ? grid.baseY : 0;
    }
    const shipFloor = this.shipFloorHeight(x, z);
    if (shipFloor !== null) return shipFloor;
    return this.terrain(x, z);
  }

  /** Ship deck height, or null when the position is not on the ship or ramp. */
  private shipFloorHeight(x: number, z: number): number | null {
    const lx = x - this.shipPosition.x;
    const lz = z - this.shipPosition.z;
    const deck = this.shipPosition.y + SHIP.floorY;
    if (Math.abs(lx) <= SHIP.halfW && Math.abs(lz) <= SHIP.halfD) return deck;

    // The ramp: a wedge extending forward from the hatch.
    const rampStart = -SHIP.halfD;
    const rampEnd = -SHIP.halfD - 4.4;
    if (lz <= rampStart && lz >= rampEnd && Math.abs(lx) <= SHIP.hatchWidth * 0.55) {
      const t = (rampStart - lz) / (rampStart - rampEnd);
      const groundY = this.terrain(x, z);
      return deck + (groundY - deck) * clamp(t, 0, 1);
    }
    return null;
  }

  insideShip(x: number, y: number, z: number, level: number): boolean {
    if (level >= 0) return false;
    const lx = x - this.shipPosition.x;
    const lz = z - this.shipPosition.z;
    return (
      Math.abs(lx) < SHIP.halfW &&
      Math.abs(lz) < SHIP.halfD &&
      y > this.shipPosition.y + SHIP.floorY - 2 &&
      y < this.shipPosition.y + SHIP.floorY + SHIP.height
    );
  }

  /** Ceiling height above a position, used to stop jumping through floors. */
  ceilingHeight(x: number, z: number, level: number): number {
    if (level >= 0) {
      const grid = this.layout?.levels[level];
      return grid ? grid.baseY + CEIL_HEIGHT : 99;
    }
    if (this.insideShip(x, this.shipPosition.y + SHIP.floorY + 1, z, -1)) {
      return this.shipPosition.y + SHIP.floorY + SHIP.height;
    }
    return 999;
  }

  /**
   * Push a position out of anything it is overlapping. Runs a couple of passes
   * so a player wedged into a corner resolves cleanly instead of jittering.
   */
  resolve(position: THREE.Vector3, level: number, radius = PLAYER.radius): void {
    for (let pass = 0; pass < 2; pass++) {
      if (level >= 0) this.resolveInterior(position, level, radius);
      else this.resolveExterior(position, radius);
    }
  }

  private resolveInterior(position: THREE.Vector3, level: number, radius: number): void {
    const grid = this.layout?.levels[level];
    if (!grid) return;

    const localX = position.x - INTERIOR_ORIGIN_X;
    let cx = Math.floor(localX / TILE);
    let cz = Math.floor(position.z / TILE);

    // Outside the carved area entirely: shove back to the nearest floor cell.
    if (!isFloor(grid, cx, cz)) {
      let best: { x: number; z: number; d: number } | null = null;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (!isFloor(grid, nx, nz)) continue;
          const px = (nx + 0.5) * TILE;
          const pz = (nz + 0.5) * TILE;
          const d = (px - localX) ** 2 + (pz - position.z) ** 2;
          if (!best || d < best.d) best = { x: px, z: pz, d };
        }
      }
      if (best) {
        position.x = INTERIOR_ORIGIN_X + best.x;
        position.z = best.z;
        return;
      }
      return;
    }

    const ci = cellIndex(grid, cx, cz);
    const minX = cx * TILE;
    const minZ = cz * TILE;

    for (let s = 0 as Side; s < 4; s++) {
      const doorId = grid.doors[ci * 4 + s];
      const walled = (grid.walls[ci] & (1 << s)) !== 0;
      let blocked = walled;
      if (doorId >= 0) blocked = !(this.doorOpen.get(doorId) ?? false);
      if (!blocked) {
        // Even an open edge is solid if there is nothing on the other side.
        if (!isFloor(grid, cx + SIDE_DX[s], cz + SIDE_DZ[s])) blocked = true;
      }
      if (!blocked) continue;

      if (s === 0 && position.z < minZ + radius) position.z = minZ + radius;
      else if (s === 2 && position.z > minZ + TILE - radius) position.z = minZ + TILE - radius;
      else if (s === 3 && position.x < INTERIOR_ORIGIN_X + minX + radius) position.x = INTERIOR_ORIGIN_X + minX + radius;
      else if (s === 1 && position.x > INTERIOR_ORIGIN_X + minX + TILE - radius) {
        position.x = INTERIOR_ORIGIN_X + minX + TILE - radius;
      }
    }

    // Doorways are narrower than the cell, so squeeze the player toward centre.
    for (let s = 0 as Side; s < 4; s++) {
      const doorId = grid.doors[ci * 4 + s];
      if (doorId < 0 || !(this.doorOpen.get(doorId) ?? false)) continue;
      const nearEdge =
        (s === 0 && position.z < minZ + 0.9) ||
        (s === 2 && position.z > minZ + TILE - 0.9) ||
        (s === 3 && position.x < INTERIOR_ORIGIN_X + minX + 0.9) ||
        (s === 1 && position.x > INTERIOR_ORIGIN_X + minX + TILE - 0.9);
      if (!nearEdge) continue;
      const halfGap = TILE * 0.36;
      if (s === 0 || s === 2) {
        const centre = INTERIOR_ORIGIN_X + minX + TILE / 2;
        position.x = clamp(position.x, centre - halfGap, centre + halfGap);
      } else {
        const centre = minZ + TILE / 2;
        position.z = clamp(position.z, centre - halfGap, centre + halfGap);
      }
    }

    const props = this.interiorColliders.get(level);
    if (props) this.pushOutOfCircles(position, props, radius, INTERIOR_ORIGIN_X);
  }

  private resolveExterior(position: THREE.Vector3, radius: number): void {
    const size = this.exterior?.size ?? 200;
    position.x = clamp(position.x, -size, size);
    position.z = clamp(position.z, -size, size);
    this.pushOutOfCircles(position, this.exteriorColliders, radius, 0);

    for (const box of this.shipBoxes) {
      const closestX = clamp(position.x, box.minX, box.maxX);
      const closestZ = clamp(position.z, box.minZ, box.maxZ);
      const dx = position.x - closestX;
      const dz = position.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq > radius * radius) continue;
      if (distSq < 1e-6) {
        // Dead centre of a wall: eject along the shallowest axis.
        const toLeft = position.x - box.minX;
        const toRight = box.maxX - position.x;
        const toBack = position.z - box.minZ;
        const toFront = box.maxZ - position.z;
        const min = Math.min(toLeft, toRight, toBack, toFront);
        if (min === toLeft) position.x = box.minX - radius;
        else if (min === toRight) position.x = box.maxX + radius;
        else if (min === toBack) position.z = box.minZ - radius;
        else position.z = box.maxZ + radius;
        continue;
      }
      const dist = Math.sqrt(distSq);
      const push = (radius - dist) / dist;
      position.x += dx * push;
      position.z += dz * push;
    }
  }

  private pushOutOfCircles(
    position: THREE.Vector3,
    circles: CircleCollider[],
    radius: number,
    originX: number,
  ): void {
    for (const c of circles) {
      const cxWorld = originX + c.x;
      const dx = position.x - cxWorld;
      const dz = position.z - c.z;
      const minDist = c.r + radius;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDist * minDist || distSq < 1e-8) continue;
      const dist = Math.sqrt(distSq);
      const push = (minDist - dist) / dist;
      position.x += dx * push;
      position.z += dz * push;
    }
  }

  /** Nearest facility entrance the player can step through, if any. */
  nearestEntrance(
    x: number,
    z: number,
    entrances: { anchor: number; position: THREE.Vector3 }[],
    range = 2.6,
  ): { anchor: number; position: THREE.Vector3 } | null {
    let best: { anchor: number; position: THREE.Vector3 } | null = null;
    let bestD = range;
    for (const e of entrances) {
      const d = Math.hypot(e.position.x - x, e.position.z - z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }
}
