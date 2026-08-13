import { hashInts } from '@shared/rng.ts';
import { clockString, quotaForCycle } from '@shared/constants.ts';
import { MOONS, COMPANY } from '@shared/content/moons.ts';
import { WEATHER, type WeatherId } from '@shared/content/weather.ts';
import { EQUIPMENT, UPGRADES } from '@shared/content/equipment.ts';
import { MONSTERS, MONSTERS_BY_ID } from '@shared/content/monsters.ts';
import type { RunState } from './economy.ts';

/** What the terminal needs from the game room in order to do anything. */
export interface TerminalHost {
  run: RunState;
  phase: string;
  moonId: string | null;
  weather: WeatherId | null;
  forecast: Record<string, WeatherId>;
  dayProgress: number;
  seed: number;
  crew(): { name: string; state: string; health: number; level: number }[];
  cargoManifest(): { name: string; value: number }[];
  scrapRemaining(): { count: number; value: number } | null;
  poweredDoors(): { id: number; code: string; open: boolean }[];
  route(moonId: string): { ok: boolean; message: string };
  launch(): { ok: boolean; message: string };
  land(): { ok: boolean; message: string };
  sell(): string[];
  toggleDoorByCode(code: string): { ok: boolean; message: string };
  setShipDoors(open: boolean): string;
  horn(): string;
  teleport(name: string, inverse: boolean): { ok: boolean; message: string };
}

const RULE = '------------------------------------------------------------';

export function doorCode(seed: number, doorId: number): string {
  const h = hashInts(seed, doorId * 2654435761);
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '0123456789';
  return (
    letters[h % letters.length] +
    letters[(h >>> 5) % letters.length] +
    digits[(h >>> 11) % 10] +
    digits[(h >>> 17) % 10]
  );
}

export function runTerminal(host: TerminalHost, raw: string): string[] {
  const line = raw.trim();
  if (!line) return [];
  const parts = line.split(/\s+/);
  const cmd = parts[0].toUpperCase();
  const arg = parts.slice(1).join(' ').trim();
  const argUpper = arg.toUpperCase();

  switch (cmd) {
    case 'HELP':
    case '?':
      return help();

    case 'MOONS':
    case 'ROUTES':
      return moonList(host);

    case 'MOON':
    case 'INFO':
      return moonInfo(host, argUpper);

    case 'ROUTE':
    case 'GO': {
      if (argUpper.startsWith('COMPANY') || argUpper.startsWith('DEPOT') || argUpper.includes('GORDION')) {
        return [host.route('company').message];
      }
      const moon = findMoon(argUpper);
      if (!moon) return [`NO ROUTE MATCHING "${argUpper}".`, 'TYPE MOONS FOR THE CATALOGUE.'];
      const res = host.route(moon.id);
      return [res.message];
    }

    case 'COMPANY':
    case 'DEPOT':
      return [host.route('company').message];

    case 'LAND':
      return [host.land().message];

    case 'LAUNCH':
    case 'DEPART':
      return [host.launch().message];

    case 'SELL':
      return host.sell();

    case 'STORE':
    case 'SHOP':
      return storeList(host);

    case 'BUY':
    case 'ORDER':
      return buy(host, arg);

    case 'UPGRADES':
      return upgradeList(host);

    case 'INSTALL':
      return install(host, argUpper);

    case 'QUOTA':
    case 'STATUS':
      return status(host);

    case 'CREW':
      return crew(host);

    case 'CARGO':
    case 'MANIFEST':
      return manifest(host);

    case 'SCAN':
      return scan(host);

    case 'DOORS':
      return doors(host);

    case 'HATCH':
      if (argUpper === 'OPEN') return [host.setShipDoors(true)];
      if (argUpper === 'CLOSE') return [host.setShipDoors(false)];
      return ['USAGE: HATCH OPEN | HATCH CLOSE'];

    case 'HORN':
      return [host.horn()];

    case 'TP':
    case 'BEAM':
      return [host.teleport(arg, false).message];

    case 'INVERT':
      return [host.teleport(arg, true).message];

    case 'BESTIARY':
    case 'FAUNA':
      return bestiary(host);

    case 'FILE':
      return creatureFile(host, argUpper);

    case 'CLEAR':
      return [''];

    case 'ABOUT':
    case 'COMPANY-INFO':
      return about();

    default: {
      // Any four-character code is treated as a door code. This is how the ship
      // operator earns their keep.
      if (/^[A-Z]{2}\d{2}$/.test(cmd)) {
        const res = host.toggleDoorByCode(cmd);
        return [res.message];
      }
      const moon = findMoon(cmd);
      if (moon) return moonInfo(host, cmd);
      return [`UNRECOGNISED: ${cmd}`, 'TYPE HELP.'];
    }
  }
}

