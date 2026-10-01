import {
  BALL_R, TABLES, CUSHION, RAIL, DIAMOND_INSET, RAILS,
  makeTable, pockets, diamonds, trackPoint, trace, mirror,
  clampToCloth, snapToTrack, fmtDiamond,
} from './geometry.js';
import { simulate, MAX_OFFSET, MPH } from './physics.js';
import {
  lines as sysLines, longPt, shortPt, canonX, sideOf, readOn, clothPath,
  oneRail, plus, corner5, BENCHMARKS, sixesTrack, sixesTarget, corner5Spot, firstRailThrough,
} from './systems.js';

const svg = document.getElementById('table');
const panel = document.getElementById('panel');
const NS = 'http://www.w3.org/2000/svg';
const FRAME = CUSHION + RAIL;

const RAIL_NAMES = { top: 'Top long rail', bottom: 'Bottom long rail', left: 'Left short rail', right: 'Right short rail' };

const state = {
  tab: 'diamond',
  size: '9ft',
  t: makeTable('9ft'),
  numbers: true,
  cue: { x: 82, y: 40 },
  obj: { x: 38, y: 34 },
  bench: 'typical',
  // Diamond systems
  dsRails: 3,             // 1..6
  dsMode: 'aim',          // 'aim' | 'kick'
  oneAim: { side: 'top', n: 2 },
  oneCorrect: true,
  plusAim: { side: 'left', n: 2 },
  c5FirstRail: 'top',
  c5F: 3,
  k: 0.5,                 // short-rail factor for 4th-rail tracks (Sixes 7 → ½ diamond)
  // Spin & speed
  aim: { rail: 'top', n: 3 },
  side: 0,
  vert: 0,
  mph: 4,
  ghost: true,
  // Spot on the wall
  spotMode: 'corner5',    // 'mirror1' | 'mirror2' | 'corner5'
  spotTarget: 'ball',
  spotRails: ['top'],
  spotFirstRail: 'top',
  spotWidths: 1,
  // Reference lines (Sixes)
  refStart: { rail: 'bottom', n: 8 },
  refFirst: { rail: 'top', n: 2 },
  refFamily: true,
};

// ---------- helpers ----------
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const txt = (g, x, y, s, cls) => { const e = el('text', { x, y, class: cls }, g); e.textContent = s; return e; };
const pathD = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
const r2 = (v) => (Math.round(v * 100) / 100).toString();
const r1 = (v) => (Math.round(v * 10) / 10).toString();

function toTable(evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}

function rescale(oldT, newT, p) {
  return { x: p.x * newT.w / oldT.w, y: p.y * newT.h / oldT.h };
}

// ---------- table ----------
function frameBox(t) {
  return { x: -FRAME, y: -FRAME, w: t.w + 2 * FRAME, h: t.h + 2 * FRAME };
}

function drawTable(g, t, showNumbers) {
  const f = frameBox(t);
  el('rect', { x: f.x, y: f.y, width: f.w, height: f.h, rx: 3.5, class: 'wood' }, g);
  el('rect', { x: -CUSHION, y: -CUSHION, width: t.w + 2 * CUSHION, height: t.h + 2 * CUSHION, class: 'cushion' }, g);
  el('rect', { x: 0, y: 0, width: t.w, height: t.h, class: 'cloth' }, g);

  el('line', { x1: t.w / 4, y1: 0, x2: t.w / 4, y2: t.h, class: 'string' }, g);
  el('circle', { cx: t.w / 4, cy: t.h / 2, r: 0.35, class: 'spot' }, g);
  el('circle', { cx: t.w * 3 / 4, cy: t.h / 2, r: 0.35, class: 'spot' }, g);

  for (const p of pockets(t)) {
    const r = p.kind === 'corner' ? 2.6 : 2.7;
    const ox = p.kind === 'corner' ? (p.x === 0 ? -1.2 : 1.2) : 0;
    const oy = p.y === 0 ? -1.2 : 1.2;
    el('circle', { cx: p.x + ox, cy: p.y + (p.kind === 'side' ? oy * 1.1 : oy), r, class: 'pocket' }, g);
  }

  for (const d of diamonds(t)) {
    const off = { top: [0, -DIAMOND_INSET], bottom: [0, DIAMOND_INSET], left: [-DIAMOND_INSET, 0], right: [DIAMOND_INSET, 0] }[d.rail];
    const cx = d.x + off[0], cy = d.y + off[1];
    const s = 0.8;
    const dg = el('g', { class: 'diamond', 'data-rail': d.rail, 'data-n': d.n }, g);
    el('path', { d: `M${cx},${cy - s} L${cx + s * 0.6},${cy} L${cx},${cy + s} L${cx - s * 0.6},${cy} Z` }, dg);
    el('circle', { cx, cy, r: 2.2, class: 'hit' }, dg);
    if (showNumbers) {
      const lo = { top: [0, -2.1], bottom: [0, 2.9], left: [-2.3, 0.6], right: [2.3, 0.6] }[d.rail];
      txt(g, cx + lo[0], cy + lo[1], d.n, 'dnum');
    }
  }
}

// Extra pick targets on the long rails: corner pockets (0, 8) and side pockets (4).
function drawSightPoints(g, t) {
  for (const rail of ['top', 'bottom']) {
    for (const n of [0, 4, 8]) {
      const x = n * t.w / 8, y = rail === 'top' ? 0 : t.h;
      const dg = el('g', { class: 'diamond sightpt', 'data-rail': rail, 'data-n': n }, g);
      el('circle', { cx: x, cy: y, r: 0.7, class: 'sp' }, dg);
      el('circle', { cx: x, cy: y, r: 2.6, class: 'hit' }, dg);
    }
  }
}

function drawBall(g, p, cls, drag) {
  const b = el('g', { class: `ball ${cls}`, ...(drag ? { 'data-drag': drag } : {}) }, g);
  el('circle', { cx: p.x, cy: p.y, r: BALL_R * 2.4, class: 'grab' }, b);
  el('circle', { cx: p.x, cy: p.y, r: BALL_R }, b);
  return b;
}

function drawPath(g, pts, cls) {
  el('path', { d: pathD(pts), class: `path ${cls}` }, g);
}

