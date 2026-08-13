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
 *
 * The interior is dressed to feel like a leased workboat nobody owns: a bunk
 * alcove, a cockpit nook, cargo that never quite gets stowed, and conduit runs
 * that were cheaper to bolt on than design. Everything solid gets a box
 * collider so the player cannot walk through the story.
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

/** A solid prop: an XZ box collider in ship-local metres (x, z, w, d). */
interface ShipProp {
  x: number;
  z: number;
  w: number;
  d: number;
}

export class ShipView {
  group = new THREE.Group();
  interactables: ShipInteractable[] = [];
  /** Interior wall segments as XZ boxes in world space, for player collision. */
  colliders: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  hatch: THREE.Object3D | null = null;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
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
      'ext.space/desk_computer',
      'ext.space/desk_computerScreen',
      'ext.space/desk_chair',
      'ext.space/desk_chairStool',
      'ext.space/machine_generator',
      'ext.space/machine_wireless',
      'ext.space/rocket_finsA',
      'ext.space/rocket_baseA',
      'ext.space/satelliteDish',
      'kit.factory/screen-wide',
      'kit.factory/lever-single',
      'kit.factory/warning-orange',
      'kit.factory/arrow-basic',
      'kit.factory/box-large',
      'kit.factory/box-wide',
      'kit.station/container',
      'kit.station/container-tall',
      'kit.station/container-wide',
      'kit.station/bed-single',
      'kit.station/bed-single-cover',
      'kit.station/computer',
      'kit.station/computer-screen',
      'kit.station/table',
      'kit.station/chair',
      'kit.station/wall-switch',
      'kit.scifi/Details_Vent_2',
      'kit.scifi/Details_Plate_Large',
      'ext.survival/barrel',
      'ext.industrial/building-k',
      'ext.street/Streetlight_Double',
    ];
  }

  async build(position: THREE.Vector3, rotationY: number): Promise<void> {
    this.clear();
    this.group.position.copy(position);
    this.group.rotation.y = 0; // The ship is axis-aligned so collision stays cheap.

    const { halfW, halfD, height, floorY, hatchWidth } = SHIP;

    // ---- materials
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x4d5257, roughness: 0.7, metalness: 0.55 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3f42, roughness: 0.8, metalness: 0.45 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xb98a2a, roughness: 0.6, metalness: 0.4 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x2e5f66, roughness: 0.55, metalness: 0.5 });
    const chevronMat = new THREE.MeshStandardMaterial({ color: 0x8a7a20, roughness: 0.7, metalness: 0.3 });
    this.disposables.push(hullMat, darkMat, trimMat, accentMat, chevronMat);

    // Worn deck plating: a canvas grid with scuffs and grime, no external file.
    const floorTex = this.makePlateTexture(0x2e3336, 0x262b2d, 0x343a3c);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0.3 });
    const ceilTex = this.makePlateTexture(0x454a4e, 0x3d4245, 0x4b5054);
    const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.8, metalness: 0.5 });
    this.disposables.push(floorMat, ceilMat);

    // ---- floor and ceiling
    const floor = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, 0.3, halfD * 2), floorMat);
    floor.position.set(0, floorY - 0.15, 0);
    floor.receiveShadow = true;
    this.group.add(floor);

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, 0.3, halfD * 2), ceilMat);
    ceiling.position.set(0, floorY + height, 0);
    this.group.add(ceiling);

    // ---- walls, with a gap in the -Z wall for the hatch
    const wall = (w: number, d: number, x: number, z: number, mat = hullMat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), mat);
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

    // ---- hull ribs: vertical stanchions at regular intervals read as
    // structural, and hide the seam where wall meets ceiling.
    for (const z of [-4, -2, 0, 2, 4]) {
      for (const side of [-1, 1]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.18, height - 0.7, 0.22), darkMat);
        rib.position.set(side * (halfW - 0.09), floorY + (height - 0.7) / 2 + 0.2, z);
        this.group.add(rib);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.3), darkMat);
        cap.position.set(side * (halfW - 0.09), floorY + height - 0.42, z);
        this.group.add(cap);
      }
    }

    // ---- ceiling conduit runs: bolted-on pipework along the whole length.
    for (const z of [-3.6, -1.2, 1.2, 3.6]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, halfW * 2 - 0.8, 8), darkMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, floorY + height - 0.52, z);
      this.group.add(pipe);
      for (const x of [-halfW + 0.5, halfW - 0.5]) {
        const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 6), darkMat);
        drop.position.set(x, floorY + height - 0.31, z);
        this.group.add(drop);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.3), accentMat);
        box.position.set(x, floorY + height - 0.16, z);
        this.group.add(box);
      }
    }

    // ---- hatch: a slab that drops to make the ramp
    const hatchGeom = new THREE.BoxGeometry(hatchWidth, 0.22, 4.4);
    const hatch = new THREE.Mesh(hatchGeom, trimMat);
    hatch.position.set(0, floorY - 0.1, -halfD - 2.0);
    hatch.rotation.x = -0.32;
    hatch.castShadow = true;
    this.group.add(hatch);
    this.hatch = hatch;
    this.disposables.push(hatchGeom);

    // Chevron strips flanking the hatch: the only spot of Company yellow aboard.
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.22, height, 0.3), chevronMat);
      strip.position.set(side * (hatchWidth / 2 + 0.35), floorY + height / 2, -halfD + 0.05);
      this.group.add(strip);
      this.colliders.push({
        minX: position.x + side * (hatchWidth / 2 + 0.35) - 0.11,
        maxX: position.x + side * (hatchWidth / 2 + 0.35) + 0.11,
        minZ: position.z - halfD - 0.05,
        maxZ: position.z - halfD + 0.35,
      });
    }

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

    // ---- the crew quarters (port, forward): a bunk alcove with a reading lamp
    // Beds normalise to their longest axis, so fit is the length in metres.
    await this.addProp('kit.station/bed-single', { x: -5.6, z: -2.0, rotY: Math.PI / 2, fit: 2.2 });
    await this.addProp('kit.station/bed-single-cover', { x: -5.6, z: -2.0, rotY: Math.PI / 2, fit: 2.24 });
    await this.addProp('kit.station/bed-single', { x: -5.6, z: -2.0, y: 0.86, rotY: Math.PI / 2, fit: 2.18 });
    // The upper bunk sits on a frame that matches the beds' footprint.
    const bunkFrame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 0.95), darkMat);
    bunkFrame.position.set(-5.6, floorY + 0.86, -2.0);
    this.group.add(bunkFrame);
    this.addBoxCollider(-5.6, -2.0, 2.4, 1.0);

    // ---- cockpit nook (port, forward of the lever): the ship's own console
    await this.addProp('kit.station/computer', { x: -5.3, z: -4.9, rotY: -Math.PI / 2, fit: 0.95 });
    await this.addProp('kit.station/computer-screen', { x: -5.3, z: -4.95, rotY: -Math.PI / 2, fit: 0.8 });
    await this.addProp('ext.space/desk_chairStool', { x: -4.5, z: -4.9, rotY: Math.PI / 2, fit: 0.8 });
    this.addBoxCollider(-5.35, -4.9, 0.9, 1.1);
    this.sceneManager.registerLight({
      position: new THREE.Vector3(position.x - 5.3, position.y + floorY + 1.2, position.z - 4.9),
      color: 0x6fd0e0,
      intensity: 0.5,
      range: 4,
      flicker: 0.02,
      level: -1,
      active: true,
    });

    // ---- mess nook (starboard, forward): table, two stools, a wall switch
    await this.addProp('kit.station/table', { x: 5.2, z: -4.4, rotY: Math.PI / 2, fit: 1.1 });
    await this.addProp('kit.station/chair', { x: 4.5, z: -4.4, rotY: -Math.PI / 2, fit: 0.75 });
    await this.addProp('kit.station/chair', { x: 4.5, z: -3.6, rotY: Math.PI / 2, fit: 0.75 });
    this.addBoxCollider(5.0, -4.4, 1.3, 1.2);
    this.addBoxCollider(4.45, -4.4, 0.55, 0.55);
    const wallSwitch = await assets.instance('kit.station/wall-switch', 0.5);
    if (wallSwitch) {
      wallSwitch.position.set(halfW - 0.28, floorY + 1.35, -4.4);
      wallSwitch.rotation.y = -Math.PI / 2;
      this.group.add(wallSwitch);
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
    const leverSign = await assets.instance('kit.factory/warning-orange', 0.7);
    if (leverSign) {
      leverSign.position.set(-halfW + 0.2, floorY + 1.5, -halfD + 1.2);
      leverSign.rotation.y = Math.PI / 2;
      this.group.add(leverSign);
    }

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

    // ---- cargo dressing: generator, fuel, and the junk that never got stowed
    const generator = await assets.instance('ext.space/machine_generator', 2.1);
    if (generator) {
      generator.position.set(-halfW + 1.6, floorY, halfD - 1.6);
      this.group.add(generator);
    }
    const fuelBarrel = await assets.instance('ext.survival/barrel', 1.1);
    if (fuelBarrel) {
      fuelBarrel.position.set(-halfW + 1.5, floorY, halfD - 0.5);
      this.group.add(fuelBarrel);
    }
    this.addBoxCollider(-halfW + 1.6, halfD - 1.6, 1.6, 1.6);
    this.addBoxCollider(-halfW + 1.5, halfD - 0.5, 0.9, 0.9);

    // Cargo stack on the starboard side: one wide container, a tall one, boxes.
    // Container kits are shipping-crate shaped: longest axis ~2.2 m.
    await this.addProp('kit.station/container-wide', { x: 5.0, z: 1.4, rotY: Math.PI / 2, fit: 2.2 });
    await this.addProp('kit.station/container-tall', { x: 4.7, z: 3.1, rotY: Math.PI / 2, fit: 2.4 });
    await this.addProp('kit.factory/box-wide', { x: 4.9, z: 0.6, rotY: 0.4, fit: 1.2 });
    await this.addProp('kit.factory/box-large', { x: 4.2, z: 0.9, rotY: -0.5, fit: 1.2 });
    await this.addProp('kit.factory/box-large', { x: 5.3, z: 3.4, y: 2.4, rotY: 0.2, fit: 0.8 });
    this.addBoxCollider(4.95, 1.4, 2.3, 1.3);
    this.addBoxCollider(4.7, 3.1, 1.3, 1.3);
    this.addBoxCollider(4.55, 0.75, 1.2, 1.2);

    // Containers flanking the monitor on the back wall.
    await this.addProp('kit.station/container', { x: -2.3, z: 4.5, rotY: 0, fit: 2.2 });
    await this.addProp('kit.station/container-tall', { x: 3.5, z: 4.5, rotY: 0, fit: 2.4 });
    this.addBoxCollider(-2.3, 4.5, 1.2, 2.2);
    this.addBoxCollider(3.5, 4.5, 1.3, 1.3);

    // ---- wall dressing: vents and stencilled panels
    for (const z of [-4.4, -2.0, 0.4, 2.8]) {
      const vent = await assets.instance('kit.scifi/Details_Vent_2', 0.9);
      if (vent) {
        vent.position.set(halfW - 0.28, floorY + 1.9, z);
        vent.rotation.y = -Math.PI / 2;
        this.group.add(vent);
      }
      const vent2 = await assets.instance('kit.scifi/Details_Vent_2', 0.9);
      if (vent2) {
        vent2.position.set(-halfW + 0.28, floorY + 1.9, z);
        vent2.rotation.y = Math.PI / 2;
        this.group.add(vent2);
      }
    }
    const plate = await assets.instance('kit.scifi/Details_Plate_Large', 1.6);
    if (plate) {
      plate.position.set(0, floorY + 1.9, halfD - 0.3);
      plate.rotation.y = Math.PI;
      this.group.add(plate);
    }
    const arrow = await assets.instance('kit.factory/arrow-basic', 1.0);
    if (arrow) {
      arrow.position.set(0, floorY + 1.7, -halfD + 0.35);
      this.group.add(arrow);
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
    // Cold worklight over the cargo stack, and a dim bunk lamp.
    this.sceneManager.registerLight({
      position: new THREE.Vector3(position.x + 4.9, position.y + floorY + 2.3, position.z + 2.2),
      color: 0xdfe8f0,
      intensity: 0.85,
      range: 7,
      flicker: 0.05,
      level: -1,
      active: true,
    });
    this.sceneManager.registerLight({
      position: new THREE.Vector3(position.x - 5.4, position.y + floorY + 1.55, position.z - 1.7),
      color: 0xffb060,
      intensity: 0.55,
      range: 3.8,
      flicker: 0.08,
      level: -1,
      active: true,
    });

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

  /** Place an asset on the deck. fit is the model height in metres. */
  private async addProp(
    ref: string,
    at: { x: number; z: number; y?: number; rotY?: number; fit: number },
  ): Promise<void> {
    const obj = await assets.instance(ref, at.fit);
    if (!obj) return;
    obj.position.set(at.x, SHIP.floorY + (at.y ?? 0), at.z);
    if (at.rotY) obj.rotation.y = at.rotY;
    this.group.add(obj);
  }

  private addBoxCollider(x: number, z: number, w: number, d: number): void {
    const base = this.group.position;
    this.colliders.push({
      minX: base.x + x - w / 2,
      maxX: base.x + x + w / 2,
      minZ: base.z + z - d / 2,
      maxZ: base.z + z + d / 2,
    });
  }

  /**
   * A seamless deck-plate texture painted on a canvas: a grid of plates with
   * per-plate tint variation, darker seams, grime streaks and scuff patches.
   * No network cost, no license file, and it never repeats obviously.
   */
  private makePlateTexture(base: number, dark: number, light: number): THREE.Texture {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const b = new THREE.Color(base);
    const d = new THREE.Color(dark);
    const l = new THREE.Color(light);
    const platePx = size / 8;
    for (let gy = 0; gy < 8; gy++) {
      for (let gx = 0; gx < 8; gx++) {
        const t = Math.random();
        const colour = t < 0.18 ? d : t > 0.86 ? l : b;
        ctx.fillStyle = `#${colour.getHexString()}`;
        ctx.fillRect(gx * platePx, gy * platePx, platePx, platePx);
        // Panel seam.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(gx * platePx, gy * platePx, platePx, 2);
        ctx.fillRect(gx * platePx, gy * platePx, 2, platePx);
        // Bolt dimples at the corners.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        for (const [bx, by] of [
          [4, 4],
          [platePx - 4, 4],
          [4, platePx - 4],
          [platePx - 4, platePx - 4],
        ] as const) {
          ctx.beginPath();
          ctx.arc(gx * platePx + bx, gy * platePx + by, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        // Scuffs and grime, sparse.
        if (Math.random() < 0.4) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
          ctx.beginPath();
          ctx.ellipse(
            gx * platePx + platePx * (0.2 + Math.random() * 0.6),
            gy * platePx + platePx * (0.2 + Math.random() * 0.6),
            platePx * (0.1 + Math.random() * 0.2),
            platePx * (0.05 + Math.random() * 0.1),
            Math.random() * Math.PI,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
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
      const poleBase = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.4, 8), steel);
      poleBase.position.set(shipPosition.x + 4, shipPosition.y + 0.2, shipPosition.z + side * 12);
      this.group.add(poleBase);
    }
  }
}