function findMoon(query: string) {
  const q = query.replace(/[^A-Z0-9]/g, '');
  if (!q) return null;
  return (
    MOONS.find((m) => m.id.toUpperCase() === q) ??
    MOONS.find((m) => m.name.toUpperCase() === q) ??
    MOONS.find((m) => m.code.replace(/[^A-Z0-9]/g, '') === q) ??
    MOONS.find((m) => m.name.toUpperCase().startsWith(q)) ??
    null
  );
}

function help(): string[] {
  return [
    RULE,
    'VANTOREX RECLAMATION GROUP - CONTRACTED SALVAGE DIVISION',
    'SHIPBOARD TERMINAL, REVISION 11',
    RULE,
    'NAVIGATION   MOONS  MOON <name>  ROUTE <name>  COMPANY',
    '             LAND   LAUNCH',
    'COMMERCE     STORE  BUY <item> [qty]  UPGRADES  INSTALL <id>',
    '             SELL   QUOTA  CARGO',
    'OPERATIONS   CREW   SCAN  DOORS  <CODE>  HATCH OPEN|CLOSE',
    '             HORN   TP <name>  INVERT <name>',
    'RECORDS      BESTIARY  FILE <name>  ABOUT  CLEAR',
    RULE,
  ];
}

function moonList(host: TerminalHost): string[] {
  const out = [RULE, 'CATALOGUE OF CONTRACTED SITES', RULE, 'CODE        NAME       COST  RISK  CONDITIONS'];
  for (const moon of MOONS) {
    const weather = host.forecast[moon.id] ?? 'clear';
    const w = WEATHER[weather];
    const risk = '*'.repeat(moon.hazard) + '.'.repeat(5 - moon.hazard);
    const cost = moon.cost === 0 ? 'FREE' : String(moon.cost);
    out.push(
      `${moon.code.padEnd(11)} ${moon.name.padEnd(10)} ${cost.padStart(4)}  ${risk}  ${w.name}${w.severity === 2 ? '  !!' : ''}`,
    );
  }
  out.push(`${COMPANY.code.padEnd(11)} ${COMPANY.name.padEnd(10)} FREE  .....  SALE POINT`);
  out.push(RULE);
  out.push(`CREDITS: ${host.run.credits}    QUOTA: ${host.run.quotaMet}/${host.run.quota}    DAYS LEFT: ${host.run.daysLeft}`);
  return out;
}

function moonInfo(host: TerminalHost, query: string): string[] {
  const moon = findMoon(query);
  if (!moon) return [`NO SITE MATCHING "${query}".`];
  const weather = host.forecast[moon.id] ?? 'clear';
  const w = WEATHER[weather];
  const out = [
    RULE,
    `${moon.code} - ${moon.name.toUpperCase()}`,
    RULE,
    moon.brief,
    '',
    `ROUTE COST......${moon.cost === 0 ? 'NO CHARGE' : `${moon.cost} CREDITS`}`,
    `RISK BAND.......${moon.hazard}/5`,
    `CONDITIONS......${w.name.toUpperCase()}`,
    `                ${w.description}`,
    `YIELD BAND......x${moon.scrap.valueMultiplier.toFixed(2)}`,
    '',
  ];
  for (const l of moon.dossier) out.push(`  ${l}`);
  out.push(RULE);
  return out;
}

function status(host: TerminalHost): string[] {
  const run = host.run;
  const next = quotaForCycle(run.quotaIndex + 1);
  return [
    RULE,
    'EMPLOYMENT STATUS',
    RULE,
    `PROFIT QUOTA........${run.quota} CREDITS`,
    `DELIVERED...........${run.quotaMet} CREDITS`,
    `OUTSTANDING.........${Math.max(0, run.quota - run.quotaMet)} CREDITS`,
    `DAYS REMAINING......${run.daysLeft}`,
    `CREDIT BALANCE......${run.credits}`,
    `BUY RATE............${Math.round(run.sellRate * 100)}%`,
    `EXPEDITION...........#${run.day}`,
    `NEXT QUOTA..........${next} CREDITS (PROJECTED)`,
    run.casualties.length ? `CASUALTIES..........${run.casualties.length} (${run.casualties.slice(-3).join(', ')})` : 'CASUALTIES..........NONE ON RECORD',
    RULE,
  ];
}

