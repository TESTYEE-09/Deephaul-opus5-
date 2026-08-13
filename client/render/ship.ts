import * as THREE from 'three';
import { assets } from '../assets.ts';
import type { SceneManager } from './scene.ts';

/**
 * The ship. Hand-laid rather than generated, because it is the one space the
 * crew has to know by heart: where the terminal is, where the hatch is, and
 * exactly how many steps it takes to get from the ramp to inside.
 *
 * Local space has the hatch on -Z, the terminal on +X, cargo floor in the
 * middle. The group is positioned at the exterior landing pad.
 */

export const SHIP = {
  halfW: 6.5,
  halfD: 5.0,
  height: 4.2,
  floorY: 1.2,
  hatchWidth: 3.4,
};

export interface ShipInteractable {
  kind: 'terminal' | 'monitor' | 'lever' | 'charger' | 'counter';
  position: THREE.Vector3;
  radius: number;
  label: string;
}

export class ShipView {
  group = new THREE.Group();
  interactables: ShipInteractable[] = [];
  /** Interior wall segments as XZ boxes in world space, for player collision. */
  colliders: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  hatch: THREE.Object3D | null = null;
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private hatchOpen = true;

  constructor(private sceneManager: SceneManager) {
    sceneManager.scene.add(this.group);
  }

