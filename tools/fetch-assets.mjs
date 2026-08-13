#!/usr/bin/env node
/**
 * Pulls the CC0 asset library described by tools/assets/sources.json into
 * client/public/assets, then writes catalog.json so the game can enumerate what
 * actually landed on disk instead of hardcoding a thousand filenames.
 *
 * Everything is skipped if the file already exists, so re-running is cheap.
 *
 *   node tools/fetch-assets.mjs            # fetch everything missing
 *   node tools/fetch-assets.mjs --force    # re-download
 *   node tools/fetch-assets.mjs --only=kit.station,mob.easy
 */

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client', 'public', 'assets');
const CACHE = path.join(ROOT, '.asset-cache');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').replace('--only=', '')
  .split(',').filter(Boolean);

const CONCURRENCY = 12;
let downloaded = 0;
let skipped = 0;
let bytes = 0;
let failed = 0;

const sources = JSON.parse(await readFile(path.join(ROOT, 'tools', 'assets', 'sources.json'), 'utf8'));

function raw(repoKey, filePath) {
  const r = sources.repos[repoKey];
  return `https://raw.githubusercontent.com/${r.repo}/${r.branch}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
}

async function getTree(repoKey) {
  const r = sources.repos[repoKey];
  await mkdir(CACHE, { recursive: true });
  const cacheFile = path.join(CACHE, `tree-${repoKey}.json`);
  if (existsSync(cacheFile) && !FORCE) {
    const age = Date.now() - (await stat(cacheFile)).mtimeMs;
    if (age < 1000 * 60 * 60 * 24) return JSON.parse(await readFile(cacheFile, 'utf8'));
  }
  const url = `https://api.github.com/repos/${r.repo}/git/trees/${r.branch}?recursive=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'deephaul-asset-fetch' } });
  if (!res.ok) throw new Error(`tree ${repoKey}: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const tree = json.tree.filter((t) => t.type === 'blob').map((t) => ({ path: t.path, size: t.size }));
  await writeFile(cacheFile, JSON.stringify(tree));
  return tree;
}

async function download(url, dest) {
  if (existsSync(dest) && !FORCE) {
    skipped++;
    return true;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'deephaul-asset-fetch' } });
      if (!res.ok) throw new Error(`${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      downloaded++;
      bytes += buf.length;
      return true;
    } catch (err) {
      if (attempt === 2) {
        failed++;
        process.stderr.write(`\n  ! ${url} -> ${err.message}\n`);
        return false;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return false;
}

/** Bounded-parallel map. Keeps GitHub happy and the terminal readable. */
async function pool(items, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
      if ((downloaded + skipped) % 25 === 0) {
        process.stdout.write(`\r  ${downloaded} fetched / ${skipped} cached / ${(bytes / 1e6).toFixed(1)} MB   `);
      }
    }
  });
  await Promise.all(workers);
}

const catalog = { generated: new Date().toISOString(), groups: {}, hero: [], textures: [], audio: [] };

