/**
 * Every dimension, speed and rule in one place - the same arrangement as
 * websoccer, and for the same reason: tuning a game means changing numbers, and
 * hunting them through the code is how a game stops being tuneable.
 *
 * The court is drawn looking down it rather than across, so y runs from one
 * baseline to the other and the net sits in the middle. Real proportions: a
 * singles court is 8.23 m by 23.77 m, which is almost three times as long as it
 * is wide, and that shape is the whole game - it is why you run sideways and
 * why a ball down the line is worth so much more than one through the middle.
 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const FRAME_TIME = 1000 / TICK_RATE;

// The court, in pixels, at the real ratio.
export const COURT_W = 296; // singles width
export const COURT_L = 854; // baseline to baseline
export const ALLEY = 44; // the doubles tramlines, drawn but not played
export const RUNOFF = 130; // room behind the baseline to chase a deep ball

export const WORLD_W = COURT_W + (ALLEY + 64) * 2;
export const WORLD_H = COURT_L + RUNOFF * 2;

export const COURT = {
  left: (WORLD_W - COURT_W) / 2,
  right: (WORLD_W + COURT_W) / 2,
  top: RUNOFF,
  bottom: RUNOFF + COURT_L,
  cx: WORLD_W / 2,
  cy: RUNOFF + COURT_L / 2,
};

/** The service line, this far from the net. Real ratio: 6.4 m of 11.885 m. */
export const SERVICE_D = 230;

/** How high the net is, in the same units the ball's height uses. */
export const NET_H = 26;

// The ball.
export const BALL_R = 5;
export const GRAVITY = 900;
export const BOUNCE = 0.62; // how much height a bounce keeps
export const BOUNCE_FRICTION = 0.84; // and how much pace it loses
export const AIR_DRAG = 0.32;
export const SPIN_DRIFT = 90; // sideways pull per unit of spin

// The players.
export const PLAYER_R = 9;
export const PLAYER_SPEED = 235;
export const PLAYER_ACC = 1500;
export const PLAYER_DAMP = 0.82;

/** How far from the ball you can still reach it, and for how long a swing lasts. */
export const REACH = 46;
export const SWING_TICKS = 16;
export const SWING_COOLDOWN = 8;

/**
 * Steering the ball after you have hit it, as in the football game.
 *
 * Gentler than it was, because the stick does two jobs at once: it moves you and
 * it aims the shot, so the direction you happen to be holding while you run the
 * ball down is also the direction you hit it. At the old strength a full
 * diagonal put the ball most of the width of the court past the sideline -
 * measured at 1.78, where 1.0 is the line itself. Steering should bend a shot,
 * not fling it.
 */
export const AFTERTOUCH_TICKS = 60; // one second
export const AT_SIDE = 125;
export const AT_LIFT = 80;

/**
 * Winding up.
 *
 * You hold the button to prepare the shot and let the ball come onto it: the
 * longer you have been winding when the ball arrives, the harder you hit it and
 * the closer it goes to where you aimed. A shot started at the last moment still
 * connects, it just sprays. That is the whole skill of the game - reading where
 * the ball is going early enough to be ready for it - and it is why the racket
 * goes back on screen as you hold.
 */
export const CHARGE_MAX = 45;

/**
 * How far off a shot goes when it is thrown at the ball with no preparation,
 * as a fraction of half the court's width. A full wind-up takes it to nothing.
 */
export const RUSHED_SCATTER = 0.55;

/** How long the swing stays open after you let go, if the ball is not there yet. */
export const SWING_WINDOW = 22;
export const SHOT_MIN = 520; // a blocked return
export const SHOT_MAX = 900; // a full drive
export const LOB_CHARGE = 16; // hold past this and it goes up instead of through

/** A serve is its own shot: faster, and it has to be started with a toss. */
// Measured against how often a serve goes unreturned: at 620-1020 nearly two
// points in five were aces, which is not tennis. This lands at about one in
// eleven, with rallies of three or four shots.
export const SERVE_MIN = 520;
export const SERVE_MAX = 820;
// The toss has to be up long enough to hit on the way down, and the window has
// to outlast the flight: at 190 high and 70 ticks the ball was still above
// hitting height when the toss timed out, so a human could never serve at all -
// the CPU only managed it because it swings the instant the ball starts falling.
export const TOSS_HEIGHT = 135;
export const TOSS_TICKS = 105;

export const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, FIRE: 16, SWITCH: 32 };

// How long the game waits between things, in ticks.
export const POINT_TICKS = 110;
export const SERVE_READY_TICKS = 40;

/** Tennis scoring, as words. Forty-all and beyond is deuce. */
export const POINT_NAMES = ['love', 'fifteen', 'thirty', 'forty'];

/** First to this many games, and you have to be two clear. */
export const GAMES_TO_WIN = 4;

export const PLAYER_PRESETS = [
  { name: 'BLUE', shirt: '#2f6fd0', shorts: '#ffffff', trim: '#1b3f7a' },
  { name: 'RED', shirt: '#d33b3b', shorts: '#ffffff', trim: '#7a1b1b' },
];

// Eleven players in a football squad needed a spread of skin tones; two tennis
// players need two, but the same rule applies - they are two different people.
export const SKIN_TONES = [
  { skin: '#e8b98a', hair: '#3a2415' },
  { skin: '#8d5524', hair: '#221109' },
  { skin: '#f2d0ab', hair: '#8a5a2b' },
  { skin: '#a3663a', hair: '#1d1109' },
];

/**
 * The three settings, and what actually separates them.
 *
 * `reactTicks` is a delay before he sets off after the ball has been struck -
 * reading the shot early is most of what makes a good player look quick.
 * `aimError` is how far his aim strays, and it is allowed to stray past the
 * lines: an opponent who cannot hit the ball out never loses a point, which is
 * exactly what happened before this was measured. Games taken off HARD over
 * four matches: EASY 4, NORMAL 17, HARD 22.
 */
export const AI_LEVELS = {
  easy: {
    key: 'easy', label: 'EASY', reactTicks: 9, aimError: 90, speed: 0.86, windup: 0.78, reach: 0.7,
  },
  normal: {
    key: 'normal', label: 'NORMAL', reactTicks: 5, aimError: 45, speed: 0.94, windup: 0.88, reach: 0.76,
  },
  hard: {
    key: 'hard', label: 'HARD', reactTicks: 1, aimError: 26, speed: 1, windup: 0.95, reach: 1,
  },
};