function drawContacts(g, pts, cls = '') {
  for (const p of pts) {
    if (!p.rail) continue;
    el('circle', { cx: p.x, cy: p.y, r: 0.55, class: `contact ${cls}` }, g);
    const off = { top: [0, 3.2], bottom: [0, -2.3], left: [3, 0.6], right: [-3, 0.6] }[p.rail];
    txt(g, p.x + off[0], p.y + off[1], fmtDiamond(p.diamond), `clabel ${cls}`);
  }
}

function drawAim(g, a, drag = 'aim', cls = '') {
  const m = el('g', { class: `aim ${cls}`, 'data-drag': drag }, g);
  el('circle', { cx: a.x, cy: a.y, r: 2.6, class: 'grab' }, m);
  el('circle', { cx: a.x, cy: a.y, r: 1.0, class: 'ring' }, m);
  el('line', { x1: a.x - 1.6, y1: a.y, x2: a.x + 1.6, y2: a.y, class: 'cross' }, m);
  el('line', { x1: a.x, y1: a.y - 1.6, x2: a.x, y2: a.y + 1.6, class: 'cross' }, m);
}

// ---------- system drawing helpers ----------
const OUT = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

// Number label just outside a diamond-line point.
function railLabel(g, p, side, s, cls, dist = 2.4) {
  const v = OUT[side];
  if (!v) return;
  txt(g, p.x + v[0] * dist, p.y + v[1] * dist + (v[1] === 0 ? 0.6 : v[1] > 0 ? 0.8 : 0), s, cls);
}

// Point on a diamond line from a generic reading (long rails 0..8 from the left, short 0..4 from the top).
function linePt(side, n) {
  const t = state.t, L = sysLines(t);
  return side === 'top' || side === 'bottom' ? { x: n * t.w / 8, y: L[side] } : { x: L[side], y: n * t.h / 4 };
}

// Nearest diamond-line point to the pointer, limited to some sides, snapped to `step` diamonds.
function snapLine(p, sides, step = 0.05) {
  const t = state.t, L = sysLines(t);
  let best = null;
  for (const side of sides) {
    const long = side === 'top' || side === 'bottom';
    const d = long ? Math.abs(p.y - L[side]) : Math.abs(p.x - L[side]);
    if (!best || d < best.d) best = { side, d };
  }
  const long = best.side === 'top' || best.side === 'bottom';
  const max = long ? 8 : 4;
  let n = long ? p.x * 8 / state.t.w : p.y * 4 / state.t.h;
  n = Math.min(max - step, Math.max(step, Math.round(n / step) * step));
  return { side: best.side, n };
}

// Draw a system track: the system line through the diamonds, and the ball's path on the cloth.
function drawSystemTrack(g, pts, sides, cls = 'main', marks = true) {
  const cp = clothPath(state.t, pts);
  el('path', { d: pathD(pts), class: `sysline ${cls}` }, g);
  drawPath(g, cp.path, cls);
  if (marks) {
    for (let i = 1; i < pts.length; i++) el('circle', { cx: pts[i].x, cy: pts[i].y, r: 0.5, class: 'dmark' }, g);
    for (const c of cp.contacts) el('circle', { cx: c.x, cy: c.y, r: 0.45, class: 'contact' }, g);
  }
  if (cp.pocket) el('circle', { cx: cp.pocket.x, cy: cp.pocket.y, r: 1.6, class: 'targetpocket' }, g);
  return cp;
}

const SYSTEMS = {
  1: { name: '2-to-1 through-diamond', sub: 'Rolling cue ball, one rail' },
  2: { name: 'Plus system', sub: 'Two rails, off a short rail' },
  3: { name: 'Corner-5', sub: 'Three rails, off a long rail' },
  4: { name: 'Corner-5 + 4th-rail track', sub: 'Four rails' },
  5: { name: 'Corner-5, continued', sub: 'Five rails' },
  6: { name: 'Corner-5, continued', sub: 'Six rails' },
};

// ---------- Diamond systems ----------
function c5Orient() {
  return { nearTop: state.c5FirstRail === 'bottom', flipX: state.cue.x < state.t.w / 2 };
}

// Track for the current system, for a given aim parameter (generic reading on the aim rail).
function systemTrack(n) {
  const t = state.t, R = state.dsRails;
  if (R === 1) {
    const a = linePt(state.oneAim.side, n);
    const r = oneRail(t, state.cue, a, state.oneAim.side, { correct: state.oneCorrect });
    return { ...r, valid: r.pts.length === 3, legsNeeded: 1 };
  }
  if (R === 2) {
    const S = linePt(state.plusAim.side, n);
    return { ...plus(t, state.cue, S, state.plusAim.side), legsNeeded: 2 };
  }
  const o = c5Orient();
  const F = canonX(t, o, n * t.w / 8);
  return { ...corner5(t, o, state.cue, F, { bench: state.bench, k: state.k, rails: R }), o, legsNeeded: R };
}

// When a system's current aim is impossible from this cue ball, find a sensible one
// (Plus: closest to the 3-through-5 benchmark; others: a valid line near the middle).
function ensureValidAim() {
  const R = state.dsRails;
  if (state.dsMode !== 'aim' || systemTrack(aimReading().n).valid) return;
  if (R === 2) {
    let best = null;
    for (const side of ['left', 'right']) {
      for (let n = 0.1; n < 3.95; n += 0.05) {
        state.plusAim = { side, n };
        const tr = systemTrack(n);
        if (tr.valid && (!best || Math.abs(tr.N - 5) < best.e)) best = { side, n: Math.round(n * 20) / 20, e: Math.abs(tr.N - 5) };
      }
    }
    if (best) state.plusAim = { side: best.side, n: best.n };
  } else if (R === 1) {
    for (const side of ['top', 'bottom', 'left', 'right']) {
      state.oneAim = { side, n: side === 'top' || side === 'bottom' ? 4 : 2 };
      if (systemTrack(aimReading().n).valid) return;
    }
  } else {
    for (let F = 3; F >= 0.5; F -= 0.25) { state.c5F = F; if (systemTrack(aimReading().n).valid) return; }
  }
}

function aimReading() {
  const R = state.dsRails;
  if (R === 1) return { side: state.oneAim.side, n: state.oneAim.n };
  if (R === 2) return { side: state.plusAim.side, n: state.plusAim.n };
  const o = c5Orient();
  const x = longPt(state.t, o, 'far', state.c5F).x;
  return { side: sideOf(o, 'far'), n: x * 8 / state.t.w };
}

