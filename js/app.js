import {
  BALL_R, TABLES, CUSHION, RAIL, DIAMOND_INSET, RAILS,
  makeTable, pockets, diamonds, railPoint, trackPoint, trace, mirror,
  clampToCloth, snapToTrack, fmtDiamond,
} from './geometry.js';

const svg = document.getElementById('table');
const panel = document.getElementById('panel');
const NS = 'http://www.w3.org/2000/svg';

const RAIL_NAMES = { top: 'Top long rail', bottom: 'Bottom long rail', left: 'Left short rail', right: 'Right short rail' };

const state = {
  tab: 'diamond',
  size: '9ft',
  t: makeTable('9ft'),
  numbers: true,
  cue: { x: 75, y: 37.5 },
  obj: { x: 38, y: 34 },
  aim: { rail: 'top', n: 3 },
  rails: 3,
  english: 0,
  speed: 3,
  ghost: true,
  spotTarget: 'ball',     // 'ball' | pocket index
  spotRails: ['top'],
  refFrom: { rail: 'bottom', n: 1 },
  refTo: { rail: 'top', n: 3 },
  refRails: 3,
  fan: false,
};

// ---------- helpers ----------
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const pathD = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');

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
  const m = CUSHION + RAIL;
  return { x: -m, y: -m, w: t.w + 2 * m, h: t.h + 2 * m };
}

function drawTable(g, t) {
  const m = CUSHION + RAIL;
  const f = frameBox(t);
  el('rect', { x: f.x, y: f.y, width: f.w, height: f.h, rx: 3.5, class: 'wood' }, g);
  el('rect', { x: -CUSHION, y: -CUSHION, width: t.w + 2 * CUSHION, height: t.h + 2 * CUSHION, class: 'cushion' }, g);
  el('rect', { x: 0, y: 0, width: t.w, height: t.h, class: 'cloth' }, g);

  // Head string + spots (head string at 2nd diamond from the head/left rail)
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
    el('circle', { cx, cy, r: 2.2, class: 'hit' }, dg); // larger tap target
    if (state.numbers) {
      const lo = { top: [0, -2.1], bottom: [0, 2.9], left: [-2.3, 0.6], right: [2.3, 0.6] }[d.rail];
      const tx = el('text', { x: cx + lo[0], y: cy + lo[1], class: 'dnum' }, g);
      tx.textContent = d.n;
    }
  }
  return m;
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
  let i = 0;
  for (const p of pts) {
    if (!p.rail) continue;
    i++;
    el('circle', { cx: p.x, cy: p.y, r: 0.55, class: `contact ${cls}` }, g);
    const off = { top: [0, 3.2], bottom: [0, -2.3], left: [3, 0.6], right: [-3, 0.6] }[p.rail];
    const tx = el('text', { x: p.x + off[0], y: p.y + off[1], class: `clabel ${cls}` }, g);
    tx.textContent = fmtDiamond(p.diamond);
  }
}

// ---------- tabs ----------
function aimPoint() { return trackPoint(state.t, state.aim.rail, state.aim.n); }

function renderDiamond(g) {
  const t = state.t;
  const a = aimPoint();
  const res = trace(t, state.cue, { x: a.x - state.cue.x, y: a.y - state.cue.y }, state.rails);
  drawPath(g, res.points, 'main');
  drawContacts(g, res.points);
  drawAim(g, a);
  drawBall(g, state.cue, 'cue', 'cue');
  return res;
}

function renderSpin(g) {
  const t = state.t;
  const a = aimPoint();
  const dir = { x: a.x - state.cue.x, y: a.y - state.cue.y };
  let ghost = null;
  if (state.ghost && state.english !== 0) {
    ghost = trace(t, state.cue, dir, state.rails);
    drawPath(g, ghost.points, 'ghost');
  }
  const res = trace(t, state.cue, dir, state.rails, { english: state.english, speed: state.speed });
  drawPath(g, res.points, state.english ? 'spin' : 'main');
  drawContacts(g, res.points);
  drawAim(g, a);
  drawBall(g, state.cue, 'cue', 'cue');
  drawSpinDot(g);
  return { res, ghost };
}

function drawSpinDot(g) {
  // little cue-tip indicator next to the cue ball
  const c = { x: state.cue.x, y: state.cue.y - BALL_R * 3.2 };
  const w = el('g', { class: 'spinbadge' }, g);
  el('circle', { cx: c.x, cy: c.y, r: 1.4, class: 'face' }, w);
  el('circle', { cx: c.x + (state.english / 3) * 1.0, cy: c.y, r: 0.32, class: 'tip' }, w);
}

