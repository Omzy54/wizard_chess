import { describe, expect, it } from 'vitest';
import { canStep, distance, hasLineOfSight } from '../src/engine/board.ts';
import { at, board } from './helpers.ts';

describe('distance', () => {
  it('counts diagonal steps as one', () => {
    expect(distance(at(0, 0), at(3, 3))).toBe(3);
    expect(distance(at(0, 0), at(3, 1))).toBe(3);
    expect(distance(at(2, 2), at(2, 2))).toBe(0);
  });
});

describe('line of sight', () => {
  it('is clear on an open board', () => {
    const s = board([
      'A....',
      '.....',
      '.....',
      '.....',
      '....C',
    ]);
    expect(hasLineOfSight(s, at(0, 0), at(4, 4))).toBe(true);
    expect(hasLineOfSight(s, at(0, 0), at(4, 1))).toBe(true);
  });

  it('is blocked by a wall in a straight line', () => {
    const s = board([
      'A.#.C',
      '.....',
      '.....',
    ]);
    expect(hasLineOfSight(s, at(0, 0), at(4, 0))).toBe(false);
    expect(hasLineOfSight(s, at(0, 0), at(1, 0))).toBe(true);
  });

  it('is blocked by a wall on a diagonal', () => {
    const s = board([
      'A...',
      '.#..',
      '..C.',
      '....',
    ]);
    expect(hasLineOfSight(s, at(0, 0), at(2, 2))).toBe(false);
  });

  it('is blocked by a wall the line cuts through at an angle', () => {
    const s = board([
      'A#..',
      '..C.',
      '....',
    ]);
    // Centre (0.5,0.5) to (2.5,1.5) crosses x = 1 at y = 0.75, inside the wall.
    expect(hasLineOfSight(s, at(0, 0), at(2, 1))).toBe(false);
  });

  it('is not blocked by a wall the line only grazes at a corner', () => {
    const s = board([
      'A#..',
      '....',
      '..C.',
    ]);
    // The diagonal touches the wall's bottom-left corner only.
    expect(hasLineOfSight(s, at(0, 0), at(2, 2))).toBe(true);
  });

  it('cannot squeeze between two walls that touch at a corner', () => {
    const s = board([
      'A#..',
      '#...',
      '..C.',
    ]);
    expect(hasLineOfSight(s, at(0, 0), at(1, 1))).toBe(false);
    expect(hasLineOfSight(s, at(0, 0), at(2, 2))).toBe(false);
  });

  it('can see a wall it is aiming at', () => {
    const s = board([
      'A.#',
      '...',
      '..C',
    ]);
    expect(hasLineOfSight(s, at(0, 0), at(2, 0))).toBe(true);
  });

  it('is symmetric', () => {
    const s = board([
      'A..#....',
      '.#...#..',
      '...#....',
      '#.....#.',
      '..#.....',
      '.....#..',
      '.#......',
      '......#C',
    ]);
    for (let i = 0; i < 64; i++) {
      for (let j = 0; j < 64; j++) {
        const a = at(i % 8, Math.floor(i / 8));
        const b = at(j % 8, Math.floor(j / 8));
        expect(hasLineOfSight(s, a, b)).toBe(hasLineOfSight(s, b, a));
      }
    }
  });
});

describe('stepping', () => {
  const s = board([
    'A#.',
    '#..',
    '..C',
  ]);

  it('cannot step into walls or the other wizard', () => {
    expect(canStep(s, at(0, 0), at(1, 0))).toBe(false);
    expect(canStep(s, at(1, 2), at(2, 2))).toBe(false);
  });

  it('cannot slip diagonally between corner-touching walls', () => {
    expect(canStep(s, at(0, 0), at(1, 1))).toBe(false);
  });

  it('can step diagonally past a single wall', () => {
    expect(canStep(s, at(2, 0), at(1, 1))).toBe(true);
  });

  it('cannot step off the board or more than one square', () => {
    expect(canStep(s, at(2, 1), at(3, 1))).toBe(false);
    expect(canStep(s, at(2, 0), at(2, 2))).toBe(false);
  });
});
