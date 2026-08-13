import * as THREE from 'three';
import {
  PLAYER,
  TILE,
  carrySpeedFactor,
} from '@shared/constants.ts';
import { clamp, dist2D, dist3D } from '@shared/math.ts';
import { moonById, MOONS_BY_ID } from '@shared/content/moons.ts';
import { WEATHER } from '@shared/content/weather.ts';
import { SCRAP_BY_ID } from '@shared/content/scrap.ts';
import { EQUIPMENT_BY_ID } from '@shared/content/equipment.ts';
import { MONSTERS_BY_ID } from '@shared/content/monsters.ts';
import { generateFacility } from '@shared/facility/generate.ts';
import { generateExterior } from '@shared/world/exterior.ts';
import type { FacilityLayout } from '@shared/facility/types.ts';
import type { ExteriorLayout } from '@shared/world/exterior.ts';
import type { GameEvent, ServerMessage } from '@shared/protocol.ts';

import { assets } from './assets.ts';
import { net } from './net.ts';
import { SceneManager } from './render/scene.ts';
import { FacilityView, INTERIOR_ORIGIN_X } from './render/facility.ts';
import { ExteriorView } from './render/exterior.ts';
import { ShipView, SHIP } from './render/ship.ts';
import { EntityView } from './render/entities.ts';
import { WorldCollision } from './player/collision.ts';
import { PlayerController } from './player/controller.ts';
import { audio, CORE_SOUNDS } from './audio/engine.ts';
import { ambience, bodyAudio, creatureVoice, impactHit, thunder } from './audio/synth.ts';
import { voice } from './audio/voice.ts';
import { hud } from './ui/hud.ts';
import { MonitorScreen, TerminalScreen } from './ui/screens.ts';
import { loadSettings, saveSettings, type Settings } from './ui/settings.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const DEPOT_COUNTER = { x: 19, z: -2 };

const settings: Settings = loadSettings();

const canvas = $<HTMLCanvasElement>('viewport');
const sceneManager = new SceneManager(canvas, {
  renderScale: settings.renderScale,
  fov: settings.fov,
  shadows: settings.shadows,
});
const facilityView = new FacilityView(sceneManager);
const exteriorView = new ExteriorView(sceneManager);
const shipView = new ShipView(sceneManager);
const entityView = new EntityView(sceneManager);
const collision = new WorldCollision();

let layout: FacilityLayout | null = null;
let exterior: ExteriorLayout | null = null;
let currentSeed = -1;
let currentMoon: string | null = null;
let worldReady = false;
let insideShip = true;
let spectateIndex = 0;

const input = { forward: 0, strafe: 0, jump: false, sprint: false, crouch: false };
const keys = new Set<string>();
let throwCharge = 0;
let chatOpen = false;
let rosterOpen = false;
let pointerLocked = false;
let lastFrame = performance.now();

const controller = new PlayerController(collision, {
  onLand: (impact) => onLand(impact),
  onStep: (running, crouching) => onStep(running, crouching),
  onJump: () => {
    net.send({ t: 'noise', level: 1.4, x: controller.position.x, y: controller.position.y, z: controller.position.z, lvl: controller.level });
  },
});

const terminal = new TerminalScreen(
  (line) => net.send({ t: 'terminal', line }),
  () => requestPointerLock(),
);
const monitor = new MonitorScreen(() => requestPointerLock());

// ---------------------------------------------------------------------- boot

async function boot(): Promise<void> {
  bindMenu();
  try {
    await assets.loadCatalog();
    $('loading-label').textContent = 'manifest loaded';
    $('loadbar-fill').style.width = '25%';
  } catch (err) {
    $('loading-label').textContent = String((err as Error).message);
    return;
  }

  assets.setProgress((loaded, total) => {
    $('loadbar-fill').style.width = `${25 + (loaded / Math.max(1, total)) * 70}%`;
    $('loading-label').textContent = `loading models ${loaded}/${total}`;
  });

  // Crew, creatures and the ship are needed on every moon, so they load up
  // front. Facility kits stream in when we know which moon we are on.
  await assets.preload([...EntityView.requiredModels(), ...ShipView.requiredModels()]);

  $('loadbar-fill').style.width = '100%';
  $('loading-label').textContent = 'ready';
  $('menu-loading').classList.add('hidden');
  $('menu-form').classList.remove('hidden');
  requestAnimationFrame(frame);
}

