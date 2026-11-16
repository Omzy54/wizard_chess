import { describe, expect, it } from 'vitest';
import { getTile } from '../src/engine/board.ts';
import {
  applyAction,
  castOptions,
  createGame,
  eventsSince,
  legalActions,
  moveTargets,
  validateAction,
} from '../src/engine/game.ts';
import { at, board, sortPos } from './helpers.ts';

describe('setup', () => {
  it('puts the wizards in opposite corners with full HP and 1 mana', () => {
    const s = createGame();
    expect(s.players[0].pos).toEqual(at(0, 7));
    expect(s.players[1].pos).toEqual(at(7, 0));
    expect(s.players.map((p) => p.hp)).toEqual([5, 5]);
    expect(s.players.map((p) => p.mana)).toEqual([1, 1]);
    expect(s.current).toBe(0);
  });
});

describe('turns and mana', () => {
  it('alternates players and regenerates 1 mana at the end of each turn', () => {
    let s = createGame();
    s = applyAction(s, { type: 'move', to: at(1, 6) });
    expect(s.current).toBe(1);
    expect(s.players[0].mana).toBe(2);
    s = applyAction(s, { type: 'pass' });
    expect(s.current).toBe(0);
    expect(s.players[1].mana).toBe(2);
  });

  it('only allows level 1 spells on the first turn', () => {
    const s = createGame();
    expect(validateAction(s, { type: 'cast', spell: 'wall', level: 1, target: at(1, 6) })).toBeNull();
    expect(validateAction(s, { type: 'cast', spell: 'wall', level: 2, target: at(2, 5) })).toMatch(/mana/);
  });

  it('caps mana', () => {
    let s = createGame();
    for (let i = 0; i < 10; i++) s = applyAction(s, { type: 'pass' });
    expect(s.players[0].mana).toBe(5);
  });

  it('charges the spell level in mana', () => {
    let s = board([
      'A.#.',
      '....',
      '....',
      '...C',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'shatter', level: 2, target: at(2, 0) });
    expect(s.players[0].mana).toBe(3 - 2 + 1);
  });

  it('rejects spells you cannot afford', () => {
    const s = board([
      'A..C',
      '....',
      '....',
      '....',
    ]);
    s.players[0].mana = 2;
    expect(validateAction(s, { type: 'cast', spell: 'bolt', level: 3, target: at(3, 0) })).toMatch(/mana/);
  });
});

describe('moving', () => {
  it('offers the eight surrounding squares that are free', () => {
    const s = board([
      '.#..',
      '.A..',
      '..C.',
      '....',
    ]);
    expect(sortPos(moveTargets(s))).toEqual(sortPos([at(0, 0), at(2, 0), at(0, 1), at(2, 1), at(0, 2), at(1, 2)]));
  });

  it('rejects illegal moves', () => {
    const s = createGame();
    expect(validateAction(s, { type: 'move', to: at(2, 7) })).not.toBeNull();
    expect(() => applyAction(s, { type: 'move', to: at(2, 7) })).toThrow();
  });
});