// Kick at a ball: scan the aim rail for the line whose final leg passes closest to the object ball.
function solveKick() {
  const R = state.dsRails;
  const { side } = aimReading();
  const max = side === 'top' || side === 'bottom' ? 8 : 4;
  const miss = (n) => {
    const tr = systemTrack(n);
    if (!tr.valid) return Infinity;
    const cp = clothPath(state.t, tr.pts);
    if (cp.pocket && cp.pocketLeg < tr.legsNeeded) return Infinity;
    const leg = cp.legs[tr.legsNeeded];
    if (!leg) return Infinity;
    return segDist(state.obj, leg[0], leg[1]);
  };
  let best = { n: null, d: Infinity };
  for (let n = 0.05; n < max - 0.04; n += 0.02) { const d = miss(n); if (d < best.d) best = { n, d }; }
  if (best.n == null) return null;
  for (let n = best.n - 0.02; n <= best.n + 0.02; n += 0.001) { const d = miss(n); if (d < best.d) best = { n, d }; }
  return best;
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - a.x - dx * u, p.y - a.y - dy * u);
}

function drawC5Scales(g, o) {
  const t = state.t;
  for (let X = 1; X <= 7; X++) {
    railLabel(g, longPt(t, o, 'far', X), sideOf(o, 'far'), X, 'sF', 2.2);
    railLabel(g, longPt(t, o, 'near', X), sideOf(o, 'near'), X, 'sT', 2.2);
  }
  for (const X of [4, 5, 6, 7, 8]) railLabel(g, longPt(t, o, 'near', X), sideOf(o, 'near'), r1(5 - (8 - X) / 2), 'sD', 5.2);
  for (const Y of [1, 2, 3]) railLabel(g, shortPt(t, o, 'shooterEnd', Y), sideOf(o, 'shooterEnd'), 5 + Y, 'sD', 2.4);
}

function drawPlusScales(g, tr) {
  const t = state.t;
  const o = tr.o || { flipX: state.plusAim.side === 'right', nearTop: false };
  for (let N = 1; N <= 7; N++) {
    const p = shortPt(t, o, 'farEnd', 4 - (N - 1) / 2);
    railLabel(g, p, sideOf(o, 'farEnd'), N, N % 2 ? 'sF' : 'sF half', 2.4);
  }
  for (let X = 1; X <= 8; X++) railLabel(g, longPt(t, o, 'near', X), sideOf(o, 'near'), X, 'sD', 2.2);
}

function renderDiamond(g) {
  const t = state.t, R = state.dsRails;
  let kick = null;
  if (!drag) ensureValidAim();
  if (state.dsMode === 'kick') {
    kick = solveKick();
    if (kick) {
      const side = aimReading().side;
      if (R === 1) state.oneAim = { side, n: kick.n };
      else if (R === 2) state.plusAim = { side, n: kick.n };
      else state.c5F = canonX(t, c5Orient(), kick.n * t.w / 8);
    }
  }
  const a = aimReading();
  const tr = systemTrack(a.n);
  let cp = null;

  if (R >= 3) drawC5Scales(g, c5Orient());
  if (R === 2) drawPlusScales(g, tr);

  // aim line extended back through the cue ball (cue number / origin)
  if (R >= 2 && tr.origin) {
    el('line', { x1: tr.origin.x, y1: tr.origin.y, x2: state.cue.x, y2: state.cue.y, class: 'sight' }, g);
    el('circle', { cx: tr.origin.x, cy: tr.origin.y, r: 0.6, class: 'dpt' }, g);
  }
  if (tr.valid) {
    cp = drawSystemTrack(g, tr.pts, tr.sides);
    if (R >= 3) {
      railLabel(g, tr.pts[1], tr.sides[1], r2(tr.F), 'clabel sFl', 4.6);
      railLabel(g, tr.pts[3], tr.sides[3], r2(tr.T), 'clabel sTl', 7.6);
    }
  }
  if (state.dsMode === 'kick') drawBall(g, state.obj, 'obj', 'obj');
  drawAim(g, linePt(a.side, a.n), state.dsMode === 'aim' ? 'sysAim' : 'none');
  drawBall(g, state.cue, 'cue', 'cue');
  return { tr, cp, kick };
}

// ---------- Reference lines: Sixes ----------
function refOrient() {
  const s = state.refStart, f = state.refFirst;
  return { nearTop: s.rail === 'top', flipX: f.n > s.n };
}

function refSolution() {
  const o = refOrient();
  const x0 = o.flipX ? 8 - state.refStart.n : state.refStart.n;
  const s = Math.abs(state.refStart.n - state.refFirst.n);
  return { o, x0, s, tr: sixesTrack(state.t, o, x0, s, state.k), target: sixesTarget(state.t, o, s, state.k) };
}

function renderRef(g) {
  const t = state.t;
  const { o, x0, s, tr, target } = refSolution();
  drawSightPoints(g, t);
  const farSide = sideOf(o, 'far');
  for (let n = 0; n <= 8; n++) {
    const sep = Math.abs(n - state.refStart.n);
    if (!sep) continue;
    railLabel(g, linePt(farSide, n), farSide, sep, `sepnum${sep === s ? ' on' : ''}`, 2.4);
  }
  if (state.refFamily) {
    for (let X = 1; X <= 8; X++) {
      if (X === x0) continue;
      const f = sixesTrack(t, o, X, s, state.k);
      if (f.valid) drawSystemTrack(g, f.pts, null, 'family', false);
    }
  }
  if (tr.valid) {
    drawSystemTrack(g, tr.pts, null, 'main');
    el('circle', { cx: tr.pts[0].x, cy: tr.pts[0].y, r: 0.9, class: 'refstart' }, g);
  }
  const tg = el('g', { class: 'converge' }, g);
  el('circle', { cx: target.pt.x, cy: target.pt.y, r: 2.0, class: 'ring' }, tg);
  el('circle', { cx: target.pt.x, cy: target.pt.y, r: 0.45 }, tg);
  return { s, tr, target };
}

// ---------- Spot on the wall ----------
function spotTargetPoint() {
  if (state.spotTarget === 'ball') return state.obj;
  const k = pockets(state.t)[state.spotTarget];
  return { x: k.x, y: k.y };
}

function trimAtTarget(points, target, stopDist) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / L2));
    const c = { x: a.x + dx * u, y: a.y + dy * u };
    const d = Math.hypot(target.x - c.x, target.y - c.y);
    if (d < 0.05 + (stopDist ? 0 : 0.5)) {
      const back = Math.sqrt(Math.max(stopDist * stopDist - d * d, 0)) / Math.sqrt(L2);
      const s = Math.max(0, u - back);
      return [...points.slice(0, i), { x: a.x + dx * s, y: a.y + dy * s, hit: true }];
    }
  }
  return points;
}

