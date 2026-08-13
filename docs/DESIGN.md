# Design notes

Why the systems are shaped the way they are. Written down mostly so that future
changes do not quietly dismantle the thing that makes the game work.

## The one sentence

> Go somewhere dangerous with your friends, find valuable junk, become
> increasingly greedy, realise you've stayed too long, panic on the way back,
> lose half the crew in some ridiculous disaster, somehow escape with the loot,
> sell it to an uncaring corporation, and then willingly do it again somewhere
> worse.

Everything below exists to serve that sentence. When a mechanic was ambiguous,
the tiebreaker was always: *does this produce a decision the crew will argue
about out loud?*

## Greed has to be physical

Finding the scrap is not the game. Carrying it is.

- Weight reduces speed on a quadratic curve and multiplies stamina drain.
  At 55 kg you are down to a quarter speed, and everything on the moon is
  faster than that.
- Big pieces are two-handed: no torch, no shovel, no ladder, no stun charge.
  The most valuable objects in the game are the ones that strip you of every
  tool you brought.
- Dropping happens in the world, not into a menu. Piles accumulate by the
  entrance. Piles are also exactly where the Hoarder goes shopping.
- Only cargo physically inside the hull at launch is scored. Not "in the
  landing zone", not "next to the ramp". Inside.

This is the difference between a looting game and a hauling game. Value on the
floor is not value; value aboard is value.

## Information has to be incomplete

The horror is not the monsters, it is not knowing.

- The ship monitor is deliberately bad: positions lag by 0.6 s, indoor fixes
  scatter by metres, range degrades, and a solar flare destroys it entirely.
  The operator has *useful* information, never *sufficient* information.
- Unlit rooms are genuinely black. The facility generator gives most rooms no
  working power at all, and the breaker that fixes it is somewhere in the middle
  of the map.
- The fauna record fills in a lore entry on first sighting, and only appends the
  practical field note after that creature has killed a crew member. You learn
  what a Weaver is by watching one, and you learn what to do about it by
  watching a colleague fail to.
- Nothing is tutorialised. The first Tallow you meet, you will run from, and it
  will kill you, because running is exactly wrong.

## No two creatures may be solved the same way

The failure mode for a monster roster is sixteen variations of "it sees you and
chases". Each brain here asks a different question:

| Question the creature asks | Creature |
|---|---|
| How many of you are there? | Gnashling, Brinehound |
| Are you looking up? | Latchbug |
| Are you in *its* room? | Sifter |
| Do you want your scrap back? | Hoarder |
| How much noise are you making? | Tallow, Colossus |
| Did you count the doors? | Mimic |
| Do you trust your crewmate's voice? | Choirman |
| Can you hold still? | Weaver |
| Did you wander off alone? | Brinehound |
| Do you have to use this corridor? | Quarryman |
| Are you sure that's a body? | Hollow |
| Are you carrying something? | Nightbriar |
| Can you walk past without panicking? | Drifter |
| Did you leave early enough? | Scur, Hauler |
| Is that light real? | Lumen |

Several of them are barely hostile. The Drifter is a herbivore, and it will
still kill more employees than anything else on the roster because a startled
four-tonne animal in a fog bank does not need to be malicious.

## Comedy is a systems property

No jokes are written into the game. The funny moments are all consequences:

- Noisy scrap. The alarm clock is set for 4:40 and it is still armed. The
  megaphone squeals on a two-minute cycle. These fire while you are carrying
  them, at your position, and a Tallow is listening.
- The Hoarder does not attack you. It walks up to the pile by the fire exit,
  picks up your best find, and leaves with it.
- The ship leaves on a timer and doors are physical objects, so two people can
  and will shut a bulkhead on the third.
- The lift harness exists and costs 380 credits.
- Physics on dropped items means the panic drop that saves your life also
  smashes the chemistry set.

## Risk versus reward, everywhere

Every system was given a knob that can be turned against you:

- **Route cost.** Reaching the good moons costs credits that could have been
  equipment. Obelis costs 400 — roughly three quotas early on.
- **Buy rate.** The Company's rate drifts daily with a house edge. A perfect haul
  sold on a 40% day is a bad day.
- **Weather.** Hazard weather multiplies scrap value. Eclipse pays 1.6× and
  triples the outdoor creature budget.
- **Depth.** Loot value scales with distance from the entrance and depth below
  ground. The best scrap is always the furthest from the door.
- **Death.** Deaths cut the sale by 20% each. Recovering the body cuts it to 5%.
  So the body is worth going back for, and going back for it is how the second
  person dies.
- **Time.** The day clock ramps the spawn budget continuously. Every extra trip
  is measurably worse than the last one.

## Sound before sight

The player should hear things before seeing them, so the audio had to be
generative rather than a library of loops:

- Facility ambience is synthesised: rumble, an electrical hum gated on the
  breaker state, ventilation on wandering band-pass filters. Turn the power on
  and the room's tone changes.
- Punctuation events (pipe knocks, drips, creaks, arcs) fire on 5–20 second
  gaps, positioned randomly around the listener. Long silences are deliberate.
- Creature calls are generated per creature from timbre parameters — a growl is
  a filtered saw with vibrato, a Latchbug is a burst train, a Colossus is a
  44 Hz sine with noise underneath. The same creature never calls twice
  identically.
- Thunder is delayed by real distance. Explosions deafen you and leave tinnitus.
  Deep water muffles everything.

## Voice is a mechanic, not a feature

Proximity voice attenuates over 26 m. The walkie-talkie bypasses the attenuation
— and broadcasts at your own position, loudly, which every sound-hunting
creature can hear. Shouting into the radio for help is *how you die*, and it is
also the only way to reach the ship.

The Choirman exists specifically to poison this channel.

## Deterministic generation, thin wire

The server sends a 32-bit seed. Both sides run the same generator. A 380-cell,
three-level facility with 480 dressing props and 30 scrap spawns costs four
bytes.

The cost is a hard constraint: `shared/rng.ts` and everything downstream of it
must never change behaviour. `test/facility.test.ts` asserts determinism, and
`test/assets.test.ts` asserts every model reference in the content tables
resolves against the actual fetched catalog — so content can be extended without
the risk of shipping a reference to art that does not exist.

## Collision and AI share one truth

There is no navmesh and no collision mesh. The facility is a cell grid with
per-edge wall and door flags. The player collides against it, the A* walks it,
and line-of-sight raycasts it. A door that is shut blocks pathfinding *and*
sight *and* movement, from the same data.

This is why closing a door behind you actually works, and why a creature can
never reach through the wall you are hiding behind.

## What was deliberately not built

- **Combat depth.** The shovel does 34 damage with an 0.85 s recovery and most
  things have 200+ HP or are flatly unkillable. Weapons exist to buy two seconds,
  not to win.
- **Progression that removes danger.** Every upgrade adds capability, none add
  safety. The teleporter saves the person and destroys everything they carried.
  The scanner finds value and cannot see what is standing next to it.
- **Explanations.** The Company never tells you anything useful. The terminal is
  utilitarian, the tone is bureaucratic, and the story is delivered entirely
  through what the fauna record refuses to say until somebody dies.