function bindMenu(): void {
  const nameInput = $<HTMLInputElement>('name-input');
  const roomInput = $<HTMLInputElement>('room-input');
  const serverInput = $<HTMLInputElement>('server-input');
  nameInput.value = settings.name;
  roomInput.value = settings.room;
  serverInput.value = settings.server;

  const skinRow = $('skin-row');
  const palette = ['#8a7f6a', '#5f6f7a', '#7a6a5f', '#6a7a63', '#7a5f6a', '#4f5a63', '#6f6a4f', '#5a5f6a'];
  palette.forEach((colour, index) => {
    const swatch = document.createElement('div');
    swatch.className = 'skin-swatch' + (index === settings.skin ? ' active' : '');
    swatch.style.background = colour;
    swatch.onclick = () => {
      settings.skin = index;
      [...skinRow.children].forEach((c, i) => c.classList.toggle('active', i === index));
    };
    skinRow.appendChild(swatch);
  });

  bindRange('set-sens', settings.sensitivity, (v) => (settings.sensitivity = v));
  bindRange('set-volume', settings.volume, (v) => {
    settings.volume = v;
    audio.setMasterVolume(v);
  });
  bindRange('set-voice', settings.voiceVolume, (v) => {
    settings.voiceVolume = v;
    audio.setVoiceVolume(v);
  });
  bindRange('set-scale', settings.renderScale, (v) => {
    settings.renderScale = v;
    sceneManager.applySettings({ renderScale: v });
  });
  bindRange('set-fov', settings.fov, (v) => {
    settings.fov = v;
    sceneManager.applySettings({ fov: v });
  });
  bindCheck('set-microphone', settings.microphone, (v) => (settings.microphone = v));
  bindCheck('set-shadows', settings.shadows, (v) => {
    settings.shadows = v;
    sceneManager.applySettings({ shadows: v });
  });
  bindCheck('set-headbob', settings.headBob, (v) => {
    settings.headBob = v;
    controller.setHeadBob(v);
  });
  controller.setHeadBob(settings.headBob);

  $('join-button').addEventListener('click', () => {
    void join(nameInput.value.trim(), roomInput.value.trim() || 'default', serverInput.value.trim());
  });
  for (const el of [nameInput, roomInput, serverInput]) {
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') $('join-button').click();
    });
  }
}

function bindRange(id: string, value: number, onChange: (v: number) => void): void {
  const el = $<HTMLInputElement>(id);
  el.value = String(value);
  el.addEventListener('input', () => onChange(parseFloat(el.value)));
}

function bindCheck(id: string, value: boolean, onChange: (v: boolean) => void): void {
  const el = $<HTMLInputElement>(id);
  el.checked = value;
  el.addEventListener('change', () => onChange(el.checked));
}

async function join(name: string, room: string, server: string): Promise<void> {
  const button = $<HTMLButtonElement>('join-button');
  const status = $('menu-status');
  if (!name) {
    status.textContent = 'ENTER AN EMPLOYEE NAME.';
    return;
  }
  button.disabled = true;
  status.textContent = 'CONNECTING…';

  settings.name = name;
  settings.room = room;
  settings.server = server;
  saveSettings(settings);

  await audio.start();
  audio.setMasterVolume(settings.volume);
  audio.setVoiceVolume(settings.voiceVolume);
  void audio.preload(CORE_SOUNDS);

  try {
    await net.connect(server, name, room, settings.skin);
  } catch (err) {
    status.textContent = `FAILED: ${(err as Error).message.toUpperCase()}`;
    button.disabled = false;
    return;
  }

  if (settings.microphone) {
    const ok = await voice.enable();
    if (!ok) hud.log(voice.error ?? 'Microphone unavailable.', 'warn', 8);
  }

  $('menu').classList.add('hidden');
  hud.show();
  bindGameInput();
  requestPointerLock();
}

// -------------------------------------------------------------------- input

function bindGameInput(): void {
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('wheel', onWheel, { passive: true });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    $('pause').classList.toggle('hidden', pointerLocked || terminal.open || monitor.open || chatOpen);
  });
  $('pause').addEventListener('click', () => requestPointerLock());
  canvas.addEventListener('click', () => {
    if (!pointerLocked && !terminal.open && !monitor.open && !chatOpen) requestPointerLock();
  });

  const chatInput = $<HTMLInputElement>('chat-input');
  chatInput.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      const text = chatInput.value.trim();
      chatInput.value = '';
      closeChat();
      if (text) net.send({ t: 'chat', text });
    } else if (ev.key === 'Escape') {
      chatInput.value = '';
      closeChat();
    }
  });
}

function requestPointerLock(): void {
  if (terminal.open || monitor.open || chatOpen) return;
  void canvas.requestPointerLock?.();
}

function onKeyDown(ev: KeyboardEvent): void {
  if (chatOpen || terminal.open) return;
  keys.add(ev.code);
  updateMoveAxes();

  switch (ev.code) {
    case 'Space':
      input.jump = true;
      ev.preventDefault();
      break;
    case 'KeyE':
      interact();
      break;
    case 'KeyF':
      toggleLight();
      break;
    case 'KeyG':
      throwCharge = 0;
      break;
    case 'KeyV':
      setTransmitting(true, true);
      break;
    case 'KeyM':
      if (insideShip) toggleMonitor();
      break;
    case 'Tab':
      ev.preventDefault();
      rosterOpen = true;
      hud.toggleRoster(true);
      break;
    case 'KeyT':
    case 'Enter':
      ev.preventDefault();
      openChat();
      break;
    case 'Escape':
      document.exitPointerLock?.();
      break;
    case 'Digit1':
    case 'Digit2':
    case 'Digit3':
    case 'Digit4':
    case 'Digit5':
      selectSlot(Number(ev.code.slice(5)) - 1);
      break;
    case 'KeyA':
      if (isSpectating()) cycleSpectate(-1);
      break;
    case 'KeyD':
      if (isSpectating()) cycleSpectate(1);
      break;
  }
}

