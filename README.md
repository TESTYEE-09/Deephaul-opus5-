# DEEPHAUL

**A cooperative first-person horror scavenging game.** You and up to a few
colleagues are contracted labour for the Vantorex Reclamation Group. You fly a
small industrial ship to abandoned moons, walk into facilities nobody has
surveyed in years, fill your arms with valuable junk, and try to get back to the
ship before the things that live there decide you are also salvage.

Then you sell the junk to an uncaring corporation, watch the quota go up, and do
it again somewhere worse.

Runs in a browser. TypeScript + Three.js client, authoritative Node game server,
WebRTC proximity voice. No engine, no binary blobs in the repo — the art and
audio are CC0 assets pulled by a script.

---

## Running it

```bash
git clone https://github.com/TESTYEE-09/Deephaul-opus5-.git
cd Deephaul-opus5-
npm install
node tools/fetch-assets.mjs     # ~170 MB of CC0 art and audio, one time
npm run dev                      # game server + client dev server
```

Open **http://localhost:5180**, enter a name, hit **SIGN CONTRACT**.

To play with other people, everyone joins the same **crew code** and points the
**server** field at the host's machine (`ws://<host-ip>:5181`). Same crew code =
same ship, same quota, same run.

For a single self-contained server:

```bash
npm run serve                    # builds the client and serves it on :5181
```

Other scripts: `npm test` (25 tests, including a scripted full expedition),
`npm run check` (typecheck), `npm run build`.

---

## The loop

**Pick a moon → land → find the facility → fill your hands → get back alive →
sell it → the quota goes up → pick a worse moon.**

Every few in-game days the Company assesses your profit quota. Miss it and the
contract is terminated: run over. Meet it and the quota grows, which eventually
forces you onto moons that will kill you.

The tension is entirely in the decisions that sit inside that loop:

- The good scrap is deep, and deep means far from the door.
- The valuable scrap is heavy, and heavy means slow.
- The ship leaves at nightfall whether you are on it or not.
- Your dead crewmate's body is worth recovering, and it is also 40 kg.
- You could buy a better torch, or you could afford the route to Kessel.

---

## What's in it

### Moons

Seven sites plus the Company depot, each with its own hazard band, yield
multiplier, biome and weather table.

| Site | Cost | Risk | Character |
|---|---|---|---|
| 41-RIDGE | free | ★☆☆☆☆ | Small decommissioned outpost. Where you learn. |
| 13-CINDER | free | ★★☆☆☆ | Burnt processing line under ash flats. |
| 77-HALDEN | 30 | ★★★☆☆ | Full industrial complex, two levels, real yield. |
| 08-VOR | 65 | ★★★☆☆ | Permanent electrical storm. Carrying metal outside is a decision. |
| 52-MARROW | 110 | ★★★★☆ | Tidal basin. The water rises all day. The sublevel does not stay walkable. |
| 90-KESSEL | 210 | ★★★★★ | Deep reclamation. Three levels. Thirty-one percent crew recovery rate. |
| 00-OBELIS | 400 | ★★★★★ | Restricted. Yield uncapped. Nobody has completed a second contract. |

### Weather

Weather is rolled per moon per day and changes how the site plays, not how it
looks:

- **Fog** — visibility under twenty metres.
- **Rain** — soft ground, muffled sound.
- **Electrical storm** — lightning preferentially strikes whoever is carrying
  the most conductive salvage. It is not random.
- **Tidal flooding** — the water table climbs through the day and drowns the low
  ground and the sublevel.
- **Solar flare** — radar and radio are useless. The ship operator is blind.
- **Eclipse** — no daylight cycle, triple the outdoor creature budget, and
  everything outside is already awake.

### Facilities

Procedurally assembled every expedition from a BSP room graph: rooms, corridors,
loops, doorways, powered bulkheads, locked vaults, stairwells to one or two
sublevels, and a generator room whose breaker controls the lights and every
powered door on the site.

Four interior looks (station, factory, mineshaft, sublevel), dressed room by room
from tagged prop palettes — offices get desks and filing, machine rooms get
conveyors and hoppers, maintenance gets pipes and barrels. Hazards include
steam vents, live electrical, crushers, gas leaks and open pits.

Layouts range from ~100 cells on Ridge to ~380 cells across three levels on
Obelis. You will get lost. That is the intent.

