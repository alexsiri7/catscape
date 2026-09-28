# Catscape — notes for Claude Code

Static browser game with no build step, served as-is from `public/` by Cloudflare Pages (https://catscape.interstellarai.net):

- `public/index.html`: markup only.
- `public/game.js`: the whole game (the script layout below).
- `public/style.css`: the styles.
- `public/_headers`: the production security headers and CSP (Cloudflare Pages format).
- `public/404.html`, `public/favicon.svg`.

Everything outside `public/` (tests, CI, this file) is never served. No external assets except Google Fonts (Press Start 2P for UI, VT323 for Lyra's thoughts).

Always run `node tests/smoke.cjs` after changes. Add a scenario there when adding a puzzle. For any visual or page change also run `node tests/browser.mjs /tmp/catscape-shots` and look at the screenshots.

## Script layout of `public/game.js` (in order)

1. Canvas setup: the world draws into an off-screen 320×192 canvas (`ctx`), which is scaled onto the visible canvas (`dctx`). Text and Lyra's thought bubble are drawn afterwards on `dctx` at full resolution (`text()` queues, `flushText()` draws; `S` = scale).
2. `ROOMS`: each room is a 20×12 tile map (16px tiles) plus a grid position `gx, gy`. Walking off the left/right edge goes to the neighbour at `gx±1`; an edge is passable where the wall column has `.`. Openings between neighbours must line up (same rows, same floor height).
3. `hintFor(id)`: progress-aware thoughts for the Hint button.
4. World state, `parseRoom`, `enterRoom`, `resetRoom`, `newGame`. Room state (objects, fish, fans, the hooman) persists per room in `world[id]`. Gates and story flags are global.
5. Thoughts: `think`, `thinkOnce(key, …)`, `thinkNow`, `roomThought`. Lyra thinks in cat voice ("hooman", "dat", "iz", "birb"); control instructions go in brackets in plain English.
6. Sprites, audio (WebAudio synth, `SFX`), input (keyboard + touch pad).
7. Collision helpers, particles.
8. Game logic: grabbing/hanging/shimmying, `doPaw` (every swattable thing), plates and gates, hazards and `die(cause)`, `updateStudy` (heat → hooman → window → net), `updatePlay`, `update`.
9. Rendering: tiles, furniture, depth faces (`drawDepth`, fake Prince-of-Persia 2.5D), hazards, doors, windows, the hooman, HUD + minimap, thought bubble, title and win screens.
10. Layout/loop, and a test hook (`globalThis.__CATSCAPE_TEST__`) used only by the tests.

## Map legend

```
#  wall            B bed   S sofa   C bookcase (climbable shelf by shelf)   L dresser/cabinet (not climbable)
F  fridge          U counter        H stool     A bath rim
=  shelf / t table (jump up through, DOWN to drop)
P  start   o box   v vase   r roomba   f fish   n catnip   M feeding robot   m hooman
x/y plates → red gate X / blue gate Y      k light switch → yellow gate K
1–9 doorways (same digit = linked, JUMP to use)
~ bath water   * cactus   e sparking wires (timed)   h hob (timed)   g desk fan (push, swat to toggle)
Z thermostat   R radiator + valve   w bedroom window (bird)   W study window (exit)
```

Every map row must be exactly 20 characters and every map 12 rows.

## Movement reach (important when designing rooms)

- Walk up nothing; single jump clears a 1-tile step and ~2-tile gaps.
- Grab + climb: 2-tile ledges from standing. 3 tiles needs a box underneath or the catnip double jump.
- Double jump (after catnip): 3-tile ledges, longer gaps.
- Bookcases (`C`) can be climbed from the floor, one shelf per JUMP. Use `L` for tall furniture that must stay out of reach.

## Progression

Bedroom (bird) → Bathroom: basket into bath as stepping stone, bottle onto blue plate → opens gate Y in the Office.
Kitchen: vase onto red plates → pantry → catnip (double jump).
Living Room: double jump to the switch → opens gate K on the Landing; gap up top-right → Office.
Office: swat the fan off, climb cabinet + bookcase → thermostat (heating on).
Study (through gate K): swat radiator valve → heat builds → hooman sweats, opens window → swat mosquito net 5× → jump out.
