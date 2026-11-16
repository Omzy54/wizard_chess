import {
  activePlayer,
  canStep,
  cloudsOver,
  DIRECTIONS,
  distance,
  getTile,
  hasLineOfSight,
  homeCorner,
  matchesTarget,
  moveTargets,
  otherPlayer,
  resolveAction,
  SPELLS,
  ringOf,
  roundsUntilStormGrows,
  stormRings,
  type Action,
  type GameState,
  type PlayerId,
  type PlayerState,
  type Pos,
  type SpellId,
} from '../engine/index.ts';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface AiProfile {
  label: string;
  title: string;
  blurb: string;
  /** Plies searched. 1 only looks at the position right after its own action. */
  maxDepth: number;
  /** Thinking budget per move. Deeper iterations stop when it runs out. */
  timeMs: number;
  /** Softmax temperature over action scores. 0 always plays the best action found. */
  temperature: number;
  /** Chance of skipping the search and playing a random candidate action. */
  blunder: number;
}

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export const AI_PROFILES: Record<Difficulty, AiProfile> = {
  easy: {
    label: 'Easy',
    title: 'Apprentice',
    blurb: 'Only thinks about its own move and makes plenty of mistakes.',
    maxDepth: 1,
    timeMs: 150,
    temperature: 40,
    blunder: 0.3,
  },
  medium: {
    label: 'Medium',
    title: 'Adept',
    blurb: 'Considers your reply, with the odd slip.',
    maxDepth: 2,
    timeMs: 400,
    temperature: 10,
    blunder: 0.05,
  },
  hard: {
    label: 'Hard',
    title: 'Sorcerer',
    blurb: 'Plans a few turns ahead and punishes mistakes.',
    maxDepth: 4,
    timeMs: 900,
    temperature: 0,
    blunder: 0,
  },
  expert: {
    label: 'Expert',
    title: 'Archmage',
    blurb: 'Thinks as deep as time allows. Expect to lose.',
    maxDepth: 10,
    timeMs: 2500,
    temperature: 0,
    blunder: 0,
  },
};

const WIN = 100_000;
const BLINK_CANDIDATES = 5;
const TIMEOUT = Symbol('timeout');

/**
 * Static score of a position for `me`. Positive is good for `me`. Roughly, 100 points is worth
 * one HP.
 */
export function evaluate(s: GameState, me: PlayerId): number {
  if (s.winner !== null) return s.winner === me ? WIN : -WIN;
  const my = s.players[me];
  const op = s.players[otherPlayer(me)];
  // Mana is range as well as spells, so it is worth more than its spell cost suggests.
  let score = (my.hp - op.hp) * 100 + (my.mana - op.mana) * 10;

  // Attunement is an extra mana every turn for the rest of the game. Until a wizard has it,
  // getting closer to the enemy corner is progress, and keeping the enemy away is defence.
  score += (Number(my.attuned) - Number(op.attuned)) * 120;
  if (!my.attuned) score -= distance(my.pos, homeCorner(s, op.id)) * 6;
  if (!op.attuned) score += distance(op.pos, homeCorner(s, me)) * 6;

  // Bolt threats, scaled by damage so a frozen target counts double. When both wizards can
  // hit each other, whoever shoots first stays ahead for the rest of the trade, so stepping
  // into mutual range on your own turn is a mistake. A one-sided threat is nearly a hit for
  // the side to move, and still worth something for the other side, who has to spend a turn
  // escaping.
  const myTurn = s.current === me;
  const myHit = boltDamage(s, my, op);
  const theirHit = boltDamage(s, op, my);
  if (myHit && theirHit) score += myTurn ? 60 * myHit : -60 * theirHit;
  else if (myHit) score += (myTurn ? 90 : 40) * myHit;
  else if (theirHit) score -= (myTurn ? 40 : 90) * theirHit;

  score += (op.stunned - my.stunned) * 55;
  score += (op.frozen - my.frozen) * 10;

  // A Gust that would land the other wizard within reach of a cloud or deep in the storm. It
  // counts for less when they get to move first.
  score += gustThreat(s, my, op) * (myTurn ? 1 : 0.4) - gustThreat(s, op, my) * (myTurn ? 0.4 : 1);

  score += stormRisk(s, op) - stormRisk(s, my);

  score += (mobility(s, my) - mobility(s, op)) * 4;

  // Close in when ahead and back off when behind. The pull towards the opponent grows as the
  // game goes on, so two careful wizards cannot hide behind walls forever.
  const lead = Math.max(-2, Math.min(2, my.hp - op.hp + (my.mana - op.mana) * 0.5));
  const urgency = Math.min(1, s.turn / 60);
  score -= distance(my.pos, op.pos) * (3 + lead * 3 + urgency * 6);
  return score;
}

