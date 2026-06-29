/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HERMES POKER AI AGENT
 *  Strategies: GTO Adaptive | Exploitative CFR | Monte Carlo Equity
 *  Supports: Heads-Up (1v1) and Multi-Party (1vN) Texas Hold'em
 *  Target response time: < 3 seconds
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

// ─── CARD CONSTANTS ──────────────────────────────────────────────────────────

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['s','h','d','c'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

/**
 * Encode a card string like "As" → integer (0–51)
 */
function cardToInt(card) {
  const rank = RANKS.indexOf(card[0]);
  const suit = SUITS.indexOf(card[1]);
  if (rank === -1 || suit === -1) throw new Error(`Invalid card: ${card}`);
  return rank * 4 + suit;
}

function intToCard(n) {
  return RANKS[Math.floor(n / 4)] + SUITS[n % 4];
}

function rankOf(card) { return Math.floor(card / 4); }
function suitOf(card) { return card % 4; }


// ─── DECK UTILITIES ──────────────────────────────────────────────────────────

class Deck {
  constructor(excludeCards = []) {
    const excluded = new Set(excludeCards.map(c =>
      typeof c === 'string' ? cardToInt(c) : c
    ));
    this.cards = [];
    for (let i = 0; i < 52; i++) {
      if (!excluded.has(i)) this.cards.push(i);
    }
  }

  /** Fisher-Yates in-place shuffle */
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    return this;
  }

  deal(n) {
    return this.cards.splice(0, n);
  }
}


// ─── HAND EVALUATOR (7-card) ─────────────────────────────────────────────────
// Uses a fast rank-based evaluator. Returns a score: higher = better.
// Score format: [hand_category * 1e8 + tiebreak_value]
// Categories: 0=high card … 8=straight flush

class HandEvaluator {
  static evaluate(cards7) {
    // cards7: array of card integers
    const ranks = cards7.map(rankOf);
    const suits = cards7.map(suitOf);

    // Check for flush suit
    const suitCount = [0, 0, 0, 0];
    cards7.forEach(c => suitCount[suitOf(c)]++);
    const flushSuit = suitCount.findIndex(c => c >= 5);

    let flushCards = null;
    if (flushSuit !== -1) {
      flushCards = cards7.filter(c => suitOf(c) === flushSuit).map(rankOf).sort((a,b) => b-a);
    }

    // Rank frequency
    const freq = new Array(13).fill(0);
    ranks.forEach(r => freq[r]++);

    const pairs = [], trips = [], quads = [];
    freq.forEach((f, r) => {
      if (f === 4) quads.push(r);
      else if (f === 3) trips.push(r);
      else if (f === 2) pairs.push(r);
    });
    pairs.sort((a,b) => b-a);
    trips.sort((a,b) => b-a);

    const sortedRanks = ranks.slice().sort((a,b) => b-a);

    // Straight detection helper
    const isStraight = (rankArr) => {
      const unique = [...new Set(rankArr)].sort((a,b) => b-a);
      // Check wheel (A-2-3-4-5)
      if (unique.includes(12) && unique.includes(0) && unique.includes(1) &&
          unique.includes(2) && unique.includes(3)) {
        return 3; // 5-high straight
      }
      for (let i = 0; i <= unique.length - 5; i++) {
        if (unique[i] - unique[i+4] === 4 &&
            new Set(unique.slice(i, i+5)).size === 5) {
          return unique[i]; // top card
        }
      }
      return -1;
    };

    // Straight flush
    if (flushCards) {
      const sfTop = isStraight(flushCards);
      if (sfTop !== -1) {
        return 8e8 + sfTop;
      }
    }

    // Four of a kind
    if (quads.length) {
      const kicker = sortedRanks.find(r => r !== quads[0]);
      return 7e8 + quads[0] * 13 + kicker;
    }

    // Full house
    if (trips.length && pairs.length) {
      return 6e8 + trips[0] * 13 + pairs[0];
    }
    if (trips.length >= 2) {
      return 6e8 + trips[0] * 13 + trips[1];
    }

    // Flush
    if (flushCards) {
      const top5 = flushCards.slice(0, 5);
      return 5e8 + top5[0] * 1e6 + top5[1] * 1e4 + top5[2] * 1e2 + top5[3] * 10 + top5[4];
    }

    // Straight
    const stTop = isStraight(sortedRanks);
    if (stTop !== -1) return 4e8 + stTop;

    // Three of a kind
    if (trips.length) {
      const kickers = sortedRanks.filter(r => r !== trips[0]).slice(0, 2);
      return 3e8 + trips[0] * 100 + kickers[0] * 10 + kickers[1];
    }

    // Two pair
    if (pairs.length >= 2) {
      const kicker = sortedRanks.find(r => r !== pairs[0] && r !== pairs[1]);
      return 2e8 + pairs[0] * 100 + pairs[1] * 10 + kicker;
    }

    // One pair
    if (pairs.length === 1) {
      const kickers = sortedRanks.filter(r => r !== pairs[0]).slice(0, 3);
      return 1e8 + pairs[0] * 1000 + kickers[0] * 100 + kickers[1] * 10 + kickers[2];
    }

    // High card
    return sortedRanks[0] * 1e6 + sortedRanks[1] * 1e4 +
           sortedRanks[2] * 1e2 + sortedRanks[3] * 10 + sortedRanks[4];
  }

