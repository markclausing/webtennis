/**
 * The match, as data.
 *
 * Same contract as websoccer: one plain object holding everything the game
 * needs, no DOM, no clock, no randomness that does not come out of `state.rng`.
 * Two machines given the same state and the same buttons must reach the same
 * score, which is what makes the netcode possible and, more usefully day to day,
 * makes the whole thing testable without a browser.
 */

import {
  AI_LEVELS, COURT, GAMES_TO_WIN, POINT_NAMES, PLAYER_PRESETS, SERVE_READY_TICKS,
} from '../constants.js';

export function createMatch(options = {}) {
  const opts = {
    seed: 12345,
    humans: [true, false],
    difficulty: 'normal',
    gamesToWin: GAMES_TO_WIN,
    ...options,
  };

  const state = {
    tick: 0,
    rng: opts.seed | 0,
    seed: opts.seed | 0,
    config: {
      gamesToWin: Math.max(1, Math.round(opts.gamesToWin)),
    },
    // serve | rally | point | over
    phase: 'serve',
    phaseTimer: SERVE_READY_TICKS,
    message: '',
    // What just happened. The renderer and the sound read these; the simulation
    // never reads them back, and they are cleared at the top of every step.
    events: [],

    points: [0, 0],
    games: [0, 0],
    server: 0,
    serveNumber: 1,
    // Who touched it last, and how often it has bounced since.
    lastHitter: null,
    bounces: 0,
    pointWinner: -1,
    rallyLength: 0,

    ball: {
      x: COURT.cx, y: COURT.bottom, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, live: false,
    },
    players: [
      makePlayer(0, opts.humans[0], +1, levelFor(opts.difficulty, 0)),
      makePlayer(1, opts.humans[1], -1, levelFor(opts.difficulty, 1)),
    ],
  };

  setupServe(state);
  return state;
}

function levelFor(difficulty, idx) {
  const key = Array.isArray(difficulty) ? difficulty[idx] : difficulty;
  return AI_LEVELS[key] || AI_LEVELS.normal;
}

/**
 * @param dir which way this player hits: +1 is up the court (towards smaller y),
 *   because player 0 stands at the bottom.
 */
function makePlayer(index, human, dir, ai) {
  const preset = PLAYER_PRESETS[index];
  return {
    index,
    name: preset.name,
    human: !!human,
    ai,
    dir,
    x: COURT.cx,
    y: index === 0 ? COURT.bottom + 40 : COURT.top - 40,
    vx: 0,
    vy: 0,
    // Which way he is looking, for the sprite.
    faceX: 0,
    faceY: -dir,
    swing: 0,
    cooldown: 0,
    charge: 0,
    charging: false,
    // The direction held while winding up, summed and averaged at contact.
    aimX: 0,
    aimY: 0,
    aimTicks: 0,
    prevMask: 0,
    // A serve is a toss and then a hit; this counts down the time the ball is up.
    tossing: false,
  };
}

/** The far baseline for this player: the one he is hitting towards. */
export function farBaseline(player) {
  return player.dir > 0 ? COURT.top : COURT.bottom;
}

export function ownBaseline(player) {
  return player.dir > 0 ? COURT.bottom : COURT.top;
}

/** Is this point being served into the right hand box? Even points are. */
export function servingRight(state) {
  return (state.points[0] + state.points[1]) % 2 === 0;
}

/**
 * Where the serve has to land: diagonally across, in the box.
 * @returns {{x0: number, x1: number, y0: number, y1: number}}
 */
export function serviceBox(state) {
  const server = state.players[state.server];
  const right = servingRight(state);
  // Diagonally: serving from the right hand court means aiming at the receiver's
  // right hand box, which is on the other side of the centre line from us.
  const towardsTop = server.dir > 0;
  const y0 = towardsTop ? COURT.cy - 230 : COURT.cy;
  const y1 = towardsTop ? COURT.cy : COURT.cy + 230;
  const leftHalf = right === (server.dir > 0);
  return {
    x0: leftHalf ? COURT.left : COURT.cx,
    x1: leftHalf ? COURT.cx : COURT.right,
    y0: Math.min(y0, y1),
    y1: Math.max(y0, y1),
  };
}

