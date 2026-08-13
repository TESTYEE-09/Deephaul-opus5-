import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Asset layer.
 *
 * Everything under client/public/assets is CC0 art fetched by tools/fetch-assets.mjs.
 * The kits were authored at wildly different scales, so nothing is used raw:
 * each model is measured on load, scaled to a requested size in metres, and
 * re-centred so the placement code can treat every prop the same way.
 */

export interface Catalog {
  generated: string;
  groups: Record<string, { dir: string; names: string[] }>;
  hero: { id: string; file: string }[];
  textures: string[];
  audio: { id: string; cat: string; file: string }[];
}

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface LoadedModel {
  /** Original scene graph, cloned on demand for animated or unique instances. */
  scene: THREE.Group;
  /** Flattened parts, pre-baked to a unit height of 1, ready for instancing. */
  parts: ModelPart[];
  /** Bounding box after normalisation (height exactly 1). */
  size: THREE.Vector3;
  /** Scale factor applied to reach unit height. */
  unitScale: number;
  animations: THREE.AnimationClip[];
}

const BASE = 'assets/';

export class AssetLibrary {
  catalog: Catalog | null = null;
  private loader = new GLTFLoader();
  private textureLoader = new THREE.TextureLoader();
  private models = new Map<string, Promise<LoadedModel | null>>();
  private textures = new Map<string, THREE.Texture>();
  private missing = new Set<string>();
  private onProgress: ((loaded: number, total: number, label: string) => void) | null = null;
  private loadedCount = 0;
  private totalCount = 0;

  setProgress(fn: (loaded: number, total: number, label: string) => void): void {
    this.onProgress = fn;
  }

  async loadCatalog(): Promise<Catalog> {
    const res = await fetch(`${BASE}catalog.json`);
    if (!res.ok) throw new Error(`asset catalog missing — run: node tools/fetch-assets.mjs`);
    this.catalog = (await res.json()) as Catalog;
    return this.catalog;
  }

  /** Resolves "group/name" to a URL, or null when the asset was never fetched. */
  resolve(ref: string): string | null {
    if (!this.catalog) return null;
    const slash = ref.indexOf('/');
    if (slash < 0) return null;
    const group = ref.slice(0, slash);
    const name = ref.slice(slash + 1);
    if (group === 'hero') {
      const hero = this.catalog.hero.find((h) => h.id === name);
      return hero ? BASE + hero.file : null;
    }
    const g = this.catalog.groups[group];
    if (!g || !g.names.includes(name)) return null;
    return `${BASE}${g.dir}${name}.glb`;
  }

  has(ref: string): boolean {
    return this.resolve(ref) !== null;
  }

  /** Every model name in a group, for content that wants to pick at random. */
  namesIn(group: string): string[] {
    return this.catalog?.groups[group]?.names ?? [];
  }

  load(ref: string): Promise<LoadedModel | null> {
    const cached = this.models.get(ref);
    if (cached) return cached;

    const url = this.resolve(ref);
    if (!url) {
      if (!this.missing.has(ref)) {
        this.missing.add(ref);
        console.warn(`[assets] no such model: ${ref}`);
      }
      const empty = Promise.resolve(null);
      this.models.set(ref, empty);
      return empty;
    }

    this.totalCount++;
    const promise = new Promise<LoadedModel | null>((resolve) => {
      this.loader.load(
        url,
        (gltf) => {
          this.loadedCount++;
          this.onProgress?.(this.loadedCount, this.totalCount, ref);
          resolve(normalise(gltf.scene as THREE.Group, gltf.animations));
        },
        undefined,
        () => {
          this.loadedCount++;
          console.warn(`[assets] failed to load ${url}`);
          resolve(null);
        },
      );
    });
    this.models.set(ref, promise);
    return promise;
  }

  /** Loads many refs at once and reports progress against the whole batch. */
  async preload(refs: string[]): Promise<void> {
    const unique = [...new Set(refs)].filter((r) => this.has(r));
    await Promise.all(unique.map((r) => this.load(r)));
  }

  /**
   * A ready-to-place clone, scaled so its tallest axis matches `fit` metres and
   * its origin sits on the floor at its horizontal centre.
   */
  async instance(ref: string, fit: number): Promise<THREE.Object3D | null> {
    const model = await this.load(ref);
    if (!model) return null;
    const obj = model.scene.clone(true);
    obj.scale.setScalar(fit);
    return obj;
  }

  texture(name: string, kind: 'Color' | 'NormalGL' | 'Roughness' = 'Color'): THREE.Texture | null {
    const key = `${name}_${kind}`;
    const cached = this.textures.get(key);
    if (cached) return cached;
    if (!this.catalog?.textures.includes(name)) return null;
    const tex = this.textureLoader.load(`${BASE}textures/${name}_${kind}.jpg`);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (kind === 'Color') tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, tex);
    return tex;
  }

  audioUrl(id: string): string | null {
    const entry = this.catalog?.audio.find((a) => a.id === id);
    return entry ? BASE + entry.file : null;
  }

  audioMatching(pattern: RegExp, category?: string): string[] {
    if (!this.catalog) return [];
    return this.catalog.audio
      .filter((a) => (category ? a.cat === category : true) && pattern.test(a.id))
      .map((a) => a.id);
  }
}

/**
 * Bakes the model to unit height with its base at y=0, and flattens it into
 * geometry/material pairs so hundreds of copies can share one draw call.
 */
function normalise(scene: THREE.Group, animations: THREE.AnimationClip[]): LoadedModel {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const height = Math.max(size.x, size.y, size.z) || 1;
  const unitScale = 1 / height;

  const root = new THREE.Group();
  root.add(scene);
  scene.scale.setScalar(unitScale);
  scene.position.set(
    -((box.min.x + box.max.x) / 2) * unitScale,
    -box.min.y * unitScale,
    -((box.min.z + box.max.z) / 2) * unitScale,
  );
  root.updateMatrixWorld(true);

  const parts: ModelPart[] = [];
  const hasSkin = animations.length > 0;
  if (!hasSkin) {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        tuneMaterial(material);
        parts.push({ geometry, material });
      }
    });
  } else {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) tuneMaterial(material);
    });
  }

  const normalisedSize = size.clone().multiplyScalar(unitScale);
  return { scene: root, parts, size: normalisedSize, unitScale, animations };
}

/**
 * The kits ship with bright, cheerful materials meant for daylight scenes.
 * Knocking down the specular response and killing emissive keeps them readable
 * in a facility lit by one torch.
 */
function tuneMaterial(material: THREE.Material): void {
  const std = material as THREE.MeshStandardMaterial;
  if (std.isMeshStandardMaterial) {
    std.roughness = Math.min(1, std.roughness * 0.5 + 0.55);
    std.metalness = Math.min(std.metalness, 0.35);
    if (std.emissive && std.emissiveIntensity > 0) std.emissiveIntensity = Math.min(std.emissiveIntensity, 0.4);
    if (std.map) std.map.anisotropy = 4;
  }
  material.side = THREE.FrontSide;
  material.shadowSide = THREE.BackSide;
}

export const assets = new AssetLibrary();