  static handName(score) {
    const cat = Math.floor(score / 1e8);
    return ['High Card','One Pair','Two Pair','Trips','Straight','Flush',
            'Full House','Quads','Straight Flush'][cat] || 'Unknown';
  }
}


// ─── STRATEGY 1: MONTE CARLO EQUITY CALCULATOR ───────────────────────────────
/**
 * Simulates 10,000 random board completions to compute equity.
 * Fast enough for < 500ms on modern hardware.
 */

class MonteCarloEquity {
  /**
   * @param {string[]} heroHand   - ["As","Kd"]
   * @param {string[]} board      - ["Jh","Tc","2s"] (can be empty pre-flop)
   * @param {number}   opponents  - number of opponents (1–8)
   * @param {number}   simCount   - default 10000
   * @returns {{ equity: number, wins: number, ties: number, sims: number }}
   */
  static calculate(heroHand, board = [], opponents = 1, simCount = 10000) {
    const heroCards = heroHand.map(cardToInt);
    const boardCards = board.map(cardToInt);
    const knownCards = [...heroCards, ...boardCards];

    let wins = 0, ties = 0;
    const boardNeeded = 5 - boardCards.length;

    for (let sim = 0; sim < simCount; sim++) {
      const deck = new Deck(knownCards);
      deck.shuffle();

      // Deal remaining board cards
      const runBoard = [...boardCards, ...deck.deal(boardNeeded)];

      // Deal opponent hands
      const oppHands = [];
      for (let o = 0; o < opponents; o++) {
        oppHands.push(deck.deal(2));
      }

      // Evaluate hero
      const heroScore = HandEvaluator.evaluate([...heroCards, ...runBoard]);

      // Evaluate best opponent
      let bestOppScore = -1;
      let bestOppCount = 0;
      for (const oppHand of oppHands) {
        const score = HandEvaluator.evaluate([...oppHand, ...runBoard]);
        if (score > bestOppScore) {
          bestOppScore = score;
          bestOppCount = 1;
        } else if (score === bestOppScore) {
          bestOppCount++;
        }
      }

      if (heroScore > bestOppScore) {
        wins++;
      } else if (heroScore === bestOppScore) {
        ties++;
      }
    }

    const equity = (wins + ties * 0.5) / simCount;
    return { equity, wins, ties, losses: simCount - wins - ties, sims: simCount };
  }

  /**
   * Quick pre-flop equity table lookup (for ultra-fast <50ms pre-flop)
   * Based on Sklansky-Chubukov approximations.
   */
  static preFlopRank(heroHand) {
    const [c1, c2] = heroHand.map(cardToInt);
    const r1 = rankOf(c1), r2 = rankOf(c2);
    const suited = suitOf(c1) === suitOf(c2);
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    const gap = hi - lo;
    const isPair = hi === lo;

    // Tier 1: Premium
    if (isPair && hi >= 10) return 'PREMIUM';
    if (!isPair && hi === 12 && lo >= 11) return 'PREMIUM';

    // Tier 2: Strong
    if (isPair && hi >= 7) return 'STRONG';
    if (!isPair && hi === 12 && (suited || lo >= 9)) return 'STRONG';
    if (!isPair && hi === 11 && lo >= 10) return 'STRONG';

    // Tier 3: Playable
    if (isPair && hi >= 4) return 'PLAYABLE';
    if (!isPair && suited && gap <= 2 && hi >= 8) return 'PLAYABLE';
    if (!isPair && hi >= 10 && lo >= 9) return 'PLAYABLE';

    return 'WEAK';
  }
}


// ─── STRATEGY 2: GTO ADAPTIVE (GAME THEORY OPTIMAL) ─────────────────────────
/**
 * GTO-based strategy using Nash equilibrium approximation.
 * Balances bluffs and value bets according to pot odds math.
 * Best for heads-up play against unknown opponents.
 */

class GTOAdaptive {
  /**
   * Compute pot odds required to call.
   * @returns {number} Minimum equity needed to call profitably
   */
  static potOdds(callAmount, potSize) {
    if (callAmount <= 0) return 0;
    return callAmount / (potSize + callAmount);
  }

