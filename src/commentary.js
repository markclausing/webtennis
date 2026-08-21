/**
 * What the umpire knows.
 *
 * The synthesiser in speech.js is shared with websoccer and knows nothing about
 * any sport; this is the tennis half. Tennis is the easy case for a talking
 * scoreboard, because the calls are fixed phrases that have not changed in a
 * century: love, fifteen, thirty, forty, deuce, advantage, game.
 */

export const WORDS = {
  love: ['L', 'AH', 'V'],
  fifteen: ['F', 'IH', 'F', 'T', 'IY', 'N'],
  thirty: ['TH', 'ER', 'T', 'IY'],
  forty: ['F', 'AO', 'R', 'T', 'IY'],
  all: ['AO', 'L'],
  deuce: ['D', 'UW', 'S'],
  advantage: ['AH', 'D', 'V', 'AE', 'N', 'T', 'IH', 'JH'],
  server: ['S', 'ER', 'V', 'ER'],
  receiver: ['R', 'IH', 'S', 'IY', 'V', 'ER'],
  game: ['G', 'EY', 'M'],
  set: ['S', 'EH', 'T'],
  match: ['M', 'AE', 'CH'],
  and: ['AH', 'N', 'D'],
  fault: ['F', 'AO', 'L', 'T'],
  double: ['D', 'AH', 'B', 'AH', 'L'],
  out: ['AW', 'T'],
  in: ['IH', 'N'],
  blue: ['B', 'L', 'UW'],
  red: ['R', 'EH', 'D'],
  play: ['P', 'L', 'EY'],
  quiet: ['K', 'W', 'AY', 'AH', 'T'],
  please: ['P', 'L', 'IY', 'Z'],
  new: ['N', 'UW'],
  balls: ['B', 'AO', 'L', 'Z'],
};

/** Lines with no score in them. Everything else is built as it is needed. */
export const LINES = {
  fault: ['fault'],
  doublefault: ['double fault'],
  out: ['out'],
  start: ['play'],
  quiet: ['quiet please'],
  newballs: ['new balls please'],
};

const PLAYERS = ['blue', 'red'];

/** The name of a player, as the umpire would say it. */
export function playerWord(i) {
  return PLAYERS[i] || 'blue';
}

/** "game blue", "game set and match red". */
export function gameCall(winner, match = false) {
  const who = playerWord(winner);
  return match ? `game set and match ${who}` : `game ${who}`;
}
