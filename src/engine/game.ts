import {
  allSquares,
  canStep,
  DIRECTIONS,
  distance,
  hasLineOfSight,
  inBounds,
  inStorm,
  otherPlayer,
  stormRings,
} from './board.ts';
import { DEFAULT_CONFIG, type GameConfig } from './config.ts';
import { emit, movePlayer } from './effects.ts';
import { isSpellId, matchesTarget, resolveSpell, SPELL_ORDER, SPELLS } from './spells.ts';
import type { Action, GameEvent, GameState, PlayerId, PlayerState, Pos, SpellId } from './types.ts';

export function createGame(overrides: Partial<GameConfig> = {}): GameState {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const last = config.boardSize - 1;
  const wizard = (id: PlayerId, pos: Pos): PlayerState => ({
    id,
    pos,
    hp: config.maxHp,
    mana: config.startingMana,
    stunned: 0,
    frozen: 0,
    attuned: false,
  });
  return {
    config,
    tiles: new Array(config.boardSize * config.boardSize).fill('empty'),
    players: [wizard(0, { x: 0, y: last }), wizard(1, { x: last, y: 0 })],
    current: 0,
    turn: 1,
    winner: null,
    log: [{ type: 'turnStarted', player: 0, turn: 1 }],
  };
}

export function activePlayer(state: GameState): PlayerState {
  return state.players[state.current];
}

export function moveTargets(state: GameState): Pos[] {
  const actor = activePlayer(state);
  if (state.winner !== null || actor.frozen > 0) return [];
  return DIRECTIONS.map((d) => ({ x: actor.pos.x + d.x, y: actor.pos.y + d.y })).filter((to) =>
    canStep(state, actor.pos, to),
  );
}

export interface CastOption {
  target: Pos;
  /** Cheapest level that reaches the target. */
  level: number;
  affordable: boolean;
}

/** Every square the active wizard could cast `spell` on at some level, affordable or not. */
export function castOptions(state: GameState, spell: SpellId): CastOption[] {
  const actor = activePlayer(state);
  if (state.winner !== null || (SPELLS[spell].movesCaster && actor.frozen > 0)) return [];
  const options: CastOption[] = [];
  for (const target of allSquares(state)) {
    const level = distance(actor.pos, target);
    if (level < 1 || level > state.config.maxSpellLevel) continue;
    if (!matchesTarget(state, actor, spell, target) || !hasLineOfSight(state, actor.pos, target)) continue;
    options.push({ target, level, affordable: level <= actor.mana });
  }
  return options;
}

/**
 * Whether `caster` has the range, mana and sight to cast on `target` as things stand. Asked
 * about the wizard who is not to move, it tells you what they threaten on their next turn.
 */
export function canReach(state: GameState, caster: PlayerState, target: Pos): boolean {
  const gap = distance(caster.pos, target);
  return gap >= 1 && gap <= Math.min(caster.mana, state.config.maxSpellLevel) && hasLineOfSight(state, caster.pos, target);
}

/** Returns why `action` is illegal, or null if it is legal. Safe to call with untrusted input. */
export function validateAction(state: GameState, action: Action): string | null {
  if (state.winner !== null) return 'The game is over.';
  const actor = activePlayer(state);
  switch (action?.type) {
    case 'pass':
      return null;
    case 'move':
      if (actor.frozen > 0) return 'You are frozen and cannot move this turn.';
      if (!isPos(action.to) || !canStep(state, actor.pos, action.to)) return 'You cannot move there.';
      return null;
    case 'cast': {
      const { spell, level, target } = action;
      if (!isSpellId(spell)) return 'Unknown spell.';
      if (!Number.isInteger(level) || level < 1 || level > state.config.maxSpellLevel) return 'Invalid spell level.';
      if (level > actor.mana) return 'Not enough mana.';
      if (SPELLS[spell].movesCaster && actor.frozen > 0) return 'You are frozen and cannot blink this turn.';
      if (!isPos(target) || !inBounds(state, target)) return 'That square is off the board.';
      const reach = distance(actor.pos, target);
      if (reach < 1 || reach > level) return 'That square is out of range at this level.';
      if (!matchesTarget(state, actor, spell, target)) return `${SPELLS[spell].name} cannot target that square.`;
      if (!hasLineOfSight(state, actor.pos, target)) return 'A wall blocks your line of sight.';
      return null;
    }
    default:
      return 'Unknown action.';
  }
}