### Scrap

95 items with distinct weight, value, size and behaviour. Some are ordinary
industrial junk. Some are a detached toilet, an arcade cabinet, a ukulele, a
preserved cake iced with your name.

Properties that matter:

- **Conductive** — a lightning rod in a storm.
- **Noisy** — the alarm clock is still set for 4:40, and it is still armed.
  Sound-hunting creatures love these.
- **Fragile** — drops and throws destroy value.
- **Explosive** — the marked barrel is worth 104 credits and also a crater.
- **Light-emitting** — a lantern is useful, and it makes you the most visible
  thing in the room.
- **Two-handed** — no equipment, no torch, no ladder. Just you and a washing
  machine, in the dark.

### Creatures

Seventeen creatures, sixteen distinct AI brains. The design rule was that no two
should be solved the same way:

| | |
|---|---|
| **Gnashling** | Pack. Harmless alone. Counts its friends before committing. |
| **Latchbug** | Ambush. Waits on ceilings. Clicks once before it drops. |
| **Sifter** | Territorial. Owns one room and does not care about any other. |
| **Hoarder** | Thief. Takes scrap to a cache. Only violent in defence of it. |
| **Tallow** | Blind sound hunter. Walk. Do not sprint, do not shout into the radio. |
| **Mimic** | Pretends to be a fire exit. Count the doors on the map. |
| **Choirman** | Reproduces crew voices and puts false blips on the radar. |
| **Weaver** | Registers velocity, not shape. Stand completely still. |
| **Brinehound** | Stalker. Holds distance from groups. Takes whoever wandered off. |
| **Quarryman** | Cannot fit through a standard doorway. Owns the main halls and waits. |
| **Hollow** | Adopts the posture of a fallen employee. Bodies do not face the door. |
| **Nightbriar** | Static snare. You cannot pull free alone while carrying anything. |
| **Drifter** | Harmless grazer. Has killed more employees than anything else, none on purpose. |
| **Scur** | Pack. Arrives after sundown and works the ground between you and the ship. |
| **Hauler** | Apex predator. Cannot enter buildings. Owns everything between them. |
| **Lumen** | Emits a light that looks like Company equipment. Walks backwards away from you. |
| **Colossus** | Blind, tracks ground vibration across the whole landing zone. Stop moving. |

Spawning runs on a power budget that ramps through the day and scales with the
moon, the weather and how long you have been greedy.

Nothing is explained to you in-game. The terminal's fauna record fills in a lore
entry the first time you see a creature, and only appends the practical field
note after it has killed somebody.

### Equipment and ship upgrades

Fourteen purchasable items (torch, survey lamp, floodlight, shovel, pry bar, stun
charge, walkie-talkie, lock cutter, hand scanner, extension ladder, descent line,
lift harness, signal flare, decoy chirper) and nine ship modifications
(recovery teleporter, insertion teleporter, signal booster, cargo rack, charging
rack, exterior floodlights, containment tank, ship horn, canteen unit).

Equipment competes with scrap for your four carry slots. Bringing a torch, a
shovel and a walkie means you can carry exactly one piece of salvage.

### The ship operator

Someone can stay aboard and run mission control from the monitor: a coarse,
delayed contact plot of the surface and the facility, crew vitals, remote control
of powered doors by code, the teleporter, and the horn.

Their picture is deliberately bad. Indoor fixes scatter by metres, a solar flare
wrecks it entirely, and a Choirman can put a crewmate's name on a contact that
is not a crewmate.

### Audio

Two sources. CC0 samples for anything percussive and specific — footsteps,
impacts, doors, terminal beeps. Live Web Audio synthesis for everything
continuous: facility rumble, electrical hum gated on the breaker, ventilation,
wind that gusts on incommensurate LFOs, rain, thunder delayed by distance, and
every creature call in the game, generated from per-creature timbre parameters.

Nothing loops, so nothing gives itself away. Long stretches are near-silent on
purpose.

Proximity voice runs over a WebRTC mesh with distance attenuation done in Web
Audio, so the walkie-talkie can bypass it: hold the radio and your voice arrives
at full volume through a deliberately awful band-pass — and also comes out loud
at your own position, for anything nearby that happens to be listening.

---

## Controls