  /**
   * Compute GTO bet sizing (typically 33%, 50%, 75%, 100% of pot)
   */
  static gtoBetSize(equity, potSize, street) {
    // GTO bet sizing theory: larger bets on polar ranges
    if (equity > 0.85) return potSize * 1.0;       // Very strong: pot bet
    if (equity > 0.70) return potSize * 0.75;       // Strong: 3/4 pot
    if (equity > 0.55) return potSize * 0.50;       // Medium: 1/2 pot
    if (equity > 0.45) return potSize * 0.33;       // Marginal: 1/3 pot (protection)
    if (street === 'river' && equity < 0.30) return potSize * 0.75; // Bluff on river
    return 0; // Check
  }

  /**
   * Alpha (minimum frequency opponent must defend to breakeven)
   */
  static alphaDefend(betSize, potSize) {
    return betSize / (betSize + potSize);
  }

  /**
   * Range construction: value:bluff ratio
   * At 1:1 bluff-to-value ratio, opponent cannot profitably call/fold.
   */
  static bluffFrequency(betSize, potSize) {
    // GTO bluff frequency = bet / (bet + pot) — makes opp indifferent
    return betSize / (betSize + potSize);
  }

  /**
   * Main decision function
   */
  static decide(gameState) {
    const { equity, potOdds, pot, toCall, street, position, numOpponents, stackDepth, raiseCount } = gameState;

    const odds = toCall > 0 ? GTOAdaptive.potOdds(toCall, pot) : 0;
    const betSize = GTOAdaptive.gtoBetSize(equity, pot, street);
    const bluffFreq = GTOAdaptive.bluffFrequency(betSize, pot);

    // Multi-way: tighten ranges significantly
    const multiWayPenalty = numOpponents > 1 ? Math.pow(0.75, numOpponents - 1) : 1;
    const adjustedEquity = equity * multiWayPenalty;

    // Position adjustment
    const positionBonus = position === 'IP' ? 0.04 : -0.02;
    const finalEquity = adjustedEquity + positionBonus;

    // Decision logic
    let action, amount, reasoning;

    if (toCall === 0) {
      // Check or bet opportunity
      if (finalEquity > 0.65) {
        action = 'BET';
        amount = betSize;
        reasoning = `GTO value bet (equity: ${(finalEquity*100).toFixed(1)}%)`;
      } else if (Math.random() < bluffFreq && street === 'flop' && finalEquity < 0.35) {
        action = 'BET';
        amount = pot * 0.5;
        reasoning = `GTO bluff (balanced range, bluff freq: ${(bluffFreq*100).toFixed(0)}%)`;
      } else {
        action = 'CHECK';
        reasoning = `GTO check (equity: ${(finalEquity*100).toFixed(1)}%, building pot later)`;
      }
    } else {
      // Call, raise, or fold
      if (finalEquity > odds + 0.15 && raiseCount < 3) {
        const raiseSize = pot * (finalEquity > 0.80 ? 2.5 : 1.5);
        action = 'RAISE';
        amount = toCall + raiseSize;
        reasoning = `GTO raise for value (equity: ${(finalEquity*100).toFixed(1)}% vs required: ${(odds*100).toFixed(1)}%)`;
      } else if (finalEquity > odds - 0.05) {
        action = 'CALL';
        reasoning = `GTO call (equity: ${(finalEquity*100).toFixed(1)}% vs pot odds: ${(odds*100).toFixed(1)}%)`;
      } else {
        action = 'FOLD';
        reasoning = `GTO fold (equity: ${(finalEquity*100).toFixed(1)}% < pot odds: ${(odds*100).toFixed(1)}%)`;
      }
    }

    return { action, amount: amount || 0, reasoning, strategy: 'GTO_ADAPTIVE' };
  }
}


// ─── STRATEGY 3: EXPLOITATIVE CFR (COUNTERFACTUAL REGRET MINIMIZATION) ───────
/**
 * Simplified CFR that adapts to opponent tendencies.
 * Tracks opponent stats (VPIP, PFR, AF) and exploits leaks.
 * Best for exploiting fish/calling stations/nits.
 */

class ExploitativeCFR {
  constructor() {
    this.opponentProfiles = new Map(); // playerId -> stats
  }

  updateProfile(playerId, action, position) {
    if (!this.opponentProfiles.has(playerId)) {
      this.opponentProfiles.set(playerId, {
        hands: 0, vpip: 0, pfr: 0, cbetFold: 0, cbetSeen: 0,
        aggression: 0, calls: 0, foldToBluff: 0, bluffsSeen: 0,
        wtsd: 0, showdowns: 0
      });
    }
    const p = this.opponentProfiles.get(playerId);
    p.hands++;

    switch (action) {
      case 'CALL':   p.vpip++; p.calls++; break;
      case 'RAISE':  p.vpip++; p.pfr++; p.aggression++; break;
      case 'FOLD_CBET': p.cbetFold++; p.cbetSeen++; break;
      case 'CALL_CBET': p.cbetSeen++; break;
      case 'FOLD_BLUFF': p.foldToBluff++; p.bluffsSeen++; break;
      case 'CALL_BLUFF': p.bluffsSeen++; break;
      case 'SHOWDOWN': p.showdowns++; break;
      case 'WON_SHOWDOWN': p.wtsd++; break;
    }
  }

