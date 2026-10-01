// Table geometry and ball-path math. All units are inches.
// Origin is the top-left corner of the playing surface (cushion nose), y points down.

export const BALL_R = 1.125; // 2 1/4" ball

// Playing-surface sizes (cushion nose to cushion nose). Every regulation table is 2:1.
export const TABLES = {
  '7ft': { label: '7 ft (bar box)', w: 78, h: 39 },
  '8ft': { label: '8 ft', w: 88, h: 44 },
  '8ftPro': { label: '8 ft Pro', w: 92, h: 46 },
  '9ft': { label: '9 ft (tournament)', w: 100, h: 50 },
};

export const CUSHION = 2;     // cushion width from nose to rail wood
export const RAIL = 4.5;      // wooden rail width
export const DIAMOND_INSET = CUSHION + 1.9; // diamonds sit on the rail, measured from the nose

// Pocket capture along the cushion, measured from the corner / side-pocket centre (ball centre track)
const CORNER_ZONE = 3.6;
const SIDE_ZONE = 2.6;

export const RAILS = ['top', 'right', 'bottom', 'left'];

export function makeTable(sizeKey) {
  const { w, h, label } = TABLES[sizeKey];
  return { w, h, label, key: sizeKey };
}

export function pockets(t) {
  return [
    { x: 0, y: 0, kind: 'corner' }, { x: t.w / 2, y: 0, kind: 'side' }, { x: t.w, y: 0, kind: 'corner' },
    { x: 0, y: t.h, kind: 'corner' }, { x: t.w / 2, y: t.h, kind: 'side' }, { x: t.w, y: t.h, kind: 'corner' },
  ];
}

// Diamonds: 7 per long rail (the side pocket replaces the middle one), 3 per short rail.
// Each diamond gets a rail-relative index measured in diamonds from the left / top corner.
export function diamonds(t) {
  const out = [];
  const dx = t.w / 8, dy = t.h / 4;
  for (let i = 1; i <= 7; i++) {
    if (i === 4) continue;
    out.push({ rail: 'top', n: i, x: i * dx, y: 0 });
    out.push({ rail: 'bottom', n: i, x: i * dx, y: t.h });
  }
  for (let i = 1; i <= 3; i++) {
    out.push({ rail: 'left', n: i, x: 0, y: i * dy });
    out.push({ rail: 'right', n: i, x: t.w, y: i * dy });
  }
  return out;
}

// Point on the rail (cushion nose) at a diamond position along that rail.
export function railPoint(t, rail, n) {
  const dx = t.w / 8, dy = t.h / 4;
  switch (rail) {
    case 'top': return { x: n * dx, y: 0 };
    case 'bottom': return { x: n * dx, y: t.h };
    case 'left': return { x: 0, y: n * dy };
    case 'right': return { x: t.w, y: n * dy };
  }
}

// Where the ball centre is when it touches a given rail at diamond n.
export function trackPoint(t, rail, n) {
  const p = railPoint(t, rail, n);
  const R = BALL_R;
  return {
    x: Math.min(Math.max(p.x, R), t.w - R),
    y: Math.min(Math.max(p.y, R), t.h - R),
  };
}

// Diamond reading of a track point on a rail.
export function diamondOf(t, rail, p) {
  return (rail === 'top' || rail === 'bottom') ? p.x / (t.w / 8) : p.y / (t.h / 4);
}

export function fmtDiamond(v) {
  return (Math.round(v * 4) / 4).toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
}

const INWARD = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export function pocketedAt(t, rail, p) {
  const along = (rail === 'top' || rail === 'bottom') ? p.x : p.y;
  const len = (rail === 'top' || rail === 'bottom') ? t.w : t.h;
  if (along < CORNER_ZONE || along > len - CORNER_ZONE) return true;
  if ((rail === 'top' || rail === 'bottom') && Math.abs(p.x - t.w / 2) < SIDE_ZONE) return true;
  return false;
}

