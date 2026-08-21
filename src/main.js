/**
 * The page: menu, game loop, and the wiring between the two.
 *
 * The loop is the same fixed-timestep arrangement as websoccer, talking to a
 * transport that is either local or online, and the simulation never knows which.
 * That part is shared code; what is here is this game's own.
 */

import { FRAME_TIME, TICK_RATE } from './constants.js';
import { InputDevices, loadBindings } from './input.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { createMatch, callScore, hashState } from './game/state.js';
import { step } from './game/sim.js';
import { Renderer } from './render/renderer.js';
import { AudioEngine, Chiptune, Sfx } from './audio.js';
import { Speech } from './speech.js';
import * as commentary from './commentary.js';
import { Highscores, placeOf } from './highscores.js';
import { NameEntry } from './nameEntry.js';
import { boardFor, relayFor } from './config.js';
import { Signal } from './net/signal.js';
import { LocalTransport, OnlineTransport } from './net/transport.js';

const canvas = document.getElementById('court');
const menu = document.getElementById('menu');
const pauseBox = document.getElementById('pause');
const netendBox = document.getElementById('netend');
const hiscoreBox = document.getElementById('hiscore');
const onlineStatus = document.getElementById('onlineStatus');
const roomCode = document.getElementById('roomCode');

const audio = new AudioEngine();
const music = new Chiptune(audio);
const speech = new Speech(audio, commentary);
const sfx = new Sfx(audio, speech);
const devices = new InputDevices(loadBindings());
// Without this nothing is listening to the keyboard at all - the match starts,
// and then the server stands there holding the ball for ever.
devices.attach();
const touch = new TouchControls();
const renderer = new Renderer(canvas);
// Its own key: the football game is on the same domain and its table is not
// this table.
const highscores = new Highscores(globalThis.localStorage, 'webtennis.highscores.v1');

let soundOn = globalThis.localStorage?.getItem('webtennis.sound') !== 'off';
sfx.talking = globalThis.localStorage?.getItem('webtennis.umpire') !== 'off';
audio.enabled = soundOn;

const onTouchDevice = isTouchDevice();
if (onTouchDevice) {
  touch.attach({
    root: document.getElementById('touch'),
    stick: document.getElementById('stick'),
    knob: document.getElementById('knob'),
    kick: document.getElementById('btnHit'),
    swap: document.getElementById('btnLob'),
  });
  devices.touch = touch;
}

const game = {
  state: null,
  transport: null,
  signal: null,
  paused: false,
  acc: 0,
  last: performance.now(),
  ended: false,
};
window.__game = game;
window.__say = (what) => (Array.isArray(what) ? speech.speak(what) : speech.line(what));

// --- Starting and stopping ---------------------------------------------------

function beginMatch(state, transport) {
  game.state = state;
  game.transport = transport;
  game.paused = false;
  game.ended = false;
  game.acc = 0;
  game.last = performance.now();
  menu.classList.add('hidden');
  pauseBox.classList.add('hidden');
  netendBox.classList.add('hidden');
  canvas.focus();
  if (onTouchDevice) touch.show(true);
  music.stop();
  sizeCanvas();
}

function startLocal({ players }) {
  const state = createMatch({
    seed: (Date.now() & 0x7fffffff) || 1,
    humans: [true, players === 2],
    difficulty,
    gamesToWin: gamesToWin(),
  });
  beginMatch(state, new LocalTransport(devices, players === 2 ? [0, 1] : [0]));
}

function startOnline(opts) {
  const state = createMatch({
    seed: opts.seed, humans: [true, true], gamesToWin: opts.gamesToWin,
  });
  beginMatch(state, new OnlineTransport({
    signal: opts.signal, devices, localTeam: opts.localTeam,
  }));
}

function toMenu() {
  if (game.transport) game.transport.dispose();
  else if (game.signal) game.signal.close();
  game.state = null;
  game.transport = null;
  game.signal = null;
  menu.classList.remove('hidden');
  pauseBox.classList.add('hidden');
  netendBox.classList.add('hidden');
  touch.show(false);
  if (soundOn) music.start();
  setOnlineStatus('');
  roomCode.classList.add('hidden');
  document.getElementById('host').disabled = false;
}

// --- The loop ----------------------------------------------------------------

