import * as THREE from 'three';
import { TILE, CEIL_HEIGHT } from '@shared/constants.ts';
import { RNG } from '@shared/rng.ts';
import type { InteriorStyle } from '@shared/content/moons.ts';
import {
  SIDE_DX,
  SIDE_DZ,
  cellIndex,
  isFloor,
  type FacilityLayout,
  type Side,
} from '@shared/facility/types.ts';
import { assets, type LoadedModel } from '../assets.ts';
import type { DynamicLight, SceneManager } from './scene.ts';

export const INTERIOR_ORIGIN_X = 20000;

interface StyleKit {
  floor: string;
  wall: string;
  wallAlt: string[];
  doorFrame: string;
  doorLeaf: string;
  pillar: string;
  stair: string;
  /** Tint applied to the whole interior, to separate the four looks. */
  tint: number;
  ceiling: number;
}

const KITS: Record<InteriorStyle, StyleKit> = {
  station: {
    floor: 'kit.station/floor',
    wall: 'kit.station/wall',
    wallAlt: ['kit.station/wall-detail', 'kit.station/wall-pillar', 'kit.station/wall-window'],
    doorFrame: 'kit.station/wall-door',
    doorLeaf: 'kit.station/door-single',
    pillar: 'kit.station/structure-panel',
    stair: 'kit.station/stairs',
    tint: 0xb9bdb6,
    ceiling: 0x14171a,
  },
  factory: {
    floor: 'kit.factory/floor',
    wall: 'kit.factory/structure-wall',
    wallAlt: ['kit.factory/structure-window', 'kit.factory/structure-medium', 'kit.factory/structure-short'],
    doorFrame: 'kit.factory/structure-doorway',
    doorLeaf: 'kit.factory/door',
    pillar: 'kit.factory/structure-corner-inner',
    stair: 'kit.factory/catwalk-stairs',
    tint: 0xa8a49a,
    ceiling: 0x121110,
  },
  mine: {
    floor: 'kit.cave/template-floor',
    wall: 'kit.cave/template-wall',
    wallAlt: ['kit.cave/template-wall-detail-a', 'kit.cave/template-wall-half', 'kit.cave/template-corner'],
    doorFrame: 'kit.cave/gate',
    doorLeaf: 'kit.cave/gate-metal-bars',
    pillar: 'kit.cave/template-detail',
    stair: 'kit.cave/stairs',
    tint: 0x8d8477,
    ceiling: 0x0d0b09,
  },
  sublevel: {
    floor: 'kit.dungeon/Floor_Modular',
    wall: 'kit.dungeon/Wall_Modular',
    wallAlt: ['kit.dungeon/WallCover_Modular', 'kit.dungeon/Decorative_Wall', 'kit.dungeon/Wall_Modular'],
    doorFrame: 'kit.dungeon/Arch',
    doorLeaf: 'kit.dungeon/Arch_Door',
    pillar: 'kit.dungeon/Column',
    stair: 'kit.dungeon/Stairs_Modular',
    tint: 0x8f8b86,
    ceiling: 0x0b0a09,
  },
};

interface Placement {
  matrix: THREE.Matrix4;
}

export interface DoorVisual {
  id: number;
  pivot: THREE.Object3D;
  closedRotation: number;
  openRotation: number;
  current: number;
  target: number;
  /** Slide instead of swing, for powered bulkheads. */
  slide: boolean;
  slideAxis: THREE.Vector3;
  basePosition: THREE.Vector3;
}

