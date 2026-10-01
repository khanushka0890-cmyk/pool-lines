// Published kick systems, worked "through the diamonds".
//
// Dr. Dave (BD May 2010): for rolling-ball kick systems the aim points are the diamonds
// themselves, and distances are measured along the lines through the diamonds — not along
// the rail groove where the ball touches the cushion. So every system line here runs between
// points on the four "diamond lines" (the rail tops, DIAMOND_INSET outside the cushion nose).
// The ball's path on the cloth is then derived from those lines.
//
// Orientation o = { nearTop, flipX } names the rails for a system:
//   near   long rail closest to the shooter      far        the other long rail
//   farEnd short rail at the far end             shooterEnd short rail behind the shooter
// Canonical numbers: X 0..8 along a long rail from the far end, Y 0..4 across from the near rail.
//
// Sources:
//   2-to-1 (1 rail)   Dr. Dave, Billiards Digest May & Jun 2010, Jan 2024
//   Plus (2 rails)    Dr. Dave, BD Aug–Oct 2010
//   Corner-5 (3 rails) Dr. Dave, BD Nov 2010 – Jan 2011
//   4th-rail tracks   Dead Aim, "Kicking Academy"; Dr. Dave, BD Jan 2011
//   Sixes             Patrick Johnson, AZBilliards "3-Rail Kick Tracks"
//   Spot on the wall  Dr. Dave, BD Feb 2011

import { BALL_R, DIAMOND_INSET, pocketedAt, nearestPocket } from './geometry.js';

const DI = DIAMOND_INSET;

// ---------- diamond frame ----------
export function lines(t) {
  return { top: -DI, bottom: t.h + DI, left: -DI, right: t.w + DI };
}

const SIDE_OF = (o) => ({
  near: o.nearTop ? 'top' : 'bottom',
  far: o.nearTop ? 'bottom' : 'top',
  farEnd: o.flipX ? 'right' : 'left',
  shooterEnd: o.flipX ? 'left' : 'right',
});
export const sideOf = (o, which) => SIDE_OF(o)[which];
export function whichOf(o, side) {
  const m = SIDE_OF(o);
  return Object.keys(m).find((k) => m[k] === side);
}

// Point on a long rail's diamond line, X diamonds from the far end.
export function longPt(t, o, which, X) {
  const L = lines(t);
  const x = o.flipX ? t.w - X * t.w / 8 : X * t.w / 8;
  return { x, y: L[sideOf(o, which)] };
}
// Point on a short rail's diamond line, Y diamonds from the near rail.
export function shortPt(t, o, which, Y) {
  const L = lines(t);
  const y = o.nearTop ? Y * t.h / 4 : t.h - Y * t.h / 4;
  return { x: L[sideOf(o, which)], y };
}
export const canonX = (t, o, x) => (o.flipX ? 8 - 8 * x / t.w : 8 * x / t.w);
export const canonY = (t, o, y) => (o.nearTop ? 4 * y / t.h : 4 * (t.h - y) / t.h);

// Generic diamond reading of a point on any diamond line (left/top corner = 0).
export function readOn(t, side, p) {
  return side === 'top' || side === 'bottom' ? 8 * p.x / t.w : 4 * p.y / t.h;
}

// Ray from P (inside the frame) along d to the first diamond line.
export function hitFrame(t, P, d) {
  const L = lines(t);
  let best = null;
  const tryHit = (s, side) => { if (s > 1e-6 && (!best || s < best.s)) best = { s, side }; };
  if (d.x > 1e-12) tryHit((L.right - P.x) / d.x, 'right');
  if (d.x < -1e-12) tryHit((L.left - P.x) / d.x, 'left');
  if (d.y > 1e-12) tryHit((L.bottom - P.y) / d.y, 'bottom');
  if (d.y < -1e-12) tryHit((L.top - P.y) / d.y, 'top');
  if (!best) return null;
  return { x: P.x + d.x * best.s, y: P.y + d.y * best.s, side: best.side };
}