// ---------------------------------------------------------------- model groups
for (const group of sources.groups) {
  if (ONLY.length && !ONLY.includes(group.id)) continue;
  const tree = await getTree(group.repo);
  let files = tree.filter((f) => f.path.startsWith(group.src) && group.ext.some((e) => f.path.toLowerCase().endsWith(e)));
  if (group.include) {
    files = files.filter((f) => group.include.some((inc) => path.basename(f.path).includes(inc)));
  }
  if (group.exclude) {
    files = files.filter((f) => !group.exclude.some((ex) => path.basename(f.path).includes(ex)));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (group.max) files = files.slice(0, group.max);
  if (!files.length) {
    process.stderr.write(`  ! group ${group.id} matched nothing under ${group.src}\n`);
    continue;
  }
  process.stdout.write(`${group.id.padEnd(18)} ${String(files.length).padStart(4)} files\n`);
  const names = [];
  await pool(files, async (f) => {
    // Quaternius exports carry a "-transformed" suffix from gltfjsx; drop it.
    const base = path.basename(f.path).replace('-transformed', '');
    const dest = path.join(OUT, group.dest, base);
    const ok = await download(raw(group.repo, f.path), dest);
    if (ok) names.push(base.replace(/\.(glb|gltf)$/i, ''));
  });
  process.stdout.write('\r');
  catalog.groups[group.id] = { dir: group.dest, names: names.sort() };
}

// -------------------------------------------------------------- polyhaven hero
if (!ONLY.length || ONLY.includes('hero')) {
  const tree = await getTree(sources.polyhaven.repo);
  for (const item of sources.polyhaven.items) {
    const id = path.basename(item);
    const files = tree.filter(
      (f) => f.path.startsWith(item + '/') && /\.(gltf|bin|jpg|png)$/i.test(f.path) && !/_4k|_2k|_8k/i.test(f.path),
    );
    if (!files.length) {
      process.stderr.write(`  ! hero ${item} not found\n`);
      continue;
    }
    process.stdout.write(`hero:${id.padEnd(24)} ${files.length} files\n`);
    await pool(files, async (f) => {
      const rel = f.path.slice(item.length + 1);
      await download(raw(sources.polyhaven.repo, f.path), path.join(OUT, sources.polyhaven.dest, id, rel));
    });
    process.stdout.write('\r');
    const gltf = files.find((f) => f.path.endsWith('.gltf'));
    if (gltf) catalog.hero.push({ id, file: `${sources.polyhaven.dest}${id}/${path.basename(gltf.path)}` });
  }
}

// ------------------------------------------------------------------- materials
if (!ONLY.length || ONLY.includes('textures')) {
  const m = sources.materials;
  const tree = await getTree(m.repo);
  const jobs = [];
  for (const item of m.items) {
    for (const suffix of m.suffixes) {
      const wanted = `${m.src}${item}/${item}${suffix}`;
      const hit = tree.find((f) => f.path === wanted);
      if (hit) jobs.push({ src: hit.path, dest: path.join(OUT, m.dest, item + suffix.replace('_1K-JPG', '')) });
    }
    catalog.textures.push(item);
  }
  process.stdout.write(`textures           ${jobs.length} files\n`);
  await pool(jobs, async (j) => {
    await download(raw(m.repo, j.src), j.dest);
  });
  process.stdout.write('\r');
}

// ----------------------------------------------------------------------- audio
if (!ONLY.length || ONLY.includes('audio')) {
  const a = sources.audio;
  const r = sources.repos[a.repo];
  const manUrl = `https://raw.githubusercontent.com/${r.repo}/${r.branch}/${a.manifest}`;
  const man = await (await fetch(manUrl)).json();
  const items = Array.isArray(man) ? man : man.sounds;
  const byCat = new Map();
  for (const s of items) {
    if (!byCat.has(s.category)) byCat.set(s.category, []);
    byCat.get(s.category).push(s);
  }
  const jobs = [];
  for (const [cat, limit] of Object.entries(a.categories)) {
    const list = (byCat.get(cat) ?? []).slice(0, limit);
    for (const s of list) {
      jobs.push({ src: s.file, dest: path.join(OUT, a.dest, cat, path.basename(s.file)), id: s.id, cat });
    }
  }
  process.stdout.write(`audio              ${jobs.length} files\n`);
  await pool(jobs, async (j) => {
    const ok = await download(raw(a.repo, j.src), j.dest);
    if (ok) catalog.audio.push({ id: j.id, cat: j.cat, file: `${a.dest}${j.cat}/${path.basename(j.dest)}` });
  });
  process.stdout.write('\r');
}

catalog.audio.sort((x, y) => x.id.localeCompare(y.id));
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 1));

const totalNames = Object.values(catalog.groups).reduce((n, g) => n + g.names.length, 0);
process.stdout.write(
  `\nassets ready: ${totalNames} kit models, ${catalog.hero.length} hero props, ` +
    `${catalog.textures.length} materials, ${catalog.audio.length} sounds\n` +
    `  ${downloaded} downloaded (${(bytes / 1e6).toFixed(1)} MB), ${skipped} already cached, ${failed} failed\n` +
    `  catalog -> client/public/assets/catalog.json\n`,
);
if (failed > 0) process.exitCode = 1;