describe('range and sight', () => {
  const s = board([
    'A......',
    '.......',
    '.......',
    '...C...',
    '.......',
    '.......',
    '.......',
  ]);

  it('needs a level at least as high as the distance', () => {
    expect(validateAction(s, { type: 'cast', spell: 'bolt', level: 2, target: at(3, 3) })).toMatch(/range/);
    expect(validateAction(s, { type: 'cast', spell: 'bolt', level: 3, target: at(3, 3) })).toBeNull();
  });

  it('never reaches beyond level 3', () => {
    const far = board([
      'A...C',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    expect(castOptions(far, 'bolt')).toEqual([]);
  });

  it('is blocked by walls', () => {
    const walled = board([
      'A#C',
      '...',
      '...',
    ]);
    expect(validateAction(walled, { type: 'cast', spell: 'bolt', level: 2, target: at(2, 0) })).toMatch(/sight/);
  });

  it('reports the cheapest level for each target', () => {
    const options = castOptions(s, 'wall');
    expect(options.find((o) => o.target.x === 1 && o.target.y === 1)?.level).toBe(1);
    expect(options.find((o) => o.target.x === 2 && o.target.y === 0)?.level).toBe(2);
    expect(options.find((o) => o.target.x === 3 && o.target.y === 1)?.affordable).toBe(true);
  });
});

describe('spells', () => {
  it('Arcane Bolt deals 1 damage', () => {
    let s = board([
      'A.C',
      '...',
      '...',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'bolt', level: 2, target: at(2, 0) });
    expect(s.players[1].hp).toBe(4);
  });

  it('Raise Wall and Shatter add and remove walls', () => {
    let s = board([
      'A..',
      '...',
      '..C',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'wall', level: 1, target: at(1, 0) });
    expect(getTile(s, at(1, 0))).toBe('wall');
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'cast', spell: 'shatter', level: 1, target: at(1, 0) });
    expect(getTile(s, at(1, 0))).toBe('empty');
  });

  it('Raise Wall needs an empty square', () => {
    const s = board([
      'A~.',
      '.C.',
      '...',
    ]);
    expect(validateAction(s, { type: 'cast', spell: 'wall', level: 1, target: at(1, 0) })).not.toBeNull();
    expect(validateAction(s, { type: 'cast', spell: 'wall', level: 1, target: at(1, 1) })).not.toBeNull();
  });

  it('Thundercloud stuns whoever walks into it and then disappears', () => {
    let s = board([
      'A...',
      '....',
      '....',
      '...C',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'thundercloud', level: 3, target: at(3, 2) });
    expect(getTile(s, at(3, 2))).toBe('cloud');
    s = applyAction(s, { type: 'move', to: at(3, 2) });
    expect(getTile(s, at(3, 2))).toBe('empty');
    expect(s.players[1].stunned).toBe(1);

    const before = s;
    s = applyAction(s, { type: 'pass' });
    // Crimson's turn is skipped, so it comes straight back to Azure.
    expect(s.current).toBe(0);
    expect(s.players[1].stunned).toBe(0);
    expect(eventsSince(before, s).map((e) => e.type)).toContain('turnSkipped');
  });

  it('Thundercloud also catches its own caster', () => {
    let s = board([
      'A~.',
      '...',
      '..C',
    ]);
    s = applyAction(s, { type: 'move', to: at(1, 0) });
    expect(s.players[0].stunned).toBe(1);
    s = applyAction(s, { type: 'pass' });
    expect(s.current).toBe(1);
  });

  it('Thundercloud strikes a wizard who steps next to it', () => {
    let s = board([
      'A....',
      '.....',
      '..~..',
      '.....',
      '....C',
    ]);
    const before = s;
    s = applyAction(s, { type: 'move', to: at(1, 1) });
    expect(s.players[0].stunned).toBe(1);
    expect(getTile(s, at(2, 2))).toBe('empty');
    expect(eventsSince(before, s)).toContainEqual({ type: 'struck', player: 0, at: at(1, 1), clouds: [at(2, 2)], turns: 1 });
  });

  it('Thundercloud leaves alone a wizard who was already beside it', () => {
    let s = board([
      'A....',
      '.....',
      '.....',
      '...C.',
      '.....',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'thundercloud', level: 3, target: at(3, 2) });
    expect(s.players[1].stunned).toBe(0);
    // Standing still and casting is safe, and so is stepping clear of it.
    s = applyAction(s, { type: 'cast', spell: 'wall', level: 1, target: at(4, 4) });
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'move', to: at(3, 4) });
    expect(s.players[1].stunned).toBe(0);
    expect(getTile(s, at(3, 2))).toBe('cloud');
  });

  it('Thundercloud strikes a wizard who shuffles along beside it', () => {
    let s = board([
      'A....',
      '.....',
      '...~.',
      '...C.',
      '.....',
    ]);
    s.current = 1;
    s = applyAction(s, { type: 'move', to: at(2, 3) });
    expect(s.players[1].stunned).toBe(1);
  });

  it('Thundercloud strikes a wizard who blinks next to it', () => {
    let s = board([
      'A....',
      '.....',
      '.....',
      '...~.',
      '....C',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'blink', level: 2, target: at(2, 2) });
    expect(s.players[0].stunned).toBe(1);
    expect(s.current).toBe(1);
    s = applyAction(s, { type: 'pass' });
    expect(s.current).toBe(1);
  });

  it('every Thundercloud within reach discharges at once', () => {
    let s = board([
      'A....',
      '..~..',
      '~....',
      '.....',
      '....C',
    ]);
    s = applyAction(s, { type: 'move', to: at(1, 1) });
    expect(s.players[0].stunned).toBe(1);
    expect(s.tiles.includes('cloud')).toBe(false);
  });

  it('Gust strikes a wizard blown to a square next to a Thundercloud', () => {
    let s = board([
      'AC.....',
      '...~...',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'gust', level: 1, target: at(1, 0) });
    expect(s.players[1].pos).toEqual(at(3, 0));
    expect(s.players[1].stunned).toBe(0);
    expect(getTile(s, at(3, 1))).toBe('empty');
    // Crimson lost the turn, so Azure is up again.
    expect(s.current).toBe(0);
  });

  it('a wizard blown past a Thundercloud without landing by it is not struck', () => {
    let s = board([
      'AC.....',
      '.~.....',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'gust', level: 1, target: at(1, 0) });
    expect(s.players[1].pos).toEqual(at(3, 0));
    expect(getTile(s, at(1, 1))).toBe('cloud');
    expect(s.current).toBe(1);
  });

  it('Blink teleports to an open square in sight', () => {
    let s = board([
      'A...',
      '....',
      '....',
      '...C',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'blink', level: 2, target: at(2, 2) });
    expect(s.players[0].pos).toEqual(at(2, 2));
  });

  it('Blink cannot land on a wall or the other wizard', () => {
    const s = board([
      'A#.',
      '.C.',
      '...',
    ]);
    expect(validateAction(s, { type: 'cast', spell: 'blink', level: 1, target: at(1, 0) })).not.toBeNull();
    expect(validateAction(s, { type: 'cast', spell: 'blink', level: 1, target: at(1, 1) })).not.toBeNull();
  });

  it('Gust blows the opponent 2 squares directly away', () => {
    let s = board([
      'A....',
      '.C...',
      '.....',
      '.....',
      '.....',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'gust', level: 1, target: at(1, 1) });
    expect(s.players[1].pos).toEqual(at(3, 3));
  });

  it('Gust stops early at a wall', () => {
    let s = board([
      'AC.#.',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'gust', level: 1, target: at(1, 0) });
    expect(s.players[1].pos).toEqual(at(2, 0));
  });

  it('Gust against a wall or the edge does nothing', () => {
    let s = board([
      'A.C#',
      '....',
      '....',
      '....',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'gust', level: 2, target: at(2, 0) });
    expect(s.players[1].pos).toEqual(at(2, 0));
    expect(s.log.some((e) => e.type === 'pushBlocked')).toBe(true);
  });

  it('Gust into a Thundercloud stops there and stuns the opponent', () => {
    let s = board([
      'AC~..',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'gust', level: 1, target: at(1, 0) });
    expect(s.players[1].pos).toEqual(at(2, 0));
    // Crimson was stunned during Azure's turn, so Azure goes again.
    expect(s.current).toBe(0);
  });

  it('Shatter throws wizards next to the wall 2 squares away from it', () => {
    let s = board([
      'A......',
      '.......',
      '...#C..',
      '.......',
      '.......',
      '.......',
      '.......',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'shatter', level: 3, target: at(3, 2) });
    expect(getTile(s, at(3, 2))).toBe('empty');
    expect(s.players[1].pos).toEqual(at(6, 2));
    expect(s.players[0].pos).toEqual(at(0, 0));
  });

  it('Shatter blows up every wall joined to its target, corners included', () => {
    let s = board([
      'A......',
      '.#.....',
      '..#....',
      '..#..#.',
      '.......',
      '.......',
      '......C',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'shatter', level: 1, target: at(1, 1) });
    expect([at(1, 1), at(2, 2), at(2, 3)].map((p) => getTile(s, p))).toEqual(['empty', 'empty', 'empty']);
    // Not touching the others, so it stands.
    expect(getTile(s, at(5, 3))).toBe('wall');
  });

  it('a chain of walls carries the blast to a wizard out of reach', () => {
    let s = board([
      'A#.....',
      '..#....',
      '...#...',
      '....#C.',
      '.......',
      '.......',
      '.......',
    ]);
    s.players[0].pos = at(0, 2);
    s = applyAction(s, { type: 'cast', spell: 'shatter', level: 2, target: at(1, 0) });
    expect(s.players[1].pos).toEqual(at(6, 3));
    expect(s.players[0].pos).toEqual(at(0, 2));
  });

  it('the blast throws a wizard away from all the walls beside them together', () => {
    let s = board([
      'A......',
      '.......',
      '..##...',
      '..#C...',
      '.......',
      '.......',
      '.......',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'shatter', level: 2, target: at(2, 2) });
    // Walls to the west, north-west and north push south-east.
    expect(s.players[1].pos).toEqual(at(5, 5));
  });

  it('a wizard caught between two blown walls is not thrown', () => {
    let s = board([
      'A......',
      '.......',
      '..###..',
      '..#C#..',
      '..###..',
      '.......',
      '.......',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'shatter', level: 2, target: at(2, 2) });
    expect(s.tiles.includes('wall')).toBe(false);
    expect(s.players[1].pos).toEqual(at(3, 3));
  });

  it('Shatter can knock its own caster too', () => {
    let s = board([
      'A#.',
      '...',
      '..C',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'shatter', level: 1, target: at(1, 0) });
    // Azure is in the corner, so there is nowhere to be knocked.
    expect(s.players[0].pos).toEqual(at(0, 0));
    let t = board([
      '.A#....',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '......C',
    ]);
    t = applyAction(t, { type: 'cast', spell: 'shatter', level: 1, target: at(2, 0) });
    expect(t.players[0].pos).toEqual(at(0, 0));
  });

  it('Freeze stops the opponent moving or blinking for their next two turns', () => {
    let s = board([
      'A...',
      '.C..',
      '....',
      '....',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'frost', level: 1, target: at(1, 1) });
    for (let turn = 0; turn < 2; turn++) {
      expect(s.current).toBe(1);
      expect(moveTargets(s)).toEqual([]);
      expect(castOptions(s, 'blink')).toEqual([]);
      expect(validateAction(s, { type: 'move', to: at(2, 2) })).toMatch(/frozen/);
      expect(validateAction(s, { type: 'cast', spell: 'bolt', level: 1, target: at(0, 0) })).toBeNull();
      s = applyAction(s, { type: 'pass' });
      // Still frozen on Azure's turn, so a bolt would hit for 2.
      expect(s.players[1].frozen).toBeGreaterThan(0);
      s = applyAction(s, { type: 'pass' });
    }
    expect(s.players[1].frozen).toBe(0);
    expect(s.log.filter((e) => e.type === 'thawed')).toHaveLength(1);
    expect(moveTargets(s).length).toBeGreaterThan(0);
  });

  it('Freeze leaves a second chance at the 2-damage bolt', () => {
    let s = board([
      'A...',
      '....',
      '..C.',
      '....',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'frost', level: 2, target: at(2, 2) });
    s = applyAction(s, { type: 'pass' });
    // Azure lets the first chance go by.
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'cast', spell: 'bolt', level: 2, target: at(2, 2) });
    expect(s.players[1].hp).toBe(3);
  });

  it('Arcane Bolt deals 2 to a frozen wizard and shatters the ice', () => {
    let s = board([
      'A...',
      '.C..',
      '....',
      '....',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'frost', level: 1, target: at(1, 1) });
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'cast', spell: 'bolt', level: 1, target: at(1, 1) });
    expect(s.players[1].hp).toBe(3);
    expect(s.players[1].frozen).toBe(0);
    expect(moveTargets(s).length).toBeGreaterThan(0);
  });

  it('Siphon steals 2 mana', () => {
    let s = board([
      'AC.',
      '...',
      '...',
    ]);
    s = applyAction(s, { type: 'cast', spell: 'siphon', level: 1, target: at(1, 0) });
    expect(s.players[1].mana).toBe(1);
    // 3 - 1 cost + 2 stolen + 1 regen, capped at 5
    expect(s.players[0].mana).toBe(5);
  });

  it('Siphon only takes what is there', () => {
    let s = board([
      'AC.',
      '...',
      '...',
    ]);
    s.players[1].mana = 1;
    s = applyAction(s, { type: 'cast', spell: 'siphon', level: 1, target: at(1, 0) });
    expect(s.players[1].mana).toBe(0);
    expect(s.players[0].mana).toBe(4);
  });

  it('spells that need the opponent cannot target an empty square', () => {
    const s = board([
      'A..',
      '...',
      '..C',
    ]);
    expect(validateAction(s, { type: 'cast', spell: 'bolt', level: 1, target: at(1, 1) })).not.toBeNull();
  });
});

