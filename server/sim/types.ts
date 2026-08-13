import type { MonsterDef } from '@shared/content/monsters.ts';
import type { PlayerState } from '@shared/protocol.ts';

export interface Vec {
  x: number;
  y: number;
  z: number;
}

export const MODE = {
  idle: 0,
  alert: 1,
  chase: 2,
  attack: 3,
  stunned: 4,
  dormant: 5,
  dead: 6,
} as const;

export type MonsterMode = (typeof MODE)[keyof typeof MODE];

export interface Monster {
  id: number;
  defId: string;
  def: MonsterDef;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Facility level index, or -1 for outdoors. */
  level: number;
  mode: MonsterMode;
  /** Drives animation blending on the client. */
  anim: number;
  health: number;
  /** Server time at which a stun expires. */
  stunUntil: number;
  /** Player id being hunted, or -1. */
  target: number;
  lastKnown: { x: number; z: number; level: number; at: number } | null;
  path: number[];
  pathIndex: number;
  repathAt: number;
  nextAttackAt: number;
  /** Set while an attack windup is in flight. */
  windupUntil: number;
  windupTarget: number;
  /** Where it started; territorial and nest behaviours anchor here. */
  home: { x: number; z: number; level: number };
  /** Per-brain scratch space. */
  mem: Record<string, number>;
  /** Scrap instance ids this creature is carrying. */
  carrying: number[];
  nextVoiceAt: number;
  spawnedAt: number;
  /** Creatures that have never been seen do not appear in the bestiary. */
  seen: boolean;
}

export interface WorldItem {
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
  /** Player id, monster id (negative), or -1 for on the ground. */
  heldBy: number;
  stowed: boolean;
  /** Physics: items thrown or dropped fall and settle. */
  vx: number;
  vy: number;
  vz: number;
  settled: boolean;
  /** Body-specific: which player this was. */
  bodyOf?: number;
  bodyName?: string;
  /** For noisy scrap. */
  nextNoiseAt: number;
  /** Deployed equipment (floodlight, ladder, flare) is active in the world. */
  deployed: boolean;
  deployedUntil: number;
}

export interface DoorRuntime {
  id: number;
  /** 0 shut, 1 open, 2 opening, 3 closing, 4 cut open permanently. */
  state: number;
  locked: boolean;
  powered: boolean;
  /** Server time when the current transition completes. */
  moveUntil: number;
  /** Cutting progress in seconds. */
  cutProgress: number;
}

export interface NoiseEvent {
  x: number;
  y: number;
  z: number;
  level: number;
  loudness: number;
  at: number;
  /** Player who made it, or -1 for world noise. */
  source: number;
  /** Decoys read as crew noise to everything that hunts by sound. */
  fake: boolean;
}

export interface ServerPlayer {
  id: number;
  name: string;
  skin: number;
  ready: boolean;
  state: PlayerState;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  level: number;
  flags: number;
  health: number;
  stamina: number;
  /** Slots hold world item ids. */
  slots: (number | null)[];
  held: number;
  /** Set while a snare has hold of them. */
  grabbedBy: number;
  lastInputAt: number;
  lastSeq: number;
  /** Cumulative noise the player is currently generating. */
  noise: number;
  /** Horizontal speed in m/s, derived from consecutive inputs. */
  speed: number;
  /** Server time of last damage, used for regen and hit feedback. */
  lastHurtAt: number;
  /** Which teammate the ship monitor is watching. */
  monitorTarget: number;
  insideShip: boolean;
  /** Time of death, for the spectator UI. */
  diedAt: number;
  causeOfDeath: string;
  connected: boolean;
}
