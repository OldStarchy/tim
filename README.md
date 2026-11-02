# TIM

A modern browser tribute to Sierra's *The Incredible Machine*: drag balls, belts, balloons,
trampolines and teeter-totters onto the board, press **Start**, and watch the contraption go.

**Play:** https://oldstarchy.github.io/tim/

## What's in the prototype

- 12 puzzles plus a **Free Build** sandbox with every part unlimited (shareable via link)
- 33 parts, grouped in the bin:
  - **Balls:** bowling ball, basketball, baseball, super ball, steel ball, beach ball, balloon
  - **Building:** brick wall, wedge, curved ramp, funnel, glass pane, plank, crate, domino, bucket, anvil, hook,
    pulley, and ropes (tie to either end of see-saws and planks, optionally over a pulley)
  - **Contraptions:** trampoline, see-saw, mousetrap, bumper, pin, scissors (cut ropes), fan, magnet, bell, TNT
  - **Power:** electric motor, mouse motor (wakes when bumped), gears (mesh when their teeth touch, and reverse
    direction), conveyor belts (need power), and drive belts to connect them
- Modern controls TIM never had:
  - **Trajectory preview** in Free Build — ghost paths update live while you edit (off in puzzles, it'd give them away)
  - Undo / redo, grid snap (hold <kbd>Alt</kbd> to ignore), duplicate, arrow-key nudging
  - Drag handles to rotate and resize, or <kbd>Q</kbd>/<kbd>E</kbd> and <kbd>-</kbd>/<kbd>=</kbd>
  - Pause, frame-step and ¼×–4× speed while running
  - Progress and your in-progress solutions are saved locally
- Touch-friendly: tap a bin item to drop it, on-screen rotate/flip/delete buttons

Press <kbd>H</kbd> in game for the full controls list.

## Music

Tracks live in `public/music/` and are listed in `TRACKS` in `src/music.ts`. They play as a shuffled
playlist with a 4 s crossfade, so they don't need to loop seamlessly. While you're building, the music
is muffled and a bit quieter, then opens up when you press Start.

To add a track, normalise it and drop the cover art first:

```sh
ffmpeg -i in.mp3 -map 0:a -af "loudnorm=I=-20:TP=-2:LRA=7" -ar 44100 -b:a 128k -map_metadata -1 public/music/name.mp3
```

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # every puzzle's reference solution is simulated and must win
npm run build
```

Physics is [planck.js](https://github.com/piqnt/planck.js) (a Box2D port) stepped at a fixed 120 Hz,
so a given contraption always plays out the same way — that's what makes the preview and the
solution tests trustworthy.

| File | What |
| --- | --- |
| `src/model.ts` | Plain-JSON scene/level types |
| `src/partkit.ts` | Part definition types and shared drawing/physics helpers |
| `src/parts.ts` | The original parts + the part catalog / bin order |
| `src/parts-more.ts` | Power train, gadgets and the newer building parts |
| `src/sim.ts` | World wrapper: power propagation, contact hooks, explosions, rope cutting, goals |
| `src/levels.ts` | Puzzles, each with a reference solution |
| `src/game.ts` | Editor, input, run loop, UI |
| `src/render.ts` | Board, ropes, trails, selection drawing |

### Adding a puzzle

Add an entry to `LEVELS` in `src/levels.ts`: locked parts in `scene`, the player's allowance in `bin`,
`goals`, and a `solution`. `npm test` checks that the solution wins, doesn't overlap anything, and only
uses parts from the bin.

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`.