describe('attunement', () => {
  it('starts with neither wizard attuned', () => {
    expect(createGame().players.map((p) => p.attuned)).toEqual([false, false]);
  });

  it('attunes a wizard who walks into the enemy home corner', () => {
    let s = board([
      '...C',
      '....',
      '..A.',
      '....',
    ]);
    // Crimson's home on a 4x4 board is (3, 0). Clear it first.
    s.players[1].pos = at(1, 3);
    s = applyAction(s, { type: 'move', to: at(3, 1) });
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'move', to: at(3, 0) });
    expect(s.players[0].attuned).toBe(true);
    expect(s.log.some((e) => e.type === 'attuned' && e.player === 0)).toBe(true);
  });

  it('gives an extra mana every turn, for good', () => {
    let s = createGame();
    s.players[0].attuned = true;
    s = applyAction(s, { type: 'pass' });
    expect(s.players[0].mana).toBe(3);
    s = applyAction(s, { type: 'pass' });
    s = applyAction(s, { type: 'pass' });
    expect(s.players[0].mana).toBe(5);
    expect(s.players[1].mana).toBe(2);
  });

  it('counts blinking into the corner', () => {
    let s = board([
      '....',
      '..A.',
      '....',
      'C...',
    ]);
    s.players[1].pos = at(0, 1);
    s = applyAction(s, { type: 'cast', spell: 'blink', level: 1, target: at(3, 0) });
    expect(s.players[0].attuned).toBe(true);
  });

  it('does not count your own home corner', () => {
    let s = board([
      'C...',
      '....',
      '.A..',
      '....',
    ]);
    s = applyAction(s, { type: 'move', to: at(0, 3) });
    expect(s.players[0].attuned).toBe(false);
  });
});

