// Published aiming systems, worked in a canonical "diamond frame".
//
// Canonical frame (diamonds): X 0..8 along the long rails, Y 0..4 across.
//   Y = 0  near long rail (the one closest to the shooter, where the CB starts)
//   Y = 4  far long rail (first rail of the kick)
//   X = 8  shooter-end short rail,  X = 0  far-end short rail
// An orientation { flipX, nearTop } maps the canonical frame onto the real table.
//
// Sources:
//   Corner-5 — Dr. Dave Alciatore, Billiards Digest Nov 2010 – Jan 2011 ("VEPS GEMS XI–XIII")
//   Sixes    — Patrick Johnson, AZBilliards "3-Rail Kick Tracks"
//   Spot on the wall — Dr. Dave, Billiards Digest Feb 2011 and Mar 2023

import { BALL_R } from './geometry.js';

// ---------- frame mapping ----------
export function toScreen(t, o, P) {
  const R = BALL_R;
  let x = P.X * t.w / 8;
  if (o.flipX) x = t.w - x;
  const span = t.h - 2 * R;
  const y = o.nearTop ? R + P.Y * span / 4 : t.h - R - P.Y * span / 4;
  return { x, y };
}

// Same, but clamped onto the ball-centre track (for points that sit on a cushion).
export function railScreen(t, o, P) {
  const p = toScreen(t, o, P);
  return { x: Math.min(Math.max(p.x, BALL_R), t.w - BALL_R), y: p.y };
}

export function toCanon(t, o, p) {
  const R = BALL_R;
  let X = p.x * 8 / t.w;
  if (o.flipX) X = 8 - X;
  const span = t.h - 2 * R;
  const Y = o.nearTop ? (p.y - R) * 4 / span : (t.h - R - p.y) * 4 / span;
  return { X, Y };
}

// ---------- Corner-5 ----------
// Benchmark: which first-rail number from the corner (D = 5) sends the CB to the
// cross-corner pocket off the 3rd rail.
export const BENCHMARKS = {
  typical: { label: 'Typical pool table (5 → 2 reaches the corner)', F: 2 },
  onSystem: { label: '"On system" table (5 → 3 reaches the corner)', F: 3 },
};

// Direction the CB leaves the 3rd rail: parallel to the benchmark track off the 3rd rail.
export function benchDir(benchKey) {
  const Fb = BENCHMARKS[benchKey].F;
  const Tb = 5 - Fb;                 // benchmark 3rd-rail number
  return { dX: 8 - Tb, dY: 4 };      // from (Tb, 0) to the corner (8, 4)
}

// Cue-ball origination number D: extend the aim line from the first rail back through the CB
// to the rail nearest the shooter. Corner = 5; +1 per diamond up the short rail; −½ per diamond
// along the long rail.
export function originNumber(cb, F) {
  const dX = cb.X - F, dY = cb.Y - 4;          // from (F,4) toward the CB
  if (dY >= -1e-9) return null;                // CB must be below the first rail
  const s = (0 - 4) / dY;                       // reach Y = 0
  const X0 = F + dX * s;
  if (X0 <= 8) return { D: 5 - (8 - X0) / 2, at: { X: X0, Y: 0 } };
  const s2 = (8 - F) / dX;                      // reach X = 8 instead
  const Y8 = 4 + dY * s2;
  return { D: 5 + Y8, at: { X: 8, Y: Y8 } };
}

// Full Corner-5 track: CB → F (rail 1) → short rail (rail 2) → T (rail 3) → 4th rail.
export function corner5Track(cb, F, benchKey) {
  const o = originNumber(cb, F);
  if (!o) return null;
  const T = o.D - F;
  const res = { D: o.D, F, T, origin: o.at, valid: T > 0.05 && T < 7.95 && F > 0 && F < 8 };
  if (!res.valid) return res;
  const y2 = 4 * T / (F + T);                   // mirror of (T,0) across X = 0
  const dir = benchDir(benchKey);
  res.points = [{ ...cb }, { X: F, Y: 4, rail: 1 }, { X: 0, Y: y2, rail: 2 }, { X: T, Y: 0, rail: 3 }];
  res.fourth = fourthRail({ X: T, Y: 0 }, dir);
  res.points.push({ ...res.fourth, rail: 4 });
  return res;
}

