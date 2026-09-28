# Catscape: Lyra's great escape

A pixel-art cinematic platformer that runs in the browser. Lyra, an indoor cat, watches a bird fly away from the bedroom window and sets out across the house to get the hooman to open the big window in the study.

It's a static page in `public/` (`index.html`, `game.js`, `style.css`) with no build step and no dependencies (fonts load from Google Fonts). It is served by Cloudflare Pages at https://catscape.interstellarai.net, with the security headers and CSP in `public/_headers`.

## Play

Open `public/index.html` in a browser, or serve it locally with the production headers applied:

```sh
node tests/serve.mjs 8000   # then open http://localhost:8000
```

Cloudflare Pages setup: connect the repo, framework preset None, no build command, build output directory `public`, production branch `main`.

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
node tests/smoke.cjs                    # the game logic, headless in Node
node tests/browser.mjs [screenshot-dir] # the real page in headless Chrome
```

`smoke.cjs` runs `public/game.js` headlessly in Node (stubbed canvas) and plays the key routes through every puzzle, plus a random-input fuzz of every room.

`browser.mjs` serves `public/` with the `_headers` rules (like Cloudflare Pages) and loads the game in headless Chrome (Node >= 22, `CHROME_BIN` defaults to `google-chrome`). It fails on missing security headers, repo files being served, JS errors, CSP violations, fonts not loading or a blank canvas, and saves `title.png`, `playing.png` and `hint.png`. Pass a URL as the second argument to test a deployment, e.g. a Pages preview.
