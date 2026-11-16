import { DEFAULT_CONFIG, type GameState, type PlayerId, type PlayerState } from '../engine/index.ts';
import { DIFFICULTIES, type Difficulty } from '../ai/ai.ts';

export interface Setup {
  opponent: 'human' | Difficulty;
  humanSide: PlayerId;
}

export interface Prefs {
  /** Shade the squares the opponent could bolt on their next turn. */
  showThreats: boolean;
}

const SETUP_KEY = 'wizard-chess-setup';
const GAME_KEY = 'wizard-chess-game';
const PREFS_KEY = 'wizard-chess-prefs';

export const DEFAULT_SETUP: Setup = { opponent: 'easy', humanSide: 0 };
export const DEFAULT_PREFS: Prefs = { showThreats: true };

// Storage can be unavailable (private windows, blocked site data), and losing a save is not
// worth bothering the player about, so every failure here is silent.
function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // See above.
  }
}

export function loadSetup(): Setup | null {
  const raw = read(SETUP_KEY) as Partial<Setup> | null;
  const opponentOk = raw?.opponent === 'human' || DIFFICULTIES.includes(raw?.opponent as Difficulty);
  if (opponentOk && (raw?.humanSide === 0 || raw?.humanSide === 1)) return raw as Setup;
  return null;
}

export function saveSetup(setup: Setup): void {
  write(SETUP_KEY, setup);
}

export function loadPrefs(): Prefs {
  const raw = read(PREFS_KEY) as Partial<Prefs> | null;
  return { showThreats: typeof raw?.showThreats === 'boolean' ? raw.showThreats : DEFAULT_PREFS.showThreats };
}

export function savePrefs(prefs: Prefs): void {
  write(PREFS_KEY, prefs);
}

/** Pass null to forget the game in progress. */
export function saveGame(game: GameState | null): void {
  write(GAME_KEY, game);
}

/**
 * The unfinished game from the last visit, if there is one. A save made under different rules
 * (the config changed between versions) is dropped rather than resumed.
 */
export function loadGame(): GameState | null {
  const raw = read(GAME_KEY) as GameState | null;
  if (!raw || typeof raw !== 'object') return null;
  if (JSON.stringify(raw.config) !== JSON.stringify(DEFAULT_CONFIG)) return null;
  const squares = raw.config.boardSize ** 2;
  const tilesOk = Array.isArray(raw.tiles) && raw.tiles.length === squares && raw.tiles.every((t) => ['empty', 'wall', 'cloud'].includes(t));
  const playersOk = Array.isArray(raw.players) && raw.players.length === 2 && raw.players.every(isPlayer);
  const turnOk = (raw.current === 0 || raw.current === 1) && Number.isInteger(raw.turn) && raw.turn >= 1;
  if (!tilesOk || !playersOk || !turnOk || raw.winner !== null || !Array.isArray(raw.log)) return null;
  return raw;
}

function isPlayer(p: PlayerState, index: number): boolean {
  const { boardSize, maxHp, maxMana } = DEFAULT_CONFIG;
  const onBoard = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < boardSize;
  return (
    typeof p === 'object' &&
    p !== null &&
    p.id === index &&
    onBoard(p.pos?.x) &&
    onBoard(p.pos?.y) &&
    Number.isInteger(p.hp) &&
    p.hp > 0 &&
    p.hp <= maxHp &&
    Number.isInteger(p.mana) &&
    p.mana >= 0 &&
    p.mana <= maxMana &&
    Number.isInteger(p.stunned) &&
    p.stunned >= 0 &&
    Number.isInteger(p.frozen) &&
    typeof p.attuned === 'boolean'
  );
}