/** Damage `attacker` could bolt `target` for on their next turn, or 0 if they cannot. */
function boltDamage(s: GameState, attacker: PlayerState, target: PlayerState): number {
  if (!canTarget(s, attacker, target)) return 0;
  return target.frozen > 0 ? s.config.frozenBoltDamage : s.config.boltDamage;
}

function canTarget(s: GameState, attacker: PlayerState, target: PlayerState): boolean {
  if (attacker.stunned > 0) return false;
  const gap = distance(attacker.pos, target.pos);
  return gap <= Math.min(attacker.mana, s.config.maxSpellLevel) && hasLineOfSight(s, attacker.pos, target.pos);
}

/** Where a Gust from `attacker` would leave `target`, following the same rules as the spell. */
function gustLanding(s: GameState, attacker: PlayerState, target: PlayerState): Pos {
  const dx = Math.sign(target.pos.x - attacker.pos.x);
  const dy = Math.sign(target.pos.y - attacker.pos.y);
  let to = target.pos;
  for (let i = 0; i < s.config.gustDistance; i++) {
    const next = { x: to.x + dx, y: to.y + dy };
    if (!canStep(s, to, next)) break;
    to = next;
    if (getTile(s, to) === 'cloud') break;
  }
  return to;
}

function gustThreat(s: GameState, attacker: PlayerState, target: PlayerState): number {
  if (!canTarget(s, attacker, target)) return 0;
  const to = gustLanding(s, attacker, target);
  if (to !== target.pos && cloudsOver(s, to).length > 0) return 45 * s.config.stunTurns;
  const depth = stormRings(s) - ringOf(s, to);
  if (depth >= 2 || (depth === 1 && rooted(s, target))) return 40;
  return 0;
}

/** Whether `p` will be unable to walk anywhere on their next turn. */
function rooted(s: GameState, p: PlayerState): boolean {
  // The ice loses a turn of its life at the start of the frozen wizard's own turn.
  return p.stunned > 0 || p.frozen > (s.current === p.id ? 0 : 1);
}

/**
 * How badly placed a wizard is against the storm. Standing in it costs HP at the end of their
 * next turn unless they get out first, which a pinned wizard cannot do.
 */
function stormRisk(s: GameState, p: PlayerState): number {
  const rings = stormRings(s);
  const ring = ringOf(s, p.pos);
  if (ring < rings) {
    const pinned = rooted(s, p) || ring + 1 < rings;
    return pinned ? 80 : 30;
  }
  const rounds = roundsUntilStormGrows(s);
  if (rounds !== null && ring === rings && rounds <= 2) return rounds <= 1 ? 20 : 10;
  return 0;
}

function mobility(s: GameState, p: PlayerState): number {
  if (p.frozen > 0) return 0;
  let free = 0;
  for (const d of DIRECTIONS) {
    const to = { x: p.pos.x + d.x, y: p.pos.y + d.y };
    if (canStep(s, p.pos, to) && cloudsOver(s, to).length === 0) free++;
  }
  return free;
}

/** Affordable targets for `spell`, scanning only the squares the actor's mana can reach. */
function castTargets(s: GameState, actor: PlayerState, spell: SpellId): Pos[] {
  if (SPELLS[spell].movesCaster && actor.frozen > 0) return [];
  const reach = Math.min(actor.mana, s.config.maxSpellLevel);
  const last = s.config.boardSize - 1;
  const targets: Pos[] = [];
  for (let y = Math.max(0, actor.pos.y - reach); y <= Math.min(last, actor.pos.y + reach); y++) {
    for (let x = Math.max(0, actor.pos.x - reach); x <= Math.min(last, actor.pos.x + reach); x++) {
      const t = { x, y };
      if (x === actor.pos.x && y === actor.pos.y) continue;
      if (matchesTarget(s, actor, spell, t) && hasLineOfSight(s, actor.pos, t)) targets.push(t);
    }
  }
  return targets;
}

/**
 * The actions worth searching, most promising first. Casts always use the cheapest level,
 * since a higher level only costs more. Walls, clouds and blinks are trimmed to the squares
 * that can plausibly matter, which keeps the search a few plies deep in well under a second.
 */
