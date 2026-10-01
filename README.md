# Pool Lines

Interactive pool table for learning aiming systems. The table is drawn in real inches at the
regulation 2:1 playing-surface ratio (7 ft, 8 ft, 8 ft Pro, 9 ft).

Tabs:

- **Diamond system** — pick 1–6 rails. 1: through-diamond rolling-ball 2-to-1 (with Dr. Dave's large-angle correction). 2: Plus system (origin + short-rail number). 3: Corner-5 (D − F = T). 4: Corner-5 + 4th-rail track. 5–6: the 4-rail track continued at equal angles (no published system). "Kick at a ball" solves the aim. All lines are sighted through the diamonds.
- **Spot on the wall** — 1- and 2-rail mirror spots (exact), and the 3-rail Corner-5 spot ~1 table width past the first rail where all corner tracks converge.
- **Reference lines** — Sixes: diamond separation + 4th-rail diamond = 6 (6 → corner). Past 6, the house benchmark 7 → ½ diamond up the short rail.
- **Spin & speed** — drag the cue-tip dot and the speed handle; the shot is physically simulated until the ball drops or stops (`js/physics.js`).

Sources: Dr. Dave Alciatore, Billiards Digest May 2010 – Feb 2011, Mar 2023, Jan 2024; Dead Aim, "Kicking Academy"; Patrick Johnson's Sixes System (AZBilliards "3-Rail Kick Tracks").

No build step. Plain HTML + ES modules.

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Geometry: `js/geometry.js` · systems: `js/systems.js` · physics: `js/physics.js` · UI: `js/app.js`.
