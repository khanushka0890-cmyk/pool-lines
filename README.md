# Pool Lines

Interactive pool table for learning aiming systems. The table is drawn in real inches at the
regulation 2:1 playing-surface ratio (7 ft, 8 ft, 8 ft Pro, 9 ft).

Tabs:

- **Diamond system** — Corner-5: 3rd rail = cue number − 1st-rail number. Aim at a diamond, or pick a 3rd-rail target and it solves the aim. 4th leg follows your table's benchmark (5→2 or 5→3 to the corner).
- **Spot on the wall** — 1- and 2-rail mirror spots (exact), and the 3-rail Corner-5 spot ~1 table width past the first rail where all corner tracks converge.
- **Reference lines** — Sixes: diamond separation + 4th-rail diamond = 6 (6 → corner). Past 6, the house benchmark 7 → ½ diamond up the short rail.
- **Spin & speed** — drag the cue-tip dot and the speed handle; the shot is physically simulated until the ball drops or stops (`js/physics.js`).

Sources: Dr. Dave Alciatore, Billiards Digest Nov 2010 – Feb 2011 and Mar 2023; Patrick Johnson's Sixes System (AZBilliards "3-Rail Kick Tracks").

No build step. Plain HTML + ES modules.

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Geometry: `js/geometry.js` · systems: `js/systems.js` · physics: `js/physics.js` · UI: `js/app.js`.