export function nearestPocket(t, p) {
  let best = null, bd = Infinity;
  for (const k of pockets(t)) {
    const d = Math.hypot(k.x - p.x, k.y - p.y);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/**
 * Trace the ball-centre path from `start` in direction `dir` for up to `maxRails` cushion contacts.
 * opts.english: side spin in tips, -3 (full left) .. +3 (full right). 0 = mirror reflection.
 * opts.speed:   1 (slow) .. 5 (hard). Slower balls take more spin off the rail.
 * Returns { points: [{x,y,rail?,diamond?}], pocket: pocket|null }.
 */
export function trace(t, start, dir, maxRails, opts = {}) {
  const R = BALL_R;
  const minX = R, maxX = t.w - R, minY = R, maxY = t.h - R;
  let p = { x: start.x, y: start.y };
  let len = Math.hypot(dir.x, dir.y) || 1;
  let v = { x: dir.x / len, y: dir.y / len };
  let spin = (opts.english || 0) / 3;         // -1 .. 1
  const speed = opts.speed || 3;
  const spinGain = 0.42 * (1.25 - speed * 0.1); // how much side spin bends the rebound
  const points = [{ ...p }];

  for (let i = 0; i < maxRails; i++) {
    let tHit = Infinity, rail = null;
    if (v.x > 1e-9) { const s = (maxX - p.x) / v.x; if (s < tHit) { tHit = s; rail = 'right'; } }
    if (v.x < -1e-9) { const s = (minX - p.x) / v.x; if (s < tHit) { tHit = s; rail = 'left'; } }
    if (v.y > 1e-9) { const s = (maxY - p.y) / v.y; if (s < tHit) { tHit = s; rail = 'bottom'; } }
    if (v.y < -1e-9) { const s = (minY - p.y) / v.y; if (s < tHit) { tHit = s; rail = 'top'; } }
    if (!rail) break;
    p = { x: p.x + v.x * tHit, y: p.y + v.y * tHit };

    if (pocketedAt(t, rail, p)) {
      const k = nearestPocket(t, p);
      points.push({ ...p });
      points.push({ x: k.x, y: k.y, pocket: true });
      return { points, pocket: k };
    }
    points.push({ ...p, rail, diamond: diamondOf(t, rail, p) });

    // Reflect. n = unit normal pointing into the rail.
    const n = INWARD[rail];
    const vn = v.x * n.x + v.y * n.y;              // > 0 (moving into rail)
    let out = { x: v.x - 2 * vn * n.x, y: v.y - 2 * vn * n.y };
    if (spin) {
      // Cushion friction acting on a spinning ball pushes it along the rail.
      // Right english (spin > 0) pushes toward the shooter's right on a head-on hit, i.e. it
      // "runs" when the ball continues to the right and "reverses" when it comes back left.
      const push = { x: -n.y * spin, y: n.x * spin };
      out = { x: out.x + push.x * spinGain * vn, y: out.y + push.y * spinGain * vn };
      spin *= 0.55; // the cushion takes most of the spin off
    }
    len = Math.hypot(out.x, out.y);
    v = { x: out.x / len, y: out.y / len };
  }
  // Roll on a bit past the last rail so the final leg is visible.
  const tail = Math.min(t.w, 30);
  let s = tail;
  if (v.x > 0) s = Math.min(s, (maxX - p.x) / v.x);
  if (v.x < 0) s = Math.min(s, (minX - p.x) / v.x);
  if (v.y > 0) s = Math.min(s, (maxY - p.y) / v.y);
  if (v.y < 0) s = Math.min(s, (minY - p.y) / v.y);
  points.push({ x: p.x + v.x * s, y: p.y + v.y * s, end: true });
  return { points, pocket: null };
}

// Mirror a point across a rail's ball-centre track line ("spot on the wall").
export function mirror(t, rail, p) {
  const R = BALL_R;
  switch (rail) {
    case 'top': return { x: p.x, y: 2 * R - p.y };
    case 'bottom': return { x: p.x, y: 2 * (t.h - R) - p.y };
    case 'left': return { x: 2 * R - p.x, y: p.y };
    case 'right': return { x: 2 * (t.w - R) - p.x, y: p.y };
  }
}

export function clampToCloth(t, p) {
  const R = BALL_R;
  return { x: Math.min(Math.max(p.x, R), t.w - R), y: Math.min(Math.max(p.y, R), t.h - R) };
}

// Snap any point to the nearest spot on the ball-centre track, returning rail + diamond.
export function snapToTrack(t, p, step = 0.25) {
  const R = BALL_R;
  const cands = [
    { rail: 'top', d: Math.abs(p.y - R) },
    { rail: 'bottom', d: Math.abs(p.y - (t.h - R)) },
    { rail: 'left', d: Math.abs(p.x - R) },
    { rail: 'right', d: Math.abs(p.x - (t.w - R)) },
  ].sort((a, b) => a.d - b.d);
  const rail = cands[0].rail;
  const long = rail === 'top' || rail === 'bottom';
  let n = long ? p.x / (t.w / 8) : p.y / (t.h / 4);
  n = Math.round(n / step) * step;
  n = Math.min(Math.max(n, step), long ? 8 - step : 4 - step);
  return { rail, n, ...trackPoint(t, rail, n) };
}
