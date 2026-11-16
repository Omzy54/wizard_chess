import { describe, expect, it } from 'vitest';
import { createGame } from '../src/engine/game.ts';
import { describeSquare, spellsAt, suggestion, whyNoCast, whyOutOfReach } from '../src/ui/explain.ts';
import { at, board } from './helpers.ts';

const plain = (html: string | null) => (html ?? '').replace(/<[^>]+>/g, '');

describe('whyNoCast', () => {
  it('is silent when the spell can be cast', () => {
    const s = board([
      'A.C',
      '...',
      '...',
    ]);
    expect(whyNoCast(s, 'bolt')).toBeNull();
    expect(whyNoCast(s, 'wall')).toBeNull();
  });

  it('says how far away the other wizard is when they are out of range', () => {
    expect(plain(whyNoCast(createGame(), 'bolt'))).toBe('Crimson is 7 squares away. Spells reach 3 squares at most.');
  });

  it('says when a wall is in the way', () => {
    const s = board([
      'A#C',
      '...',
      '...',
    ]);
    expect(plain(whyNoCast(s, 'gust'))).toBe('A wall blocks the line of sight to Crimson.');
  });

  it('says how much mana is missing', () => {
    const s = board([
      'A..C',
      '....',
      '....',
      '....',
    ]);
    s.players[0].mana = 2;
    expect(plain(whyNoCast(s, 'frost'))).toBe('Crimson is 3 squares away, so it costs 3 mana. Azure has 2.');
  });

  it('tells a board with no walls from one with walls out of reach', () => {
    const none = createGame();
    expect(plain(whyNoCast(none, 'shatter'))).toBe('There are no walls to shatter yet.');
    const far = board([
      'A....',
      '.....',
      '.....',
      '.....',
      '...C#',
    ]);
    expect(plain(whyNoCast(far, 'shatter'))).toBe('No wall within 3 squares in clear sight.');
  });

  it('explains that a frozen wizard cannot blink', () => {
    const s = board([
      'A.C',
      '...',
      '...',
    ]);
    s.players[0].frozen = 1;
    expect(plain(whyNoCast(s, 'blink'))).toBe('Azure is frozen and cannot cast Blink.');
  });
});

describe('spellsAt', () => {
  const s = board([
    'A.C.',
    '.#..',
    '....',
    '....',
  ]);

  it('offers the four spells aimed at a wizard on the other wizard', () => {
    expect(spellsAt(s, at(2, 0)).map((c) => c.spell)).toEqual(['bolt', 'gust', 'frost', 'siphon']);
  });

  it('offers Shatter on a wall and the square spells on open ground', () => {
    expect(spellsAt(s, at(1, 1)).map((c) => c.spell)).toEqual(['shatter']);
    expect(spellsAt(s, at(1, 0)).map((c) => c.spell)).toEqual(['wall', 'thundercloud', 'blink']);
  });

  it('prices each spell by distance and marks what is too dear', () => {
    s.players[0].mana = 1;
    expect(spellsAt(s, at(2, 0))[0]).toEqual({ spell: 'bolt', cost: 2, affordable: false });
    expect(spellsAt(s, at(1, 1))[0]).toEqual({ spell: 'shatter', cost: 1, affordable: true });
    s.players[0].mana = 3;
  });

  it('offers nothing out of range or out of sight', () => {
    expect(spellsAt(s, at(3, 3))).toEqual([]);
    expect(spellsAt(s, at(2, 2))).toEqual([]);
    expect(plain(whyOutOfReach(s, at(2, 2)))).toBe('A wall blocks the line of sight to c2.');
  });
});

describe('describeSquare', () => {
  it('explains a Thundercloud and the squares it reaches', () => {
    const s = board([
      'A....',
      '.....',
      '..~..',
      '.....',
      '....C',
    ]);
    expect(plain(describeSquare(s, at(2, 2)))).toContain('Whoever lands on it or next to it loses their next turn.');
    expect(plain(describeSquare(s, at(1, 1)))).toContain('In reach of a Thundercloud: landing here costs a turn.');
  });

  it('warns about the storm and the ring it takes next', () => {
    const s = createGame({ stormStartRound: 2, stormInterval: 3 });
    expect(plain(describeSquare(s, at(3, 0)))).toContain('The storm takes this square next round.');
    expect(plain(describeSquare(createGame(), at(3, 0)))).not.toContain('storm');
    const raging = createGame({ stormStartRound: 1, stormInterval: 3 });
    expect(plain(describeSquare(raging, at(3, 0)))).toContain('Storm: ending a turn here costs 1 HP.');
  });

  it('says what a home corner is worth', () => {
    const s = createGame();
    s.players[1].pos = at(4, 4);
    expect(plain(describeSquare(s, at(7, 0)))).toContain("Crimson's home corner. Azure gains +1 mana a turn by reaching it.");
  });

  it('points out a square the other wizard can bolt', () => {
    const s = board([
      'A....',
      '.....',
      '.....',
      '.....',
      '....C',
    ]);
    expect(plain(describeSquare(s, at(2, 2)))).toContain('Crimson can bolt this square next turn.');
    expect(plain(describeSquare(s, at(0, 1)))).not.toContain('Crimson can bolt');
  });

  it('says why the other wizard or a far square cannot be reached', () => {
    const s = createGame();
    expect(plain(describeSquare(s, at(7, 0)))).toContain('Crimson is 7 squares away. Spells reach 3 squares at most.');
    expect(plain(describeSquare(s, at(4, 7)))).toBe('e1: 4 squares away, out of reach. Spells reach 3 squares at most.');
  });

  it('invites a click on the other wizard once they are in range', () => {
    const s = board([
      'A.C',
      '...',
      '...',
    ]);
    expect(plain(describeSquare(s, at(2, 0)))).toContain('c3: Crimson is 2 squares away. Click to cast on them.');
  });
});

describe('suggestion', () => {
  it('points at the other wizard when they are in range', () => {
    const s = board([
      'A.C',
      '...',
      '...',
    ]);
    expect(plain(suggestion(s))).toContain('Crimson is in range. Click them to attack for 2 mana.');
  });

  it('teaches the cost rule when nobody is close', () => {
    expect(plain(suggestion(createGame()))).toContain('A spell costs 1 mana per square of distance, up to 3.');
  });

  it('says what is missing when they are close but too dear', () => {
    const s = board([
      'A..C',
      '....',
      '....',
      '....',
    ]);
    s.players[0].mana = 1;
    expect(plain(suggestion(s))).toContain('Crimson is 3 squares away: reaching them costs 3 mana and Azure has 1.');
  });
});
