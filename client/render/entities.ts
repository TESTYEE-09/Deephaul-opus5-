import * as THREE from 'three';
import { MONSTERS_BY_ID } from '@shared/content/monsters.ts';
import { SCRAP_BY_ID } from '@shared/content/scrap.ts';
import { EQUIPMENT_BY_ID } from '@shared/content/equipment.ts';
import type { MonsterSnapshot, PlayerSnapshot, WorldItemSnapshot } from '@shared/protocol.ts';
import { assets, type LoadedModel } from '../assets.ts';
import { NetClient, net, type Interpolated } from '../net.ts';
import type { DynamicLight, SceneManager } from './scene.ts';
import { INTERIOR_ORIGIN_X } from './facility.ts';

const CREW_MODELS = [
  'char.men/Worker',
  'char.men/Spacesuit',
  'char.men/Casual',
  'char.men/Punk',
  'char.women/Casual',
  'char.women/Adventurer',
  'char.men/Farmer',
  'char.men/Swat',
];

interface Rig {
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
}

interface PlayerEntity {
  id: number;
  rig: Rig;
  light: DynamicLight;
  nameTag: THREE.Sprite;
  lastX: number;
  lastZ: number;
  speed: number;
}

interface MonsterEntity {
  id: number;
  defId: string;
  rig: Rig;
  light: DynamicLight | null;
}

interface ItemEntity {
  id: number;
  object: THREE.Object3D;
  light: DynamicLight | null;
  defId: string;
}

export class EntityView {
  group = new THREE.Group();
  private players = new Map<number, PlayerEntity>();
  private monsters = new Map<number, MonsterEntity>();
  private items = new Map<number, ItemEntity>();
  private pendingPlayers = new Set<number>();
  private pendingMonsters = new Set<number>();
  private pendingItems = new Set<number>();

  constructor(private sceneManager: SceneManager) {
    sceneManager.scene.add(this.group);
  }

  static requiredModels(): string[] {
    return [...CREW_MODELS, ...[...MONSTERS_BY_ID.values()].map((m) => m.model)];
  }

  clear(): void {
    for (const p of this.players.values()) this.sceneManager.removeLight(p.light);
    for (const m of this.monsters.values()) if (m.light) this.sceneManager.removeLight(m.light);
    for (const i of this.items.values()) if (i.light) this.sceneManager.removeLight(i.light);
    this.players.clear();
    this.monsters.clear();
    this.items.clear();
    this.group.clear();
  }

  // -------------------------------------------------------------- per frame

  update(dt: number, now: number, selfId: number, firstPerson: boolean): void {
    this.syncPlayers(dt, now, selfId, firstPerson);
    this.syncMonsters(dt, now);
    this.syncItems();
  }

  private syncPlayers(dt: number, now: number, selfId: number, firstPerson: boolean): void {
    for (const [id, entry] of net.players) {
      if (!this.players.has(id) && !this.pendingPlayers.has(id)) {
        this.pendingPlayers.add(id);
        void this.spawnPlayer(id, entry.next.skin);
      }
      const entity = this.players.get(id);
      if (!entity) continue;

      const snap = entry.next;
      const pos = NetClient.lerpSnapshot(entry, now);
      const worldX = snap.level >= 0 ? INTERIOR_ORIGIN_X + pos.x - INTERIOR_ORIGIN_X : pos.x;
      entity.rig.root.position.set(pos.x, pos.y, pos.z);
      entity.rig.root.rotation.y = pos.yaw + Math.PI;

      const moved = Math.hypot(pos.x - entity.lastX, pos.z - entity.lastZ);
      entity.speed = entity.speed * 0.75 + (moved / Math.max(dt, 1e-3)) * 0.25;
      entity.lastX = pos.x;
      entity.lastZ = pos.z;

      const dead = snap.state !== 'alive';
      entity.rig.root.visible = !(id === selfId && firstPerson) && !dead;

      // The crewmate's torch: a light on their model, so you can see who is
      // where from across a dark room without any UI at all.
      entity.light.position.set(pos.x, pos.y + 1.5, pos.z);
      entity.light.level = snap.level;
      entity.light.active = (snap.flags & 8) !== 0 && !dead && !(id === selfId && firstPerson);

      entity.nameTag.position.set(pos.x, pos.y + 2.15, pos.z);
      entity.nameTag.visible = !dead && id !== selfId;

      const clip = dead ? 'death' : entity.speed > 4.4 ? 'run' : entity.speed > 0.35 ? 'walk' : 'idle';
      playClip(entity.rig, clip, dt);
      entity.rig.mixer?.update(dt);
    }

    for (const [id, entity] of this.players) {
      if (net.players.has(id)) continue;
      this.group.remove(entity.rig.root);
      this.group.remove(entity.nameTag);
      this.sceneManager.removeLight(entity.light);
      this.players.delete(id);
    }
  }

