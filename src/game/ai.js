/**
 * The opponent.
 *
 * Runs inside the simulation and reads nothing but the state, the same as in
 * websoccer and for the same reason: an AI that reached outside would make
 * different decisions on two machines and the online match would come apart.
 *
 * What it does is what a player does - work out where the ball is going to land,
 * get there, and swing - and the difficulty settings change how well it does
 * each of those rather than making the ball behave differently for it.
 */

import {
  AIR_DRAG, BOUNCE, BOUNCE_FRICTION, CHARGE_MAX, COURT, DRIVE_DEPTH, DRIVE_FROM, DT,
  GRAVITY, REACH, SPIN_DRIFT,
} from '../constants.js';
import { clamp, randRange } from '../util.js';
import { ownBaseline, servingRight, serviceBox } from './state.js';

/**
 * Where the ball will next come down on this player's side, by playing the
 * flight forward. Cheap enough at sixty ticks a second, and exact rather than a
 * guess, which matters: an opponent who mispredicts looks broken rather than
 * beatable, and the levers for making it beatable are elsewhere.
 */
export function predictLanding(state, side, { skipFirst = false, maxTicks = 300 } = {}) {
  const b = state.ball;
  let { x, y, z, vx, vy, vz } = b;
  let spin = b.spin;
  let bounces = 0;
  let seenMine = 0;
  for (let t = 0; t < maxTicks; t++) {
    vx += spin * SPIN_DRIFT * DT;
    vx -= vx * AIR_DRAG * DT;
    vy -= vy * AIR_DRAG * DT;
    vz -= GRAVITY * DT;
    x += vx * DT;
    y += vy * DT;
    z += vz * DT;
    if (z <= 0 && vz < 0) {
      bounces++;
      const mine = side > 0 ? y > COURT.cy : y < COURT.cy;
      if (mine) seenMine++;
      // Standing on the spot where it first lands is standing where the ball
      // has already gone: it bounces on past you. What a returner wants is the
      // place it comes down again, which is where he can hit it.
      const wanted = skipFirst ? 2 : 1;
      if ((mine && seenMine >= wanted) || bounces >= 3) return { x, y, ticks: t, bounces };
      z = 0;
      vz = -vz * BOUNCE;
      vx *= BOUNCE_FRICTION;
      vy *= BOUNCE_FRICTION;
      spin *= 0.4;
    }
  }
  return { x, y, ticks: maxTicks, bounces };
}

/** Somewhere to stand when nothing is happening: middle of the baseline. */
function readySpot(player) {
  return { x: COURT.cx, y: ownBaseline(player) - player.dir * 34 };
}

export function aiIntent(state, i) {
  const p = state.players[i];
  const b = state.ball;
  const skill = p.ai;
  const intent = {
    x: 0, y: 0, swing: false, toss: false, aim: { x: 0, y: 0 }, power: 0,
  };

  // --- Serving -------------------------------------------------------------
  if (state.phase === 'serve' && state.server === i) {
    if (!p.tossing) {
      if (state.phaseTimer === 0) intent.toss = true;
      return intent;
    }
    // Hit it on the way down, near the top of the reach.
    if (b.vz < 0 && b.z < 150) {
      const box = serviceBox(state);
      const wide = servingRight(state) ? 1 : -1;
      // Out wide or down the middle, alternately, with the level's inaccuracy.
      const corner = (state.games[i] + state.points[i]) % 2 === 0 ? wide * 0.7 : -wide * 0.2;
      intent.swing = true;
      intent.power = CHARGE_MAX * clamp(skill.windup, 0.3, 1);
      intent.aim = {
        x: corner + randRange(state, -1, 1) * (skill.aimError / 95),
        y: randRange(state, -1, 1) * (skill.aimError / 260),
      };
      void box;
    }
    return intent;
  }

  if (state.phase !== 'rally') return intent;

  // --- Getting there -------------------------------------------------------
  const coming = state.lastHitter !== null && state.lastHitter !== i;
  // Before it has landed on our side we want the spot after the bounce; once it
  // has bounced, the next landing is that spot.
  const landing = coming
    ? predictLanding(state, p.dir, { skipFirst: state.bounces === 0 })
    : null;
  const spot = landing && landing.ticks < 240
    ? { x: landing.x, y: landing.y }
    : readySpot(p);

  // A worse player sets off later. Reading the shot the moment it is struck is
  // most of what makes a good player look quick, so this is a delay rather than
  // a speed: he stands there for a beat while the ball is already on its way.
  const struck = state.lastHitTick || 0;
  const late = state.tick - struck < skill.reactTicks;
  if (!late) {
    const dx = spot.x - p.x;
    const dy = spot.y - p.y;
    const away = Math.hypot(dx, dy);
    if (away > 6) {
      intent.x = dx / away;
      intent.y = dy / away;
    }
  }

  // --- Swinging ------------------------------------------------------------
  const reachable = Math.hypot(b.x - p.x, b.y - p.y) < REACH * 0.8 && b.z < 130;
  const mySide = p.dir > 0 ? b.y > COURT.cy : b.y < COURT.cy;
  const arriving = coming && b.live && mySide && state.bounces < 2;
  // Wait for a ball worth hitting. Swinging the moment it comes within reach
  // means taking it high and early, off balance, and the shot that comes out of
  // that is poor - which produced a result that made no sense until it was
  // looked at: giving a level a *shorter* reach made it stronger, because being
  // unable to lunge forced it to let the ball come. So everyone lets it come:
  // after the bounce, or low enough to be a volley worth playing.
  const worthHitting = state.bounces >= 1 ? b.z < 95 : b.z < 55;
  if (arriving && reachable && worthHitting && p.swing === 0 && p.cooldown === 0) {
    // Aim away from where the other player is standing.
    const them = state.players[1 - i];
    const side = them.x > COURT.cx ? -1 : 1;
    // Not clamped into the court: an opponent who cannot hit the ball out is an
    // opponent who never loses a point, and this is where the levels differ.
    // Divided by less than it used to be, because aim now moves the ball less:
    // softening the stick softened the CPU's mistakes with it, and easy stopped
    // spraying the ball out - which was the whole difference between the levels.
    const error = randRange(state, -1, 1) * (skill.aimError / 58);
    intent.swing = true;
    intent.power = CHARGE_MAX * clamp(skill.windup - 0.15 + randRange(state, 0, 0.3), 0.1, 1);
    // Aims shorter the harder it hits, because pace now costs depth: without
    // this the better levels would drive every ball over the baseline.
    const drive = Math.max(0, skill.windup - DRIVE_FROM) / (1 - DRIVE_FROM);
    const shorter = clamp((0.77 - 0.62 - drive * DRIVE_DEPTH) / 0.18, -1.3, 0.6);
    intent.aim = { x: side * 0.7 + error, y: -p.dir * shorter + error * 0.3 };
  }
  return intent;
}