function onKeyUp(ev: KeyboardEvent): void {
  keys.delete(ev.code);
  updateMoveAxes();
  if (ev.code === 'Space') input.jump = false;
  if (ev.code === 'KeyV') setTransmitting(false, false);
  if (ev.code === 'Tab') {
    rosterOpen = false;
    hud.toggleRoster(false);
  }
  if (ev.code === 'KeyG') dropHeld(throwCharge);
}

function updateMoveAxes(): void {
  input.forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  input.strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  input.crouch = keys.has('ControlLeft') || keys.has('KeyC');
}

function onMouseMove(ev: MouseEvent): void {
  if (!pointerLocked) return;
  controller.look(ev.movementX, ev.movementY, settings.sensitivity);
}

function onMouseDown(ev: MouseEvent): void {
  if (!pointerLocked) return;
  if (ev.button === 0) useHeld(true);
  if (ev.button === 2) interact();
}

function onMouseUp(ev: MouseEvent): void {
  if (ev.button === 0) useHeld(false);
}

function onWheel(ev: WheelEvent): void {
  if (!pointerLocked) return;
  const count = Math.max(1, net.inventory.length);
  selectSlot((net.heldSlot + (ev.deltaY > 0 ? 1 : -1) + count) % count);
}

function openChat(): void {
  chatOpen = true;
  document.exitPointerLock?.();
  const el = $<HTMLInputElement>('chat-input');
  el.classList.remove('hidden');
  el.focus();
}

function closeChat(): void {
  chatOpen = false;
  $('chat-input').classList.add('hidden');
  requestPointerLock();
}

function toggleMonitor(): void {
  if (monitor.open) {
    monitor.close();
    return;
  }
  document.exitPointerLock?.();
  monitor.setLayout(layout);
  monitor.show();
}

// ------------------------------------------------------------------ actions

function selectSlot(index: number): void {
  if (index < 0 || index >= net.inventory.length) return;
  net.heldSlot = index;
  net.send({ t: 'equip', slot: index });
  hud.renderSlots(net.inventory, net.heldSlot);
  audio.play('rpg-audio-cloth1', { bus: 'ui', volume: 0.3 });
}

function toggleLight(): void {
  const slot = net.inventory[net.heldSlot];
  const def = slot?.defId ? EQUIPMENT_BY_ID.get(slot.defId) : null;
  if (!def || def.kind !== 'light') {
    hud.log('No light in hand.', 'warn', 2.5);
    return;
  }
  if (slot.charge <= 0) {
    hud.log('Battery dead.', 'bad', 2.5);
    audio.play('interface-sounds-error_002', { bus: 'ui', volume: 0.5 });
    return;
  }
  controller.lightOn = !controller.lightOn;
  audio.play('interface-sounds-click_003', { bus: 'ui', volume: 0.45 });
}

function useHeld(down: boolean): void {
  const slot = net.inventory[net.heldSlot];
  if (!slot?.defId || slot.kind !== 'equipment') return;
  const def = EQUIPMENT_BY_ID.get(slot.defId);
  if (!def) return;
  if (def.kind === 'melee') {
    if (!down) return;
    net.send({ t: 'melee', slot: net.heldSlot, yaw: controller.yaw, pitch: controller.pitch });
    controller.addShake(0.25, 8);
    return;
  }
  net.send({ t: 'use', slot: net.heldSlot, down, yaw: controller.yaw, pitch: controller.pitch });
}

function dropHeld(force: number): void {
  const slot = net.inventory[net.heldSlot];
  if (!slot?.itemId) return;
  net.send({
    t: 'drop',
    slot: net.heldSlot,
    throwForce: clamp(force, 0, 1),
    yaw: controller.yaw,
    pitch: controller.pitch,
  });
  throwCharge = 0;
}

function setTransmitting(on: boolean, walkie: boolean): void {
  const slot = net.inventory[net.heldSlot];
  const hasWalkie =
    walkie && net.inventory.some((s) => s.defId === 'walkie' && s.charge > 0);
  controller.walkieOpen = on && hasWalkie;
  voice.setTransmitting(on, controller.walkieOpen);
  net.send({ t: 'voice', speaking: on, walkie: controller.walkieOpen });
  if (on && hasWalkie) net.send({ t: 'use', slot: net.heldSlot, down: true, yaw: controller.yaw, pitch: controller.pitch });
}

// -------------------------------------------------------------- interaction

interface Target {
  kind: 'item' | 'door' | 'breaker' | 'terminal' | 'monitor' | 'ship' | 'charger' | 'entrance' | 'counter';
  id: number;
  label: string;
  distance: number;
}