function drawAim(g, a) {
  const m = el('g', { class: 'aim', 'data-drag': 'aim' }, g);
  el('circle', { cx: a.x, cy: a.y, r: 2.4, class: 'grab' }, m);
  el('circle', { cx: a.x, cy: a.y, r: 1.0, class: 'ring' }, m);
  el('line', { x1: a.x - 1.6, y1: a.y, x2: a.x + 1.6, y2: a.y, class: 'cross' }, m);
  el('line', { x1: a.x, y1: a.y - 1.6, x2: a.x, y2: a.y + 1.6, class: 'cross' }, m);
}

function spotTargetPoint() {
  if (state.spotTarget === 'ball') return state.obj;
  const k = pockets(state.t)[state.spotTarget];
  return { x: k.x, y: k.y };
}

function spotSolution() {
  const t = state.t;
  const target = spotTargetPoint();
  const seq = state.spotRails;
  // Mirror across the last rail first, then the earlier ones.
  const mirrors = [];
  let m = target;
  for (let i = seq.length - 1; i >= 0; i--) { m = mirror(t, seq[i], m); mirrors.push({ rail: seq[i], p: m }); }
  const spot = m;
  const dir = { x: spot.x - state.cue.x, y: spot.y - state.cue.y };
  const res = trace(t, state.cue, dir, seq.length + 1);
  res.points = trimAtTarget(res.points, target, state.spotTarget === 'ball' ? 2 * BALL_R : 0);
  return { target, mirrors, spot, res };
}

// Cut the path where the cue ball first reaches the target (contacts the ball, or the pocket).
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

function renderSpot(g) {
  const t = state.t;
  const { target, mirrors, spot, res } = spotSolution();

  // Ghost tables: show the mirrored table for each reflection.
  let box = { x: 0, y: 0, w: t.w, h: t.h };
  for (let i = state.spotRails.length - 1; i >= 0; i--) {
    const r = state.spotRails[i];
    const R = BALL_R;
    if (r === 'top') box = { ...box, y: 2 * R - box.y - box.h };
    if (r === 'bottom') box = { ...box, y: 2 * (t.h - R) - box.y - box.h };
    if (r === 'left') box = { ...box, x: 2 * R - box.x - box.w };
    if (r === 'right') box = { ...box, x: 2 * (t.w - R) - box.x - box.w };
  }
  el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, class: 'ghosttable' }, g);

  // Straight sight line to the spot on the wall
  el('line', { x1: state.cue.x, y1: state.cue.y, x2: spot.x, y2: spot.y, class: 'sight' }, g);
  for (const mm of mirrors.slice(0, -1)) el('circle', { cx: mm.p.x, cy: mm.p.y, r: 0.6, class: 'mirrorpt' }, g);
  const s = el('g', { class: 'wallspot' }, g);
  el('circle', { cx: spot.x, cy: spot.y, r: BALL_R, class: 'ring' }, s);
  el('circle', { cx: spot.x, cy: spot.y, r: 0.35 }, s);
  const lab = el('text', { x: spot.x, y: spot.y - 2.2, class: 'spotlabel' }, g);
  lab.textContent = 'spot on the wall';

  drawPath(g, res.points, 'main');
  drawContacts(g, res.points);
  if (state.spotTarget === 'ball') drawBall(g, state.obj, 'obj', 'obj');
  else el('circle', { cx: target.x, cy: target.y, r: 1.4, class: 'targetpocket' }, g);
  drawBall(g, state.cue, 'cue', 'cue');

  return { box, spot, res };
}

