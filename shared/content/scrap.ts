/**
 * The scrap table.
 *
 * `model` points at "<catalog group>/<model name>" from client/public/assets.
 * If a model is missing the client falls back to a procedural crate, so the
 * table is safe to extend before the art exists.
 *
 * Value ranges are pre-multiplier. The moon multiplies them, then the Company's
 * daily buy rate cuts the whole pile down at the counter.
 */

export type ScrapSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge';

export interface ScrapDef {
  id: string;
  name: string;
  model: string;
  /** Target longest-axis size in metres. Models are scaled to fit. */
  fit: number;
  value: [number, number];
  /** Kilograms. Above ~30 you will not outrun anything. */
  weight: number;
  size: ScrapSize;
  /** Occupies both hands: no equipment use, no ladder climbing, slower turn. */
  twoHanded?: boolean;
  /** Spawn weight. Higher shows up more often. */
  rarity: number;
  /** Only spawns where the tag matches a room's tags, if set. */
  rooms?: string[];
  /** Only on these moons (by moon id) if set. */
  moons?: string[];
  flags?: {
    /** Attracts lightning in storms while carried outdoors. */
    conductive?: boolean;
    /** Emits noise on its own, periodically. Sound hunters love these. */
    noisy?: number;
    /** Loses value when dropped from height or thrown. */
    fragile?: number;
    /** Emits light when held. */
    light?: { color: number; intensity: number; range: number };
    /** Detonates when destroyed. */
    explosive?: number;
    /** Sells for more but the Company logs your name next to it. */
    anomalous?: boolean;
  };
  /** Flavour, shown in the ship's inventory readout. */
  note?: string;
}

