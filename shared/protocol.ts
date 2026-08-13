import type { WeatherId } from './content/weather.ts';

export const PROTOCOL_VERSION = 4;

// ---------------------------------------------------------------- game state

export type RunPhase =
  | 'orbit'       // in transit / at the terminal, choosing a destination
  | 'landed'      // on a moon, clock running
  | 'departing'   // engines up, doors closing
  | 'company'     // at the depot, selling
  | 'gameover';

export type PlayerState = 'alive' | 'dead' | 'spectating';

export interface InventorySlot {
  /** Scrap instance id, equipment instance id, or null. */
  itemId: number | null;
  kind: 'scrap' | 'equipment' | null;
  defId: string | null;
  /** Battery charge 0..1 for equipment, unused for scrap. */
  charge: number;
  /** Cached for the HUD so the client does not need the whole item table. */
  weight: number;
  value: number;
  twoHanded: boolean;
}

export interface PlayerSnapshot {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Facility level index, or -1 when outdoors. */
  level: number;
  /** Bitfield: 1 crouch, 2 sprint, 4 airborne, 8 lightOn, 16 speaking, 32 grabbed. */
  flags: number;
  health: number;
  stamina: number;
  state: PlayerState;
  /** Index of the held slot. */
  held: number;
  /** Model variant index. */
  skin: number;
  name: string;
  carryWeight: number;
}

export interface MonsterSnapshot {
  id: number;
  defId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  level: number;
  /** 0 idle, 1 alert, 2 chase, 3 attack, 4 stunned, 5 dormant, 6 dead. */
  mode: number;
  /** 0..1, used for animation blending and windup tells. */
  anim: number;
  health: number;
}

export interface WorldItemSnapshot {
  id: number;
  kind: 'scrap' | 'equipment' | 'body';
  defId: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  level: number;
  value: number;
  weight: number;
  charge: number;
  /** Player id holding it, or -1 when it is on the ground. */
  heldBy: number;
  /** True once it is inside the ship's cargo area. */
  stowed: boolean;
}

export interface DoorSnapshot {
  id: number;
  /** 0 shut, 1 open, 2 opening, 3 closing, 4 cut/destroyed. */
  state: number;
  locked: boolean;
  powered: boolean;
}

export interface ShipSnapshot {
  phase: RunPhase;
  /** 0..1 through the expedition day. */
  dayProgress: number;
  day: number;
  quota: number;
  quotaMet: number;
  daysLeft: number;
  credits: number;
  sellRate: number;
  moonId: string | null;
  weather: WeatherId | null;
  /** Doors open / closed / moving. */
  doorsOpen: boolean;
  /** Seconds until autopilot forces departure, or -1. */
  autopilotIn: number;
  /** Facility power. */
  breakerOn: boolean;
  /** Cargo value currently aboard. */
  cargoValue: number;
  upgrades: string[];
}

// ------------------------------------------------------------------- client

export type ClientMessage =
  | { t: 'hello'; name: string; skin: number; version: number; room: string }
  | { t: 'input'; seq: number; x: number; y: number; z: number; yaw: number; pitch: number; level: number; flags: number }
  | { t: 'interact'; kind: 'item' | 'door' | 'breaker' | 'terminal' | 'ship' | 'body' | 'hazard' | 'charger'; id: number }
  | { t: 'drop'; slot: number; throwForce: number; yaw: number; pitch: number }
  | { t: 'equip'; slot: number }
  | { t: 'use'; slot: number; down: boolean; yaw: number; pitch: number }
  | { t: 'melee'; slot: number; yaw: number; pitch: number }
  | { t: 'noise'; level: number; x: number; y: number; z: number; lvl: number }
  | { t: 'selfDamage'; amount: number; cause: string }
  | { t: 'enter'; anchor: number; inside: boolean }
  | { t: 'terminal'; line: string }
  | { t: 'chat'; text: string }
  | { t: 'voice'; speaking: boolean; walkie: boolean }
  | { t: 'teleport'; target: number; inverse: boolean }
  | { t: 'monitor'; target: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'rtc'; to: number; payload: unknown }
  | { t: 'ping'; time: number };

// ------------------------------------------------------------------- server

export interface GameEvent {
  t: 'event';
  /** Discriminator for the client's event handler. */
  e:
    | 'sound'
    | 'damage'
    | 'death'
    | 'pickup'
    | 'drop'
    | 'stow'
    | 'sell'
    | 'door'
    | 'quota'
    | 'spawn'
    | 'despawn'
    | 'stun'
    | 'grab'
    | 'release'
    | 'lightning'
    | 'teleport'
    | 'breaker'
    | 'voiceMimic'
    | 'radarBlip'
    | 'shipHorn'
    | 'notice';
  [key: string]: unknown;
}

export type ServerMessage =
  | { t: 'welcome'; playerId: number; version: number; room: string; hostId: number }
  | { t: 'roster'; players: { id: number; name: string; skin: number; ready: boolean; state: PlayerState }[]; hostId: number }
  | {
      t: 'expedition';
      moonId: string | null;
      weather: WeatherId | null;
      seed: number;
      day: number;
      phase: RunPhase;
    }
  | {
      t: 'snapshot';
      tick: number;
      time: number;
      players: PlayerSnapshot[];
      monsters: MonsterSnapshot[];
      ship: ShipSnapshot;
    }
  | { t: 'items'; items: WorldItemSnapshot[]; removed: number[] }
  | { t: 'doors'; doors: DoorSnapshot[] }
  | { t: 'inventory'; slots: InventorySlot[]; held: number }
  | { t: 'terminal'; lines: string[]; clear?: boolean }
  | { t: 'chat'; from: string; fromId: number; text: string; channel: 'local' | 'radio' | 'system' }
  | { t: 'radar'; blips: { id: number; x: number; z: number; level: number; kind: 'crew' | 'unknown' | 'ghost'; name?: string }[] }
  | { t: 'bestiary'; unlocked: string[]; killedBy: string[] }
  | GameEvent
  | { t: 'rtc'; from: number; payload: unknown }
  | { t: 'pong'; time: number };

// ------------------------------------------------------------- input helpers

export const FLAG_CROUCH = 1;
export const FLAG_SPRINT = 2;
export const FLAG_AIRBORNE = 4;
export const FLAG_LIGHT = 8;
export const FLAG_SPEAKING = 16;
export const FLAG_GRABBED = 32;
export const FLAG_WALKIE = 64;

export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}