export class FacilityView {
  group = new THREE.Group();
  doors: DoorVisual[] = [];
  private lights: DynamicLight[] = [];
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(private sceneManager: SceneManager) {
    this.group.position.x = INTERIOR_ORIGIN_X;
    this.group.visible = false;
    sceneManager.scene.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  clear(): void {
    for (const light of this.lights) this.sceneManager.removeLight(light);
    this.lights.length = 0;
    this.doors.length = 0;
    this.group.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  /** Models this layout will need, so the loader can prefetch them in one pass. */
  static requiredModels(layout: FacilityLayout): string[] {
    const kit = KITS[layout.style];
    const refs = new Set<string>([kit.floor, kit.wall, kit.doorFrame, kit.doorLeaf, kit.pillar, kit.stair, ...kit.wallAlt]);
    for (const prop of layout.props) refs.add(prop.model);
    return [...refs];
  }

  async build(layout: FacilityLayout): Promise<void> {
    this.clear();
    const kit = KITS[layout.style];
    const rng = new RNG(layout.seed ^ 0x5eed);

    const structural = await loadAll([kit.floor, kit.wall, ...kit.wallAlt, kit.doorFrame, kit.pillar, kit.stair]);
    const doorLeaf = await assets.load(kit.doorLeaf);

    const batches = new Map<string, { model: LoadedModel; placements: Placement[] }>();
    const push = (ref: string, model: LoadedModel | null, matrix: THREE.Matrix4) => {
      if (!model) return;
      let batch = batches.get(ref);
      if (!batch) {
        batch = { model, placements: [] };
        batches.set(ref, batch);
      }
      batch.placements.push({ matrix });
    };

    const ceilPlacements: THREE.Matrix4[] = [];

    for (const grid of layout.levels) {
      const baseY = grid.baseY;
      for (let z = 0; z < grid.d; z++) {
        for (let x = 0; x < grid.w; x++) {
          const ci = cellIndex(grid, x, z);
          if (grid.cells[ci] < 0) continue;
          const cx = (x + 0.5) * TILE;
          const cz = (z + 0.5) * TILE;

          // ---- floor
          const floorModel = structural.get(kit.floor);
          if (floorModel) {
            const m = new THREE.Matrix4();
            const s = fitScale(floorModel, TILE, 0.35, TILE);
            m.compose(
              new THREE.Vector3(cx, baseY, cz),
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.PI / 2) * rng.int(0, 3)),
              s,
            );
            push(kit.floor, floorModel, m);
          }

          // ---- ceiling (a plain slab: cheap, and the player rarely looks up)
          const ceilM = new THREE.Matrix4();
          ceilM.compose(
            new THREE.Vector3(cx, baseY + CEIL_HEIGHT + 0.1, cz),
            new THREE.Quaternion(),
            new THREE.Vector3(TILE, 0.2, TILE),
          );
          ceilPlacements.push(ceilM);

          // ---- walls and doorways
          for (let s = 0 as Side; s < 4; s++) {
            const doorId = grid.doors[ci * 4 + s];
            const walled = (grid.walls[ci] & (1 << s)) !== 0;
            const nx = x + SIDE_DX[s];
            const nz = z + SIDE_DZ[s];
            const neighbourFloor = isFloor(grid, nx, nz);

            // Only draw a wall from one side of a shared edge.
            if (neighbourFloor && doorId < 0) {
              const otherIndex = cellIndex(grid, nx, nz);
              if (grid.cells[otherIndex] > grid.cells[ci]) continue;
              if (grid.cells[otherIndex] === grid.cells[ci]) continue;
            }
            if (!walled && doorId < 0) continue;

            const angle = Math.atan2(SIDE_DX[s], SIDE_DZ[s]);
            const ex = cx + SIDE_DX[s] * TILE * 0.5;
            const ez = cz + SIDE_DZ[s] * TILE * 0.5;

            if (doorId >= 0) {
              const spec = layout.doors.find((d) => d.id === doorId);
              // The doorway frame is drawn for every door; the leaf only for
              // doors that actually close.
              const frame = structural.get(kit.doorFrame);
              if (frame) {
                const m = new THREE.Matrix4();
                m.compose(
                  new THREE.Vector3(ex, baseY, ez),
                  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
                  fitScale(frame, TILE, CEIL_HEIGHT, TILE),
                );
                push(kit.doorFrame, frame, m);
              }
              if (spec && spec.kind !== 'open' && doorLeaf) {
                this.addDoor(doorLeaf, spec.id, ex, baseY, ez, angle, spec.kind === 'powered');
              }
              continue;
            }

            const ref = rng.bool(0.22) ? rng.pick(kit.wallAlt) : kit.wall;
            const wallModel = structural.get(ref) ?? structural.get(kit.wall);
            if (!wallModel) continue;
            const m = new THREE.Matrix4();
            m.compose(
              new THREE.Vector3(ex, baseY, ez),
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
              fitScale(wallModel, TILE, CEIL_HEIGHT, TILE),
            );
            push(ref, wallModel, m);
          }
        }
      }
    }

    // ---- stairwells
    const stairModel = structural.get(kit.stair);
    for (const stair of layout.stairs) {
      const upper = layout.levels[stair.level];
      const lower = layout.levels[stair.level + 1];
      if (!upper || !lower || !stairModel) continue;
      const cx = (stair.x + 0.5) * TILE;
      const cz = (stair.z + 0.5) * TILE;
      const drop = upper.baseY - lower.baseY;
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(cx, lower.baseY, cz),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.PI / 2) * stair.side),
        fitScale(stairModel, TILE * 0.9, drop, TILE * 0.9),
      );
      push(kit.stair, stairModel, m);
    }

    // ---- dressing
    for (const prop of layout.props) {
      const model = await assets.load(prop.model);
      if (!model) continue;
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(prop.px, prop.py, prop.pz),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), prop.rotY),
        new THREE.Vector3(prop.scale, prop.scale, prop.scale),
      );
      push(prop.model, model, m);

      if (prop.light) {
        this.lights.push(
          this.sceneManager.registerLight({
            position: new THREE.Vector3(INTERIOR_ORIGIN_X + prop.px, prop.py + prop.scale * 0.7, prop.pz),
            color: prop.light.color,
            intensity: prop.light.intensity,
            range: prop.light.range,
            flicker: prop.light.flicker,
            level: prop.level,
            active: true,
          }),
        );
      }
    }

    // ---- room lighting: one soft fixture per lit room, at ceiling height
    for (const room of layout.rooms) {
      if (!room.lit) continue;
      const grid = layout.levels[room.level];
      const cx = (room.x + room.w / 2) * TILE;
      const cz = (room.z + room.d / 2) * TILE;
      const cells = room.w * room.d;
      this.lights.push(
        this.sceneManager.registerLight({
          position: new THREE.Vector3(INTERIOR_ORIGIN_X + cx, grid.baseY + CEIL_HEIGHT - 0.5, cz),
          color: room.tags.includes('generator') ? 0xffb84a : 0xd7e2e8,
          intensity: Math.min(2.4, 0.8 + cells * 0.12),
          range: Math.min(28, 8 + cells * 1.6),
          flicker: room.depth > 14 ? 0.35 : 0.08,
          level: room.level,
          active: true,
        }),
      );
    }

    // ---- realise the batches
    for (const [ref, batch] of batches) {
      for (const part of batch.model.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, batch.placements.length);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        for (let i = 0; i < batch.placements.length; i++) mesh.setMatrixAt(i, batch.placements[i].matrix);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.name = ref;
        this.group.add(mesh);
      }
    }

    if (ceilPlacements.length) {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({ color: kit.ceiling, roughness: 1, metalness: 0 });
      this.disposables.push(geometry, material);
      const mesh = new THREE.InstancedMesh(geometry, material, ceilPlacements.length);
      mesh.frustumCulled = false;
      for (let i = 0; i < ceilPlacements.length; i++) mesh.setMatrixAt(i, ceilPlacements[i]);
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }

  private addDoor(
    model: LoadedModel,
    id: number,
    x: number,
    y: number,
    z: number,
    angle: number,
    powered: boolean,
  ): void {
    const pivot = new THREE.Object3D();
    // Hinge on the frame edge so the leaf swings out of the opening.
    const hingeOffset = TILE * 0.45;
    pivot.position.set(x - Math.cos(angle) * hingeOffset, y, z + Math.sin(angle) * hingeOffset);
    pivot.rotation.y = angle;

    const leaf = model.scene.clone(true);
    const scale = fitScale(model, TILE * 0.92, CEIL_HEIGHT * 0.94, TILE * 0.92);
    leaf.scale.copy(scale);
    leaf.position.set(hingeOffset, 0, 0);
    pivot.add(leaf);
    this.group.add(pivot);

    this.doors.push({
      id,
      pivot,
      closedRotation: angle,
      openRotation: angle - Math.PI * 0.55,
      current: angle,
      target: angle,
      slide: powered,
      slideAxis: new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle)),
      basePosition: pivot.position.clone(),
    });
  }

  /** Animate door leaves toward their networked state. */
  update(dt: number, doorStates: Map<number, { state: number }>): void {
    for (const door of this.doors) {
      const state = doorStates.get(door.id);
      const open = state ? state.state === 1 || state.state === 4 : false;
      if (door.slide) {
        const targetOffset = open ? TILE * 0.95 : 0;
        const current = door.pivot.position.distanceTo(door.basePosition);
        const next = current + Math.sign(targetOffset - current) * Math.min(Math.abs(targetOffset - current), dt * 4.2);
        door.pivot.position.copy(door.basePosition).addScaledVector(door.slideAxis, next);
      } else {
        door.target = open ? door.openRotation : door.closedRotation;
        const diff = door.target - door.current;
        door.current += Math.sign(diff) * Math.min(Math.abs(diff), dt * 5.2);
        door.pivot.rotation.y = door.current;
      }
    }
  }
}

async function loadAll(refs: string[]): Promise<Map<string, LoadedModel>> {
  const out = new Map<string, LoadedModel>();
  await Promise.all(
    [...new Set(refs)].map(async (ref) => {
      const model = await assets.load(ref);
      if (model) out.set(ref, model);
    }),
  );
  return out;
}

/**
 * Structural pieces are stretched to fit the cell exactly rather than scaled
 * uniformly, because a two-centimetre gap between wall panels is a light leak
 * and a light leak in a dark game is very visible.
 */
function fitScale(model: LoadedModel, width: number, height: number, depth: number): THREE.Vector3 {
  const s = model.size;
  return new THREE.Vector3(
    width / Math.max(0.02, s.x),
    height / Math.max(0.02, s.y),
    depth / Math.max(0.02, s.z),
  );
}