function renderSpotMirror(g) {
  const t = state.t;
  const target = spotTargetPoint();
  const seq = state.spotMode === 'mirror2' ? state.spotRails.slice(0, 2) : state.spotRails.slice(0, 1);
  let m = target;
  const mids = [];
  for (let i = seq.length - 1; i >= 0; i--) { m = mirror(t, seq[i], m); mids.push(m); }
  const spot = m;
  const res = trace(t, state.cue, { x: spot.x - state.cue.x, y: spot.y - state.cue.y }, seq.length + 1);
  res.points = trimAtTarget(res.points, target, state.spotTarget === 'ball' ? 2 * BALL_R : 0);

  let box = { x: 0, y: 0, w: t.w, h: t.h };
  for (let i = seq.length - 1; i >= 0; i--) {
    const r = seq[i], R = BALL_R;
    if (r === 'top') box = { ...box, y: 2 * R - box.y - box.h };
    if (r === 'bottom') box = { ...box, y: 2 * (t.h - R) - box.y - box.h };
    if (r === 'left') box = { ...box, x: 2 * R - box.x - box.w };
    if (r === 'right') box = { ...box, x: 2 * (t.w - R) - box.x - box.w };
  }
  el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, class: 'ghosttable' }, g);
  el('line', { x1: state.cue.x, y1: state.cue.y, x2: spot.x, y2: spot.y, class: 'sight' }, g);
  for (const mm of mids.slice(0, -1)) el('circle', { cx: mm.x, cy: mm.y, r: 0.6, class: 'mirrorpt' }, g);
  drawWallSpot(g, spot);

  drawPath(g, res.points, 'main');
  drawContacts(g, res.points);
  if (state.spotTarget === 'ball') drawBall(g, state.obj, 'obj', 'obj');
  else el('circle', { cx: target.x, cy: target.y, r: 1.4, class: 'targetpocket' }, g);
  drawBall(g, state.cue, 'cue', 'cue');
  return { spot, res, box };
}

function drawWallSpot(g, p, label = 'spot on the wall') {
  const s = el('g', { class: 'wallspot' }, g);
  el('circle', { cx: p.x, cy: p.y, r: 1.6, class: 'ring' }, s);
  el('circle', { cx: p.x, cy: p.y, r: 0.45 }, s);
  txt(g, p.x, p.y - 2.6, label, 'spotlabel');
}

function spotC5Orient() {
  return { nearTop: state.spotFirstRail === 'bottom', flipX: state.cue.x < state.t.w / 2 };
}

function renderSpotC5(g) {
  const t = state.t;
  const o = spotC5Orient();
  const spot = corner5Spot(t, o, state.bench, state.spotWidths);
  const opts = { bench: state.bench, k: state.k, rails: 3 };
  const canonPt = (X, Y) => ({ x: o.flipX ? t.w - X * t.w / 8 : X * t.w / 8, y: o.nearTop ? Y * t.h / 4 : t.h - Y * t.h / 4 });

  // Other cue-ball positions aimed at the same spot — they all head close to the corner.
  for (const [X, Y] of [[7.2, 0.6], [6, 1.4], [7.6, 2.4], [5.2, 0.5]]) {
    const P = canonPt(X, Y);
    const tr = corner5(t, o, P, firstRailThrough(t, o, P, spot), opts);
    if (!tr.valid) continue;
    drawSystemTrack(g, tr.pts, tr.sides, 'family', false);
    el('circle', { cx: P.x, cy: P.y, r: BALL_R * 0.8, class: 'ghostball' }, g);
  }

  const F = firstRailThrough(t, o, state.cue, spot);
  const tr = corner5(t, o, state.cue, F, opts);
  el('line', { x1: state.cue.x, y1: state.cue.y, x2: spot.x, y2: spot.y, class: 'sight' }, g);
  drawWallSpot(g, spot);
  if (tr.valid) drawSystemTrack(g, tr.pts, tr.sides);
  const cp = { x: o.flipX ? 0 : t.w, y: o.nearTop ? t.h : 0 };
  el('circle', { cx: cp.x, cy: cp.y, r: 1.6, class: 'targetpocket' }, g);
  drawBall(g, state.cue, 'cue', 'cue');
  const sx = Math.min(spot.x, 0), sy = Math.min(spot.y, 0);
  return { spot, F, tr, box: { x: sx, y: sy, w: Math.max(spot.x, t.w) - sx, h: Math.max(spot.y, t.h) - sy } };
}

function renderSpot(g) {
  return state.spotMode === 'corner5' ? renderSpotC5(g) : renderSpotMirror(g);
}

// ---------- Spin & speed ----------
function aimPoint() { return trackPoint(state.t, state.aim.rail, state.aim.n); }

function renderSpin(g) {
  const t = state.t;
  const a = aimPoint();
  const dir = { x: a.x - state.cue.x, y: a.y - state.cue.y };
  const speed = state.mph * MPH;
  let ghost = null;
  const spun = state.side !== 0 || state.vert !== 0;
  if (state.ghost && spun) {
    ghost = simulate(t, state.cue, dir, { speed, side: 0, vert: 0 });
    drawPath(g, ghost.points, 'ghost');
  }
  const res = simulate(t, state.cue, dir, { speed, side: state.side, vert: state.vert });
  drawPath(g, res.points, spun ? 'spin' : 'main');
  drawContacts(g, res.contacts.slice(0, 10));
  if (!res.pocket) el('circle', { cx: res.end.x, cy: res.end.y, r: BALL_R, class: 'restball' }, g);
  else el('circle', { cx: res.pocket.x, cy: res.pocket.y, r: 1.6, class: 'targetpocket' }, g);
  drawAim(g, a);
  drawBall(g, state.cue, 'cue', 'cue');
  const c = { x: state.cue.x, y: state.cue.y - BALL_R * 3.4 };
  const w = el('g', { class: 'spinbadge' }, g);
  el('circle', { cx: c.x, cy: c.y, r: 1.5, class: 'face' }, w);
  el('circle', { cx: c.x + state.side * 1.5, cy: c.y - state.vert * 1.5, r: 0.32, class: 'tip' }, w);
  return { res, ghost };
}

