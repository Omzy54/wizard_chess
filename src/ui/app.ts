import {
  activePlayer,
  applyAction,
  canReach,
  castOptions,
  cloudsOver,
  createGame,
  eventsSince,
  getTile,
  homeCorner,
  inStorm,
  manaPerTurn,
  moveTargets,
  otherPlayer,
  ringOf,
  roundOf,
  roundsUntilStormGrows,
  samePos,
  SPELL_ORDER,
  stormRings,
  SPELLS,
  type Action,
  type CastOption,
  type GameEvent,
  type GameState,
  type PlayerId,
  type Pos,
  type SpellId,
} from '../engine/index.ts';
import { AI_PROFILES, chooseAction, DIFFICULTIES, type Difficulty } from '../ai/ai.ts';
import type { AiRequest, AiResponse } from '../ai/worker.ts';
import { describeSquare, spellsAt, squaresText, suggestion, whyNoCast, whyOutOfReach, type SpellChoice } from './explain.ts';
import { describeEvent, PLAYER_NAMES, SPELL_TAGS, squareName, turnsText, who } from './format.ts';
import { CLOUD_SVG, icon, WIZARD_SVG } from './icons.ts';
import { DEFAULT_SETUP, loadGame, loadPrefs, loadSetup, saveGame, savePrefs, saveSetup, type Setup } from './storage.ts';

type Mode = { kind: 'move' } | { kind: 'spell'; spell: SpellId };

/** What the action under the cursor would do, worked out by running it on a copy of the game. */
interface Peek {
  after: GameState;
  events: GameEvent[];
}

interface LastAction {
  player: PlayerId;
  squares: Pos[];
}

/** The list of things to do at one square, opened by clicking it. */
interface SquareMenu {
  pos: Pos;
  canMove: boolean;
  choices: SpellChoice[];
}

type MenuItem = SpellId | 'move';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Shortest time an AI turn takes, so the previous move's animation can finish. */
const AI_MIN_TURN_MS = 750;
/** The storm's next ring is outlined once it is this many rounds away. */
const STORM_WARNING_ROUNDS = 2;

/** Consequences of a hovered action worth spelling out before the player commits. */
const OUTCOME_EVENTS: ReadonlySet<GameEvent['type']> = new Set([
  'struck',
  'damaged',
  'stormDamaged',
  'pushBlocked',
  'siphoned',
  'attuned',
  'won',
]);

const SKELETON = `
  <header class="topbar">
    <div class="brand">${icon('star', 'brand-icon')}<h1>Wizard Chess</h1></div>
    <div class="turn" data-ref="turn"></div>
    <div class="top-actions">
      <button class="ghost" data-ref="undoBtn" title="Take back your last action (U)">Undo</button>
      <button class="ghost toggle" data-ref="threatBtn" title="Shade the squares your opponent could bolt next turn (T)">Threats</button>
      <button class="ghost" data-ref="rulesBtn">Rules</button>
      <button class="ghost" data-ref="newBtn">New game</button>
    </div>
  </header>
  <main class="arena">
    <aside class="card" data-player="0" data-ref="card0"></aside>
    <section class="board-area">
      <div class="board-frame">
        <div class="board" data-ref="board"></div>
        <svg class="fx" data-ref="fx" aria-hidden="true"></svg>
        <div class="tokens" data-ref="tokens"></div>
        <div class="toast" data-ref="toast" role="status"></div>
        <div class="storm-status" data-ref="storm"></div>
        <div class="square-menu" data-ref="menu" hidden></div>
      </div>
    </section>
    <aside class="card" data-player="1" data-ref="card1"></aside>
  </main>
  <section class="controls">
    <p class="recap" data-ref="recap"></p>
    <p class="hint" data-ref="hint"></p>
    <div class="spellbar" data-ref="spellbar"></div>
  </section>
  <section class="chronicle">
    <h2>Chronicle</h2>
    <ol data-ref="log"></ol>
  </section>
  <dialog class="rules" data-ref="rules"></dialog>
  <dialog class="setup" data-ref="setup"></dialog>
  <div class="overlay" data-ref="overlay" hidden></div>
`;

