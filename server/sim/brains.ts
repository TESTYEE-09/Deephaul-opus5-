import { TILE } from '@shared/constants.ts';
import { angleDelta, clamp, dist2D, dist3D, moveTowardsAngle } from '@shared/math.ts';
import { scrapById } from '@shared/content/scrap.ts';
import { FLAG_CROUCH, FLAG_LIGHT } from '@shared/protocol.ts';
import { INTERIOR_ORIGIN_X, type World } from './world.ts';
import { MODE, type Monster, type ServerPlayer } from './types.ts';

type Damage = (p: ServerPlayer, amount: number, cause: string) => void;

/**
 * Every creature runs through here once per tick. The shared code below covers
 * locomotion, perception plumbing and the attack swing; the per-brain functions
 * only decide *what to want*, which is where the personality lives.
 */
export function runBrain(world: World, m: Monster, players: ServerPlayer[], dt: number, damage: Damage): void {
  if (m.mode === MODE.dead) return;

  if (m.mode === MODE.stunned) {
    if (world.time >= m.stunUntil) m.mode = MODE.idle;
    else {
      m.anim = 0;
      return;
    }
  }

  // Resolve a pending attack windup regardless of what the brain decides next:
  // once a creature commits, the player's window to escape is the windup time.
  if (m.windupUntil > 0 && world.time >= m.windupUntil) {
    const victim = players.find((p) => p.id === m.windupTarget);
    m.windupUntil = 0;
    m.windupTarget = -1;
    if (victim && victim.state === 'alive' && dist3D(m, victim) <= m.def.attackRange * 1.35) {
      const dmg = m.def.flags?.instantKill ? 1000 : m.def.damage;
      damage(victim, dmg, m.def.id);
      world.events.push({ t: 'event', e: 'sound', kind: 'monsterHit', defId: m.defId, x: m.x, y: m.y, z: m.z, level: m.level });
    }
  }

  if (m.def.voice.idleInterval > 0 && world.time >= m.nextVoiceAt) {
    m.nextVoiceAt = world.time + m.def.voice.idleInterval * (0.6 + Math.random() * 0.9);
    world.events.push({
      t: 'event',
      e: 'sound',
      kind: 'creatureVoice',
      defId: m.defId,
      id: m.id,
      x: m.x,
      y: m.y,
      z: m.z,
      level: m.level,
      mode: m.mode,
    });
    // A creature calling out is itself a noise event: things hunt each other.
    world.emitNoise(m.x, m.y, m.z, m.level, 1.2, -1);
  }

  const alive = players.filter((p) => p.state === 'alive');
  switch (m.def.brain) {
    case 'pack': brainPack(world, m, alive, dt); break;
    case 'ambush': brainAmbush(world, m, alive, dt); break;
    case 'territorial': brainTerritorial(world, m, alive, dt); break;
    case 'thief': brainThief(world, m, alive, dt); break;
    case 'soundhunter': brainSoundHunter(world, m, alive, dt); break;
    case 'mimic': brainMimic(world, m, alive, dt); break;
    case 'psych': brainPsych(world, m, alive, dt); break;
    case 'motion': brainMotion(world, m, alive, dt); break;
    case 'stalker': brainStalker(world, m, alive, dt); break;
    case 'giant': brainGiant(world, m, alive, dt); break;
    case 'decoy': brainDecoy(world, m, alive, dt); break;
    case 'snare': brainSnare(world, m, alive, dt, damage); break;
    case 'skittish': brainSkittish(world, m, alive, dt); break;
    case 'apex': brainApex(world, m, alive, dt); break;
    case 'lure': brainLure(world, m, alive, dt); break;
    case 'seismic': brainSeismic(world, m, alive, dt); break;
  }

  m.y = world.groundAt(m.x, m.z, m.level) + (m.def.flags?.flying ? 1.8 + Math.sin(world.time * 1.7 + m.id) * 0.35 : 0);
}

// ------------------------------------------------------------------ movement

function faceTo(m: Monster, x: number, z: number, dt: number, rate = 6): void {
  const want = Math.atan2(x - m.x, z - m.z);
  m.yaw = moveTowardsAngle(m.yaw, want, rate * dt);
}

/** Straight-line movement, used outdoors and for the last metre indoors. */
function stepToward(world: World, m: Monster, x: number, z: number, speed: number, dt: number): void {
  const dx = x - m.x;
  const dz = z - m.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return;
  const step = Math.min(speed * dt, len);
  m.x += (dx / len) * step;
  m.z += (dz / len) * step;
  faceTo(m, x, z, dt);
  m.anim = clamp(speed / Math.max(0.1, m.def.speed.chase), 0, 1);
}

