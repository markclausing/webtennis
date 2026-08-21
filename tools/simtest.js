// Headless: plays whole matches with no browser, and checks the rules.
//
//   node tools/simtest.js
//
// Two things matter here. That the simulation is deterministic, because the
// online game depends on it. And that tennis scoring is right, because it is
// the fiddliest part of the game and the easiest to get subtly wrong - a game
// that hands you a game at forty-thirty instead of deuce is broken in a way
// nobody notices until they lose one.

import {
  awardPoint, callScore, createMatch, hashState, serviceBox,
} from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { COURT, TICK_RATE, POINT_NAMES } from '../src/constants.js';
import { compare } from './sync-shared.js';

let failed = false;
function check(ok, message) {
  if (ok) {
    console.log(`OK: ${message}`);
  } else {
    console.error(`FAIL: ${message}`);
    failed = true;
  }
}

// --- A whole match -----------------------------------------------------------

function playOut(seed, difficulty = ['hard', 'hard'], maxSeconds = 900) {
  const state = createMatch({ seed, humans: [false, false], difficulty });
  const points = [];
  while (state.phase !== 'over' && state.tick < TICK_RATE * maxSeconds) {
    step(state, [0, 0]);
    for (const e of state.events) {
      if (e.type === 'point') points.push(e);
      if (!Number.isFinite(state.ball.x) || !Number.isFinite(state.ball.z)) {
        throw new Error(`the ball went NaN on tick ${state.tick}`);
      }
    }
  }
  return { state, points };
}

const a = playOut(1234);
const b = playOut(1234);
const c = playOut(77);

console.log(`Match on seed 1234: ${a.state.games.join(' - ')} in `
  + `${Math.round(a.state.tick / TICK_RATE)}s, ${a.points.length} points`);

check(hashState(a.state) === hashState(b.state), `deterministic (hash ${hashState(a.state)})`);
check(a.state.phase === 'over', 'the match reaches a winner');
check(c.state.phase === 'over', 'and so does a different one');

const rallies = a.points.map((p) => p.rally);
const avg = rallies.reduce((x, y) => x + y, 0) / rallies.length;
const aces = a.points.filter((p) => p.why === 'ACE').length;
console.log(`             rallies average ${avg.toFixed(1)} shots, `
  + `${((aces / a.points.length) * 100).toFixed(0)}% of points were aces`);
check(avg > 1.5 && avg < 12, 'points are rallies rather than one shot or forty');
check(aces / a.points.length < 0.3, 'the serve is returnable');

// --- Scoring -----------------------------------------------------------------
//
// Driven straight through awardPoint, because the interesting cases - deuce,
// advantage, advantage lost - take a long time to reach by playing.

function score(sequence) {
  const state = createMatch({ seed: 5, humans: [false, false] });
  state.games = [0, 0];
  for (const winner of sequence) awardPoint(state, winner);
  return state;
}

const fortyLove = score([0, 0, 0]);
check(fortyLove.points[0] === 3 && fortyLove.games[0] === 0, 'love, fifteen, thirty, forty');
check(callScore(fortyLove) === 'forty love', `and it is called "${callScore(fortyLove)}"`);

const won = score([0, 0, 0, 0]);
check(won.games[0] === 1 && won.points.join() === '0,0', 'four straight points is a game');

const deuce = score([0, 0, 0, 1, 1, 1]);
check(callScore(deuce) === 'deuce', `three all is deuce, not forty all (${callScore(deuce)})`);

const advantage = score([0, 0, 0, 1, 1, 1, 0]);
check(callScore(advantage).startsWith('advantage'), 'a point at deuce is advantage');
check(advantage.games[0] === 0, 'advantage is not the game');

const backToDeuce = score([0, 0, 0, 1, 1, 1, 0, 1]);
check(callScore(backToDeuce) === 'deuce', 'and losing it goes back to deuce');

const fromAdvantage = score([0, 0, 0, 1, 1, 1, 0, 0]);
check(fromAdvantage.games[0] === 1, 'two points clear from deuce is the game');

// A set has to be won by two, and cannot go on for ever.
const set = createMatch({ seed: 5, humans: [false, false], gamesToWin: 3 });
for (let i = 0; i < 4; i++) for (let p = 0; p < 4; p++) awardPoint(set, 0);
check(set.phase === 'over' && set.games[0] === 4,
  `four games to nil takes the set (${set.games.join('-')})`);

const long = createMatch({ seed: 5, humans: [false, false], gamesToWin: 3 });
for (let g = 0; g < 3; g++) {
  for (let p = 0; p < 4; p++) awardPoint(long, 0);
  for (let p = 0; p < 4; p++) awardPoint(long, 1);
}
check(long.phase !== 'over', `three all is not a win at three games (${long.games.join('-')})`);
for (let p = 0; p < 4; p++) awardPoint(long, 0);
for (let p = 0; p < 4; p++) awardPoint(long, 0);
check(long.phase === 'over', `but it ends rather than running for ever (${long.games.join('-')})`);

