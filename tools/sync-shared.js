// Checks the files shared with websoccer are still the same files.
//
//   node tools/sync-shared.js            # report drift
//   node tools/sync-shared.js --pull     # take websoccer's copy
//   node tools/sync-shared.js --push     # send this copy back
//
// The two games share their plumbing - the input mask, the lockstep netcode, the
// relay, the high score table, the speech synthesiser - and share it by having
// the same file in both repositories rather than by a package, because neither
// game has a build step and neither is going to get one for this.
//
// Copying is only worth anything if somebody notices when the copies part ways,
// which is what this is. It is part of `npm test`, so a change to a shared file
// on one side shows up as a failing test on the other rather than as a bug six
// months later.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THERE = process.env.WEBSOCCER || path.resolve(HERE, '..', 'websoccer');

/**
 * What is generic enough to be identical in both games.
 *
 * Deliberately not on this list: anything that knows what sport it is. The
 * simulation, the renderer, the sounds and the words are each game's own, and
 * pretending otherwise would mean a shared file full of `if (tennis)`.
 */
export const SHARED = [
  'src/util.js',
  'src/input.js',
  'src/touch.js',
  'src/speech.js',
  'src/highscores.js',
  'src/nameEntry.js',
  'src/net/signal.js',
  'src/net/transport.js',
  'server/ws.js',
  'server/relay.js',
  'worker/index.js',
];

function read(root, file) {
  const at = path.join(root, file);
  return existsSync(at) ? readFileSync(at, 'utf8') : null;
}

export function compare(there = THERE) {
  const same = [];
  const differs = [];
  const missing = [];
  for (const file of SHARED) {
    const mine = read(HERE, file);
    const theirs = read(there, file);
    if (mine === null || theirs === null) missing.push(file);
    else if (mine === theirs) same.push(file);
    else differs.push(file);
  }
  return { same, differs, missing };
}

if (process.argv[1] && process.argv[1].endsWith('sync-shared.js')) {
  const pull = process.argv.includes('--pull');
  const push = process.argv.includes('--push');

  if (!existsSync(THERE)) {
    // Not an error: a checkout of one game on its own is a perfectly good
    // checkout. There is simply nothing to compare against.
    console.log(`SKIP: no websoccer beside this one (looked in ${THERE})`);
    process.exit(0);
  }

  const { same, differs, missing } = compare();

  if (pull || push) {
    for (const file of differs) {
      const from = pull ? path.join(THERE, file) : path.join(HERE, file);
      const to = pull ? path.join(HERE, file) : path.join(THERE, file);
      writeFileSync(to, readFileSync(from));
      console.log(`${pull ? 'pulled' : 'pushed'} ${file}`);
    }
    if (!differs.length) console.log('nothing to copy: the shared files already match');
    process.exit(0);
  }

  console.log(`Shared with websoccer: ${same.length} of ${SHARED.length} files identical`);
  for (const file of missing) console.log(`  MISSING  ${file}`);
  for (const file of differs) console.log(`  DIFFERS  ${file}`);

  if (differs.length || missing.length) {
    console.error('');
    console.error('FAIL: the shared files have drifted apart. Look at the difference, decide');
    console.error('which side is right, then run this with --pull or --push.');
    process.exit(1);
  }
  console.log('OK: both games are running the same engine underneath');
}