/**
 * Route to a position. Indoors this follows the generated cell grid, so a
 * creature is never able to walk through a wall the player is hiding behind.
 */
function navigateTo(
  world: World,
  m: Monster,
  target: { x: number; z: number; level: number },
  speed: number,
  dt: number,
): boolean {
  if (m.level < 0) {
    if (target.level >= 0) return false;
    stepToward(world, m, target.x, target.z, speed, dt);
    return true;
  }

  const from = world.nav.nearest(m.level, m.x - INTERIOR_ORIGIN_X, m.z);
  const to = world.nav.nearest(target.level, target.x - INTERIOR_ORIGIN_X, target.z);
  if (from < 0 || to < 0) return false;

  if (world.time >= m.repathAt || m.path.length === 0 || m.mem.pathTo !== to) {
    m.path = world.nav.path(from, to, (doorId) => world.canMonsterPass(m.def, doorId));
    m.pathIndex = 0;
    m.mem.pathTo = to;
    m.repathAt = world.time + 0.55 + Math.random() * 0.5;
  }
  if (m.path.length === 0) return false;

  // Advance along the node list, skipping nodes already behind us.
  while (m.pathIndex < m.path.length) {
    const node = world.nav.world(m.path[m.pathIndex]);
    const cell = world.nav.node(m.path[m.pathIndex]);
    if (!node || !cell) {
      m.pathIndex++;
      continue;
    }
    const wx = INTERIOR_ORIGIN_X + node.x;
    if (cell.level !== m.level) {
      // Stairwell transition: step through instantly at the shared cell.
      m.level = cell.level;
      m.x = wx;
      m.z = node.z;
      m.pathIndex++;
      continue;
    }
    if (Math.hypot(wx - m.x, node.z - m.z) < TILE * 0.42) {
      m.pathIndex++;
      continue;
    }
    openDoorAhead(world, m, cell.level, cell.x, cell.z);
    stepToward(world, m, wx, node.z, speed, dt);
    return true;
  }
  return false;
}

function openDoorAhead(world: World, m: Monster, level: number, cx: number, cz: number): void {
  if (!m.def.flags?.opensDoors) return;
  const grid = world.layout.levels[level];
  if (!grid) return;
  const ci = cz * grid.w + cx;
  for (let s = 0; s < 4; s++) {
    const doorId = grid.doors[ci * 4 + s];
    if (doorId < 0) continue;
    const runtime = world.doors.get(doorId);
    if (runtime && runtime.state === 0 && !runtime.locked) world.toggleDoor(doorId, true);
  }
}

function wander(world: World, m: Monster, dt: number, radius = 26): void {
  if (!m.mem.wanderX || world.time > (m.mem.wanderUntil ?? 0)) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.35 + Math.random() * 0.65);
    m.mem.wanderX = m.home.x + Math.cos(a) * r;
    m.mem.wanderZ = m.home.z + Math.sin(a) * r;
    m.mem.wanderUntil = world.time + 4 + Math.random() * 7;
  }
  const moved = navigateTo(
    world,
    m,
    { x: m.mem.wanderX, z: m.mem.wanderZ, level: m.level },
    m.def.speed.wander,
    dt,
  );
  if (!moved) m.mem.wanderUntil = 0;
  m.anim = 0.25;
}

function tryAttack(world: World, m: Monster, target: ServerPlayer): boolean {
  if (world.time < m.nextAttackAt || m.windupUntil > 0) return false;
  if (dist3D(m, target) > m.def.attackRange) return false;
  m.nextAttackAt = world.time + m.def.attackCooldown;
  m.windupUntil = world.time + m.def.attackWindup;
  m.windupTarget = target.id;
  m.mode = MODE.attack;
  m.anim = 1;
  world.events.push({
    t: 'event',
    e: 'sound',
    kind: 'monsterWindup',
    defId: m.defId,
    id: m.id,
    x: m.x,
    y: m.y,
    z: m.z,
    level: m.level,
  });
  return true;
}

