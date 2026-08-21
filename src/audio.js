/**
 * The sound: an original chiptune and the noises a tennis court makes,
 * synthesised in the browser.
 *
 * Nothing is loaded - there is no audio file. A pulse wave carries the melody, a
 * second one runs a fast arpeggio underneath it, a triangle plays the bass and
 * filtered noise does the drums. That is how the sound chips of the era worked,
 * and it keeps the whole thing at a few kilobytes of source with no dependency
 * and no build step, in keeping with the rest of the project.
 *
 * The tune is the bouncy minor-key march the games of that era opened with,
 * written here rather than copied from any of them. It came over from websoccer
 * with the rest of the engine; the sounds of the game itself are this game's own,
 * because a football and a tennis ball do not sound remotely alike.
 */

import { gameCall } from './commentary.js';

const BPM = 150;
const STEP = 60 / BPM / 4; // one sixteenth note, in seconds
const BARS = 8;
const STEPS_PER_BAR = 16;
const TOTAL_STEPS = BARS * STEPS_PER_BAR;

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'A4' -> 440. Sharps as in 'F#4'. */
export function noteFreq(name) {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name);
  if (!m) return 0;
  const midi = SEMITONES[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * 2 ** ((midi - 69) / 12);
}

// Am - F - C - G, twice. Old, obvious, and it lifts every time.
const CHORDS = [
  { bass: 'A2', notes: ['A3', 'C4', 'E4'] },
  { bass: 'F2', notes: ['F3', 'A3', 'C4'] },
  { bass: 'C3', notes: ['C3', 'E3', 'G3'] },
  { bass: 'G2', notes: ['G3', 'B3', 'D4'] },
  { bass: 'A2', notes: ['A3', 'C4', 'E4'] },
  { bass: 'F2', notes: ['F3', 'A3', 'C4'] },
  { bass: 'C3', notes: ['C3', 'E3', 'G3'] },
  { bass: 'G2', notes: ['G3', 'B3', 'D4'] },
];

// Eight eighth-notes per bar, one bar per chord. A dash is a rest.
const MELODY = [
  ['E5', 'A5', 'C6', 'B5', 'A5', 'G5', 'E5', '-'],
  ['F5', 'A5', 'C6', 'A5', 'G5', 'F5', 'D5', '-'],
  ['E5', 'G5', 'C6', 'B5', 'C6', 'G5', 'E5', '-'],
  ['D5', 'G5', 'B5', 'D6', 'B5', 'G5', 'D5', '-'],
  ['A5', 'C6', 'E6', 'D6', 'C6', 'B5', 'A5', '-'],
  ['C6', 'A5', 'F5', 'A5', 'C6', 'F6', 'E6', '-'],
  ['G5', 'C6', 'E6', 'G6', 'E6', 'C6', 'G5', '-'],
  ['D6', 'B5', 'G5', 'F5', 'E5', 'D5', 'E5', '-'],
];

/** Per sixteenth: what the lead, arpeggio, bass and drums do. */
function buildTrack() {
  const lead = new Array(TOTAL_STEPS).fill(null);
  const arp = new Array(TOTAL_STEPS).fill(null);
  const bass = new Array(TOTAL_STEPS).fill(null);
  const drum = new Array(TOTAL_STEPS).fill(null);

  for (let bar = 0; bar < BARS; bar++) {
    const chord = CHORDS[bar];
    const phrase = MELODY[bar];

    for (let step = 0; step < STEPS_PER_BAR; step++) {
      const i = bar * STEPS_PER_BAR + step;

      // Melody on the eighths.
      if (step % 2 === 0) {
        const note = phrase[step / 2];
        if (note !== '-') lead[i] = { freq: noteFreq(note), dur: STEP * 1.8 };
      }

      // Arpeggio cycling the chord on every sixteenth: the trick that made
      // three voices sound like a full band.
      arp[i] = { freq: noteFreq(chord.notes[step % chord.notes.length]), dur: STEP * 0.9 };

      // Bass on the eighths, dropping to the fifth halfway through the bar.
      if (step % 2 === 0) {
        const root = noteFreq(chord.bass);
        bass[i] = { freq: step >= 8 && step % 4 === 0 ? root * 1.5 : root, dur: STEP * 1.7 };
      }

      // Kick on one and three, snare on two and four, hats on the eighths.
      if (step === 0 || step === 8) drum[i] = 'kick';
      else if (step === 4 || step === 12) drum[i] = 'snare';
      else if (step % 2 === 0) drum[i] = 'hat';
    }
  }
  return { lead, arp, bass, drum, steps: TOTAL_STEPS, step: STEP };
}

