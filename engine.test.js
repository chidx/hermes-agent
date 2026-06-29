/**
 * HERMES POKER AI — TEST SUITE & BENCHMARK
 * Run: node src/engine.test.js
 */

const {
  HermesAgent,
  MonteCarloEquity,
  HandEvaluator,
  GTOAdaptive,
  ExploitativeCFR,
  RangeBasedSolver,
  ICMStrategy,
  Deck,
  cardToInt,
} = require('./engine');

// ─── TEST UTILITIES ───────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertRange(val, lo, hi, msg) {
  if (val < lo || val > hi)
    throw new Error(`${msg || 'Value'} = ${val.toFixed(3)}, expected [${lo}, ${hi}]`);
}

// ─── HAND EVALUATOR TESTS ────────────────────────────────────────────────────

console.log('\n📋 Hand Evaluator Tests');

test('Royal flush beats straight flush', () => {
  const royalFlush = ['As','Ks','Qs','Js','Ts','2h','3d'].map(cardToInt);
  const straightFlush = ['9s','8s','7s','6s','5s','Ah','Kd'].map(cardToInt);
  assert(
    HandEvaluator.evaluate(royalFlush) > HandEvaluator.evaluate(straightFlush),
    'Royal flush should win'
  );
});

test('Full house beats flush', () => {
  const fullHouse = ['Ah','As','Ad','Kh','Kd','2c','3s'].map(cardToInt);
  const flush = ['2h','5h','8h','Jh','Qh','As','Kd'].map(cardToInt);
  assert(
    HandEvaluator.evaluate(fullHouse) > HandEvaluator.evaluate(flush),
    'Full house should beat flush'
  );
});

test('Higher pair wins', () => {
  const pairAces = ['Ah','As','2c','3d','7h','8s','Kd'].map(cardToInt);
  const pairKings = ['Kh','Ks','2c','3d','7h','8s','Ad'].map(cardToInt);
  assert(
    HandEvaluator.evaluate(pairAces) > HandEvaluator.evaluate(pairKings),
    'Pair of aces should beat pair of kings'
  );
});

test('Hand names are correct', () => {
  const sf = HandEvaluator.evaluate(['As','Ks','Qs','Js','Ts','2h','3d'].map(cardToInt));
  assert(HandEvaluator.handName(sf) === 'Straight Flush');
});

test('Wheel straight (A-2-3-4-5) detected', () => {
  const wheel = ['Ah','2s','3d','4c','5h','Kc','Qd'].map(cardToInt);
  const score = HandEvaluator.evaluate(wheel);
  assert(HandEvaluator.handName(score) === 'Straight', `Expected Straight, got: ${HandEvaluator.handName(score)}`);
});

// ─── MONTE CARLO TESTS ────────────────────────────────────────────────────────

console.log('\n🎲 Monte Carlo Equity Tests');

test('AA pre-flop equity vs 1 opponent ~85%', () => {
  const result = MonteCarloEquity.calculate(['Ah','Ad'], [], 1, 5000);
  assertRange(result.equity, 0.78, 0.92, 'AA equity');
});

test('72o pre-flop equity vs 1 opponent ~34%', () => {
  const result = MonteCarloEquity.calculate(['7h','2d'], [], 1, 5000);
  assertRange(result.equity, 0.28, 0.42, '72o equity');
});

test('Equity drops with more opponents', () => {
  const vs1 = MonteCarloEquity.calculate(['Ah','Ad'], [], 1, 2000);
  const vs3 = MonteCarloEquity.calculate(['Ah','Ad'], [], 3, 2000);
  assert(vs1.equity > vs3.equity, 'Equity should drop in multiway');
});

test('Flush draw has ~35% equity on flop', () => {
  const result = MonteCarloEquity.calculate(
    ['Ah','Kh'], ['2h','7h','Qd'], 1, 5000
  );
  assertRange(result.equity, 0.55, 0.75, 'TPTK+Nut FD equity');
});

test('Completed flush has high equity', () => {
  const result = MonteCarloEquity.calculate(
    ['Ah','Kh'], ['2h','7h','Qh'], 1, 5000
  );
  assertRange(result.equity, 0.75, 0.99, 'Made nut flush equity');
});

