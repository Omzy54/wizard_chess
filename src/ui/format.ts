import { SPELLS, type GameEvent, type PlayerId, type Pos, type SpellId } from '../engine/index.ts';

export const PLAYER_NAMES: Record<PlayerId, string> = { 0: 'Azure', 1: 'Crimson' };

/** What each spell does in two or three words, for the spell bar. */
export const SPELL_TAGS: Record<SpellId, string> = {
  bolt: '1 damage',
  wall: 'Blocks sight',
  shatter: 'Breaks walls',
  thundercloud: 'Stun trap',
  blink: 'Teleport',
  gust: 'Push away',
  frost: 'Pin in place',
  siphon: 'Steal mana',
};

/** Chess-style name, so (0, 7) on an 8x8 board is a1. */
export function squareName(p: Pos, boardSize: number): string {
  return `${String.fromCharCode(97 + p.x)}${boardSize - p.y}`;
}

export function who(id: PlayerId): string {
  return `<b class="who" data-player="${id}">${PLAYER_NAMES[id]}</b>`;
}

export function turnsText(turns: number): string {
  return turns === 1 ? 'turn' : `${turns} turns`;
}

/** One line of the chronicle, or null for events the line before already covers. */
export function describeEvent(e: GameEvent, boardSize: number): string | null {
  const sq = (p: Pos) => squareName(p, boardSize);
  switch (e.type) {
    case 'turnStarted':
    case 'wallRaised':
    case 'wallShattered':
    case 'cloudPlaced':
      return null;
    case 'turnSkipped':
      return `${who(e.player)} is stunned and loses this turn.`;
    case 'passed':
      return `${who(e.player)} passes.`;
    case 'moved':
      if (e.via === 'blink') return `${who(e.player)} blinks to ${sq(e.to)}.`;
      if (e.via === 'gust') return `${who(e.player)} is blown back to ${sq(e.to)}.`;
      if (e.via === 'blast') return `The blast throws ${who(e.player)} to ${sq(e.to)}.`;
      return `${who(e.player)} moves to ${sq(e.to)}.`;
    case 'cast': {
      const spell = `<span class="spell-name" data-spell="${e.spell}">${SPELLS[e.spell].name}</span>`;
      const where = SPELLS[e.spell].target === 'opponent' ? `on ${who(e.player === 0 ? 1 : 0)}` : `at ${sq(e.target)}`;
      return `${who(e.player)} casts ${spell} ${where} <span class="lv">${e.level} mana</span>.`;
    }
    case 'damaged':
      return e.iceShattered
        ? `The ice shatters! ${who(e.player)} takes ${e.amount} damage (${e.hp} HP left).`
        : `${who(e.player)} takes ${e.amount} damage (${e.hp} HP left).`;
    case 'pushBlocked':
      return `${who(e.player)} holds firm, the way is blocked.`;
    case 'struck':
      return `Lightning strikes ${who(e.player)} at ${sq(e.at)}! They lose their next ${turnsText(e.turns)}.`;
    case 'frozen':
      return `${who(e.player)} is frozen solid.`;
    case 'thawed':
      return `${who(e.player)} thaws out.`;
    case 'attuned':
      return `${who(e.player)} reaches the enemy corner and is attuned: +1 mana every turn.`;
    case 'siphoned':
      return e.amount > 0
        ? `${who(e.to)} drains ${e.amount} mana from ${who(e.from)}.`
        : `${who(e.from)} has no mana to drain.`;
    case 'stormGrew':
      return 'The storm closes in.';
    case 'stormDamaged':
      return `The storm burns ${who(e.player)} for ${e.amount} damage (${e.hp} HP left).`;
    case 'won':
      return `${who(e.player)} wins the duel!`;
  }
}