function findTarget(): Target | null {
  const origin = sceneManager.camera.position;
  const level = controller.level;
  let best: Target | null = null;
  const consider = (t: Target) => {
    if (!best || t.distance < best.distance) best = t;
  };

  // Items: nearest in front of the camera within reach.
  for (const item of net.items.values()) {
    if (item.heldBy >= 0 || item.level !== level) continue;
    const d = dist3D(item, origin);
    if (d > PLAYER.interactRange) continue;
    if (!inFront(item)) continue;
    const name =
      item.kind === 'body'
        ? 'crew body'
        : item.kind === 'equipment'
          ? EQUIPMENT_BY_ID.get(item.defId)?.name ?? item.defId
          : SCRAP_BY_ID.get(item.defId)?.name ?? item.defId;
    const value = item.kind === 'scrap' ? ` <span class="value">${item.value}</span>` : '';
    consider({ kind: 'item', id: item.id, label: `<span class="key">[E]</span> ${name}${value}`, distance: d });
  }

  // Facility doors and the breaker.
  if (layout && level >= 0) {
    for (const spec of layout.doors) {
      if (spec.level !== level) continue;
      const grid = layout.levels[spec.level];
      const wx = INTERIOR_ORIGIN_X + (spec.x + 0.5 + [0, 1, 0, -1][spec.side] * 0.5) * TILE;
      const wz = (spec.z + 0.5 + [-1, 0, 1, 0][spec.side] * 0.5) * TILE;
      const d = Math.hypot(wx - origin.x, wz - origin.z);
      if (d > 2.6) continue;
      const state = net.doors.get(spec.id);
      if (!state) continue;
      if (state.locked) {
        consider({ kind: 'door', id: spec.id, label: '<span class="key">[LOCKED]</span> needs a cutter', distance: d });
      } else if (state.powered && !(net.ship?.breakerOn ?? false)) {
        consider({ kind: 'door', id: spec.id, label: '<span class="key">[NO POWER]</span>', distance: d });
      } else {
        consider({
          kind: 'door',
          id: spec.id,
          label: `<span class="key">[E]</span> ${state.state === 1 || state.state === 4 ? 'close' : 'open'} door`,
          distance: d,
        });
      }
    }
    if (layout.breaker && layout.breaker.level === level) {
      const bx = INTERIOR_ORIGIN_X + (layout.breaker.x + 0.5) * TILE;
      const bz = (layout.breaker.z + 0.5) * TILE;
      const d = Math.hypot(bx - origin.x, bz - origin.z);
      if (d < 3.2) {
        consider({
          kind: 'breaker',
          id: 0,
          label: `<span class="key">[E]</span> ${net.ship?.breakerOn ? 'cut' : 'restore'} facility power`,
          distance: d,
        });
      }
    }
  }

  // Ship fittings.
  if (level < 0) {
    for (const fitting of shipView.interactables) {
      const d = origin.distanceTo(fitting.position);
      if (d > fitting.radius) continue;
      const kind = fitting.kind === 'counter' ? 'counter' : fitting.kind === 'lever' ? 'ship' : fitting.kind;
      consider({ kind: kind as Target['kind'], id: 0, label: `<span class="key">[E]</span> ${fitting.label}`, distance: d });
    }
    for (const entrance of exteriorView.entrances) {
      const d = Math.hypot(entrance.position.x - origin.x, entrance.position.z - origin.z);
      if (d > 3.0) continue;
      consider({
        kind: 'entrance',
        id: entrance.anchor,
        label: `<span class="key">[E]</span> enter ${entrance.kind === 'main' ? 'facility' : 'fire exit'}`,
        distance: d,
      });
    }
  } else if (layout) {
    // Stepping back out through an interior entrance.
    for (const spawn of layout.entrySpawns) {
      if (spawn.level !== level) continue;
      const wx = INTERIOR_ORIGIN_X + spawn.px;
      const d = Math.hypot(wx - origin.x, spawn.pz - origin.z);
      if (d > 3.0) continue;
      const door = layout.doors.find((x) => x.id === spawn.doorId);
      consider({
        kind: 'entrance',
        id: door?.exteriorAnchor ?? 0,
        label: '<span class="key">[E]</span> step outside',
        distance: d,
      });
    }
  }

  return best;
}

function inFront(point: { x: number; z: number }): boolean {
  const dx = point.x - controller.position.x;
  const dz = point.z - controller.position.z;
  const forwardX = Math.sin(controller.yaw);
  const forwardZ = Math.cos(controller.yaw);
  const len = Math.hypot(dx, dz) || 1;
  return (dx / len) * forwardX + (dz / len) * forwardZ > 0.15;
}

function interact(): void {
  const target = findTarget();
  if (!target) return;
  switch (target.kind) {
    case 'item':
      net.send({ t: 'interact', kind: 'item', id: target.id });
      break;
    case 'door':
      net.send({ t: 'interact', kind: 'door', id: target.id });
      break;
    case 'breaker':
      net.send({ t: 'interact', kind: 'breaker', id: 0 });
      break;
    case 'terminal':
      document.exitPointerLock?.();
      terminal.show();
      break;
    case 'monitor':
      toggleMonitor();
      break;
    case 'charger':
      net.send({ t: 'interact', kind: 'charger', id: 0 });
      break;
    case 'ship':
      net.send({ t: 'interact', kind: 'ship', id: 0 });
      break;
    case 'counter':
      net.send({ t: 'terminal', line: 'SELL' });
      audio.play('impact-sounds-impactBell_heavy_000', { volume: 0.7, bus: 'ui' });
      break;
    case 'entrance':
      useEntrance(target.id);
      break;
  }
}

