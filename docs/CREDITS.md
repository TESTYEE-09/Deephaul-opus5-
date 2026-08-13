# Credits

Every art and audio asset used by DEEPHAUL is released under
**[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)** —
public domain equivalent. No attribution is legally required. It is given here
anyway, because these creators made this project possible and none of them owed
anyone that.

Nothing under `client/public/assets/` is committed to this repository.
`tools/fetch-assets.mjs` downloads it on demand from the mirrors listed in
`tools/assets/sources.json` and writes `catalog.json`, which the game reads at
runtime to discover what actually landed on disk.

---

## Kenney — https://kenney.nl

**3D kits**

| Pack | Used for |
|---|---|
| Space Station Kit | Primary facility interior: walls, floors, doorways, stairs, rails, pipes, containers, terminals |
| Factory Kit | Industrial dressing: conveyors, machines, catwalks, hoppers, cranes, screens, hazard signage; the ship's monitor bank and launch lever |
| Modular Cave Kit | Mineshaft interior variant |
| City Kit (Industrial) | Exterior facility silhouettes, chimneys, tanks; the Company depot building |
| Survival Kit | Exterior rocks, barrels, crates, fences, workbenches, metal panels |
| Graveyard Kit | Dressing for the bone-orchard moon; ghost and keeper creature models |
| Space Kit | The ship: hull, fins, landing legs, terminal desk, generator, satellite dish, rails |
| Food Kit | A meaningful share of the scrap table |
| Mini Arcade | Arcade cabinet, claw machine, pinball table, vending machine — the heaviest and most valuable comedy scrap in the game |
| Mini Market | Shelving, freezers, shopping trolley |
| 3D Road Tiles / Street props | Signage, streetlights |

**Audio** — the entire sample library. Footsteps (concrete, grass, wood, carpet,
snow), impacts (metal, glass, bell, mining, generic), sci-fi doors and computer
noise, explosion crunch, force fields, interface clicks, confirmations and
errors, RPG creaks and cloth.

Packs: *Impact Sounds*, *Sci-Fi Sounds*, *Digital Audio*, *Interface Sounds*,
*UI Audio*, *RPG Audio*.

---

## Quaternius — https://quaternius.com

| Pack | Used for |
|---|---|
| Modular Sci-Fi | Second interior look: panelled walls, vents, sliding doors, floor tiles, props |
| Modular Dungeon | Sublevel / catacomb interior variant |
| House Interior | Office, canteen, dorm and washroom furniture; a large slice of the scrap table |
| Survival Pack | Equipment models — shovel, torch, radio, flare gun, batteries, compass — plus scrap |
| RPG Items | Weird valuables: chalices, crowns, crystals, keys, bones, ingots |
| Cyberpunk Pack | Company-issue props, monitors, cables, signage, air handlers |
| Nature Pack | Dead trees, bushes, exterior foliage |
| Street Pack | Signs, streetlights, traffic lights |
| Ultimate Space Pack | Depot structures and domes |
| Modular Men / Modular Women | Animated crew models |
| Easy Enemies | Gnashling, Latchbug, Sifter, Weaver |
| Animals Pack | Brinehound, Scur |
| Dinosaurs Pack | Drifter, Hauler, Colossus |
| Mech Pack | Quarryman |
| Ultimate Monsters | Tallow, Hoarder |

---

## Poly Haven — https://polyhaven.com

Photogrammetry hero scrap, at 1K textures:

Television, Camera, Lantern, Megaphone, Ukulele, Alarm Clock, Adjustable Wrench,
Combination Wrench, Bolt Cutters, Bench Vice, Power Drill, American Football,
Wet Floor Sign, All-Purpose Cleaner, Cheese Box, Cash Register, Coffee Cart,
Chemistry Set, Circuit Board, Classic Laptop, Ammo Box, Cardboard Box, Barrel
Stove, and three barrels.

Individual asset authors are credited in the `SOURCE.md` shipped inside each
downloaded pack folder.

---

## ambientCG — https://ambientcg.com

PBR ground and surface materials at 1K: `Rock063`, `Ground054`, `Ground103`,
`Concrete034`, `Concrete046`, `Asphalt025C`, `Metal046B`, `Metal049A`,
`Metal055A`, `Tiles139`.

---

## Mirrors

The fetch script pulls from these public CC0 mirrors rather than scraping the
original sites:

- `Tiddybub/3d-assets` — curated CC0 library (Kenney, Poly Haven, ambientCG)
- `trebeljahr/quaternius-showcase` — Quaternius packs
- `511action/descent-3d-assets` — Quaternius Ultimate Monsters
- `Daarko/sparkstream-sounds` — Kenney audio packs, converted to WAV

---

## Code

Third-party runtime dependencies:

- **[three.js](https://threejs.org)** — MIT
- **[ws](https://github.com/websockets/ws)** — MIT

DEEPHAUL's own source is MIT licensed. It is an original game inspired by the
design of *Lethal Company* by Zeekerss; no assets, code or content from that
game are used here.