export const SCRAP: ScrapDef[] = [
  // ------------------------------------------------------------- common junk
  { id: 'bolt-tin', name: 'Tin of Bolts', model: 'prop.survival/Can_Closed', fit: 0.3, value: [8, 22], weight: 4, size: 'small', rarity: 100 },
  { id: 'ration-can', name: 'Dented Ration Can', model: 'prop.survival/Can_Open', fit: 0.28, value: [5, 16], weight: 2, size: 'small', rarity: 110 },
  { id: 'red-can', name: 'Unlabelled Red Can', model: 'prop.survival/Can_Red', fit: 0.3, value: [9, 26], weight: 3, size: 'small', rarity: 80, note: 'Contents unlisted. Do not open on company time.' },
  { id: 'broken-can', name: 'Split Canister', model: 'prop.survival/Can_Broken', fit: 0.3, value: [4, 12], weight: 2, size: 'small', rarity: 70 },
  { id: 'water-bottle', name: 'Site Water Bottle', model: 'prop.survival/WaterBottle_2', fit: 0.3, value: [6, 15], weight: 2, size: 'small', rarity: 85 },
  { id: 'matchbox', name: 'Damp Matchbox', model: 'prop.survival/Matchbox', fit: 0.14, value: [4, 11], weight: 1, size: 'tiny', rarity: 75 },
  { id: 'bandage-roll', name: 'Expired Bandages', model: 'prop.survival/Bandages', fit: 0.2, value: [7, 18], weight: 1, size: 'tiny', rarity: 70 },
  { id: 'first-aid', name: 'Rusted First Aid Box', model: 'prop.survival/FirstAidKit_Hard', fit: 0.42, value: [22, 48], weight: 7, size: 'medium', rarity: 55 },
  { id: 'gas-can', name: 'Fuel Can', model: 'prop.survival/GasCan', fit: 0.45, value: [24, 52], weight: 11, size: 'medium', rarity: 60, flags: { conductive: true, explosive: 0.5 } },
  { id: 'propane', name: 'Propane Cylinder', model: 'prop.survival/PropaneTank', fit: 0.9, value: [40, 88], weight: 24, size: 'large', rarity: 34, flags: { conductive: true, explosive: 1 }, note: 'Handle-with-care sticker peeled off long ago.' },
  { id: 'compass', name: 'Surveyor Compass', model: 'prop.survival/Compass_Open', fit: 0.16, value: [18, 40], weight: 1, size: 'tiny', rarity: 45 },
  { id: 'pan', name: 'Scorched Pan', model: 'prop.survival/Pan', fit: 0.42, value: [7, 20], weight: 3, size: 'small', rarity: 70, flags: { conductive: true } },
  { id: 'cook-pot', name: 'Canteen Stockpot', model: 'prop.survival/Pot', fit: 0.5, value: [12, 30], weight: 8, size: 'medium', rarity: 55, flags: { conductive: true } },
  { id: 'field-phone', name: 'Dead Handset', model: 'prop.survival/Phone', fit: 0.2, value: [15, 42], weight: 1, size: 'tiny', rarity: 60, flags: { noisy: 0.05 }, note: 'Rings sometimes. Nobody is calling.' },
  { id: 'site-radio', name: 'Site Radio', model: 'prop.survival/Radio', fit: 0.35, value: [26, 62], weight: 5, size: 'medium', rarity: 45, flags: { noisy: 0.12, conductive: true }, note: 'Still receives something.' },
  { id: 'flare-gun', name: 'Spent Flare Gun', model: 'prop.survival/FlareGun', fit: 0.3, value: [20, 46], weight: 3, size: 'small', rarity: 45 },
  { id: 'wood-log', name: 'Fungal Log', model: 'prop.survival/WoodLog', fit: 0.8, value: [6, 16], weight: 14, size: 'large', rarity: 35 },
  { id: 'trash-drum', name: 'Waste Drum', model: 'prop.survival/Trashcan', fit: 0.85, value: [14, 34], weight: 18, size: 'large', rarity: 40, flags: { conductive: true } },
  { id: 'bear-trap', name: 'Sprung Leg Trap', model: 'prop.survival/BearTrap_Closed', fit: 0.5, value: [22, 50], weight: 12, size: 'medium', rarity: 30, flags: { conductive: true } },
  { id: 'backpack', name: 'Previous Employee Pack', model: 'prop.survival/Backpack', fit: 0.5, value: [28, 66], weight: 6, size: 'medium', rarity: 34, note: 'Name tag scratched out.' },
  { id: 'battery-big', name: 'Industrial Cell', model: 'prop.survival/Battery_Big', fit: 0.4, value: [34, 78], weight: 15, size: 'medium', rarity: 40, flags: { conductive: true } },
  { id: 'battery-small', name: 'Spare Cell', model: 'prop.survival/Battery_Small', fit: 0.2, value: [11, 26], weight: 3, size: 'small', rarity: 70, flags: { conductive: true } },
  { id: 'axe-head', name: 'Blunted Axe', model: 'prop.survival/Axe', fit: 0.7, value: [16, 38], weight: 7, size: 'medium', rarity: 45, flags: { conductive: true } },
  { id: 'camp-torch', name: 'Pitch Torch', model: 'prop.survival/Torch', fit: 0.5, value: [9, 24], weight: 3, size: 'small', rarity: 45, flags: { light: { color: 0xffa347, intensity: 1.4, range: 9 } } },
  { id: 'tent-bundle', name: 'Collapsed Shelter', model: 'prop.survival/Tent', fit: 1.4, value: [30, 70], weight: 26, size: 'large', rarity: 20 },

  // ------------------------------------------------------ hero photogrammetry
  { id: 'television', name: 'Company-Issue Television', model: 'hero/Television_01', fit: 0.7, value: [55, 130], weight: 22, size: 'large', twoHanded: true, rarity: 30, flags: { conductive: true, fragile: 0.5, noisy: 0.03 }, note: 'Screen shows static regardless of power state.' },
  { id: 'laptop', name: 'Corroded Laptop', model: 'hero/classic_laptop', fit: 0.4, value: [48, 112], weight: 4, size: 'small', rarity: 34, flags: { fragile: 0.4, conductive: true } },
  { id: 'circuit-board', name: 'Salvage Board', model: 'hero/circuit_board', fit: 0.3, value: [38, 92], weight: 1, size: 'tiny', rarity: 42, flags: { fragile: 0.3, conductive: true } },
  { id: 'chem-set', name: 'Field Chemistry Set', model: 'hero/chemistry_set', fit: 0.5, value: [66, 155], weight: 9, size: 'medium', rarity: 20, flags: { fragile: 0.9 }, note: 'Three of the vials are still warm.' },
  { id: 'camera', name: 'Antique Camera', model: 'hero/Camera_01', fit: 0.3, value: [58, 138], weight: 4, size: 'small', rarity: 24, flags: { fragile: 0.5 } },
  { id: 'lantern', name: 'Hurricane Lantern', model: 'hero/Lantern_01', fit: 0.4, value: [32, 80], weight: 4, size: 'small', rarity: 40, flags: { light: { color: 0xffb257, intensity: 1.6, range: 11 }, fragile: 0.4 } },
  { id: 'megaphone', name: 'Site Megaphone', model: 'hero/Megaphone_01', fit: 0.4, value: [30, 74], weight: 3, size: 'small', rarity: 34, flags: { noisy: 0.16 }, note: 'Feedback squeal on a two-minute cycle. Nobody knows why.' },
  { id: 'ukulele', name: 'Ukulele', model: 'hero/Ukulele_01', fit: 0.6, value: [26, 68], weight: 2, size: 'medium', rarity: 26, flags: { noisy: 0.1, fragile: 0.6 }, note: 'Someone out here was having a nice time once.' },
  { id: 'alarm-clock', name: 'Alarm Clock', model: 'hero/alarm_clock_01', fit: 0.2, value: [24, 60], weight: 1, size: 'tiny', rarity: 44, flags: { noisy: 0.3 }, note: 'Set for 4:40. Still armed.' },
  { id: 'wrench-adj', name: 'Adjustable Wrench', model: 'hero/adjustable_wrench', fit: 0.35, value: [16, 40], weight: 4, size: 'small', rarity: 60, flags: { conductive: true } },
  { id: 'wrench-comb', name: 'Combination Wrench', model: 'hero/combination_wrench', fit: 0.3, value: [12, 32], weight: 3, size: 'small', rarity: 65, flags: { conductive: true } },
  { id: 'bolt-cutters', name: 'Bolt Cutters', model: 'hero/bolt_cutters_01', fit: 0.7, value: [34, 82], weight: 11, size: 'medium', rarity: 32, flags: { conductive: true } },
  { id: 'bench-vice', name: 'Bench Vice', model: 'hero/bench_vice_01', fit: 0.45, value: [46, 108], weight: 31, size: 'large', twoHanded: true, rarity: 24, flags: { conductive: true }, note: 'Bolted to nothing. Weighs like it is bolted to everything.' },
  { id: 'power-drill', name: 'Power Drill', model: 'hero/Drill_01', fit: 0.35, value: [30, 74], weight: 4, size: 'small', rarity: 46, flags: { conductive: true, noisy: 0.04 } },
  { id: 'football', name: 'Regulation Football', model: 'hero/american_football', fit: 0.3, value: [12, 34], weight: 1, size: 'small', rarity: 40, note: 'Morale equipment. Never used.' },
  { id: 'wet-floor', name: 'Wet Floor Sign', model: 'hero/WetFloorSign_01', fit: 0.65, value: [10, 28], weight: 3, size: 'medium', rarity: 46, note: 'The hazard it warns about is long gone. Others arrived.' },
  { id: 'cleaner', name: 'All-Purpose Cleaner', model: 'hero/all_purpose_cleaner', fit: 0.28, value: [9, 24], weight: 2, size: 'small', rarity: 60, flags: { explosive: 0.25 } },
  { id: 'cheese-box', name: 'Sealed Cheese Crate', model: 'hero/CheeseBox_01', fit: 0.4, value: [20, 52], weight: 6, size: 'medium', rarity: 34, note: 'Sell-by date is four digits.' },
  { id: 'cash-register', name: 'Canteen Register', model: 'hero/CashRegister_01', fit: 0.5, value: [64, 148], weight: 27, size: 'large', twoHanded: true, rarity: 20, flags: { conductive: true, noisy: 0.05 } },
  { id: 'coffee-cart', name: 'Coffee Cart', model: 'hero/CoffeeCart_01', fit: 1.2, value: [86, 190], weight: 44, size: 'huge', twoHanded: true, rarity: 9, flags: { conductive: true }, note: 'Wheels seized. Company still counts it as a vehicle.' },
  { id: 'ammo-box', name: 'Sealed Ammunition Case', model: 'hero/ammo_box', fit: 0.5, value: [52, 118], weight: 21, size: 'large', rarity: 22, flags: { conductive: true, explosive: 0.7 } },
  { id: 'barrel-explosive', name: 'Marked Barrel', model: 'hero/Barrel_01', fit: 0.9, value: [44, 104], weight: 33, size: 'large', twoHanded: true, rarity: 16, flags: { conductive: true, explosive: 1.4 }, note: 'The marking is a warning. The Company reads it as a price.' },
  { id: 'barrel-water', name: 'Plastic Drum', model: 'hero/Barrel_02', fit: 0.9, value: [26, 62], weight: 20, size: 'large', twoHanded: true, rarity: 26 },
  { id: 'barrel-blue', name: 'Blue Fuel Barrel', model: 'hero/barrel_03', fit: 0.9, value: [40, 96], weight: 30, size: 'large', twoHanded: true, rarity: 18, flags: { conductive: true, explosive: 0.9 } },
  { id: 'barrel-stove', name: 'Barrel Stove', model: 'hero/barrel_stove', fit: 0.9, value: [36, 90], weight: 28, size: 'large', twoHanded: true, rarity: 18, flags: { conductive: true } },
  { id: 'cardboard-box', name: 'Water-Damaged Box', model: 'hero/cardboard_box_01', fit: 0.55, value: [10, 30], weight: 4, size: 'medium', rarity: 55 },

  // --------------------------------------------------------- household absurd
  { id: 'toilet', name: 'Detached Toilet', model: 'prop.house/Bathroom_Toilet', fit: 0.8, value: [42, 96], weight: 38, size: 'huge', twoHanded: true, rarity: 14, note: 'Recovered from a facility with no plumbing.' },
  { id: 'washing-machine', name: 'Washing Machine', model: 'prop.house/Bathroom_WashingMachine', fit: 0.9, value: [70, 165], weight: 52, size: 'huge', twoHanded: true, rarity: 8, flags: { conductive: true }, note: 'Drum still turns. Nothing is powering it.' },
  { id: 'fridge', name: 'Canteen Refrigerator', model: 'prop.house/Kitchen_Fridge', fit: 1.6, value: [80, 178], weight: 55, size: 'huge', twoHanded: true, rarity: 7, flags: { conductive: true } },
  { id: 'oven', name: 'Industrial Oven', model: 'prop.house/Kitchen_Oven', fit: 1.0, value: [62, 142], weight: 46, size: 'huge', twoHanded: true, rarity: 10, flags: { conductive: true } },
  { id: 'bathtub', name: 'Cast Bathtub', model: 'prop.house/Bathroom_Bathtub', fit: 1.6, value: [58, 132], weight: 60, size: 'huge', twoHanded: true, rarity: 6, note: 'Full of something. It was drained before weighing.' },
  { id: 'mirror', name: 'Wall Mirror', model: 'prop.house/Bathroom_Mirror1', fit: 0.7, value: [30, 76], weight: 9, size: 'medium', rarity: 26, flags: { fragile: 1 }, note: 'Reflects the corridor behind you a half-second late.' },
  { id: 'toilet-paper', name: 'Institutional Paper Roll', model: 'prop.house/Bathroom_ToiletPaper', fit: 0.16, value: [3, 9], weight: 1, size: 'tiny', rarity: 90, note: 'The Company will pay for it. The Company pays for everything.' },
  { id: 'houseplant', name: 'Surviving Houseplant', model: 'prop.house/Houseplant_3', fit: 0.7, value: [22, 58], weight: 8, size: 'medium', rarity: 34, note: 'Alive. Watered recently.' },
  { id: 'desk-lamp', name: 'Desk Lamp', model: 'prop.house/Light_Desk', fit: 0.4, value: [16, 42], weight: 3, size: 'small', rarity: 50, flags: { conductive: true, light: { color: 0xffe0a0, intensity: 0.9, range: 7 } } },
  { id: 'chandelier', name: 'Executive Chandelier', model: 'prop.house/Light_Chandelier', fit: 0.9, value: [78, 174], weight: 24, size: 'large', twoHanded: true, rarity: 8, flags: { fragile: 0.8, conductive: true }, rooms: ['office', 'admin'] },
  { id: 'bookshelf', name: 'Records Shelf', model: 'prop.house/Bookshelf', fit: 1.4, value: [34, 82], weight: 40, size: 'huge', twoHanded: true, rarity: 12 },
  { id: 'trashcan-green', name: 'Green Bin', model: 'prop.house/Trashcan_Green', fit: 0.7, value: [12, 30], weight: 12, size: 'medium', rarity: 40 },
  { id: 'stool', name: 'Workshop Stool', model: 'prop.house/Stool', fit: 0.6, value: [14, 34], weight: 9, size: 'medium', rarity: 42 },
  { id: 'plate-stack', name: 'Canteen Plates', model: 'prop.house/Plate_2', fit: 0.25, value: [8, 22], weight: 3, size: 'small', rarity: 60, flags: { fragile: 0.9 } },
  { id: 'fork', name: 'Bent Fork', model: 'prop.house/Fork', fit: 0.18, value: [2, 7], weight: 1, size: 'tiny', rarity: 95, flags: { conductive: true }, note: 'Logged, valued, and filed. Cost more to process than it is worth.' },

  // ----------------------------------------------------------- amusing / weird
  { id: 'arcade-cab', name: 'Arcade Cabinet', model: 'prop.arcade/arcade-machine', fit: 1.8, value: [110, 240], weight: 62, size: 'huge', twoHanded: true, rarity: 5, flags: { conductive: true, noisy: 0.08 }, note: 'Attract mode still runs. There is no coin slot.' },
  { id: 'claw-machine', name: 'Claw Machine', model: 'prop.arcade/claw-machine', fit: 1.8, value: [124, 268], weight: 66, size: 'huge', twoHanded: true, rarity: 4, flags: { conductive: true, noisy: 0.1 } },
  { id: 'pinball', name: 'Pinball Table', model: 'prop.arcade/pinball', fit: 1.8, value: [118, 252], weight: 64, size: 'huge', twoHanded: true, rarity: 4, flags: { conductive: true, noisy: 0.09 } },
  { id: 'vending', name: 'Vending Machine', model: 'prop.arcade/vending-machine', fit: 1.8, value: [96, 214], weight: 58, size: 'huge', twoHanded: true, rarity: 6, flags: { conductive: true } },
  { id: 'gambling-machine', name: 'Payout Terminal', model: 'prop.arcade/gambling-machine', fit: 1.6, value: [104, 232], weight: 54, size: 'huge', twoHanded: true, rarity: 5, flags: { conductive: true, noisy: 0.14 }, note: 'Pays out on a schedule the Company will not disclose.' },
  { id: 'shopping-cart', name: 'Shopping Trolley', model: 'prop.market/shopping-cart', fit: 1.0, value: [24, 60], weight: 16, size: 'large', twoHanded: true, rarity: 16, flags: { conductive: true, noisy: 0.06 } },
  { id: 'freezer-unit', name: 'Chest Freezer', model: 'prop.market/freezer', fit: 1.4, value: [72, 160], weight: 50, size: 'huge', twoHanded: true, rarity: 8, flags: { conductive: true } },
  { id: 'cake', name: 'Preserved Cake', model: 'prop.food/cake', fit: 0.35, value: [18, 48], weight: 3, size: 'small', rarity: 22, flags: { fragile: 0.7 }, note: 'Iced with a name. The name is yours.' },
  { id: 'donut', name: 'Vacuum-Sealed Donut', model: 'prop.food/donut-sprinkles', fit: 0.18, value: [6, 18], weight: 1, size: 'tiny', rarity: 46 },
  { id: 'burger', name: 'Ration Burger', model: 'prop.food/burger-cheese', fit: 0.2, value: [5, 15], weight: 1, size: 'tiny', rarity: 46 },
  { id: 'watermelon', name: 'Hydroponic Melon', model: 'prop.food/watermelon', fit: 0.4, value: [16, 40], weight: 9, size: 'medium', rarity: 26, flags: { fragile: 0.8 } },
  { id: 'wine-bottle', name: 'Executive Wine', model: 'prop.food/wine-red', fit: 0.35, value: [40, 96], weight: 3, size: 'small', rarity: 20, flags: { fragile: 1 }, rooms: ['office', 'admin'] },
  { id: 'cooking-pot-big', name: 'Canteen Cauldron', model: 'prop.food/pot', fit: 0.6, value: [26, 62], weight: 18, size: 'large', rarity: 20, flags: { conductive: true } },

  // ------------------------------------------------------- valuables & anomaly
  { id: 'gold-ingots', name: 'Refined Ingots', model: 'prop.rpg/Gold_Ingots', fit: 0.35, value: [120, 280], weight: 34, size: 'medium', twoHanded: true, rarity: 5, flags: { conductive: true }, note: 'Assay stamp is not from any registry the Company recognises.' },
  { id: 'chalice', name: 'Ceremonial Chalice', model: 'prop.rpg/Chalice', fit: 0.28, value: [74, 168], weight: 5, size: 'small', rarity: 10, flags: { conductive: true, anomalous: true } },
  { id: 'crown', name: 'Recovered Crown', model: 'prop.rpg/Crown', fit: 0.28, value: [98, 220], weight: 4, size: 'small', rarity: 6, flags: { conductive: true, anomalous: true } },
  { id: 'crystal-large', name: 'Resonant Crystal', model: 'prop.rpg/Crystal2', fit: 0.5, value: [88, 200], weight: 16, size: 'medium', rarity: 9, flags: { anomalous: true, light: { color: 0x7fd8ff, intensity: 1.1, range: 8 }, noisy: 0.05 }, note: 'Hums at the frequency of a held breath.' },
  { id: 'crystal-small', name: 'Crystal Shard', model: 'prop.rpg/Crystal4', fit: 0.2, value: [34, 82], weight: 3, size: 'tiny', rarity: 24, flags: { anomalous: true, light: { color: 0x7fd8ff, intensity: 0.5, range: 5 } } },
  { id: 'mineral', name: 'Ore Sample', model: 'prop.rpg/Mineral', fit: 0.28, value: [26, 70], weight: 12, size: 'small', rarity: 40 },
  { id: 'skull', name: 'Unclassified Skull', model: 'prop.rpg/Skull', fit: 0.25, value: [46, 108], weight: 3, size: 'small', rarity: 16, flags: { anomalous: true }, note: 'Dentition does not match any employee on file.' },
  { id: 'bone', name: 'Long Bone', model: 'prop.rpg/Bone', fit: 0.4, value: [14, 36], weight: 2, size: 'small', rarity: 44 },
  { id: 'ledger', name: 'Field Ledger', model: 'prop.rpg/Book2_Closed', fit: 0.3, value: [30, 72], weight: 3, size: 'small', rarity: 30, rooms: ['office', 'admin'], note: 'Last entry is a tally of names, not figures.' },
  { id: 'keyring', name: 'Facility Keyring', model: 'prop.rpg/Key2', fit: 0.16, value: [16, 44], weight: 1, size: 'tiny', rarity: 50, flags: { conductive: true, noisy: 0.04 } },
  { id: 'padlock', name: 'Seized Padlock', model: 'prop.rpg/Padlock', fit: 0.16, value: [10, 26], weight: 2, size: 'tiny', rarity: 60, flags: { conductive: true } },
  { id: 'necklace', name: 'Personal Effects', model: 'prop.rpg/Necklace2', fit: 0.16, value: [36, 88], weight: 1, size: 'tiny', rarity: 22, flags: { anomalous: true }, note: 'Marked RETURN TO NEXT OF KIN. No forwarding address.' },
  { id: 'chest-ingots', name: 'Payroll Chest', model: 'prop.rpg/Chest_Ingots', fit: 0.7, value: [180, 400], weight: 58, size: 'huge', twoHanded: true, rarity: 2, flags: { conductive: true }, note: 'Three quarters of a quota, if you can carry it out.' },

  // ------------------------------------------------------------- company issue
  { id: 'company-gear', name: 'Company Gearbox', model: 'prop.cyber/Collectible_Gear', fit: 0.35, value: [42, 100], weight: 14, size: 'medium', rarity: 34, flags: { conductive: true } },
  { id: 'company-board', name: 'Company Data Board', model: 'prop.cyber/Collectible_Board', fit: 0.3, value: [50, 120], weight: 3, size: 'small', rarity: 26, flags: { fragile: 0.4, conductive: true } },
  { id: 'lootbox', name: 'Unopened Requisition', model: 'prop.cyber/Lootbox', fit: 0.5, value: [58, 138], weight: 17, size: 'medium', rarity: 20, note: 'Sealed. Requisition number belongs to a crew that never filed a return.' },
  { id: 'crt-monitor', name: 'Facility Monitor', model: 'prop.cyber/TV_2', fit: 0.6, value: [36, 88], weight: 16, size: 'medium', twoHanded: true, rarity: 26, flags: { conductive: true, fragile: 0.6 } },
  { id: 'terminal-unit', name: 'Terminal Unit', model: 'prop.cyber/Computer', fit: 0.7, value: [64, 148], weight: 26, size: 'large', twoHanded: true, rarity: 16, flags: { conductive: true } },
  { id: 'ac-unit', name: 'Air Handler', model: 'prop.cyber/AC', fit: 0.9, value: [48, 112], weight: 34, size: 'large', twoHanded: true, rarity: 16, flags: { conductive: true, noisy: 0.05 } },
  { id: 'coolant-tank', name: 'Coolant Tank', model: 'prop.cyber/Tank', fit: 1.0, value: [70, 160], weight: 42, size: 'huge', twoHanded: true, rarity: 10, flags: { conductive: true, explosive: 0.8 } },
  { id: 'hazard-sign', name: 'Hazard Placard', model: 'prop.cyber/Sign_Corner_Hazard', fit: 0.6, value: [12, 32], weight: 5, size: 'medium', rarity: 44, flags: { conductive: true } },
];

export const SCRAP_BY_ID = new Map(SCRAP.map((s) => [s.id, s]));

export function scrapById(id: string): ScrapDef {
  const found = SCRAP_BY_ID.get(id);
  if (!found) throw new Error(`unknown scrap id: ${id}`);
  return found;
}

/** Loose bounds used by the terminal's "scrap intel" readout. */
export const SCRAP_VALUE_BOUNDS = SCRAP.reduce(
  (acc, s) => ({ min: Math.min(acc.min, s.value[0]), max: Math.max(acc.max, s.value[1]) }),
  { min: Infinity, max: 0 },
);
