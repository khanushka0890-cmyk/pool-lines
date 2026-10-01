import {
  BALL_R, TABLES, CUSHION, RAIL, DIAMOND_INSET, RAILS,
  makeTable, pockets, diamonds, trackPoint, trace, mirror,
  clampToCloth, snapToTrack, fmtDiamond,
} from './geometry.js';
import { simulate, MAX_OFFSET, MPH } from './physics.js';
import {
  toScreen, railScreen, toCanon, BENCHMARKS, corner5Track, solveF,
  sixesTrack, sixesTarget, corner5Spot, aimThrough,
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
  // Diamond system (Corner-5)
  c5Mode: 'aim',          // 'aim' | 'target'
  c5FirstRail: 'top',
  c5F: 3,
  c5T: 2,
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

// Label placed just inside the cloth from a point on a cushion.
function inLabel(g, p, s, cls = 'clabel') {
  const t = state.t;
  const dx = t.w / 2 - p.x, dy = t.h / 2 - p.y;
  const L = Math.hypot(dx, dy) || 1;
  const ox = Math.abs(p.x - t.w / 2) > t.w / 2 - 3 ? Math.sign(dx) * 3.4 : dx / L * 0.6;
  const oy = Math.abs(p.y - t.h / 2) > t.h / 2 - 3 ? Math.sign(dy) * 3.0 + 0.6 : dy / L * 0.6 + 0.6;
  txt(g, p.x + ox, p.y + oy, s, cls);
}

function drawAim(g, a, drag = 'aim', cls = '') {
  const m = el('g', { class: `aim ${cls}`, 'data-drag': drag }, g);
  el('circle', { cx: a.x, cy: a.y, r: 2.6, class: 'grab' }, m);
  el('circle', { cx: a.x, cy: a.y, r: 1.0, class: 'ring' }, m);
  el('line', { x1: a.x - 1.6, y1: a.y, x2: a.x + 1.6, y2: a.y, class: 'cross' }, m);
  el('line', { x1: a.x, y1: a.y - 1.6, x2: a.x, y2: a.y + 1.6, class: 'cross' }, m);
}

// Screen position of a canonical system point; corner pockets snap to the pocket itself.
function sysPt(o, P) {
  const t = state.t;
  if (P.pocket) return { x: o.flipX ? 0 : t.w, y: o.nearTop ? t.h : 0 };
  return railScreen(t, o, P);
}

function fourthText(f) {
  if (f.pocket) return 'Corner pocket';
  if (f.side === 'far') return `Far rail · ${r1(8 - f.X)} from the corner`;
  return `Short rail · ${r1(4 - f.Y)} from the corner`;
}

// ---------- Diamond system: Corner-5 ----------
function c5Orient() {
  return { nearTop: state.c5FirstRail === 'bottom', flipX: state.cue.x < state.t.w / 2 };
}

function drawC5Scales(g, o) {
  const t = state.t;
  const off = FRAME + 2.0;
  const farY = o.nearTop ? t.h + off + 0.6 : -off;
  const nearY = o.nearTop ? -off : t.h + off + 0.6;
  const nearY2 = o.nearTop ? -off - 3.0 : t.h + off + 3.6;
  const xOf = (X) => (o.flipX ? t.w - X * t.w / 8 : X * t.w / 8);
  for (let n = 1; n <= 7; n++) {
    txt(g, xOf(n), farY, n, 'sF');
    txt(g, xOf(n), nearY, n, 'sT');
  }
  for (const X of [4, 5, 6, 7]) txt(g, xOf(X), nearY2, r1(5 - (8 - X) / 2), 'sD');
  const endX = o.flipX ? -off - 0.6 : t.w + off + 0.6;
  for (const Y of [1, 2, 3]) txt(g, endX, toScreen(t, o, { X: 8, Y }).y + 0.6, 5 + Y, 'sD');
  txt(g, xOf(8), nearY2, 5, 'sD'); // corner = 5
}

function drawC5Track(g, o, tr, cls = 'main', labels = true) {
  const t = state.t;
  const pts = tr.points.map((P, i) => (i === 0 ? toScreen(t, o, P) : sysPt(o, P)));
  pts[0] = { ...state.cue };
  drawPath(g, pts, cls);
  if (!labels) return pts;
  pts.slice(1).forEach((p, i) => {
    const P = tr.points[i + 1];
    el('circle', { cx: p.x, cy: p.y, r: 0.55, class: 'contact' }, g);
    if (P.rail === 1) inLabel(g, p, r2(P.X), 'clabel sFl');
    if (P.rail === 3) inLabel(g, p, r2(P.X), 'clabel sTl');
  });
  return pts;
}

function c5Solution() {
  const t = state.t, o = c5Orient();
  const cb = toCanon(t, o, state.cue);
  let F = state.c5F;
  if (state.c5Mode === 'target') {
    const s = solveF(cb, state.c5T);
    F = s == null ? NaN : s;
  }
  const tr = Number.isFinite(F) ? corner5Track(cb, F, state.bench) : null;
  return { o, cb, F, tr };
}

function renderDiamond(g) {
  const t = state.t;
  const { o, F, tr } = c5Solution();
  drawC5Scales(g, o);
  if (tr) {
    // aim line extended back to the origination number
    const oPt = railScreen(t, o, tr.origin);
    el('line', { x1: oPt.x, y1: oPt.y, x2: state.cue.x, y2: state.cue.y, class: 'sight' }, g);
    el('circle', { cx: oPt.x, cy: oPt.y, r: 0.6, class: 'dpt' }, g);
    if (tr.valid) drawC5Track(g, o, tr);
  }
  if (state.c5Mode === 'aim') drawAim(g, railScreen(t, o, { X: state.c5F, Y: 4 }), 'c5F');
  else drawAim(g, railScreen(t, o, { X: state.c5T, Y: 0 }), 'c5T', 'target');
  drawBall(g, state.cue, 'cue', 'cue');
  return { o, F, tr };
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
  return { o, x0, s, tr: sixesTrack(x0, s), target: sixesTarget(s) };
}

function renderRef(g) {
  const t = state.t;
  const { o, x0, s, tr, target } = refSolution();
  drawSightPoints(g, t);
  // Far-rail diamonds counted from the start (the separation you'd count at the table)
  const farTop = state.refFirst.rail === 'top';
  for (let n = 0; n <= 8; n++) {
    const sep = Math.abs(n - state.refStart.n);
    if (!sep) continue;
    txt(g, n * t.w / 8, farTop ? -FRAME - 1.6 : t.h + FRAME + 2.6, sep, `sepnum${sep === s ? ' on' : ''}`);
  }

  if (state.refFamily) {
    for (let X = 1; X <= 8; X++) {
      if (X === x0) continue;
      const f = sixesTrack(X, s);
      if (!f.valid) continue;
      const pts = [toScreen(t, o, f.points[0]), ...f.points.slice(1).map((P) => sysPt(o, P))];
      pts[0] = railScreen(t, o, f.points[0]);
      drawPath(g, pts.slice(0, 2), 'family first');
      drawPath(g, pts.slice(1), 'family');
    }
  }

  // sighting line diamond → diamond on the rail tops
  const sightOf = (rail, n) => ({ x: n * t.w / 8, y: rail === 'top' ? -DIAMOND_INSET : t.h + DIAMOND_INSET });
  const a = sightOf(state.refStart.rail, state.refStart.n), b = sightOf(state.refFirst.rail, state.refFirst.n);
  el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'sight' }, g);

  if (tr.valid) {
    const pts = tr.points.map((P) => sysPt(o, P));
    pts[0] = railScreen(t, o, tr.points[0]);
    drawPath(g, pts, 'main');
    pts.slice(1, 4).forEach((p) => el('circle', { cx: p.x, cy: p.y, r: 0.55, class: 'contact' }, g));
    el('circle', { cx: pts[0].x, cy: pts[0].y, r: 0.9, class: 'refstart' }, g);
  }
  // convergence target
  const tp = sysPt(o, target);
  const tg = el('g', { class: 'converge' }, g);
  el('circle', { cx: tp.x, cy: tp.y, r: 2.0, class: 'ring' }, tg);
  el('circle', { cx: tp.x, cy: tp.y, r: 0.45 }, tg);
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
  const spotC = corner5Spot(state.bench, state.spotWidths);
  const spot = toScreen(t, o, spotC);

  // A few other cue-ball positions aimed at the same spot — they all converge on the corner.
  for (const P of [{ X: 7.2, Y: 0.6 }, { X: 6, Y: 1.4 }, { X: 7.6, Y: 2.4 }, { X: 5.2, Y: 0.4 }]) {
    const F = aimThrough(P, spotC);
    const tr = corner5Track(P, F, state.bench);
    if (!tr || !tr.valid) continue;
    const pts = [toScreen(t, o, P), ...tr.points.slice(1).map((Q) => sysPt(o, Q))];
    drawPath(g, pts, 'family');
    el('circle', { cx: pts[0].x, cy: pts[0].y, r: BALL_R * 0.8, class: 'ghostball' }, g);
  }

  const cb = toCanon(t, o, state.cue);
  const F = aimThrough(cb, spotC);
  const tr = corner5Track(cb, F, state.bench);
  el('line', { x1: state.cue.x, y1: state.cue.y, x2: spot.x, y2: spot.y, class: 'sight' }, g);
  drawWallSpot(g, spot);
  if (tr && tr.valid) drawC5Track(g, o, tr);
  // target corner
  const cp = sysPt(o, { pocket: true });
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