function sizeCanvas() {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
addEventListener('resize', sizeCanvas);

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.25, (now - game.last) / 1000);
  game.last = now;

  if (!game.state) {
    drawTitle();
    return;
  }

  if (!game.paused) {
    game.acc += elapsed;
    let guard = 0;
    while (game.acc >= FRAME_TIME / 1000 && guard < 8) {
      const tick = game.state.tick;
      game.transport.sample(tick);
      if (!game.transport.ready(tick)) break;
      const inputs = game.transport.poll(tick);
      step(game.state, inputs);
      game.transport.afterStep(game.state);
      sfx.play(game.state.events, { callScore: callScore(game.state) });
      game.acc -= FRAME_TIME / 1000;
      guard++;
    }
    if (guard >= 8 || game.acc > (FRAME_TIME / 1000) * 8) {
      game.acc = Math.min(game.acc, (FRAME_TIME / 1000) * 8);
    }
  }

  renderer.draw(game.state, netInfo());
  checkNetEnd();

  if (game.state.phase === 'over' && !game.transport.online) {
    if (offerHighscore()) return;
    if (devices.isDown('Enter')) toMenu();
  }
}

function netInfo() {
  const t = game.transport;
  if (!t || !t.online) return null;
  return {
    online: true, ping: t.ping, stalling: t.stalling, desync: t.desync, peerLeft: t.peerLeft,
  };
}

function checkNetEnd() {
  const t = game.transport;
  if (!t || !t.online || game.ended) return;
  const finished = game.state.phase === 'over';
  if (!t.peerLeft && !t.desync && !finished) return;
  game.ended = true;
  document.getElementById('netendTitle').textContent = t.desync ? 'DESYNC'
    : t.peerLeft ? 'OPPONENT GONE' : 'MATCH OVER';
  document.getElementById('netendText').textContent = t.desync
    ? 'The two players computed a different match. It has been stopped.'
    : t.peerLeft ? 'The connection to your opponent has been lost.'
      : `${game.state.games[0]} - ${game.state.games[1]}`;
  netendBox.classList.remove('hidden');
}

let titleTick = 0;
function drawTitle() {
  sizeCanvas();
  titleTick++;
  const ctx = renderer.ctx;
  renderer.ensureCourt();
  renderer.fit();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d1b20';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.75;
  ctx.drawImage(renderer.court, renderer.offX, renderer.offY,
    renderer.court.width * renderer.zoom, renderer.court.height * renderer.zoom);
  ctx.globalAlpha = 1;
}

// --- High scores -------------------------------------------------------------

const pending = { open: false, entry: null };

const nameEntry = new NameEntry(document.getElementById('hiscoreLetters'), (name) => {
  try {
    globalThis.localStorage?.setItem('webtennis.name', name);
  } catch { /* private mode */ }
  const place = highscores.add(difficulty, { ...pending.entry, name });
  pending.open = false;
  hiscoreBox.classList.add('hidden');
  renderScores(difficulty, place);
  document.getElementById('scoresBox').open = true;
  toMenu();
  syncScores();
});

window.addEventListener('keydown', (e) => {
  if (!pending.open) return;
  if (nameEntry.type(e.key)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

/** A won match is a score: the games you took against the ones you gave away. */
function offerHighscore() {
  if (pending.open) {
    nameEntry.step(devices.mask(0));
    return true;
  }
  if (game.ended || game.transport.humanSlots?.length !== 1) return false;
  game.ended = true;

  const entry = {
    name: lastName(),
    scored: game.state.games[0],
    conceded: game.state.games[1],
    halfSeconds: Math.round(game.state.tick / TICK_RATE),
    at: Date.now(),
  };
  if (!highscores.qualifies(difficulty, entry)) return false;

  pending.entry = entry;
  pending.open = true;
  document.getElementById('hiscoreLine').textContent
    = `${entry.scored} - ${entry.conceded} against ${difficulty.toUpperCase()}: `
    + `number ${placeOf(highscores.table(difficulty), entry)}`;
  hiscoreBox.classList.remove('hidden');
  nameEntry.start(lastName());
  return true;
}

function lastName() {
  try {
    return globalThis.localStorage?.getItem('webtennis.name') || 'AAA';
  } catch {
    return 'AAA';
  }
}

async function syncScores() {
  const url = boardFor(location);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board: highscores.all() }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.board) return false;
    highscores.absorb(data.board);
    renderScores(difficulty);
    return true;
  } catch {
    return false;
  }
}

function renderScores(level, freshPlace = 0) {
  const body = document.getElementById('scoresBody');
  document.getElementById('scoresLevel').textContent = level.toUpperCase();
  body.innerHTML = '';
  const rows = highscores.table(level);
  for (let i = 0; i < rows.length; i++) {
    const tr = document.createElement('tr');
    if (i + 1 === freshPlace) tr.className = 'fresh';
    for (const [cls, text] of [
      ['place', `${i + 1}`],
      ['name', rows[i].name],
      ['result', `${rows[i].scored} - ${rows[i].conceded}`],
      ['when', new Date(rows[i].at).toLocaleDateString()],
    ]) {
      const td = document.createElement('td');
      td.className = cls;
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  document.getElementById('scoresNote').textContent = rows.length
    ? 'Biggest win first. You have to win the match to get on the board.'
    : 'Nothing here yet. Beat the CPU at this level and the board is yours.';
}

// --- Menu --------------------------------------------------------------------

let mode = '1';
let difficulty = 'normal';

function gamesToWin() {
  return Number(document.getElementById('length').value) || 3;
}

function setOnlineStatus(text) {
  onlineStatus.textContent = text;
}

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
    document.getElementById('difficultyRow').classList.toggle('hidden', mode !== '1');
    document.getElementById('onlineSetup').classList.toggle('hidden', mode !== 'online');
    document.getElementById('start').classList.toggle('hidden', mode === 'online');
    document.getElementById('host').classList.toggle('hidden', mode !== 'online');
  });
});

