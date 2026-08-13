/**
 * Creature definitions.
 *
 * The rule the whole roster is built around: no two creatures should be solved
 * the same way. If the answer to a creature is "run away and shut a door", it
 * already exists and does not need a second entry. Each `brain` below is a
 * distinct behaviour module in server/ai, and each one asks the crew a
 * different question.
 */

export type BrainId =
  | 'pack'        // weak alone, lethal in numbers, emboldened by allies nearby
  | 'ambush'      // motionless until something walks underneath
  | 'territorial' // owns a room; ignores you until you take from it
  | 'thief'       // steals scrap and hauls it to a nest
  | 'soundhunter' // blind; navigates entirely by noise events
  | 'mimic'       // pretends to be a door
  | 'psych'       // fakes voices, radar blips and footsteps
  | 'motion'      // only registers you while you are moving fast
  | 'stalker'     // trails at range, commits only when you are alone
  | 'giant'       // slow, unstoppable, route-denial
  | 'decoy'       // looks like a downed crewmate
  | 'snare'       // static grab trap
  | 'skittish'    // harmless until startled, then catastrophic
  | 'apex'        // straightforward pursuit predator, late day only
  | 'lure'        // imitates a light source to walk you off a cliff
  | 'seismic';    // tracks footfall vibration; freeze and it loses you

export interface MonsterDef {
  id: string;
  name: string;
  /** Terminal bestiary name once the crew has survived one. */
  codename: string;
  model: string;
  /** Target height in metres; the model is scaled to match. */
  fit: number;
  brain: BrainId;
  where: 'indoor' | 'outdoor' | 'both';

  /** Spawn budget cost. The moon's power cap limits how many can exist. */
  power: number;
  maxAlive: number;
  groupSize: [number, number];
  /** Day-progress window in which this thing is allowed to arrive. */
  window: [number, number];

  health: number;
  /** Damage per hit. Player has 100 HP. */
  damage: number;
  attackRange: number;
  attackCooldown: number;
  /** Seconds of windup before the hit lands - your window to get out. */
  attackWindup: number;

  speed: { wander: number; alert: number; chase: number };
  senses: {
    sight: number;
    /** Field of view in radians, total cone. */
    fov: number;
    hearing: number;
    /** Noise level that registers at all. */
    hearingFloor: number;
    /** Seconds it keeps hunting your last known position. */
    memory: number;
  };

  flags?: {
    opensDoors?: boolean;
    /** Cannot fit through standard doorways; large rooms and corridors only. */
    largeFrame?: boolean;
    /** Flies: ignores floor height, cannot be blocked by furniture. */
    flying?: boolean;
    /** Backs off from bright light. */
    lightAverse?: number;
    /** Attracted to light. */
    lightSeeking?: boolean;
    /** Can be stunned, and for how long by a standard stun charge. */
    stunSeconds?: number;
    /** Melee weapons do this multiplier of damage to it. */
    meleeVulnerability?: number;
    /** Kills in one hit regardless of health. */
    instantKill?: boolean;
    /** Drops scrap it was carrying on death. */
    carriesLoot?: boolean;
    /** Emits light. */
    glow?: { color: number; intensity: number; range: number };
  };

  /** Procedural voice parameters - see client/audio/creature.ts. */
  voice: {
    /** Base frequency of its call, Hz. */
    freq: number;
    /** 'growl' | 'click' | 'wail' | 'chitter' | 'rumble' | 'breath' | 'chime' */
    timbre: 'growl' | 'click' | 'wail' | 'chitter' | 'rumble' | 'breath' | 'chime';
    /** Average seconds between idle vocalisations. 0 = silent. */
    idleInterval: number;
    /** How far the call carries, metres. */
    range: number;
  };

  /** Bestiary text, revealed after first encounter. */
  lore: string;
  /** Practical hint, revealed after the creature has killed someone. */
  hint: string;
}

