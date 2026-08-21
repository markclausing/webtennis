/**
 * step(): the only place the match changes.
 *
 * Pure and deterministic - same state plus same buttons gives the same result on
 * any machine - which is what lets two browsers play each other by swapping
 * nothing but their buttons, and what lets the whole thing be tested in node.
 *
 * The rules of tennis are mostly about where the ball lands and how often it has
 * bounced, so that is what this keeps track of: who hit it last, how many times
 * it has bounced since, and whether it was in.
 */

import {
  AIR_DRAG, BALL_R, BOUNCE, BOUNCE_FRICTION, BTN, CHARGE_MAX, COURT, DT, GRAVITY,
  LOB_CHARGE, NET_H, PLAYER_ACC, PLAYER_DAMP, PLAYER_R, PLAYER_SPEED, POINT_TICKS,
  AFTERTOUCH_TICKS, AT_LIFT, AT_SIDE, BASE_ANGLE, DRIVE_DEPTH, DRIVE_FROM, NET_ANGLE,
  PACE_COST, PACE_FREE, PACE_SPAN, REACH, RUNOFF,
  RUSHED_AIM, RUSHED_LIFT, RUSHED_SCATTER, SERVE_MAX, SERVE_MIN,
  SHOT_MAX, SHOT_MIN, SPIN_DRIFT, SWING_COOLDOWN, SWING_TICKS, SWING_WINDOW,
  TOSS_HEIGHT, TOSS_TICKS, WORLD_H, WORLD_W,
} from '../constants.js';
import { clamp, len, norm, randRange } from '../util.js';
import { maskToDir } from '../input.js';
import { aiIntent } from './ai.js';
import {
  awardPoint, farBaseline, ownBaseline, serviceBox, setupServe,
} from './state.js';