document.querySelectorAll('[data-difficulty]').forEach((btn) => {
  btn.addEventListener('click', () => {
    difficulty = btn.dataset.difficulty;
    document.querySelectorAll('[data-difficulty]').forEach((b) => b.classList.toggle('active', b === btn));
    renderScores(difficulty);
  });
});

document.querySelectorAll('[data-sound]').forEach((btn) => {
  btn.classList.toggle('active', (btn.dataset.sound === 'on') === soundOn);
  btn.addEventListener('click', () => {
    soundOn = btn.dataset.sound === 'on';
    document.querySelectorAll('[data-sound]').forEach((b) => b.classList.toggle('active', b === btn));
    try {
      globalThis.localStorage?.setItem('webtennis.sound', soundOn ? 'on' : 'off');
    } catch { /* private mode */ }
    audio.enabled = soundOn;
    if (soundOn) audio.wake();
    music.toggle(soundOn && !game.state);
  });
});

document.querySelectorAll('[data-umpire]').forEach((btn) => {
  btn.classList.toggle('active', (btn.dataset.umpire === 'on') === sfx.talking);
  btn.addEventListener('click', () => {
    sfx.talking = btn.dataset.umpire === 'on';
    document.querySelectorAll('[data-umpire]').forEach((b) => b.classList.toggle('active', b === btn));
    try {
      globalThis.localStorage?.setItem('webtennis.umpire', sfx.talking ? 'on' : 'off');
    } catch { /* private mode */ }
    if (sfx.talking) {
      audio.wake();
      sfx.call('fifteen love', { force: true });
    }
  });
});

document.getElementById('start').addEventListener('click', () => {
  audio.wake();
  startLocal({ players: mode === '2' ? 2 : 1 });
});

// --- Online ------------------------------------------------------------------

function connect() {
  if (game.signal) game.signal.close();
  const signal = new Signal(relayFor(location));
  game.signal = signal;
  signal.on('error', (m) => setOnlineStatus(m.msg || 'Connection error'));
  return signal;
}

document.getElementById('host').addEventListener('click', () => {
  audio.wake();
  const signal = connect();
  const games = gamesToWin();
  signal.on('room', (m) => {
    roomCode.textContent = m.code;
    roomCode.classList.remove('hidden');
    setOnlineStatus('Share this code and wait for your opponent...');
  });
  signal.on('peer', () => {
    const seed = (Date.now() & 0x7fffffff) || 1;
    signal.send({ t: 'start', seed, gamesToWin: games });
    startOnline({ seed, gamesToWin: games, localTeam: 0, signal });
  });
  document.getElementById('host').disabled = true;
  signal.create();
});

document.getElementById('join').addEventListener('click', () => {
  audio.wake();
  const code = document.getElementById('joinCode').value.toUpperCase().trim();
  if (code.length < 4) {
    setOnlineStatus('Enter the four-character code.');
    return;
  }
  const signal = connect();
  signal.on('room', () => setOnlineStatus('Connected. Waiting for the first serve...'));
  signal.on('start', (m) => {
    startOnline({
      seed: m.seed, gamesToWin: m.gamesToWin || 3, localTeam: 1, signal,
    });
  });
  setOnlineStatus('Connecting...');
  signal.join(code);
});

document.getElementById('joinCode').addEventListener('keydown', (e) => e.stopPropagation());

// --- Odds and ends -----------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game.state && !game.transport.online) {
    game.paused = !game.paused;
    pauseBox.classList.toggle('hidden', !game.paused);
  }
});

document.getElementById('quit').addEventListener('click', toMenu);
document.getElementById('netendBack').addEventListener('click', toMenu);

const startMusicOnFirstGesture = () => {
  audio.wake();
  if (soundOn && !game.state) music.start();
  removeEventListener('pointerdown', startMusicOnFirstGesture);
  removeEventListener('keydown', startMusicOnFirstGesture);
};
addEventListener('pointerdown', startMusicOnFirstGesture);
addEventListener('keydown', startMusicOnFirstGesture);

renderScores(difficulty);
syncScores();
sizeCanvas();
requestAnimationFrame(frame);

export { hashState };