// ---------- panel ----------
const POCKET_NAMES = ['top-left corner', 'top side', 'top-right corner', 'bottom-left corner', 'bottom side', 'bottom-right corner'];
const MPH_MIN = 1, MPH_MAX = 15;

const seg = (key, opts, cur = state[key]) => `<div class="seg">${opts.map(([v, l]) =>
  `<button data-set="${key}" data-val="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;

const benchSelect = () => `<label class="field"><span>Table plays like</span>
  <select data-select="bench">${Object.entries(BENCHMARKS).map(([k, b]) =>
    `<option value="${k}" ${state.bench === k ? 'selected' : ''}>${b.label}</option>`).join('')}</select></label>`;

const kSlider = () => `<label class="field"><span>Your table: Sixes 7 lands <b>${r2(state.k)}</b> diamond up the short rail</span>
  <input type="range" min="0.25" max="1.25" step="0.05" value="${state.k}" data-input="k"></label>`;

function panelDiamond(info) {
  const R = state.dsRails;
  const { tr, kick } = info;
  const sys = SYSTEMS[R];
  const railsSeg = `<div class="seg rails">${[1, 2, 3, 4, 5, 6].map((n) =>
    `<button data-set="dsRails" data-val="${n}" class="${R === n ? 'on' : ''}"><b>${n}</b><small>rail${n > 1 ? 's' : ''}</small></button>`).join('')}</div>`;

  let formula = '', notes = '', calib = '', aimCtl = '';
  if (R === 1) {
    const s = state.oneAim.side;
    aimCtl = state.dsMode === 'kick' ? `<label class="field"><span>Kick off</span>${seg('oneSide', [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']], s)}</label>` : '';
    if (tr.valid) {
      const land = tr.pts[2], ls = tr.sides[2];
      formula = `<div class="formula">aim <span class="sF">${r2(state.oneAim.n)}</span> → <span class="sT">${r2(readOn(state.t, ls, land))}</span></div>
        <div class="formula-k"><span>${RAIL_NAMES[s]}</span><span>lands on ${RAIL_NAMES[ls].toLowerCase()}</span></div>`;
    }
    calib = `<label class="check"><input type="checkbox" data-toggle="oneCorrect" ${state.oneCorrect ? 'checked' : ''}> Large-angle correction (rolling ball goes long past the 5-to-2.5 line)</label>
      ${tr.lengthen > 0.01 ? `<p class="fine">At this angle the ball runs about ${r2(tr.lengthen)} diamond long of the pure 2-to-1 line.</p>` : ''}`;
    notes = `<p class="fine">Distances are measured through the diamonds: from <b>2</b> on the near rail through <b>1</b> on the kicking rail reaches the corner (2-to-1, 3-to-1.5, 4-to-2 …). Hit the cue ball exactly on its vertical centerline, and use medium-soft speed so it is rolling. Source: Dr. Dave, BD May & Jun 2010, Jan 2024.</p>`;
  } else if (R === 2) {
    aimCtl = state.dsMode === 'kick' ? `<label class="field"><span>Kick off</span>${seg('plusSide', [['left', 'Left short rail'], ['right', 'Right short rail']], state.plusAim.side)}</label>` : '';
    formula = tr.valid
      ? `<div class="formula"><span class="sD">${r2(tr.L)}</span> + <span class="sF">${r2(tr.N)}</span> = <span class="sT">${r2(tr.A)}</span></div>
         <div class="formula-k"><span>Origin (long rail)</span><span>Short-rail number</span><span>Arrives</span></div>
         ${tr.A > 8.25 ? '<p class="warn">Past the corner — arrives on the short rail.</p>' : Math.abs(tr.A - 8) <= 0.25 ? '<p class="fine"><b>Into the corner pocket.</b></p>' : ''}`
      : '<p class="warn">Outside the Plus system: the aim line through the cue ball must come from a long rail and the short-rail number must be 1–7.</p>';
    notes = `<p class="fine">Short-rail numbers: the corner on the far side is 1, then +1 every half diamond (the diamonds are 3, 5, 7). The cue ball's line shifts up the long rail by that number. Rolling cue ball with running english. Benchmark: from 3 through 5 into the corner. Big numbers come up short (use less english); small numbers go long (more english). Source: Dr. Dave, BD Aug–Oct 2010.</p>`;
  } else {
    aimCtl = state.dsMode === 'kick' ? `<label class="field"><span>First rail</span>${seg('c5FirstRail', [['top', 'Top'], ['bottom', 'Bottom']])}</label>` : '';
    if (tr.valid) {
      formula = `<div class="formula"><span class="sD">${r2(tr.D)}</span> − <span class="sF">${r2(tr.F)}</span> = <span class="sT">${r2(tr.T)}</span></div>
        <div class="formula-k"><span>Cue (D)</span><span>1st rail (F)</span><span>3rd rail (T)</span></div>
        <ol class="contacts"><li><span class="k">4th rail</span> ${tr.fourth.text}</li></ol>`;
    } else formula = '<p class="warn">Outside the system: the 3rd-rail number must be between 0 and 8.</p>';
    calib = `${benchSelect()}${R >= 3 ? kSlider() : ''}`;
    notes = `<p class="fine"><b>3rd rail = cue number − 1st-rail number.</b> Cue numbers: corner 5, +1 per diamond up the short rail, −½ per diamond along the long rail. Off the 3rd rail the track follows your table's corner benchmark; cue numbers below 5 run a little short, above 5 a little long (≈⅓ diamond at 3.5 and 7). Rolling cue ball, running english, medium speed. Sources: Dr. Dave, BD Nov 2010 – Jan 2011; Dead Aim, "Kicking Academy".</p>
      ${R >= 5 ? '<p class="warn">No published system goes past the 4th rail. Rails 5–6 continue the 4-rail track with equal angles through the diamonds, so treat them as a guide.</p>' : ''}`;
  }

  let kickTxt = '';
  if (state.dsMode === 'kick') {
    kickTxt = !kick || !Number.isFinite(kick.d) ? '<p class="warn">This system can\'t reach the ball from here.</p>'
      : kick.d <= BALL_R ? '<p class="ok">Solved: aim at the crosshair to hit the ball.</p>'
        : kick.d <= 2 * BALL_R ? `<p class="ok">Closest line clips the ball (${r1(kick.d)}″ off center).</p>`
          : `<p class="warn">Closest line misses by ${r1(kick.d - 2 * BALL_R)}″.</p>`;
  }

  return `
    <div class="group">
      <h2>Diamond systems</h2>
      ${railsSeg}
      <p class="sysname"><b>${sys.name}</b> · ${sys.sub}</p>
      ${seg('dsMode', [['aim', 'Aim at a diamond'], ['kick', 'Kick at a ball']])}
      ${aimCtl}
    </div>
    <div class="group">${formula}${kickTxt}${calib}</div>
    <div class="group"><h3>How it works</h3>${notes}</div>`;
}