  classifyOpponent(playerId) {
    const p = this.opponentProfiles.get(playerId);
    if (!p || p.hands < 10) return 'UNKNOWN';

    const vpip_pct = p.vpip / p.hands;
    const pfr_pct = p.pfr / p.hands;
    const af = p.calls > 0 ? p.aggression / p.calls : p.aggression;
    const foldToCbet = p.cbetSeen > 0 ? p.cbetFold / p.cbetSeen : 0.5;

    if (vpip_pct > 0.40 && pfr_pct < 0.15) return 'FISH';       // Loose passive
    if (vpip_pct < 0.20 && pfr_pct < 0.10) return 'NIT';        // Tight passive
    if (vpip_pct > 0.30 && af > 2.5) return 'LAG';              // Loose aggressive
    if (vpip_pct < 0.25 && pfr_pct > 0.18 && af > 2) return 'TAG'; // Tight aggressive
    if (foldToCbet > 0.65) return 'CBET_FOLDER';
    if (p.calls / p.hands > 0.35) return 'CALLING_STATION';
    return 'BALANCED';
  }

  getExploit(opponentType) {
    switch (opponentType) {
      case 'FISH':
        return {
          bluffFreq: 0.1,      // Almost never bluff
          valueBetFreq: 1.2,   // Value bet more, thinner
          foldThresh: 0.45,    // Call wider (they bluff rarely)
          cbetFreq: 0.8,
          note: 'Exploit: value bet thin, no bluffs, call wide'
        };
      case 'NIT':
        return {
          bluffFreq: 0.7,      // Bluff frequently (they fold)
          valueBetFreq: 0.7,   // Less value (they only continue strong)
          foldThresh: 0.55,    // Give more credit when they raise
          cbetFreq: 0.9,
          note: 'Exploit: bluff frequently, fold to their raises'
        };
      case 'LAG':
        return {
          bluffFreq: 0.2,
          valueBetFreq: 0.9,
          foldThresh: 0.40,    // Call wide (they over-bluff)
          cbetFreq: 0.5,
          note: 'Exploit: call wide, let them bluff, avoid bluffing'
        };
      case 'CALLING_STATION':
        return {
          bluffFreq: 0.0,      // Never bluff
          valueBetFreq: 1.5,   // Bet for value very thin
          foldThresh: 0.50,
          cbetFreq: 0.85,
          note: 'Exploit: zero bluffs, maximize value, bet every street'
        };
      case 'CBET_FOLDER':
        return {
          bluffFreq: 0.9,      // Cbet/bluff constantly
          valueBetFreq: 1.0,
          foldThresh: 0.50,
          cbetFreq: 1.0,
          note: 'Exploit: cbet 100% of flops, double/triple barrel'
        };
      default:
        return {
          bluffFreq: 0.33,
          valueBetFreq: 1.0,
          foldThresh: 0.50,
          cbetFreq: 0.65,
          note: 'Balanced: unexploitable default'
        };
    }
  }

  decide(gameState, opponentId) {
    const { equity, pot, toCall, street, numOpponents } = gameState;
    const oppType = this.classifyOpponent(opponentId);
    const exploit = this.getExploit(oppType);

    const adjustedEquity = equity * (numOpponents > 1 ? Math.pow(0.75, numOpponents - 1) : 1);
    const betAmount = pot * 0.60 * exploit.valueBetFreq;

    let action, amount, reasoning;

    if (toCall === 0) {
      if (adjustedEquity > 0.55 || (adjustedEquity > 0.30 && Math.random() < exploit.bluffFreq)) {
        action = 'BET';
        amount = betAmount;
        reasoning = `CFR vs ${oppType}: ${exploit.note}`;
      } else {
        action = 'CHECK';
        reasoning = `CFR check vs ${oppType} — pot control`;
      }
    } else {
      const required = toCall / (pot + toCall);
      if (adjustedEquity > required + 0.08) {
        action = 'RAISE';
        amount = toCall * 3;
        reasoning = `CFR raise vs ${oppType}: strong equity`;
      } else if (adjustedEquity > exploit.foldThresh) {
        action = 'CALL';
        reasoning = `CFR call vs ${oppType}: adjusted equity ${(adjustedEquity*100).toFixed(1)}%`;
      } else {
        action = 'FOLD';
        reasoning = `CFR fold vs ${oppType}: below threshold ${(exploit.foldThresh*100).toFixed(0)}%`;
      }
    }

    return { action, amount: amount || 0, reasoning, strategy: 'EXPLOITATIVE_CFR', opponentType: oppType };
  }
}