export const TRACK = buildTrack();

/** A pulse wave of the given duty cycle, which is what gives it the bite. */
function pulseWave(ctx, duty, harmonics = 24) {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * duty);
  }
  return ctx.createPeriodicWave(real, imag);
}

/**
 * One audio context shared by the tune and the effects. They have to share it:
 * the tune suspends nothing when it stops, or the whistle would go with it, and
 * browsers hand out a limited number of contexts.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  /** Browsers only allow this from a click or a key press. */
  wake() {
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return null; // no Web Audio: the game is perfectly playable in silence
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      this.leadWave = pulseWave(this.ctx, 0.25);
      this.arpWave = pulseWave(this.ctx, 0.125);
      this.noise = this.makeNoise(0.4);
      this.longNoise = this.makeNoise(3.2); // the crowd needs something to roar with
    }
    this.ctx.resume?.();
    return this.ctx;
  }

  makeNoise(seconds) {
    const frames = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** A plain tone with a hard attack and a quick decay. */
  tone(freq, at, dur, wave, level) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    if (typeof wave === 'string') osc.type = wave;
    else osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
    return osc;
  }

  /** Filtered noise: everything percussive here is made of this. */
  noiseBurst(at, { freq, q = 1, dur, level, sweepTo = null, long = false, type = 'bandpass' }) {
    const src = this.ctx.createBufferSource();
    src.buffer = long ? this.longNoise : this.noise;
    if (long) src.loop = true;
    const band = this.ctx.createBiquadFilter();
    band.type = type;
    band.frequency.setValueAtTime(freq, at);
    band.Q.value = q;
    if (sweepTo) band.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + Math.min(0.04, dur / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(band).connect(gain).connect(this.master);
    src.start(at);
    src.stop(at + dur + 0.05);
    return gain;
  }
}

export class Chiptune {
  constructor(engine) {
    this.engine = engine;
    this.playing = false;
    this.timer = null;
    this.stepIndex = 0;
    this.nextStepTime = 0;
  }

  start() {
    if (this.playing) return;
    if (!this.engine.wake()) return;
    this.ctx = this.engine.ctx;
    this.master = this.engine.master;
    this.leadWave = this.engine.leadWave;
    this.arpWave = this.engine.arpWave;
    this.noise = this.engine.noise;
    this.playing = true;
    this.stepIndex = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    // Two clocks: a coarse timer that keeps topping up what the audio clock,
    // which is the accurate one, is going to play next.
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Deliberately not suspending the context: the whistle and the crowd carry
    // on through it once the match has started.
  }

  toggle(on) {
    if (on) this.start();
    else this.stop();
  }

  schedule() {
    if (!this.playing) return;
    const lookahead = 0.25;
    while (this.nextStepTime < this.ctx.currentTime + lookahead) {
      this.playStep(this.stepIndex, this.nextStepTime);
      this.nextStepTime += TRACK.step;
      this.stepIndex = (this.stepIndex + 1) % TRACK.steps;
    }
  }

  playStep(i, at) {
    const lead = TRACK.lead[i];
    if (lead) this.tone(lead.freq, at, lead.dur, this.leadWave, 0.30);

    const arp = TRACK.arp[i];
    if (arp) this.tone(arp.freq, at, arp.dur, this.arpWave, 0.09);

    const bass = TRACK.bass[i];
    if (bass) this.tone(bass.freq, at, bass.dur, 'triangle', 0.42);

    const drum = TRACK.drum[i];
    if (drum === 'kick') this.kick(at);
    else if (drum === 'snare') this.hit(at, 1400, 0.16, 0.28);
    else if (drum === 'hat') this.hit(at, 7000, 0.04, 0.07);
  }

  tone(freq, at, dur, wave, level) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    if (typeof wave === 'string') osc.type = wave;
    else osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(freq, at);
    // Hard on, quick decay: no envelope knobs on those chips either.
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  kick(at) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    gain.gain.setValueAtTime(0.6, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + 0.16);
  }

  hit(at, freq, dur, level) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(band).connect(gain).connect(this.master);
    src.start(at);
    src.stop(at + dur + 0.02);
  }
}

