# Pool Lines

Interactive pool table for learning aiming systems. The table is drawn in real inches at the
regulation 2:1 playing-surface ratio (7 ft, 8 ft, 8 ft Pro, 9 ft).

Tabs:

- **Diamond system**: drag the cue ball and the first-rail aim point; see where the ball lands on every rail, in diamonds.
- **Spot on the wall**: mirror a target (object ball or pocket) behind one or two rails and bank straight at it.
- **Reference lines**: tap diamond → diamond to see the line the ball follows through the next rails.
- **Side spin**: the same shot with left/right english and speed (simplified cushion model).

No build step. Plain HTML + ES modules.

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Geometry lives in `js/geometry.js`, UI in `js/app.js`.