function panelRef(info) {
  const { s, tr, target } = info;
  const t4 = target.side === 'far'
    ? (target.pocket ? 'the corner pocket' : `${r1(target.n)} diamond${target.n !== 1 ? 's' : ''} from the corner`)
    : `${r2(target.n)} diamond up the short rail`;
  const row = (sep, res, note = '') => `<li class="${Math.abs(s - sep) < 0.01 ? 'on' : ''}"><span class="k">${sep}</span> ${res}${note}</li>`;
  return `
    <div class="group">
      <h2>Reference lines — Sixes</h2>
      <p class="hint">Tap a diamond or pocket to set the <b>start</b>, then a diamond on the opposite long rail for the <b>first rail</b>. Lines are sighted through the diamonds; parallel first legs converge on the same 4th-rail spot.</p>
      <div class="formula"><span class="sF">${r1(s)}</span> separation → ${t4}</div>
      <p class="fine">${target.extrapolated ? 'Past 6 uses your table\'s benchmark below.' : `Separation + 4th-rail diamond = 6 (${r1(s)} + ${r1(Math.max(0, 6 - s))} = 6).`}</p>
      <label class="check"><input type="checkbox" data-toggle="refFamily" ${state.refFamily ? 'checked' : ''}> Show every parallel line</label>
    </div>
    <div class="group">
      <h3>Separation → 4th rail</h3>
      <ol class="contacts sixes">
        ${row(3, '3rd diamond')}${row(4, '2nd diamond')}${row(5, '1st diamond')}${row(6, 'Corner pocket')}${row(7, `${r2(state.k)} diamond up the short rail`, ' <em>(your table)</em>')}
      </ol>
      ${kSlider()}
    </div>
    <div class="group">
      <h3>This track</h3>
      ${tr.valid ? `<p class="fine">Cue number ${r2(tr.D)} − first rail ${r2(tr.F)} = 3rd rail ${r2(tr.T)} (Corner-5), then on to the 4th rail.</p>` : '<p class="warn">From this start the 3rd rail would be past the corner (outside Corner-5).</p>'}
      <p class="fine">Rolling cue ball, running english. Slower speed comes up shorter. Source: Patrick Johnson, "Sixes System".</p>
    </div>`;
}

function panelSpot(info) {
  const mode = state.spotMode;
  let controls = '', readout = '';
  if (mode === 'corner5') {
    controls = `
      <label class="field"><span>First rail</span>${seg('spotFirstRail', [['top', 'Top'], ['bottom', 'Bottom']])}</label>
      <label class="field"><span>Spot distance <b>${r2(state.spotWidths)} table widths</b> beyond the first rail</span>
        <input type="range" min="0.75" max="1.5" step="0.05" value="${state.spotWidths}" data-input="spotWidths"></label>
      ${benchSelect()}${kSlider()}`;
    const tr = info.tr;
    readout = tr && tr.valid
      ? `<div class="formula"><span class="sD">${r2(tr.D)}</span> − <span class="sF">${r2(tr.F)}</span> = <span class="sT">${r2(tr.T)}</span></div>
         <ol class="contacts"><li><span class="k">Aim</span> First rail <b>${r2(tr.F)}</b></li><li><span class="k">4th rail</span> ${tr.fourth.text}</li></ol>`
      : '<p class="warn">From here the line to the spot is outside the Corner-5 range.</p>';
  } else {
    const pk = pockets(state.t);
    const railOpts = (sel) => RAILS.map((r) => `<option value="${r}" ${sel === r ? 'selected' : ''}>${RAIL_NAMES[r]}</option>`).join('');
    controls = `
      <label class="field"><span>Target</span>
        <select data-select="spotTarget">
          <option value="ball" ${state.spotTarget === 'ball' ? 'selected' : ''}>Object ball</option>
          ${pk.map((_, i) => `<option value="${i}" ${state.spotTarget === i ? 'selected' : ''}>${POCKET_NAMES[i]} pocket</option>`).join('')}
        </select></label>
      <label class="field"><span>First rail</span><select data-rail="0">${railOpts(state.spotRails[0])}</select></label>
      ${mode === 'mirror2' ? `<label class="field"><span>Second rail</span><select data-rail="1">${railOpts(state.spotRails[1])}</select></label>` : ''}`;
    readout = `<ol class="contacts">${info.res.points.filter((p) => p.rail).map((p, i) =>
      `<li><span class="k">Rail ${i + 1}</span> ${RAIL_NAMES[p.rail]} <b>${fmtDiamond(p.diamond)}</b></li>`).join('')}</ol>`;
  }
  const hint = mode === 'corner5'
    ? 'Every 3-rail Corner-5 track to the corner points close to one spot about a table width past the first rail. Aim at that spot from anywhere and the ball goes three rails to the corner.'
    : 'Mirror the target behind the rail. Shooting straight at that spot banks the cue ball into the target: exact for a rolling ball, and the spot is one table width past a long rail.';
  return `
    <div class="group">
      <h2>Spot on the wall</h2>
      ${seg('spotMode', [['mirror1', '1 rail'], ['mirror2', '2 rails'], ['corner5', '3 rails · Corner-5']])}
      <p class="hint">${hint}</p>
    </div>
    <div class="group">${controls}</div>
    <div class="group"><h3>Aim</h3>${readout}
      <p class="fine">Source: Dr. Dave, Billiards Digest Feb 2011 ("Spot-on-the-Wall" System).</p></div>`;
}

function tipsText() {
  const tips = (v) => Math.round((Math.abs(v) / MAX_OFFSET) * 3 * 4) / 4;
  const parts = [];
  const s = tips(state.side), v = tips(state.vert);
  if (s) parts.push(`${s} tip${s !== 1 ? 's' : ''} ${state.side > 0 ? 'right' : 'left'}`);
  if (v) parts.push(`${v} tip${v !== 1 ? 's' : ''} ${state.vert > 0 ? 'follow' : 'draw'}`);
  return parts.length ? parts.join(' · ') : 'Center ball';
}