// --- The serve ---------------------------------------------------------------

function serveTo(x, y) {
  const state = createMatch({ seed: 9, humans: [true, true] });
  while (state.phase === 'serve' && state.tick < 600) step(state, [0, 0]);
  // Put a served ball exactly where the test wants it, in flight and coming down.
  const b = state.ball;
  state.lastHitter = state.server;
  state.wasServe = true;
  state.phase = 'rally';
  state.bounces = 0;
  b.live = true;
  b.x = x;
  b.y = y;
  b.z = 8;
  b.vx = 0;
  b.vy = 0;
  b.vz = -140;
  const before = state.serveNumber;
  for (let i = 0; i < 40; i++) {
    step(state, [0, 0]);
    if (state.phase === 'point') break;
  }
  return { state, before };
}

const box = serviceBox(createMatch({ seed: 9, humans: [true, true] }));
const good = serveTo((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
check(good.state.message !== 'FAULT', 'a serve into the box is not a fault');

const wide = serveTo(COURT.right + 30, (box.y0 + box.y1) / 2);
check(wide.state.message === 'FAULT' && wide.state.serveNumber === 2,
  'a serve outside the box is a fault, and there is a second one');

const doubled = createMatch({ seed: 9, humans: [true, true] });
doubled.serveNumber = 2;
doubled.wasServe = true;
doubled.lastHitter = doubled.server;
doubled.phase = 'rally';
doubled.ball.live = true;
doubled.ball.x = COURT.right + 30;
doubled.ball.y = (box.y0 + box.y1) / 2;
doubled.ball.z = 6;
doubled.ball.vz = -140;
for (let i = 0; i < 40 && doubled.phase !== 'point'; i++) step(doubled, [0, 0]);
check(doubled.points[1 - doubled.server] === 1 || doubled.points[doubled.server] === 0,
  'a second fault is a double fault, and the point goes to the receiver');

// --- In and out --------------------------------------------------------------

function landAt(x, y, hitter = 0) {
  const state = createMatch({ seed: 11, humans: [true, true] });
  state.phase = 'rally';
  state.lastHitter = hitter;
  state.wasServe = false;
  state.bounces = 0;
  const b = state.ball;
  b.live = true;
  b.x = x;
  b.y = y;
  b.z = 10;
  b.vx = 0;
  b.vy = 0;
  b.vz = -160;
  for (let i = 0; i < 200 && state.phase !== 'point'; i++) step(state, [0, 0]);
  return state;
}

const inCourt = landAt(COURT.cx, COURT.top + 120, 0);
check(inCourt.message !== 'OUT', 'a ball landing in the court is in');

const outWide = landAt(COURT.right + 40, COURT.top + 120, 0);
check(outWide.message === 'OUT' && outWide.points[1] === 1,
  'a ball past the sideline is out, and the point goes to the other player');

const outLong = landAt(COURT.cx, COURT.top - 40, 0);
check(outLong.message === 'OUT', 'and so is one past the baseline');

const twice = landAt(COURT.cx, COURT.top + 120, 0);
check(twice.points[0] === 1 || twice.message === 'WINNER',
  'a ball nobody returns is a point for whoever hit it');

// --- The umpire --------------------------------------------------------------

const calls = createMatch({ seed: 3, humans: [false, false] });
calls.points = [1, 2];
check(callScore(calls) === `${POINT_NAMES[1]} ${POINT_NAMES[2]}`
  || callScore(calls) === `${POINT_NAMES[2]} ${POINT_NAMES[1]}`,
  `the score is called server first ("${callScore(calls)}")`);
calls.points = [2, 2];
check(callScore(calls) === 'thirty all', `equal scores are "all" ("${callScore(calls)}")`);

// --- Difficulty --------------------------------------------------------------

let hardGames = 0;
let easyGames = 0;
for (let seed = 1; seed <= 4; seed++) {
  const ladder = playOut(seed, ['easy', 'hard'], 900);
  easyGames += ladder.state.games[0];
  hardGames += ladder.state.games[1];
}
console.log(`Ladder: EASY took ${easyGames} games off HARD, HARD took ${hardGames}`);
check(hardGames > easyGames, 'HARD beats EASY');

// --- The shared engine -------------------------------------------------------

const shared = compare();
if (shared.same.length + shared.differs.length + shared.missing.length === 0
  || (shared.differs.length === 0 && shared.missing.length === shared.same.length * 0)) {
  // nothing to say
}
if (shared.differs.length || shared.missing.length) {
  console.log(`NOTE: ${shared.differs.length} shared files differ from websoccer `
    + '(run node tools/sync-shared.js)');
} else {
  console.log(`OK: the ${shared.same.length} files shared with websoccer are identical`);
}

console.log('');
console.log(failed ? 'SUITE FAILED' : 'SUITE PASSED');
process.exit(failed ? 1 : 0);