export function applyAction(state: GameState, action: Action): GameState {
  const error = validateAction(state, action);
  if (error) throw new Error(error);
  return resolveAction(state, action);
}

/** Applies an action already known to be legal, skipping validation. Used by the AI search. */
export function resolveAction(state: GameState, action: Action): GameState {
  const draft = cloneState(state);
  const actor = draft.players[draft.current];
  switch (action.type) {
    case 'pass':
      emit(draft, { type: 'passed', player: actor.id });
      break;
    case 'move':
      movePlayer(draft, actor, action.to, 'step');
      break;
    case 'cast':
      actor.mana -= action.level;
      emit(draft, {
        type: 'cast',
        player: actor.id,
        spell: action.spell,
        level: action.level,
        from: { ...actor.pos },
        target: { ...action.target },
      });
      resolveSpell(draft, action.spell, actor, action.target);
      break;
  }

  if (!settleWinner(draft)) endTurn(draft);
  return draft;
}

function settleWinner(draft: GameState): boolean {
  const fallen = draft.players.find((p) => p.hp <= 0);
  if (!fallen) return false;
  draft.winner = otherPlayer(fallen.id);
  emit(draft, { type: 'won', player: draft.winner });
  return true;
}

/** Every legal action, including casts at a higher level than needed. */
export function legalActions(state: GameState): Action[] {
  if (state.winner !== null) return [];
  const actor = activePlayer(state);
  const topLevel = Math.min(actor.mana, state.config.maxSpellLevel);
  const actions: Action[] = [{ type: 'pass' }];
  for (const to of moveTargets(state)) actions.push({ type: 'move', to });
  for (const spell of SPELL_ORDER) {
    for (const option of castOptions(state, spell)) {
      for (let level = option.level; level <= topLevel; level++) {
        actions.push({ type: 'cast', spell, level, target: option.target });
      }
    }
  }
  return actions;
}

export function eventsSince(before: GameState, after: GameState): GameEvent[] {
  return after.log.slice(before.log.length);
}

/**
 * Copies everything an action can change. Config is never mutated so it is shared, and events
 * are never changed once emitted so the log only needs a shallow copy.
 */
export function cloneState(state: GameState): GameState {
  const [a, b] = state.players;
  return {
    ...state,
    tiles: state.tiles.slice(),
    players: [{ ...a, pos: { ...a.pos } }, { ...b, pos: { ...b.pos } }],
    log: state.log.slice(),
  };
}

/** Mana a wizard regains at the end of each of their turns. */
export function manaPerTurn(state: GameState, player: PlayerState): number {
  return state.config.manaRegen + (player.attuned ? state.config.attunementBonus : 0);
}

function endTurn(draft: GameState): void {
  const actor = draft.players[draft.current];
  actor.mana = Math.min(draft.config.maxMana, actor.mana + manaPerTurn(draft, actor));

  // A stunned wizard's skipped turn ends here too, so the storm does not spare them.
  if (inStorm(draft, actor.pos)) {
    actor.hp = Math.max(0, actor.hp - draft.config.stormDamage);
    emit(draft, { type: 'stormDamaged', player: actor.id, amount: draft.config.stormDamage, hp: actor.hp });
    if (settleWinner(draft)) return;
  }

  const ringsBefore = stormRings(draft);
  draft.current = otherPlayer(draft.current);
  draft.turn += 1;
  emit(draft, { type: 'turnStarted', player: draft.current, turn: draft.turn });
  const rings = stormRings(draft);
  if (rings > ringsBefore) emit(draft, { type: 'stormGrew', rings });

  const next = draft.players[draft.current];
  if (next.frozen > 0) {
    next.frozen -= 1;
    if (next.frozen === 0) emit(draft, { type: 'thawed', player: next.id });
  }
  if (next.stunned > 0) {
    next.stunned -= 1;
    emit(draft, { type: 'turnSkipped', player: next.id });
    endTurn(draft);
  }
}

function isPos(value: unknown): value is Pos {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return Number.isInteger(x) && Number.isInteger(y);
}
