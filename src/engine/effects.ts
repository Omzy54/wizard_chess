import { canStep, cloudsOver, getTile, homeCorner, otherPlayer, samePos, tileIndex } from './board.ts';
import type { GameEvent, GameState, MoveVia, PlayerState, Pos, Tile } from './types.ts';

// Everything here mutates a draft state that `applyAction` has already cloned.

export function emit(draft: GameState, event: GameEvent): void {
  draft.log.push(event);
}

export function setTile(draft: GameState, p: Pos, tile: Tile): void {
  draft.tiles[tileIndex(draft, p)] = tile;
}

export function movePlayer(draft: GameState, player: PlayerState, to: Pos, via: MoveVia): void {
  const from = player.pos;
  player.pos = { ...to };
  emit(draft, { type: 'moved', player: player.id, from, to: { ...to }, via });

  if (!player.attuned && samePos(to, homeCorner(draft, otherPlayer(player.id)))) {
    player.attuned = true;
    emit(draft, { type: 'attuned', player: player.id, at: { ...to } });
  }

  const clouds = cloudsOver(draft, to);
  if (clouds.length > 0) {
    for (const cloud of clouds) setTile(draft, cloud, 'empty');
    player.stunned = Math.max(player.stunned, draft.config.stunTurns);
    emit(draft, { type: 'struck', player: player.id, at: { ...to }, clouds, turns: draft.config.stunTurns });
  }
}

/**
 * Shoves a wizard up to `squares` in direction `dir`. They stop early at anything that would
 * block a step, or as soon as they enter a cloud. Only the square they land on matters to
 * nearby clouds, not the ones they are thrown past. Returns whether they moved at all.
 */
export function pushPlayer(draft: GameState, player: PlayerState, dir: Pos, squares: number, via: MoveVia): boolean {
  let to = player.pos;
  for (let i = 0; i < squares; i++) {
    const next = { x: to.x + dir.x, y: to.y + dir.y };
    if (!canStep(draft, to, next)) break;
    to = next;
    if (getTile(draft, to) === 'cloud') break;
  }
  if (samePos(to, player.pos)) return false;
  movePlayer(draft, player, to, via);
  return true;
}

export function dealDamage(draft: GameState, player: PlayerState, amount: number, iceShattered = false): void {
  player.hp = Math.max(0, player.hp - amount);
  emit(draft, { type: 'damaged', player: player.id, amount, hp: player.hp, iceShattered });
}