/** Doorways are a hard cut between two coordinate spaces, exactly like the ship. */
function useEntrance(anchor: number): void {
  if (!layout || !exterior) return;
  if (controller.level >= 0) {
    const marker = exteriorView.entrances.find((e) => e.anchor === anchor) ?? exteriorView.entrances[0];
    if (!marker) return;
    const x = marker.position.x + Math.sin(marker.facing) * 2.4;
    const z = marker.position.z + Math.cos(marker.facing) * 2.4;
    controller.teleportTo(x, collision.groundHeight(x, z, -1), z, -1);
    controller.yaw = marker.facing;
  } else {
    const doorId = layout.anchors[anchor]?.doorId;
    const spawn = layout.entrySpawns.find((s) => s.doorId === doorId) ?? layout.entrySpawns[0];
    if (!spawn) return;
    const inward = [
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
    ];
    controller.teleportTo(INTERIOR_ORIGIN_X + spawn.px, layout.levels[spawn.level].baseY, spawn.pz, spawn.level);
    controller.yaw = spawn.rotY;
  }
  audio.play('sci-fi-sounds-doorOpen_000', { volume: 0.6 });
  net.send({ t: 'enter', anchor, inside: controller.level >= 0 });
  updateSpace();
}

// ----------------------------------------------------------- world building

async function buildWorld(): Promise<void> {
  const { moonId, weather, seed } = net.expedition;
  if (!moonId || !weather) {
    worldReady = false;
    facilityView.setVisible(false);
    exteriorView.setVisible(false);
    return;
  }

  const isDepot = moonId === 'company';
  const moon = moonById(isDepot ? 'ridge' : moonId);
  hud.log(`Descending to ${isDepot ? 'the Company depot' : moon.name}…`, 'warn', 5);

  layout = generateFacility({ seed, moon, weather, dayIndex: net.expedition.day });
  exterior = generateExterior({ seed, moon, weather, layout });

  // Stream in only the kits this moon needs.
  $('loading-label').textContent = 'building site';
  await assets.preload([...FacilityView.requiredModels(layout), ...ExteriorView.requiredModels(exterior)]);

  sceneManager.clearLights();
  await facilityView.build(layout);
  const shipPosition = new THREE.Vector3(exterior.ship.x, exterior.ship.y, exterior.ship.z);
  await shipView.build(shipPosition, exterior.ship.rotY);

  if (isDepot) {
    exteriorView.clear();
    await shipView.buildDepot(shipPosition, DEPOT_COUNTER);
    sceneManager.setEnvironment(null, 'clear');
  } else {
    await exteriorView.build(exterior, moon);
    sceneManager.setEnvironment(moonId, weather);
  }

  collision.setWorld(layout, exterior, shipPosition);
  collision.exteriorColliders = exteriorView.colliders;
  collision.shipBoxes = shipView.colliders;

  monitor.setLayout(isDepot ? null : layout);
  facilityView.setVisible(true);
  exteriorView.setVisible(!isDepot);

  controller.teleportTo(shipPosition.x, shipPosition.y + SHIP.floorY, shipPosition.z + 1.5, -1);
  controller.lightOn = false;
  worldReady = true;
  currentSeed = seed;
  currentMoon = moonId;

  const w = WEATHER[weather];
  hud.log(`${isDepot ? 'Depot' : moon.name}: ${w.name}. ${w.description}`, w.severity === 2 ? 'bad' : 'info', 9);
}

function teardownWorld(): void {
  worldReady = false;
  layout = null;
  exterior = null;
  currentSeed = -1;
  currentMoon = null;
  facilityView.clear();
  exteriorView.clear();
  shipView.clear();
  entityView.clear();
  sceneManager.clearLights();
  facilityView.setVisible(false);
  exteriorView.setVisible(false);
}

function updateSpace(): void {
  const wasInside = insideShip;
  insideShip = collision.insideShip(controller.position.x, controller.position.y, controller.position.z, controller.level);
  const indoors = controller.level >= 0;
  audio.setSpace(indoors ? 'interior' : insideShip ? 'ship' : 'exterior');
  ambience.setKind(
    indoors ? 'facility' : insideShip ? 'ship' : net.expedition.moonId === 'company' ? 'depot' : 'exterior',
    net.ship?.breakerOn ?? false,
  );
  facilityView.setVisible(indoors);
  exteriorView.setVisible(!indoors && net.expedition.moonId !== 'company');
  if (wasInside !== insideShip && insideShip) hud.log('Aboard.', 'good', 2.5);
}

// -------------------------------------------------------------- game events

net.on((msg: ServerMessage) => {
  switch (msg.t) {
    case 'expedition':
      if (msg.moonId && msg.seed !== currentSeed) void buildWorld();
      else if (!msg.moonId && worldReady) teardownWorld();
      break;

    case 'inventory':
      hud.renderSlots(msg.slots, msg.held);
      break;

    case 'terminal':
      terminal.write(msg.lines, msg.clear);
      if (!terminal.open && msg.lines.length) {
        const last = msg.lines[msg.lines.length - 1];
        if (last && !last.startsWith('>')) hud.log(last, 'info', 7);
      }
      break;

    case 'chat':
      hud.chat(msg.from, msg.text, msg.channel);
      break;

    case 'rtc':
      void voice.handleSignal(msg.from, msg.payload);
      break;

    case 'roster':
      voice.syncPeers();
      break;

    case 'event':
      handleEvent(msg);
      break;
  }
});

