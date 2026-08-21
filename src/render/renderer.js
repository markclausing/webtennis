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
  WORLD_H, WORLD_W,
} from '../constants.js';
import { predictLanding } from '../game/ai.js';
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

    this.drawLanding(state);
    // The far player first, so the near one overlaps him at the net.
    const order = [...state.players].sort((a, b) => a.y - b.y);
    for (const p of order) this.drawPlayer(state, p);
    this.drawBall(state);
    this.drawScore(state);
    if (state.message) this.drawMessage(state.message);
    if (net) this.drawNetInfo(net);
  }

  /**
   * A ring where the ball is going to land.
   *
   * Height is nearly impossible to read from above - a ball coming at you and a
   * ball sailing over you look much the same - so the game says where it will
   * come down. Every tennis game worth playing does something like this, and
   * without it you cannot time a swing at all.
   */
  drawLanding(state) {
    const b = state.ball;
    if (!b.live || b.z < 6 || state.phase === 'point') return;
    const side = b.vy > 0 ? 1 : -1;
    const spot = predictLanding(state, side, { maxTicks: 200 });
    if (!spot || spot.ticks > 190) return;

    const at = this.toScreen(spot.x, spot.y);
    const near = Math.max(0, 1 - spot.ticks / 90); // tightens as it arrives
    const r = (16 - near * 7) * this.zoom;
    const ctx = this.ctx;
    ctx.strokeStyle = `rgba(232, 255, 77, ${0.35 + near * 0.45})`;
    ctx.lineWidth = Math.max(1, (1 + near) * this.zoom);
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawPlayer(state, p) {
    const ctx = this.ctx;
    const kit = kitFor(p.index);
    const sprites = kitSprites(kit, this.zoom * 1.5, kit.id);
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

    ctx.drawImage(sprite, Math.round(at.x - sprite.width / 2), Math.round(at.y - sprite.height * 0.86));
    this.drawRacket(state, p, at, view);
    this.drawWindup(state, p, at);
  }

  /**
   * What the player is doing with the button, on screen.
   *
   * A bar that fills as he winds up, and a ring around him when the ball is
   * close enough to hit. Between them they answer the only two questions the
   * game was not answering: am I swinging, and is it now?
   */
  drawWindup(state, p, at) {
    const ctx = this.ctx;
    const b = state.ball;

    if (p.charging || p.swing > 0) {
      const t = Math.min(1, p.charge / CHARGE_MAX);
      const w = 26 * this.zoom;
      const y = at.y + 8 * this.zoom;
      ctx.fillStyle = 'rgba(6, 20, 26, 0.6)';
      ctx.fillRect(at.x - w / 2, y, w, 3 * this.zoom);
      // Yellow while there is still something to gain, white once it is full.
      ctx.fillStyle = t >= 1 ? '#ffffff' : '#e8ff4d';
      ctx.fillRect(at.x - w / 2, y, w * t, 3 * this.zoom);
    }

    const reachable = b.live && Math.hypot(b.x - p.x, b.y - p.y) < REACH && b.z < 150;
    if (reachable) {
      ctx.strokeStyle = p.charging || p.swing > 0
        ? 'rgba(255, 255, 255, 0.85)'
        : 'rgba(232, 255, 77, 0.55)';
      ctx.lineWidth = Math.max(1, 1.5 * this.zoom);
      ctx.beginPath();
      ctx.ellipse(at.x, at.y, REACH * 0.7 * this.zoom, REACH * 0.42 * this.zoom, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * The racket: a little frame on the end of an arm, on whichever side he is
   * swinging. Drawn rather than baked into the sprite because it moves - a
   * player standing still and a player mid-swing are the same figure with the
   * racket somewhere else.
   */
  drawRacket(state, p, at, view) {
    const ctx = this.ctx;
    const wind = Math.min(1, p.charge / CHARGE_MAX);
    const swinging = p.swing > 0 || p.charging;
    const side = view === 'left' ? -1 : 1;
    // Winding up takes the racket back and down behind him; the further back it
    // is, the harder the shot is going to be.
    const reach = (swinging ? 15 + wind * 10 : 9) * this.zoom * (p.charging ? -0.8 : 1);
    const lift = (swinging ? 12 - wind * 10 : 6) * this.zoom;
    const x = at.x + side * reach;
    const y = at.y - lift - 6 * this.zoom;

    ctx.strokeStyle = '#e8e2d0';
    ctx.lineWidth = Math.max(1, 1.5 * this.zoom);
    ctx.beginPath();
    ctx.moveTo(at.x + side * 4 * this.zoom, at.y - 8 * this.zoom);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y, 5 * this.zoom, 6.5 * this.zoom, side * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawBall(state) {
    const ctx = this.ctx;
    const b = state.ball;
    const ground = this.toScreen(b.x, b.y);
    const lift = b.z * 0.6 * this.zoom;

    // The shadow is where the ball really is; the ball itself is drawn lifted,
    // which is the only way height reads at all from above.
    const shade = Math.max(0.08, 0.34 - b.z / 900);
    ctx.fillStyle = `rgba(10, 25, 30, ${shade})`;
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, BALL_R * this.zoom, BALL_R * 0.55 * this.zoom, 0, 0, Math.PI * 2);
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
