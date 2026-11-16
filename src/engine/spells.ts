import { DIRECTIONS, distance, getTile, isWall, otherPlayer, playerAt, samePos } from './board.ts';
import { dealDamage, emit, movePlayer, pushPlayer, setTile } from './effects.ts';
import type { GameState, PlayerState, Pos, SpellId } from './types.ts';

/**
 * - opponent: the square the other wizard stands on
 * - empty: no wall, cloud or wizard
 * - wall: a wall
 * - open: no wall or wizard (a cloud is fine)
 */
export type TargetKind = 'opponent' | 'empty' | 'wall' | 'open';

export interface SpellDef {
  id: SpellId;
  name: string;
  summary: string;
  target: TargetKind;
  /** Moves the caster, so a frozen wizard cannot cast it. */
  movesCaster: boolean;
}

export const SPELL_ORDER: readonly SpellId[] = ['bolt', 'wall', 'shatter', 'thundercloud', 'blink', 'gust', 'frost', 'siphon'];

export const SPELLS: Record<SpellId, SpellDef> = {
  bolt: {
    id: 'bolt',
    name: 'Arcane Bolt',
    summary: 'Deal 1 damage to your opponent, or 2 if they are frozen (the ice shatters).',
    target: 'opponent',
    movesCaster: false,
  },
  wall: {
    id: 'wall',
    name: 'Raise Wall',
    summary: 'Create a wall on an empty square. Walls block movement and sight.',
    target: 'empty',
    movesCaster: false,
  },
  shatter: {
    id: 'shatter',
    name: 'Shatter',
    summary: 'Blow up a wall and every wall joined to it. Wizards next to the blast are thrown 2 squares away.',
    target: 'wall',
    movesCaster: false,
  },
  thundercloud: {
    id: 'thundercloud',
    name: 'Thundercloud',
    summary: 'Leave a cloud on an empty square. The next wizard to land on it or next to it is struck and loses their next turn.',
    target: 'empty',
    movesCaster: false,
  },
  blink: {
    id: 'blink',
    name: 'Blink',
    summary: 'Teleport to a square with no wall or wizard.',
    target: 'open',
    movesCaster: true,
  },
  gust: {
    id: 'gust',
    name: 'Gust',
    summary: 'Blow your opponent up to 2 squares directly away from you.',
    target: 'opponent',
    movesCaster: false,
  },
  frost: {
    id: 'frost',
    name: 'Freeze',
    summary: 'Freeze your opponent for their next 2 turns. They cannot Move or Blink, and your next Arcane Bolt hits them for 2.',
    target: 'opponent',
    movesCaster: false,
  },
  siphon: {
    id: 'siphon',
    name: 'Siphon',
    summary: 'Steal 2 mana from your opponent.',
    target: 'opponent',
    movesCaster: false,
  },
};

export function isSpellId(value: unknown): value is SpellId {
  return typeof value === 'string' && Object.hasOwn(SPELLS, value);
}

export function matchesTarget(state: GameState, caster: PlayerState, spell: SpellId, target: Pos): boolean {
  const occupant = playerAt(state, target);
  const tile = getTile(state, target);
  switch (SPELLS[spell].target) {
    case 'opponent':
      return occupant !== undefined && occupant.id !== caster.id;
    case 'empty':
      return tile === 'empty' && !occupant;
    case 'wall':
      return tile === 'wall';
    case 'open':
      return tile !== 'wall' && !occupant;
  }
}

const away = (from: Pos, to: Pos): Pos => ({ x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) });

/** `start` and every wall joined to it through walls that touch, corners included. */
export function connectedWalls(state: GameState, start: Pos): Pos[] {
  const found = [start];
  for (let i = 0; i < found.length; i++) {
    for (const d of DIRECTIONS) {
      const next = { x: found[i].x + d.x, y: found[i].y + d.y };
      if (isWall(state, next) && !found.some((p) => samePos(p, next))) found.push(next);
    }
  }
  return found;
}

/**
 * Which way a blast throws a wizard at `at`: away from the blown walls next to them, taken
 * together. Walls on opposite sides cancel out and the wizard stays put.
 */
function blastDirection(blown: Pos[], at: Pos): Pos | null {
  let x = 0;
  let y = 0;
  for (const wall of blown) {
    if (distance(wall, at) !== 1) continue;
    x += at.x - wall.x;
    y += at.y - wall.y;
  }
  return x === 0 && y === 0 ? null : { x: Math.sign(x), y: Math.sign(y) };
}

export function resolveSpell(draft: GameState, spell: SpellId, caster: PlayerState, target: Pos): void {
  const config = draft.config;
  const opponent = draft.players[otherPlayer(caster.id)];
  switch (spell) {
    case 'bolt': {
      const frozen = opponent.frozen > 0;
      opponent.frozen = 0;
      dealDamage(draft, opponent, frozen ? config.frozenBoltDamage : config.boltDamage, frozen);
      break;
    }
    case 'wall':
      setTile(draft, target, 'wall');
      emit(draft, { type: 'wallRaised', at: { ...target } });
      break;
    case 'shatter': {
      const blown = connectedWalls(draft, target);
      for (const wall of blown) {
        setTile(draft, wall, 'empty');
        emit(draft, { type: 'wallShattered', at: { ...wall } });
      }
      for (const wizard of draft.players) {
        const dir = blastDirection(blown, wizard.pos);
        if (dir) pushPlayer(draft, wizard, dir, config.blastDistance, 'blast');
      }
      break;
    }
    case 'thundercloud':
      setTile(draft, target, 'cloud');
      emit(draft, { type: 'cloudPlaced', at: { ...target } });
      break;
    case 'blink':
      movePlayer(draft, caster, target, 'blink');
      break;
    case 'gust':
      if (!pushPlayer(draft, opponent, away(caster.pos, opponent.pos), config.gustDistance, 'gust')) {
        emit(draft, { type: 'pushBlocked', player: opponent.id });
      }
      break;
    case 'frost':
      opponent.frozen = config.frostTurns;
      emit(draft, { type: 'frozen', player: opponent.id });
      break;
    case 'siphon': {
      const amount = Math.min(config.siphonAmount, opponent.mana);
      opponent.mana -= amount;
      caster.mana = Math.min(config.maxMana, caster.mana + amount);
      emit(draft, { type: 'siphoned', from: opponent.id, to: caster.id, amount });
      break;
    }
  }
}