function renderRef(g) {
  const t = state.t;
  const from = trackPoint(t, state.refFrom.rail, state.refFrom.n);
  const to = trackPoint(t, state.refTo.rail, state.refTo.n);

  if (state.fan) {
    for (const d of diamonds(t)) {
      if (d.rail === state.refFrom.rail) continue;
      const p = trackPoint(t, d.rail, d.n);
      const r = trace(t, from, { x: p.x - from.x, y: p.y - from.y }, 2);
      drawPath(g, r.points, 'fan');
    }
  }

  // Sighting line on the rails, diamond to diamond
  const a = railPoint(t, state.refFrom.rail, state.refFrom.n);
  const b = railPoint(t, state.refTo.rail, state.refTo.n);
  const off = (r) => ({ top: [0, -DIAMOND_INSET], bottom: [0, DIAMOND_INSET], left: [-DIAMOND_INSET, 0], right: [DIAMOND_INSET, 0] }[r]);
  const ao = off(state.refFrom.rail), bo = off(state.refTo.rail);
  el('line', { x1: a.x + ao[0], y1: a.y + ao[1], x2: b.x + bo[0], y2: b.y + bo[1], class: 'sight' }, g);

  const res = trace(t, from, { x: to.x - from.x, y: to.y - from.y }, state.refRails + 1);
  drawPath(g, res.points, 'main');
  drawContacts(g, res.points);
  el('circle', { cx: from.x, cy: from.y, r: 0.9, class: 'refstart' }, g);
  return res;
}

// ---------- panel ----------
function contactList(points, extra = '') {
  const rows = points.filter((p) => p.rail).map((p, i) =>
    `<li><span class="k">Rail ${i + 1}</span> ${RAIL_NAMES[p.rail]} <b>${fmtDiamond(p.diamond)}</b></li>`);
  const last = points[points.length - 1];
  if (last.pocket) rows.push('<li class="pk">Pocketed</li>');
  return `<ol class="contacts">${rows.join('')}${extra}</ol>`;
}

function railsControl(key, max = 5) {
  return `<label class="field"><span>Rails</span>
    <div class="seg">${Array.from({ length: max }, (_, i) => i + 1).map((n) =>
      `<button data-set="${key}" data-val="${n}" class="${state[key] === n ? 'on' : ''}">${n}</button>`).join('')}</div></label>`;
}

function renderPanel(info) {
  const tab = state.tab;
  let html = '';
  if (tab === 'diamond') {
    html = `
      <h2>Diamond system</h2>
      <p class="hint">Drag the cue ball. Drag the <b>crosshair</b> along any rail to set the first-rail aim (snaps to ¼ diamond). The path is the ideal no-spin, medium-speed track.</p>
      ${railsControl('rails')}
      <h3>Where it lands</h3>
      ${contactList(info.points)}
      <div class="todo"><b>Next:</b> system overlays (Corner-5, Plus system, 1-rail mirror numbers) — tell me which numbering you use.</div>`;
  } else if (tab === 'spin') {
    const e = state.english;
    const word = e === 0 ? 'center ball' : `${Math.abs(e)} tip${Math.abs(e) !== 1 ? 's' : ''} ${e > 0 ? 'right' : 'left'}`;
    html = `
      <h2>Side spin</h2>
      <p class="hint">Same shot, with english. The dashed line is the no-spin path for comparison.</p>
      <label class="field"><span>English <b>${word}</b></span>
        <input type="range" min="-3" max="3" step="0.5" value="${e}" data-input="english"></label>
      <label class="field"><span>Speed <b>${['', 'soft', 'medium-soft', 'medium', 'firm', 'hard'][state.speed]}</b></span>
        <input type="range" min="1" max="5" step="1" value="${state.speed}" data-input="speed"></label>
      ${railsControl('rails')}
      <label class="check"><input type="checkbox" data-toggle="ghost" ${state.ghost ? 'checked' : ''}> Show no-spin path</label>
      <h3>Where it lands</h3>
      ${contactList(info.res.points)}
      <p class="fine">Simplified cushion model: running english lengthens the rebound angle, reverse shortens it, and each rail takes about half the spin off. Tune later with real table data.</p>`;
  } else if (tab === 'spot') {
    const t = state.t;
    const pk = pockets(t);
    const names = ['Top-left corner', 'Top side', 'Top-right corner', 'Bottom-left corner', 'Bottom side', 'Bottom-right corner'];
    const railOpts = (sel, i) => RAILS.map((r) => `<option value="${r}" ${sel === r ? 'selected' : ''}>${RAIL_NAMES[r]}</option>`).join('');
    html = `
      <h2>Spot on the wall</h2>
      <p class="hint">Mirror the target behind the rail and shoot straight at that "spot on the wall" — the cue ball banks into the target. Drag both balls.</p>
      <label class="field"><span>Target</span>
        <select data-select="spotTarget">
          <option value="ball" ${state.spotTarget === 'ball' ? 'selected' : ''}>Object ball</option>
          ${pk.map((_, i) => `<option value="${i}" ${state.spotTarget === i ? 'selected' : ''}>${names[i]} pocket</option>`).join('')}
        </select></label>
      <label class="field"><span>First rail</span><select data-rail="0">${railOpts(state.spotRails[0])}</select></label>
      <label class="check"><input type="checkbox" data-toggle="twoRail" ${state.spotRails.length === 2 ? 'checked' : ''}> Two rails</label>
      ${state.spotRails.length === 2 ? `<label class="field"><span>Second rail</span><select data-rail="1">${railOpts(state.spotRails[1])}</select></label>` : ''}
      <h3>Aim</h3>
      ${contactList(info.res.points)}`;
  } else if (tab === 'ref') {
    html = `
      <h2>Reference lines</h2>
      <p class="hint">Tap a diamond to set the <b>start</b>, then tap another to set where you're <b>shooting</b>. The line follows the ball through the next rails (no spin).</p>
      <div class="pair">
        <div><span class="k">From</span> ${RAIL_NAMES[state.refFrom.rail]} <b>${state.refFrom.n}</b></div>
        <div><span class="k">To</span> ${RAIL_NAMES[state.refTo.rail]} <b>${state.refTo.n}</b></div>
      </div>
      <label class="field"><span>Rails after the first contact</span>
        <div class="seg">${[1, 2, 3, 4].map((n) => `<button data-set="refRails" data-val="${n}" class="${state.refRails === n ? 'on' : ''}">${n}</button>`).join('')}</div></label>
      <label class="check"><input type="checkbox" data-toggle="fan" ${state.fan ? 'checked' : ''}> Show every line from the start diamond</label>
      <h3>Track</h3>
      ${contactList(info.points)}`;
  }
  panel.innerHTML = html;
}