  private async spawnPlayer(id: number, skin: number): Promise<void> {
    const ref = CREW_MODELS[skin % CREW_MODELS.length];
    const model = await assets.load(ref);
    this.pendingPlayers.delete(id);
    if (!model || this.players.has(id)) return;

    const rig = makeRig(model, 1.78);
    this.group.add(rig.root);

    const snapshot = net.players.get(id)?.next;
    const nameTag = makeNameTag(snapshot?.name ?? '');
    this.group.add(nameTag);

    const light = this.sceneManager.registerLight({
      position: new THREE.Vector3(),
      color: 0xfff0d8,
      intensity: 1.3,
      range: 13,
      flicker: 0.05,
      level: -1,
      active: false,
    });

    this.players.set(id, { id, rig, light, nameTag, lastX: 0, lastZ: 0, speed: 0 });
  }

  private syncMonsters(dt: number, now: number): void {
    for (const [id, entry] of net.monsters) {
      if (!this.monsters.has(id) && !this.pendingMonsters.has(id)) {
        this.pendingMonsters.add(id);
        void this.spawnMonster(id, entry.next.defId);
      }
      const entity = this.monsters.get(id);
      if (!entity) continue;
      const snap = entry.next;
      const pos = NetClient.lerpSnapshot(entry, now);
      const x = snap.level >= 0 ? pos.x : pos.x;
      entity.rig.root.position.set(x, pos.y, pos.z);
      entity.rig.root.rotation.y = pos.yaw + Math.PI;

      if (entity.light) {
        entity.light.position.set(x, pos.y + 1.2, pos.z);
        entity.light.level = snap.level;
        entity.light.active = snap.mode !== 6;
      }

      const clip =
        snap.mode === 3 ? 'attack' : snap.mode === 4 ? 'idle' : snap.mode === 2 ? 'run' : snap.anim > 0.15 ? 'walk' : 'idle';
      playClip(entity.rig, clip, dt);
      entity.rig.mixer?.update(dt);

      // Dormant ambushers sit flat against whatever they are pretending to be.
      const def = MONSTERS_BY_ID.get(snap.defId);
      if (def?.brain === 'decoy' && snap.mode === 5) {
        entity.rig.root.rotation.x = -Math.PI / 2;
      } else if (def?.brain === 'ambush' && snap.mode === 5) {
        entity.rig.root.position.y = pos.y + 3.0;
        entity.rig.root.rotation.x = Math.PI;
      } else {
        entity.rig.root.rotation.x = 0;
      }
    }

    for (const [id, entity] of this.monsters) {
      if (net.monsters.has(id)) continue;
      this.group.remove(entity.rig.root);
      if (entity.light) this.sceneManager.removeLight(entity.light);
      this.monsters.delete(id);
    }
  }

  private async spawnMonster(id: number, defId: string): Promise<void> {
    const def = MONSTERS_BY_ID.get(defId);
    const model = def ? await assets.load(def.model) : null;
    this.pendingMonsters.delete(id);
    if (!def || !model || this.monsters.has(id)) return;

    const rig = makeRig(model, def.fit);
    this.group.add(rig.root);

    let light: DynamicLight | null = null;
    if (def.flags?.glow) {
      light = this.sceneManager.registerLight({
        position: new THREE.Vector3(),
        color: def.flags.glow.color,
        intensity: def.flags.glow.intensity,
        range: def.flags.glow.range,
        flicker: 0.25,
        level: -1,
        active: true,
      });
    }
    this.monsters.set(id, { id, defId, rig, light });
  }

  private syncItems(): void {
    for (const [id, snap] of net.items) {
      if (!this.items.has(id) && !this.pendingItems.has(id)) {
        this.pendingItems.add(id);
        void this.spawnItem(snap);
      }
      const entity = this.items.get(id);
      if (!entity) continue;

      if (snap.heldBy >= 0) {
        // Carried items ride in front of the holder's chest.
        const holder = net.players.get(snap.heldBy);
        if (holder) {
          const pos = NetClient.lerpSnapshot(holder, performance.now());
          const held = holder.next.held;
          const slot = net.playerId === snap.heldBy ? net.heldSlot : held;
          const isHeld = net.playerId === snap.heldBy ? net.inventory[slot]?.itemId === id : true;
          entity.object.visible = isHeld && snap.heldBy !== net.playerId;
          entity.object.position.set(
            pos.x + Math.sin(pos.yaw) * 0.55 + Math.cos(pos.yaw) * 0.28,
            pos.y + 1.05,
            pos.z + Math.cos(pos.yaw) * 0.55 - Math.sin(pos.yaw) * 0.28,
          );
          entity.object.rotation.y = pos.yaw;
        } else {
          entity.object.visible = false;
        }
      } else {
        entity.object.visible = true;
        entity.object.position.set(snap.x, snap.y, snap.z);
        entity.object.rotation.y = snap.rotY;
      }

      if (entity.light) {
        entity.light.position.copy(entity.object.position).add(new THREE.Vector3(0, 0.4, 0));
        entity.light.level = snap.level;
        entity.light.active = entity.object.visible || snap.heldBy >= 0;
      }
    }

    for (const [id, entity] of this.items) {
      if (net.items.has(id)) continue;
      this.group.remove(entity.object);
      if (entity.light) this.sceneManager.removeLight(entity.light);
      this.items.delete(id);
    }
  }