function speedWord(mph) {
  return mph < 2.5 ? 'Soft' : mph < 5 ? 'Medium' : mph < 8 ? 'Firm' : mph < 12 ? 'Hard' : 'Power';
}

function buildSpinPanel() {
  panel.innerHTML = `
    <div class="group">
      <h2>Spin &amp; speed</h2>
      <div class="english">
        <svg id="spinpad" viewBox="-1.32 -1.32 2.64 2.64" role="slider" tabindex="0" aria-label="Cue tip position">
          <defs>
            <radialGradient id="cueShade" cx="35%" cy="30%" r="75%">
              <stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#ecebe4"/><stop offset="1" stop-color="#c9c7bd"/>
            </radialGradient>
          </defs>
          <circle r="1" class="padball"/>
          <circle r="${MAX_OFFSET}" class="padlimit"/>
          <line x1="-1" y1="0" x2="1" y2="0" class="padaxis"/>
          <line x1="0" y1="-1" x2="0" y2="1" class="padaxis"/>
          <text y="-1.1" class="padlbl">Follow</text>
          <text y="1.24" class="padlbl">Draw</text>
          <text x="-1.17" y="0.04" class="padlbl" transform="rotate(-90 -1.17 0)">Left</text>
          <text x="1.17" y="0.04" class="padlbl" transform="rotate(90 1.17 0)">Right</text>
          <circle id="tipdot" r=".11" class="tipdot"/>
        </svg>
        <div class="englishmeta"><b id="tipsText"></b><button class="link" id="centerBtn">Center</button></div>
      </div>
    </div>
    <div class="group">
      <div class="field">
        <span>Speed <b id="speedText"></b></span>
        <div class="speedbar" id="speedbar">
          <div class="track"><div class="fill" id="speedFill"></div></div>
          <div class="thumb" id="speedThumb" role="slider" tabindex="0" aria-label="Shot speed"
               aria-valuemin="${MPH_MIN}" aria-valuemax="${MPH_MAX}"></div>
        </div>
        <div class="ticks"><span>Soft</span><span>Medium</span><span>Firm</span><span>Hard</span><span>Power</span></div>
      </div>
      <label class="check"><input type="checkbox" data-toggle="ghost" ${state.ghost ? 'checked' : ''}> Show center-ball path (dashed)</label>
      <p class="hint">Drag the red dot to where the cue tip hits. Drag the crosshair on a rail to aim.</p>
    </div>
    <div class="group">
      <h3>What happens</h3>
      <div id="spinResult"></div>
      <p class="fine">Physics: cloth friction (slide → roll), follow/draw wearing off, cushion rebound with friction and side spin, squirt, spin decay. Level cue, no object balls.</p>
    </div>`;
  panel.dataset.tab = 'spin';
}

function updateSpinPanel(info) {
  const dot = document.getElementById('tipdot');
  dot.setAttribute('cx', state.side); dot.setAttribute('cy', -state.vert);
  document.getElementById('tipsText').textContent = tipsText();
  const f = (state.mph - MPH_MIN) / (MPH_MAX - MPH_MIN);
  document.getElementById('speedFill').style.width = `${f * 100}%`;
  const th = document.getElementById('speedThumb');
  th.style.left = `${f * 100}%`;
  th.setAttribute('aria-valuenow', state.mph.toFixed(1));
  document.getElementById('speedText').textContent = `${speedWord(state.mph)} · ${state.mph.toFixed(1)} mph`;

  const r = info.res;
  const rows = r.contacts.slice(0, 12).map((c, i) =>
    `<li><span class="k">Rail ${i + 1}</span> ${RAIL_NAMES[c.rail]} <b>${fmtDiamond(c.diamond)}</b></li>`);
  if (r.contacts.length > 12) rows.push(`<li class="more">+ ${r.contacts.length - 12} more rails</li>`);
  const pi = r.pocket ? pockets(state.t).findIndex((k) => k.x === r.pocket.x && k.y === r.pocket.y) : -1;
  const outcome = r.pocket
    ? `<div class="outcome pk">Drops in the ${POCKET_NAMES[pi]} pocket after ${r.rails} rail${r.rails !== 1 ? 's' : ''}</div>`
    : `<div class="outcome">Stops after ${r.rails} rail${r.rails !== 1 ? 's' : ''} · ${r.time.toFixed(1)} s</div>`;
  document.getElementById('spinResult').innerHTML = `${outcome}<ol class="contacts">${rows.join('')}</ol>`;
}

function renderPanel(info) {
  const tab = state.tab;
  if (tab === 'spin') {
    if (panel.dataset.tab !== 'spin') buildSpinPanel();
    updateSpinPanel(info);
    return;
  }
  panel.dataset.tab = tab;
  if (tab === 'diamond') panel.innerHTML = panelDiamond(info);
  if (tab === 'ref') panel.innerHTML = panelRef(info);
  if (tab === 'spot') panel.innerHTML = panelSpot(info);
}

