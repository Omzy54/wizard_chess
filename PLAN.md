# Wizard Chess: Plan

A turn-based PvP duel. Two wizards start in opposite corners of an 8x8 grid. Each turn a
wizard either moves or casts one of 8 spells. The first wizard to drop the other to 0 HP wins.

## Rules (v1)

Numbers marked *(tunable)* live in `src/engine/config.ts` and are guesses until playtested.

### Setup
- 8x8 board. Azure (player 1) starts bottom-left (a1), Crimson (player 2) top-right (h8).
- Each wizard has 5 HP *(tunable)*.
- Each wizard starts with 1 mana on their first turn, so openings are level 1 spells or moves.

### Turns
- Azure goes first. On your turn you take exactly one action:
  - **Move** one square in any of the 8 directions, or
  - **Cast** one spell, or
  - **Pass** (only so a wizard can never get stuck with no legal action).
- At the end of each of your turns you regain 1 mana, up to a cap of 5 *(tunable)*.

### Ley corners
- Each wizard's starting corner is marked with a rune.
- The first time a wizard enters the **enemy's** starting corner (walking, Blink, or being
  pushed there), they become **attuned** and regain 1 extra mana every turn for the rest of
  the game *(tunable)*.
- This gives both players a reason to push forward: waiting around lets the opponent claim it.
  Corners are easy to wall off or trap with a Thundercloud, so defending one is a real fight.

### The storm
- At the start of round 12 *(tunable)* an arcane storm engulfs the outer ring of the board.
  Every 8 rounds *(tunable)* it takes the next ring in: a 6x6 safe area, then 4x4, then 2x2,
  then nothing.
- A wizard who ends their own turn on a storm square takes 1 damage *(tunable)*. That includes
  a turn lost to a stun.
- Being pushed into the storm on the opponent's turn does not hurt by itself: you get your own
  turn to walk out, unless you are frozen, stunned or walled in. So the control spells can now
  deal damage indirectly, without Arcane Bolt losing its place as the only damaging spell.
- Walls and clouds inside the storm stay where they are, and the ley corners still work there.
  Claiming one late just costs HP.
- Setting `stormStartRound` to 0 turns the storm off.

### Spell levels, range and cost
- Every spell can be cast at level 1, 2 or 3.
- Level N costs N mana and reaches any square within N steps in any direction
  (a 3x3, 5x5 or 7x7 square around the caster).
- The level only changes range and cost, never the effect. The UI casts at the cheapest level
  that reaches the square you click, and never says "level": it shows the mana cost, which is
  the distance.

### Walls and sight
- Walls block movement and line of sight.
- Every spell needs line of sight from the caster to the target square. Sight is traced
  centre-to-centre; it is blocked if it passes through a wall, or squeezes diagonally between
  two walls that touch at a corner.
- Movement follows the same corner rule: you cannot step diagonally between two such walls.
- Players and thunderclouds do not block sight.

### The 8 spells

| # | Spell | Target | Effect |
|---|-------|--------|--------|
| 1 | Arcane Bolt | opponent | 1 damage, or 2 against a frozen wizard (which also breaks the ice). The only damaging spell. |
| 2 | Raise Wall | empty square | Creates a wall. |
| 3 | Shatter | wall | Blows up the wall and every wall joined to it through walls that touch, corners included. Every wizard next to a blown wall, caster included, is thrown 2 squares *(tunable)* away from the walls beside them. |
| 4 | Thundercloud | empty square | Leaves a cloud that stays until it strikes. A wizard who lands on it or on a square next to it *(reach tunable)*, by moving, Blink, Gust or a blast, caster included, is struck and loses their next turn. The cloud is then gone. |
| 5 | Blink | square with no wall or wizard | Teleports you there. |
| 6 | Gust | opponent | Blows them up to 2 squares directly away from you. They stop early at a wall, the edge, a corner squeeze, or on entering a Thundercloud. |
| 7 | Freeze | opponent | Frozen for their next 2 turns *(tunable)*: they cannot Move or Blink, and your next Arcane Bolt hits for 2. |
| 8 | Siphon | opponent | Steals up to 2 mana from them. |

Details that matter in play:
- A cloud only strikes on arrival. A wizard already standing beside one when it is cast is
  safe until they move to another square in its reach. Someone thrown past a cloud is only
  struck if they land in its reach. Every cloud in reach of the landing square goes off at once.
- A wizard beside several blown walls is thrown away from all of them together, so walls on
  opposite sides cancel out.
- The ice lasts through two of the frozen wizard's turns, which gives the caster two turns to
  land the 2-damage bolt. The bolt breaks the ice.

