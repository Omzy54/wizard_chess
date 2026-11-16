import {
  activePlayer,
  canReach,
  castOptions,
  cloudsOver,
  distance,
  getTile,
  hasLineOfSight,
  homeCorner,
  inStorm,
  moveTargets,
  otherPlayer,
  ringOf,
  roundsUntilStormGrows,
  samePos,
  SPELL_ORDER,
  SPELLS,
  stormRings,
  type GameState,
  type Pos,
  type SpellId,
} from '../engine/index.ts';
import { squareName, who } from './format.ts';

/** The storm's next ring is only worth mentioning once it is this close. */
const STORM_NOTICE_ROUNDS = 3;

export interface SpellChoice {
  spell: SpellId;
  /** Mana to cast it on the square, which is the distance to it. */
  cost: number;
  affordable: boolean;
}

export function squaresText(n: number): string {
  return n === 1 ? '1 square' : `${n} squares`;
}

/** Every spell the wizard to move could aim at `pos`, whether or not they can pay for it. */
export function spellsAt(state: GameState, pos: Pos): SpellChoice[] {
  const choices: SpellChoice[] = [];
  for (const spell of SPELL_ORDER) {
    const option = castOptions(state, spell).find((o) => samePos(o.target, pos));
    if (option) choices.push({ spell, cost: option.level, affordable: option.affordable });
  }
  return choices;
}

/** Why the wizard to move cannot aim anything at `pos`. */
export function whyOutOfReach(state: GameState, pos: Pos): string {
  const actor = activePlayer(state);
  const foe = state.players[otherPlayer(actor.id)];
  const gap = distance(actor.pos, pos);
  const max = state.config.maxSpellLevel;
  const what = samePos(pos, foe.pos) ? who(foe.id) : `<b>${squareName(pos, state.config.boardSize)}</b>`;
  if (gap === 0) return `${who(actor.id)} cannot cast on their own square.`;
  if (gap > max) return `${what} is ${squaresText(gap)} away. Spells reach ${squaresText(max)} at most.`;
  if (!hasLineOfSight(state, actor.pos, pos)) return `A wall blocks the line of sight to ${what}.`;
  return `Nothing can be cast on ${what} right now.`;
}

/**
 * Why the wizard to move cannot cast `spell` anywhere this turn, or null if they can. Says what
 * is missing: range, sight, mana or a target.
 */
export function whyNoCast(state: GameState, spell: SpellId): string | null {
  const actor = activePlayer(state);
  const foe = state.players[otherPlayer(actor.id)];
  const def = SPELLS[spell];
  if (def.movesCaster && actor.frozen > 0) return `${who(actor.id)} is frozen and cannot cast ${def.name}.`;

  const options = castOptions(state, spell);
  if (options.some((o) => o.affordable)) return null;
  if (options.length > 0) {
    const nearest = Math.min(...options.map((o) => o.level));
    const target = def.target === 'opponent' ? who(foe.id) : 'The nearest target';
    return `${target} is ${squaresText(nearest)} away, so it costs ${nearest} mana. ${who(actor.id)} has ${actor.mana}.`;
  }

  if (def.target === 'opponent') return whyOutOfReach(state, foe.pos);
  const max = squaresText(state.config.maxSpellLevel);
  if (def.target === 'wall') {
    return state.tiles.includes('wall') ? `No wall within ${max} in clear sight.` : 'There are no walls to shatter yet.';
  }
  return `No free square within ${max} in clear sight.`;
}