  clear(): void {
    this.group.clear();
    this.interactables.length = 0;
    this.colliders.length = 0;
    this.hatch = null;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  static requiredModels(): string[] {
    return [
      'ext.space/platform_large',
      'ext.space/desk_computer',
      'ext.space/desk_computerScreen',
      'ext.space/desk_chair',
      'ext.space/machine_generator',
      'ext.space/machine_wireless',
      'ext.space/rail',
      'ext.space/rail_end',
      'ext.space/barrels',
      'ext.space/rocket_finsA',
      'ext.space/rocket_baseA',
      'ext.space/satelliteDish',
      'ext.space/structure_closed',
      'ext.space/stairs_short',
      'kit.factory/screen-wide',
      'kit.factory/lever-single',
      'kit.factory/warning-orange',
      'kit.station/container',
      'kit.station/container-tall',
      'ext.spacepack/Base_Large',
      'ext.spacepack/Building_L',
      'ext.industrial/building-k',
      'ext.street/Streetlight_Double',
    ];
  }

  async build(position: THREE.Vector3, rotationY: number): Promise<void> {
    this.clear();
    this.group.position.copy(position);
    this.group.rotation.y = 0; // The ship is axis-aligned so collision stays cheap.

    const hullMat = new THREE.MeshStandardMaterial({ color: 0x4d5257, roughness: 0.7, metalness: 0.55 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2e3336, roughness: 0.85, metalness: 0.3 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xb98a2a, roughness: 0.6, metalness: 0.4 });
    this.disposables.push(hullMat, floorMat, trimMat);

    const { halfW, halfD, height, floorY, hatchWidth } = SHIP;

    // ---- floor and ceiling
    const floor = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, 0.3, halfD * 2), floorMat);
    floor.position.set(0, floorY - 0.15, 0);
    floor.receiveShadow = true;
    this.group.add(floor);

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, 0.3, halfD * 2), hullMat);
    ceiling.position.set(0, floorY + height, 0);
    this.group.add(ceiling);

    // ---- walls, with a gap in the -Z wall for the hatch
    const wall = (w: number, d: number, x: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), hullMat);
      mesh.position.set(x, floorY + height / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.colliders.push({
        minX: position.x + x - w / 2,
        maxX: position.x + x + w / 2,
        minZ: position.z + z - d / 2,
        maxZ: position.z + z + d / 2,
      });
    };
    const t = 0.35;
    wall(halfW * 2, t, 0, halfD);                                  // back
    wall(t, halfD * 2, -halfW, 0);                                 // port
    wall(t, halfD * 2, halfW, 0);                                  // starboard
    const sideWall = (halfW * 2 - hatchWidth) / 2;
    wall(sideWall, t, -(hatchWidth / 2 + sideWall / 2), -halfD);   // front left
    wall(sideWall, t, hatchWidth / 2 + sideWall / 2, -halfD);      // front right

    // ---- hatch: a slab that drops to make the ramp
    const hatchGeom = new THREE.BoxGeometry(hatchWidth, 0.22, 4.4);
    const hatch = new THREE.Mesh(hatchGeom, trimMat);
    hatch.position.set(0, floorY - 0.1, -halfD - 2.0);
    hatch.rotation.x = -0.32;
    hatch.castShadow = true;
    this.group.add(hatch);
    this.hatch = hatch;
    this.disposables.push(hatchGeom);

    // ---- exterior silhouette so the ship reads from across the map
    const shell = await assets.instance('ext.space/rocket_baseA', 9);
    if (shell) {
      shell.position.set(0, -1.6, 2.2);
      shell.rotation.y = Math.PI;
      this.group.add(shell);
    }
    for (const sign of [-1, 1]) {
      const fin = await assets.instance('ext.space/rocket_finsA', 6.5);
      if (fin) {
        fin.position.set(sign * (halfW + 0.6), -0.4, 1.4);
        fin.rotation.y = sign > 0 ? -0.35 : 0.35;
        this.group.add(fin);
      }
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, floorY + 1.4, 6), hullMat);
      leg.position.set(sign * (halfW - 0.8), (floorY - 1.2) / 2, halfD - 0.9);
      this.group.add(leg);
    }
    const dish = await assets.instance('ext.space/satelliteDish', 3.2);
    if (dish) {
      dish.position.set(-halfW + 1.4, floorY + height + 0.2, halfD - 1.6);
      this.group.add(dish);
    }

    // ---- terminal desk on the starboard wall
    const desk = await assets.instance('ext.space/desk_computer', 1.9);
    if (desk) {
      desk.position.set(halfW - 1.5, floorY, -1.2);
      desk.rotation.y = -Math.PI / 2;
      this.group.add(desk);
    }
    const deskScreen = await assets.instance('ext.space/desk_computerScreen', 1.1);
    if (deskScreen) {
      deskScreen.position.set(halfW - 1.5, floorY + 0.9, -1.2);
      deskScreen.rotation.y = -Math.PI / 2;
      this.group.add(deskScreen);
    }
    const chair = await assets.instance('ext.space/desk_chair', 1.2);
    if (chair) {
      chair.position.set(halfW - 3.0, floorY, -1.2);
      chair.rotation.y = -Math.PI / 2;
      this.group.add(chair);
    }
    this.interactables.push({
      kind: 'terminal',
      position: new THREE.Vector3(position.x + halfW - 2.1, position.y + floorY + 1, position.z - 1.2),
      radius: 2.0,
      label: 'Use terminal',
    });
    this.sceneManager.registerLight({
      position: new THREE.Vector3(position.x + halfW - 1.6, position.y + floorY + 1.6, position.z - 1.2),
      color: 0xd8a83c,
      intensity: 0.7,
      range: 6,
      flicker: 0.04,
      level: -1,
      active: true,
    });

    // ---- monitor bank on the back wall
    const monitorScreen = await assets.instance('kit.factory/screen-wide', 2.6);
    if (monitorScreen) {
      monitorScreen.position.set(1.2, floorY + 1.9, halfD - 0.4);
      monitorScreen.rotation.y = Math.PI;
      this.group.add(monitorScreen);
    }
    this.interactables.push({
      kind: 'monitor',
      position: new THREE.Vector3(position.x + 1.2, position.y + floorY + 1.4, position.z + halfD - 1.4),
      radius: 2.2,
      label: 'Use site monitor',
    });
    this.sceneManager.registerLight({
      position: new THREE.Vector3(position.x + 1.2, position.y + floorY + 1.9, position.z + halfD - 1.2),
      color: 0x5fd08a,
      intensity: 0.55,
      range: 5.5,
      flicker: 0.2,
      level: -1,
      active: true,
    });

    // ---- launch lever by the hatch
    const lever = await assets.instance('kit.factory/lever-single', 1.4);
    if (lever) {
      lever.position.set(-halfW + 1.0, floorY, -halfD + 1.2);
      lever.rotation.y = Math.PI / 2;
      this.group.add(lever);
    }
    this.interactables.push({
      kind: 'lever',
      position: new THREE.Vector3(position.x - halfW + 1.0, position.y + floorY + 1, position.z - halfD + 1.2),
      radius: 1.8,
      label: 'Ship controls',
    });

    // ---- charging rack
    const charger = await assets.instance('ext.space/machine_wireless', 1.8);
    if (charger) {
      charger.position.set(-halfW + 1.4, floorY, 1.6);
      charger.rotation.y = Math.PI / 2;
      this.group.add(charger);
    }
    this.interactables.push({
      kind: 'charger',
      position: new THREE.Vector3(position.x - halfW + 1.9, position.y + floorY + 0.8, position.z + 1.6),
      radius: 1.6,
      label: 'Charge held equipment',
    });

    // ---- cargo dressing
    const generator = await assets.instance('ext.space/machine_generator', 2.1);
    if (generator) {
      generator.position.set(-halfW + 1.6, floorY, halfD - 1.6);
      this.group.add(generator);
    }
    for (let i = 0; i < 3; i++) {
      const railPiece = await assets.instance('ext.space/rail', 2.6);
      if (railPiece) {
        railPiece.position.set(-3.4 + i * 2.6, floorY, halfD - 3.2);
        this.group.add(railPiece);
      }
    }

    // ---- interior lighting: warm, dim, and the only reliable light in the game
    for (const [lx, lz, colour] of [
      [-2.6, -1.6, 0xffd9a0],
      [2.6, 1.8, 0xffd9a0],
      [0, -halfD + 0.8, 0xffb060],
    ] as [number, number, number][]) {
      this.sceneManager.registerLight({
        position: new THREE.Vector3(position.x + lx, position.y + floorY + height - 0.7, position.z + lz),
        color: colour,
        intensity: 1.5,
        range: 11,
        flicker: 0.03,
        level: -1,
        active: true,
      });
    }

    // A beacon on the roof: the thing you look for when it gets dark.
    const beaconGeom = new THREE.SphereGeometry(0.32, 10, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff4a2a });
    this.disposables.push(beaconGeom, beaconMat);
    const beacon = new THREE.Mesh(beaconGeom, beaconMat);
    beacon.position.set(0, floorY + height + 0.7, 0);
    this.group.add(beacon);
    this.sceneManager.registerLight({
      position: new THREE.Vector3(position.x, position.y + floorY + height + 0.7, position.z),
      color: 0xff4a2a,
      intensity: 2.6,
      range: 40,
      flicker: 0.45,
      level: -1,
      active: true,
    });
  }

  setHatch(open: boolean, dt: number): void {
    if (!this.hatch) return;
    this.hatchOpen = open;
    const target = open ? -0.32 : -1.62;
    this.hatch.rotation.x += Math.sign(target - this.hatch.rotation.x) * Math.min(Math.abs(target - this.hatch.rotation.x), dt * 0.9);
  }

  isHatchOpen(): boolean {
    return this.hatchOpen;
  }

  /** The Company depot: one counter, one bell, and a great deal of concrete. */
  async buildDepot(shipPosition: THREE.Vector3, counterOffset: { x: number; z: number }): Promise<void> {
    const cx = shipPosition.x + counterOffset.x;
    const cz = shipPosition.z + counterOffset.z;

    const concrete = new THREE.MeshStandardMaterial({ color: 0x585c58, roughness: 0.95, metalness: 0.05 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6a6f70, roughness: 0.45, metalness: 0.8 });
    this.disposables.push(concrete, steel);

    const pad = new THREE.Mesh(new THREE.BoxGeometry(70, 0.4, 46), concrete);
    pad.position.set(shipPosition.x + 8, shipPosition.y - 0.2, shipPosition.z);
    pad.receiveShadow = true;
    this.group.add(pad);

    const building = await assets.instance('ext.industrial/building-k', 26);
    if (building) {
      building.position.set(cx + 16, shipPosition.y, cz);
      building.rotation.y = -Math.PI / 2;
      this.group.add(building);
    }

    const counter = new THREE.Mesh(new THREE.BoxGeometry(7, 1.1, 3.2), steel);
    counter.position.set(cx, shipPosition.y + 0.55, cz);
    counter.castShadow = true;
    counter.receiveShadow = true;
    this.group.add(counter);
    this.colliders.push({ minX: cx - 3.5, maxX: cx + 3.5, minZ: cz - 1.6, maxZ: cz + 1.6 });

    const shutter = new THREE.Mesh(new THREE.BoxGeometry(7.4, 4.2, 0.4), steel);
    shutter.position.set(cx, shipPosition.y + 2.6, cz + 2.4);
    this.group.add(shutter);

    const bellGeom = new THREE.SphereGeometry(0.22, 10, 8);
    const bellMat = new THREE.MeshStandardMaterial({ color: 0xc9a13a, roughness: 0.3, metalness: 0.9 });
    this.disposables.push(bellGeom, bellMat);
    const bell = new THREE.Mesh(bellGeom, bellMat);
    bell.position.set(cx + 2.4, shipPosition.y + 1.2, cz - 0.6);
    this.group.add(bell);
    this.interactables.push({
      kind: 'counter',
      position: new THREE.Vector3(cx + 2.4, shipPosition.y + 1.2, cz - 0.6),
      radius: 2.2,
      label: 'Ring for appraisal',
    });

    this.sceneManager.registerLight({
      position: new THREE.Vector3(cx, shipPosition.y + 4.6, cz - 1),
      color: 0xfff0cc,
      intensity: 2.2,
      range: 26,
      flicker: 0.06,
      level: -1,
      active: true,
    });

    for (const side of [-1, 1]) {
      const lamp = await assets.instance('ext.street/Streetlight_Double', 7);
      if (lamp) {
        lamp.position.set(shipPosition.x + 4, shipPosition.y, shipPosition.z + side * 12);
        this.group.add(lamp);
      }
      this.sceneManager.registerLight({
        position: new THREE.Vector3(shipPosition.x + 4, shipPosition.y + 6.4, shipPosition.z + side * 12),
        color: 0xd9e2ea,
        intensity: 1.4,
        range: 24,
        flicker: 0.02,
        level: -1,
        active: true,
      });
    }
  }
}