const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) =>
  `<button data-set="${key}" data-val="${v}" class="${String(state[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;

const benchSelect = () => `<label class="field"><span>Table plays like</span>
  <select data-select="bench">${Object.entries(BENCHMARKS).map(([k, b]) =>
    `<option value="${k}" ${state.bench === k ? 'selected' : ''}>${b.label}</option>`).join('')}</select></label>`;

function panelDiamond(info) {
  const { tr } = info;
  let formula = '<div class="formula muted">Move the cue ball below the first rail.</div>';
  let result = '';
  if (tr) {
    formula = `<div class="formula"><span class="sD">${r2(tr.D)}</span> − <span class="sF">${r2(tr.F)}</span> = <span class="sT">${r2(tr.T)}</span></div>
      <div class="formula-k"><span>Cue (D)</span><span>1st rail (F)</span><span>3rd rail (T)</span></div>`;
    if (!tr.valid) result = '<p class="warn">This line is outside the system (the 3rd-rail number must be between 0 and 8).</p>';
    else {
      const adj = tr.D < 4.5 ? `From a cue number of ${r1(tr.D)} the track runs a little short of this: aim slightly lower on the first rail (about ⅓ diamond at 3.5).`
        : tr.D > 5.5 ? `From a cue number of ${r1(tr.D)} the track runs a little long: aim slightly higher on the first rail (about ⅓ diamond at 7).` : '';
      result = `<ol class="contacts">
        <li><span class="k">4th rail</span> ${fourthText(tr.fourth)}</li></ol>
        ${adj ? `<p class="fine">${adj}</p>` : ''}`;
    }
  }
  return `
    <div class="group">
      <h2>Corner-5 diamond system</h2>
      <p class="hint">Three-rail kicks off a long rail. <b>3rd rail = cue number − 1st-rail number.</b> Drag the cue ball and the crosshair.</p>
      ${seg('c5Mode', [['aim', 'Aim at a diamond'], ['target', 'Hit a 3rd-rail target']])}
      ${benchSelect()}
    </div>
    <div class="group">
      ${formula}
      ${result}
    </div>
    <div class="group">
      <h3>How the numbers work</h3>
      <ul class="legend">
        <li><span class="sw sD"></span><b>Cue (D)</b>: where the aim line through the cue ball crosses the near rail. Corner = 5, +1 per diamond up the short rail, −½ per diamond along the long rail.</li>
        <li><span class="sw sF"></span><b>1st rail (F)</b>: 1 at the diamond nearest the far end.</li>
        <li><span class="sw sT"></span><b>3rd rail (T)</b>: same count on the near rail.</li>
      </ul>
      <p class="fine">Rolling cue ball, running english, medium speed. Slower runs short off the 3rd rail, faster runs long. Source: Dr. Dave, Billiards Digest Nov 2010 – Jan 2011.</p>
    </div>`;
}

function panelRef(info) {
  const { s, tr, target } = info;
  const t4 = target.side === 'far'
    ? (target.pocket ? 'the corner pocket' : `${r1(target.n)} diamond${target.n !== 1 ? 's' : ''} from the corner`)
    : `${r1(target.n)} diamond up the short rail`;
  const row = (sep, res, note = '') => `<li class="${Math.abs(s - sep) < 0.01 ? 'on' : ''}"><span class="k">${sep}</span> ${res}${note}</li>`;
  return `
    <div class="group">
      <h2>Reference lines — Sixes</h2>
      <p class="hint">Tap a diamond or pocket to set the <b>start</b>, then a diamond on the opposite long rail for the <b>first rail</b>. Parallel first legs all converge on the same 4th-rail spot.</p>
      <div class="formula"><span class="sF">${r1(s)}</span> separation → ${t4}</div>
      <p class="fine">${target.extrapolated ? 'Past 6 uses your benchmark: 7 → ½ diamond up the short rail.' : `Separation + 4th-rail diamond = 6 (${r1(s)} + ${r1(Math.max(0, 6 - s))} = 6).`}</p>
      <label class="check"><input type="checkbox" data-toggle="refFamily" ${state.refFamily ? 'checked' : ''}> Show every parallel line</label>
    </div>
    <div class="group">
      <h3>Separation → 4th rail</h3>
      <ol class="contacts sixes">
        ${row(3, '3rd diamond')}${row(4, '2nd diamond')}${row(5, '1st diamond')}${row(6, 'Corner pocket')}${row(7, '½ diamond up the short rail', ' <em>(yours)</em>')}
      </ol>
    </div>
    <div class="group">
      <h3>This track</h3>
      ${tr.valid ? `<p class="fine">Cue number ${r2(tr.D)} − first rail ${r2(tr.F)} = 3rd rail ${r2(tr.T)} (Corner-5), then on to the 4th rail.</p>` : '<p class="warn">This line is outside the system range.</p>'}
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
      ${benchSelect()}`;
    const tr = info.tr;
    readout = tr && tr.valid
      ? `<div class="formula"><span class="sD">${r2(tr.D)}</span> − <span class="sF">${r2(tr.F)}</span> = <span class="sT">${r2(tr.T)}</span></div>
         <ol class="contacts"><li><span class="k">Aim</span> First rail <b>${r2(tr.F)}</b></li><li><span class="k">4th rail</span> ${fourthText(tr.fourth)}</li></ol>`
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
  drawTable(g, t, state.numbers && state.tab !== 'diamond' && state.tab !== 'ref');
  const over = el('g', { class: 'overlay' }, svg);

  let info;
  const f = frameBox(t);
  const m = state.tab === 'diamond' ? 8 : state.tab === 'ref' ? 5 : 3;
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
  if (drag === 'c5F') {
    state.c5FirstRail = p.y < t.h / 2 ? 'top' : 'bottom';
    const X = toCanon(t, c5Orient(), p).X;
    state.c5F = Math.min(7.9, Math.max(0.1, Math.round(X * 10) / 10));
  }
  if (drag === 'c5T') {
    const X = toCanon(t, c5Orient(), p).X;
    state.c5T = Math.min(7.9, Math.max(0.1, Math.round(X * 10) / 10));
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
  if (b.dataset.set === 'c5Mode') {
    // keep the same shot when switching modes
    const { tr } = c5Solution();
    if (tr && tr.valid) { state.c5F = Math.round(tr.F * 10) / 10; state.c5T = Math.round(tr.T * 10) / 10; }
  }
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
