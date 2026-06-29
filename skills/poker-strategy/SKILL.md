---
name: poker-strategy
description: >
  Activate for every poker decision at the dev.fun arena.
  Runs GTO, CFR, Monte Carlo equity, Range-Based, and ICM strategies
  through the engine and returns the optimal action in under 3 seconds.
version: 1.0.0
author: hermes-poker-agent
platforms: [linux, macos, windows]
tags: [poker, arena, dev.fun, strategy, gto, monte-carlo]
---

# Poker Strategy Skill

## When to activate

Activate this skill whenever:
- The arena sends a game state asking for an action
- You need to decide: fold / call / raise / check / bet / all-in
- You are tracking an opponent's tendencies

## Decision pipeline (run every hand)

### Step 1 — Parse the arena game state

The arena sends a JSON object. Extract these fields:

| Arena field | Engine field | Notes |
|---|---|---|
| `hole_cards` | `heroHand` | e.g. `["As","Kd"]` |
| `community_cards` | `board` | empty array pre-flop |
| `pot` | `pot` | total chips in pot |
| `to_call` | `toCall` | 0 if checking opportunity |
| `street` | `street` | preflop/flop/turn/river |
| `position` | `position` | "IP" or "OOP" |
| `active_players` | `numOpponents` | subtract 1 (exclude self) |
| `my_stack` | `stackDepth` | your chip count |

### Step 2 — Run the engine

```js
const { HermesAgent } = require('./src/engine');

// Create once per session, reuse across hands
const hermes = new HermesAgent({
  timeBudget: 2800,    // ms — leaves 200ms safety margin
  mcSimCount: 10000,   // simulations per decision
});

const decision = await hermes.decide({
  heroHand: parsedHand,
  board: parsedBoard,
  pot: parsedPot,
  toCall: parsedToCall,
  street: parsedStreet,
  position: parsedPosition,
  numOpponents: parsedOpponents,
  stackDepth: parsedStack,
}, {
  opponentId: activeOpponentSeatId,
  // tournament: { heroStack, blindLevel, bubbleDistance } // only in SNG/MTT
});
```

### Step 3 — Return the action

```js
return {
  action: decision.action,   // FOLD | CALL | RAISE | BET | CHECK | ALL_IN
  amount: decision.amount,   // chip amount (0 for FOLD/CHECK)
};
```

Log for debugging:
```js
console.log(decision.hermesNote);
// e.g. "[🎴] Hermes Confident → BET | Equity: 71.3% | Heads-up | IP"
```

### Step 4 — Track the opponent after the hand

```js
// Record every action you observe from each opponent
hermes.trackOpponent(opponentSeatId, 'CALL');
hermes.trackOpponent(opponentSeatId, 'RAISE');
hermes.trackOpponent(opponentSeatId, 'FOLD_CBET');
// After 10+ observations, the engine switches from GTO → Exploitative CFR
```

---

## Strategy auto-selection logic

The engine picks the primary strategy automatically — you never choose manually:

```
Is it a tournament?        → ICM strategy
Opponent classified?       → Exploitative CFR
Only 1 opponent?           → GTO Adaptive
2+ opponents + action seq? → Range-Based
Otherwise                  → GTO Adaptive (default)
```

All active strategies also vote in a weighted blend:
- Exploitative CFR: 35% vote weight
- GTO Adaptive: 30% vote weight
- Range-Based: 25% vote weight
- ICM: 10% vote weight

---

## Tuning

Edit these values in `skills/poker-strategy/src/engine.js` or override when constructing `HermesAgent`:

| Setting | Default | Effect |
|---|---|---|
| `mcSimCount` | 10000 | More sims = more accurate, slower |
| `timeBudget` | 2800 | Max ms before early termination |
| CFR weight | 0.35 | Raise to exploit opponents more |
| GTO weight | 0.30 | Raise for more unexploitable play |

---

## Pitfalls

- **Do not construct a new `HermesAgent` every hand** — create it once per session
- **`numOpponents` is active players minus yourself** — not the full table count
- **`toCall: 0` means check opportunity** — not a free card, you can still bet
- **Pre-flop `board` is an empty array `[]`** — not null, not undefined
- **Position matters significantly** — IP gets +4% equity adjustment, OOP gets -2%

---

## Quick reference — action meanings

| Action | Meaning | Amount field |
|---|---|---|
| `CHECK` | No bet, pass action | 0 |
| `FOLD` | Surrender hand | 0 |
| `CALL` | Match current bet | = `toCall` |
| `BET` | Open bet (no prior bet) | chips to bet |
| `RAISE` | Re-raise a bet | total chips to put in |
| `ALL_IN` | Push entire stack | = `stackDepth` |
