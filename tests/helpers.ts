import { createGame } from '../src/engine/game.ts';
import { tileIndex } from '../src/engine/board.ts';
import type { GameConfig } from '../src/engine/config.ts';
import type { GameState, Pos, Tile } from '../src/engine/types.ts';

/**
 * Builds a state from a picture of the board. `A` is Azure, `C` is Crimson, `#` a wall,
 * `~` a cloud and `.` an empty square. Rows are listed top to bottom. Wizards get 3 mana so
 * spell tests can use every level.
 */
export function board(rows: string[], config: Partial<GameConfig> = {}): GameState {
  const state = createGame({ boardSize: rows.length, startingMana: 3, ...config });
  rows.forEach((row, y) => {
    [...row.replace(/\s+/g, '')].forEach((ch, x) => {
      const p = { x, y };
      if (ch === 'A') state.players[0].pos = p;
      else if (ch === 'C') state.players[1].pos = p;
      else state.tiles[tileIndex(state, p)] = tileFor(ch);
    });
  });
  return state;
}

function tileFor(ch: string): Tile {
  if (ch === '#') return 'wall';
  if (ch === '~') return 'cloud';
  if (ch === '.') return 'empty';
  throw new Error(`Unknown board character "${ch}"`);
}

export const at = (x: number, y: number): Pos => ({ x, y });

export function sortPos(list: Pos[]): Pos[] {
  return [...list].sort((a, b) => a.y - b.y || a.x - b.x);
}
