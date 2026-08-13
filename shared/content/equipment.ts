/**
 * Purchasable equipment and ship upgrades.
 *
 * Design rule: every item should change what the crew can attempt, not just
 * raise a number. A brighter torch is boring. A torch that lets one person
 * light a room for everyone while making them the most visible thing in it is
 * a decision.
 */

export type EquipmentKind =
  | 'light'
  | 'melee'
  | 'tool'
  | 'comms'
  | 'utility'
  | 'deployable';

export interface EquipmentDef {
  id: string;
  name: string;
  kind: EquipmentKind;
  model: string;
  fit: number;
  price: number;
  weight: number;
  /** Occupies both hands while in use. */
  twoHanded?: boolean;
  /** Seconds of battery at full use; 0 = no battery. */
  battery: number;
  /** Recharges in the ship's charging rack at this rate (seconds per second). */
  rechargeRate: number;
  description: string;
  /** Terminal blurb, deliberately unhelpful. */
  blurb: string;
  stats?: Record<string, number>;
}

export const EQUIPMENT: EquipmentDef[] = [
  {
    id: 'torch',
    name: 'Hand Torch',
    kind: 'light',
    model: 'prop.survival/Torch',
    fit: 0.32,
    price: 25,
    weight: 1,
    battery: 240,
    rechargeRate: 4,
    description: 'Narrow beam, short range, unreliable.',
    blurb: 'Standard issue. Issued once.',
    stats: { range: 16, angle: 0.42, intensity: 2.6 },
  },
  {
    id: 'lamp-pro',
    name: 'Survey Lamp',
    kind: 'light',
    model: 'prop.survival/Torch',
    fit: 0.4,
    price: 70,
    weight: 2,
    battery: 420,
    rechargeRate: 4,
    description: 'Wide, bright, long-lived. Visible from a very long way off.',
    blurb: 'Illuminates the work area. And the employee. And whatever is watching the employee.',
    stats: { range: 30, angle: 0.72, intensity: 4.6 },
  },
  {
    id: 'floodlight',
    name: 'Standing Floodlight',
    kind: 'deployable',
    model: 'prop.house/Light_Floor2',
    fit: 1.1,
    price: 110,
    weight: 9,
    battery: 600,
    rechargeRate: 3,
    description: 'Place it. It lights a whole room and does not move.',
    blurb: 'Deployable. Recovery of deployed equipment is the employee’s responsibility.',
    stats: { range: 20, intensity: 5.5 },
  },
  {
    id: 'shovel',
    name: 'Site Shovel',
    kind: 'melee',
    model: 'prop.survival/Shovel',
    fit: 1.1,
    price: 35,
    weight: 5,
    battery: 0,
    rechargeRate: 0,
    twoHanded: false,
    description: 'Wide swing, slow recovery. Will not kill most things.',
    blurb: 'Rated for soil.',
    stats: { damage: 34, swingTime: 0.85, range: 2.4, arc: 1.3, stagger: 1.4 },
  },
  {
    id: 'pry-bar',
    name: 'Pry Bar',
    kind: 'melee',
    model: 'prop.rpg/Hammer_Double',
    fit: 0.9,
    price: 55,
    weight: 6,
    battery: 0,
    rechargeRate: 0,
    description: 'Less reach than a shovel, hits considerably harder. Also opens things.',
    blurb: 'Multi-purpose. The Company acknowledges only one of those purposes.',
    stats: { damage: 52, swingTime: 1.05, range: 1.9, arc: 0.9, stagger: 2.0, pryStrength: 1 },
  },
  {
    id: 'stun-charge',
    name: 'Stun Charge',
    kind: 'tool',
    model: 'prop.survival/FlareGun',
    fit: 0.3,
    price: 90,
    weight: 2,
    battery: 60,
    rechargeRate: 1.5,
    description: 'Single-use per charge. Stops most things for a few seconds. Not all things.',
    blurb: 'Effective against listed fauna. The list is not provided.',
    stats: { radius: 9, seconds: 1.0, cone: 1.6 },
  },
  {
    id: 'walkie',
    name: 'Walkie-Talkie',
    kind: 'comms',
    model: 'prop.survival/Radio',
    fit: 0.26,
    price: 45,
    weight: 1,
    battery: 900,
    rechargeRate: 5,
    description: 'Talk to anyone holding one, anywhere on the moon. Broadcasts out loud at both ends.',
    blurb: 'Two-way. Everything in the room hears both ways.',
    stats: { noise: 2.2 },
  },
  {
    id: 'locksmith',
    name: 'Lock Cutter',
    kind: 'tool',
    model: 'hero/bolt_cutters_01',
    fit: 0.7,
    price: 130,
    weight: 6,
    battery: 0,
    rechargeRate: 0,
    twoHanded: true,
    description: 'Opens locked doors. Takes several seconds and makes a lot of noise.',
    blurb: 'Authorised for Company property only. All property is Company property.',
    stats: { cutSeconds: 4.5, noise: 3.2 },
  },
  {
    id: 'scanner',
    name: 'Hand Scanner',
    kind: 'tool',
    model: 'prop.survival/Compass_Open',
    fit: 0.22,
    price: 75,
    weight: 1,
    battery: 300,
    rechargeRate: 4,
    description: 'Pings nearby scrap and marks approximate direction and value.',
    blurb: 'Detects value. Does not detect anything standing next to the value.',
    stats: { range: 34, pingInterval: 2.4 },
  },
  {
    id: 'ladder',
    name: 'Extension Ladder',
    kind: 'deployable',
    model: 'kit.factory/catwalk-stairs',
    fit: 2.4,
    price: 95,
    weight: 14,
    battery: 0,
    rechargeRate: 0,
    twoHanded: true,
    description: 'Deploy to climb terrain, reach catwalks, or bridge a pit. Heavy.',
    blurb: 'Extends. Retracts on a timer that was set by someone else.',
    stats: { height: 7 },
  },
  {
    id: 'rope',
    name: 'Descent Line',
    kind: 'deployable',
    model: 'prop.cyber/Cable_Thick',
    fit: 0.4,
    price: 60,
    weight: 4,
    battery: 0,
    rechargeRate: 0,
    description: 'Anchor at a drop to descend safely, and climb back up. Cheaper than a broken leg.',
    blurb: 'Rated for one employee. Rating assumes an average employee.',
    stats: { length: 12 },
  },
  {
    id: 'jetpack',
    name: 'Lift Harness',
    kind: 'utility',
    model: 'prop.survival/Backpack',
    fit: 0.5,
    price: 380,
    weight: 8,
    battery: 90,
    rechargeRate: 2,
    twoHanded: false,
    description: 'Vertical thrust. Extremely fast, extremely fatal, extremely funny.',
    blurb: 'Do not operate indoors. Do not operate outdoors. Operates.',
    stats: { thrust: 17, drift: 5.5 },
  },
  {
    id: 'flare',
    name: 'Signal Flare',
    kind: 'deployable',
    model: 'prop.survival/Match_Fire',
    fit: 0.24,
    price: 20,
    weight: 1,
    battery: 0,
    rechargeRate: 0,
    description: 'Throwable. Burns for ninety seconds. Loud, bright, and every bit as attractive as that sounds.',
    blurb: 'Marks a position. Marks it for everyone.',
    stats: { burnSeconds: 90, range: 14, noise: 1.6 },
  },
  {
    id: 'noisemaker',
    name: 'Decoy Chirper',
    kind: 'deployable',
    model: 'prop.survival/Phone',
    fit: 0.2,
    price: 85,
    weight: 1,
    battery: 0,
    rechargeRate: 0,
    description: 'Throw it. It makes crew-sized noise somewhere you are not.',
    blurb: 'Simulates employee activity. Cannot simulate employee value.',
    stats: { noise: 3.0, seconds: 25 },
  },
];

