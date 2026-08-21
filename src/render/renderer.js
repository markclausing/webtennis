/**
 * Drawing. Reads the state, never writes to it.
 *
 * There is no camera to speak of: a tennis court fits on a screen, so the whole
 * world is scaled to the window once and left alone. That is the one real
 * difference from websoccer's renderer, and it takes a surprising amount of code
 * away with it.
 */

import {
  BALL_R, CHARGE_MAX, COURT, PLAYER_R, PLAYER_PRESETS, POINT_NAMES, REACH, SKIN_TONES,
  SWING_COOLDOWN, WORLD_H, WORLD_W,
} from '../constants.js';
import { callScore, serviceBox } from '../game/state.js';
import { drawCourt } from './court.js';
import { STRIDE, facing, kitSprites } from './sprites.js';

/** The kit and the face of one player. Two players, two different people. */
export function kitFor(i) {
  const tone = SKIN_TONES[i * 2 % SKIN_TONES.length];
  return { ...PLAYER_PRESETS[i], ...tone, id: `p${i}` };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.court = null;
    this.zoom = 1;
    this.strides = new Map();
    // Room kept clear at the bottom for the on-screen controls, in canvas
    // pixels. Nothing on a keyboard needs it.
    this.bottomInset = 0;
  }

  /** One offscreen court, painted the first time it is needed. */
  ensureCourt() {
    if (this.court) return;
    const c = document.createElement('canvas');
    c.width = WORLD_W;
    c.height = WORLD_H;
    drawCourt(c.getContext('2d'));
    this.court = c;
  }

  fit() {
    const { width } = this.canvas;
    const height = Math.max(80, this.canvas.height - this.bottomInset);
    this.zoom = Math.min(width / WORLD_W, height / WORLD_H);
    this.offX = (width - WORLD_W * this.zoom) / 2;
    this.offY = (height - WORLD_H * this.zoom) / 2;
  }

  toScreen(x, y) {
    return { x: this.offX + x * this.zoom, y: this.offY + y * this.zoom };
  }

  draw(state, net = null) {
    const ctx = this.ctx;
    this.ensureCourt();
    this.fit();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1b20';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.court, this.offX, this.offY, WORLD_W * this.zoom, WORLD_H * this.zoom);

    if (state.phase === 'serve') this.drawServiceBox(state);
    // The far player first, so the near one overlaps him at the net.
    const order = [...state.players].sort((a, b) => a.y - b.y);
    for (const p of order) this.drawPlayer(state, p);
    this.drawBall(state);
    this.drawScore(state);
    if (state.phase === 'point' || state.phase === 'over') this.drawPointCard(state);
    else if (state.message) this.drawMessage(state.message);
    if (net) this.drawNetInfo(net);
  }

  /**
   * The box this serve has to land in, lit up while he is getting ready.
   *
   * Which way a serve is going is a rule, not a guess - it alternates every
   * point and crosses the court - but nothing on screen said so, and two players
   * standing in the right places only tells you if you already knew the rule.
   * It goes out the moment the ball is struck.
   */
  drawServiceBox(state) {
    const box = serviceBox(state);
    const a = this.toScreen(box.x0, box.y0);
    const b = this.toScreen(box.x1, box.y1);
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(232, 255, 77, 0.09)';
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = 'rgba(232, 255, 77, 0.45)';
    ctx.lineWidth = Math.max(1, 1.5 * this.zoom);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }

  /**
   * The score, in the middle of the screen, for as long as the point is over.
   *
   * The corner panel is for glancing at mid-rally; this is the thing you
   * actually want between points, which is when tennis tells you where you are.
   * The umpire says the same words at the same moment.
   */
  drawPointCard(state) {
    const ctx = this.ctx;
    const scale = Math.max(1, this.zoom);
    const mid = this.canvas.width / 2;
    const top = this.canvas.height * 0.34;

    const call = state.phase === 'over'
      ? state.message
      : callScore(state).toUpperCase();
    const games = `GAMES  ${state.games[0]} - ${state.games[1]}`;
    const why = state.phase === 'over' ? '' : state.message;

    const w = 300 * scale;
    const h = (why ? 132 : 108) * scale;
    ctx.fillStyle = 'rgba(6, 20, 26, 0.82)';
    ctx.fillRect(mid - w / 2, top, w, h);
    ctx.strokeStyle = 'rgba(232, 255, 77, 0.5)';
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.strokeRect(mid - w / 2, top, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let y = top + 26 * scale;
    if (why) {
      ctx.font = `${13 * scale}px "Courier New", monospace`;
      ctx.fillStyle = '#9fc7c0';
      ctx.fillText(why, mid, y);
      y += 30 * scale;
    }
    ctx.font = `bold ${26 * scale}px "Courier New", monospace`;
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(call, mid, y);
    y += 34 * scale;
    ctx.font = `${13 * scale}px "Courier New", monospace`;
    ctx.fillStyle = '#9fc7c0';
    ctx.fillText(games, mid, y);
    ctx.textAlign = 'left';
  }

  drawPlayer(state, p) {
    const ctx = this.ctx;
    const kit = kitFor(p.index);
    // Drawn bigger than the court's scale would suggest: at the true size the
    // players are a handful of pixels on a court this wide, and you cannot read
    // a stance you cannot see.
    const sprites = kitSprites(kit, this.zoom * 2.1, kit.id);
    const at = this.toScreen(p.x, p.y);

    // Shadow, so he stands on the court rather than floating over it.
    ctx.fillStyle = 'rgba(10, 25, 30, 0.3)';
    ctx.beginPath();
    ctx.ellipse(at.x, at.y + 2, PLAYER_R * this.zoom, PLAYER_R * 0.5 * this.zoom, 0, 0, Math.PI * 2);
    ctx.fill();

    // Which way he is facing, and which foot he is on.
    const moving = Math.hypot(p.vx, p.vy) > 12;
    const view = facing(p.faceX, p.faceY);
    let phase = this.strides.get(p.index) || 0;
    if (moving) phase += Math.hypot(p.vx, p.vy) / 60;
    this.strides.set(p.index, phase);
    const frame = moving ? Math.floor(phase / STRIDE) % 2 : 0;
    const sprite = sprites[`${view}${frame}`] || sprites[view];

    // Winding up leans him away from the shot, so the whole figure coils rather
    // than only the racket moving. A few pixels is enough to read.
    const coil = p.charging ? -Math.min(1, p.charge / CHARGE_MAX) * 4 * this.zoom : 0;
    const lean = view === 'left' ? -coil : coil;
    ctx.drawImage(sprite,
      Math.round(at.x - sprite.width / 2 + lean),
      Math.round(at.y - sprite.height * 0.86));
    this.drawRacket(state, p, at, view);
    this.drawWindup(state, p, at);
  }

  /**
   * The one thing left on screen: a faint mark under the player when the ball is
   * close enough to hit.
   *
   * Everything else that used to be here - a ring where the ball would land, a
   * bar reading out exactly how hard the shot was going to be - has gone. Both
   * were answers to questions the game is more interesting for asking: how deep
   * is that ball, and how hard have I hit this. What is left tells you the ball
   * is within reach and nothing about what you are going to do with it.
   */
  drawWindup(state, p, at) {
    const ctx = this.ctx;
    const b = state.ball;
    const reachable = b.live && Math.hypot(b.x - p.x, b.y - p.y) < REACH && b.z < 150;
    if (!reachable && !p.charging) return;

    // Planted while the button is held, and he cannot run: worth saying out
    // loud, because it is a decision with a cost and the player has to know he
    // has made it.
    ctx.strokeStyle = p.charging
      ? (reachable ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.28)')
      : 'rgba(232, 255, 77, 0.22)';
    ctx.lineWidth = Math.max(1, this.zoom);
    ctx.beginPath();
    ctx.ellipse(at.x, at.y + 3 * this.zoom, REACH * 0.55 * this.zoom, REACH * 0.3 * this.zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * The racket, and with it the whole shot.
   *
   * This is now the only readout of how hard you are about to hit: it goes back
   * and down as you wind up, and comes through on contact. Judging that by eye
   * is the game - a bar with a number's worth of precision in it was doing the
   * judging for you.
   */
  drawRacket(state, p, at, view) {
    const ctx = this.ctx;
    const wind = Math.min(1, p.charge / CHARGE_MAX);
    const side = view === 'left' ? -1 : 1;
    const z = this.zoom;

    // Three poses: waiting, winding up, and following through.
    let reach = 9 * z;
    let lift = 6 * z;
    let tilt = side * 0.4;
    if (p.charging) {
      // Behind him, dropping as it goes back. The further back, the harder.
      reach = -(8 + wind * 22) * z;
      lift = (2 - wind * 10) * z;
      tilt = side * (0.4 + wind * 0.9);
    } else if (p.cooldown > 0) {
      // Through the ball and up: the follow-through, which is what tells you the
      // shot has gone rather than that you are still waiting to hit it.
      const t = p.cooldown / SWING_COOLDOWN;
      reach = (14 + (1 - t) * 12) * z;
      lift = (14 + (1 - t) * 10) * z;
      tilt = side * 0.1;
    } else if (p.swing > 0) {
      reach = 15 * z;
      lift = 10 * z;
    }

    const x = at.x + side * reach;
    const y = at.y - lift - 6 * z;
    const shoulder = { x: at.x + side * 4 * z, y: at.y - 8 * z };

    ctx.strokeStyle = '#f2ece0';
    ctx.lineWidth = Math.max(1.5, 2 * z);
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y, 6 * z, 7.5 * z, tilt, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawBall(state) {
    const ctx = this.ctx;
    const b = state.ball;
    const ground = this.toScreen(b.x, b.y);
    const lift = b.z * 0.6 * this.zoom;

    // The shadow is where the ball really is, and with the landing ring gone it
    // is how you read depth: it spreads and fades as the ball climbs, and draws
    // in tight and dark as it drops, which is the cue to swing.
    const high = Math.min(1, b.z / 160);
    const shade = 0.42 - high * 0.28;
    const spread = 1 + high * 1.5;
    ctx.fillStyle = `rgba(8, 22, 28, ${shade})`;
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, BALL_R * spread * this.zoom, BALL_R * 0.6 * spread * this.zoom, 0, 0, Math.PI * 2);
    ctx.fill();

    const r = (BALL_R + Math.min(2.5, b.z / 90)) * this.zoom;
    ctx.beginPath();
    ctx.arc(ground.x, ground.y - lift, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e8ff4d';
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 60, 20, 0.5)';
    ctx.lineWidth = Math.max(1, this.zoom * 0.8);
    ctx.stroke();
  }

  /** Games, points and who is serving, in the corner. */
  drawScore(state) {
    const ctx = this.ctx;
    const scale = Math.max(1, Math.round(this.zoom));
    ctx.font = `${12 * scale}px "Courier New", monospace`;
    ctx.textBaseline = 'top';

    const lines = state.players.map((p, i) => {
      const serving = state.server === i ? '*' : ' ';
      const point = pointLabel(state, i);
      return `${serving}${p.name.padEnd(5)} ${state.games[i]}  ${point}`;
    });

    const w = 128 * scale;
    const h = 20 + lines.length * 15 * scale;
    ctx.fillStyle = 'rgba(6, 20, 26, 0.72)';
    ctx.fillRect(8, 8, w, h);
    lines.forEach((text, i) => {
      ctx.fillStyle = i === 0 ? '#7fb2ff' : '#ff8b6b';
      ctx.fillText(text, 16, 16 + i * 15 * scale);
    });
  }

  drawMessage(message) {
    const ctx = this.ctx;
    const scale = Math.max(1, Math.round(this.zoom));
    ctx.font = `${20 * scale}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = this.canvas.height * 0.42;
    ctx.fillStyle = 'rgba(6, 20, 26, 0.72)';
    const w = ctx.measureText(message).width + 40 * scale;
    ctx.fillRect((this.canvas.width - w) / 2, y - 20 * scale, w, 40 * scale);
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(message, this.canvas.width / 2, y);
    ctx.textAlign = 'left';
  }

  drawNetInfo(net) {
    const ctx = this.ctx;
    ctx.font = '12px "Courier New", monospace';
    ctx.fillStyle = net.stalling ? '#ffb84d' : '#7ea888';
    const text = net.peerLeft ? 'OPPONENT GONE' : `${net.ping} ms${net.stalling ? ' - WAITING' : ''}`;
    ctx.fillText(text, 12, this.canvas.height - 22);
  }
}

/** "40", "AD", or the number of points. */
function pointLabel(state, i) {
  const mine = state.points[i];
  const theirs = state.points[1 - i];
  if (mine >= 3 && theirs >= 3) {
    if (mine === theirs) return '40';
    return mine > theirs ? 'AD' : '-';
  }
  return String([0, 15, 30, 40][Math.min(mine, 3)]);
}

export { pointLabel, POINT_NAMES };