// ---------- main render ----------
function render() {
  svg.innerHTML = '';
  const t = state.t;
  const g = el('g', {}, svg);
  drawTable(g, t, state.numbers && !(state.tab === 'diamond' && state.dsRails >= 2) && state.tab !== 'ref');
  const over = el('g', { class: 'overlay' }, svg);

  let info;
  const f = frameBox(t);
  const m = state.tab === 'diamond' ? 9 : state.tab === 'ref' ? 5 : 3;
  let vb = { x: f.x - m, y: f.y - m, w: f.w + 2 * m, h: f.h + 2 * m };
  if (state.tab === 'diamond') info = renderDiamond(over);
  if (state.tab === 'spin') info = renderSpin(over);
  if (state.tab === 'ref') info = renderRef(over);
  if (state.tab === 'spot') {
    info = renderSpot(over);
    // Room around the table so the spot on the wall is always in view.
    const pad = 10;
    const x0 = Math.min(vb.x, info.box.x - pad), y0 = Math.min(vb.y, info.box.y - pad);
    const x1 = Math.max(vb.x + vb.w, info.box.x + info.box.w + pad), y1 = Math.max(vb.y + vb.h, info.box.y + info.box.h + pad);
    vb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svg.classList.toggle('picking', state.tab === 'ref');
  document.getElementById('dims').textContent = `${t.label} · playing surface ${t.w}″ × ${t.h}″ · 2 : 1`;
  renderPanel(info);
}

// ---------- interaction ----------
let drag = null;
let refPickNext = 'start';

svg.addEventListener('pointerdown', (e) => {
  const d = e.target.closest('[data-drag]');
  if (d) {
    drag = d.dataset.drag;
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  if (state.tab === 'ref') {
    const dm = e.target.closest('.diamond');
    if (!dm) return;
    const pick = { rail: dm.dataset.rail, n: +dm.dataset.n };
    if (pick.rail !== 'top' && pick.rail !== 'bottom') return; // Sixes uses the long rails
    if (refPickNext === 'start' || pick.rail === state.refStart.rail) {
      state.refStart = pick;
      if (state.refFirst.rail === pick.rail || state.refFirst.n === pick.n) {
        state.refFirst = { rail: pick.rail === 'top' ? 'bottom' : 'top', n: pick.n >= 4 ? Math.max(0, pick.n - 6) : Math.min(8, pick.n + 6) };
      }
      refPickNext = 'first';
    } else {
      if (pick.n === state.refStart.n) return;
      state.refFirst = pick;
      refPickNext = 'start';
    }
    render();
  }
});

svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toTable(e);
  const t = state.t;
  if (drag === 'cue') state.cue = clampToCloth(t, p);
  if (drag === 'obj') state.obj = clampToCloth(t, p);
  if (drag === 'aim') { const s = snapToTrack(t, p); state.aim = { rail: s.rail, n: s.n }; }
  if (drag === 'sysAim') {
    const R = state.dsRails;
    if (R === 1) state.oneAim = snapLine(p, ['top', 'bottom', 'left', 'right']);
    else if (R === 2) state.plusAim = snapLine(p, ['left', 'right']);
    else {
      const a = snapLine(p, ['top', 'bottom']);
      state.c5FirstRail = a.side;
      state.c5F = Math.min(7.95, Math.max(0.05, Math.round(canonX(t, c5Orient(), a.n * t.w / 8) * 20) / 20));
    }
  }
  render();
});

const endDrag = () => { drag = null; };
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);

// English pad + speed bar (built once per visit to the spin tab, so drags survive re-renders)
let panelDrag = null;

function padSet(e) {
  const pad = document.getElementById('spinpad');
  const pt = pad.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(pad.getScreenCTM().inverse());
  let x = p.x, y = -p.y;
  const L = Math.hypot(x, y);
  if (L > MAX_OFFSET) { x *= MAX_OFFSET / L; y *= MAX_OFFSET / L; }
  const q = MAX_OFFSET / 12;
  state.side = Math.round(x / q) * q || 0;
  state.vert = Math.round(y / q) * q || 0;
  render();
}

function speedSet(e) {
  const r = document.querySelector('#speedbar .track').getBoundingClientRect();
  const f = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
  state.mph = Math.round((MPH_MIN + f * (MPH_MAX - MPH_MIN)) * 10) / 10;
  render();
}

panel.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#spinpad')) panelDrag = padSet;
  else if (e.target.closest('#speedbar')) panelDrag = speedSet;
  else return;
  e.target.setPointerCapture(e.pointerId);
  e.preventDefault();
  panelDrag(e);
});
panel.addEventListener('pointermove', (e) => { if (panelDrag) panelDrag(e); });
panel.addEventListener('pointerup', () => { panelDrag = null; });
panel.addEventListener('pointercancel', () => { panelDrag = null; });

panel.addEventListener('keydown', (e) => {
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
  if (!step) return;
  if (e.target.id === 'spinpad') {
    const q = MAX_OFFSET / 12;
    const x = state.side + step[0] * q, y = state.vert + step[1] * q;
    if (Math.hypot(x, y) <= MAX_OFFSET + 1e-9) { state.side = x; state.vert = y; }
  } else if (e.target.id === 'speedThumb') {
    const d = step[0] || step[1];
    state.mph = Math.min(MPH_MAX, Math.max(MPH_MIN, Math.round((state.mph + d * 0.5) * 10) / 10));
  } else return;
  e.preventDefault();
  render();
});

panel.addEventListener('click', (e) => {
  if (e.target.id === 'centerBtn') { state.side = 0; state.vert = 0; render(); return; }
  const b = e.target.closest('[data-set]');
  if (!b) return;
  const v = b.dataset.val;
  if (b.dataset.set === 'oneSide') { state.oneAim = { side: v, n: v === 'top' || v === 'bottom' ? 2 : 2 }; render(); return; }
  if (b.dataset.set === 'plusSide') { state.plusAim = { side: v, n: state.plusAim.n }; render(); return; }
  state[b.dataset.set] = Number.isNaN(+v) ? v : +v;
  if (b.dataset.set === 'spotMode' && v === 'mirror2' && state.spotRails.length < 2) {
    const first = state.spotRails[0];
    state.spotRails = [first, { top: 'left', bottom: 'left', left: 'top', right: 'top' }[first]];
  }
  render();
});

panel.addEventListener('input', (e) => {
  const i = e.target;
  if (i.dataset.input) { state[i.dataset.input] = +i.value; render(); }
});

panel.addEventListener('change', (e) => {
  const i = e.target;
  if (i.dataset.toggle) state[i.dataset.toggle] = i.checked;
  if (i.dataset.select === 'spotTarget') state.spotTarget = i.value === 'ball' ? 'ball' : +i.value;
  if (i.dataset.select === 'bench') state.bench = i.value;
  if (i.dataset.rail !== undefined) {
    const idx = +i.dataset.rail;
    state.spotRails[idx] = i.value;
    if (state.spotRails.length === 2 && state.spotRails[0] === state.spotRails[1]) {
      state.spotRails[1 - idx] = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[i.value];
    }
  }
  render();
});

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  state.tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  try { localStorage.setItem('pool-lines-tab', state.tab); } catch {}
  render();
}));

const sizeSel = document.getElementById('size');
sizeSel.innerHTML = Object.entries(TABLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
sizeSel.value = state.size;
sizeSel.addEventListener('change', () => {
  const old = state.t;
  state.size = sizeSel.value;
  state.t = makeTable(state.size);
  state.cue = clampToCloth(state.t, rescale(old, state.t, state.cue));
  state.obj = clampToCloth(state.t, rescale(old, state.t, state.obj));
  render();
});

document.getElementById('numbers').addEventListener('change', (e) => { state.numbers = e.target.checked; render(); });

try {
  const saved = localStorage.getItem('pool-lines-tab');
  if (saved) document.querySelector(`.tabs button[data-tab="${saved}"]`)?.click();
} catch {}
render();
