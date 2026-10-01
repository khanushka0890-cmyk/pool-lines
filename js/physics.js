// Cue-ball simulation with spin: cloth friction, slide→roll, cushion impulses, spin decay.
// Units: inches, seconds, radians.
//
// The table uses screen coordinates (y down). The simulation treats them as a right-handed
// x/y frame with z up, which is the mirror image of the real table. Rolling and follow/draw
// are mirror-safe; side spin flips sign under a mirror, so it is negated on the way in.

import { BALL_R, pocketedAt, nearestPocket, diamondOf } from './geometry.js';

const G = 386.09;          // gravity, in/s²
const MU_SLIDE = 0.2;      // ball–cloth sliding friction
const MU_ROLL = 0.010;     // rolling resistance
const SPIN_DECEL = 8;      // side-spin (z) decay, rad/s²
const MU_CUSHION = 0.25;   // effective ball–cushion friction (nose contacts above centre)
const CUSHION_ROLL_KEEP = 0.3; // share of roll-into-the-rail spin left after impact
const SQUIRT_DEG = 1.6;    // cue-ball deflection at maximum side offset (low-deflection shaft)
const DT = 0.0008;
const MAX_T = 60;
const MAX_RAILS = 40;
export const MAX_OFFSET = 0.5; // tip offset limit, fraction of R (beyond ≈ miscue)
export const MPH = 17.6;       // in/s per mph

const restitution = (vn) => Math.max(0.6, 0.82 - 0.0006 * vn);

/**
 * @param t     table
 * @param start cue-ball centre
 * @param aim   aim direction (unnormalised)
 * @param o     { speed: in/s, side: -0.5..0.5 (right +), vert: -0.5..0.5 (top +), squirt: bool }
 * @returns { points, contacts, end: {x,y}, pocket|null, rails, time }
 */
export function simulate(t, start, aim, o) {
  const R = BALL_R;
  const minX = R, maxX = t.w - R, minY = R, maxY = t.h - R;
  let d = { x: aim.x, y: aim.y };
  let L = Math.hypot(d.x, d.y) || 1;
  d = { x: d.x / L, y: d.y / L };

  // Squirt: the cue ball leaves slightly away from the side of the ball you hit.
  if (o.squirt !== false && o.side) {
    const a = Math.tan((o.side / MAX_OFFSET) * SQUIRT_DEG * Math.PI / 180); // right english → deflects left
    d = { x: d.x + a * d.y, y: d.y - a * d.x }; // left of travel on screen is (d.y, -d.x)
    L = Math.hypot(d.x, d.y);
    d = { x: d.x / L, y: d.y / L };
  }

  const V = o.speed;
  let p = { x: start.x, y: start.y };
  let v = { x: d.x * V, y: d.y * V };
  // Level cue, tip offset (a, b)·R → ω = 5·V·offset / (2R). Natural roll is b = 0.4.
  const k = 5 * V / (2 * R);
  let wx = k * o.vert * -d.y;   // ẑ × d̂ = (-d.y, d.x)
  let wy = k * o.vert * d.x;
  let wz = -k * o.side;         // mirrored frame (see header)

  const points = [{ ...p }];
  const contacts = [];
  let time = 0, sinceRec = 0, rails = 0;

  while (time < MAX_T) {
    const speed = Math.hypot(v.x, v.y);
    // Contact-point slip on the cloth: u = v + ω × (0,0,-R)
    const ux = v.x - R * wy, uy = v.y + R * wx;
    const slip = Math.hypot(ux, uy);

    if (slip > 3.5 * MU_SLIDE * G * DT) {
      const fx = -MU_SLIDE * G * ux / slip, fy = -MU_SLIDE * G * uy / slip; // accel
      v.x += fx * DT; v.y += fy * DT;
      wx += (5 / (2 * R)) * fy * DT;
      wy += -(5 / (2 * R)) * fx * DT;
    } else {
      if (speed < 0.3) break;
      const dec = Math.min(MU_ROLL * G * DT, speed);
      v.x -= dec * v.x / speed; v.y -= dec * v.y / speed;
      wx = -v.y / R; wy = v.x / R; // rolling
    }
    if (wz) { const dz = SPIN_DECEL * DT; wz = Math.abs(wz) <= dz ? 0 : wz - Math.sign(wz) * dz; }

    p.x += v.x * DT; p.y += v.y * DT;
    time += DT; sinceRec += DT;

    // Cushions
    let rail = null;
    if (p.x < minX) { p.x = minX; rail = 'left'; }
    else if (p.x > maxX) { p.x = maxX; rail = 'right'; }
    if (p.y < minY) { p.y = minY; rail = 'top'; }
    else if (p.y > maxY) { p.y = maxY; rail = 'bottom'; }

    if (rail) {
      if (pocketedAt(t, rail, p)) {
        const pk = nearestPocket(t, p);
        points.push({ ...p }, { x: pk.x, y: pk.y });
        return { points, contacts, end: { x: pk.x, y: pk.y }, pocket: pk, rails, time };
      }
      const n = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[rail];
      const vn = v.x * n.x + v.y * n.y;
      if (vn > 0) {
        const tx = -n.y, ty = n.x;                      // tangent
        const vt = v.x * tx + v.y * ty;
        // contact-point tangential slip from side spin: ω_z ẑ × (R n)
        const ut = vt + R * wz * (-n.y * tx + n.x * ty);
        const e = restitution(vn);
        const Jn = (1 + e) * vn;                        // normal impulse / m
        const Jt = -Math.sign(ut) * Math.min(MU_CUSHION * Jn, (2 / 7) * Math.abs(ut));
        v.x += -Jn * n.x + Jt * tx;
        v.y += -Jn * n.y + Jt * ty;
        wz += 2.5 * (n.x * (Jt * ty) - n.y * (Jt * tx)) / R;
        // The nose contacts above centre, so the cushion takes most of the roll toward it off.
        const mx = -n.y, my = n.x;                      // ẑ × n
        const cRoll = wx * mx + wy * my;
        const dRoll = (CUSHION_ROLL_KEEP - 1) * cRoll;
        wx += dRoll * mx; wy += dRoll * my;
        rails++;
        points.push({ ...p });
        contacts.push({ x: p.x, y: p.y, rail, diamond: diamondOf(t, rail, p), speed: Math.hypot(v.x, v.y) });
        sinceRec = 0;
        if (rails >= MAX_RAILS) break;
      }
    }
    if (sinceRec > 0.012) { points.push({ ...p }); sinceRec = 0; }
  }
  points.push({ ...p });
  return { points, contacts, end: { ...p }, pocket: null, rails, time };
}