export function candidateActions(s: GameState): Action[] {
  if (s.winner !== null) return [];
  const actor = activePlayer(s);
  const foe = s.players[otherPlayer(actor.id)];
  const gap = distance(actor.pos, foe.pos);
  const actions: Action[] = [];
  const cast = (spell: SpellId, keep: (t: Pos) => boolean = () => true) => {
    for (const target of castTargets(s, actor, spell)) {
      if (keep(target)) actions.push({ type: 'cast', spell, level: distance(actor.pos, target), target });
    }
  };

  if (gap <= Math.min(actor.mana, s.config.maxSpellLevel) && hasLineOfSight(s, actor.pos, foe.pos)) {
    for (const spell of ['bolt', 'gust', 'frost', 'siphon'] as const) {
      if (spell === 'siphon' && foe.mana === 0) continue;
      actions.push({ type: 'cast', spell, level: gap, target: { ...foe.pos } });
    }
  }
  // Close enough to hem the foe in, or two squares off along a line a Gust could send them down.
  cast('thundercloud', (t) => {
    const dx = Math.abs(t.x - foe.pos.x);
    const dy = Math.abs(t.y - foe.pos.y);
    return Math.max(dx, dy) <= 1 || (Math.max(dx, dy) === 2 && (dx === 0 || dy === 0 || dx === dy));
  });
  for (const to of moveTargets(s)) actions.push({ type: 'move', to });
  cast(
    'wall',
    (t) =>
      distance(t, actor.pos) <= 1 ||
      distance(t, foe.pos) <= 1 ||
      distance(actor.pos, t) + distance(t, foe.pos) <= gap + 1,
  );
  cast('shatter');
  actions.push(...bestBlinks(s, actor));
  actions.push({ type: 'pass' });
  return actions;
}

function bestBlinks(s: GameState, actor: PlayerState): Action[] {
  return castTargets(s, actor, 'blink')
    .map((target) => {
      const action: Action = { type: 'cast', spell: 'blink', level: distance(actor.pos, target), target };
      return { action, score: evaluate(resolveAction(s, action), actor.id) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, BLINK_CANDIDATES)
    .map((c) => c.action);
}

interface SearchContext {
  me: PlayerId;
  deadline: number;
  nodes: number;
}

// Plain minimax rather than negamax, because a stun can give the same side two turns in a row.
function search(s: GameState, depth: number, ply: number, alpha: number, beta: number, ctx: SearchContext): number {
  if (s.winner !== null) return s.winner === ctx.me ? WIN - ply : -WIN + ply;
  if (depth === 0) return evaluate(s, ctx.me);
  if (++ctx.nodes % 128 === 0 && performance.now() > ctx.deadline) throw TIMEOUT;

  const maximizing = s.current === ctx.me;
  let best = maximizing ? -Infinity : Infinity;
  for (const action of candidateActions(s)) {
    const score = search(resolveAction(s, action), depth - 1, ply + 1, alpha, beta, ctx);
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (alpha >= beta) break;
  }
  return best;
}

interface Scored {
  action: Action;
  score: number;
}

export interface AiResult {
  action: Action;
  /** Deepest search that finished, in plies. */
  depth: number;
  nodes: number;
}

/** Picks an action for the side to move. Never mutates `state`. */
export function chooseAction(state: GameState, difficulty: Difficulty | AiProfile, rng: () => number = Math.random): AiResult {
  const profile = typeof difficulty === 'string' ? AI_PROFILES[difficulty] : difficulty;
  // The search never reads the log, so drop it to keep every copy small.
  const root: GameState = { ...state, log: [] };
  const me = root.current;
  const actions = candidateActions(root);
  if (actions.length === 0) throw new Error('No legal actions: the game is over.');
  if (actions.length === 1 || rng() < profile.blunder) {
    return { action: actions[Math.floor(rng() * actions.length)], depth: 0, nodes: 0 };
  }

  const ctx: SearchContext = { me, deadline: performance.now() + profile.timeMs, nodes: 0 };
  let scored: Scored[] = actions
    .map((action) => ({ action, score: evaluate(resolveAction(root, action), me) }))
    .sort((a, b) => b.score - a.score);
  let depth = 1;

  // Iterative deepening: each finished pass reorders the actions so the next pass prunes more.
  // Randomised levels need an exact score for every action, so they search without the
  // root window. The others search one point below the best so far: an action that fails
  // low then scores below the tie threshold in `pick` instead of looking like a tie.
  for (let d = 2; d <= profile.maxDepth && Math.abs(scored[0].score) < WIN - 100; d++) {
    try {
      let alpha = -Infinity;
      const next: Scored[] = [];
      for (const { action } of scored) {
        const window = profile.temperature > 0 ? -Infinity : alpha - 1;
        const score = search(resolveAction(root, action), d - 1, 1, window, Infinity, ctx);
        next.push({ action, score });
        alpha = Math.max(alpha, score);
      }
      scored = next.sort((a, b) => b.score - a.score);
      depth = d;
    } catch (err) {
      if (err !== TIMEOUT) throw err;
      break;
    }
  }

  return { action: pick(scored, profile.temperature, rng), depth, nodes: ctx.nodes };
}

function pick(scored: Scored[], temperature: number, rng: () => number): Action {
  const best = scored[0].score;
  if (temperature <= 0) {
    const ties = scored.filter((s) => s.score >= best - 0.5);
    return ties[Math.floor(rng() * ties.length)].action;
  }
  const weights = scored.map((s) => Math.exp((s.score - best) / temperature));
  let roll = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < scored.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return scored[i].action;
  }
  return scored[0].action;
}