export class App {
  private root: HTMLElement;
  private game: GameState = createGame();
  private setup: Setup;
  private mode: Mode = { kind: 'move' };
  private hover: Pos | null = null;
  private passArmed = false;
  private toastTimer = 0;
  private tiles: HTMLElement[] = [];
  private tokens: HTMLElement[] = [];
  /** Faint copies of the wizards, shown where a hovered Gust or Shatter would throw them. */
  private ghosts: HTMLElement[] = [];
  private peek: Peek | null = null;
  private last: LastAction | null = null;
  private menu: SquareMenu | null = null;
  private menuHover: MenuItem | null = null;
  /** Answer to a click that could not do anything, shown until the cursor moves on. */
  private note: string | null = null;
  /** Earlier states of this game, oldest first, for Undo. */
  private past: GameState[] = [];
  private prefs = loadPrefs();
  private refs: Record<string, HTMLElement> = {};
  private aiThinking = false;
  /** Bumped on every new AI turn or game, so late answers are ignored. */
  private aiTurnId = 0;
  private worker: Worker | null = null;
  private workerFailed = false;
  private pending = new Map<number, (action: Action) => void>();

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = SKELETON;
    for (const el of root.querySelectorAll<HTMLElement>('[data-ref]')) this.refs[el.dataset.ref!] = el;
    const saved = loadSetup();
    this.setup = saved ?? DEFAULT_SETUP;
    root.classList.toggle('first-visit', !saved);
    const unfinished = saved ? loadGame() : null;
    if (unfinished) this.game = unfinished;
    this.buildBoard();
    this.buildSpellbar();
    this.buildRules();
    this.buildSetup();
    this.bindEvents();
    this.renderAll();
    if (saved) this.maybeRunAi();
    else this.openSetup();
  }

  private get aiSide(): PlayerId | null {
    return this.setup.opponent === 'human' ? null : otherPlayer(this.setup.humanSide);
  }

  private get aiProfile() {
    return this.setup.opponent === 'human' ? null : AI_PROFILES[this.setup.opponent];
  }

  /** True while the side to act is not a human at this screen. */
  private get locked(): boolean {
    return this.game.winner !== null || (this.aiSide !== null && this.game.current === this.aiSide);
  }

  private get size(): number {
    return this.game.config.boardSize;
  }

  private buildBoard(): void {
    const { board, tokens, fx } = this.refs;
    const n = this.size;
    board.style.setProperty('--n', String(n));
    tokens.style.setProperty('--n', String(n));
    fx.setAttribute('viewBox', `0 0 ${n} ${n}`);
    board.innerHTML = '';
    tokens.innerHTML = '';
    this.tiles = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const tile = document.createElement('div');
        tile.className = `tile ${(x + y) % 2 ? 'dark' : 'light'}`;
        tile.dataset.x = String(x);
        tile.dataset.y = String(y);
        tile.innerHTML = '<div class="tile-content"></div><div class="marker"></div>';
        if (x === 0) tile.insertAdjacentHTML('beforeend', `<span class="coord rank">${n - y}</span>`);
        if (y === n - 1) tile.insertAdjacentHTML('beforeend', `<span class="coord file">${String.fromCharCode(97 + x)}</span>`);
        board.append(tile);
        this.tiles.push(tile);
      }
    }
    for (const id of [0, 1] as const) {
      const corner = homeCorner(this.game, id);
      const tile = this.tiles[corner.y * n + corner.x];
      tile.classList.add('home');
      tile.insertAdjacentHTML('afterbegin', `<div class="rune" data-player="${id}">${icon('star', 'rune-star')}</div>`);
      tile.title = `${PLAYER_NAMES[id]}'s home. ${PLAYER_NAMES[otherPlayer(id)]} gains +1 mana a turn by reaching it.`;
    }
    this.tokens = ([0, 1] as const).map((id) => {
      const token = document.createElement('div');
      token.className = 'token';
      token.dataset.player = String(id);
      token.innerHTML = `${WIZARD_SVG}<span class="token-badge">${icon('zap')}</span>`;
      token.addEventListener('animationend', () => token.classList.remove('teleport', 'hit'));
      tokens.append(token);
      return token;
    });
    this.ghosts = ([0, 1] as const).map((id) => {
      const ghost = document.createElement('div');
      ghost.className = 'ghost-token';
      ghost.dataset.player = String(id);
      ghost.hidden = true;
      ghost.innerHTML = WIZARD_SVG;
      tokens.append(ghost);
      return ghost;
    });
  }

  private buildSpellbar(): void {
    const button = (attrs: string, key: string, glyph: string, name: string, meta: string) =>
      `<button class="action" ${attrs}><span class="key">${key}</span>${glyph}<span class="name">${name}</span><span class="meta">${meta}</span></button>`;
    this.refs.spellbar.innerHTML = [
      button('data-action="move"', 'M', icon('move'), 'Move', '1 square'),
      ...SPELL_ORDER.map((id, i) =>
        button(`data-action="spell" data-spell="${id}"`, String(i + 1), icon(id), SPELLS[id].name, SPELL_TAGS[id]),
      ),
      button('data-action="pass"', 'P', icon('pass'), 'Pass', 'End turn'),
    ].join('');
  }

  private buildRules(): void {
    const c = this.game.config;
    this.refs.rules.innerHTML = `
      <form method="dialog" class="rules-inner">
        <header><h2>How to play</h2><button class="ghost" value="close">Close</button></header>
        <ul class="rules-list">
          <li>${who(0)} and ${who(1)} start in opposite corners with ${c.maxHp} HP each. Bring the other wizard to 0 HP to win.</li>
          <li>On your turn, either <b>move</b> one square in any direction or <b>cast</b> one spell.</li>
          <li>You start with ${c.startingMana} mana and regain ${c.manaRegen} at the end of each of your turns, up to ${c.maxMana}.</li>
          <li><b>Spells cost distance:</b> casting on a square costs 1 mana for every square between you and it, diagonals included, up to ${c.maxSpellLevel} squares away. The same spell is cheap up close and expensive at range, so your mana is also your reach.</li>
          <li><b>Ley corners:</b> reach the enemy's starting corner (the glowing rune) to become <b>attuned</b> and regain ${c.attunementBonus} extra mana every turn for the rest of the game.</li>
          <li>Every spell needs a clear line of sight. Walls block movement and sight, and nobody can slip diagonally between two walls that touch at a corner.</li>
          ${
            c.stormStartRound > 0
              ? `<li><b>The storm:</b> on round ${c.stormStartRound} an arcane storm engulfs the outer ring of the board, and every ${c.stormInterval} rounds it closes in by another ring until nothing is left. A wizard who ends their turn inside it takes ${c.stormDamage} damage, so do not get frozen, stunned or walled in out there.</li>`
              : ''
          }
        </ul>
        <h3>Spells</h3>
        <div class="rules-spells">
          ${SPELL_ORDER.map(
            (id, i) => `
            <div class="rules-spell" data-spell="${id}">
              ${icon(id)}
              <div><b>${i + 1}. ${SPELLS[id].name}</b> <span class="tag">${SPELL_TAGS[id]}</span><p>${SPELLS[id].summary}</p></div>
            </div>`,
          ).join('')}
        </div>
        <h3>Controls</h3>
        <p class="controls-help">Click a dot to move. Click the other wizard, a wall or any other square to see the spells you can cast there and what each costs. Right-click a square next to you for the same list.</p>
        <p class="controls-help">Hover anything to see what it is, and hover an action before you click: the line under the board says what it will do.</p>
        <p class="controls-help"><kbd>1</kbd>-<kbd>8</kbd> pick a spell first instead, <kbd>M</kbd> move, <kbd>P</kbd> twice to pass, <kbd>Esc</kbd> to cancel, <kbd>U</kbd> undo, <kbd>T</kbd> show or hide the squares your opponent threatens.</p>
      </form>`;
  }

  private buildSetup(): void {
    const choice = (name: string, value: string, title: string, blurb: string) =>
      `<label class="choice"><input type="radio" name="${name}" value="${value}" /><span><b>${title}</b><small>${blurb}</small></span></label>`;
    this.refs.setup.innerHTML = `
      <form method="dialog" class="setup-inner">
        <h2>New duel</h2>
        <ul class="intro">
          <li>Bring the other wizard from ${this.game.config.maxHp} HP to 0.</li>
          <li>Each turn, move one square <b>or</b> cast one spell.</li>
          <li>A spell costs 1 mana per square of distance, up to ${this.game.config.maxSpellLevel}. You regain ${this.game.config.manaRegen} mana a turn.</li>
          <li>Click any square to see what you can cast there. Hover anything to see what it is.</li>
        </ul>
        <fieldset>
          <legend>Opponent</legend>
          <div class="choices">
            ${choice('opponent', 'human', 'Local player', 'Two players take turns on this screen.')}
            ${DIFFICULTIES.map((d) => {
              const p = AI_PROFILES[d];
              return choice('opponent', d, `${p.label} AI <span class="ai-title">${p.title}</span>`, p.blurb);
            }).join('')}
          </div>
        </fieldset>
        <fieldset class="side-field">
          <legend>Play as</legend>
          <div class="choices two">
            ${choice('side', '0', '<span class="who" data-player="0">Azure</span>', 'Moves first.')}
            ${choice('side', '1', '<span class="who" data-player="1">Crimson</span>', 'Moves second.')}
          </div>
        </fieldset>
        <div class="setup-actions">
          <button class="ghost" value="cancel">Cancel</button>
          <button class="primary" value="start">Start duel</button>
        </div>
      </form>`;
  }

  private get setupForm(): HTMLFormElement {
    return this.refs.setup.querySelector('form')!;
  }

  private radio(name: string): RadioNodeList {
    return this.setupForm.elements.namedItem(name) as RadioNodeList;
  }

  private openSetup(): void {
    const dialog = this.refs.setup as HTMLDialogElement;
    this.radio('opponent').value = this.setup.opponent;
    this.radio('side').value = String(this.setup.humanSide);
    this.syncSetupForm();
    dialog.showModal();
  }

  // Picking a side only means something against the AI.
  private syncSetupForm(): void {
    const vsHuman = this.radio('opponent').value === 'human';
    const field = this.setupForm.querySelector<HTMLFieldSetElement>('.side-field')!;
    field.disabled = vsHuman;
  }

  private bindEvents(): void {
    const { board, spellbar, rules, rulesBtn, newBtn, undoBtn, threatBtn, overlay, setup, menu } = this.refs;

    board.addEventListener('click', (e) => {
      const pos = this.tileFromEvent(e);
      if (pos) this.clickSquare(pos);
    });
    board.addEventListener('mousemove', (e) => {
      const pos = this.tileFromEvent(e);
      if (pos && this.hover && samePos(pos, this.hover)) return;
      this.hover = pos;
      this.note = null;
      this.renderInteractive();
    });
    board.addEventListener('mouseleave', () => {
      this.hover = null;
      this.renderInteractive();
    });
    board.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const pos = this.tileFromEvent(e);
      // Right-click cancels whatever is in progress, otherwise it asks what can be done here.
      if (this.mode.kind === 'spell' || this.menu || !pos || this.locked) this.setMode({ kind: 'move' });
      else this.openMenu(pos);
    });

    menu.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-item]')?.dataset.item as MenuItem | undefined;
      if (item) this.chooseFromMenu(item);
    });
    menu.addEventListener('mouseover', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-item]')?.dataset.item as MenuItem | undefined;
      if (item === this.menuHover) return;
      this.menuHover = item ?? null;
      this.renderInteractive();
    });
    menu.addEventListener('mouseleave', () => {
      if (this.menuHover === null) return;
      this.menuHover = null;
      this.renderInteractive();
    });

    spellbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'move') this.setMode({ kind: 'move' });
      else if (action === 'pass') this.pressPass();
      else if (action === 'spell') this.toggleSpell(btn.dataset.spell as SpellId);
    });
    spellbar.addEventListener('mouseover', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-spell]');
      this.renderHint(btn ? (btn.dataset.spell as SpellId) : undefined);
    });
    spellbar.addEventListener('mouseleave', () => this.renderHint());

    rulesBtn.addEventListener('click', () => (rules as HTMLDialogElement).showModal());
    newBtn.addEventListener('click', () => this.openSetup());
    undoBtn.addEventListener('click', () => this.undo());
    threatBtn.addEventListener('click', () => this.toggleThreats());
    for (const dialog of [rules, setup] as HTMLDialogElement[]) {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
    }
    setup.addEventListener('change', () => this.syncSetupForm());
    setup.addEventListener('submit', (e) => {
      if ((e.submitter as HTMLButtonElement | null)?.value !== 'start') return;
      const opponent = this.radio('opponent').value as Setup['opponent'];
      this.setup = { opponent, humanSide: this.radio('side').value === '1' ? 1 : 0 };
      saveSetup(this.setup);
      this.newGame();
    });
    overlay.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-overlay]')?.dataset.overlay;
      if (action === 'again') this.newGame();
      else if (action === 'setup') this.openSetup();
      else if (action === 'view') overlay.hidden = true;
    });

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      const key = e.key.toLowerCase();
      const index = Number(key) - 1;
      if (index >= 0 && index < SPELL_ORDER.length) this.toggleSpell(SPELL_ORDER[index]);
      else if (key === 'm' || key === 'escape') this.setMode({ kind: 'move' });
      else if (key === 'p') this.pressPass();
      else if (key === 'u') this.undo();
      else if (key === 't') this.toggleThreats();
      else return;
      e.preventDefault();
    });
  }

  private tileFromEvent(e: Event): Pos | null {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile');
    if (!tile) return null;
    return { x: Number(tile.dataset.x), y: Number(tile.dataset.y) };
  }

  private newGame(): void {
    this.past = [];
    this.showGame(createGame(this.game.config));
    this.maybeRunAi();
  }

  /** Index in `past` that Undo returns to: the last point a human at this screen chose an action. */
  private undoTarget(): number {
    for (let i = this.past.length - 1; i >= 0; i--) {
      if (this.aiSide === null || this.past[i].current !== this.aiSide) return i;
    }
    return -1;
  }

  private undo(): void {
    const target = this.undoTarget();
    if (target < 0) return;
    const state = this.past[target];
    this.past.length = target;
    this.showGame(state);
  }

  /** Swaps in a different game state, dropping whatever was in flight for the old one. */
  private showGame(state: GameState): void {
    if (this.aiThinking) {
      // Abandon the search in progress rather than wait for it.
      this.worker?.terminate();
      this.worker = null;
      this.pending.clear();
    }
    this.aiTurnId++;
    this.aiThinking = false;
    this.game = state;
    saveGame(state);
    this.mode = { kind: 'move' };
    this.passArmed = false;
    this.closeMenu();
    this.refs.overlay.hidden = true;
    this.refs.fx.innerHTML = '';
    this.renderAll();
  }

  private toggleThreats(): void {
    this.prefs = { ...this.prefs, showThreats: !this.prefs.showThreats };
    savePrefs(this.prefs);
    this.renderInteractive();
  }

  private maybeRunAi(): void {
    const difficulty = this.setup.opponent;
    if (difficulty === 'human' || this.game.winner !== null || this.game.current !== this.aiSide) return;
    const turnId = ++this.aiTurnId;
    const state = this.game;
    const started = performance.now();
    this.aiThinking = true;
    this.renderInteractive();
    void this.requestAiMove(state, difficulty, turnId).then((action) => {
      const wait = Math.max(0, AI_MIN_TURN_MS - (performance.now() - started));
      window.setTimeout(() => {
        if (turnId !== this.aiTurnId || this.game !== state) return;
        this.aiThinking = false;
        this.act(action);
      }, wait);
    });
  }

  private requestAiMove(state: GameState, difficulty: Difficulty, id: number): Promise<Action> {
    const slim: GameState = { ...state, log: [] };
    const worker = this.getWorker();
    if (!worker) {
      // Wait a frame so the "thinking" state paints before the main thread is busy.
      return new Promise((resolve) => window.setTimeout(() => resolve(chooseAction(slim, difficulty).action), 30));
    }
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage({ id, state: slim, difficulty } satisfies AiRequest);
    });
  }

  private getWorker(): Worker | null {
    if (this.workerFailed) return null;
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (e: MessageEvent<AiResponse>) => {
        this.pending.get(e.data.id)?.(e.data.action);
        this.pending.delete(e.data.id);
      });
      worker.addEventListener('error', () => {
        // Workers can be blocked (for example when opened from file://). Think on the main thread instead.
        worker.terminate();
        this.worker = null;
        this.workerFailed = true;
        this.pending.clear();
        if (this.aiThinking) {
          this.aiThinking = false;
          this.maybeRunAi();
        }
      });
      this.worker = worker;
      return worker;
    } catch {
      this.workerFailed = true;
      return null;
    }
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.passArmed = false;
    this.closeMenu();
    this.renderInteractive();
  }

  private closeMenu(): void {
    this.menu = null;
    this.menuHover = null;
    this.note = null;
  }

  /** Lists what the wizard to move can do at `pos`, or says why nothing can be done there. */
  private openMenu(pos: Pos): void {
    const actor = activePlayer(this.game);
    this.closeMenu();
    this.passArmed = false;
    const canMove = moveTargets(this.game).some((p) => samePos(p, pos));
    const choices = spellsAt(this.game, pos);
    if (canMove || choices.length > 0) this.menu = { pos, canMove, choices };
    else if (!samePos(pos, actor.pos)) this.note = whyOutOfReach(this.game, pos);
    this.renderInteractive();
  }

  private menuAction(item: MenuItem): Action | null {
    if (!this.menu) return null;
    if (item === 'move') return this.menu.canMove ? { type: 'move', to: this.menu.pos } : null;
    const choice = this.menu.choices.find((c) => c.spell === item);
    return choice?.affordable ? { type: 'cast', spell: item, level: choice.cost, target: this.menu.pos } : null;
  }

  private chooseFromMenu(item: MenuItem): void {
    const action = this.locked ? null : this.menuAction(item);
    if (action) this.act(action);
  }

  private toggleSpell(spell: SpellId): void {
    if (this.locked) return;
    const same = this.mode.kind === 'spell' && this.mode.spell === spell;
    this.setMode(same ? { kind: 'move' } : { kind: 'spell', spell });
  }

  private pressPass(): void {
    if (this.locked) return;
    if (this.passArmed) {
      this.act({ type: 'pass' });
      return;
    }
    this.passArmed = true;
    this.renderInteractive();
  }

  private clickSquare(pos: Pos): void {
    if (this.locked) return;
    const actor = activePlayer(this.game);
    if (this.mode.kind === 'move') {
      const reopened = this.menu !== null && samePos(this.menu.pos, pos);
      if (reopened) this.setMode({ kind: 'move' });
      else if (moveTargets(this.game).some((p) => samePos(p, pos))) this.act({ type: 'move', to: pos });
      else this.openMenu(pos);
      return;
    }
    if (samePos(pos, actor.pos)) {
      this.setMode({ kind: 'move' });
      return;
    }
    const option = this.optionAt(pos);
    if (option?.affordable) this.act({ type: 'cast', spell: this.mode.spell, level: option.level, target: pos });
  }

  private optionAt(pos: Pos): CastOption | undefined {
    if (this.mode.kind !== 'spell') return undefined;
    return castOptions(this.game, this.mode.spell).find((o) => samePos(o.target, pos));
  }

  private act(action: Action): void {
    const before = this.game;
    try {
      this.game = applyAction(before, action);
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err));
      return;
    }
    this.past.push(before);
    saveGame(this.game.winner === null ? this.game : null);
    this.mode = { kind: 'move' };
    this.passArmed = false;
    this.closeMenu();
    const events = eventsSince(before, this.game);
    for (const e of events) {
      if (e.type === 'moved' && e.via === 'blink') this.tokens[e.player].classList.add('teleport');
    }
    this.renderAll();
    this.playEvents(events);
    if (this.game.winner !== null) window.setTimeout(() => this.showWinner(), 900);
    else this.maybeRunAi();
  }

  private renderAll(): void {
    this.last = this.lastAction();
    this.renderTurn();
    this.renderTokens();
    this.renderInteractive();
    this.renderRecap();
    this.renderLog();
  }

  /** Everything that changes with the mode or the hovered square. */
  private renderInteractive(): void {
    this.root.dataset.spell = this.mode.kind === 'spell' ? this.mode.spell : '';
    this.peek = this.peekHover();
    this.renderTopButtons();
    this.renderBoard();
    this.renderMenu();
    this.renderCard(0);
    this.renderCard(1);
    this.renderSpellbar();
    this.renderHint();
  }

  /** The action a click on the hovered square would take right now, if any. */
  private hoverAction(): Action | null {
    if (this.locked) return null;
    if (this.menu) return this.menuHover ? this.menuAction(this.menuHover) : null;
    if (!this.hover) return null;
    const pos = this.hover;
    if (this.mode.kind === 'move') {
      return moveTargets(this.game).some((p) => samePos(p, pos)) ? { type: 'move', to: pos } : null;
    }
    const option = this.optionAt(pos);
    return option?.affordable ? { type: 'cast', spell: this.mode.spell, level: option.level, target: pos } : null;
  }

  private peekHover(): Peek | null {
    const action = this.hoverAction();
    if (!action) return null;
    const after = applyAction(this.game, action);
    return { after, events: eventsSince(this.game, after) };
  }

  /** Where in the log the latest action starts, or -1 before the first one. */
  private lastActionStart(): number {
    const log = this.game.log;
    const isAction = (e: GameEvent) => e.type === 'cast' || e.type === 'passed' || (e.type === 'moved' && e.via === 'step');
    let start = log.length - 1;
    while (start >= 0 && !isAction(log[start])) start--;
    return start;
  }

  /** The squares the latest action touched, read back from the log so it survives undo and reload. */
  private lastAction(): LastAction | null {
    const log = this.game.log;
    const start = this.lastActionStart();
    if (start < 0) return null;
    const squares: Pos[] = [];
    for (let i = start; i < log.length && log[i].type !== 'turnStarted'; i++) {
      const e = log[i];
      if (e.type === 'moved') squares.push(e.from, e.to);
      else if (e.type === 'cast') squares.push(e.target);
    }
    return { player: (log[start] as { player: PlayerId }).player, squares };
  }

  /** One line by the board on what just happened, so nobody has to dig through the chronicle. */
  private renderRecap(): void {
    const log = this.game.log;
    const start = this.lastActionStart();
    const lines: string[] = [];
    for (let i = Math.max(0, start); start >= 0 && i < log.length; i++) {
      const line = describeEvent(log[i], this.size);
      if (line) lines.push(line);
    }
    this.refs.recap.innerHTML = lines.length ? `<span class="recap-label">Last turn</span> ${lines.join(' ')}` : '';
  }

  private renderMenu(): void {
    const el = this.refs.menu;
    const menu = this.locked ? null : this.menu;
    el.hidden = menu === null;
    if (!menu) {
      el.dataset.key = '';
      return;
    }
    // Rebuilding the buttons under the cursor would fire a fresh hover each time, so the list
    // is only rebuilt when it is for a different square or state.
    const key = `${this.game.log.length}:${menu.pos.x},${menu.pos.y}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      const actor = activePlayer(this.game);
      const row = (item: MenuItem, glyph: string, name: string, cost: string, affordable: boolean, title: string) =>
        `<button class="menu-item" data-item="${item}" ${item === 'move' ? '' : `data-spell="${item}"`} title="${title}" ${affordable ? '' : 'disabled'}>${glyph}<span class="menu-name">${name}</span><span class="menu-cost">${cost}</span></button>`;
      const rows = menu.choices.map((c) =>
        row(
          c.spell,
          icon(c.spell),
          SPELLS[c.spell].name,
          `${c.cost} mana`,
          c.affordable,
          c.affordable ? SPELLS[c.spell].summary : `Costs ${c.cost} mana. ${PLAYER_NAMES[actor.id]} has ${actor.mana}.`,
        ),
      );
      if (menu.canMove) rows.unshift(row('move', icon('move'), 'Move here', 'Free', true, 'Step onto this square.'));
      el.innerHTML = `<div class="menu-title">${this.targetName(menu.pos)}</div>${rows.join('')}`;
      const n = this.size;
      // Open on the side away from the caster where there is room, so the list does not cover them.
      let right = menu.pos.x < n / 2;
      if (actor.pos.x < menu.pos.x && n - 1 - menu.pos.x >= 3) right = true;
      if (actor.pos.x > menu.pos.x && menu.pos.x >= 3) right = false;
      const down = menu.pos.y < n / 2;
      const place = (toRight: boolean) => {
        el.style.left = toRight ? `${((menu.pos.x + 1) / n) * 100}%` : 'auto';
        el.style.right = toRight ? 'auto' : `${((n - menu.pos.x) / n) * 100}%`;
      };
      const fits = () => {
        const box = el.getBoundingClientRect();
        return box.left >= 0 && box.right <= document.documentElement.clientWidth;
      };
      el.style.transform = '';
      el.style.top = down ? `${(menu.pos.y / n) * 100}%` : 'auto';
      el.style.bottom = down ? 'auto' : `${((n - 1 - menu.pos.y) / n) * 100}%`;
      place(right);
      if (!fits()) place(!right);
      if (!fits()) {
        // A phone has no room beside the square, so the list goes below or above it instead.
        el.style.left = '50%';
        el.style.right = 'auto';
        el.style.transform = 'translateX(-50%)';
        el.style.top = down ? `${((menu.pos.y + 1) / n) * 100}%` : 'auto';
        el.style.bottom = down ? 'auto' : `${((n - menu.pos.y) / n) * 100}%`;
      }
    }
    for (const btn of el.querySelectorAll<HTMLButtonElement>('button[data-item]')) {
      btn.classList.toggle('hovered', btn.dataset.item === this.menuHover);
    }
  }

  /** The other wizard by name, any other square by its coordinates. */
  private targetName(pos: Pos): string {
    const foe = this.game.players[otherPlayer(this.game.current)];
    return samePos(pos, foe.pos) ? who(foe.id) : `<b>${squareName(pos, this.size)}</b>`;
  }

  private renderTopButtons(): void {
    const { undoBtn, threatBtn } = this.refs;
    (undoBtn as HTMLButtonElement).disabled = this.undoTarget() < 0;
    threatBtn.classList.toggle('on', this.prefs.showThreats);
    threatBtn.setAttribute('aria-pressed', String(this.prefs.showThreats));
  }

  private renderTurn(): void {
    const g = this.game;
    const round = roundOf(g.turn);
    const vs = this.aiProfile ? `<span class="vs">vs ${this.aiProfile.label} AI</span>` : '';
    this.refs.turn.innerHTML =
      g.winner !== null
        ? `${who(g.winner)} wins on round ${round}${vs}`
        : `<span class="round">Round ${round}</span> ${who(g.current)} to act${vs}`;
    this.renderStormStatus();
  }

  /** The plaque on the board's top edge counting down to the storm's next advance. */
  private renderStormStatus(): void {
    const g = this.game;
    const el = this.refs.storm;
    el.hidden = g.config.stormStartRound <= 0 || g.winner !== null;
    if (el.hidden) return;
    const rings = stormRings(g);
    const rounds = roundsUntilStormGrows(g);
    let text = 'The storm is everywhere';
    if (rounds !== null) {
      const when = rounds === 1 ? 'next round' : `in ${rounds} rounds`;
      text = rings === 0 ? `Storm ${when}` : `Storm advances ${when}`;
    }
    const soon = rounds !== null && rounds <= STORM_WARNING_ROUNDS;
    el.title = `A wizard who ends their turn in the storm takes ${g.config.stormDamage} damage.`;
    el.classList.toggle('soon', soon);
    el.classList.toggle('live', rings > 0);
    el.innerHTML = `${icon('storm')}<span>${text}</span>`;
  }

  private renderBoard(): void {
    const g = this.game;
    const actor = activePlayer(g);
    const live = !this.locked;
    const moves = this.mode.kind === 'move' && live ? moveTargets(g) : [];
    const options = this.mode.kind === 'spell' && live ? castOptions(g, this.mode.spell) : [];
    const casting = this.mode.kind === 'spell' && live;
    const foe = g.players[otherPlayer(actor.id)];
    // A stunned wizard skips their next turn, so they threaten nothing.
    const threats = this.prefs.showThreats && live && foe.stunned === 0;
    const stormNext = stormRings(g);
    const stormRounds = roundsUntilStormGrows(g);
    const stormWarning = stormRounds !== null && stormRounds <= STORM_WARNING_ROUNDS;
    const blinking = this.mode.kind === 'spell' && SPELLS[this.mode.spell].movesCaster;
    const doomed = this.peek ? this.peek.events.flatMap((e) => (e.type === 'wallShattered' ? [e.at] : [])) : [];
    this.refs.board.dataset.threat = String(foe.id);

    this.tiles.forEach((el, i) => {
      const pos = { x: i % this.size, y: Math.floor(i / this.size) };
      const tile = getTile(g, pos);
      if (el.dataset.tile !== tile) {
        el.dataset.tile = tile;
        el.querySelector('.tile-content')!.innerHTML = tile === 'cloud' ? CLOUD_SVG : '';
      }

      // Landing here sets off a Thundercloud.
      const charged = tile !== 'wall' && cloudsOver(g, pos).length > 0;
      const marker = el.querySelector<HTMLElement>('.marker')!;
      const option = options.find((o) => samePos(o.target, pos));
      if (moves.some((p) => samePos(p, pos))) {
        marker.className = `marker move${charged ? ' shock' : ''}`;
      } else if (option) {
        marker.className = `marker target${option.affordable ? '' : ' unaffordable'}${blinking && charged ? ' shock' : ''}`;
        marker.dataset.level = String(option.level);
      } else {
        marker.className = 'marker';
      }

      el.classList.toggle('in-reach', casting && canReach(g, actor, pos));
      el.classList.toggle('threat', threats && canReach(g, foe, pos));
      el.classList.toggle('charged', charged && tile !== 'cloud');
      el.classList.toggle('doomed', doomed.some((p) => samePos(p, pos)));
      el.classList.toggle('storm', inStorm(g, pos));
      el.classList.toggle('storm-next', stormWarning && ringOf(g, pos) === stormNext);
      const focus = this.menu?.pos ?? this.hover;
      el.classList.toggle('hovered', focus !== null && samePos(focus, pos));
      el.classList.toggle('menu-open', this.menu !== null && samePos(this.menu.pos, pos));
      el.classList.toggle('clickable', marker.classList.length > 1);
      const touched = this.last !== null && this.last.squares.some((p) => samePos(p, pos));
      if (touched) el.dataset.last = String(this.last!.player);
      else delete el.dataset.last;
    });

    this.ghosts.forEach((ghost, id) => {
      const thrown = this.peek?.events.find(
        (e) => e.type === 'moved' && e.player === id && (e.via === 'gust' || e.via === 'blast'),
      );
      ghost.hidden = thrown?.type !== 'moved';
      if (thrown?.type === 'moved') ghost.style.transform = `translate(${thrown.to.x * 100}%, ${thrown.to.y * 100}%)`;
    });

    // A home corner glows gold once the enemy has drawn power from it.
    for (const id of [0, 1] as const) {
      const corner = homeCorner(g, id);
      this.tiles[corner.y * this.size + corner.x].classList.toggle('claimed', g.players[otherPlayer(id)].attuned);
    }
  }

  private renderTokens(): void {
    const g = this.game;
    g.players.forEach((p, id) => {
      const token = this.tokens[id];
      token.style.transform = `translate(${p.pos.x * 100}%, ${p.pos.y * 100}%)`;
      token.classList.toggle('active', g.current === id && g.winner === null);
      token.classList.toggle('frozen', p.frozen > 0);
      token.classList.toggle('stunned', p.stunned > 0);
      token.classList.toggle('fallen', p.hp <= 0);
    });
  }

  private renderCard(id: PlayerId): void {
    const g = this.game;
    const p = g.players[id];
    const card = this.refs[`card${id}`];
    const active = g.current === id && g.winner === null;
    const spend = active ? this.previewCost() : 0;
    const pips = (count: number, full: number, kind: string, spendFrom = Infinity) =>
      Array.from(
        { length: count },
        (_, i) => `<i class="pip ${kind}${i < full ? ' full' : ''}${i >= spendFrom && i < full ? ' spend' : ''}"></i>`,
      ).join('');
    const goal = squareName(homeCorner(g, otherPlayer(id)), this.size);
    const statuses = [
      p.attuned
        ? `<span class="chip attuned">Attuned: +${g.config.attunementBonus} mana a turn</span>`
        : `<span class="chip goal">Reach ${goal} for +${g.config.attunementBonus} mana a turn</span>`,
      p.stunned > 0 ? `<span class="chip stunned">Stunned: skips next ${turnsText(p.stunned)}</span>` : '',
      p.frozen > 0 ? `<span class="chip frozen">${this.frozenText(id)}</span>` : '',
      p.hp > 0 && inStorm(g, p.pos)
        ? `<span class="chip storm">In the storm: ${g.config.stormDamage} damage at end of turn</span>`
        : '',
    ].join('');

    const isAi = this.aiSide === id;
    const thinking = isAi && active && this.aiThinking;
    let sub = active ? 'Your move' : `Player ${id + 1}`;
    if (isAi) sub = thinking ? 'Thinking<span class="dots"></span>' : `AI · ${this.aiProfile!.label}`;
    else if (this.aiSide !== null && !active) sub = 'You';
    if (g.winner === id) sub = 'Victorious';

    card.classList.toggle('active', active);
    card.classList.toggle('thinking', thinking);
    card.classList.toggle('winner', g.winner === id);
    card.innerHTML = `
      <div class="card-head">
        <div class="sigil">${WIZARD_SVG}</div>
        <div>
          <div class="card-name">${PLAYER_NAMES[id]}</div>
          <div class="card-sub">${sub}</div>
        </div>
      </div>
      <div class="stat">
        <div class="stat-label"><span>Health</span><span>${p.hp} / ${g.config.maxHp}</span></div>
        <div class="pips">${pips(g.config.maxHp, p.hp, 'hp')}</div>
      </div>
      <div class="stat">
        <div class="stat-label"><span>Mana <em class="regen">+${manaPerTurn(g, p)}/turn</em></span><span>${p.mana} / ${g.config.maxMana}</span></div>
        <div class="pips">${pips(g.config.maxMana, p.mana, 'mana', p.mana - spend)}</div>
      </div>
      <div class="statuses">${statuses}</div>`;
  }

  private frozenText(id: PlayerId): string {
    const g = this.game;
    // The ice loses a turn of its life at the start of the frozen wizard's own turn.
    const ticks = g.players[id].frozen;
    const hits = `bolts hit for ${g.config.frozenBoltDamage}`;
    if (g.current === id) return `Frozen this turn${ticks > 1 ? ' and the next' : ''}: cannot move, ${hits}`;
    if (ticks > 1) return `Frozen through their next turn: cannot move, ${hits}`;
    return `Frozen, thaws next turn: ${hits}`;
  }

  /** Mana the hovered square would cost, so the card can preview it. */
  private previewCost(): number {
    const action = this.hoverAction();
    return action?.type === 'cast' ? action.level : 0;
  }

  private renderSpellbar(): void {
    const g = this.game;
    const locked = this.locked;
    for (const btn of this.refs.spellbar.querySelectorAll<HTMLButtonElement>('button')) {
      const action = btn.dataset.action;
      btn.disabled = locked;
      if (action === 'move') {
        btn.classList.toggle('selected', this.mode.kind === 'move' && !locked);
        btn.classList.toggle('dim', moveTargets(g).length === 0);
      } else if (action === 'pass') {
        btn.classList.toggle('armed', this.passArmed);
        btn.querySelector('.name')!.textContent = this.passArmed ? 'Confirm' : 'Pass';
      } else {
        const spell = btn.dataset.spell as SpellId;
        const blocked = locked ? null : whyNoCast(g, spell);
        btn.classList.toggle('selected', this.mode.kind === 'spell' && this.mode.spell === spell);
        btn.classList.toggle('dim', blocked !== null);
      }
    }
  }

  private renderHint(hoveredSpell?: SpellId): void {
    this.refs.hint.innerHTML = this.hintText(hoveredSpell);
  }

  private hintText(hoveredSpell?: SpellId): string {
    const g = this.game;
    if (g.winner !== null) return `${who(g.winner)} has won. Start a new game to duel again.`;
    if (hoveredSpell) {
      const blocked = this.locked ? null : whyNoCast(g, hoveredSpell);
      const why = blocked ? ` <span class="warn">${blocked}</span>` : '';
      return `<b>${SPELLS[hoveredSpell].name}:</b> ${SPELLS[hoveredSpell].summary}${why}`;
    }
    if (this.locked) return `${who(g.current)} is thinking<span class="dots"></span>`;

    const actor = activePlayer(g);
    const name = who(actor.id);
    if (this.passArmed) return `Press <b>Pass</b> again to end ${name}'s turn without acting.`;

    const outcome = this.peek ? this.outcome(this.peek) : '';
    const castLine = (spellName: string, target: Pos, cost: number) =>
      `Cast <b>${spellName}</b> on ${this.targetName(target)} for <b>${cost} mana</b>.${outcome}`;

    if (this.menu) {
      const { pos, choices } = this.menu;
      if (this.menuHover === 'move') return `Move ${name} to <b>${squareName(pos, this.size)}</b>.${outcome}`;
      const choice = choices.find((c) => c.spell === this.menuHover);
      if (choice?.affordable) return castLine(SPELLS[choice.spell].name, pos, choice.cost);
      if (choice) return `<b>${SPELLS[choice.spell].name}</b> costs ${choice.cost} mana here. ${name} has ${actor.mana}.`;
      return `Pick what to do at ${this.targetName(pos)}, or click elsewhere to cancel.`;
    }
    if (this.note) return this.note;

    if (this.mode.kind === 'move') {
      if (this.hover && this.peek) return `Move ${name} to <b>${squareName(this.hover, this.size)}</b>.${outcome}`;
      if (this.hover) return describeSquare(g, this.hover);
      return suggestion(g);
    }

    const spell = SPELLS[this.mode.spell];
    if (this.hover) {
      const option = this.optionAt(this.hover);
      if (option?.affordable) return castLine(spell.name, option.target, option.level);
      if (option) {
        return `That is ${squaresText(option.level)} away, so it costs ${option.level} mana. ${name} has ${actor.mana}.`;
      }
    }
    const blocked = whyNoCast(g, this.mode.spell);
    if (blocked) return `<b>${spell.name}:</b> <span class="warn">${blocked}</span>`;
    return `<b>${spell.name}:</b> ${spell.summary} Click a highlighted square.`;
  }

  /** Spells out the consequences of the hovered action that are easy to miss at a glance. */
  private outcome(peek: Peek): string {
    const actor = activePlayer(this.game);
    const lines: string[] = [];
    const blown = peek.events.filter((e) => e.type === 'wallShattered').length;
    if (blown > 1) lines.push(`The blast takes ${blown} walls.`);
    for (const e of peek.events) {
      const thrown = e.type === 'moved' && (e.via === 'gust' || e.via === 'blast');
      if (!thrown && !OUTCOME_EVENTS.has(e.type)) continue;
      const line = describeEvent(e, this.size);
      if (line) lines.push(line);
    }
    const me = peek.after.players[actor.id];
    const foe = peek.after.players[otherPlayer(actor.id)];
    const relocated = !samePos(me.pos, actor.pos);
    if (relocated && peek.after.winner === null && peek.after.current === foe.id && canReach(peek.after, foe, me.pos)) {
      lines.push(`<span class="warn">${who(foe.id)} could bolt ${who(me.id)} there.</span>`);
    }
    return lines.length ? ` <span class="outcome">${lines.join(' ')}</span>` : '';
  }

  private renderLog(): void {
    const groups: { player: PlayerId; turn: number; lines: string[] }[] = [];
    for (const e of this.game.log) {
      if (e.type === 'turnStarted') {
        groups.push({ player: e.player, turn: e.turn, lines: [] });
        continue;
      }
      const line = describeEvent(e, this.size);
      if (line && groups.length) groups[groups.length - 1].lines.push(line);
    }
    const items = groups
      .filter((grp) => grp.lines.length > 0)
      .reverse()
      .map(
        (grp) => `
        <li data-player="${grp.player}">
          <div class="log-head">Round ${roundOf(grp.turn)} · ${PLAYER_NAMES[grp.player]}</div>
          ${grp.lines.map((l) => `<div class="log-line">${l}</div>`).join('')}
        </li>`,
      );
    this.refs.log.innerHTML = items.length ? items.join('') : '<li class="log-empty">The duel has not begun.</li>';
  }

  private playEvents(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'cast':
          if (e.spell === 'siphon') this.beam(e.target, e.from, e.spell);
          else this.beam(e.from, e.target, e.spell);
          break;
        case 'damaged':
          this.tokens[e.player].classList.add('hit');
          this.floater(this.game.players[e.player].pos, e.iceShattered ? `Shatter! -${e.amount}` : `-${e.amount}`, 'dmg');
          break;
        case 'siphoned':
          if (e.amount > 0) {
            this.floater(this.game.players[e.from].pos, `-${e.amount} mana`, 'mana');
            this.floater(this.game.players[e.to].pos, `+${e.amount} mana`, 'mana');
          }
          break;
        case 'struck':
          for (const cloud of e.clouds) {
            if (!samePos(cloud, e.at)) this.beam(cloud, e.at, 'thundercloud');
          }
          this.lightning(e.at);
          this.floater(e.at, 'Stunned!', 'zap');
          break;
        case 'frozen':
          this.floater(this.game.players[e.player].pos, 'Frozen!', 'ice');
          break;
        case 'attuned':
          this.floater(e.at, `+${this.game.config.attunementBonus} mana a turn`, 'gold');
          this.toast(`${PLAYER_NAMES[e.player]} is attuned: +${this.game.config.attunementBonus} mana every turn`);
          break;
        case 'pushBlocked':
          this.floater(this.game.players[e.player].pos, 'Blocked', 'info');
          break;
        case 'wallRaised':
          this.tileAnim(e.at, 'anim-rise');
          break;
        case 'wallShattered':
          this.tileAnim(e.at, 'anim-crumble');
          break;
        case 'cloudPlaced':
          this.tileAnim(e.at, 'anim-appear');
          break;
        case 'turnSkipped':
          this.toast(`${PLAYER_NAMES[e.player]} is stunned and loses a turn`);
          break;
        case 'stormDamaged':
          this.tokens[e.player].classList.add('hit');
          this.floater(this.game.players[e.player].pos, `Storm -${e.amount}`, 'storm');
          break;
        case 'stormGrew':
          this.toast(e.rings === 1 ? 'The storm engulfs the outer ring' : 'The storm closes in');
          break;
        default:
          break;
      }
    }
  }

  private beam(from: Pos, to: Pos, spell: SpellId): void {
    const fx = this.refs.fx;
    const g = document.createElementNS(SVG_NS, 'g');
    g.dataset.spell = spell;
    const line = (cls: string) => {
      const l = document.createElementNS(SVG_NS, 'line');
      l.setAttribute('class', cls);
      l.setAttribute('x1', String(from.x + 0.5));
      l.setAttribute('y1', String(from.y + 0.5));
      l.setAttribute('x2', String(to.x + 0.5));
      l.setAttribute('y2', String(to.y + 0.5));
      l.setAttribute('pathLength', '1');
      return l;
    };
    const impact = document.createElementNS(SVG_NS, 'circle');
    impact.setAttribute('class', 'impact');
    impact.setAttribute('cx', String(to.x + 0.5));
    impact.setAttribute('cy', String(to.y + 0.5));
    impact.setAttribute('r', '0.42');
    g.append(line('beam-glow'), line('beam-core'), impact);
    fx.append(g);
    window.setTimeout(() => g.remove(), 900);
  }

  private lightning(at: Pos): void {
    const cx = at.x + 0.5;
    const top = at.y - 0.6;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'lightning');
    path.setAttribute(
      'd',
      `M${cx + 0.1} ${top} L${cx - 0.12} ${top + 0.55} L${cx + 0.08} ${top + 0.6} L${cx - 0.1} ${top + 1.1}`,
    );
    this.refs.fx.append(path);
    window.setTimeout(() => path.remove(), 800);
  }

  private floater(at: Pos, text: string, kind: string): void {
    const el = document.createElement('div');
    el.className = `floater ${kind}`;
    el.textContent = text;
    el.style.left = `${((at.x + 0.5) / this.size) * 100}%`;
    el.style.top = `${((at.y + 0.1) / this.size) * 100}%`;
    this.refs.tokens.append(el);
    el.addEventListener('animationend', () => el.remove());
  }

  private tileAnim(at: Pos, cls: string): void {
    const tile = this.tiles[at.y * this.size + at.x];
    tile.classList.add(cls);
    window.setTimeout(() => tile.classList.remove(cls), 700);
  }

  private toast(text: string): void {
    const el = this.refs.toast;
    el.textContent = text;
    el.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  private showWinner(): void {
    const g = this.game;
    if (g.winner === null) return;
    const overlay = this.refs.overlay;
    const round = roundOf(g.turn);
    const ai = this.aiProfile;
    let title = `${PLAYER_NAMES[g.winner]} wins!`;
    let detail = `The duel ended on round ${round}.`;
    if (ai && g.winner === this.setup.humanSide) {
      title = 'Victory!';
      detail = `You beat the ${ai.label} AI (${ai.title}) on round ${round}.`;
    } else if (ai) {
      title = 'Defeat';
      detail = `The ${ai.label} AI (${ai.title}) wins on round ${round}.`;
    }
    overlay.innerHTML = `
      <div class="overlay-card" data-player="${g.winner}">
        <div class="sigil big">${WIZARD_SVG}</div>
        <h2>${title}</h2>
        <p>${detail}</p>
        <div class="overlay-actions">
          <button class="primary" data-overlay="again">${ai ? 'Rematch' : 'Play again'}</button>
          <button class="ghost" data-overlay="setup">New setup</button>
          <button class="ghost" data-overlay="view">View board</button>
        </div>
      </div>`;
    overlay.hidden = false;
  }
}