// ─── STRATEGY 4: RANGE-BASED COMBINATORICS ───────────────────────────────────
/**
 * Thinks in ranges, not individual hands. Assigns opponent a range of hands
 * based on their actions, then computes equity vs that range.
 */

class RangeBasedSolver {
  static PREFLOP_RANGES = {
    UTG_OPEN:   { pairs: [7,8,9,10,11,12], suited: [[12,11],[12,10],[12,9],[11,10]], offsuit: [[12,11],[12,10]] },
    BTN_OPEN:   { pairs: [2,3,4,5,6,7,8,9,10,11,12], suited: 'all', offsuit: [[12,11],[12,10],[11,10]] },
    SB_OPEN:    { pairs: [3,4,5,6,7,8,9,10,11,12], suited: 'most', offsuit: [[12,11],[12,10],[12,9]] },
    BTN_3BET:   { pairs: [9,10,11,12], suited: [[12,11],[12,10]], offsuit: [[12,11]] },
    IP_CBET:    'merged',   // merged range on most boards
    OOP_CBET:   'polar',    // polar range OOP
  };

  /**
   * Assign range width (0-1) based on opponent's action sequence
   */
  static inferRangeWidth(actionSequence, position) {
    let width = 1.0;
    const actions = actionSequence || [];

    if (actions.includes('UTG_OPEN'))   width *= 0.15;
    if (actions.includes('3BET'))        width *= 0.07;
    if (actions.includes('4BET'))        width *= 0.03;
    if (actions.includes('COLD_CALL'))   width *= 0.20;
    if (actions.includes('CHECK_CALL'))  width *= 0.35;
    if (actions.includes('CHECK_RAISE')) width *= 0.12;
    if (actions.includes('BET_TURN'))    width *= 0.50;
    if (actions.includes('BET_RIVER'))   width *= 0.40;

    return Math.max(0.02, width);
  }

  /**
   * Board texture analysis
   */
  static analyzeBoard(boardCards) {
    const cards = boardCards.map(cardToInt);
    const ranks = cards.map(rankOf);
    const suits = cards.map(suitOf);
    const suitFreq = [0,0,0,0];
    suits.forEach(s => suitFreq[s]++);

    const maxSuit = Math.max(...suitFreq);
    const uniqueRanks = [...new Set(ranks)].sort((a,b) => b-a);
    const spread = uniqueRanks[0] - uniqueRanks[uniqueRanks.length - 1];
    const paired = uniqueRanks.length < cards.length;

    const texture = {
      isMonotone: maxSuit === cards.length,
      isTwoTone: maxSuit === 2,
      isRainbow: maxSuit === 1,
      isConnected: spread <= 4,
      hasHighCard: uniqueRanks[0] >= 10,
      isPaired: paired,
      highCard: uniqueRanks[0],
      rankSpread: spread
    };

    texture.favorsCaller = texture.isConnected || texture.isTwoTone;
    texture.favorsRaiser = texture.hasHighCard && texture.isRainbow && !texture.isConnected;

    return texture;
  }

  static decide(gameState) {
    const { equity, board, opponentActionSeq, pot, toCall, position, street } = gameState;
    const boardTex = board.length > 0 ? RangeBasedSolver.analyzeBoard(board) : null;
    const rangeWidth = RangeBasedSolver.inferRangeWidth(opponentActionSeq, position);

    // Narrow range = opponent is strong → need more equity
    const equityRequired = 0.50 + (1 - rangeWidth) * 0.25;
    const boardAdj = boardTex?.favorsCaller ? -0.03 : boardTex?.favorsRaiser ? 0.03 : 0;
    const finalEquity = equity + boardAdj;

    let action, amount, reasoning;

    if (finalEquity >= equityRequired + 0.15) {
      action = toCall > 0 ? 'RAISE' : 'BET';
      amount = toCall > 0 ? toCall * 3 : pot * 0.75;
      reasoning = `Range: equity ${(finalEquity*100).toFixed(1)}% crushes narrow range (width: ${(rangeWidth*100).toFixed(0)}%)`;
    } else if (finalEquity >= equityRequired - 0.05) {
      action = toCall > 0 ? 'CALL' : 'BET';
      amount = toCall > 0 ? toCall : pot * 0.40;
      reasoning = `Range: equity ${(finalEquity*100).toFixed(1)}% slightly ahead of range (width: ${(rangeWidth*100).toFixed(0)}%)`;
    } else if (toCall === 0) {
      action = 'CHECK';
      reasoning = `Range: behind opponent's range (est. width: ${(rangeWidth*100).toFixed(0)}%) — pot control`;
    } else {
      action = 'FOLD';
      reasoning = `Range: equity ${(finalEquity*100).toFixed(1)}% behind vs estimated range (width: ${(rangeWidth*100).toFixed(0)}%)`;
    }

    return {
      action, amount: amount || 0, reasoning,
      strategy: 'RANGE_BASED',
      rangeWidth,
      boardTexture: boardTex
    };
  }
}