Combos this enables: Freeze then Bolt for 2 unless they keep your sight blocked for two turns,
Freeze a wizard at the edge of the safe area and Gust them into the storm while they cannot
walk back, Gust or blast an opponent into the reach of a Thundercloud for two turns in a row,
seed clouds where the storm will leave the last safe squares, Shatter one end of a wall chain
to throw a wizard hiding at the other end, Siphon to keep them from affording long-range
spells.

### Changes after the first playtest
- Starting mana dropped from 3 to 1.
- Added ley corners, so standing still is no longer safe.
- Frost was a one-turn root that rarely mattered. It is now Freeze, which sets up a 2-damage
  bolt the target has to answer.
- Gust pushes 2 squares (was 1), Shatter knocks nearby wizards back, Siphon steals 2 (was 1).

### Changes after the second playtest
Measured with AI-vs-AI games rather than by feel.
- **The storm.** Before it, 14 of 16 Hard-vs-Hard games were still going after 300 turns and a
  third of all actions were passes: whoever steps into range first gives away the first bolt,
  and a wall that blocks a bolt costs 1 mana while the bolt costs up to 3, so both wizards sat
  at full mana and waited. With the storm every game ends, in about 28 rounds on average at
  Hard, and passes are down to roughly one action in nine.
- **Timing.** A storm that starts on round 10 and closes every 5 rounds dealt nearly half of all
  damage itself and left the ley corners almost unused. Starting on round 12 and closing every
  8 keeps bolts at about 70% of the damage and doubles how often a corner gets claimed (about
  0.8 times a game, up from 0.4).
- Gust went from 0.2% of actions to about 4%, the biggest change among the spells. Freeze and
  Thundercloud are still rare in AI play (under 2% each), which is worth another look.

### Changes after the third playtest
Spell buffs, again measured with AI-vs-AI games (Hard against Hard and Medium against Medium,
with randomised openings so the games differ).
- **What was wrong.** Freeze was 0.4% of Hard's actions and Thundercloud 1.9%. A cloud only
  covered its own square, so nobody ever walked into one, and Freeze then Bolt dealt the same
  2 damage as two bolts while giving the target a turn to wall it off.
- **Thundercloud** now reaches the squares around it. One cloud denies a 3x3 area, a Gust no
  longer has to land exactly on it, and clouds near the centre matter once the storm closes in.
- **Shatter** takes the whole chain of joined walls and throws wizards 2 squares instead of 1.
  Walling yourself in is riskier, and stacked walls no longer cost one Shatter each.
- **Freeze** lasts two of the target's turns instead of one.
- **Left alone:** Arcane Bolt, Raise Wall, Blink and Siphon were already the most used spells.
  Gust is unchanged but gains from the wider clouds.
- **Tried and rejected.** A 2-turn stun, a 3-damage frozen bolt and a Freeze that also stops
  walls all made both sides keep their distance more: bolt damage went down and storm damage
  up. A 3-square Gust did the same by being a better escape. A Freeze that stops mana
  regeneration got used several times as often but can lock a wizard down for good. Clouds that
  strike whoever ends a turn beside them led to both wizards stunning themselves in turn.
  Lesson: whoever steps into range first already gives away the first hit, so making that hit
  harder makes play more passive. The buffs that worked change the board instead.
- **Result at Hard (32 games before, 32 after).** Lightning strikes went from 0.13 to 0.94 a
  game and Thundercloud from 1.9% to 3.3% of actions. A chain Shatter (two or more walls)
  happens 1.3 times a game and the walls left standing at the end fell from 5.5 to 2.8.
  Freeze rose from 0.4% to 1.1% and frozen bolts from 0.09 to 0.25 a game.
- **Result at Medium (80 games each).** Freeze rose from 1.9% to 4.2% of actions, frozen bolts
  from 0.5 to 1.1 a game and strikes from 0.28 to 0.78 a game.
- **What did not change.** Game length (about 28 rounds at Hard), the split between bolt and
  storm damage (about 5 to 3 at Hard) and the first player's share of wins (17 of 32 at Hard
  both before and after, 38 of 80 at Medium). The difficulty ladder held: Medium beat Easy
  24-0, Hard beat Medium 23-1 and Expert beat Hard 17-7 at a quarter of the normal thinking time.
- **Still weak.** Freeze is the least used spell at Hard, and both sides still deal only about
  1 damage between them before the storm arrives.

### Choices made where the brief was open
These are easy to change, so flag any you want different:
1. **Thundercloud stuns instead of damaging**, so Arcane Bolt stays the only attacking spell.
2. **The 4 spells not in the brief** (Blink, Gust, Frost, Siphon) are my picks. All of them
   target a square, so levels mean range for every spell.