// Where a leg leaving the near rail at P in direction d first meets a rail.
export function fourthRail(P, d) {
  const sTop = (4 - P.Y) / d.dY;
  const Xtop = P.X + d.dX * sTop;
  if (Xtop <= 8) return { X: Xtop, Y: 4, side: 'far', n: Xtop, pocket: Xtop > 7.7 };
  const s8 = (8 - P.X) / d.dX;
  const Y8 = P.Y + d.dY * s8;
  return { X: 8, Y: Y8, side: 'end', n: Y8, pocket: Y8 > 3.7 };
}

// Find the first-rail number F that sends the CB to 3rd-rail number T.
export function solveF(cb, T) {
  const g = (F) => { const o = originNumber(cb, F); return o ? o.D - F - T : NaN; };
  let lo = 0.02, hi = 7.98, glo = g(lo), ghi = g(hi);
  // scan for a sign change (g is monotonic in practice, but be safe)
  if (!(glo * ghi < 0)) {
    let prev = lo, gp = glo, found = false;
    for (let F = lo + 0.1; F <= hi; F += 0.1) {
      const gf = g(F);
      if (gp * gf < 0) { lo = prev; hi = F; glo = gp; found = true; break; }
      prev = F; gp = gf;
    }
    if (!found) return null;
  }
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2, gm = g(mid);
    if (glo * gm <= 0) hi = mid; else { lo = mid; glo = gm; }
  }
  return (lo + hi) / 2;
}

// ---------- Sixes (reference lines) ----------
// Separation (diamonds between a near-rail point and a far-rail point) + 4th-rail diamond = 6,
// counted from the corner pocket (0) on the far rail at the shooter's end.
// Beyond 6, the user's benchmark: separation 7 → ½ diamond up the short rail.
export function sixesTarget(s) {
  if (s <= 6) return { X: 8 - (6 - s), Y: 4, side: 'far', n: 6 - s, pocket: s >= 5.85 && s <= 6.15 };
  const fromCorner = 0.5 * (s - 6);
  return { X: 8, Y: 4 - fromCorner, side: 'end', n: fromCorner, pocket: false, extrapolated: true };
}

export function sixesTrack(x0, s) {
  const F = x0 - s;
  const D = 5 - (8 - x0) / 2;
  const T = D - F;
  const target = sixesTarget(s);
  const valid = F > 0.01 && T > 0.05 && T < 7.95;
  if (!valid) return { x0, s, F, D, T, target, valid };
  const y2 = 4 * T / (F + T);
  return {
    x0, s, F, D, T, target, valid,
    points: [{ X: x0, Y: 0 }, { X: F, Y: 4, rail: 1 }, { X: 0, Y: y2, rail: 2 }, { X: T, Y: 0, rail: 3 }, { ...target, rail: 4 }],
  };
}

// ---------- Spot on the wall ----------
// 3-rail (Corner-5) spot: the benchmark aim line from the corner (D = 5) through the
// benchmark first-rail diamond, extended `widths` table widths beyond the first rail.
export function corner5Spot(benchKey, widths = 1) {
  const Fb = BENCHMARKS[benchKey].F;
  const Y = 4 + 4 * widths;
  const X = 8 + (Fb - 8) * (Y / 4);
  return { X, Y };
}

// First-rail number where the line CB → spot crosses the far rail.
export function aimThrough(cb, spot) {
  const s = (4 - cb.Y) / (spot.Y - cb.Y);
  return cb.X + (spot.X - cb.X) * s;
}
