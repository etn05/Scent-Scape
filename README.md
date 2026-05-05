## What's inside

- `index.html` — page shell, HUD, styles, and the hover label
- `main.js` — the whole scene: lights, procedural objects, third-person firefly controller, hover interaction, bloom + vignette post-processing

No build step, no frameworks, no external 3D assets — every object (stump, logs, mushrooms, ferns, rocks, grass, flowers, floating island) is built in code.

## Run it

Because this uses ES modules + an import map pulling `three` from a CDN, it needs to be served over HTTP (opening `index.html` from the file system will be blocked by CORS).

Any tiny static server works. The simplest:

```bash
npx serve .
```

or

```bash
python3 -m http.server 8000
```

Then open the printed URL (e.g. `http://localhost:3000` or `http://localhost:8000/index.html`).

First load fetches Three.js from unpkg (~1MB); subsequent loads are cached.

## Controls

| Key       | Action               |
|-----------|----------------------|
| `W` / `↑` | Move forward         |
| `S` / `↓` | Move backward        |
| `A` / `←` | Turn left            |
| `D` / `→` | Turn right           |
| Mouse     | Hover props to reveal their names |

The camera is a lightly-damped third-person follow with a small idle drift, so it always lags softly behind the firefly you control.

## Notes on art direction

- **Lighting** — warm directional "sun" + cool hemisphere fill, PCF-soft shadows with a blurred radius. No pure-black shadow areas.
- **Materials** — MeshStandardMaterial everywhere (roughness ~0.8–0.95), with small per-instance hue/value jitter so nothing feels stamped-out.
- **Composition** — stump as the focal point, logs as supporting mid-scale pieces, rocks and foliage arranged radially to guide the eye in a loop.
- **Motion** — plants sway on independent sin phases, firefly dust drifts, the camera drifts subtly even while idle.
- **Post** — very soft UnrealBloom (strength 0.42, high threshold), plus a gentle shader vignette/warmth pass.

