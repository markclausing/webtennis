/**
 * The court, drawn once onto an offscreen canvas.
 *
 * It never changes, so it is painted at startup and blitted every frame - the
 * same trick websoccer uses for the pitch. Everything here is in world units;
 * the renderer scales the whole thing to fit the window, because a tennis court
 * fits on a screen and there is nothing to scroll.
 */

import {
  ALLEY, COURT, NET_H, SERVICE_D, WORLD_H, WORLD_W,
} from '../constants.js';

const SURROUND = '#1f5f7a'; // the blue-green paint outside the lines
const SURFACE = '#2f7fa8'; // and the slightly lighter court itself
const LINE = '#f2f6f4';
const NET_DARK = '#1a2a30';

export function drawCourt(ctx) {
  ctx.fillStyle = SURROUND;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // The playing surface, doubles width, with a margin of run-off around it. The
  // run-off behind the baselines is generous because that is where a returner
  // actually stands - painted short, he appeared to be waiting off the court.
  ctx.fillStyle = SURFACE;
  ctx.fillRect(
    COURT.left - ALLEY - 30,
    COURT.top - 100,
    (COURT.right - COURT.left) + (ALLEY + 30) * 2,
    (COURT.bottom - COURT.top) + 200,
  );

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  ctx.lineCap = 'square';

  const line = (x0, y0, x1, y1) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };

  // Doubles court, then the singles tramlines inside it.
  ctx.strokeRect(COURT.left - ALLEY, COURT.top, (COURT.right - COURT.left) + ALLEY * 2, COURT.bottom - COURT.top);
  line(COURT.left, COURT.top, COURT.left, COURT.bottom);
  line(COURT.right, COURT.top, COURT.right, COURT.bottom);

  // Service boxes: a line each side of the net, split down the middle.
  for (const side of [-1, 1]) {
    const y = COURT.cy + side * SERVICE_D;
    line(COURT.left, y, COURT.right, y);
  }
  line(COURT.cx, COURT.cy - SERVICE_D, COURT.cx, COURT.cy + SERVICE_D);

  // The little centre marks on the baselines.
  for (const y of [COURT.top, COURT.bottom]) {
    line(COURT.cx, y, COURT.cx, y + (y === COURT.top ? 14 : -14));
  }

  drawNet(ctx);
}

function drawNet(ctx) {
  const x0 = COURT.left - ALLEY - 26;
  const x1 = COURT.right + ALLEY + 26;
  const y = COURT.cy;
  const h = NET_H;

  // Seen from above but standing up, so it is drawn as a band with the top edge
  // nearer the camera. Without the band the ball appears to pass through a line.
  ctx.fillStyle = 'rgba(20, 32, 38, 0.35)';
  ctx.fillRect(x0, y - h * 0.6, x1 - x0, h * 0.6);

  ctx.strokeStyle = 'rgba(235, 242, 240, 0.5)';
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.6);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 3; i++) {
    const yy = y - h * 0.6 + (i * h * 0.6) / 3;
    ctx.beginPath();
    ctx.moveTo(x0, yy);
    ctx.lineTo(x1, yy);
    ctx.stroke();
  }

  // The white band along the top, and the posts.
  ctx.fillStyle = '#f2f6f4';
  ctx.fillRect(x0, y - h * 0.6 - 3, x1 - x0, 4);
  ctx.fillStyle = NET_DARK;
  ctx.fillRect(x0 - 4, y - h * 0.6 - 6, 6, h * 0.6 + 10);
  ctx.fillRect(x1 - 2, y - h * 0.6 - 6, 6, h * 0.6 + 10);
}