export const MONSTERS: MonsterDef[] = [
  // ------------------------------------------------------------------- indoor
  {
    id: 'gnashling',
    name: 'Gnashling',
    codename: 'PEST-CLASS 04',
    model: 'mob.easy/Rat',
    fit: 0.45,
    brain: 'pack',
    where: 'indoor',
    power: 1,
    maxAlive: 12,
    groupSize: [2, 5],
    window: [0, 1],
    health: 22,
    damage: 9,
    attackRange: 1.1,
    attackCooldown: 1.1,
    attackWindup: 0.28,
    speed: { wander: 1.6, alert: 3.4, chase: 5.1 },
    senses: { sight: 14, fov: 3.0, hearing: 16, hearingFloor: 0.35, memory: 7 },
    flags: { stunSeconds: 5, meleeVulnerability: 1.6 },
    voice: { freq: 620, timbre: 'chitter', idleInterval: 5, range: 22 },
    lore: 'Colonial. Individually negligible. The Company does not classify them as a hazard below a count of four.',
    hint: 'One will back off if you swing at it. Four will not.',
  },
  {
    id: 'latchbug',
    name: 'Latchbug',
    codename: 'AMBUSH-CLASS 01',
    model: 'mob.easy/Spider',
    fit: 0.8,
    brain: 'ambush',
    where: 'indoor',
    power: 2,
    maxAlive: 6,
    groupSize: [1, 1],
    window: [0, 1],
    health: 40,
    damage: 32,
    attackRange: 1.5,
    attackCooldown: 2.2,
    attackWindup: 0.15,
    speed: { wander: 0, alert: 3.0, chase: 4.4 },
    senses: { sight: 9, fov: 6.28, hearing: 8, hearingFloor: 0.5, memory: 6 },
    flags: { stunSeconds: 4, meleeVulnerability: 1.2 },
    voice: { freq: 1400, timbre: 'click', idleInterval: 13, range: 12 },
    lore: 'Waits on ceilings and inside ducting. Does not move until something passes beneath it.',
    hint: 'Look up in doorways. They click just before they drop.',
  },
  {
    id: 'sifter',
    name: 'Sifter',
    codename: 'TERRITORIAL-CLASS 02',
    model: 'mob.easy/Frog',
    fit: 1.1,
    brain: 'territorial',
    where: 'indoor',
    power: 2,
    maxAlive: 4,
    groupSize: [1, 1],
    window: [0, 1],
    health: 90,
    damage: 42,
    attackRange: 1.8,
    attackCooldown: 2.4,
    attackWindup: 0.45,
    speed: { wander: 0.9, alert: 2.4, chase: 4.9 },
    senses: { sight: 12, fov: 2.6, hearing: 10, hearingFloor: 0.4, memory: 9 },
    flags: { stunSeconds: 6, meleeVulnerability: 1.0 },
    voice: { freq: 190, timbre: 'growl', idleInterval: 8, range: 26 },
    lore: 'Settles in a single room and defends its floor space. Does not pursue beyond its territory.',
    hint: 'It only cares about the room it is standing in. Leave the scrap. Leave the room.',
  },
  {
    id: 'hoarder',
    name: 'Hoarder',
    codename: 'ACQUISITION-CLASS 07',
    model: 'mob.ultimate/Orc',
    fit: 1.5,
    brain: 'thief',
    where: 'indoor',
    power: 2,
    maxAlive: 4,
    groupSize: [1, 1],
    window: [0, 1],
    health: 110,
    damage: 55,
    attackRange: 1.9,
    attackCooldown: 2.0,
    attackWindup: 0.4,
    speed: { wander: 2.4, alert: 3.6, chase: 5.6 },
    senses: { sight: 18, fov: 3.4, hearing: 14, hearingFloor: 0.3, memory: 12 },
    flags: { opensDoors: true, stunSeconds: 5, meleeVulnerability: 0.8, carriesLoot: true },
    voice: { freq: 240, timbre: 'growl', idleInterval: 7, range: 30 },
    lore: 'Collects. Transports collected material to a fixed cache. Becomes hostile only in defence of the cache.',
    hint: 'It will take scrap out of a pile and walk away with it. Following it home is a decision, not an accident.',
  },
  {
    id: 'tallow',
    name: 'Tallow',
    codename: 'ACOUSTIC-CLASS 09',
    model: 'mob.ultimate/CreepCreature',
    fit: 2.1,
    brain: 'soundhunter',
    where: 'indoor',
    power: 4,
    maxAlive: 3,
    groupSize: [1, 1],
    window: [0, 1],
    health: 200,
    damage: 100,
    attackRange: 2.2,
    attackCooldown: 2.6,
    attackWindup: 0.55,
    speed: { wander: 1.4, alert: 3.2, chase: 6.9 },
    senses: { sight: 0, fov: 0, hearing: 42, hearingFloor: 0.14, memory: 14 },
    flags: { opensDoors: true, stunSeconds: 8, meleeVulnerability: 0.5, instantKill: true },
    voice: { freq: 96, timbre: 'breath', idleInterval: 6, range: 40 },
    lore: 'No visual apparatus. Navigates and hunts entirely on airborne sound.',
    hint: 'It cannot see you at all. Walk. Do not sprint, do not jump, do not shout into the radio.',
  },
  {
    id: 'mimicdoor',
    name: 'Mimic',
    codename: 'STRUCTURAL-CLASS 00',
    model: 'kit.station/door-single-closed',
    fit: 2.6,
    brain: 'mimic',
    where: 'indoor',
    power: 3,
    maxAlive: 3,
    groupSize: [1, 1],
    window: [0, 1],
    health: 999,
    damage: 100,
    attackRange: 2.4,
    attackCooldown: 4,
    attackWindup: 0.2,
    speed: { wander: 0, alert: 0, chase: 0 },
    senses: { sight: 6, fov: 3.0, hearing: 5, hearingFloor: 0.4, memory: 3 },
    flags: { instantKill: true },
    voice: { freq: 70, timbre: 'breath', idleInterval: 0, range: 8 },
    lore: 'Occupies fire exit frames. Structurally convincing. Anatomically not a door.',
    hint: 'Count the fire exits on the map. If there is one more door than the map shows, that is the one.',
  },
  {
    id: 'choirman',
    name: 'Choirman',
    codename: 'SIGNAL-CLASS 11',
    model: 'char.ghosts/character-ghost',
    fit: 1.9,
    brain: 'psych',
    where: 'indoor',
    power: 3,
    maxAlive: 2,
    groupSize: [1, 1],
    window: [0.15, 1],
    health: 999,
    damage: 100,
    attackRange: 1.6,
    attackCooldown: 3,
    attackWindup: 0.9,
    speed: { wander: 1.1, alert: 2.2, chase: 3.4 },
    senses: { sight: 26, fov: 6.28, hearing: 30, hearingFloor: 0.2, memory: 20 },
    flags: { instantKill: true, lightAverse: 0.7, glow: { color: 0x8fb8c8, intensity: 0.25, range: 5 } },
    voice: { freq: 330, timbre: 'wail', idleInterval: 11, range: 34 },
    lore: 'Reproduces crew vocal signatures with high fidelity. Reproduction is not communication.',
    hint: 'If a crewmate is calling you and the radar says they are on the other side of the map, do not go.',
  },
  {
    id: 'weaver',
    name: 'Weaver',
    codename: 'KINETIC-CLASS 05',
    model: 'mob.easy/Wasp',
    fit: 0.7,
    brain: 'motion',
    where: 'indoor',
    power: 2,
    maxAlive: 5,
    groupSize: [1, 2],
    window: [0, 1],
    health: 55,
    damage: 38,
    attackRange: 1.4,
    attackCooldown: 1.6,
    attackWindup: 0.25,
    speed: { wander: 2.2, alert: 4.4, chase: 7.4 },
    senses: { sight: 20, fov: 4.2, hearing: 6, hearingFloor: 0.9, memory: 5 },
    flags: { flying: true, stunSeconds: 4, meleeVulnerability: 1.4 },
    voice: { freq: 780, timbre: 'chitter', idleInterval: 4, range: 20 },
    lore: 'Registers velocity, not shape. A stationary employee is not a stimulus.',
    hint: 'Stop moving. All the way stopped. It loses interest in about two seconds.',
  },
  {
    id: 'brinehound',
    name: 'Brinehound',
    codename: 'PURSUIT-CLASS 06',
    model: 'mob.animals/Husky',
    fit: 1.0,
    brain: 'stalker',
    where: 'both',
    power: 3,
    maxAlive: 4,
    groupSize: [1, 1],
    window: [0.1, 1],
    health: 85,
    damage: 46,
    attackRange: 1.6,
    attackCooldown: 1.4,
    attackWindup: 0.3,
    speed: { wander: 2.0, alert: 3.8, chase: 7.0 },
    senses: { sight: 30, fov: 3.6, hearing: 22, hearingFloor: 0.25, memory: 25 },
    flags: { opensDoors: true, stunSeconds: 5, meleeVulnerability: 1.1 },
    voice: { freq: 210, timbre: 'growl', idleInterval: 9, range: 28 },
    lore: 'Maintains distance from groups. Closes on isolated targets. Patient.',
    hint: 'It will not commit while two of you are looking at it. Do not be the one who wandered off.',
  },
  {
    id: 'quarryman',
    name: 'Quarryman',
    codename: 'MASS-CLASS 12',
    model: 'mob.mech/Stan',
    fit: 3.4,
    brain: 'giant',
    where: 'indoor',
    power: 6,
    maxAlive: 1,
    groupSize: [1, 1],
    window: [0.25, 1],
    health: 9999,
    damage: 100,
    attackRange: 3.0,
    attackCooldown: 3.2,
    attackWindup: 0.7,
    speed: { wander: 1.5, alert: 2.6, chase: 4.6 },
    senses: { sight: 22, fov: 2.4, hearing: 26, hearingFloor: 0.3, memory: 18 },
    flags: { largeFrame: true, instantKill: true, opensDoors: true },
    voice: { freq: 62, timbre: 'rumble', idleInterval: 5, range: 55 },
    lore: 'Cannot pass a standard doorway. Does not need to; it walks the main halls and waits for you to use them.',
    hint: 'It cannot follow you into a side room. It knows you have to come out.',
  },
  {
    id: 'hollow',
    name: 'Hollow',
    codename: 'IMITATION-CLASS 13',
    model: 'char.ghosts/character-keeper',
    fit: 1.85,
    brain: 'decoy',
    where: 'both',
    power: 4,
    maxAlive: 2,
    groupSize: [1, 1],
    window: [0.3, 1],
    health: 999,
    damage: 100,
    attackRange: 2.0,
    attackCooldown: 3,
    attackWindup: 0.5,
    speed: { wander: 0, alert: 2.8, chase: 6.2 },
    senses: { sight: 24, fov: 6.28, hearing: 14, hearingFloor: 0.3, memory: 15 },
    flags: { instantKill: true, lightAverse: 0.4 },
    voice: { freq: 130, timbre: 'breath', idleInterval: 0, range: 16 },
    lore: 'Adopts the posture of a fallen employee. Remains still for as long as required.',
    hint: 'Bodies do not face the door. If it is lying there looking at you, it is not a body.',
  },

  // ------------------------------------------------------------------ outdoor
  {
    id: 'nightbriar',
    name: 'Nightbriar',
    codename: 'FLORA-CLASS 03',
    model: 'ext.nature/Bush_1',
    fit: 1.3,
    brain: 'snare',
    where: 'outdoor',
    power: 1,
    maxAlive: 8,
    groupSize: [1, 3],
    window: [0, 1],
    health: 60,
    damage: 5,
    attackRange: 2.0,
    attackCooldown: 1.0,
    attackWindup: 0.2,
    speed: { wander: 0, alert: 0, chase: 0 },
    senses: { sight: 0, fov: 0, hearing: 4, hearingFloor: 0.2, memory: 4 },
    flags: { stunSeconds: 3, meleeVulnerability: 2.2 },
    voice: { freq: 150, timbre: 'chitter', idleInterval: 0, range: 8 },
    lore: 'Sessile. Grips and holds. Does not itself consume.',
    hint: 'You cannot pull free alone while carrying anything. Drop the scrap or wait for a crewmate.',
  },
  {
    id: 'drifter',
    name: 'Drifter',
    codename: 'GRAZER-CLASS 08',
    model: 'mob.dino/Parasaurolophus',
    fit: 4.2,
    brain: 'skittish',
    where: 'outdoor',
    power: 2,
    maxAlive: 3,
    groupSize: [1, 2],
    window: [0, 1],
    health: 600,
    damage: 100,
    attackRange: 3.4,
    attackCooldown: 3.0,
    attackWindup: 0.4,
    speed: { wander: 1.6, alert: 2.4, chase: 8.2 },
    senses: { sight: 34, fov: 3.2, hearing: 30, hearingFloor: 0.5, memory: 8 },
    flags: { largeFrame: true, instantKill: true },
    voice: { freq: 120, timbre: 'wail', idleInterval: 12, range: 70 },
    lore: 'Non-predatory. Reacts poorly to sudden proximity, bright light and shouting.',
    hint: 'Walk past it. It has killed more employees than anything on the roster and none of them on purpose.',
  },
  {
    id: 'pack_scur',
    name: 'Scur',
    codename: 'PACK-CLASS 10',
    model: 'mob.animals/Fox',
    fit: 0.8,
    brain: 'pack',
    where: 'outdoor',
    power: 1,
    maxAlive: 10,
    groupSize: [3, 6],
    window: [0.35, 1],
    health: 40,
    damage: 16,
    attackRange: 1.3,
    attackCooldown: 1.0,
    attackWindup: 0.22,
    speed: { wander: 2.6, alert: 5.0, chase: 7.6 },
    senses: { sight: 40, fov: 4.0, hearing: 26, hearingFloor: 0.3, memory: 12 },
    flags: { stunSeconds: 4, meleeVulnerability: 1.5 },
    voice: { freq: 520, timbre: 'wail', idleInterval: 7, range: 46 },
    lore: 'Coordinated. Arrives after sundown and works the ground between the facility and the ship.',
    hint: 'They cut off the route back, not the way in. Leave earlier than you think you need to.',
  },
  {
    id: 'hauler',
    name: 'Hauler',
    codename: 'APEX-CLASS 14',
    model: 'mob.dino/Trex',
    fit: 5.0,
    brain: 'apex',
    where: 'outdoor',
    power: 5,
    maxAlive: 2,
    groupSize: [1, 1],
    window: [0.5, 1],
    health: 1200,
    damage: 100,
    attackRange: 3.6,
    attackCooldown: 2.2,
    attackWindup: 0.5,
    speed: { wander: 2.2, alert: 4.2, chase: 8.8 },
    senses: { sight: 60, fov: 3.6, hearing: 44, hearingFloor: 0.3, memory: 22 },
    flags: { largeFrame: true, instantKill: true },
    voice: { freq: 78, timbre: 'rumble', idleInterval: 9, range: 110 },
    lore: 'Nocturnal surface predator. Cannot enter structures.',
    hint: 'It cannot follow you inside and it cannot reach the ship ramp. Everything between those two points is its.',
  },
  {
    id: 'lumen',
    name: 'Lumen',
    codename: 'LURE-CLASS 15',
    model: 'prop.cyber/Enemy_Flying',
    fit: 0.9,
    brain: 'lure',
    where: 'outdoor',
    power: 2,
    maxAlive: 4,
    groupSize: [1, 2],
    window: [0.3, 1],
    health: 30,
    damage: 24,
    attackRange: 1.8,
    attackCooldown: 2.0,
    attackWindup: 0.35,
    speed: { wander: 2.0, alert: 3.4, chase: 5.4 },
    senses: { sight: 46, fov: 6.28, hearing: 12, hearingFloor: 0.4, memory: 16 },
    flags: { flying: true, stunSeconds: 6, meleeVulnerability: 2.0, glow: { color: 0xa8d8ff, intensity: 2.2, range: 16 } },
    voice: { freq: 900, timbre: 'chime', idleInterval: 8, range: 40 },
    lore: 'Emits a light in the visible band closely matching Company-issue equipment.',
    hint: 'The ship beacon does not move and the crew flashlight does not hover. Check the radar before you walk toward a light.',
  },
  {
    id: 'colossus',
    name: 'Colossus',
    codename: 'SEISMIC-CLASS 16',
    model: 'mob.dino/Trex',
    fit: 9.0,
    brain: 'seismic',
    where: 'outdoor',
    power: 7,
    maxAlive: 1,
    groupSize: [1, 1],
    window: [0.2, 1],
    health: 99999,
    damage: 100,
    attackRange: 6.0,
    attackCooldown: 4.0,
    attackWindup: 0.9,
    speed: { wander: 2.6, alert: 3.4, chase: 7.4 },
    senses: { sight: 0, fov: 0, hearing: 90, hearingFloor: 0.5, memory: 10 },
    flags: { largeFrame: true, instantKill: true },
    voice: { freq: 44, timbre: 'rumble', idleInterval: 7, range: 200 },
    lore: 'Blind. Detects surface vibration. Range of detection is the entire landing zone.',
    hint: 'When you hear it close, stand completely still. Not crouched. Still.',
  },
];

export const MONSTERS_BY_ID = new Map(MONSTERS.map((m) => [m.id, m]));

export function monsterById(id: string): MonsterDef {
  const m = MONSTERS_BY_ID.get(id);
  if (!m) throw new Error(`unknown monster: ${id}`);
  return m;
}
