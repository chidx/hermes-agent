# AGENTS.md — Hermes Poker Agent

Hermes reads this file automatically when started from this project directory.
These rules apply for the entire session.

## What this project is

This is a poker AI agent for the dev.fun arena.
The decision engine lives in `skills/poker-strategy/src/engine.js`.
Never reimplement poker logic inline — always call the engine.

## Decision rule (mandatory)

For every poker action, you MUST:

1. Read the current game state from the arena
2. Map it to the engine's input format (see below)
3. Call `skills/poker-strategy/src/engine.js` via Node.js
4. Return the `action` and `amount` from the result

**Never guess. Never skip the engine. Always compute equity first.**

## How to call the engine

```js
const { HermesAgent } = require('./skills/poker-strategy/src/engine');
const hermes = new HermesAgent({ timeBudget: 2800, mcSimCount: 10000 });

const decision = await hermes.decide({
  heroHand: ['As', 'Kd'],   // your two hole cards
  board: ['Jh', 'Tc', '2s'], // community cards (empty array pre-flop)
  pot: 120,                  // total chips in pot
  toCall: 0,                 // chips you need to call (0 = check opportunity)
  street: 'flop',            // preflop | flop | turn | river
  position: 'IP',            // IP (in position) or OOP (out of position)
  numOpponents: 1,           // number of active opponents at the table
  stackDepth: 500,           // your current chip stack
}, {
  opponentId: 'player_seat_3',  // use seat ID or player ID to track opponents
});

// Use these fields:
// decision.action   → 'FOLD' | 'CALL' | 'RAISE' | 'BET' | 'CHECK' | 'ALL_IN'
// decision.amount   → chip amount (0 for FOLD/CHECK)
// decision.equity   → your equity % (for logging)
// decision.elapsed  → ms taken (should be under 2800)
```

## Opponent tracking (cross-hand memory)

After each hand, record what you learned:

```js
hermes.trackOpponent('player_seat_3', 'CALL');   // they called
hermes.trackOpponent('player_seat_3', 'RAISE');  // they raised
hermes.trackOpponent('player_seat_3', 'FOLD_CBET'); // they folded to c-bet
```

The engine builds a profile automatically. After 10+ observed actions,
`_selectStrategy()` will switch from GTO to Exploitative CFR for that player.

## File structure

```
skills/poker-strategy/
├── SKILL.md           ← decision instructions
└── src/
    ├── engine.js      ← main engine (DO NOT edit during a session)
    └── engine.test.js ← run with: node skills/poker-strategy/src/engine.test.js
.hermes/SOUL.md        ← copy to ~/.hermes/SOUL.md once
```

## Testing before joining the arena

```bash
node skills/poker-strategy/src/engine.test.js
```

All 32 tests must pass before joining. If any fail, do not enter the arena.

## Performance requirement

The arena has a decision time limit.
The engine's `timeBudget` is set to 2800ms with a 200ms safety margin.
If you see `elapsed > 2500` in logs, reduce `mcSimCount` to 5000.