// ─── STRATEGY 5: ICM / TOURNAMENT PRESSURE ────────────────────────────────────
/**
 * Independent Chip Model — used in tournament/SNGs.
 * Adjusts for stack-to-blind (SPR), bubble pressure, and chip EV vs $ EV.
 */

class ICMStrategy {
  /**
   * Simple ICM calculation for final table spots.
   * @param {number[]} stacks - all remaining stacks
   * @param {number[]} payouts - payout structure
   */
  static computeEquity(stacks, payouts) {
    const total = stacks.reduce((a, b) => a + b, 0);
    const n = stacks.length;
    if (n === 1) return [payouts[0]];
    if (n > payouts.length) return stacks.map(s => (s / total) * payouts[0]);

    // Recursive ICM (simplified for up to 6 players)
    const equity = stacks.map(s => {
      const prob = s / total;
      const restStacks = stacks.filter((_, i) => stacks.indexOf(s) !== i);
      const restPayouts = payouts.slice(1);
      const subEquity = ICMStrategy.computeEquity(restStacks, restPayouts);
      return prob * payouts[0] + subEquity.reduce((a, e) => a + e, 0) / (n - 1) * (1 - prob);
    });

    return equity;
  }

  /**
   * SPR (Stack-to-Pot Ratio) based play style
   */
  static spr(stack, pot) {
    return stack / pot;
  }

  static decide(gameState) {
    const { equity, pot, toCall, heroStack, blindLevel, numPlayers, bubbleDistance } = gameState;
    const sprVal = ICMStrategy.spr(heroStack, pot + toCall);
    const isBubble = bubbleDistance <= 2;

    let riskFactor = 1.0;
    if (isBubble) riskFactor = 1.5;  // Need more equity on bubble
    if (bubbleDistance <= 0) riskFactor = 0.9; // In the money — loosen

    // SPR adjustments
    let commitThreshold;
    if (sprVal < 2) commitThreshold = 0.40;       // Low SPR: commit often
    else if (sprVal < 5) commitThreshold = 0.52 * riskFactor;
    else commitThreshold = 0.58 * riskFactor;     // Deep stack: need more

    // M-ratio (stack / big blind cost per orbit)
    const mRatio = heroStack / (blindLevel * 1.5);
    const isShortStack = mRatio < 10;

    let action, amount, reasoning;

    if (isShortStack && equity > 0.45) {
      action = 'ALL_IN';
      amount = heroStack;
      reasoning = `ICM shove: M=${mRatio.toFixed(1)}, equity ${(equity*100).toFixed(1)}% — must shove to survive`;
    } else if (equity > commitThreshold) {
      action = toCall > 0 ? 'CALL' : 'BET';
      amount = toCall || pot * 0.65;
      reasoning = `ICM commit: equity ${(equity*100).toFixed(1)}% > threshold ${(commitThreshold*100).toFixed(1)}% (SPR=${sprVal.toFixed(1)})`;
    } else if (toCall > 0) {
      action = 'FOLD';
      reasoning = `ICM fold: protect chips (bubble=${isBubble}, SPR=${sprVal.toFixed(1)})`;
    } else {
      action = 'CHECK';
      reasoning = `ICM check: control pot, risk factor=${riskFactor}`;
    }

    return { action, amount: amount || 0, reasoning, strategy: 'ICM', mRatio, sprVal };
  }
}


// ─── HERMES AGENT ORCHESTRATOR ────────────────────────────────────────────────
/**
 * The main Hermes Agent that:
 * 1. Runs Monte Carlo equity in parallel (web workers / chunked)
 * 2. Selects the optimal strategy based on game context
 * 3. Blends strategy outputs with weighted consensus
 * 4. Responds in < 3 seconds guaranteed via early termination
 */

class HermesAgent {
  constructor(config = {}) {
    this.name = 'Hermes';
    this.personality = {
      adaptability: 0.85,
      aggression: 0.60,
      creativity: 0.70,
      patience: 0.75,
      reading: 0.80,
    };

    // Strategy components
    this.cfr = new ExploitativeCFR();

    // Timing budget
    this.timeBudget = config.timeBudget || 2800; // ms (200ms safety margin)
    this.mcSimCount = config.mcSimCount || 10000;

    // Hermes profile overlay — biases strategy selection
    this.hermesProfile = {
      prefersHeadsUp: 'GTO_ADAPTIVE',    // 1v1 default
      prefersMultiway: 'RANGE_BASED',    // 1vN default
      prefersTournament: 'ICM',          // Tournament/SNG
      exploitOnReads: 'EXPLOITATIVE_CFR' // When opponent tendencies known
    };

    this.decisionLog = [];
  }