function nearestVisible(world: World, m: Monster, players: ServerPlayer[]): ServerPlayer | null {
  let best: ServerPlayer | null = null;
  let bestD = Infinity;
  for (const p of players) {
    if (!world.canSee(m, p)) continue;
    const d = dist2D(m, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function nearestPlayer(world: World, m: Monster, players: ServerPlayer[], sameLevel = true): ServerPlayer | null {
  let best: ServerPlayer | null = null;
  let bestD = Infinity;
  for (const p of players) {
    if (sameLevel && p.level !== m.level) continue;
    if (world.isInsideShip(p.x, p.y, p.z, p.level)) continue;
    const d = dist2D(m, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function remember(world: World, m: Monster, p: ServerPlayer): void {
  m.target = p.id;
  m.lastKnown = { x: p.x, z: p.z, level: p.level, at: world.time };
}

function memoryFresh(world: World, m: Monster): boolean {
  return !!m.lastKnown && world.time - m.lastKnown.at < m.def.senses.memory;
}

/** Is anyone with a working light currently pointing it at this creature? */
function litByPlayer(world: World, m: Monster, players: ServerPlayer[], range = 18): ServerPlayer | null {
  for (const p of players) {
    if ((p.flags & FLAG_LIGHT) === 0 || p.level !== m.level) continue;
    const d = dist2D(m, p);
    if (d > range) continue;
    const toMonster = Math.atan2(m.x - p.x, m.z - p.z);
    if (Math.abs(angleDelta(p.yaw, toMonster)) > 0.5) continue;
    if (!world.hasLineOfSight(p, m)) continue;
    return p;
  }
  return null;
}

function playersLookingAt(world: World, m: Monster, players: ServerPlayer[], range = 26): number {
  let n = 0;
  for (const p of players) {
    if (p.level !== m.level) continue;
    if (dist2D(m, p) > range) continue;
    const toMonster = Math.atan2(m.x - p.x, m.z - p.z);
    if (Math.abs(angleDelta(p.yaw, toMonster)) < 0.6 && world.hasLineOfSight(p, m)) n++;
  }
  return n;
}

// -------------------------------------------------------------------- brains

/** Weak alone; the maths changes entirely once there are four of them. */
function brainPack(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  const seen = nearestVisible(world, m, players);
  const heard = world.hears(m);
  if (seen) remember(world, m, seen);
  else if (heard && !heard.fake) m.lastKnown = { x: heard.x, z: heard.z, level: heard.level, at: world.time };

  const allies = [...world.monsters.values()].filter(
    (o) => o.id !== m.id && o.defId === m.defId && o.mode !== MODE.dead && o.level === m.level && dist2D(o, m) < 15,
  ).length;
  const courage = allies + (m.health / m.def.health < 0.4 ? -1 : 0);

  if (!memoryFresh(world, m)) {
    m.mode = MODE.idle;
    wander(world, m, dt, 30);
    return;
  }

  const target = players.find((p) => p.id === m.target) ?? null;
  const isolated = target
    ? players.filter((p) => p.id !== target.id && p.level === target.level && dist2D(p, target) < 16).length === 0
    : false;

  if (target && (courage >= 1 || isolated)) {
    m.mode = MODE.chase;
    navigateTo(world, m, target, m.def.speed.chase, dt);
    tryAttack(world, m, target);
    return;
  }

  // Not brave enough yet: circle at the edge of the light and call for backup.
  m.mode = MODE.alert;
  if (m.lastKnown) {
    const d = dist2D(m, { x: m.lastKnown.x, y: 0, z: m.lastKnown.z });
    if (d < 7) {
      const away = Math.atan2(m.x - m.lastKnown.x, m.z - m.lastKnown.z);
      stepToward(world, m, m.x + Math.sin(away) * 4, m.z + Math.cos(away) * 4, m.def.speed.alert, dt);
      faceTo(m, m.lastKnown.x, m.lastKnown.z, dt);
    } else {
      navigateTo(world, m, { x: m.lastKnown.x, z: m.lastKnown.z, level: m.lastKnown.level }, m.def.speed.alert, dt);
    }
  }
}

/** Hangs above a doorway and waits. Nothing about it is fair. */
function brainAmbush(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  if (m.mode === MODE.dormant) {
    m.anim = 0;
    const victim = players.find(
      (p) => p.level === m.level && dist2D(m, p) < 2.6 && !world.isInsideShip(p.x, p.y, p.z, p.level),
    );
    // A telltale click a beat before it commits: the only warning there is.
    if (!victim) {
      const near = players.find((p) => p.level === m.level && dist2D(m, p) < 6.5);
      if (near && world.time > (m.mem.clickAt ?? 0)) {
        m.mem.clickAt = world.time + 2.5;
        world.events.push({ t: 'event', e: 'sound', kind: 'creatureVoice', defId: m.defId, id: m.id, x: m.x, y: m.y, z: m.z, level: m.level, mode: 5 });
      }
      return;
    }
    m.mode = MODE.chase;
    m.mem.activeUntil = world.time + 13;
    remember(world, m, victim);
    world.events.push({ t: 'event', e: 'sound', kind: 'ambushDrop', defId: m.defId, id: m.id, x: m.x, y: m.y, z: m.z, level: m.level });
    return;
  }

  const target = players.find((p) => p.id === m.target);
  if (target && world.time < (m.mem.activeUntil ?? 0)) {
    navigateTo(world, m, target, m.def.speed.chase, dt);
    tryAttack(world, m, target);
    return;
  }
  // Back to the ceiling somewhere else. Learning one corridor does not save you.
  const node = world.nav.nearest(m.level, m.x - INTERIOR_ORIGIN_X, m.z);
  const spot = world.nav.world(node);
  if (spot) {
    m.home = { x: INTERIOR_ORIGIN_X + spot.x, z: spot.z, level: m.level };
    m.x = m.home.x;
    m.z = m.home.z;
  }
  m.mode = MODE.dormant;
  m.target = -1;
}

/** Owns one room. Everything outside that room is somebody else's problem. */
function brainTerritorial(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  const homeDist = Math.hypot(m.x - m.home.x, m.z - m.home.z);
  const intruder = players.find(
    (p) => p.level === m.home.level && Math.hypot(p.x - m.home.x, p.z - m.home.z) < 9,
  );

  if (intruder) {
    const close = dist2D(m, intruder) < 5.5;
    const provoked = close || (m.mem.provokedUntil ?? 0) > world.time;
    if (provoked) {
      m.mode = MODE.chase;
      m.mem.provokedUntil = world.time + 6;
      navigateTo(world, m, intruder, m.def.speed.chase, dt);
      tryAttack(world, m, intruder);
      return;
    }
    // Standing its ground: turns to face, growls, does not advance.
    m.mode = MODE.alert;
    faceTo(m, intruder.x, intruder.z, dt, 3);
    m.anim = 0.1;
    return;
  }

  if (homeDist > 3) {
    m.mode = MODE.alert;
    navigateTo(world, m, { x: m.home.x, z: m.home.z, level: m.home.level }, m.def.speed.alert, dt);
    return;
  }
  m.mode = MODE.idle;
  m.anim = 0.05;
  faceTo(m, m.x + Math.sin(world.time * 0.3), m.z + Math.cos(world.time * 0.3), dt, 0.6);
}

/** Takes your scrap to its cache. Killing it is optional; forgiving it is not. */
function brainThief(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  const nest = world.layout.nests[m.id % Math.max(1, world.layout.nests.length)] ?? null;
  const nestPos = nest
    ? { x: INTERIOR_ORIGIN_X + (nest.x + 0.5) * TILE, z: (nest.z + 0.5) * TILE, level: nest.level }
    : { x: m.home.x, z: m.home.z, level: m.home.level };

  const guard = players.find((p) => p.level === nestPos.level && Math.hypot(p.x - nestPos.x, p.z - nestPos.z) < 7);
  const enraged = (m.mem.rageUntil ?? 0) > world.time;
  if (guard || enraged) {
    m.mem.rageUntil = Math.max(m.mem.rageUntil ?? 0, world.time + 12);
    const target = guard ?? players.find((p) => p.id === m.target);
    if (target) {
      m.mode = MODE.chase;
      navigateTo(world, m, target, m.def.speed.chase, dt);
      tryAttack(world, m, target);
      return;
    }
  }

  if (m.carrying.length > 0) {
    m.mode = MODE.alert;
    const arrived = !navigateTo(world, m, nestPos, m.def.speed.alert, dt);
    if (arrived || Math.hypot(m.x - nestPos.x, m.z - nestPos.z) < 2.2) {
      for (const id of m.carrying) {
        const item = world.items.get(id);
        // A crewmate can grab an item out of the thief's grip mid-carry
        // (pickup only rejects heldBy >= 0). If so, it is the player's now —
        // do not teleport it to the nest out of their hands.
        if (!item || item.heldBy !== -m.id) continue;
        item.heldBy = -1;
        item.x = nestPos.x + (Math.random() - 0.5) * 2.4;
        item.z = nestPos.z + (Math.random() - 0.5) * 2.4;
        item.level = nestPos.level;
        item.y = world.groundAt(item.x, item.z, item.level) + 0.12;
        item.settled = true;
        world.dirtyItems.add(item.id);
      }
      m.carrying = [];
    }
    return;
  }

  // Hunting for loose scrap. Anything a crew stacked by the door is ideal.
  let best: { id: number; x: number; z: number; d: number } | null = null;
  for (const item of world.items.values()) {
    if (item.kind !== 'scrap' || item.heldBy >= 0 || item.stowed || item.level !== m.level) continue;
    const d = dist2D(m, item);
    if (d > 45) continue;
    if (!best || d < best.d) best = { id: item.id, x: item.x, z: item.z, d };
  }
  if (best) {
    m.mode = MODE.alert;
    navigateTo(world, m, { x: best.x, z: best.z, level: m.level }, m.def.speed.wander * 1.4, dt);
    if (best.d < 1.6) {
      const item = world.items.get(best.id);
      if (item) {
        item.heldBy = -m.id;
        m.carrying.push(item.id);
        world.dirtyItems.add(item.id);
        world.events.push({ t: 'event', e: 'sound', kind: 'thiefGrab', defId: m.defId, x: m.x, y: m.y, z: m.z, level: m.level, itemId: item.id });
      }
    }
    return;
  }
  wander(world, m, dt, 40);
}

/** No eyes. Ears the size of the corridor. */
function brainSoundHunter(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  const noise = world.hears(m);
  if (noise) {
    m.lastKnown = { x: noise.x, z: noise.z, level: noise.level, at: world.time };
    m.mem.urgency = clamp(noise.loudness / 3, 0.3, 1);
  }

  if (memoryFresh(world, m) && m.lastKnown) {
    const urgency = m.mem.urgency ?? 0.5;
    m.mode = urgency > 0.6 ? MODE.chase : MODE.alert;
    const speed = urgency > 0.6 ? m.def.speed.chase : m.def.speed.alert;
    const arrived = !navigateTo(world, m, { x: m.lastKnown.x, z: m.lastKnown.z, level: m.lastKnown.level }, speed, dt);
    // It kills whatever it walks into, which need not be what it was chasing.
    for (const p of players) {
      if (p.level !== m.level) continue;
      if (dist3D(m, p) <= m.def.attackRange) {
        tryAttack(world, m, p);
        break;
      }
    }
    if (arrived) m.lastKnown = null;
    return;
  }
  m.mode = MODE.idle;
  wander(world, m, dt, 34);
}

/** A door that is not on the map. */
function brainMimic(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  m.anim = 0;
  m.mode = MODE.dormant;
  const victim = players.find((p) => {
    if (p.level !== m.level) return false;
    if (dist3D(m, p) > m.def.attackRange) return false;
    const toDoor = Math.atan2(m.x - p.x, m.z - p.z);
    return Math.abs(angleDelta(p.yaw, toDoor)) < 1.1;
  });
  if (victim) {
    m.mode = MODE.attack;
    tryAttack(world, m, victim);
  }
}

/** Sounds exactly like your crewmate. Is not your crewmate. */
function brainPsych(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  const light = litByPlayer(world, m, players, 16);
  if (light) {
    // Caught in a beam: it relocates rather than fights.
    const node = world.nav.nearest(m.level, m.x - INTERIOR_ORIGIN_X, m.z);
    const spot = world.nav.world(node);
    if (spot) {
      const all = world.nav.allNodes();
      const dest = world.nav.world(all[Math.floor(Math.random() * all.length)]);
      if (dest) {
        m.x = INTERIOR_ORIGIN_X + dest.x;
        m.z = dest.z;
      }
    }
    m.mem.mimicAt = world.time + 8;
    world.events.push({ t: 'event', e: 'sound', kind: 'psychFlee', defId: m.defId, id: m.id, x: m.x, y: m.y, z: m.z, level: m.level });
    return;
  }

  const target = nearestPlayer(world, m, players);
  if (!target) {
    wander(world, m, dt, 40);
    return;
  }

  const d = dist2D(m, target);
  if (d < 2.4) {
    m.mode = MODE.attack;
    tryAttack(world, m, target);
    return;
  }

  // It calls in someone else's voice from a place they are not.
  if (world.time > (m.mem.mimicAt ?? 0) && d < 40) {
    m.mem.mimicAt = world.time + 14 + Math.random() * 22;
    const impersonated = players[Math.floor(Math.random() * players.length)];
    world.events.push({
      t: 'event',
      e: 'voiceMimic',
      id: m.id,
      x: m.x,
      y: m.y,
      z: m.z,
      level: m.level,
      asPlayer: impersonated?.id ?? -1,
      asName: impersonated?.name ?? 'CREW',
      toPlayer: target.id,
    });
    world.events.push({ t: 'event', e: 'radarBlip', id: m.id, x: m.x, z: m.z, level: m.level, name: impersonated?.name ?? 'CREW' });
  }

  // Drifts toward the target but always stops at the edge of vision.
  m.mode = MODE.alert;
  if (d > 12) navigateTo(world, m, target, m.def.speed.alert, dt);
  else wander(world, m, dt, 12);
}

/** Only sees velocity. Standing still is the entire counterplay. */
function brainMotion(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  let target: ServerPlayer | null = null;
  let bestScore = 0;
  for (const p of players) {
    if (p.level !== m.level) continue;
    if (world.isInsideShip(p.x, p.y, p.z, p.level)) continue;
    const d = dist2D(m, p);
    if (d > m.def.senses.sight) continue;
    const moving = p.speed;
    if (moving < 1.2) continue;
    const score = moving / Math.max(2, d);
    if (score > bestScore) {
      bestScore = score;
      target = p;
    }
  }

  if (target) {
    remember(world, m, target);
    m.mem.lockUntil = world.time + 2.2;
  }

  const locked = (m.mem.lockUntil ?? 0) > world.time;
  const current = players.find((p) => p.id === m.target);
  if (locked && current) {
    m.mode = MODE.chase;
    navigateTo(world, m, current, m.def.speed.chase, dt);
    tryAttack(world, m, current);
    return;
  }
  m.mode = MODE.idle;
  m.target = -1;
  wander(world, m, dt, 20);
}

/** Follows. Waits. Picks the one who wandered off. */
function brainStalker(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  const seen = nearestVisible(world, m, players) ?? nearestPlayer(world, m, players);
  if (!seen) {
    m.mode = MODE.idle;
    wander(world, m, dt, 45);
    return;
  }
  remember(world, m, seen);

  const watchers = playersLookingAt(world, m, players, 24);
  const companions = players.filter((p) => p.id !== seen.id && p.level === seen.level && dist2D(p, seen) < 15).length;
  const d = dist2D(m, seen);

  if (watchers >= 2) {
    // Backs off while it is outnumbered and observed.
    m.mode = MODE.alert;
    const away = Math.atan2(m.x - seen.x, m.z - seen.z);
    stepToward(world, m, m.x + Math.sin(away) * 6, m.z + Math.cos(away) * 6, m.def.speed.alert, dt);
    faceTo(m, seen.x, seen.z, dt);
    return;
  }

  if (companions === 0 && d < 22) {
    m.mode = MODE.chase;
    navigateTo(world, m, seen, m.def.speed.chase, dt);
    tryAttack(world, m, seen);
    return;
  }

  // Shadowing: holds a fixed stand-off distance.
  m.mode = MODE.alert;
  const want = 14;
  if (d > want + 3) navigateTo(world, m, seen, m.def.speed.alert, dt);
  else if (d < want - 3) {
    const away = Math.atan2(m.x - seen.x, m.z - seen.z);
    stepToward(world, m, m.x + Math.sin(away) * 4, m.z + Math.cos(away) * 4, m.def.speed.wander, dt);
  } else {
    faceTo(m, seen.x, seen.z, dt);
    m.anim = 0.15;
  }
}

/** Owns the main halls. Cannot fit anywhere else, and does not need to. */
function brainGiant(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  const canStand = (level: number, wx: number, wz: number): boolean => {
    const cx = Math.floor((wx - INTERIOR_ORIGIN_X) / TILE);
    const cz = Math.floor(wz / TILE);
    const room = world.roomAt(level, cx, cz);
    if (!room) return false;
    return room.tags.includes('corridor') || room.tags.includes('hall') || room.tags.includes('entrance') || room.w * room.d >= 9;
  };

  const seen = nearestVisible(world, m, players);
  const heard = world.hears(m);
  if (seen) remember(world, m, seen);
  else if (heard) m.lastKnown = { x: heard.x, z: heard.z, level: heard.level, at: world.time };

  const target = players.find((p) => p.id === m.target);
  if (target && memoryFresh(world, m)) {
    if (canStand(target.level, target.x, target.z)) {
      m.mode = MODE.chase;
      navigateTo(world, m, target, m.def.speed.chase, dt);
      tryAttack(world, m, target);
      return;
    }
    // The target ducked into a side room. It parks outside and waits them out.
    m.mode = MODE.alert;
    if (m.lastKnown) navigateTo(world, m, { x: m.lastKnown.x, z: m.lastKnown.z, level: m.lastKnown.level }, m.def.speed.alert, dt);
    faceTo(m, target.x, target.z, dt, 1.5);
    return;
  }

  m.mode = MODE.idle;
  if (!m.mem.patrolX || world.time > (m.mem.patrolUntil ?? 0)) {
    const nodes = world.nav.allNodes();
    for (let i = 0; i < 40; i++) {
      const candidate = world.nav.world(nodes[Math.floor(Math.random() * nodes.length)]);
      const cell = world.nav.node(nodes[Math.floor(Math.random() * nodes.length)]);
      if (!candidate || !cell) continue;
      const wx = INTERIOR_ORIGIN_X + candidate.x;
      if (cell.level === m.level && canStand(cell.level, wx, candidate.z)) {
        m.mem.patrolX = wx;
        m.mem.patrolZ = candidate.z;
        m.mem.patrolUntil = world.time + 25;
        break;
      }
    }
  }
  if (m.mem.patrolX) {
    const moved = navigateTo(world, m, { x: m.mem.patrolX, z: m.mem.patrolZ, level: m.level }, m.def.speed.wander, dt);
    if (!moved) m.mem.patrolUntil = 0;
  }
}

/** Lies where a crewmate would lie. Faces the door, which bodies do not. */
function brainDecoy(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  if (m.mode === MODE.dormant) {
    m.anim = 0;
    const victim = players.find((p) => p.level === m.level && dist2D(m, p) < 3.2);
    if (victim) {
      m.mode = MODE.chase;
      m.mem.activeUntil = world.time + 16;
      remember(world, m, victim);
      world.events.push({ t: 'event', e: 'sound', kind: 'decoyRise', defId: m.defId, id: m.id, x: m.x, y: m.y, z: m.z, level: m.level });
    } else {
      // Slowly rotates to face whoever is nearest. Nobody notices until they do.
      const near = nearestPlayer(world, m, players);
      if (near) faceTo(m, near.x, near.z, dt, 0.35);
    }
    return;
  }
  const target = players.find((p) => p.id === m.target);
  if (target && world.time < (m.mem.activeUntil ?? 0)) {
    navigateTo(world, m, target, m.def.speed.chase, dt);
    tryAttack(world, m, target);
    return;
  }
  m.mode = MODE.dormant;
  m.target = -1;
  m.home = { x: m.x, z: m.z, level: m.level };
}

/** Grabs and holds. The danger is everything that arrives while you are stuck. */
function brainSnare(world: World, m: Monster, players: ServerPlayer[], dt: number, damage: Damage): void {
  m.anim = 0;
  const held = players.find((p) => p.grabbedBy === m.id);
  if (held) {
    if (held.state !== 'alive' || dist2D(m, held) > 3.2) {
      held.grabbedBy = -1;
      world.events.push({ t: 'event', e: 'release', monster: m.id, player: held.id });
      return;
    }
    damage(held, m.def.damage * dt, 'nightbriar');
    // Rescue: another crewmate standing next to you tears it open.
    const rescuer = players.find((p) => p.id !== held.id && p.level === held.level && dist2D(p, held) < 2.4);
    const carrying = held.slots.some((s) => s !== null);
    m.mem.struggle = (m.mem.struggle ?? 0) + dt * (rescuer ? 3.2 : carrying ? 0.35 : 1);
    if (m.mem.struggle > 6) {
      held.grabbedBy = -1;
      m.mem.struggle = 0;
      m.mem.cooldownUntil = world.time + 8;
      world.events.push({ t: 'event', e: 'release', monster: m.id, player: held.id });
    }
    return;
  }

  if ((m.mem.cooldownUntil ?? 0) > world.time) return;
  const victim = players.find(
    (p) => p.level === m.level && p.grabbedBy < 0 && dist3D(m, p) < m.def.attackRange,
  );
  if (victim) {
    victim.grabbedBy = m.id;
    m.mem.struggle = 0;
    world.events.push({ t: 'event', e: 'grab', monster: m.id, defId: m.defId, player: victim.id, x: m.x, y: m.y, z: m.z });
  }
}

/** Harmless until it is not, and then it is very much not. */
function brainSkittish(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  const raging = (m.mem.rageUntil ?? 0) > world.time;
  if (raging) {
    m.mode = MODE.chase;
    const target = players.find((p) => p.id === m.target) ?? nearestPlayer(world, m, players);
    if (target) {
      navigateTo(world, m, target, m.def.speed.chase, dt);
      // It does not aim; it simply arrives.
      for (const p of players) {
        if (p.level === m.level && dist3D(m, p) < m.def.attackRange) {
          tryAttack(world, m, p);
          break;
        }
      }
    } else {
      stepToward(world, m, m.x + Math.sin(m.yaw) * 20, m.z + Math.cos(m.yaw) * 20, m.def.speed.chase, dt);
    }
    return;
  }

  // Startle checks, in rough order of how stupid the mistake was.
  for (const p of players) {
    if (p.level !== m.level) continue;
    const d = dist2D(m, p);
    let startled = false;
    if (d < 9 && p.speed > 5) startled = true;
    if (d < 5) startled = true;
    if (d < 16 && (p.flags & FLAG_LIGHT) !== 0 && litByPlayer(world, m, [p], 16)) startled = true;
    if (startled) {
      m.mem.rageUntil = world.time + 9;
      remember(world, m, p);
      world.events.push({ t: 'event', e: 'sound', kind: 'startle', defId: m.defId, id: m.id, x: m.x, y: m.y, z: m.z, level: m.level });
      return;
    }
  }
  const noise = world.hears(m);
  if (noise && noise.loudness > 3.5 && dist2D(m, noise) < 24) {
    m.mem.rageUntil = world.time + 7;
    m.lastKnown = { x: noise.x, z: noise.z, level: noise.level, at: world.time };
    world.events.push({ t: 'event', e: 'sound', kind: 'startle', defId: m.defId, id: m.id, x: m.x, y: m.y, z: m.z, level: m.level });
    return;
  }

  m.mode = MODE.idle;
  wander(world, m, dt, 55);
}

/** The straightforward one. Nothing clever, just faster than you. */
function brainApex(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  const seen = nearestVisible(world, m, players);
  const heard = world.hears(m);
  if (seen) remember(world, m, seen);
  else if (heard && !heard.fake) m.lastKnown = { x: heard.x, z: heard.z, level: heard.level, at: world.time };

  const target = players.find((p) => p.id === m.target);
  if (target && memoryFresh(world, m)) {
    // It will not follow you inside, and it will not step onto the ship ramp.
    const safe = target.level >= 0 || world.isInsideShip(target.x, target.y, target.z, target.level);
    if (safe) {
      m.mode = MODE.alert;
      if (m.lastKnown) navigateTo(world, m, { x: m.lastKnown.x, z: m.lastKnown.z, level: -1 }, m.def.speed.alert, dt);
      return;
    }
    m.mode = MODE.chase;
    navigateTo(world, m, target, m.def.speed.chase, dt);
    tryAttack(world, m, target);
    return;
  }
  m.mode = MODE.idle;
  wander(world, m, dt, 70);
}

/** A light in the dark that is walking backwards away from you. */
function brainLure(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  const target = nearestPlayer(world, m, players);
  if (!target) {
    wander(world, m, dt, 50);
    return;
  }
  const d = dist2D(m, target);

  if (d < 4.5) {
    m.mode = MODE.attack;
    tryAttack(world, m, target);
    const away = Math.atan2(m.x - target.x, m.z - target.z);
    stepToward(world, m, m.x + Math.sin(away) * 8, m.z + Math.cos(away) * 8, m.def.speed.chase, dt);
    return;
  }

  // Leads away from the ship, holding just close enough to stay interesting.
  m.mode = MODE.alert;
  const shipAngle = Math.atan2(m.x - world.ship.x, m.z - world.ship.z);
  const goalX = m.x + Math.sin(shipAngle) * 14;
  const goalZ = m.z + Math.cos(shipAngle) * 14;
  const wantDist = 16;
  if (d > wantDist + 8) {
    stepToward(world, m, target.x, target.z, m.def.speed.alert, dt);
  } else {
    stepToward(world, m, goalX, goalZ, m.def.speed.wander, dt);
  }
}

/** Blind, and the ground is its ear. */
function brainSeismic(world: World, m: Monster, players: ServerPlayer[], dt: number): void {
  let loudest: { p: ServerPlayer; score: number } | null = null;
  for (const p of players) {
    if (p.level !== m.level) continue;
    if (world.isInsideShip(p.x, p.y, p.z, p.level)) continue;
    // Footfall only. Standing still makes you invisible to it, crouching helps.
    const crouch = (p.flags & FLAG_CROUCH) !== 0 ? 0.35 : 1;
    const score = p.speed * crouch;
    if (score < 0.55) continue;
    const d = dist2D(m, p);
    if (d > m.def.senses.hearing) continue;
    const weighted = score / Math.max(4, d * 0.25);
    if (!loudest || weighted > loudest.score) loudest = { p, score: weighted };
  }

  if (loudest) {
    remember(world, m, loudest.p);
    m.mem.holdUntil = world.time + 2.4;
  }

  const hold = (m.mem.holdUntil ?? 0) > world.time;
  const target = players.find((p) => p.id === m.target);
  if (hold && target) {
    m.mode = MODE.chase;
    navigateTo(world, m, target, m.def.speed.chase, dt);
    tryAttack(world, m, target);
    return;
  }
  if (m.lastKnown && memoryFresh(world, m)) {
    m.mode = MODE.alert;
    navigateTo(world, m, { x: m.lastKnown.x, z: m.lastKnown.z, level: m.lastKnown.level }, m.def.speed.alert, dt);
    return;
  }
  m.mode = MODE.idle;
  wander(world, m, dt, 80);
}

/** Convenience used by the melee code path in room.ts. */
export function provoke(world: World, m: Monster, attacker: ServerPlayer): void {
  m.mem.rageUntil = world.time + 14;
  m.mem.provokedUntil = world.time + 10;
  m.mem.activeUntil = world.time + 16;
  m.mem.lockUntil = world.time + 6;
  m.mem.holdUntil = world.time + 5;
  if (m.mode === MODE.dormant) m.mode = MODE.chase;
  remember(world, m, attacker);
}
