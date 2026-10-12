# Wonderglobe

A small, explorable planet where a child's drawings become its inhabitants.

You draw something (or upload a photo of a drawing). The game keeps your exact picture, cuts it out like paper and works out how it should behave. It then drops it onto the planet, where it swims, flies, grows or folds itself into a little paper house. Everything is saved in the browser, so it's all still there when you come back.

There are two worlds, and each has its own save:

- **Living Paper World:** a diorama planet made of paper cut-outs. Your drawings become animals, plants, vehicles, buildings and imaginary creatures.
- **Miniature Gallery World:** a colourful planet built from outlined 3D shapes. Your pictures hang on wooden easels with a title, an artist, a story and sticky notes, and little visitors come over to look.

![Living Paper World](docs/screenshots/paper-garden.jpg)

## Living world

- **Day, night and weather.**
  - A gentle day/night cycle of about 12 minutes; Settings can switch it to the real clock or "always day". Sunsets glow, and night brings a paper moon, stars, fireflies, glowing lamps and windows.
  - Clouds drift, it sometimes rains (tap a cloud to make it rain right there), and a rainbow follows the rain. It snows on the mountain.
  - The season follows the real date: spring petals, summer green, autumn leaves, a snowy winter.
- **Water.** Shallow shores, foam, paper waves at the coast, and ripples when things splash or you tap the water.
- **Sound.** Every region has its own soundscape (frogs at the ponds, birdsong in the forest, waves at the coast, crickets at night). The music changes instrument and mood by region and time of day, and footsteps change with the ground.
- **Creations with personalities.** Some are friendly, shy or curious when you walk near. They play together, birds land on trees and roofs, people pop into drawn houses, creatures gather in the evening and sleep at night.
  - Tap one to pat it. Shake the planet view to make everything jump.
- **Arrivals.** New drawings fly in as paper planes printed with the drawing. Then houses pop up like a pop-up book, plants sprout and stretch, and fish dive in with a splash.
- **Rides.** Hop on a flying creation for a scenic flight over the mountain, or on a swimmer for a boat ride.
- **Bridges.** Draw a bridge to walk across a pond.
- **Growth.** Plants grow bigger over days, and lived-in houses glow at night.
- **Shelly the paper snail.** She guides first-time players (draw yourself, then your first creation), offers small quests, and follows you around.
- **Sticker book.** 39 stickers for discovering regions, making things, finding 12 hidden treasures and golden butterflies, and riding up to the summit star.
- **Postcards and storybook.** The postcard camera makes crayon-framed postcards you can save. "My storybook" turns your planet into a printable picture book.
- **Gallery opening.** In the gallery, each newly hung picture gets a ribbon to cut, with confetti and cheering visitors.

- **A paper-craft diorama.**
  - Scenery is drawn in a child's crayon style, with several versions of common pieces.
  - Plants are cut-out cards slotted together in an X, buildings are folded paper houses, and every piece stands on a cardboard stand.
  - Cards bow slightly, card backs are plain paper, and copies vary in colour. There are about 1,400 pieces, including flower carpets.
  - The sun casts real shadows shaped like each cut-out; they move with the paper and grow long at dusk.
- **Stop-motion paper puppets.** Creatures, the player, Shelly and visitors move with held poses, rock and hop, and flip edge-on when they turn around.
- **A hand-cut gallery world.** Faceted shapes with wobbly corners and per-face shading, plus thousands of tiny flowers in beds.
- **In-world touches.**
  - Hand-lettered signposts in every region.
  - Labels and a "You" marker in the planet view.
  - A scan-and-scissors cut-out show.
  - A living planet on the title screen.
  - Film grain, a vignette, and a handwriting font for notes and the storybook.

![Dusk in the meadow](docs/screenshots/papercraft-dusk-meadow.jpg)

![Night in the garden](docs/screenshots/atmosphere-night-garden.jpg)

Testing URL overrides: `?time=night|dusk|dawn|day`, `?weather=rain|snow|rainbow|cloudy|clear`, `?season=spring|summer|autumn|winter`.

## Quick start

Requires Node 20+ (tested with Node 22).

```bash
npm install
npm run dev
```

