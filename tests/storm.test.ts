import { describe, expect, it } from 'vitest';
import { inStorm, ringOf, roundsUntilStormGrows, stormRings } from '../src/engine/board.ts';
import { applyAction, canReach, createGame, eventsSince } from '../src/engine/game.ts';
import { at, board } from './helpers.ts';

// The outer ring is in the storm from the first turn and never grows during a test.
const raging = { stormStartRound: 1, stormInterval: 50 };

describe('storm timing', () => {
  it('stays away until its starting round', () => {
    const s = createGame({ stormStartRound: 3, stormInterval: 2 });
    expect(stormRings(s)).toBe(0);
    expect(roundsUntilStormGrows(s)).toBe(2);
    expect(inStorm(s, at(0, 0))).toBe(false);
    // Turn 4 is still round 2, turn 5 opens round 3.
    expect(stormRings(s, 4)).toBe(0);
    expect(stormRings(s, 5)).toBe(1);
  });

  it('takes another ring every interval until nothing is left', () => {
    const s = createGame({ stormStartRound: 3, stormInterval: 2 });
    const ringsAtRound = (round: number) => stormRings(s, round * 2);
    expect([3, 4, 5, 7, 9, 50].map(ringsAtRound)).toEqual([1, 1, 2, 3, 4, 4]);
    expect(roundsUntilStormGrows({ ...s, turn: 18 })).toBeNull();
  });

  it('counts rings in from the edge', () => {
    const s = createGame();
    expect([at(0, 0), at(7, 3), at(1, 1), at(2, 5), at(3, 4)].map((p) => ringOf(s, p))).toEqual([0, 0, 1, 2, 3]);
  });

  it('can be switched off', () => {
    const s = createGame({ stormStartRound: 0 });
    expect(stormRings(s, 999)).toBe(0);
    expect(roundsUntilStormGrows(s)).toBeNull();
  });

  it('is announced at the start of the round it advances', () => {
    let s = createGame({ stormStartRound: 2, stormInterval: 1 });
    s = applyAction(s, { type: 'pass' });
    expect(s.log.some((e) => e.type === 'stormGrew')).toBe(false);
    const before = s;
    s = applyAction(s, { type: 'pass' });
    expect(eventsSince(before, s)).toContainEqual({ type: 'stormGrew', rings: 1 });
    expect(inStorm(s, s.players[0].pos)).toBe(true);
  });
});

describe('storm damage', () => {
  it('burns a wizard who ends their turn inside it', () => {
    let s = board([
      'A...',
      '....',
      '..C.',
      '....',
    ], raging);
    const before = s;
    s = applyAction(s, { type: 'pass' });
    expect(s.players[0].hp).toBe(4);
    expect(eventsSince(before, s)).toContainEqual({ type: 'stormDamaged', player: 0, amount: 1, hp: 4 });
    s = applyAction(s, { type: 'pass' });
    expect(s.players[1].hp).toBe(5);
  });

  it('spares a wizard who steps out in time', () => {
    let s = board([
      'A...',
      '....',
      '..C.',
      '....',
    ], raging);
    s = applyAction(s, { type: 'move', to: at(1, 1) });
    expect(s.players[0].hp).toBe(5);
  });

  it('gives a wizard shoved into it their own turn to get out', () => {
    let s = board([
      '....',
      '.AC.',
      '....',
      '....',
    ], raging);
    s = applyAction(s, { type: 'cast', spell: 'gust', level: 1, target: at(2, 1) });
    expect(s.players[1].pos).toEqual(at(3, 1));
    expect(s.players[1].hp).toBe(5);
    expect(applyAction(s, { type: 'move', to: at(2, 2) }).players[1].hp).toBe(5);
    expect(applyAction(s, { type: 'pass' }).players[1].hp).toBe(4);
  });

  it('burns a stunned wizard through the turn they lose', () => {
    let s = board([
      '....',
      '.AC~',
      '....',
      '....',
    ], raging);
    s = applyAction(s, { type: 'cast', spell: 'gust', level: 1, target: at(2, 1) });
    expect(s.players[1].pos).toEqual(at(3, 1));
    expect(s.players[1].hp).toBe(4);
    expect(s.current).toBe(0);
  });

  it('wins the game for the other wizard', () => {
    let s = board([
      'A...',
      '....',
      '..C.',
      '....',
    ], raging);
    s.players[0].hp = 1;
    s = applyAction(s, { type: 'pass' });
    expect(s.winner).toBe(1);
    expect(s.log.at(-1)).toEqual({ type: 'won', player: 1 });
  });

  it('can finish off a wizard during a turn they lose', () => {
    let s = board([
      '....',
      '.AC~',
      '....',
      '....',
    ], raging);
    s.players[1].hp = 1;
    s = applyAction(s, { type: 'cast', spell: 'gust', level: 1, target: at(2, 1) });
    expect(s.winner).toBe(0);
  });
});

describe('canReach', () => {
  it('needs range, mana and sight', () => {
    const s = board([
      'A.#.',
      '....',
      '....',
      '...C',
    ]);
    const azure = s.players[0];
    expect(canReach(s, azure, at(3, 3))).toBe(true);
    expect(canReach(s, azure, at(3, 0))).toBe(false);
    expect(canReach(s, azure, azure.pos)).toBe(false);
    expect(canReach(s, { ...azure, mana: 2 }, at(3, 3))).toBe(false);
  });
});