/** Puts the ball in the server's hand and everybody where they belong. */
export function setupServe(state) {
  const server = state.players[state.server];
  const receiver = state.players[1 - state.server];
  const right = servingRight(state);
  const box = serviceBox(state);

  // Both of them stand where the rules put them, and between them they say which
  // way this serve is going without a word on screen.
  //
  // The server is on his own right for an even point and his left for an odd
  // one, which is what "deuce court" and "advantage court" mean, and he stands
  // *behind* his baseline - he used to be placed inside it, which looked like a
  // man about to serve from the service line.
  const side = right ? 1 : -1;
  server.x = COURT.cx + side * 76 * (server.dir > 0 ? 1 : -1);
  server.y = ownBaseline(server) + server.dir * 26;

  // The receiver stands in front of the box the ball has to land in, which is
  // diagonally opposite. Taken from the box itself rather than worked out again:
  // one of them was inverted, so the receiver waited on the wrong side of the
  // court for every serve.
  const boxMiddle = (box.x0 + box.x1) / 2;
  receiver.x = boxMiddle + (boxMiddle - COURT.cx) * 0.3;
  // Well behind the baseline, which is where a returner stands and why a serve
  // is returnable at all.
  receiver.y = ownBaseline(receiver) + receiver.dir * 70;

  for (const p of state.players) {
    p.vx = 0;
    p.vy = 0;
    p.swing = 0;
    p.cooldown = 0;
    p.charge = 0;
    p.charging = false;
    p.tossing = false;
    p.faceX = 0;
    p.faceY = -p.dir;
  }

  const b = state.ball;
  b.x = server.x;
  b.y = server.y;
  b.z = 22;
  b.vx = 0;
  b.vy = 0;
  b.vz = 0;
  b.spin = 0;
  b.live = false;

  state.phase = 'serve';
  state.phaseTimer = SERVE_READY_TICKS;
  state.lastHitter = null;
  state.bounces = 0;
  state.rallyLength = 0;
  state.message = state.serveNumber === 2 ? 'SECOND SERVE' : '';
}

/**
 * Awards a point and moves the score on. Tennis counts oddly on purpose: the
 * rule that you have to win by two is what makes a game worth watching.
 */
export function awardPoint(state, winner) {
  const loser = 1 - winner;
  const mine = state.points[winner];
  const theirs = state.points[loser];

  if (mine >= 3 && theirs >= 3) {
    // Deuce and beyond: advantage, then either the game or back to deuce.
    if (mine > theirs) return winGame(state, winner);
    if (mine === theirs) state.points[winner] = mine + 1; // advantage
    else state.points[loser] = theirs - 1; // back to deuce
    return null;
  }
  if (mine >= 3) return winGame(state, winner);
  state.points[winner] = mine + 1;
  return null;
}

function winGame(state, winner) {
  state.games[winner]++;
  state.points = [0, 0];
  state.server = 1 - state.server;
  state.serveNumber = 1;

  const lead = state.games[winner] - state.games[1 - winner];
  // Two clear games, or the set is simply taken by the first to two past the
  // target: a set without a tiebreak can run for ever, and this one is played
  // in a sitting.
  const runaway = state.games[winner] >= state.config.gamesToWin + 2;
  if (state.games[winner] >= state.config.gamesToWin && (lead >= 2 || runaway)) {
    state.phase = 'over';
    state.message = `${state.players[winner].name} WINS`;
    state.events.push({ type: 'match', winner, games: [...state.games] });
    return 'match';
  }
  state.events.push({ type: 'game', winner, games: [...state.games] });
  return 'game';
}

/** The score as it would be called: "fifteen thirty", "deuce", "advantage". */
export function callScore(state, serverFirst = true) {
  const [a, b] = state.points;
  if (a >= 3 && b >= 3) {
    if (a === b) return 'deuce';
    const leader = a > b ? 0 : 1;
    return leader === state.server ? 'advantage server' : 'advantage receiver';
  }
  const first = serverFirst ? state.server : 0;
  const second = 1 - first;
  if (state.points[first] === state.points[second]) {
    return state.points[first] === 3 ? 'deuce' : `${POINT_NAMES[state.points[first]]} all`;
  }
  return `${POINT_NAMES[state.points[first]]} ${POINT_NAMES[state.points[second]]}`;
}

/** Deterministic hash of everything that matters, for the desync check. */
export function hashState(state) {
  let h = 2166136261;
  const mix = (v) => {
    h ^= Math.round(v * 16) | 0;
    h = Math.imul(h, 16777619);
  };
  mix(state.tick);
  mix(state.points[0]);
  mix(state.points[1]);
  mix(state.games[0]);
  mix(state.games[1]);
  mix(state.ball.x);
  mix(state.ball.y);
  mix(state.ball.z);
  mix(state.ball.vx);
  mix(state.ball.vy);
  for (const p of state.players) {
    mix(p.x);
    mix(p.y);
    mix(p.vx);
    mix(p.vy);
  }
  return h >>> 0;
}