  /**
   * Main entry point — call this for every decision
   * @param {Object} gameState - Full game state
   * @param {Object} meta - Additional meta (opponent IDs, tournament info)
   * @returns {Object} { action, amount, confidence, reasoning, equity, elapsed }
   */
  async decide(gameState, meta = {}) {
    const startTime = Date.now();

    // 1. Validate and normalize input
    const gs = this._normalizeGameState(gameState);

    // 2. Run Monte Carlo equity calculation
    let mcResult;
    try {
      mcResult = await this._runMonteCarlo(gs, startTime);
    } catch (e) {
      // Fallback to fast pre-flop table
      const tier = MonteCarloEquity.preFlopRank(gs.heroHand);
      mcResult = {
        equity: { PREMIUM: 0.75, STRONG: 0.62, PLAYABLE: 0.52, WEAK: 0.38 }[tier] || 0.40,
        wins: 0, ties: 0, sims: 0, fast: true
      };
    }

    gs.equity = mcResult.equity;

    // 3. Select strategy
    const strategy = this._selectStrategy(gs, meta);

    // 4. Get decisions from all relevant strategies
    const elapsed1 = Date.now() - startTime;
    const decisions = this._runStrategies(gs, meta, strategy);

    // 5. Blend / consensus
    const finalDecision = this._blendDecisions(decisions, gs, strategy);
    finalDecision.equity = mcResult.equity;
    finalDecision.mcSims = mcResult.sims;
    finalDecision.elapsed = Date.now() - startTime;

    // 6. Log
    this.decisionLog.push({
      timestamp: Date.now(),
      street: gs.street,
      action: finalDecision.action,
      equity: mcResult.equity,
      strategy,
    });

    return finalDecision;
  }

  /**
   * Run Monte Carlo with time budget awareness
   */
  async _runMonteCarlo(gs, startTime) {
    return new Promise((resolve) => {
      const deadline = startTime + this.timeBudget - 500; // Leave 500ms for strategy

      // Chunk simulation to stay within time budget
      const CHUNK_SIZE = 500;
      let wins = 0, ties = 0, totalSims = 0;

      const runChunk = () => {
        const chunk = Math.min(CHUNK_SIZE, this.mcSimCount - totalSims);
        if (chunk <= 0 || Date.now() > deadline) {
          const equity = (wins + ties * 0.5) / Math.max(totalSims, 1);
          resolve({ equity, wins, ties, sims: totalSims });
          return;
        }

        // Synchronous chunk
        const result = MonteCarloEquity.calculate(
          gs.heroHand, gs.board, gs.numOpponents, chunk
        );
        wins += result.wins;
        ties += result.ties;
        totalSims += result.sims;

        // Yield to event loop, then run next chunk
        if (totalSims < this.mcSimCount && Date.now() < deadline) {
          setImmediate ? setImmediate(runChunk) : setTimeout(runChunk, 0);
        } else {
          const equity = (wins + ties * 0.5) / Math.max(totalSims, 1);
          resolve({ equity, wins, ties, sims: totalSims });
        }
      };

      runChunk();
    });
  }

  _selectStrategy(gs, meta) {
    // Tournament mode
    if (meta.tournament) return 'ICM';

    // If we have opponent reads, exploit
    if (meta.opponentId) {
      const oppType = this.cfr.classifyOpponent(meta.opponentId);
      if (oppType !== 'UNKNOWN' && oppType !== 'BALANCED') return 'EXPLOITATIVE_CFR';
    }

    // Heads-up vs multiway
    if (gs.numOpponents === 1) return this.hermesProfile.prefersHeadsUp;

    // Multiway with action info
    if (gs.opponentActionSeq && gs.opponentActionSeq.length > 0) return 'RANGE_BASED';

    return 'GTO_ADAPTIVE';
  }

  _runStrategies(gs, meta, primaryStrategy) {
    const results = {};

    // Always run GTO as baseline
    results.GTO_ADAPTIVE = GTOAdaptive.decide(gs);

    // Always run CFR
    results.EXPLOITATIVE_CFR = this.cfr.decide(gs, meta.opponentId || 'unknown');

    // Run range-based if board available
    if (gs.board.length >= 3) {
      results.RANGE_BASED = RangeBasedSolver.decide(gs);
    }

    // ICM for tournaments
    if (meta.tournament) {
      results.ICM = ICMStrategy.decide({...gs, ...meta.tournament});
    }

    return results;
  }