export function step(state, inputs) {
  // Cleared before anything else, including the early return: an event left
  // standing would be replayed by the game loop on every frame.
  state.events.length = 0;
  if (state.phase === 'over') return state;

  state.tick++;
  if (state.phaseTimer > 0) state.phaseTimer--;

  if (state.phase === 'point') {
    if (state.phaseTimer === 0) setupServe(state);
    return state;
  }

  // 1. Everybody decides what to do, from the same snapshot.
  const intents = state.players.map((p, i) => (p.human
    ? humanIntent(state, i, inputs[i] | 0)
    : aiIntent(state, i)));

  // 2. Swings start, and connect if the ball is there.
  for (let i = 0; i < 2; i++) {
    const p = state.players[i];
    if (p.cooldown > 0) p.cooldown--;
    if (p.swing > 0) p.swing--;
    if (intents[i].swing && p.swing === 0 && p.cooldown === 0) {
      p.swing = SWING_TICKS;
      p.charge = intents[i].power || 0;
      state.events.push({ type: 'swing', player: i });
    }
    if (intents[i].toss) startToss(state, i);
  }
  for (let i = 0; i < 2; i++) tryHit(state, i, intents[i]);

  // 3. And then everybody moves.
  for (let i = 0; i < 2; i++) movePlayer(state, i, intents[i]);
  steerBall(state, inputs);
  moveBall(state);

  return state;
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

function humanIntent(state, i, mask) {
  const p = state.players[i];
  const dir = maskToDir(mask);
  const fire = (mask & BTN.FIRE) !== 0;
  const wasFire = (p.prevMask & BTN.FIRE) !== 0;
  p.prevMask = mask;

  const intent = {
    x: dir.x,
    y: dir.y,
    swing: false,
    toss: false,
    aim: dir,
    power: 0,
    // The second button is a lob: the same shot given far longer to arrive,
    // which is the answer to somebody standing at the net.
    lob: (mask & BTN.SWITCH) !== 0,
  };

  const serving = state.phase === 'serve' && state.server === i;
  if (serving && !p.tossing) {
    // The first press throws the ball up; the second hits it.
    if (fire && !wasFire && state.phaseTimer === 0) intent.toss = true;
    return intent;
  }

  // Holding the button is winding up, not waiting to fire: the shot goes off
  // when the ball arrives, with however much wind-up you have by then. Letting
  // go early commits you to a swing that stays open for a moment and then
  // misses, which is the price of guessing.
  if (fire && !wasFire) {
    p.charging = true;
    p.charge = 0;
    p.aimX = 0;
    p.aimY = 0;
    p.aimTicks = 0;
  }
  if (p.charging) {
    p.charge = Math.min(p.charge + 1, CHARGE_MAX);
    // Where the shot goes is the average of the direction you held while winding
    // up, not the direction you happen to be holding at the moment of contact.
    //
    // This is where the fine control comes from. The stick has eight positions
    // and nothing in between, so an instantaneous reading gives you three
    // choices per side and no feel at all. Held for a quarter of the wind-up it
    // is a quarter of the angle; held throughout it is all of it - and that is a
    // dial you can learn.
    p.aimX += dir.x;
    p.aimY += dir.y;
    p.aimTicks++;
    if (!fire) {
      p.charging = false;
      p.swing = Math.max(p.swing, SWING_WINDOW);
    }
  }
  const held = Math.max(1, p.aimTicks || 0);
  intent.aim = { x: (p.aimX || 0) / held, y: (p.aimY || 0) / held };
  intent.swinging = p.charging || p.swing > 0;
  intent.power = p.charge;
  return intent;
}

// ---------------------------------------------------------------------------
// Hitting
// ---------------------------------------------------------------------------

function startToss(state, i) {
  const p = state.players[i];
  const b = state.ball;
  if (state.phase !== 'serve' || state.server !== i || p.tossing) return;
  p.tossing = true;
  p.tossTicks = TOSS_TICKS;
  b.x = p.x + 8 * (p.dir > 0 ? 1 : -1);
  b.y = p.y;
  b.z = 30;
  b.vx = 0;
  b.vy = 0;
  b.vz = Math.sqrt(2 * GRAVITY * TOSS_HEIGHT);
  b.live = true;
  state.events.push({ type: 'toss', player: i });
}

/** Can this player reach the ball, and is he swinging at it? */
function tryHit(state, i, intent) {
  const p = state.players[i];
  const b = state.ball;
  const ready = p.swing > 0 || p.charging;
  if (!ready || p.cooldown > 0 || !b.live) return;
  if (state.bounces >= 2) return; // already a point, whatever he does now

  const serving = state.phase === 'serve' && state.server === i;
  if (serving && !p.tossing) return;
  if (!serving && state.lastHitter === i && state.bounces === 0) return; // you cannot hit it twice

  // A weaker opponent simply cannot stretch as far. Blunt, but it is the one
  // handicap that cannot backfire: reaction time and running speed stopped
  // mattering once the receiver stood in the right place, and taking pace off
  // his shots made him *better*, because a slow ball is awkward to time.
  const stretch = p.human ? REACH : REACH * (p.ai.reach ?? 1);
  const away = Math.hypot(b.x - p.x, b.y - p.y);
  if (away > stretch || b.z > 150) return;
  // The ball has to be on your own side, unless you are reaching over to volley
  // one that has not landed yet.
  const mySide = p.dir > 0 ? b.y > COURT.cy : b.y < COURT.cy;
  if (!mySide) return;

  hit(state, i, intent, serving);
}

function hit(state, i, intent, serving) {
  const p = state.players[i];
  const b = state.ball;
  const charge = clamp(p.charging || p.swing > 0 ? p.charge : (intent.power || 0), 0, CHARGE_MAX);
  // The pace on the ball takes some of your preparation away with it: a ball
  // struck flat out at you is awkward however early you started, which is what
  // makes hitting hard worth anything against someone who gets to everything.
  const incoming = serving ? 0 : len(b.vx, b.vy);
  const rushed = clamp((incoming - PACE_FREE) / PACE_SPAN, 0, 1) * PACE_COST;
  const t = clamp(charge / CHARGE_MAX - rushed, 0, 1);

  // Where he is aiming: the stick picks a spot across the court and how deep,
  // and the wind-up pushes it deeper still.
  const aim = intent.aim && (intent.aim.x || intent.aim.y) ? intent.aim : { x: 0, y: 0 };
  const target = aimPoint(state, i, aim, serving, t);
  // A shot thrown at the ball at the last moment goes where it likes. This is
  // deterministic - it comes out of state.rng - so both machines in an online
  // match scatter it identically.
  const scatter = RUSHED_SCATTER * (1 - t) * (COURT.right - COURT.cx);
  if (scatter > 0.5) {
    target.x += randRange(state, -scatter, scatter);
    target.y += randRange(state, -scatter, scatter) * 0.5;
  }

  const dx = target.x - b.x;
  const dy = target.y - b.y;
  const flat = Math.max(40, Math.hypot(dx, dy));
  const speed = serving
    ? SERVE_MIN + (SERVE_MAX - SERVE_MIN) * t
    : SHOT_MIN + (SHOT_MAX - SHOT_MIN) * t;

  // Time of flight, and from that the height it has to be hit at to land there.
  // A lob is the same shot given longer to arrive.
  const lofted = !serving && (intent.lob || charge > LOB_CHARGE);
  const flight = (flat / speed) * (lofted ? 1.75 : 1);
  b.spin = aim.x * 0.6;

  // Aimed at the spot it should finish on, not the spot it starts towards.
  //
  // Two things bend a shot away from a straight line: the spin, which pushes it
  // sideways all the way down, and the air, which takes the pace off. Launching
  // straight at the target and letting those happen afterwards put nearly every
  // ball wide - measured, twenty-six out of twenty-six errors were past the
  // sideline, all of them in the direction of the spin. So the launch is solved
  // backwards from where it has to land: the ball still curves, it simply
  // curves onto the target instead of past it.
  const drift = 0.5 * b.spin * SPIN_DRIFT * flight * flight;
  const slowing = 1 - Math.min(0.45, AIR_DRAG * flight * 0.5);
  b.vx = (dx - drift) / flight / slowing;
  b.vy = dy / flight / slowing;
  // A late swing gets under the ball less, so it leaves flatter than the arc it
  // was aimed along - and a flat ball from the back of the court finds the net.
  // This is the punishment for being late that a player can actually read: the
  // ball goes into the tape rather than mysteriously somewhere else.
  const lift = serving ? 1 : RUSHED_LIFT + (1 - RUSHED_LIFT) * t;
  b.vz = ((0 - b.z) / flight + 0.5 * GRAVITY * flight) * lift;
  b.live = true;

  state.lastHitter = i;
  state.lastHitTick = state.tick;
  state.steering = { player: i, ticks: AFTERTOUCH_TICKS };
  state.bounces = 0;
  state.rallyLength++;
  state.wasServe = serving;
  p.cooldown = SWING_COOLDOWN;
  p.swing = 0;
  p.tossing = false;
  p.faceY = -p.dir;

  if (serving) {
    state.phase = 'rally';
    state.message = '';
  }
  state.events.push({
    type: 'hit', player: i, serve: serving, power: speed, lob: lofted,
  });
}

/**
 * The spot he is aiming at. Straight ahead by default, wider and deeper or
 * shorter as the stick asks.
 *
 * Deliberately allowed past the lines. An earlier version clamped the target
 * into the court, which reads as generous and is actually ruinous: a player who
 * cannot aim out cannot miss, the CPU made no errors at any level, and easy and
 * hard finished level with each other because the only thing separating them
 * was how prettily they placed a ball that always went in.
 */
function aimPoint(state, i, aim, serving, power = 0) {
  const p = state.players[i];
  const far = farBaseline(p);
  if (serving) {
    const box = serviceBox(state);
    const midY = (box.y0 + box.y1) / 2;
    const spread = (box.x1 - box.x0) / 2 - 18;
    return {
      x: (box.x0 + box.x1) / 2 + aim.x * spread,
      y: midY + aim.y * -p.dir * 40,
    };
  }
  // Both of these are deliberately short of the lines. Aim alone should not be
  // able to put the ball out: you get to the corners by adding aftertouch, which
  // is a thing you choose to do rather than a thing that happens because you were
  // holding a direction to reach the ball in the first place.
  // Hitting hard sends it deep, and past a point it sends it long.
  //
  // Power used to cost nothing: the flight was solved to land on the target
  // whatever the pace, so a full swing was simply better than a half one. Now
  // the last part of the wind-up buys pace and spends depth, and a shot struck
  // as hard as it can be struck goes over the baseline unless you take
  // something off it - which is what aftertouch backwards is for.
  const drive = Math.max(0, power - DRIVE_FROM) / (1 - DRIVE_FROM);
  const depth = 0.62 + (aim.y * -p.dir) * 0.18 + drive * DRIVE_DEPTH;
  // How much of your placement survives depends on how ready you were - and how
  // sharp an angle is available depends on how far up the court you are standing.
  const control = RUSHED_AIM + (1 - RUSHED_AIM) * power;
  const fromNet = clamp(Math.abs(p.y - COURT.cy) / Math.abs(far - COURT.cy), 0, 1);
  const angle = NET_ANGLE - (NET_ANGLE - BASE_ANGLE) * fromNet;
  return {
    x: COURT.cx + aim.x * (COURT.right - COURT.cx) * angle * control,
    // From the net a sharp angle lands short by definition, so the shortest
    // target allowed comes forward with you.
    y: COURT.cy + (far - COURT.cy) * clamp(depth, 0.32 - (1 - fromNet) * 0.22, 1.14),
  };
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function movePlayer(state, i, intent) {
  const p = state.players[i];
  const handicap = p.human ? 1 : p.ai.speed;

  // Winding up plants him. While the button is held the stick is not steering
  // his feet at all, it is shaping the shot - which is the only way one stick
  // can do both jobs without fighting itself. It also decides what the wind-up
  // is worth: the earlier you commit, the longer you have to work on the ball,
  // and the price is that you have to be standing in the right place already.
  if (p.charging) {
    p.vx *= PLAYER_DAMP * 0.7;
    p.vy *= PLAYER_DAMP * 0.7;
    if (Math.abs(intent.x) + Math.abs(intent.y) > 0.02) {
      p.faceX = intent.x;
      p.faceY = intent.y;
    }
    p.x = clamp(p.x + p.vx * DT, PLAYER_R, WORLD_W - PLAYER_R);
    p.y = clamp(p.y + p.vy * DT, PLAYER_R, WORLD_H - PLAYER_R);
    return;
  }

  const speed = PLAYER_SPEED * handicap * (p.swing > 0 ? 0.6 : 1);
  const l = len(intent.x, intent.y);
  if (l > 0.02) {
    p.faceX = intent.x / l;
    p.faceY = intent.y / l;
    p.vx += clamp(intent.x * speed - p.vx, -PLAYER_ACC * DT, PLAYER_ACC * DT);
    p.vy += clamp(intent.y * speed - p.vy, -PLAYER_ACC * DT, PLAYER_ACC * DT);
  } else {
    p.vx *= PLAYER_DAMP;
    p.vy *= PLAYER_DAMP;
  }
  p.x = clamp(p.x + p.vx * DT, PLAYER_R, WORLD_W - PLAYER_R);
  // You may not walk through the net, and there is only so much room behind you.
  const minY = p.dir > 0 ? COURT.cy + PLAYER_R : RUNOFF * 0.2;
  const maxY = p.dir > 0 ? WORLD_H - RUNOFF * 0.2 : COURT.cy - PLAYER_R;
  p.y = clamp(p.y + p.vy * DT, minY, maxY);
}

/**
 * Aftertouch: for a second after you hit it, you can still bend the ball.
 *
 * Sideways curves it; forward drives it on and back takes the pace off, which
 * is the difference between a shot that lands on the line and one that sails
 * over it. Only the player who hit it, only while it is in the air, and only a
 * human - the CPU aims once and lives with it.
 */
function steerBall(state, inputs) {
  const steer = state.steering;
  if (!steer) return;
  steer.ticks--;
  if (steer.ticks <= 0) {
    state.steering = null;
    return;
  }
  const p = state.players[steer.player];
  if (!p.human) return;
  const b = state.ball;
  if (!b.live || b.z <= 0.5 || state.bounces > 0) return;

  const dir = maskToDir(inputs[steer.player] | 0);
  if (!dir.x && !dir.y) return;
  const bd = norm(b.vx, b.vy);
  if (bd.l < 20) return;

  const cross = bd.x * dir.y - bd.y * dir.x; // how much of it is sideways
  const along = bd.x * dir.x + bd.y * dir.y; // and how much is along the ball
  b.vx += -bd.y * cross * AT_SIDE * DT;
  b.vy += bd.x * cross * AT_SIDE * DT;
  b.vz += along * AT_LIFT * DT;
}

function moveBall(state) {
  const b = state.ball;
  const server = state.players[state.server];

  if (!b.live) {
    // Waiting to serve: the ball sits in his hand.
    b.x = server.x + 8 * (server.dir > 0 ? 1 : -1);
    b.y = server.y;
    b.z = 22;
    return;
  }

  if (server.tossing && state.phase === 'serve') {
    // Straight up and straight down, and it stays with him.
    b.x = server.x + 8 * (server.dir > 0 ? 1 : -1);
    b.y = server.y;
    b.vz -= GRAVITY * DT;
    b.z += b.vz * DT;
    server.tossTicks--;
    if (b.z <= 22 || server.tossTicks <= 0) {
      // He let it drop. No penalty - a player may catch a toss - so it goes back
      // in his hand and he can start again.
      server.tossing = false;
      b.live = false;
      b.vz = 0;
      b.z = 22;
    }
    return;
  }

  const wasSide = Math.sign(b.y - COURT.cy);
  b.vx += b.spin * SPIN_DRIFT * DT;
  b.vx -= b.vx * AIR_DRAG * DT;
  b.vy -= b.vy * AIR_DRAG * DT;
  b.vz -= GRAVITY * DT;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;

  // The net. Crossing the middle below the top of it ends the point there.
  const nowSide = Math.sign(b.y - COURT.cy);
  if (wasSide !== 0 && nowSide !== 0 && wasSide !== nowSide && b.z < NET_H) {
    b.y = COURT.cy;
    b.z = Math.max(0, b.z);
    b.vy = 0;
    b.vx *= 0.2;
    b.live = false;
    state.events.push({ type: 'net' });
    faultOrPoint(state, 'NET');
    return;
  }

  if (b.z <= 0 && b.vz < 0) {
    b.z = 0;
    b.vz = -b.vz * BOUNCE;
    b.vx *= BOUNCE_FRICTION;
    b.vy *= BOUNCE_FRICTION;
    b.spin *= 0.4;
    state.bounces++;
    state.events.push({ type: 'bounce', bounces: state.bounces, x: b.x, y: b.y });
    judgeBounce(state);
    return;
  }

  // Gone off the end of the world. What that means depends on whether it had
  // already landed: a ball that bounced in and then ran away is a ball nobody
  // returned, and the point belongs to whoever hit it. Only a ball that leaves
  // without landing at all is out.
  if (b.x < -BALL_R || b.x > WORLD_W + BALL_R || b.y < -BALL_R || b.y > WORLD_H + BALL_R) {
    b.live = false;
    if (state.bounces >= 1 && state.lastHitter !== null) {
      endPoint(state, state.lastHitter, state.wasServe ? 'ACE' : 'WINNER');
    } else {
      outOrPoint(state, 'OUT');
    }
  }
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

function inSinglesCourt(b, side) {
  const inX = b.x >= COURT.left && b.x <= COURT.right;
  const inY = side > 0 ? (b.y > COURT.cy && b.y <= COURT.bottom) : (b.y >= COURT.top && b.y < COURT.cy);
  return inX && inY;
}

function inServiceBox(state, b) {
  const box = serviceBox(state);
  return b.x >= box.x0 && b.x <= box.x1 && b.y >= box.y0 && b.y <= box.y1;
}

/** Called on every bounce: the first one decides whether the shot was any good. */
function judgeBounce(state) {
  const b = state.ball;
  const hitter = state.lastHitter;
  if (hitter === null) return;

  if (state.bounces === 1) {
    if (state.wasServe) {
      if (!inServiceBox(state, b)) {
        b.live = false;
        faultOrPoint(state, 'FAULT');
      }
      return;
    }
    // A rally shot has to land in the other half of the singles court.
    const theirSide = -state.players[hitter].dir;
    if (!inSinglesCourt(b, theirSide)) {
      b.live = false;
      outOrPoint(state, 'OUT');
    }
    return;
  }

  if (state.bounces === 2) {
    // Nobody got to it: the point goes to whoever hit it.
    b.live = false;
    endPoint(state, hitter, state.wasServe ? 'ACE' : 'WINNER');
  }
}

/** A serve that missed: second serve, or a double fault. */
function faultOrPoint(state, why) {
  if (state.wasServe || state.phase === 'serve') {
    if (state.serveNumber === 1) {
      state.serveNumber = 2;
      state.events.push({ type: 'fault', number: 1 });
      state.phase = 'point';
      state.phaseTimer = Math.round(POINT_TICKS * 0.5);
      state.message = 'FAULT';
      return;
    }
    state.events.push({ type: 'fault', number: 2 });
    endPoint(state, 1 - state.server, 'DOUBLE FAULT');
    return;
  }
  endPoint(state, 1 - state.lastHitter, why);
}

function outOrPoint(state, why) {
  if (state.wasServe) {
    faultOrPoint(state, 'FAULT');
    return;
  }
  endPoint(state, 1 - state.lastHitter, why);
}

function endPoint(state, winner, why) {
  const b = state.ball;
  b.live = false;
  state.pointWinner = winner;
  state.serveNumber = 1;
  state.phase = 'point';
  state.phaseTimer = POINT_TICKS;
  state.message = why;
  state.events.push({
    type: 'point', winner, why, rally: state.rallyLength,
  });
  const result = awardPoint(state, winner);
  if (result !== 'match') {
    state.events.push({
      type: 'score', server: state.server, points: [...state.points], games: [...state.games],
    });
  }
}

export { inSinglesCourt, inServiceBox };
