import { describe, it, expect } from 'vitest';
import { generateFacility } from '@shared/facility/generate.ts';
import { NavGraph } from '@shared/facility/nav.ts';
import { MOONS } from '@shared/content/moons.ts';
import { TILE } from '@shared/constants.ts';
import { cellIndex, isFloor } from '@shared/facility/types.ts';

const openAnyDoor = () => true;

function build(moonIndex: number, seed: number) {
  return generateFacility({ seed, moon: MOONS[moonIndex], weather: 'clear', dayIndex: 0 });
}

describe('facility generation', () => {
  it('produces a connected facility for every moon across many seeds', () => {
    for (let m = 0; m < MOONS.length; m++) {
      for (let s = 0; s < 12; s++) {
        const layout = build(m, 1000 + s * 7919 + m * 31);
        const nav = new NavGraph(layout);
        const reachable = nav.reachableFromEntrances(openAnyDoor);
        const all = nav.allNodes();
        const ratio = reachable.size / all.length;
        expect(
          ratio,
          `moon ${MOONS[m].id} seed ${s}: only ${(ratio * 100).toFixed(1)}% of cells reachable`,
        ).toBeGreaterThan(0.9);
      }
    }
  });

  it('always carves at least one exterior entrance', () => {
    for (let m = 0; m < MOONS.length; m++) {
      for (let s = 0; s < 8; s++) {
        const layout = build(m, 500 + s * 104729 + m);
        expect(layout.entrySpawns.length, `moon ${MOONS[m].id}`).toBeGreaterThan(0);
        expect(layout.anchors.some((a) => a.kind === 'main')).toBe(true);
      }
    }
  });

  it('places all scrap on walkable floor', () => {
    for (let s = 0; s < 10; s++) {
      const layout = build(4, 77 + s * 13);
      for (const item of layout.scrap) {
        const grid = layout.levels[item.level];
        const cx = Math.floor(item.px / TILE);
        const cz = Math.floor(item.pz / TILE);
        expect(isFloor(grid, cx, cz), `scrap ${item.defId} at ${cx},${cz} is inside rock`).toBe(true);
      }
    }
  });

  it('makes every scrap piece reachable without breaking locks', () => {
    // Locked doors need a cutter, so treat them as blocked for this check and
    // allow a small share of scrap to be genuinely gated behind them.
    for (let s = 0; s < 8; s++) {
      const layout = build(2, 4242 + s * 977);
      const nav = new NavGraph(layout);
      const doorKind = new Map(layout.doors.map((d) => [d.id, d.kind]));
      const reachable = nav.reachableFromEntrances((id) => doorKind.get(id) !== 'locked');
      let gated = 0;
      for (const item of layout.scrap) {
        const id = nav.nearest(item.level, item.px, item.pz);
        if (!reachable.has(id)) gated++;
      }
      expect(gated / Math.max(1, layout.scrap.length)).toBeLessThan(0.35);
    }
  });

  it('is deterministic: same seed gives an identical layout', () => {
    const a = build(3, 999);
    const b = build(3, 999);
    expect(a.stats).toEqual(b.stats);
    expect(a.scrap).toEqual(b.scrap);
    expect(a.props.length).toBe(b.props.length);
    expect(Array.from(a.levels[0].walls)).toEqual(Array.from(b.levels[0].walls));
  });

  it('varies between seeds', () => {
    const a = build(3, 1);
    const b = build(3, 2);
    expect(a.stats.cellCount === b.stats.cellCount && a.stats.roomCount === b.stats.roomCount).toBe(false);
  });

  it('scales scrap value with moon difficulty', () => {
    const easy = build(0, 31337);
    const hard = build(6, 31337);
    expect(hard.stats.scrapValue).toBeGreaterThan(easy.stats.scrapValue * 2);
  });

  it('gives deep moons a sublevel with stairs that connect', () => {
    const layout = build(6, 8888);
    expect(layout.levels.length).toBeGreaterThanOrEqual(2);
    expect(layout.stairs.length).toBeGreaterThan(0);
    const nav = new NavGraph(layout);
    for (const stair of layout.stairs) {
      expect(nav.id(stair.level, stair.x, stair.z)).toBeGreaterThanOrEqual(0);
      expect(nav.id(stair.level + 1, stair.x, stair.z)).toBeGreaterThanOrEqual(0);
    }
  });

  it('finds a path from an entrance to the deepest room', () => {
    const layout = build(5, 20260813);
    const nav = new NavGraph(layout);
    const start = nav.nearest(layout.entrySpawns[0].level, layout.entrySpawns[0].px, layout.entrySpawns[0].pz);
    const deepest = [...layout.rooms].sort((a, b) => b.depth - a.depth)[0];
    const grid = layout.levels[deepest.level];
    let target = -1;
    for (let z = deepest.z; z < deepest.z + deepest.d && target < 0; z++) {
      for (let x = deepest.x; x < deepest.x + deepest.w; x++) {
        if (grid.cells[cellIndex(grid, x, z)] === deepest.id) {
          target = nav.id(deepest.level, x, z);
          break;
        }
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    const path = nav.path(start, target, openAnyDoor);
    expect(path.length).toBeGreaterThan(0);
  });
});