function handleEvent(ev: GameEvent): void {
  const at = { x: Number(ev.x ?? 0), y: Number(ev.y ?? 0), z: Number(ev.z ?? 0) };
  const level = Number(ev.level ?? -1);
  const audible = level === controller.level;

  switch (ev.e) {
    case 'notice':
      hud.notice(String(ev.text), 3.5);
      if (Number(ev.severity ?? 0) >= 2) audio.play('interface-sounds-error_004', { bus: 'ui', volume: 0.7 });
      break;

    case 'damage': {
      if (ev.target === 'player' && ev.id === net.playerId) {
        hud.flashDamage(Number(ev.amount));
        controller.addShake(0.5, 4);
        impactHit({ x: controller.position.x, y: controller.position.y + 1.2, z: controller.position.z });
        const cause = String(ev.cause ?? '');
        if (MONSTERS_BY_ID.has(cause)) hud.log(`Hit by something.`, 'bad', 4);
        else hud.log(`Hurt: ${cause}`, 'bad', 4);
      } else if (ev.target === 'monster' && audible) {
        audio.play('impact-sounds-impactGeneric_light_000', { position: at, volume: 0.7 });
      }
      break;
    }

    case 'death': {
      const name = String(ev.name);
      if (ev.id === net.playerId) {
        hud.notice('YOU ARE DEAD', 5);
        hud.setSpectating(true, String(ev.cause ?? ''), '');
        controller.lightOn = false;
      } else {
        hud.log(`${name} died.`, 'bad', 8);
      }
      if (audible) audio.play('impact-sounds-impactGeneric_light_002', { position: at, volume: 0.8, rate: 0.7 });
      break;
    }

    case 'pickup':
      if (ev.player === net.playerId) audio.play('rpg-audio-cloth2', { bus: 'ui', volume: 0.45 });
      break;

    case 'drop':
      if (audible) audio.play('interface-sounds-drop_003', { position: at, volume: 0.5 });
      break;

    case 'sell':
      hud.log(`The Company paid ${ev.amount} credits.`, 'good', 8);
      audio.play('interface-sounds-confirmation_002', { bus: 'ui', volume: 0.7 });
      break;

    case 'breaker':
      hud.log(ev.on ? 'Facility power restored.' : 'Facility power cut.', ev.on ? 'good' : 'warn', 5);
      ambience.setPowered(!!ev.on);
      audio.play(ev.on ? 'sci-fi-sounds-forceField_002' : 'sci-fi-sounds-lowFrequency_explosion_000', { volume: 0.6 });
      break;

    case 'lightning': {
      sceneManager.flashLightning();
      const d = dist2D({ x: at.x, y: 0, z: at.z }, controller.position);
      thunder(d);
      if (d < 40) controller.addShake(0.8, 2);
      break;
    }

    case 'stun':
      audio.play('sci-fi-sounds-forceField_001', { volume: 0.6 });
      break;

    case 'grab':
      if (ev.player === net.playerId) {
        controller.grabbed = true;
        hud.setGrabbed(true);
        hud.log('Something has hold of you.', 'bad', 6);
      }
      break;

    case 'release':
      if (ev.player === net.playerId) {
        controller.grabbed = false;
        hud.setGrabbed(false);
      }
      break;

    case 'teleport':
      if (ev.player === net.playerId) {
        controller.teleportTo(Number(ev.x), Number(ev.y), Number(ev.z), Number(ev.level));
        audio.play('sci-fi-sounds-forceField_003', { volume: 0.8 });
        hud.log(ev.inverse ? 'Inserted.' : 'Recovered.', 'warn', 4);
        updateSpace();
      }
      break;

    case 'voiceMimic': {
      // Somebody's voice, from a place they are not.
      const def = MONSTERS_BY_ID.get('choirman');
      if (def && ev.toPlayer === net.playerId) {
        creatureVoice(def, at, 0.2);
        hud.chat(String(ev.asName), '…', 'radio');
      }
      break;
    }

    case 'shipHorn':
      audio.play('sci-fi-sounds-engineCircular_003', { position: at, volume: 1, max: 400, ref: 30 });
      break;

    case 'sound':
      handleSoundEvent(ev, at, level, audible);
      break;
  }
}