Open http://localhost:3000.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (Next.js + Turbopack) |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Vitest unit tests (image processing, behaviour mapping, simulation, save/restore, import/export, AI routes) |
| `npm run check` | Typecheck, tests and production build together |

### Optional AI services

The game is fully playable **without any credentials**. In that mode:
- the player picks what they drew from a picture menu ("What did you draw?");
- characters answer with simple built-in replies, each labelled "storybook reply" in the chat;
- spoken lines use the device's own speech voice, if it has one;
- animal sounds are small synthesised blips.

To turn the real services on, copy `.env.example` to `.env.local` and fill in what you have:

| Variable | Enables |
| --- | --- |
| `ANTHROPIC_API_KEY` | Drawing recognition (vision) and in-character dialogue via Claude |
| `WONDERGLOBE_CLAUDE_MODEL` | Model id, default `claude-opus-5-5` (requests use low effort for snappy replies) |
| `WONDERGLOBE_CLAUDE_FALLBACKS=off` | Turns off Claude's server-side refusal fallbacks, which are on by default for supported models |
| `ELEVENLABS_API_KEY` | Character voices (TTS), generated animal sounds, microphone speech-to-text |
| `ELEVENLABS_VOICE_IDS`, `ELEVENLABS_VOICE_IDS_{SMALL,BIG,BRIGHT,CALM,SILLY}` | Voice pools; each character always gets the same voice (hash of its id) |
| `ELEVENLABS_TTS_MODEL` | TTS model, default `eleven_flash_v2_5` |

All keys are read only by the server route handlers under `app/api/*`. None of them is `NEXT_PUBLIC_`. A production build was grepped for key names and provider hosts, and no client chunk contains them. `GET /api/status` tells the client which helpers are available, as booleans only. The Settings panel shows the same thing in plain language.

## Architecture

```
app/                     Next.js App Router: page shell, global CSS, API routes
  api/status|recognize|chat|speak|sound|transcribe
src/core/                Shared types and the kind table (kind → behaviour, size, speed, voice, sound)
src/world/               Simulation (no rendering): sphere math, planet & regions, seeded scenery,
                         collision grid, behaviour systems, player controller, WorldRuntime
src/render/              React Three Fiber: planet, water, sky, instanced paper scenery,
                         outlined gallery shapes, creations, easels, player, camera rig, input
src/drawing/             Image processing (pure functions + Web Worker + browser client)
src/art/                 Original procedural crayon art: scenery atlas, samples, player, sky, textures
src/persistence/         IndexedDB (artworks & worlds), preferences, repair, export/import
src/ai/                  Browser-side service clients, local replies, names, microphone
src/server/              Server-side providers (Claude, ElevenLabs), limits, validation
src/audio/               Web Audio engine, generative music, sound effects, speech channel
src/state/               Zustand store: screens, panels, saved records, autosave wiring
src/game/                Progress: stickers, quests, treasures, Shelly the guide, storybook text
src/ui/                  Paper UI: title, HUD, drawing board, upload & correction, "bring to life",
                         artwork panel + chat, gallery panels, collection, settings, help
tests/                   Vitest suites
```

These are the design points that matter most.

**Movement on a real sphere.** Every entity stores a unit surface normal `n` and a tangent heading `t`. Moving rotates both along a great circle. Turning rotates `t` around `n`. The camera's forward direction is parallel-transported with the player. Nothing uses latitude or longitude, so nothing flips or drifts near the poles; tests cover full laps and walking over a pole.

**Simulation outside React.** `WorldRuntime` steps the player, creations, ambient animals and gallery visitors. Frame deltas are clamped, which also handles a backgrounded tab safely. Far-away entities update every fourth frame. React only re-renders on discrete changes such as adding or removing a creation or opening a panel.

**Rendering.**
- **Paper scenery:** about 600–700 seeded cut-outs from a single texture atlas, drawn in one instanced call. A shader turns each one to face the camera, makes it sway, and dithers it away when it stands between the camera and the player or the camera's focus point.
- **Gallery scenery:** instanced toon shapes with inverted-hull ink outlines, grouped into one batch per primitive.
- **Drawn creations:** these are real geometry. The traced silhouette is extruded into a thin card, both faces carry the drawing, and the edge is white paper. A vertex shader adds body waves (swimmers), wing folds (fliers and flutterers) and paper curl (walking and swaying).