| | |
|---|---|
| WASD | move |
| Shift | sprint (drains stamina, makes noise) |
| Ctrl / C | crouch (quiet, slow, low) |
| Space | jump |
| E | interact / pick up / open door |
| G | drop — hold to throw |
| 1–5, mouse wheel | select slot |
| F | toggle light |
| Left click | use held item |
| V | hold for walkie-talkie |
| T / Enter | chat |
| Tab | crew roster |
| M | ship monitor (aboard ship) |
| Esc | release mouse |

Terminal commands: `HELP`, `MOONS`, `MOON <name>`, `ROUTE <name>`, `LAND`,
`LAUNCH`, `STORE`, `BUY <item>`, `UPGRADES`, `INSTALL <id>`, `SELL`, `QUOTA`,
`CREW`, `CARGO`, `SCAN`, `DOORS`, `<CODE>`, `HORN`, `TP <name>`, `BESTIARY`,
`FILE <name>`, `ABOUT`.

---

## Architecture

```
shared/     deterministic game data and world generation (client + server)
  rng.ts            seeded PRNG, value noise, fbm
  constants.ts      every tuning number
  protocol.ts       the wire format
  content/          moons, weather, scrap, equipment, creatures
  facility/         BSP generator, cell grid, nav graph + A*
  world/            exterior terrain, ship pad, entrance placement
server/     authoritative simulation
  room.ts           run state, expedition lifecycle, message handling
  economy.ts        quota, buy rate, selling, shop
  terminal.ts       the Company terminal
  sim/world.ts      items, doors, hazards, weather, spawning, perception
  sim/brains.ts     sixteen creature behaviours
client/     rendering, input, audio, UI
  render/           scene, facility, exterior, ship, entities
  player/           controller, grid + terrain collision
  audio/            sample engine, synthesis, WebRTC voice
  ui/               HUD, terminal, monitor, settings
tools/      asset fetch pipeline
test/       25 tests
```

**The central decision:** the server sends a seed, never geometry. Both sides run
the identical generator from `shared/`, so a 380-cell three-level facility with
480 props costs four bytes on the wire. If the generator ever drifted between
builds, players would walk through walls that only exist on someone else's
machine — so `shared/rng.ts` is treated as frozen and the determinism is
covered by a test.

**Authority model:** the server owns everything that matters — items, doors,
creatures, health, time, money. Movement is client-side for responsiveness with
a server-side speed clamp; level transitions are exempt, because stepping
through a facility door is a legitimate twenty-kilometre jump between two
coordinate spaces.

**Collision is the cell grid**, not a mesh. The AI navigates the same grid the
player collides against, so a creature can never reach through a wall the player
is hiding behind, and shutting a door genuinely blocks both pathfinding and line
of sight.

---

## Assets

All art and audio are **CC0 1.0** (public domain equivalent). Nothing is
committed to this repository; `tools/fetch-assets.mjs` pulls ~170 MB from
curated public mirrors and writes a catalog the game reads at runtime.

- **[Kenney](https://kenney.nl)** — space station kit, factory kit, cave kit,
  city/industrial, survival kit, graveyard kit, space kit, food kit, mini arcade,
  mini market, and the entire sample library (footsteps, impacts, interface,
  sci-fi).
- **[Quaternius](https://quaternius.com)** — modular sci-fi, dungeon, nature,
  house interior, survival and RPG item packs; animated characters, animals,
  dinosaurs, enemies and mechs.
- **[Poly Haven](https://polyhaven.com)** — photogrammetry hero props (the
  television, the ukulele, the alarm clock, the barrels).
- **[ambientCG](https://ambientcg.com)** — PBR ground and metal materials.

Credit is given because it is the right thing to do, not because the licence
requires it. See [`docs/CREDITS.md`](docs/CREDITS.md) for the full manifest.

The game code in this repository is MIT licensed.

---

## Design notes

Longer write-ups on why things work the way they do:

- [`docs/DESIGN.md`](docs/DESIGN.md) — what makes the loop work, and the specific
  choices made to preserve it
- [`docs/CREDITS.md`](docs/CREDITS.md) — asset provenance

---

*Vantorex Reclamation Group holds recovery rights on four hundred and eleven
decommissioned sites. Crew retention is not a performance metric. Quota
attainment is the only performance metric.*