/** What the square holds and what it means for the wizard to move, for the line under the board. */
export function describeSquare(state: GameState, pos: Pos): string {
  const actor = activePlayer(state);
  const foe = state.players[otherPlayer(actor.id)];
  const config = state.config;
  const tile = getTile(state, pos);
  const facts: string[] = [];

  if (samePos(pos, actor.pos)) {
    const reach = Math.min(actor.mana, config.maxSpellLevel);
    facts.push(
      reach > 0
        ? `${who(actor.id)} has ${actor.mana} mana, so their spells reach ${squaresText(reach)}.`
        : `${who(actor.id)} has no mana to cast with this turn.`,
    );
  } else if (samePos(pos, foe.pos)) {
    const choices = spellsAt(state, pos);
    const gap = squaresText(distance(actor.pos, pos));
    if (choices.some((c) => c.affordable)) facts.push(`${who(foe.id)} is ${gap} away. Click to cast on them.`);
    else if (choices.length > 0) facts.push(`${who(foe.id)} is ${gap} away, which costs ${choices[0].cost} mana. ${who(actor.id)} has ${actor.mana}.`);
    else facts.push(whyOutOfReach(state, pos));
  } else if (tile === 'wall') {
    facts.push('A wall. It blocks movement and line of sight.');
  } else if (tile === 'cloud') {
    facts.push('A Thundercloud. Whoever lands on it or next to it loses their next turn.');
  } else if (cloudsOver(state, pos).length > 0) {
    facts.push('In reach of a Thundercloud: landing here costs a turn.');
  }

  for (const id of [0, 1] as const) {
    if (!samePos(pos, homeCorner(state, id))) continue;
    const rival = state.players[otherPlayer(id)];
    facts.push(
      rival.attuned
        ? `${who(id)}'s home corner, already claimed by ${who(rival.id)}.`
        : `${who(id)}'s home corner. ${who(rival.id)} gains +${config.attunementBonus} mana a turn by reaching it.`,
    );
  }

  if (inStorm(state, pos)) {
    facts.push(`Storm: ending a turn here costs ${config.stormDamage} HP.`);
  } else {
    const rounds = roundsUntilStormGrows(state);
    if (rounds !== null && rounds <= STORM_NOTICE_ROUNDS && ringOf(state, pos) === stormRings(state)) {
      facts.push(`The storm takes this square ${rounds <= 1 ? 'next round' : `in ${rounds} rounds`}.`);
    }
  }

  if (!samePos(pos, foe.pos) && tile !== 'wall' && foe.stunned === 0 && canReach(state, foe, pos)) {
    facts.push(`${who(foe.id)} can bolt this square next turn.`);
  }

  const elsewhere = !samePos(pos, actor.pos) && !samePos(pos, foe.pos);
  if (elsewhere && !moveTargets(state).some((p) => samePos(p, pos))) {
    const choices = spellsAt(state, pos);
    const gap = distance(actor.pos, pos);
    const max = config.maxSpellLevel;
    if (choices.some((c) => c.affordable)) facts.push('Click to cast here.');
    else if (choices.length > 0) facts.push(`Casting here costs ${choices[0].cost} mana. ${who(actor.id)} has ${actor.mana}.`);
    else if (gap > max) facts.push(`${squaresText(gap)} away, out of reach. Spells reach ${squaresText(max)} at most.`);
    else if (!hasLineOfSight(state, actor.pos, pos)) facts.push('Out of sight behind a wall.');
  }

  const label = `<b>${squareName(pos, config.boardSize)}</b>`;
  return facts.length > 0 ? `${label}: ${facts.join(' ')}` : label;
}

/** What to do next, for the line under the board when nothing is hovered. */
export function suggestion(state: GameState): string {
  const actor = activePlayer(state);
  const foe = state.players[otherPlayer(actor.id)];
  const name = who(actor.id);
  const gap = distance(actor.pos, foe.pos);
  const max = state.config.maxSpellLevel;
  const walk = actor.frozen > 0 ? `${name} is frozen and cannot move.` : `${name}: move to a dot,`;
  const cast = actor.frozen > 0 ? 'Click a square to cast there, or pass.' : 'or click any square to cast there.';

  if (canReach(state, actor, foe.pos)) {
    return `${who(foe.id)} is in range. Click them to attack for ${gap} mana. ${actor.frozen > 0 ? '' : `Or move ${name} to a dot.`}`.trim();
  }
  if (gap <= max && hasLineOfSight(state, actor.pos, foe.pos)) {
    return `${walk} ${cast} ${who(foe.id)} is ${squaresText(gap)} away: reaching them costs ${gap} mana and ${name} has ${actor.mana}.`;
  }
  return `${walk} ${cast} A spell costs 1 mana per square of distance, up to ${max}.`;
}
