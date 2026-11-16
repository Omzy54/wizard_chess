// Plays AI levels against each other to check that each one beats the one below.
// Usage: node tools/arena.ts [games] [timeScale] [pairings]
//   games      games per pairing, sides alternate (default 10)
//   timeScale  multiplies every level's thinking time (default 0.25, keeps runs short)
//   pairings   comma-separated, e.g. hard-medium,expert-hard (default: each level vs the one below)

import { AI_PROFILES, chooseAction, DIFFICULTIES, type Difficulty } from '../src/ai/ai.ts';
import { createGame, resolveAction, validateAction } from '../src/engine/index.ts';

const games = Number(process.argv[2] ?? 10);
const timeScale = Number(process.argv[3] ?? 0.25);
const TURN_LIMIT = 200;

const pairings = (process.argv[4] ?? 'medium-easy,hard-medium,expert-hard').split(',').map((pair) => {
  const [a, b] = pair.split('-') as [Difficulty, Difficulty];
  if (!DIFFICULTIES.includes(a) || !DIFFICULTIES.includes(b)) throw new Error(`Unknown pairing "${pair}"`);
  return [a, b] as const;
});

interface Result {
  winner: Difficulty | null;
  turns: number;
  /** Hit the turn limit and was decided on HP. */
  adjudicated: boolean;
  bolts: number;
  /** Turn each side reached the enemy corner, if they did. */
  attunedOn: (number | null)[];
}

function play(first: Difficulty, second: Difficulty): Result {
  let s = createGame();
  const sides = [first, second];
  let bolts = 0;
  while (s.winner === null && s.turn <= TURN_LIMIT) {
    const profile = AI_PROFILES[sides[s.current]];
    const { action } = chooseAction(s, { ...profile, timeMs: profile.timeMs * timeScale });
    const error = validateAction(s, action);
    if (error) throw new Error(`${sides[s.current]} chose an illegal action: ${error}`);
    if (action.type === 'cast' && action.spell === 'bolt') bolts++;
    s = resolveAction(s, action);
  }
  const attunedOn = [0, 1].map((id) => {
    let turn = 1;
    for (const e of s.log) {
      if (e.type === 'turnStarted') turn = e.turn;
      if (e.type === 'attuned' && e.player === id) return turn;
    }
    return null;
  });
  const base = { turns: s.turn, bolts, attunedOn };
  if (s.winner !== null) return { ...base, winner: sides[s.winner], adjudicated: false };
  const [a, b] = s.players.map((p) => p.hp);
  return { ...base, winner: a === b ? null : sides[a > b ? 0 : 1], adjudicated: true };
}

for (const [a, b] of pairings) {
  const tally = { [a]: 0, [b]: 0, draw: 0 } as Record<string, number>;
  let turns = 0;
  const started = Date.now();
  for (let i = 0; i < games; i++) {
    const result = i % 2 === 0 ? play(a, b) : play(b, a);
    tally[result.winner ?? 'draw']++;
    turns += result.turns;
    const how = result.adjudicated ? ' (on HP at the turn limit)' : '';
    const sides = i % 2 === 0 ? [a, b] : [b, a];
    const attuned = result.attunedOn
      .map((turn, id) => (turn === null ? null : `${sides[id]}@${turn}`))
      .filter(Boolean)
      .join(' ');
    process.stdout.write(
      `  game ${i + 1}: ${result.winner ?? 'draw'} in ${result.turns} turns, ${result.bolts} bolts, attuned ${attuned || 'none'}${how}\n`,
    );
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `${a.padEnd(6)} vs ${b.padEnd(6)}  ${a} ${tally[a]}  ${b} ${tally[b]}  draws ${tally.draw}` +
      `  avg turns ${Math.round(turns / games)}  (${seconds}s)`,
  );
}