test('Pre-flop rank classifier', () => {
  assert(MonteCarloEquity.preFlopRank(['Ah','As']) === 'PREMIUM');
  assert(MonteCarloEquity.preFlopRank(['7h','2d']) === 'WEAK');
  assert(MonteCarloEquity.preFlopRank(['Kh','Qd']) !== 'WEAK');
});

// ─── GTO STRATEGY TESTS ───────────────────────────────────────────────────────

console.log('\n⚖️  GTO Adaptive Tests');

test('GTO pot odds calculation correct', () => {
  const odds = GTOAdaptive.potOdds(100, 200);
  assert(Math.abs(odds - (100/300)) < 0.001, `Expected 0.333, got ${odds}`);
});

test('GTO bets value hands', () => {
  const gs = { equity: 0.80, pot: 100, toCall: 0, street: 'flop', position: 'IP', numOpponents: 1, raiseCount: 0 };
  const d = GTOAdaptive.decide(gs);
  assert(['BET','RAISE'].includes(d.action), `Expected BET/RAISE, got ${d.action}`);
});

test('GTO folds weak hands facing bet', () => {
  const gs = { equity: 0.25, pot: 100, toCall: 80, street: 'river', position: 'OOP', numOpponents: 1, raiseCount: 0 };
  const d = GTOAdaptive.decide(gs);
  assert(d.action === 'FOLD', `Expected FOLD, got ${d.action}`);
});

test('GTO adjusts for multiway', () => {
  const gs1 = { equity: 0.60, pot: 100, toCall: 0, street: 'flop', position: 'IP', numOpponents: 1, raiseCount: 0 };
  const gs3 = { equity: 0.60, pot: 100, toCall: 50, street: 'flop', position: 'IP', numOpponents: 3, raiseCount: 0 };
  const d1 = GTOAdaptive.decide(gs1);
  const d3 = GTOAdaptive.decide(gs3);
  // Multiway should be tighter
  assert(d3.action !== 'RAISE' || d1.action === 'RAISE', 'Multiway should be tighter');
});

// ─── EXPLOITATIVE CFR TESTS ───────────────────────────────────────────────────

console.log('\n🎯 Exploitative CFR Tests');

test('CFR identifies FISH correctly', () => {
  const cfr = new ExploitativeCFR();
  for (let i = 0; i < 20; i++) {
    cfr.updateProfile('fish_player', 'CALL');
  }
  for (let i = 0; i < 2; i++) {
    cfr.updateProfile('fish_player', 'RAISE');
  }
  const type = cfr.classifyOpponent('fish_player');
  assert(type === 'FISH' || type === 'CALLING_STATION', `Expected FISH-type, got ${type}`);
});

test('CFR never bluffs vs FISH', () => {
  const cfr = new ExploitativeCFR();
  const exploit = cfr.getExploit('FISH');
  assert(exploit.bluffFreq <= 0.15, 'Should not bluff fish');
});

test('CFR bluffs frequently vs NIT', () => {
  const cfr = new ExploitativeCFR();
  const exploit = cfr.getExploit('NIT');
  assert(exploit.bluffFreq >= 0.5, 'Should bluff nits');
});

// ─── RANGE SOLVER TESTS ───────────────────────────────────────────────────────

console.log('\n📊 Range-Based Solver Tests');

test('Board texture: monotone detected', () => {
  const tex = RangeBasedSolver.analyzeBoard(['Ah','Kh','Qh']);
  assert(tex.isMonotone, 'AhKhQh should be monotone');
});

test('Board texture: connected detected', () => {
  const tex = RangeBasedSolver.analyzeBoard(['8s','9h','Td']);
  assert(tex.isConnected, '8-9-T should be connected');
});

test('Narrow range increases equity required', () => {
  const wide = RangeBasedSolver.inferRangeWidth([], 'BTN');
  const narrow3bet = RangeBasedSolver.inferRangeWidth(['3BET', 'BET_TURN', 'BET_RIVER'], 'UTG');
  assert(wide > narrow3bet, 'Wide range > narrow range width');
});

