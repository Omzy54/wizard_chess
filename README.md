# Wizard Chess

A turn-based wizard duel on an 8x8 grid. Two wizards start in opposite corners and take turns
to either move one square or cast one of 8 spells. Bring the other wizard to 0 HP to win.

Play against an AI opponent (Easy, Medium, Hard or Expert) or against a friend on the same
screen. Online play is planned; see [PLAN.md](PLAN.md) for the full rules and roadmap.

## Running

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

**No install needed:** open [`release/wizard-chess.html`](release/wizard-chess.html) in a browser.
The whole game, AI included, is in that one file and runs offline from the file system
(the title fonts load from Google Fonts when online, with a plain fallback otherwise).

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server with hot reload |
| `npm test` | Engine and AI test suite (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build into `dist/` |
| `npm run bundle` | Build, then pack everything into the single file `release/wizard-chess.html` |
| `npm run arena` | AI-vs-AI matches to check each difficulty beats the one below |

## Controls

- Click a dot to move. Click the other wizard, a wall or any other square to get a list of the
  spells you can cast there, each with its mana cost. Right-click a square next to you for the
  same list.
- A spell costs 1 mana for every square between you and its target, up to 3 squares away.
- Hover anything to see what it is. When a spell is greyed out, hovering it says why: too far,
  no line of sight, or not enough mana.
- `1`-`8` pick a spell first instead, `M` move, `P` twice to pass, `Esc` to cancel.
- `U` takes back your last action. `T` shows or hides the threat zone: the hatched squares
  your opponent could bolt on their next turn.
- With a spell picked, targets are labelled with their mana cost. Dashed targets are in range
  but you cannot afford them yet.
- Hover a target before clicking. The line under the board says what the action will do: where
  a Gust or Shatter throws a wizard (also shown as a ghost on the board), damage dealt, storm
  burns, and whether a move leaves you in bolt range.
- Squares within reach of a Thundercloud have a yellow glow, and a move or Blink that would
  set one off is marked in yellow. Hovering a Shatter outlines every wall it will take.
- The squares touched by the last action stay tinted in that wizard's colour, and a line
  under the board says what the last turn did.
- A game in progress is saved in the browser and picked up again after a refresh.

## Spells

| # | Spell | Effect |
|---|-------|--------|
| 1 | Arcane Bolt | 1 damage, or 2 against a frozen wizard. The only damaging spell. |
| 2 | Raise Wall | Creates a wall that blocks movement and sight. |
| 3 | Shatter | Blows up a wall and every wall joined to it, throwing nearby wizards 2 squares away. |
| 4 | Thundercloud | A trap. Whoever lands on it or next to it loses their next turn. |
| 5 | Blink | Teleport to a free square. |
| 6 | Gust | Blow the opponent up to 2 squares away. |
| 7 | Freeze | For 2 turns the opponent cannot move or blink, and your next bolt hits for 2. |
| 8 | Siphon | Steal 2 mana. |

Every spell works the same at any distance. What changes is the price: 1 mana per square to
the target (diagonals count as 1), up to 3 squares. Every spell needs line of sight.

**Ley corners:** reach the enemy's starting corner to become attuned and gain an extra mana
every turn for the rest of the game.

**The storm:** on round 12 an arcane storm engulfs the outer ring of the board, and every 8
rounds it closes in by another ring until nothing is left. A wizard who ends their turn inside
it takes 1 damage. Nobody can hide forever, and Gust, Freeze, walls and Thunderclouds all
become ways to keep an opponent out in it.

## Project layout

- `src/engine/` Pure TypeScript game rules, no DOM. Tunable numbers are in `config.ts`.
- `src/ai/` Computer opponent (minimax search), run in a Web Worker.
- `src/ui/` Browser front end.
- `tests/` Engine and AI tests, including randomised full games that check invariants.
- `tools/arena.ts` AI-vs-AI tournament script.