function handleSoundEvent(ev: GameEvent, at: { x: number; y: number; z: number }, level: number, audible: boolean): void {
  const kind = String(ev.kind);
  switch (kind) {
    case 'creatureVoice':
    case 'monsterWindup': {
      const def = MONSTERS_BY_ID.get(String(ev.defId));
      if (!def) return;
      if (level !== controller.level) return;
      creatureVoice(def, at, kind === 'monsterWindup' ? 1 : Number(ev.mode ?? 0) >= 2 ? 0.8 : 0.2);
      break;
    }
    case 'monsterHit':
      if (audible) impactHit(at);
      break;
    case 'ambushDrop':
    case 'decoyRise':
    case 'startle': {
      const def = MONSTERS_BY_ID.get(String(ev.defId));
      if (def && audible) creatureVoice(def, at, 1);
      if (audible) controller.addShake(0.3, 4);
      break;
    }
    case 'explosion': {
      const d = dist3D(at, controller.position);
      audio.play('sci-fi-sounds-explosionCrunch_000', { position: at, volume: 1, max: 220, ref: 8 });
      if (d < 24) {
        controller.addShake(1, 1.6);
        bodyAudio.deafen(clamp(3 - d / 12, 0.4, 3));
      }
      break;
    }
    case 'break':
      if (audible) {
        audio.play('impact-sounds-impactGlass_medium_000', { position: at, volume: 0.8 });
        if (Number(ev.lost ?? 0) > 0) hud.log(`Something broke. Lost ${ev.lost} credits.`, 'bad', 5);
      }
      break;
    case 'scrapNoise':
      if (audible) {
        const def = SCRAP_BY_ID.get(String(ev.defId));
        audio.play(
          def?.id === 'alarm-clock'
            ? 'impact-sounds-impactBell_heavy_002'
            : def?.id === 'megaphone'
              ? 'digital-audio-highUp'
              : 'impact-sounds-impactMetal_light_003',
          { position: at, volume: 0.75, max: 60 },
        );
      }
      break;
    case 'swing':
      if (audible) audio.play('rpg-audio-cloth3', { position: at, volume: 0.6, rate: 0.8 });
      break;
    case 'stun':
      audio.play('digital-audio-laser5', { position: at, volume: 0.7 });
      break;
    case 'deploy':
      if (audible) audio.play('interface-sounds-drop_001', { position: at, volume: 0.6 });
      break;
    case 'decoyChirp':
      if (audible) audio.play('digital-audio-highDown', { position: at, volume: 0.6, max: 70 });
      break;
    case 'thiefGrab':
      if (audible) audio.play('impact-sounds-impactMetal_medium_002', { position: at, volume: 0.8 });
      break;
    case 'scannerPing': {
      const blips = ev.blips as { x: number; z: number; value: number; level: number }[] | undefined;
      if (blips) hud.addScanBlips(blips);
      audio.play('digital-audio-highUp', { bus: 'ui', volume: 0.5 });
      break;
    }
    case 'psychFlee':
      audio.play('sci-fi-sounds-forceField_004', { position: at, volume: 0.5 });
      break;
  }
}

function onLand(impact: number): void {
  const surface = controller.level >= 0 ? 'concrete' : insideShip ? 'wood' : 'grass';
  audio.playVariant(`impact-sounds-footstep_${surface}`, {
    position: controller.position,
    volume: clamp(impact / 12, 0.2, 1),
    rate: 0.8,
  });
  net.send({
    t: 'noise',
    level: clamp(impact / 8, 0.3, PLAYER.noiseJumpLand),
    x: controller.position.x,
    y: controller.position.y,
    z: controller.position.z,
    lvl: controller.level,
  });

  if (impact > PLAYER.fallDamageSpeed) {
    const t = (impact - PLAYER.fallDamageSpeed) / (PLAYER.fallLethalSpeed - PLAYER.fallDamageSpeed);
    const damage = Math.round(clamp(t, 0, 1.4) * 100);
    if (damage > 3) {
      net.send({ t: 'selfDamage', amount: damage, cause: 'fall' });
      controller.addShake(0.8, 3);
      hud.flashDamage(damage);
    }
  }
}

function onStep(running: boolean, crouching: boolean): void {
  const surface = controller.level >= 0 ? 'concrete' : insideShip ? 'wood' : 'grass';
  audio.playVariant(`impact-sounds-footstep_${surface}`, {
    position: controller.position,
    volume: crouching ? 0.12 : running ? 0.45 : 0.28,
    rate: 0.85 + Math.random() * 0.25,
  });
}

// ------------------------------------------------------------------ spectate

function isSpectating(): boolean {
  const self = net.self();
  return !!self && self.state !== 'alive';
}

function cycleSpectate(direction: number): void {
  const alive = [...net.players.values()].filter((p) => p.next.state === 'alive' && p.next.id !== net.playerId);
  if (!alive.length) return;
  spectateIndex = (spectateIndex + direction + alive.length) % alive.length;
}

function applySpectatorCamera(): void {
  const alive = [...net.players.values()].filter((p) => p.next.state === 'alive' && p.next.id !== net.playerId);
  if (!alive.length) {
    hud.setSpectating(true, net.self()?.state === 'dead' ? '' : '', '');
    return;
  }
  const target = alive[spectateIndex % alive.length].next;
  const camera = sceneManager.camera;
  const back = 3.4;
  camera.position.set(
    target.x - Math.sin(target.yaw) * back,
    target.y + 2.2,
    target.z - Math.cos(target.yaw) * back,
  );
  camera.lookAt(target.x, target.y + 1.4, target.z);
  controller.level = target.level;
  hud.setSpectating(true, net.self()?.state === 'dead' ? 'unknown' : '', target.name);
}