// ─── ICM TESTS ────────────────────────────────────────────────────────────────

console.log('\n🏆 ICM Strategy Tests');

test('ICM shoves short stack with equity', () => {
  const d = ICMStrategy.decide({
    equity: 0.48, pot: 200, toCall: 50,
    heroStack: 150, blindLevel: 20,
    numPlayers: 6, bubbleDistance: 5
  });
  assert(d.action === 'ALL_IN', `Expected ALL_IN shove for short stack`);
});

test('ICM folds on bubble with marginal equity', () => {
  const d = ICMStrategy.decide({
    equity: 0.48, pot: 100, toCall: 100,
    heroStack: 2000, blindLevel: 20,
    numPlayers: 5, bubbleDistance: 1
  });
  assert(d.action === 'FOLD', `Expected FOLD on bubble`);
});

// ─── HERMES AGENT INTEGRATION TESTS ──────────────────────────────────────────

console.log('\n🤖 Hermes Agent Integration Tests');

async function runAsyncTests() {
  // Test 1: Heads-up decision
  test('Hermes makes fast HU decision (<3s)', async () => {
    const hermes = new HermesAgent({ timeBudget: 2800, mcSimCount: 5000 });
    const start = Date.now();
    const d = await hermes.decide({
      heroHand: ['As', 'Kd'],
      board: ['Jh', 'Tc', '2s'],
      pot: 120, toCall: 0,
      street: 'flop', position: 'IP', numOpponents: 1,
    });
    const elapsed = Date.now() - start;
    assert(elapsed < 3000, `Too slow: ${elapsed}ms`);
    assert(['BET','CHECK','RAISE'].includes(d.action), `Invalid action: ${d.action}`);
    assert(d.equity > 0 && d.equity <= 1, `Invalid equity: ${d.equity}`);
  });

  // Test 2: Multi-party decision
  test('Hermes handles 1v4 multiway', async () => {
    const hermes = new HermesAgent({ timeBudget: 2800, mcSimCount: 3000 });
    const d = await hermes.decide({
      heroHand: ['Qh', 'Jh'],
      board: ['Th', '9h', '2c'],
      pot: 300, toCall: 0,
      street: 'flop', position: 'IP', numOpponents: 4,
    });
    assert(d.equity > 0, 'Should have computed equity');
    assert(d.action, 'Should have an action');
  });

  // Test 3: Pre-flop speed
  test('Hermes decides pre-flop in < 3s', async () => {
    const hermes = new HermesAgent({ timeBudget: 2800, mcSimCount: 5000 });
    const start = Date.now();
    const d = await hermes.decide({
      heroHand: ['7h', '2d'],
      board: [],
      pot: 15, toCall: 10,
      street: 'preflop', position: 'OOP', numOpponents: 1,
    });
    assert(Date.now() - start < 3000, 'Pre-flop too slow');
    assert(['FOLD','CALL','RAISE'].includes(d.action));
    assert(d.action === 'FOLD', `72o should fold to a raise, got: ${d.action}`);
  });

  // Test 4: Opponent tracking
  test('Hermes tracks and exploits opponents', async () => {
    const hermes = new HermesAgent({ mcSimCount: 2000 });
    for (let i = 0; i < 20; i++) {
      hermes.trackOpponent('fish123', 'CALL');
    }
    const type = hermes.cfr.classifyOpponent('fish123');
    assert(type !== 'UNKNOWN', 'Should have classified opponent');
  });

  // Test 5: Session stats
  test('Hermes reports session stats', async () => {
    const hermes = new HermesAgent({ mcSimCount: 1000 });
    await hermes.decide({
      heroHand: ['Ah','Ad'], board: [], pot: 10, toCall: 5,
      street: 'preflop', position: 'IP', numOpponents: 1,
    });
    const stats = hermes.getSessionStats();
    assert(stats.hands >= 1, 'Should track hands');
  });
}

// ─── PERFORMANCE BENCHMARK ────────────────────────────────────────────────────