**Drawings become buildings.** The drawing is used for the front and back walls. Side walls and a folded two-panel roof are added between them. Their size comes from the silhouette (where the roof line sits and how wide the walls are), and their colours come from the drawing's own palette. The building folds up when it is placed.

### Drawing → cut-out pipeline (`src/drawing/process.ts`, runs in a Web Worker)

1. Keep the original pixels.
2. Find the ink bounds and work at a bounded resolution.
3. Close small gaps in outlines (morphological closing).
4. Fill enclosed areas; empty space inside becomes white paper.
5. Remove isolated specks (connected components).
6. Build a transparent cut-out with a white paper border and a thin dark cut line.
7. Trace the outline (marching squares) and simplify it with Douglas–Peucker.
8. Work out the anchor point, aspect ratio, palette and roof line.
9. Save both PNGs and the metadata to IndexedDB.

Uploads go through the same pipeline after background removal.
- **Transparent PNGs** use their own alpha channel.
- **Photos of drawings** use a border-sampled background estimate with lighting normalisation. By default only background connected to the edges is removed (edge flood).
- **Confidence** is measured from how even the border is, how much of the picture is foreground, how many separate pieces there are, and whether the drawing touches the edges.

When confidence is low, the correction flow opens: crop handles, a background-removal strength slider, keep/remove brushes, and "keep the whole picture". Artwork identity is a SHA-256 of the decoded pixels and never uses the filename, so the same picture uploaded under two names becomes the same artwork with an identical cut-out. Sample drawings are always labelled "Sample" and go through the same pipeline.

## What was verified

**Automated (`npm test`, 255 tests).** These now also cover:
- the environment logic;
- sound logic (against a strict fake Web Audio);
- creature social life, rides that land safely, and bridges that make only their deck walkable;
- a flying ride passing within reach of the summit star;
- quests, stickers and treasure placement;
- the new save fields.

The original areas are still covered:
- Image processing: gap closing, filling, speck removal, outline and border, tracing, roof line, uploads (white paper, transparent PNG, busy background, crop, paint masks, whole picture), and identical results for identical pixels.
- The kind → behaviour table.
- Sphere movement invariants.
- Scenery determinism.
- Restoring and repairing saved worlds, placement rules, and a 1500-frame simulation that never leaves its habitat or produces NaN.
- Persistence and repair.
- Export/import round trip plus every rejection case.
- AI request and response validation, the offline routes, and voice selection.

**In the browser**, in both the dev server and a production `next start`, with no credentials configured:

1. A new visitor chooses either world from the title screen and starts playing.
2. A drawn fish keeps its strokes and colours. The real cut line is animated, the manual picker offers Fish, and the fish then swims in Lily Pond. The player hops over to watch it arrive.
3. A drawn house becomes a folded paper building with walls and a roof.
4. An upload named `IMG_0001.png` (a "photo" on uneven paper) has its background removed and keeps its own pixels.
5. The same file uploaded again as `fish.png` gives the same artwork id and identical cut-out metadata. Nothing is inferred from the name.
6. Without credentials the "What did you draw?" flow appears. `/api/recognize` returns `503 unavailable`.
7. With recognition forced on and failing, the drawing was already saved and the picker still works.
8. Creations open by tap (original, cut-out, name, chat, remove). They can be carried by press-and-drag; dropping a house on the pond is refused with a message, and a valid drop is saved. The collection drawer travels to any creation.
9. After a reload, creations, moved positions, chat history and the player's spot are all restored.
10. Gallery titles, artist, story and sticky notes (shown in the panel and on the easel) persist. Visitors walk over and react.
11. Export, then wipe, then import (and also through the Settings file picker) restores the artwork and the world. Invalid files get a friendly message.
12. With dialogue forced on and failing, the reply comes from the local responder and is labelled "storybook reply". Voice falls back to the device's voice.
13. The desktop layout was checked at 1280×800 and the mobile layout at 375×812: joystick, stacked buttons, portrait drawing paper, a full-width chat box, and no horizontal overflow.
14. `npm run typecheck`, `npm test` and `npm run build` all pass.