// ---------- main render ----------
let pickNext = 'from';

function render() {
  svg.innerHTML = '';
  const t = state.t;
  const g = el('g', {}, svg);
  drawTable(g, t);
  const over = el('g', { class: 'overlay' }, svg);

  let info;
  const f = frameBox(t);
  let vb = { ...f };
  if (state.tab === 'diamond') info = renderDiamond(over);
  if (state.tab === 'spin') info = renderSpin(over);
  if (state.tab === 'spot') {
    info = renderSpot(over);
    const pad = 4;
    const x0 = Math.min(f.x, info.box.x - pad), y0 = Math.min(f.y, info.box.y - pad);
    const x1 = Math.max(f.x + f.w, info.box.x + info.box.w + pad), y1 = Math.max(f.y + f.h, info.box.y + info.box.h + pad);
    vb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (state.tab === 'ref') info = renderRef(over);

  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svg.classList.toggle('picking', state.tab === 'ref');
  document.getElementById('dims').textContent =
    `${t.label} · playing surface ${t.w}″ × ${t.h}″ · 2 : 1`;
  renderPanel(info);
}

// ---------- interaction ----------
let drag = null;

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
    if (pickNext === 'from') {
      state.refFrom = pick;
      if (state.refTo.rail === pick.rail) state.refTo = { rail: pick.rail === 'top' ? 'bottom' : pick.rail === 'bottom' ? 'top' : pick.rail === 'left' ? 'right' : 'left', n: pick.n };
      pickNext = 'to';
    } else {
      if (pick.rail === state.refFrom.rail) { state.refFrom = pick; render(); return; }
      state.refTo = pick;
      pickNext = 'from';
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
  render();
});

const endDrag = () => { drag = null; };
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);

panel.addEventListener('click', (e) => {
  const b = e.target.closest('[data-set]');
  if (!b) return;
  state[b.dataset.set] = +b.dataset.val;
  render();
});

panel.addEventListener('input', (e) => {
  const i = e.target;
  if (i.dataset.input) { state[i.dataset.input] = +i.value; render(); }
});

panel.addEventListener('change', (e) => {
  const i = e.target;
  if (i.dataset.toggle === 'twoRail') {
    if (i.checked) {
      const first = state.spotRails[0];
      const adj = { top: 'left', bottom: 'left', left: 'top', right: 'top' }[first];
      state.spotRails = [first, adj];
    } else state.spotRails = [state.spotRails[0]];
  } else if (i.dataset.toggle) state[i.dataset.toggle] = i.checked;
  if (i.dataset.select === 'spotTarget') state.spotTarget = i.value === 'ball' ? 'ball' : +i.value;
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