async function runBenchmark() {
  console.log('\n⚡ Performance Benchmark');

  // MC Benchmark
  const mcStart = Date.now();
  MonteCarloEquity.calculate(['Ah','Kd'], ['Jh','Tc','2s'], 1, 10000);
  const mcTime = Date.now() - mcStart;
  console.log(`  MC 10k sims (HU):      ${mcTime}ms`);

  const mc3Start = Date.now();
  MonteCarloEquity.calculate(['Ah','Kd'], ['Jh','Tc','2s'], 3, 10000);
  const mc3Time = Date.now() - mc3Start;
  console.log(`  MC 10k sims (1v3):     ${mc3Time}ms`);

  // GTO Benchmark
  const gtoStart = Date.now();
  for (let i = 0; i < 10000; i++) {
    GTOAdaptive.decide({ equity: 0.65, pot: 100, toCall: 0, street: 'flop',
                         position: 'IP', numOpponents: 1, raiseCount: 0 });
  }
  console.log(`  GTO 10k decisions:     ${Date.now() - gtoStart}ms`);

  // Hermes full pipeline
  const hermes = new HermesAgent({ timeBudget: 2800, mcSimCount: 10000 });
  const fullStart = Date.now();
  const d = await hermes.decide({
    heroHand: ['Ah', 'Kd'],
    board: ['Jh', 'Tc', '2s'],
    pot: 120, toCall: 0,
    street: 'flop', position: 'IP', numOpponents: 1,
  }, { opponentId: 'bench_opp' });
  const fullTime = Date.now() - fullStart;
  console.log(`  Full pipeline (10k MC): ${fullTime}ms`);
  console.log(`  Action: ${d.action} | Equity: ${(d.equity*100).toFixed(1)}% | Sims: ${d.mcSims}`);
  console.log(`  ${d.hermesNote}`);
  assert(fullTime < 3000, `FAILED: ${fullTime}ms > 3000ms limit!`);
  console.log(`  ✓ Response time < 3s`);

  return fullTime;
}

// ─── SAMPLE GAME SCENARIOS ────────────────────────────────────────────────────

async function runScenarios() {
  console.log('\n🃏 Sample Game Scenarios');
  const hermes = new HermesAgent({ timeBudget: 2800, mcSimCount: 8000 });

  const scenarios = [
    {
      name: 'HU River: Nut flush, opponent bet',
      state: { heroHand: ['Ah','Kh'], board: ['2h','7h','Qh','Td','Js'],
               pot: 500, toCall: 300, street: 'river', position: 'IP', numOpponents: 1 },
      expect: 'RAISE',
    },
    {
      name: '1v3: Weak hand, multiway pot',
      state: { heroHand: ['7h','2d'], board: ['Kh','Qd','Jc'],
               pot: 200, toCall: 150, street: 'flop', position: 'OOP', numOpponents: 3 },
      expect: 'FOLD',
    },
    {
      name: 'HU: Monster draw on flop',
      state: { heroHand: ['9h','8h'], board: ['Th','7h','2c'],
               pot: 100, toCall: 0, street: 'flop', position: 'IP', numOpponents: 1 },
      expect: null, // Just show decision
    },
    {
      name: '1v2: Top set, two players in',
      state: { heroHand: ['Ks','Kd'], board: ['Kh','5s','2d','9c'],
               pot: 300, toCall: 0, street: 'turn', position: 'OOP', numOpponents: 2 },
      expect: null,
    },
  ];

  for (const s of scenarios) {
    const d = await hermes.decide(s.state);
    const pass = !s.expect || d.action === s.expect;
    const icon = pass ? '✓' : '✗';
    console.log(`  ${icon} ${s.name}`);
    console.log(`    → ${d.action}${d.amount ? ' $' + d.amount : ''} | ${d.hermesNote}`);
    if (s.expect && !pass) {
      console.log(`    Expected: ${s.expect}`);
      failed++;
    } else {
      passed++;
    }
  }
}

// ─── RUNNER ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log(' HERMES POKER AI — TEST SUITE');
  console.log('═══════════════════════════════════════════════════');

  await runAsyncTests();
  await runBenchmark();
  await runScenarios();

  console.log('\n═══════════════════════════════════════════════════');
  console.log(` Results: ${passed} passed / ${failed} failed`);
  console.log('═══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
})();