3. **5 HP and a 5 mana cap.** Without a cap a wizard can hide behind walls and bank mana.
4. **A move is one square, like a chess king.**
5. **Thunderclouds are visible to both players.** Hidden traps only make sense once each
   player has their own screen (online play).

## Architecture

```
src/
  engine/     Pure TypeScript rules. No DOM, fully deterministic, serialisable state.
    config.ts   Tunable numbers
    types.ts    State, actions and events
    board.ts    Geometry: distance, line of sight, stepping rules
    effects.ts  State mutations shared by actions and spells
    spells.ts   Spell definitions, targeting and resolution
    game.ts     createGame, validateAction, applyAction, target queries
  ai/         Computer opponent
    ai.ts       Evaluation, candidate actions, minimax search, difficulty profiles
    worker.ts   Runs the search in a Web Worker so the page stays responsive
  ui/         Browser front end (plain DOM, no framework)
  main.ts
tests/        Vitest suites for the engine and AI
tools/
  arena.ts    AI-vs-AI matches for checking difficulty levels
```

The engine is the single source of truth. `applyAction(state, action)` validates and returns a
new state plus an event log the UI uses for text and animation. Because the state is plain
JSON, the same engine can later run on a server to referee online games.

## AI opponent

Minimax with alpha-beta pruning and iterative deepening over a hand-tuned evaluation: HP,
mana (which is also range), attunement and progress towards the enemy corner, who can bolt
whom next turn (doubled against a frozen target), stuns, freezes, mobility (squares in reach
of a cloud do not count), a Gust that would land the other wizard by a cloud or deep in the
storm, distance, and standing in the storm or in the ring it is about to take (worse when
pinned there).
Casts always use the cheapest level, and walls, clouds and blinks are trimmed to squares that
can matter, which keeps the search a few plies deep in well under a second.

| Level | Title | Search | Randomness |
|-------|-------|--------|------------|
| Easy | Apprentice | 1 ply | Picks loosely among good moves, 30% random moves |
| Medium | Adept | 2 plies | Mild, 5% random moves |
| Hard | Sorcerer | 4 plies | None |
| Expert | Archmage | Up to 10 plies within 2.5s | None |

`node tools/arena.ts` plays the levels against each other. Each level should beat the one
below it.

Before ley corners, two careful wizards held back forever, because whoever steps into range
first gives the other the first bolt. The corners give both sides something to go and get, and
the AI also has a pull towards its opponent that grows over the game. That was not enough on
its own (see the second playtest above), which is what the storm is for.

## Roadmap

### Phase 1: rules engine (done)
- [x] Board, line of sight, movement
- [x] All 8 spells, mana, levels, stun and root
- [x] Turn flow and win detection
- [x] Unit tests for every rule above

### Phase 2: local UI and AI (in progress)
- [x] Board with walls, clouds and wizards
- [x] Player panels: HP, mana, status
- [x] Spell bar with hotkeys, target highlighting by level and cost
- [x] Event log, rules sheet, game over and rematch
- [x] AI opponent with four difficulty levels, play as either side
- [x] Basic spell effects (beams, wall rise, lightning, floating numbers)
- [x] Storm tiles, a warning outline on the ring about to go, and a countdown on the board
- [x] Hover preview of what an action will do, with ghosts for pushed wizards
- [x] Threat zone showing where the opponent can bolt next turn
- [x] Last action highlight, undo, and resuming a game after a refresh
- [x] Cloud reach shading, warnings on moves that set a cloud off, Shatter chain preview
- [x] Click a square for the spells you can cast there, with costs and reasons in plain words
- [x] Hover descriptions for every square, a last-turn line, a first-visit intro
- [ ] Richer animations per spell
- [ ] Sound effects

### Phase 3: playtest and balance
- [x] First playtest: lower starting mana, ley corners, stronger spells
- [x] Second playtest (AI vs AI): games stalled, so the board now shrinks (the storm)
- [x] Third playtest (AI vs AI): wider Thunderclouds, chain Shatter, longer Freeze
- [ ] More playtesting, tune HP, mana cap and spells
- [ ] Freeze is still the least used spell. Buffs to its damage backfired, so it needs another idea.
- [ ] The opening is quiet: little damage is dealt before the storm arrives
- [ ] Teach the AI to fight for the last safe squares instead of waiting out the storm

### Phase 4: online PvP
- [ ] Node WebSocket server that owns the game state and runs the same engine
- [ ] Rooms joined by a share code, reconnect on refresh
- [ ] Hidden information (secret thunderclouds) once players have separate screens
- [ ] Deploy (static client plus a small server host)

### Phase 5: polish
- [ ] Art pass for wizards, tiles and spell effects
- [ ] Tutorial / first-game walkthrough
- [ ] Desktop build with Electron, if wanted
