# Catscape: Lyra's great escape

A pixel-art cinematic platformer that runs in the browser. Lyra, an indoor cat, watches a bird fly away from the bedroom window and sets out across the house to get the hooman to open the big window in the study.

It's one self-contained `index.html` with no build step and no dependencies (fonts load from Google Fonts).

## Play

Open `index.html` in a browser, or serve the folder with any static server:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

To publish it with GitHub Pages: repo Settings → Pages → Deploy from branch → `main` / root.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | ← → or A D | ◀ ▶ |
| Jump / climb / use doorway | ↑, W, Space or Z | JUMP |
| Swat | X or J | SWAT |
| Drop / meow | ↓ or S | ▼ |
| Lyra's thoughts (hint) | H | Hint button |
| Restart room | R | Restart button |
| Mute | M | Sound button |

Jump at a ledge to grab it, jump again to climb. Bookcases can be climbed shelf by shelf.

## The house

Eight rooms on two floors: Bathroom, Bedroom, Landing and Study upstairs; Kitchen, Hall, Living Room and Office downstairs. Puzzles in one room unlock things in another: pressure plates, a light switch, catnip (double jump), a thermostat, a radiator valve, and one sweaty hooman. Dangers include the Roomba, bath water, a cactus, sparking wires and the kitchen hob. Lyra has nine lives; kibble from the Feed-O-Matic gives them back.

## Tests

```sh
node tests/smoke.cjs
```

Runs the game headlessly in Node (stubbed canvas) and plays the key routes through every puzzle, plus a random-input fuzz of every room.