function crew(host: TerminalHost): string[] {
  const out = [RULE, 'CREW REGISTER', RULE];
  for (const c of host.crew()) {
    const where = c.state !== 'alive' ? 'NO SIGNAL' : c.level >= 0 ? `SUBLEVEL ${c.level}` : 'SURFACE';
    out.push(`${c.name.padEnd(14)} ${c.state.toUpperCase().padEnd(11)} VITALS ${String(Math.round(c.health)).padStart(3)}%  ${where}`);
  }
  if (host.moonId) out.push('', `SITE TIME: ${clockString(host.dayProgress)}`);
  out.push(RULE);
  return out;
}

function manifest(host: TerminalHost): string[] {
  const cargo = host.cargoManifest();
  if (!cargo.length) return ['CARGO HOLD EMPTY.'];
  const out = [RULE, 'CARGO MANIFEST', RULE];
  let total = 0;
  for (const item of cargo) {
    out.push(`${item.name.padEnd(34)} ${String(item.value).padStart(6)}`);
    total += item.value;
  }
  out.push(RULE);
  out.push(`${'APPRAISED TOTAL'.padEnd(34)} ${String(total).padStart(6)}`);
  out.push(`${'AT CURRENT BUY RATE'.padEnd(34)} ${String(Math.round(total * host.run.sellRate)).padStart(6)}`);
  return out;
}

function scan(host: TerminalHost): string[] {
  const res = host.scrapRemaining();
  if (!res) return ['NO ACTIVE SITE. SCAN UNAVAILABLE.'];
  return [
    `SITE SWEEP COMPLETE.`,
    `${res.count} UNRECOVERED OBJECTS DETECTED.`,
    `APPRAISED AT ${res.value} CREDITS.`,
    res.count > 0 ? 'THE COMPANY ENCOURAGES A THOROUGH RECOVERY.' : 'SITE EXHAUSTED. RETURN TO ORBIT.',
  ];
}

function doors(host: TerminalHost): string[] {
  const list = host.poweredDoors();
  if (!list.length) return ['NO REMOTELY OPERABLE DOORS ON THIS SITE.'];
  const out = [RULE, 'REMOTE DOOR CONTROL', 'ENTER A CODE TO TOGGLE.', RULE];
  for (const door of list) out.push(`  ${door.code}   ${door.open ? 'OPEN' : 'SHUT'}`);
  out.push(RULE);
  return out;
}

function storeList(host: TerminalHost): string[] {
  const out = [RULE, 'EQUIPMENT REQUISITION', RULE, 'ITEM              PRICE  NOTES'];
  for (const e of EQUIPMENT) {
    out.push(`${e.name.padEnd(17)} ${String(e.price).padStart(5)}  ${e.description}`);
  }
  out.push(RULE);
  out.push(`CREDIT BALANCE: ${host.run.credits}`);
  out.push('BUY <ITEM> [QTY]');
  return out;
}

function buy(host: TerminalHost, arg: string): string[] {
  const parts = arg.trim().split(/\s+/);
  let qty = 1;
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^\d+$/.test(last)) {
    qty = Math.max(1, Math.min(8, parseInt(last, 10)));
    parts.pop();
  }
  const name = parts.join(' ').toUpperCase();
  if (!name) return ['USAGE: BUY <ITEM> [QTY]'];
  const def =
    EQUIPMENT.find((e) => e.id.toUpperCase() === name) ??
    EQUIPMENT.find((e) => e.name.toUpperCase() === name) ??
    EQUIPMENT.find((e) => e.name.toUpperCase().startsWith(name)) ??
    EQUIPMENT.find((e) => e.name.toUpperCase().includes(name));
  if (!def) return [`NO CATALOGUE ENTRY FOR "${name}".`];

  const total = def.price * qty;
  if (total > host.run.credits) {
    return [`ORDER DECLINED. ${def.name.toUpperCase()} x${qty} = ${total} CREDITS.`, `BALANCE: ${host.run.credits}.`];
  }
  host.run.credits -= total;
  for (let i = 0; i < qty; i++) host.run.lockers.push({ defId: def.id, charge: 1 });
  return [
    `ORDER CONFIRMED: ${qty}x ${def.name.toUpperCase()}`,
    `DEBITED ${total} CREDITS. BALANCE ${host.run.credits}.`,
    `"${def.blurb}"`,
    'DELIVERED TO SHIP LOCKER.',
  ];
}