export const EQUIPMENT_BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));

export function equipmentById(id: string): EquipmentDef {
  const e = EQUIPMENT_BY_ID.get(id);
  if (!e) throw new Error(`unknown equipment: ${id}`);
  return e;
}

// ---------------------------------------------------------------- ship upgrades

export type UpgradeId =
  | 'teleporter'
  | 'inverse-teleporter'
  | 'signal-booster'
  | 'cargo-rack'
  | 'charging-rack'
  | 'floodlights'
  | 'sample-tank'
  | 'loud-horn'
  | 'coffee-machine';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  price: number;
  description: string;
  blurb: string;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'teleporter',
    name: 'Recovery Teleporter',
    price: 350,
    description: 'The ship operator can yank a selected crewmate back aboard. Everything they were carrying stays behind.',
    blurb: 'Retrieves the employee. Does not retrieve the employee’s equipment, cargo, or dignity.',
  },
  {
    id: 'inverse-teleporter',
    name: 'Insertion Teleporter',
    price: 425,
    description: 'Sends the crew to a random point deep inside the facility. No return trip.',
    blurb: 'One-way. Placement is stochastic. Placement is final.',
  },
  {
    id: 'signal-booster',
    name: 'Signal Booster',
    price: 210,
    description: 'Radar holds accuracy at range and indoors. Walkie static reduced.',
    blurb: 'Improves the operator’s picture. Does not improve what is in the picture.',
  },
  {
    id: 'cargo-rack',
    name: 'Cargo Rack',
    price: 180,
    description: 'Adds a fifth carry slot to every crew member.',
    blurb: 'Increases per-employee capacity. Adjusts expectations accordingly.',
  },
  {
    id: 'charging-rack',
    name: 'Charging Rack',
    price: 140,
    description: 'Equipment left in the ship recharges twice as fast between drops.',
    blurb: 'Charges equipment. Employees are not equipment.',
  },
  {
    id: 'floodlights',
    name: 'Exterior Floodlights',
    price: 160,
    description: 'Lights the landing zone. Makes the last hundred metres survivable, and visible.',
    blurb: 'Illuminates the approach. From both directions.',
  },
  {
    id: 'sample-tank',
    name: 'Containment Tank',
    price: 300,
    description: 'Anomalous scrap sells for forty percent more if it is stored in the tank.',
    blurb: 'Contains specimens. Sealed. The seal is monitored. Do not monitor the seal.',
  },
  {
    id: 'loud-horn',
    name: 'Ship Horn',
    price: 90,
    description: 'A very loud horn. Audible across the entire landing zone. Attracts everything with ears.',
    blurb: 'Signalling device. The Company has no recorded use case.',
  },
  {
    id: 'coffee-machine',
    name: 'Canteen Unit',
    price: 120,
    description: 'Crew that spend time aboard between drops start the next day with more stamina.',
    blurb: 'Morale provision. Consumption is logged.',
  },
];

export const UPGRADES_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));