Also checked: the whole-planet view and wheel zoom crossing between the two views, the lighter-graphics remount, the calm-motion setting, and that the image worker loads in the production bundle (cut-out in about 160 ms).

**The living-world features in the browser:**
- Onboarding for a new visitor: Shelly's greeting, drawing yourself (which becomes the player), the first creation, and onboarding moving on once it lands.
- Sticker awards.
- Paper-plane arrivals.
- Rides (board, fly over the mountain, return, land on dry ground).
- A bridge spanning Lily Pond.
- Night with rain, and autumn colours.
- The gallery opening ribbon.
- The postcard camera and the storybook.
- An old save migrating cleanly: it was marked as onboarded, and its stickers were back-filled.

## Known limitations

- **Real AI services are untested live.** Recognition, dialogue, ElevenLabs voices, sound generation and speech-to-text were exercised only with stand-in clients in the tests and the "unavailable" path in the browser, because no keys were available here. Request shapes follow the providers' documented APIs. The default ElevenLabs premade voice ids may need updating for your account; set `ELEVENLABS_VOICE_IDS`.
- **Microphone without ElevenLabs** relies on the browser's speech recognition, which works in Chromium and Safari but not Firefox. In Firefox the mic button is hidden.
- **Some text in the 3D view is only readable in panels.** Paper cut-outs face the camera around their up axis. Seen straight from above in the planet view they look like thin cards.
- **Storage depends on the browser.** Worlds and pictures live in this browser's IndexedDB, so clearing site data removes them. Use "Save to a file" in Settings to keep a copy. Very full storage shows a friendly warning and the save is retried, but nothing is evicted automatically.
- **Audio was checked only for errors.** It starts after the first tap or key press. Music and sound effects are synthesised with Web Audio, and their quality wasn't judged by ear in this environment.
- **Pinch zoom and the touch joystick weren't tested on a physical phone.** They are implemented with pointer events and were checked in a mobile-size emulated viewport.
- **Frame rate wasn't measured.** All the living-world effects are instanced and throttled, but frame rate on slow tablets wasn't measured. Use "Lighter graphics" in Settings if it stutters.
- **Spoken guide lines cost voice requests.** Shelly speaks her lines aloud. With ElevenLabs configured, each new line is a voice request; repeated lines are cached.

## Screenshots

| | |
| --- | --- |
| ![Title](docs/screenshots/title.jpg) | ![Drawing board](docs/screenshots/drawing-board.jpg) |
| ![Cut-out reveal](docs/screenshots/cutout-reveal.jpg) | ![What did you draw?](docs/screenshots/what-did-you-draw.jpg) |
| ![Fish in Lily Pond](docs/screenshots/lily-pond-fish.jpg) | ![Paper house](docs/screenshots/paper-house.jpg) |
| ![Planet view](docs/screenshots/planet-view.jpg) | ![Upload cut-out](docs/screenshots/upload.jpg) |
| ![Gallery easel](docs/screenshots/gallery-easel.jpg) | ![Gallery panel](docs/screenshots/gallery-panel.jpg) |
| ![Artwork panel & chat](docs/screenshots/artwork-panel.jpg) | ![Mobile](docs/screenshots/mobile.jpg) |
| ![Shelly onboarding](docs/screenshots/onboarding-shelly.jpg) | ![Paper-plane arrival](docs/screenshots/paper-plane-arrival.jpg) |
| ![Sticker award](docs/screenshots/sticker-award.jpg) | ![Night rain](docs/screenshots/night-rain-garden.jpg) |
| ![Rainbow](docs/screenshots/atmosphere-rainbow.jpg) | ![Winter](docs/screenshots/atmosphere-winter.jpg) |
| ![Spring dusk](docs/screenshots/atmosphere-spring-dusk.jpg) | ![Gallery at night](docs/screenshots/atmosphere-gallery-night.jpg) |
| ![Paper-craft garden](docs/screenshots/papercraft-garden-day.jpg) | ![Hand-cut gallery](docs/screenshots/gallery-handcut-1.jpg) |
| ![Title planet](docs/screenshots/polish-title-planet.jpg) | ![Scissors reveal](docs/screenshots/polish-scissors-reveal.jpg) |
