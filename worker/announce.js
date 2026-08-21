/**
 * What gets said in Discord when somebody makes the board.
 *
 * Kept apart from the Worker so both servers can use it and so the wording can
 * be tested without a network anywhere near it. Nothing in here talks to
 * Discord; it only decides what is news and what the message should say.
 *
 * Not shared with websoccer, deliberately: the machinery either side of it is,
 * but a message saying which game it came from is exactly the part that must
 * differ.
 */

import { LEVELS } from '../src/highscores.js';

/** How many results one post will mention before it just counts the rest. */
const MAX_LINES = 3;

/**
 * Which rows are new, and where they landed.
 *
 * Worked out by comparing the board before and after rather than trusting what
 * was sent: a result that did not make the top ten is not news, and the same
 * result arriving from a second device is not news either, because merging
 * matches it by id.
 */
export function newRows(before, after) {
  const rows = [];
  for (const level of LEVELS) {
    const had = new Set((before?.[level] || []).map((r) => r.id));
    const now = after?.[level] || [];
    for (let i = 0; i < now.length; i++) {
      if (!had.has(now[i].id)) rows.push({ entry: now[i], level, place: i + 1 });
    }
  }
  // Best placings first, so a post that has to cut something cuts the least
  // interesting line.
  return rows.sort((a, b) => a.place - b.place);
}

function ordinal(n) {
  if (n === 1) return 'top of the table';
  if (n === 2) return 'second';
  if (n === 3) return 'third';
  return `number ${n}`;
}

function line({ entry, level, place }) {
  const result = `${entry.scored}-${entry.conceded}`;
  // Tennis has no draws, so there is only one way to say this.
  const beat = `beat **${level.toUpperCase()}** ${result}`;
  return `🏆 **${entry.name}** ${beat} — ${ordinal(place)}`;
}

/**
 * Where the game lives. Overridden with a GAME_URL secret if you host it
 * somewhere else, because the whole point of the message is that people can
 * click it and go and beat the score.
 */
export const GAME_URL = 'https://markclausing.github.io/webtennis/';

/** The blue the court is painted. */
const COLOUR = 0x2f7fa8;

/**
 * The body of the Discord post.
 *
 * An embed rather than a line of text: it gives the message a clickable title,
 * so nobody has to copy an address out of a chat window, and it says which game
 * this is - a bare "MJC beat HARD 5-1" in a busy channel means nothing to
 * anyone who was not already playing.
 *
 * The name is set on the message as well, so it reads as WebSoccer talking
 * whatever the webhook itself was called when it was made.
 */
export function announcement(rows, gameUrl = GAME_URL) {
  const shown = rows.slice(0, MAX_LINES).map(line);
  if (rows.length > MAX_LINES) {
    shown.push(`…and ${rows.length - MAX_LINES} more.`);
  }
  const url = gameUrl || GAME_URL;
  const plural = rows.length > 1 ? 'New high scores' : 'New high score';
  return {
    username: 'WebTennis',
    embeds: [{
      title: `⚽ ${plural} in WebTennis`,
      url,
      description: shown.join('\n'),
      color: COLOUR,
      footer: { text: `Play at ${url.replace(/^https?:\/\//, '').replace(/\/$/, '')}` },
    }],
    // Names are three characters of A-Z, 0-9 and a dash, so they cannot spell a
    // mention - but a board this open should not be one webhook away from
    // pinging a whole server, whatever anybody changes later.
    allowed_mentions: { parse: [] },
  };
}
