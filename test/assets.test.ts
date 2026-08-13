import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { SCRAP } from '@shared/content/scrap.ts';
import { MONSTERS } from '@shared/content/monsters.ts';
import { EQUIPMENT } from '@shared/content/equipment.ts';

const CATALOG = path.resolve(process.cwd(), 'client/public/assets/catalog.json');

interface Catalog {
  groups: Record<string, { dir: string; names: string[] }>;
  hero: { id: string; file: string }[];
}

const hasCatalog = existsSync(CATALOG);
const catalog: Catalog | null = hasCatalog ? JSON.parse(readFileSync(CATALOG, 'utf8')) : null;

function resolves(ref: string): boolean {
  if (!catalog) return true;
  const [group, name] = ref.split('/');
  if (group === 'hero') return catalog.hero.some((h) => h.id === name);
  const g = catalog.groups[group];
  return !!g && g.names.includes(name);
}

describe.skipIf(!hasCatalog)('asset references', () => {
  it('every scrap model exists in the fetched catalog', () => {
    const missing = SCRAP.filter((s) => !resolves(s.model)).map((s) => `${s.id} -> ${s.model}`);
    expect(missing).toEqual([]);
  });

  it('every creature model exists', () => {
    const missing = MONSTERS.filter((m) => !resolves(m.model)).map((m) => `${m.id} -> ${m.model}`);
    expect(missing).toEqual([]);
  });

  it('every equipment model exists', () => {
    const missing = EQUIPMENT.filter((e) => !resolves(e.model)).map((e) => `${e.id} -> ${e.model}`);
    expect(missing).toEqual([]);
  });
});

describe('content sanity', () => {
  it('has unique ids across each table', () => {
    for (const table of [SCRAP, MONSTERS, EQUIPMENT] as { id: string }[][]) {
      const ids = table.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('scrap value ranges are ordered and positive', () => {
    for (const s of SCRAP) {
      expect(s.value[0]).toBeGreaterThan(0);
      expect(s.value[1]).toBeGreaterThanOrEqual(s.value[0]);
      expect(s.weight).toBeGreaterThan(0);
    }
  });

  it('heavy scrap is two-handed so the weight decision actually bites', () => {
    const cheats = SCRAP.filter((s) => s.weight >= 30 && !s.twoHanded).map((s) => s.id);
    expect(cheats).toEqual([]);
  });
});
