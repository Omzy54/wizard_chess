import type { GameState, PlayerId, PlayerState, Pos, Tile } from './types.ts';

export const DIRECTIONS: readonly Pos[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

export function samePos(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Steps needed when diagonal moves are allowed, so range N covers a (2N+1) square. */
export function distance(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function inBounds(state: GameState, p: Pos): boolean {
  const size = state.config.boardSize;
  return Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < size && p.y < size;
}

export function tileIndex(state: GameState, p: Pos): number {
  return p.y * state.config.boardSize + p.x;
}

export function getTile(state: GameState, p: Pos): Tile {
  return state.tiles[tileIndex(state, p)];
}

export function isWall(state: GameState, p: Pos): boolean {
  return inBounds(state, p) && getTile(state, p) === 'wall';
}

/** The Thunderclouds close enough to strike a wizard who lands on `p`. */
export function cloudsOver(state: GameState, p: Pos): Pos[] {
  const reach = state.config.cloudReach;
  const found: Pos[] = [];
  for (let y = p.y - reach; y <= p.y + reach; y++) {
    for (let x = p.x - reach; x <= p.x + reach; x++) {
      const near = { x, y };
      if (inBounds(state, near) && getTile(state, near) === 'cloud') found.push(near);
    }
  }
  return found;
}

export function playerAt(state: GameState, p: Pos): PlayerState | undefined {
  return state.players.find((pl) => samePos(pl.pos, p));
}

export function otherPlayer(id: PlayerId): PlayerId {
  return id === 0 ? 1 : 0;
}

/** Where a wizard starts: Azure bottom-left, Crimson top-right. The other wizard's goal. */
export function homeCorner(state: GameState, id: PlayerId): Pos {
  const last = state.config.boardSize - 1;
  return id === 0 ? { x: 0, y: last } : { x: last, y: 0 };
}

/** Azure and Crimson each take one turn per round. */
export function roundOf(turn: number): number {
  return Math.ceil(turn / 2);
}

/** How many squares in from the edge: 0 for the outer ring, 1 for the next one in. */
export function ringOf(state: GameState, p: Pos): number {
  const last = state.config.boardSize - 1;
  return Math.min(p.x, p.y, last - p.x, last - p.y);
}

/** Rings the storm has engulfed by `turn`, counted from the edge inwards. */
export function stormRings(state: GameState, turn: number = state.turn): number {
  const { stormStartRound, stormInterval, boardSize } = state.config;
  const round = roundOf(turn);
  if (stormStartRound <= 0 || round < stormStartRound) return 0;
  const grown = stormInterval > 0 ? Math.floor((round - stormStartRound) / stormInterval) : 0;
  return Math.min(Math.ceil(boardSize / 2), 1 + grown);
}

export function inStorm(state: GameState, p: Pos): boolean {
  return ringOf(state, p) < stormRings(state);
}

/** Rounds until the storm takes its next ring, or null if it is off or has taken everything. */
export function roundsUntilStormGrows(state: GameState): number | null {
  const { stormStartRound, stormInterval, boardSize } = state.config;
  if (stormStartRound <= 0) return null;
  const rings = stormRings(state);
  if (rings >= Math.ceil(boardSize / 2)) return null;
  if (rings > 0 && stormInterval <= 0) return null;
  return stormStartRound + rings * stormInterval - roundOf(state.turn);
}

export function allSquares(state: GameState): Pos[] {
  const size = state.config.boardSize;
  const out: Pos[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.push({ x, y });
  return out;
}

/** A diagonal step or sight line cannot slip between two walls that touch at a corner. */
export function isCornerSqueeze(state: GameState, from: Pos, to: Pos): boolean {
  if (Math.abs(to.x - from.x) !== 1 || Math.abs(to.y - from.y) !== 1) return false;
  return isWall(state, { x: to.x, y: from.y }) && isWall(state, { x: from.x, y: to.y });
}

/** Whether a wizard can be moved one square from `from` to `to`, by walking or being pushed. */
export function canStep(state: GameState, from: Pos, to: Pos): boolean {
  return (
    distance(from, to) === 1 &&
    inBounds(state, to) &&
    !isWall(state, to) &&
    !playerAt(state, to) &&
    !isCornerSqueeze(state, from, to)
  );
}

// Walls are shrunk by this much so a sight line grazing a wall's edge or corner is not blocked.
const GRAZE = 1e-6;
const EPS = 1e-9;

/**
 * Traces a segment between square centres. The end squares never block, so a wall can be
 * targeted directly.
 */
export function hasLineOfSight(state: GameState, from: Pos, to: Pos): boolean {
  const ax = from.x + 0.5;
  const ay = from.y + 0.5;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = { x, y };
      if (samePos(cell, from) || samePos(cell, to) || !isWall(state, cell)) continue;
      if (segmentCrossesCell(ax, ay, dx, dy, x, y)) return false;
    }
  }

  if (dx === 0 || dy === 0) return true;

  // Find every grid corner the line passes exactly through and apply the squeeze rule there.
  for (let k = minX + 1; k <= maxX; k++) {
    const y = ay + ((k - ax) / dx) * dy;
    const ky = Math.round(y);
    if (Math.abs(y - ky) > EPS) continue;
    const enter = { x: dx > 0 ? k - 1 : k, y: dy > 0 ? ky - 1 : ky };
    const exit = { x: dx > 0 ? k : k - 1, y: dy > 0 ? ky : ky - 1 };
    if (isCornerSqueeze(state, enter, exit)) return false;
  }
  return true;
}

// Liang-Barsky clip of the segment against the (slightly shrunk) cell square.
function segmentCrossesCell(ax: number, ay: number, dx: number, dy: number, cx: number, cy: number): boolean {
  const lo = GRAZE;
  const hi = 1 - GRAZE;
  const edges: [number, number][] = [
    [-dx, ax - (cx + lo)],
    [dx, cx + hi - ax],
    [-dy, ay - (cy + lo)],
    [dy, cy + hi - ay],
  ];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 >= t1) return false;
  }
  return true;
}