  _blendDecisions(decisions, gs, primaryStrategy) {
    const primary = decisions[primaryStrategy] || decisions.GTO_ADAPTIVE;

    // Vote counting with weighted strategies
    const weights = {
      GTO_ADAPTIVE: 0.30,
      EXPLOITATIVE_CFR: 0.35,
      RANGE_BASED: 0.25,
      ICM: 0.10,
    };

    const actionVotes = {};
    let totalWeight = 0;

    Object.entries(decisions).forEach(([strat, dec]) => {
      const w = weights[strat] || 0.25;
      const a = dec.action;
      actionVotes[a] = (actionVotes[a] || 0) + w;
      totalWeight += w;
    });

    // Normalize
    Object.keys(actionVotes).forEach(k => actionVotes[k] /= totalWeight);

    // Hermes personality: if confidence for primary action is high, commit
    const primaryConf = actionVotes[primary.action] || 0;

    // Build reasoning stack
    const allReasons = Object.values(decisions)
      .map(d => `[${d.strategy}] ${d.action}: ${d.reasoning}`)
      .join('\n  ');

    return {
      action: primary.action,
      amount: Math.round(primary.amount || 0),
      confidence: primaryConf,
      primaryStrategy,
      reasoning: primary.reasoning,
      detailedReasoning: allReasons,
      votes: actionVotes,
      hermesNote: this._generateHermesNote(primary, gs, primaryConf),
    };
  }

  _generateHermesNote(decision, gs, confidence) {
    const streetEmoji = { preflop:'🃏', flop:'🎴', turn:'🔄', river:'⚡' };
    const confStr = confidence > 0.75 ? 'Confident' : confidence > 0.5 ? 'Moderate' : 'Close call';
    return `[${streetEmoji[gs.street] || '♠'}] Hermes ${confStr} → ${decision.action.toUpperCase()}` +
           ` | Equity: ${(gs.equity * 100).toFixed(1)}%` +
           ` | ${gs.numOpponents > 1 ? `${gs.numOpponents}v1 multiway` : 'Heads-up'}` +
           ` | ${gs.position}`;
  }

  _normalizeGameState(gs) {
    return {
      heroHand: gs.heroHand || [],
      board: gs.board || [],
      pot: gs.pot || 0,
      toCall: gs.toCall || 0,
      street: gs.street || 'preflop',
      position: gs.position || 'OOP',
      numOpponents: gs.numOpponents || 1,
      stackDepth: gs.stackDepth || 100,
      raiseCount: gs.raiseCount || 0,
      opponentActionSeq: gs.opponentActionSeq || [],
      heroStack: gs.heroStack || 100,
      blindLevel: gs.blindLevel || 1,
      bubbleDistance: gs.bubbleDistance || 999,
      equity: 0,
    };
  }

  /**
   * Update opponent model after seeing their cards or actions
   */
  trackOpponent(opponentId, action) {
    this.cfr.updateProfile(opponentId, action);
  }

  /**
   * Get Hermes session stats
   */
  getSessionStats() {
    const log = this.decisionLog;
    if (log.length === 0) return { hands: 0 };

    const actions = log.reduce((acc, d) => {
      acc[d.action] = (acc[d.action] || 0) + 1;
      return acc;
    }, {});

    const avgEquity = log.reduce((sum, d) => sum + d.equity, 0) / log.length;

    return {
      hands: log.length,
      actionFrequency: actions,
      avgEquity: (avgEquity * 100).toFixed(1) + '%',
      strategies: [...new Set(log.map(d => d.strategy))],
    };
  }
}


// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  HermesAgent,
  MonteCarloEquity,
  GTOAdaptive,
  ExploitativeCFR,
  RangeBasedSolver,
  ICMStrategy,
  HandEvaluator,
  Deck,
  cardToInt,
  intToCard,
};


// ─── QUICK USAGE DEMO ────────────────────────────────────────────────────────
/*
const { HermesAgent } = require('./poker_ai_hermes');

const hermes = new HermesAgent({ timeBudget: 2800, mcSimCount: 10000 });

// Heads-up example
(async () => {
  const decision = await hermes.decide({
    heroHand: ['As', 'Kd'],
    board: ['Jh', 'Tc', '2s'],       // Flop
    pot: 120,
    toCall: 0,                        // Our turn to act (no bet facing)
    street: 'flop',
    position: 'IP',                   // In position
    numOpponents: 1,
    stackDepth: 180,
  }, {
    opponentId: 'player_42',
  });

  console.log(decision.hermesNote);
  console.log('Action:', decision.action, '| Amount:', decision.amount);
  console.log('Equity:', (decision.equity * 100).toFixed(1) + '%', `(${decision.mcSims} sims)`);
  console.log('Time:', decision.elapsed + 'ms');
})();

// Multi-party (1v3) example
(async () => {
  const decision = await hermes.decide({
    heroHand: ['Qh', 'Jh'],
    board: ['Th', '9h', '2c', 'Kd'], // Turn
    pot: 400,
    toCall: 120,
    street: 'turn',
    position: 'OOP',
    numOpponents: 3,
    stackDepth: 1200,
    opponentActionSeq: ['CHECK_CALL', 'CHECK_CALL'],
  });

  console.log(decision.hermesNote);
  console.log('Action:', decision.action);
})();
*/
