import { RNG } from '@shared/rng.ts';
import { QUOTA, SELL_RATE, quotaForCycle } from '@shared/constants.ts';
import { clamp } from '@shared/math.ts';
import { EQUIPMENT_BY_ID, UPGRADES_BY_ID, type UpgradeId } from '@shared/content/equipment.ts';
import { MOONS_BY_ID } from '@shared/content/moons.ts';

export interface RunState {
  credits: number;
  /** Which quota cycle we are on, zero-based. */
  quotaIndex: number;
  quota: number;
  /** Credits already banked toward the current quota. */
  quotaMet: number;
  daysLeft: number;
  /** Total expeditions flown this run. */
  day: number;
  sellRate: number;
  upgrades: UpgradeId[];
  /** Equipment ids stored aboard the ship, with charge levels. */
  lockers: { defId: string; charge: number }[];
  /** Creature ids the crew has seen / been killed by, for the bestiary. */
  seen: string[];
  killedBy: string[];
  /** Names of employees lost, in order. Purely for the terminal to be grim. */
  casualties: string[];
  finished: boolean;
  /** Reason the run ended. */
  epitaph: string;
}

export function newRun(seed = Date.now()): RunState {
  const rng = new RNG(seed >>> 0);
  return {
    credits: QUOTA.startingCredits,
    quotaIndex: 0,
    quota: quotaForCycle(0),
    quotaMet: 0,
    daysLeft: QUOTA.daysPerQuota,
    day: 1,
    sellRate: SELL_RATE.start,
    upgrades: [],
    lockers: [
      { defId: 'torch', charge: 1 },
      { defId: 'torch', charge: 1 },
      { defId: 'walkie', charge: 1 },
      { defId: 'shovel', charge: 1 },
    ],
    seen: [],
    killedBy: [],
    casualties: [],
    finished: false,
    epitaph: '',
  };
}

/** The Company's buy rate wanders, and it wanders against you more than for you. */
export function driftSellRate(run: RunState, seed: number): void {
  const rng = new RNG(seed >>> 0);
  const bias = -0.02; // the house edge
  const delta = rng.range(-SELL_RATE.drift, SELL_RATE.drift) + bias;
  run.sellRate = clamp(run.sellRate + delta, SELL_RATE.min, SELL_RATE.max);
}

export interface SaleLine {
  name: string;
  value: number;
  paid: number;
}

export interface SaleResult {
  lines: SaleLine[];
  gross: number;
  rate: number;
  deathPenalty: number;
  net: number;
  quotaBefore: number;
  quotaAfter: number;
}

export function sellCargo(
  run: RunState,
  cargo: { name: string; value: number; anomalous?: boolean }[],
  deaths: number,
  bodiesRecovered: number,
): SaleResult {
  const hasTank = run.upgrades.includes('sample-tank');
  const lines: SaleLine[] = [];
  let gross = 0;
  for (const item of cargo) {
    const bonus = hasTank && item.anomalous ? 1.4 : 1;
    const paid = Math.round(item.value * run.sellRate * bonus);
    lines.push({ name: item.name, value: item.value, paid });
    gross += paid;
  }

  const lostOutright = Math.max(0, deaths - bodiesRecovered);
  const penaltyRate =
    lostOutright * QUOTA.deathPenaltyPercent + bodiesRecovered * QUOTA.bodyRecoveredPenaltyPercent;
  const deathPenalty = Math.round(gross * Math.min(0.85, penaltyRate));
  const net = Math.max(0, gross - deathPenalty);

  const quotaBefore = run.quotaMet;
  run.quotaMet += net;
  run.credits += net;
  return { lines, gross, rate: run.sellRate, deathPenalty, net, quotaBefore, quotaAfter: run.quotaMet };
}

export interface DeadlineResult {
  met: boolean;
  bonus: number;
  newQuota: number;
  message: string[];
}

/** Called when the deadline expires. This is where runs end. */
export function resolveDeadline(run: RunState): DeadlineResult {
  if (run.quotaMet < run.quota) {
    run.finished = true;
    run.epitaph = `Contract terminated at quota ${run.quotaIndex + 1}. Shortfall of ${run.quota - run.quotaMet} credits.`;
    return {
      met: false,
      bonus: 0,
      newQuota: run.quota,
      message: [
        'PROFIT QUOTA NOT MET.',
        `SHORTFALL: ${run.quota - run.quotaMet} CREDITS.`,
        'YOUR CONTRACT IS TERMINATED.',
        'THE COMPANY THANKS YOU FOR YOUR SERVICE.',
      ],
    };
  }

  const surplus = run.quotaMet - run.quota;
  const bonus = Math.round(
    surplus * QUOTA.overtimeBonusPerCredit + Math.max(0, run.daysLeft) * QUOTA.overtimeBonusPerDay,
  );
  run.credits += bonus;
  run.quotaIndex++;
  run.quota = quotaForCycle(run.quotaIndex);
  run.quotaMet = 0;
  run.daysLeft = QUOTA.daysPerQuota;

  return {
    met: true,
    bonus,
    newQuota: run.quota,
    message: [
      'PROFIT QUOTA MET.',
      `OVERTIME BONUS: ${bonus} CREDITS.`,
      `NEW QUOTA: ${run.quota} CREDITS.`,
      `DEADLINE: ${QUOTA.daysPerQuota} DAYS.`,
    ],
  };
}

export function routeCost(moonId: string): number {
  return MOONS_BY_ID.get(moonId)?.cost ?? 0;
}

export function buyEquipment(run: RunState, defId: string, qty: number): { ok: boolean; message: string } {
  const def = EQUIPMENT_BY_ID.get(defId);
  if (!def) return { ok: false, message: `NO SUCH ITEM: ${defId.toUpperCase()}` };
  const total = def.price * qty;
  if (total > run.credits) return { ok: false, message: `INSUFFICIENT CREDITS. NEED ${total}, HAVE ${run.credits}.` };
  run.credits -= total;
  for (let i = 0; i < qty; i++) run.lockers.push({ defId, charge: 1 });
  return { ok: true, message: `ORDER CONFIRMED: ${qty}x ${def.name.toUpperCase()} - ${total} CREDITS.` };
}

export function buyUpgrade(run: RunState, id: string): { ok: boolean; message: string } {
  const def = UPGRADES_BY_ID.get(id as UpgradeId);
  if (!def) return { ok: false, message: `NO SUCH UPGRADE: ${id.toUpperCase()}` };
  if (run.upgrades.includes(def.id)) return { ok: false, message: 'ALREADY INSTALLED.' };
  if (def.price > run.credits) return { ok: false, message: `INSUFFICIENT CREDITS. NEED ${def.price}, HAVE ${run.credits}.` };
  run.credits -= def.price;
  run.upgrades.push(def.id);
  return { ok: true, message: `INSTALLED: ${def.name.toUpperCase()}.` };
}

/** Between drops, equipment left in the ship tops itself up. */
export function rechargeLockers(run: RunState, seconds: number): void {
  const multiplier = run.upgrades.includes('charging-rack') ? 2 : 1;
  for (const locker of run.lockers) {
    const def = EQUIPMENT_BY_ID.get(locker.defId);
    if (!def || def.battery <= 0) {
      locker.charge = 1;
      continue;
    }
    locker.charge = clamp(locker.charge + (def.rechargeRate * multiplier * seconds) / def.battery, 0, 1);
  }
}