function upgradeList(host: TerminalHost): string[] {
  const out = [RULE, 'SHIP MODIFICATIONS', RULE];
  for (const u of UPGRADES) {
    const owned = host.run.upgrades.includes(u.id) ? ' [INSTALLED]' : '';
    out.push(`${u.id.padEnd(20)} ${String(u.price).padStart(5)}${owned}`);
    out.push(`  ${u.description}`);
  }
  out.push(RULE);
  out.push('INSTALL <ID>');
  return out;
}

function install(host: TerminalHost, arg: string): string[] {
  const id = arg.toLowerCase().replace(/\s+/g, '-');
  const def = UPGRADES.find((u) => u.id === id) ?? UPGRADES.find((u) => u.name.toUpperCase() === arg);
  if (!def) return [`NO MODIFICATION MATCHING "${arg}".`];
  if (host.run.upgrades.includes(def.id)) return ['ALREADY INSTALLED.'];
  if (def.price > host.run.credits) return [`INSUFFICIENT CREDITS. NEED ${def.price}, HAVE ${host.run.credits}.`];
  host.run.credits -= def.price;
  host.run.upgrades.push(def.id);
  return [`INSTALLED: ${def.name.toUpperCase()}.`, `"${def.blurb}"`, `BALANCE ${host.run.credits}.`];
}

function bestiary(host: TerminalHost): string[] {
  const out = [RULE, 'FAUNA RECORD', 'ENTRIES POPULATE ON FIRST CONTACT.', RULE];
  for (const m of MONSTERS) {
    const seen = host.run.seen.includes(m.id);
    if (!seen) {
      out.push(`${m.codename.padEnd(22)} [NO DATA]`);
      continue;
    }
    const fatal = host.run.killedBy.includes(m.id) ? ' *' : '';
    out.push(`${m.codename.padEnd(22)} ${m.name.toUpperCase()}${fatal}`);
  }
  out.push(RULE, 'FILE <NAME> FOR DETAIL.  * INDICATES A CONFIRMED FATALITY.');
  return out;
}

function creatureFile(host: TerminalHost, arg: string): string[] {
  const q = arg.replace(/[^A-Z0-9]/g, '');
  const def =
    MONSTERS.find((m) => m.id.toUpperCase() === q) ??
    MONSTERS.find((m) => m.name.toUpperCase() === q) ??
    MONSTERS.find((m) => m.codename.replace(/[^A-Z0-9]/g, '') === q) ??
    MONSTERS.find((m) => m.name.toUpperCase().startsWith(q));
  if (!def) return [`NO FILE MATCHING "${arg}".`];
  if (!host.run.seen.includes(def.id)) {
    return [`${def.codename}`, 'FILE SEALED PENDING FIRST-CONTACT DATA.'];
  }
  const out = [RULE, `${def.codename} - ${def.name.toUpperCase()}`, RULE, def.lore, ''];
  if (host.run.killedBy.includes(def.id)) {
    out.push('FIELD NOTE (APPENDED AFTER FATALITY):');
    out.push(`  ${def.hint}`);
  } else {
    out.push('FIELD NOTE: PENDING.');
  }
  out.push(RULE);
  return out;
}

function about(): string[] {
  return [
    RULE,
    'VANTOREX RECLAMATION GROUP',
    RULE,
    'The Group holds recovery rights on four hundred and eleven',
    'decommissioned sites. Contracted crews are compensated by',
    'appraised weight of recovered material, less handling.',
    '',
    'Crew retention is not a performance metric.',
    'Quota attainment is the only performance metric.',
    '',
    'This terminal is Company property. Its logs are Company',
    'property. Everything you recover is Company property.',
    'You are contracted labour.',
    RULE,
  ];
}
