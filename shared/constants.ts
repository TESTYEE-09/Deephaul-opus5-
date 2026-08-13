/**
 * Tuning constants. One unit = one metre, one tick = 1/TICK_RATE seconds.
 *
 * Anything here that affects simulation must be identical on client and server,
 * because clients predict their own movement and the server checks it.
 */

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 15;

/** Facility cells. Everything indoors is generated on this grid. */
export const TILE = 4;
export const WALL_HEIGHT = 3.4;
export const CEIL_HEIGHT = 3.4;

export const PLAYER = {
  radius: 0.34,
  height: 1.8,
  eyeHeight: 1.62,
  crouchEyeHeight: 0.95,
  crouchHeight: 1.1,
  walkSpeed: 3.6,
  sprintSpeed: 6.4,
  crouchSpeed: 1.6,
  backpedalFactor: 0.72,
  airControl: 0.25,
  accelGround: 44,
  accelAir: 9,
  friction: 11,
  jumpVelocity: 5.2,
  gravity: 22,
  maxFallSpeed: 45,
  /** Fall damage begins past this impact speed and is lethal well before max. */
  fallDamageSpeed: 13,
  fallLethalSpeed: 24,
  maxHealth: 100,
  /** Stamina is a 0..1 pool; sprinting drains, standing still refills fastest. */
  staminaDrainSprint: 0.19,
  staminaDrainJump: 0.11,
  staminaRegen: 0.16,
  staminaRegenMoving: 0.085,
  staminaExhaustLockout: 1.4,
  /** Carry weight in kg at which you are reduced to a crawl. */
  maxCarryWeight: 55,
  interactRange: 3.0,
  /** How loud a player is to sound-hunting creatures, per movement state. */
  noiseWalk: 1.0,
  noiseSprint: 2.6,
  noiseCrouch: 0.22,
  noiseIdle: 0.06,
  noiseJumpLand: 3.4,
} as const;

export const INVENTORY_SLOTS = 4;

/** A full expedition day, in real seconds, from touchdown to hard midnight. */
export const DAY_LENGTH_SECONDS = 16 * 60;
/** Clock face: 8:00 AM at drop, midnight at the end. */
export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 24;

/** Ship departure timing. */
export const AUTOPILOT_WARNING_AT = 0.9;
export const AUTOPILOT_FORCE_AT = 1.0;
/** Seconds the ship doors take to close once departure begins. */
export const SHIP_DEPART_SECONDS = 12;

export const QUOTA = {
  base: 130,
  /** Deadline length in expedition days. */
  daysPerQuota: 3,
  /** Quota growth: base * (1 + rate)^n with a bit of curve on top. */
  growthRate: 0.16,
  curveExponent: 2.0,
  /** Overtime bonus paid when you clear the quota with days to spare. */
  overtimeBonusPerCredit: 0.15,
  overtimeBonusPerDay: 15,
  /** Crew deaths cost you a cut of the sale. */
  deathPenaltyPercent: 0.2,
  bodyRecoveredPenaltyPercent: 0.05,
  startingCredits: 60,
} as const;

/** The Company's buy rate drifts; selling on a bad day genuinely hurts. */
export const SELL_RATE = {
  min: 0.3,
  max: 1.0,
  /** Rate walks by this much per day, clamped to [min, max]. */
  drift: 0.14,
  start: 1.0,
} as const;

export const AUDIO = {
  /** Distance in metres at which proximity voice fades to nothing. */
  voiceRange: 26,
  voiceFalloffStart: 4,
  /** Walkie-talkie is global but noisy and broadcasts your voice out loud. */
  walkieRange: 4.5,
  /** Sound events louder than this wake up sound-hunting creatures. */
  hearingFloor: 0.05,
} as const;

export const RADAR = {
  /** Ship monitor refresh. Deliberately laggy: the operator gets stale info. */
  refreshSeconds: 0.6,
  /** Positional error added indoors, in metres. */
  indoorJitter: 2.2,
  /** Beyond this many metres from the ship the signal degrades badly. */
  degradeDistance: 220,
} as const;

/** Weight of a scrap item translates to a movement penalty via this curve. */
export function carrySpeedFactor(weightKg: number): number {
  const t = Math.min(weightKg / PLAYER.maxCarryWeight, 1.35);
  return Math.max(0.25, 1 - 0.72 * t * t);
}

export function carryStaminaFactor(weightKg: number): number {
  return 1 + 1.9 * Math.min(weightKg / PLAYER.maxCarryWeight, 1.4);
}

/** Quota for a given quota-cycle index (0 = the first one). */
export function quotaForCycle(n: number): number {
  const linear = QUOTA.base * (1 + QUOTA.growthRate) ** n;
  const curve = QUOTA.base * 0.4 * n ** QUOTA.curveExponent * 0.06;
  return Math.round((linear + curve) / 5) * 5;
}

/** 0..1 progress through the day, mapped to a display clock string. */
export function clockString(dayProgress: number): string {
  const hoursTotal = DAY_START_HOUR + dayProgress * (DAY_END_HOUR - DAY_START_HOUR);
  const h24 = Math.floor(hoursTotal) % 24;
  const m = Math.floor((hoursTotal % 1) * 60);
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}
