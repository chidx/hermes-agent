# Hermes Poker Agent

A poker AI for the [dev.fun arena](https://arena.dev.fun) built on top of Hermes Agent.
Plays 6-max No-Limit Texas Hold'em using 5 integrated strategies with Monte Carlo equity simulation.

```
hermes-poker-agent/
├── README.md               ← you are here
├── AGENTS.md               ← Hermes reads this automatically on startup
├── .hermes/
│   └── SOUL.md             ← copy to ~/.hermes/SOUL.md (sets poker persona)
├── skills/
│   └── poker-strategy/
│       └── SKILL.md        ← install this into Hermes (the strategy brain)
└── src/
    ├── engine.js           ← the poker AI engine (all 5 strategies)
    └── engine.test.js      ← test suite (32 tests)
```

---

## Quickstart (3 steps)

### Step 1 — Clone and test the engine

```bash
git clone https://github.com/your-username/hermes-poker-agent
cd hermes-poker-agent
node src/engine.test.js
# Expected: 32 passed / 0 failed
```

### Step 2 — Install the skill into Hermes

```bash
hermes skills install ./skills/poker-strategy/SKILL.md
```

That's it. Hermes now knows how to play poker.

### Step 3 — Set the poker persona (optional but recommended)

```bash
cp .hermes/SOUL.md ~/.hermes/SOUL.md
```

This tells Hermes to always think like a poker agent, not a general assistant.

---

## Joining the dev.fun Arena

Once the skill is installed, open Hermes and paste this:

```
read /skills/arena.md and follow the instructions to join
```

Hermes will read the arena skill, register, and start playing automatically.
Your poker-strategy skill activates every time the arena asks for a decision.

---

## How it works

Every hand, the arena sends Hermes a game state (your cards, board, pot, etc).
Hermes reads the `poker-strategy` skill, which tells it to call `src/engine.js`.
The engine runs up to 10,000 Monte Carlo simulations and picks the best action in under 3 seconds.

```
Arena game state
      ↓
poker-strategy skill   ← Hermes reads this
      ↓
src/engine.js          ← runs the math
      ↓
action + amount        ← sent back to arena
```

### The 5 strategies inside `engine.js`

| Strategy | When it activates |
|---|---|
| Monte Carlo Equity | Every decision — computes equity via simulation |
| GTO Adaptive | Default for heads-up (1v1) |
| Exploitative CFR | When opponent patterns are recognized |
| Range-Based | Multiway pots (1vN) |
| ICM | Tournament / SNG mode |

---

## Customizing strategy behavior

Edit `skills/poker-strategy/SKILL.md` and re-install:

```bash
hermes skills install ./skills/poker-strategy/SKILL.md --force
```

Common tweaks:
- Change `mcSimCount` (line ~20 in SKILL.md) for more/fewer simulations
- Adjust strategy weights in the blending section
- Add opponent-specific notes to the profiling section

---

## Running tests

```bash
node src/engine.test.js
```

Output includes a performance benchmark. Target: full pipeline under 200ms.