const reflect = (d, side) => (side === 'top' || side === 'bottom' ? { x: d.x, y: -d.y } : { x: -d.x, y: d.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

// ---------- ball path on the cloth ----------
// The ball meets each cushion where the system line through the diamonds reaches the cushion
// (aiming through a diamond makes contact ahead of the equal-angle point; the rolling ball's
// longer rebound carries it onto the next system line). The path joins those contacts.
// Returns { path, legs: [[a,b]...] (cloth segment of each leg), contacts, pocket }.
export function clothPath(t, pts) {
  const R = BALL_R;
  const box = { x0: R, y0: R, x1: t.w - R, y1: t.h - R };
  const path = [{ ...pts[0] }];
  const legs = [];
  const contacts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const c = clip(a, b, box);
    if (!c) { legs.push(null); continue; }
    const p1 = c[1];
    const p0 = path[path.length - 1];
    path.push(p1);
    legs.push([p0, p1]);
    // where this leg meets the cushion
    const side = Math.abs(p1.y - box.y0) < 1e-6 ? 'top' : Math.abs(p1.y - box.y1) < 1e-6 ? 'bottom'
      : Math.abs(p1.x - box.x0) < 1e-6 ? 'left' : Math.abs(p1.x - box.x1) < 1e-6 ? 'right' : null;
    if (side) {
      contacts.push({ ...p1, side });
      if (pocketedAt(t, side, p1)) {
        const k = nearestPocket(t, p1);
        path.push({ x: k.x, y: k.y });
        return { path, legs, contacts, pocket: k, pocketLeg: i };
      }
    }
  }
  return { path, legs, contacts, pocket: null };
}

function clip(a, b, box) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const ps = [-dx, dx, -dy, dy];
  const qs = [a.x - box.x0, box.x1 - a.x, a.y - box.y0, box.y1 - a.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(ps[i]) < 1e-12) { if (qs[i] < 0) return null; continue; }
    const r = qs[i] / ps[i];
    if (ps[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  if (t1 - t0 < 1e-9) return null;
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
}

// Continue a track by equal angles through the diamonds (no published system).
function continueTrack(t, pts, sides, n) {
  for (let i = 0; i < n; i++) {
    const P = pts[pts.length - 1], prev = pts[pts.length - 2];
    const d = reflect(sub(P, prev), sides[sides.length - 1]);
    const h = hitFrame(t, P, d);
    if (!h) break;
    pts.push({ x: h.x, y: h.y });
    sides.push(h.side);
  }
}

// ---------- 1 rail: through-diamond rolling-ball 2-to-1 ----------
// Equal distances measured through the diamonds. Past the 5-to-2.5 line a rolling ball goes long
// (about 2/3 diamond at 9-to-4.5, fixed by aiming 1/3 diamond up table) — modelled when `correct`.
export function oneRail(t, cb, aim, aimSide, { correct = true } = {}) {
  const d = sub(aim, cb);
  const long = aimSide === 'top' || aimSide === 'bottom';
  const across = long ? t.h + 2 * DI : t.w + 2 * DI;
  const along = long ? t.w / 8 : t.h / 4;            // one diamond along this rail
  let out = reflect(d, aimSide);
  let first = hitFrame(t, aim, out);
  let lengthen = 0;
  if (correct && first) {
    const tan = Math.abs(long ? d.x / d.y : d.y / d.x);
    const tan0 = (2.5 * t.w / 8) / (t.h + 2 * DI);     // 5-to-2.5 track on a long rail
    const tan1 = (4.5 * t.w / 8) / (t.h + 2 * DI);     // 9-to-4.5
    lengthen = Math.max(0, (tan - tan0) / (tan1 - tan0)) * (2 / 3); // diamonds
    if (lengthen > 0) {
      // push the landing point on the opposite diamond line further along the direction of travel
      const n = long ? Math.abs(out.y) : Math.abs(out.x);
      const opp = { x: aim.x + out.x * across / n, y: aim.y + out.y * across / n };
      if (long) opp.x += Math.sign(out.x) * lengthen * along;
      else opp.y += Math.sign(out.y) * lengthen * along;
      out = sub(opp, aim);
      first = hitFrame(t, aim, out);
    }
  }
  const pts = [cb, aim];
  const sides = ['cb', aimSide];
  if (first) { pts.push({ x: first.x, y: first.y }); sides.push(first.side); }
  return { pts, sides, lengthen };
}

// ---------- 2 rails: Plus system (off a short rail) ----------
// Short-rail numbers: the corner on the 2nd-rail side is 1, +1 every half diamond (diamonds = 3, 5, 7).
// The CB's line shifts up the long rail by that number: arrival = origin + N.
export function plus(t, cb, S, sSide) {
  const back = hitFrame(t, cb, sub(cb, S));            // aim line extended back through the CB
  if (!back || back.side === 'left' || back.side === 'right') return { valid: false };
  const o = { flipX: sSide === 'right', nearTop: back.side === 'top' };
  const N = 1 + 2 * (4 - canonY(t, o, S.y));
  const L = canonX(t, o, back.x);
  const A = L + N;
  const dirOut = sub(back, S);                           // final leg is parallel to the first, reversed
  const Avirt = longPt(t, o, 'near', A);
  const far = lines(t)[sideOf(o, 'far')];
  const s = (far - Avirt.y) / dirOut.y;
  const B = { x: Avirt.x + dirOut.x * s, y: far };       // 2nd rail
  const bX = canonX(t, o, B.x);
  if (!(bX > 0 && bX < 8) || N < 1 || N > 7.01) return { valid: false, o, N, L, A };
  const end = hitFrame(t, B, dirOut);
  const pts = [cb, S, B, { x: end.x, y: end.y }];
  return { valid: true, o, N, L, A, origin: back, pts, sides: ['cb', sSide, sideOf(o, 'far'), end.side] };
}

// ---------- 3+ rails: Corner-5 ----------
export const BENCHMARKS = {
  typical: { label: 'Typical pool table (5 → 2 reaches the corner)', F: 2 },
  onSystem: { label: '"On system" table (5 → 3 reaches the corner)', F: 3 },
};

// Cue number D: where the aim line from the first rail through the CB crosses the near rail
// (corner 5, −½ per diamond) or the shooter-end short rail (corner 5, +1 per diamond).
export function originD(t, o, cb, Fpt) {
  const h = hitFrame(t, cb, sub(cb, Fpt));
  if (!h) return null;
  const which = whichOf(o, h.side);
  if (which === 'near') return { D: 5 - (8 - canonX(t, o, h.x)) / 2, at: h };
  if (which === 'shooterEnd') return { D: 5 + canonY(t, o, h.y), at: h };
  return null;
}

// 4th-rail track off the 3rd rail. Benchmark: the 5 → Fb track reaches the corner. Each 3rd-rail
// diamond past the benchmark moves the 4th-rail arrival about one diamond (Dead Aim: on a true table
// 3rd-rail 2 → corner, 3 → 1 diamond up the short rail; Dr. Dave: 5-3-2 lands ~1 diamond short on a
// typical table). Cue numbers below 5 run short, above 5 run long (≈⅓ diamond at 3.5 and 7).
// Up the short rail, `k` scales the distance (house calibration: Sixes 7 → ½ diamond ⇒ k = 0.5).
export function fourthRail(t, o, D, T, bench, k) {
  const Tb = 5 - BENCHMARKS[bench].F;
  const u = T - Tb + 0.2 * (D - 5);
  if (u <= 0) return { pt: longPt(t, o, 'far', Math.max(0, 8 + u)), side: sideOf(o, 'far'), u, text: u > -0.05 ? 'corner' : `${(-u).toFixed(1)} diamond from the corner (far rail)` };
  return { pt: shortPt(t, o, 'shooterEnd', Math.max(0, 4 - k * u)), side: sideOf(o, 'shooterEnd'), u, text: `${(k * u).toFixed(1)} diamond up the short rail` };
}

export function corner5(t, o, cb, F, { bench = 'typical', k = 0.5, rails = 3 } = {}) {
  const Fpt = longPt(t, o, 'far', F);
  const od = originD(t, o, cb, Fpt);
  if (!od) return { valid: false, F };
  return corner5FromD(t, o, cb, od.D, F, { bench, k, rails, origin: od.at });
}

export function corner5FromD(t, o, start, D, F, { bench = 'typical', k = 0.5, rails = 3, origin = null } = {}) {
  const T = D - F;
  const res = { D, F, T, origin, valid: T > 0.05 && T < 7.95 && F > 0.02 && F < 7.98 };
  if (!res.valid) return res;
  const Fpt = longPt(t, o, 'far', F);
  const Tpt = longPt(t, o, 'near', T);
  const fx = lines(t)[sideOf(o, 'farEnd')];
  const mir = { x: 2 * fx - Tpt.x, y: Tpt.y };                // mirror T across the far-end rail
  const s = (fx - Fpt.x) / (mir.x - Fpt.x);
  const S2 = { x: fx, y: Fpt.y + (mir.y - Fpt.y) * s };
  const fr = fourthRail(t, o, D, T, bench, k);
  res.fourth = fr;
  res.pts = [start, Fpt, S2, Tpt, fr.pt];
  res.sides = ['cb', sideOf(o, 'far'), sideOf(o, 'farEnd'), sideOf(o, 'near'), fr.side];
  if (rails > 3) continueTrack(t, res.pts, res.sides, rails - 3);
  return res;
}

// ---------- Sixes (reference lines) ----------
// Separation + 4th-rail diamond = 6, counted from the corner on the far rail at the shooter's end.
// Past 6: the house benchmark 7 → ½ diamond up the short rail (k per diamond).
export function sixesTarget(t, o, s, k = 0.5) {
  if (s <= 6) return { pt: longPt(t, o, 'far', 8 - (6 - s)), n: 6 - s, side: 'far', pocket: Math.abs(s - 6) < 0.01 };
  return { pt: shortPt(t, o, 'shooterEnd', 4 - k * (s - 6)), n: k * (s - 6), side: 'end', extrapolated: true };
}

export function sixesTrack(t, o, x0, s, k = 0.5) {
  const F = x0 - s;
  const D = 5 - (8 - x0) / 2;
  const T = D - F;
  const target = sixesTarget(t, o, s, k);
  const valid = F > 0.01 && T > 0.05 && T < 7.95;
  if (!valid) return { x0, s, F, D, T, target, valid };
  const start = longPt(t, o, 'near', x0);
  const c5 = corner5FromD(t, o, start, D, F);
  const pts = [...c5.pts.slice(0, 4), target.pt];
  return { x0, s, F, D, T, target, valid, pts };
}

// ---------- Spot on the wall (3 rails, Corner-5) ----------
// The benchmark track from the corner (D = 5) through the benchmark first-rail diamond, extended
// `widths` table widths beyond the first rail. Aiming any CB at it heads three rails to the corner.
export function corner5Spot(t, o, bench, widths = 1) {
  const C = longPt(t, o, 'near', 8);
  const Fb = longPt(t, o, 'far', BENCHMARKS[bench].F);
  const d = sub(Fb, C);
  const extra = widths * t.h / Math.abs(d.y);
  return { x: Fb.x + d.x * extra, y: Fb.y + d.y * extra };
}

// First-rail number where the line from the CB to a point crosses the far rail.
export function firstRailThrough(t, o, cb, P) {
  const far = lines(t)[sideOf(o, 'far')];
  const s = (far - cb.y) / (P.y - cb.y);
  return canonX(t, o, cb.x + (P.x - cb.x) * s);
}
