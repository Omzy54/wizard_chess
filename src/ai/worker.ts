import type { Action, GameState } from '../engine/index.ts';
import { chooseAction, type Difficulty } from './ai.ts';

export interface AiRequest {
  id: number;
  state: GameState;
  difficulty: Difficulty;
}

export interface AiResponse {
  id: number;
  action: Action;
}

self.addEventListener('message', (e: MessageEvent<AiRequest>) => {
  const { id, state, difficulty } = e.data;
  const { action } = chooseAction(state, difficulty);
  self.postMessage({ id, action } satisfies AiResponse);
});