  private async spawnItem(snap: WorldItemSnapshot): Promise<void> {
    let ref: string | null = null;
    let fit = 0.4;
    let glow: { color: number; intensity: number; range: number } | null = null;

    if (snap.kind === 'scrap') {
      const def = SCRAP_BY_ID.get(snap.defId);
      if (def) {
        ref = def.model;
        fit = def.fit;
        glow = def.flags?.light ?? null;
      }
    } else if (snap.kind === 'equipment') {
      const def = EQUIPMENT_BY_ID.get(snap.defId);
      if (def) {
        ref = def.model;
        fit = def.fit;
        if (def.kind === 'light') glow = { color: 0xffe9c0, intensity: 0.3, range: 4 };
      }
    } else {
      ref = CREW_MODELS[0];
      fit = 1.7;
    }

    const model = ref ? await assets.load(ref) : null;
    this.pendingItems.delete(snap.id);
    if (this.items.has(snap.id)) return;

    let object: THREE.Object3D;
    if (model) {
      object = model.scene.clone(true);
      object.scale.setScalar(fit);
      if (snap.kind === 'body') object.rotation.x = -Math.PI / 2;
    } else {
      const geometry = new THREE.BoxGeometry(fit, fit * 0.7, fit * 0.8);
      const material = new THREE.MeshStandardMaterial({ color: 0x7a7f76, roughness: 0.85 });
      object = new THREE.Mesh(geometry, material);
    }
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
    object.position.set(snap.x, snap.y, snap.z);
    object.rotation.y = snap.rotY;
    this.group.add(object);

    let light: DynamicLight | null = null;
    if (glow) {
      light = this.sceneManager.registerLight({
        position: object.position.clone(),
        color: glow.color,
        intensity: glow.intensity,
        range: glow.range,
        flicker: 0.14,
        level: snap.level,
        active: true,
      });
    }
    this.items.set(snap.id, { id: snap.id, object, light, defId: snap.defId });
  }

  /** World object for an item id, used by the interaction raycast. */
  itemObject(id: number): THREE.Object3D | undefined {
    return this.items.get(id)?.object;
  }
}

// ----------------------------------------------------------------- helpers

function makeRig(model: LoadedModel, fit: number): Rig {
  const root = model.scene.clone(true) as THREE.Group;
  root.scale.setScalar(fit);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    }
  });

  const actions = new Map<string, THREE.AnimationAction>();
  let mixer: THREE.AnimationMixer | null = null;
  if (model.animations.length) {
    mixer = new THREE.AnimationMixer(root);
    for (const clip of model.animations) {
      const key = classifyClip(clip.name);
      if (!key || actions.has(key)) continue;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      actions.set(key, action);
    }
    // Some packs only ship one clip; use it for everything so nothing T-poses.
    if (actions.size > 0 && !actions.has('idle')) {
      actions.set('idle', actions.values().next().value!);
    }
  }
  return { root, mixer, actions, current: '' };
}

function classifyClip(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes('idle')) return 'idle';
  if (n.includes('run') || n.includes('sprint') || n.includes('gallop')) return 'run';
  if (n.includes('walk') || n.includes('move')) return 'walk';
  if (n.includes('attack') || n.includes('bite') || n.includes('punch') || n.includes('hit')) return 'attack';
  if (n.includes('death') || n.includes('die')) return 'death';
  if (n.includes('jump')) return 'jump';
  return 'idle';
}

function playClip(rig: Rig, key: string, dt: number): void {
  if (!rig.mixer || rig.actions.size === 0) return;
  const wanted = rig.actions.has(key) ? key : rig.actions.has('idle') ? 'idle' : rig.actions.keys().next().value!;
  if (rig.current === wanted) return;
  const next = rig.actions.get(wanted);
  if (!next) return;
  const previous = rig.current ? rig.actions.get(rig.current) : null;
  next.reset();
  next.setEffectiveWeight(1);
  next.play();
  if (previous && previous !== next) previous.crossFadeTo(next, 0.22, false);
  rig.current = wanted;
}

function makeNameTag(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 30px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 14, 256, 36);
  ctx.fillStyle = '#cfd0c8';
  ctx.fillText(name.slice(0, 14).toUpperCase(), 128, 33);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: true, transparent: true, opacity: 0.85 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.5, 0.375, 1);
  return sprite;
}