// ---------------------------------------------------------------- main loop

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const self = net.self();
  const alive = !self || self.state === 'alive';

  if (keys.has('KeyG')) throwCharge = Math.min(1, throwCharge + dt * 1.6);

  if (worldReady && alive) {
    controller.carryWeight = self?.carryWeight ?? 0;
    controller.frozen = terminal.open || monitor.open || chatOpen;
    controller.update(dt, input, true);
    controller.applyCamera(sceneManager.camera);
    updateSpaceIfMoved();
  } else if (!alive) {
    applySpectatorCamera();
  }

  // Doors the collision layer needs to know about.
  for (const [id, door] of net.doors) collision.doorOpen.set(id, door.state === 1 || door.state === 4);

  if (worldReady) {
    facilityView.update(dt, net.doors);
    shipView.setHatch(net.ship?.doorsOpen ?? true, dt);
    entityView.update(dt, performance.now(), net.playerId, true);
    sceneManager.updateLights(controller.level);
    sceneManager.updateEnvironment(net.ship?.dayProgress ?? 0, controller.level >= 0 || insideShip, dt);

    if (exterior && controller.level < 0) {
      const water = net.ship?.weather && WEATHER[net.ship.weather].flags.rising
        ? -0.4 + (net.ship.dayProgress ?? 0) * 2.6
        : exterior.waterBase;
      sceneManager.setWater(water ?? null, exterior.size);
      const depth = (water ?? -99) - controller.position.y;
      audio.setMuffle(depth > 1.2 ? clamp(depth / 2.4, 0, 0.9) : 0);
    } else {
      sceneManager.setWater(null, 0);
    }
  }

  const equip = net.inventory[net.heldSlot];
  const lightDef = equip?.defId ? EQUIPMENT_BY_ID.get(equip.defId) : null;
  if (lightDef?.kind === 'light' && equip.charge <= 0) controller.lightOn = false;
  sceneManager.setFlashlight(
    controller.lightOn && !!lightDef,
    lightDef?.stats?.range ?? 16,
    lightDef?.stats?.angle ?? 0.42,
    lightDef?.stats?.intensity ?? 2.6,
  );

  // Networking: fixed-ish rate is fine, the server clamps anything wild.
  if (net.connected && worldReady) {
    net.sendInput(
      controller.position.x,
      controller.position.y,
      controller.position.z,
      controller.yaw,
      controller.pitch,
      controller.level,
      controller.flags(voice.transmitting),
    );
  }

  // Audio
  audio.updateListener(sceneManager.camera);
  ambience.update(dt, controller.position, controller.level >= 0, net.ship?.breakerOn ?? false);
  const nearestThreat = nearestMonsterDistance();
  const stress = clamp(
    (self ? 1 - self.health / 100 : 0) * 0.6 + (nearestThreat < 18 ? (18 - nearestThreat) / 18 : 0) * 0.7,
    0,
    1,
  );
  bodyAudio.update(dt, stress, controller.position);
  if (net.ship?.weather) {
    const w = WEATHER[net.ship.weather];
    const outside = controller.level < 0 && !insideShip;
    ambience.setWeather(
      outside ? (w.flags.lightning ? 1 : w.id === 'fog' ? 0.5 : 0.7) : 0.1,
      outside && w.flags.precipitation === 'rain' ? 1 : 0,
    );
  }

  // Voice positions
  if (voice.enabled) {
    const positions = new Map<number, { x: number; y: number; z: number; level: number; walkie: boolean }>();
    for (const [id, entry] of net.players) {
      if (id === net.playerId) continue;
      positions.set(id, {
        x: entry.next.x,
        y: entry.next.y + 1.5,
        z: entry.next.z,
        level: entry.next.level,
        walkie: (entry.next.flags & 64) !== 0,
      });
    }
    voice.update(controller.position, controller.level, positions, controller.walkieOpen);
  }

  // UI
  hud.update(dt, net.ship, self?.health ?? 100, controller.stamina, self?.carryWeight ?? 0);
  hud.setPrompt(worldReady && alive ? (findTarget()?.label ?? null) : null);
  hud.updateScanBlips(projectToScreen);
  if (rosterOpen) hud.toggleRoster(true);
  if (monitor.open && exterior) monitor.update(dt, exterior.ship.x, exterior.ship.z, exterior.size);

  sceneManager.render();
}

let lastSpaceCheck = 0;
function updateSpaceIfMoved(): void {
  const now = performance.now();
  if (now - lastSpaceCheck < 250) return;
  lastSpaceCheck = now;
  updateSpace();
}

function nearestMonsterDistance(): number {
  let best = Infinity;
  for (const entry of net.monsters.values()) {
    if (entry.next.level !== controller.level) continue;
    const d = dist2D(entry.next, controller.position);
    if (d < best) best = d;
  }
  return best;
}

function projectToScreen(x: number, z: number, level: number): { x: number; y: number; visible: boolean } {
  if (level !== controller.level) return { x: 0, y: 0, visible: false };
  const point = new THREE.Vector3(x, controller.position.y + 1, z);
  const camera = sceneManager.camera;
  const toPoint = point.clone().sub(camera.position);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  if (toPoint.dot(forward) <= 0) return { x: 0, y: 0, visible: false };
  point.project(camera);
  return {
    x: (point.x * 0.5 + 0.5) * innerWidth,
    y: (-point.y * 0.5 + 0.5) * innerHeight,
    visible: true,
  };
}

document.addEventListener('contextmenu', (ev) => ev.preventDefault());
addEventListener('beforeunload', () => saveSettings(settings));

void boot();
