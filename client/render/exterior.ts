import * as THREE from 'three';
import { RNG } from '@shared/rng.ts';
import type { BiomeId, MoonDef } from '@shared/content/moons.ts';
import { makeTerrainSampler, type ExteriorLayout } from '@shared/world/exterior.ts';
import { assets, type LoadedModel } from '../assets.ts';
import type { SceneManager } from './scene.ts';

/** Ground material per biome, using the CC0 PBR sets we fetched. */
const BIOME_GROUND: Record<BiomeId, { texture: string; tint: number; repeat: number }> = {
  ridge: { texture: 'Rock063', tint: 0x8d8f86, repeat: 90 },
  ash: { texture: 'Ground103', tint: 0x77706a, repeat: 80 },
  yard: { texture: 'Asphalt025C', tint: 0x6e716c, repeat: 110 },
  saltflat: { texture: 'Concrete046', tint: 0x9a978e, repeat: 70 },
  marsh: { texture: 'Ground054', tint: 0x646f5c, repeat: 85 },
  crater: { texture: 'Rock063', tint: 0x7a7d84, repeat: 95 },
  bone: { texture: 'Ground103', tint: 0x6c6660, repeat: 80 },
};

export interface EntranceMarker {
  anchor: number;
  kind: 'main' | 'fire';
  position: THREE.Vector3;
  /** Where the player is put down when they step through. */
  facing: number;
}

export class ExteriorView {
  group = new THREE.Group();
  entrances: EntranceMarker[] = [];
  /** Cylindrical colliders for scattered props, in world XZ. */
  colliders: { x: number; z: number; r: number }[] = [];
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private terrainMesh: THREE.Mesh | null = null;

  constructor(private sceneManager: SceneManager) {
    sceneManager.scene.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  clear(): void {
    this.group.clear();
    this.entrances.length = 0;
    this.colliders.length = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.terrainMesh = null;
  }

  static requiredModels(ext: ExteriorLayout): string[] {
    const refs = new Set<string>();
    for (const prop of ext.props) refs.add(prop.model);
    for (const entrance of ext.entrances) if (entrance.model) refs.add(entrance.model);
    return [...refs];
  }

  async build(ext: ExteriorLayout, moon: MoonDef): Promise<void> {
    this.clear();
    const sample = makeTerrainSampler(ext);

    this.buildTerrain(ext, moon, sample);
    await this.buildProps(ext);
    await this.buildEntrances(ext, sample);
  }

  // ---------------------------------------------------------------- terrain

  private buildTerrain(ext: ExteriorLayout, moon: MoonDef, sample: (x: number, z: number) => number): void {
    const span = ext.size * 2.4;
    const segments = 190;
    const geometry = new THREE.PlaneGeometry(span, span, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const base = new THREE.Color(BIOME_GROUND[moon.biome].tint);
    const shade = new THREE.Color();

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const h = sample(x, z);
      position.setY(i, h);
      // Vertex tint by height so the silhouette reads even in heavy fog.
      const t = THREE.MathUtils.clamp(0.62 + h * 0.035, 0.35, 1.1);
      shade.copy(base).multiplyScalar(t);
      colors[i * 3] = shade.r;
      colors[i * 3 + 1] = shade.g;
      colors[i * 3 + 2] = shade.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const set = BIOME_GROUND[moon.biome];
    const map = assets.texture(set.texture, 'Color');
    const normal = assets.texture(set.texture, 'NormalGL');
    const rough = assets.texture(set.texture, 'Roughness');
    for (const tex of [map, normal, rough]) {
      if (!tex) continue;
      tex.repeat.set(set.repeat, set.repeat);
      tex.needsUpdate = true;
    }

    const material = new THREE.MeshStandardMaterial({
      map: map ?? undefined,
      normalMap: normal ?? undefined,
      roughnessMap: rough ?? undefined,
      vertexColors: true,
      roughness: 0.98,
      metalness: 0.02,
    });
    this.disposables.push(geometry, material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.terrainMesh = mesh;
  }

  // ------------------------------------------------------------------ props

  private async buildProps(ext: ExteriorLayout): Promise<void> {
    const batches = new Map<string, { model: LoadedModel; matrices: THREE.Matrix4[] }>();
    for (const prop of ext.props) {
      const model = await assets.load(prop.model);
      if (!model) continue;
      let batch = batches.get(prop.model);
      if (!batch) {
        batch = { model, matrices: [] };
        batches.set(prop.model, batch);
      }
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(prop.x, prop.y - 0.15, prop.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), prop.rotY),
        new THREE.Vector3(prop.scale, prop.scale, prop.scale),
      );
      batch.matrices.push(m);
      if (prop.collide > 0) this.colliders.push({ x: prop.x, z: prop.z, r: prop.collide });
    }

    for (const [ref, batch] of batches) {
      for (const part of batch.model.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, batch.matrices.length);
        for (let i = 0; i < batch.matrices.length; i++) mesh.setMatrixAt(i, batch.matrices[i]);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.name = ref;
        this.group.add(mesh);
      }
    }
  }

  // -------------------------------------------------------------- entrances

  private async buildEntrances(ext: ExteriorLayout, sample: (x: number, z: number) => number): Promise<void> {
    for (const entrance of ext.entrances) {
      const shell = entrance.model ? await assets.load(entrance.model) : null;
      const pos = new THREE.Vector3(entrance.x, entrance.y, entrance.z);

      if (shell) {
        const obj = shell.scene.clone(true);
        obj.scale.setScalar(entrance.scale);
        obj.position.copy(pos);
        obj.rotation.y = entrance.rotY;
        obj.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        this.group.add(obj);
        this.colliders.push({ x: entrance.x, z: entrance.z, r: entrance.scale * 0.34 });
      }

      // The doorway itself: a dark recess with a light over it so it is
      // findable in fog from a distance, which is the whole point.
      const doorway = new THREE.Group();
      const frameGeom = new THREE.BoxGeometry(3.4, 3.2, 0.5);
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2c28, roughness: 0.9, metalness: 0.3 });
      const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      this.disposables.push(frameGeom, frameMat, voidMat);
      const frame = new THREE.Mesh(frameGeom, frameMat);
      frame.position.y = 1.6;
      doorway.add(frame);
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.7), voidMat);
      mouth.position.set(0, 1.4, 0.3);
      doorway.add(mouth);

      const offset = entrance.kind === 'main' ? entrance.scale * 0.32 : 2.4;
      const dx = Math.sin(entrance.rotY) * offset;
      const dz = Math.cos(entrance.rotY) * offset;
      const doorX = entrance.x + dx;
      const doorZ = entrance.z + dz;
      doorway.position.set(doorX, sample(doorX, doorZ), doorZ);
      doorway.rotation.y = entrance.rotY;
      this.group.add(doorway);

      this.sceneManager.registerLight({
        position: new THREE.Vector3(doorX, doorway.position.y + 3.4, doorZ),
        color: entrance.kind === 'main' ? 0xffc266 : 0xff5a3c,
        intensity: entrance.kind === 'main' ? 1.6 : 0.9,
        range: entrance.kind === 'main' ? 26 : 15,
        flicker: 0.12,
        level: -1,
        active: true,
      });

      this.entrances.push({
        anchor: entrance.anchor,
        kind: entrance.kind,
        position: new THREE.Vector3(doorX, doorway.position.y, doorZ),
        facing: entrance.rotY,
      });
    }
  }
}
