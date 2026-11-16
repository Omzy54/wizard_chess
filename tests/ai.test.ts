import { describe, expect, it } from 'vitest';
import { AI_PROFILES, candidateActions, chooseAction, DIFFICULTIES, evaluate } from '../src/ai/ai.ts';
import { distance, hasLineOfSight } from '../src/engine/board.ts';
import { applyAction, createGame, validateAction } from '../src/engine/game.ts';
import type { GameState } from '../src/engine/types.ts';
import { at, board } from './helpers.ts';

// Short budgets keep the suite fast. Depth limits still differ per level.
const quick = Object.fromEntries(DIFFICULTIES.map((d) => [d, { ...AI_PROFILES[d], timeMs: 60 }]));

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 2 ** 32;
  };
}

describe('candidate actions', () => {
  it('are all legal', () => {
    const s = board([
      '...#....',
      '.C......',
      '..~.....',
      '...#....',
      '........',
      '....A...',
      '........',
      '........',
    ]);
    for (const action of candidateActions(s)) expect(validateAction(s, action)).toBeNull();
  });

  it('only cast at the cheapest level', () => {
    const s = board([
      'A..C',
      '....',
      '....',
      '....',
    ]);
    const bolts = candidateActions(s).filter((a) => a.type === 'cast' && a.spell === 'bolt');
    expect(bolts).toEqual([{ type: 'cast', spell: 'bolt', level: 3, target: at(3, 0) }]);
  });
});

describe('evaluate', () => {
  it('prefers having more HP', () => {
    const s = createGame();
    const hurt: GameState = { ...s, players: [{ ...s.players[0], hp: 2 }, s.players[1]] };
    expect(evaluate(hurt, 1)).toBeGreaterThan(evaluate(s, 1));
    expect(evaluate(hurt, 0)).toBeLessThan(evaluate(s, 0));
  });

  it('counts a stun and a freeze against the wizard who suffers them', () => {
    const s = createGame();
    const stunned: GameState = { ...s, players: [{ ...s.players[0], stunned: 1 }, s.players[1]] };
    const frozen: GameState = { ...s, players: [{ ...s.players[0], frozen: 2 }, s.players[1]] };
    expect(evaluate(stunned, 0)).toBeLessThan(evaluate(s, 0));
    expect(evaluate(frozen, 0)).toBeLessThan(evaluate(s, 0));
  });

  it('sees a Gust that would throw the other wizard into the reach of a cloud', () => {
    const open = board([
      'A.C.....',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    const trapped = board([
      'A.C.....',
      '....~...',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    expect(evaluate(trapped, 0) - evaluate(open, 0)).toBeGreaterThan(20);
  });
});

describe('chooseAction', () => {
  it('returns a legal action at every difficulty', () => {
    let s = createGame();
    const rng = seeded(7);
    for (let turn = 0; turn < 40 && s.winner === null; turn++) {
      const difficulty = DIFFICULTIES[turn % DIFFICULTIES.length];
      const { action } = chooseAction(s, quick[difficulty], rng);
      expect(validateAction(s, action)).toBeNull();
      s = applyAction(s, action);
    }
  });

  it('does not change the state it is given', () => {
    const s = board([
      'A.#.',
      '..~.',
      '....',
      '...C',
    ]);
    const before = JSON.stringify(s);
    chooseAction(s, quick.hard);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('takes a winning bolt', () => {
    const s = board([
      'A.......',
      '........',
      '..C.....',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    s.players[1].hp = 1;
    for (const difficulty of ['medium', 'hard', 'expert'] as const) {
      const { action } = chooseAction(s, { ...quick[difficulty], blunder: 0, temperature: 0 });
      expect(action).toEqual({ type: 'cast', spell: 'bolt', level: 2, target: at(2, 2) });
    }
  });

  it('walks out of the storm rather than burn', () => {
    const s = board([
      '........',
      '......C.',
      '........',
      '........',
      'A.......',
      '........',
      '........',
      '........',
    ], { stormStartRound: 1, stormInterval: 50 });
    const { action } = chooseAction(s, quick.hard);
    expect(applyAction(s, action).players[0].hp).toBe(5);
  });

  it('gets out of a bolt it cannot survive', () => {
    // Crimson is on 1 HP and cannot reach Azure, who will have the mana to fire next turn.
    const s = board([
      'A..C....',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    s.current = 1;
    s.players[1].hp = 1;
    s.players[1].mana = 1;
    const { action } = chooseAction(s, quick.hard);
    const after = applyAction(s, action);
    const azure = after.players[0];
    const crimson = after.players[1];
    const exposed = distance(azure.pos, crimson.pos) <= Math.min(azure.mana, 3) && hasLineOfSight(after, azure.pos, crimson.pos);
    expect(exposed).toBe(false);
  });
});
