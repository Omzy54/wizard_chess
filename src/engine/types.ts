import type { GameConfig } from './config.ts';

export interface Pos {
  x: number;
  y: number;
}

export type PlayerId = 0 | 1;

export type Tile = 'empty' | 'wall' | 'cloud';

export type SpellId = 'bolt' | 'wall' | 'shatter' | 'thundercloud' | 'blink' | 'gust' | 'frost' | 'siphon';

export interface PlayerState {
  id: PlayerId;
  pos: Pos;
  hp: number;
  mana: number;
  /** Turns they will lose before acting again. */
  stunned: number;
  /**
   * Turn starts left until the ice thaws. While above 0 the wizard cannot Move or Blink, and
   * Arcane Bolt hits them harder.
   */
  frozen: number;
  /** Has reached the enemy's home corner and regenerates extra mana every turn. */
  attuned: boolean;
}

export interface GameState {
  config: GameConfig;
  /** Row-major, index = y * boardSize + x. y = 0 is the top row. */
  tiles: Tile[];
  players: [PlayerState, PlayerState];
  current: PlayerId;
  turn: number;
  winner: PlayerId | null;
  log: GameEvent[];
}

export type Action =
  | { type: 'move'; to: Pos }
  | { type: 'cast'; spell: SpellId; level: number; target: Pos }
  | { type: 'pass' };

/** How a wizard changed square: walking, teleporting, or being shoved by Gust or a Shatter blast. */
export type MoveVia = 'step' | 'blink' | 'gust' | 'blast';

export type GameEvent =
  | { type: 'turnStarted'; player: PlayerId; turn: number }
  | { type: 'turnSkipped'; player: PlayerId }
  | { type: 'passed'; player: PlayerId }
  | { type: 'moved'; player: PlayerId; from: Pos; to: Pos; via: MoveVia }
  | { type: 'cast'; player: PlayerId; spell: SpellId; level: number; from: Pos; target: Pos }
  | { type: 'damaged'; player: PlayerId; amount: number; hp: number; iceShattered: boolean }
  | { type: 'pushBlocked'; player: PlayerId }
  | { type: 'wallRaised'; at: Pos }
  | { type: 'wallShattered'; at: Pos }
  | { type: 'cloudPlaced'; at: Pos }
  | { type: 'struck'; player: PlayerId; at: Pos; clouds: Pos[]; turns: number }
  | { type: 'frozen'; player: PlayerId }
  | { type: 'thawed'; player: PlayerId }
  | { type: 'attuned'; player: PlayerId; at: Pos }
  | { type: 'siphoned'; from: PlayerId; to: PlayerId; amount: number }
  | { type: 'stormGrew'; rings: number }
  | { type: 'stormDamaged'; player: PlayerId; amount: number; hp: number }
  | { type: 'won'; player: PlayerId };
