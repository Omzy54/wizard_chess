import { describe, expect, it } from 'vitest';
import { getTile, samePos } from '../src/engine/board.ts';
import { applyAction, createGame, legalActions, validateAction } from '../src/engine/game.ts';
import type { GameState } from '../src/engine/types.ts';

// Small deterministic PRNG so a failure can be replayed from its seed.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkInvariants(s: GameState): void {
  const [a, b] = s.players;
  expect(samePos(a.pos, b.pos)).toBe(false);
  for (const p of s.players) {
    expect(getTile(s, p.pos)).not.toBe('wall');
    // A wizard that steps onto a cloud consumes it immediately.
    expect(getTile(s, p.pos)).not.toBe('cloud');
    expect(p.mana).toBeGreaterThanOrEqual(0);
    expect(p.mana).toBeLessThanOrEqual(s.config.maxMana);
    expect(p.hp).toBeGreaterThanOrEqual(0);
    expect(p.hp).toBeLessThanOrEqual(s.config.maxHp);
    expect(p.frozen).toBeGreaterThanOrEqual(0);
    expect(p.frozen).toBeLessThanOrEqual(s.config.frostTurns);
  }
  if (s.winner === null) {
    expect(s.players[s.current].stunned).toBe(0);
    expect(s.players.every((p) => p.hp > 0)).toBe(true);
  }
}

describe('random games', () => {
  it('never reach an invalid state', { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = mulberry32(seed);
      let s = createGame();
      for (let step = 0; step < 200 && s.winner === null; step++) {
        const actions = legalActions(s);
        expect(actions.length).toBeGreaterThan(0);
        const action = actions[Math.floor(rand() * actions.length)];
        expect(validateAction(s, action)).toBeNull();
        s = applyAction(s, action);
        checkInvariants(s);
      }
      // However aimlessly both sides play, the storm ends the game.
      expect(s.winner).not.toBeNull();
    }
  });

  it('do not mutate the previous state', () => {
    const rand = mulberry32(42);
    let s = createGame();
    for (let step = 0; step < 100 && s.winner === null; step++) {
      const snapshot = JSON.stringify(s);
      const actions = legalActions(s);
      const next = applyAction(s, actions[Math.floor(rand() * actions.length)]);
      expect(JSON.stringify(s)).toBe(snapshot);
      s = next;
    }
  });
});