describe('winning', () => {
  it('ends the game when a wizard reaches 0 HP', () => {
    let s = board([
      'AC.',
      '...',
      '...',
    ]);
    s.players[1].hp = 1;
    s = applyAction(s, { type: 'cast', spell: 'bolt', level: 1, target: at(1, 0) });
    expect(s.winner).toBe(0);
    expect(legalActions(s)).toEqual([]);
    expect(validateAction(s, { type: 'pass' })).toMatch(/over/);
  });
});

describe('legalActions', () => {
  it('only lists actions that validate', () => {
    const s = board([
      'A.#.....',
      '..~.....',
      '.#......',
      '....C...',
      '........',
      '........',
      '........',
      '........',
    ]);
    const actions = legalActions(s);
    expect(actions.length).toBeGreaterThan(10);
    for (const action of actions) expect(validateAction(s, action)).toBeNull();
  });

  it('survives garbage input', () => {
    const s = createGame();
    expect(validateAction(s, { type: 'cast', spell: 'nope', level: 1, target: at(0, 6) } as never)).not.toBeNull();
    expect(validateAction(s, { type: 'move' } as never)).not.toBeNull();
    expect(validateAction(s, { type: 'cast', spell: 'wall', level: 1.5, target: at(0, 6) })).not.toBeNull();
    expect(validateAction(s, null as never)).not.toBeNull();
  });
});