/**
 * Match sounds, built from the same two ingredients as the tune: a tone and a
 * band of noise. Nothing here is a recording.
 */
/** The least time between two things the umpire says, in seconds. */
const LINE_GAP = 2.5;

export class Sfx {
  constructor(engine, speech = null) {
    this.engine = engine;
    this.speech = speech;
    this.lastLine = -99;
    this.lastHit = -99;
    this.talking = true;
  }

  get ctx() {
    return this.engine.ctx;
  }

  ready() {
    return !!this.engine.ctx && this.engine.enabled;
  }

  /**
   * Strings on a ball. A short, hard crack with a lot of very high noise in it -
   * the difference between a firm drive and a stretched-out block is mostly how
   * bright it is, so the filter opens with the pace of the shot.
   */
  hit(power = 700, serve = false) {
    if (!this.ready()) return;
    const now = this.ctx.currentTime;
    if (now - this.lastHit < 0.05) return;
    this.lastHit = now;
    const t = Math.min(1, power / 900);
    this.engine.noiseBurst(now, {
      freq: 900 + t * 2600,
      q: 1.1,
      dur: serve ? 0.1 : 0.075,
      level: 0.32 + t * 0.2,
      sweepTo: 400 + t * 700,
    });
    // A little pitched thump underneath, which is the frame rather than the
    // strings, and what makes it sound like a racket and not a snare.
    this.engine.tone(180 + t * 120, now, 0.05, 'triangle', 0.16);
  }

  /** The ball on the court: duller, lower, no strings in it. */
  bounce() {
    if (!this.ready()) return;
    const now = this.ctx.currentTime;
    this.engine.noiseBurst(now, {
      freq: 620, q: 2.2, dur: 0.06, level: 0.16, sweepTo: 260,
    });
  }

  /** The net cord: a dead, tuneless thud, and the point usually with it. */
  net() {
    if (!this.ready()) return;
    const now = this.ctx.currentTime;
    this.engine.noiseBurst(now, {
      freq: 240, q: 0.9, dur: 0.16, level: 0.24, sweepTo: 110,
    });
  }

  /**
   * Applause. Tennis crowds clap rather than roar, so this is a shower of little
   * bursts rather than the wall of noise a goal gets - the same noise buffer,
   * used completely differently.
   */
  applause(big = false) {
    if (!this.ready()) return;
    const now = this.ctx.currentTime;
    const claps = big ? 46 : 22;
    for (let i = 0; i < claps; i++) {
      // Spread out with a slight bunching at the start, the way a crowd starts
      // together and then falls apart.
      const at = now + 0.02 + (i / claps) ** 1.3 * (big ? 1.9 : 1.1);
      this.engine.noiseBurst(at, {
        freq: 1800 + (i % 7) * 320,
        q: 1.4,
        dur: 0.05,
        level: 0.055 + (i % 3) * 0.012,
      });
    }
  }

  /**
   * The umpire. Rarely, and never over himself: a score call every point is
   * already close to the limit of what anybody wants to hear.
   */
  call(text, { force = false } = {}) {
    if (!this.ready() || !this.talking || !this.speech || !text) return 0;
    const now = this.ctx.currentTime;
    if (!force && now - this.lastLine < LINE_GAP) return 0;
    this.lastLine = now;
    return this.speech.line(text, now);
  }

  say(event) {
    if (!this.ready() || !this.talking || !this.speech) return 0;
    this.lastLine = this.ctx.currentTime;
    return this.speech.say(event);
  }

  /** Everything the simulation reported this frame, turned into noise. */
  play(events, state = null) {
    if (!this.ready()) return;
    for (const e of events) {
      if (e.type === 'hit') this.hit(e.power, e.serve);
      else if (e.type === 'bounce' && e.bounces === 1) this.bounce();
      else if (e.type === 'net') this.net();
      else if (e.type === 'fault') this.say(e.number === 2 ? 'doublefault' : 'fault');
      else if (e.type === 'point') {
        if (e.why === 'OUT') this.say('out');
        if (e.rally >= 6) this.applause();
      } else if (e.type === 'score' && state) {
        // The score, once the point has settled: this is the sound of tennis.
        this.applause();
        this.call(state.callScore, { force: true });
      } else if (e.type === 'game') {
        this.applause(true);
        this.call(gameCall(e.winner), { force: true });
      } else if (e.type === 'match') {
        this.applause(true);
        this.call(gameCall(e.winner, true), { force: true });
      }
    }
  }
}
