import { describe, expect, it } from 'vitest';
import {
  MAX_HOLDS,
  payoutForHolds,
  survivedFromRandomness,
} from './tug';

/**
 * Pure state-machine tests mirroring TugGame.sol transitions.
 * These cover the eligibility unit-test requirements for fail / bank / auto-bank
 * without requiring a live chain (the local simulator exercises the real contract).
 */
type State = {
  holdsSurvived: number;
  pendingHold: boolean;
  snapped: boolean;
  banked: boolean;
};

function start(): State {
  return { holdsSurvived: 0, pendingHold: false, snapped: false, banked: false };
}

function requestHold(state: State): State {
  if (state.pendingHold || state.snapped || state.banked) throw new Error('bad');
  if (state.holdsSurvived >= MAX_HOLDS) throw new Error('max');
  return { ...state, pendingHold: true };
}

function resolve(state: State, randomness: bigint): { state: State; payout: bigint; wager: bigint } {
  const wager = 100n * 10n ** 18n;
  if (!state.pendingHold) throw new Error('no pending');
  let next = { ...state, pendingHold: false };
  if (!survivedFromRandomness(randomness)) {
    next = { ...next, snapped: true };
    return { state: next, payout: 0n, wager };
  }
  next = { ...next, holdsSurvived: next.holdsSurvived + 1 };
  if (next.holdsSurvived === MAX_HOLDS) {
    next = { ...next, banked: true };
    return { state: next, payout: payoutForHolds(wager, MAX_HOLDS), wager };
  }
  return { state: next, payout: 0n, wager };
}

function cashOut(state: State, wager: bigint): { state: State; payout: bigint } {
  if (state.holdsSurvived < 1) throw new Error('nothing to bank');
  return {
    state: { ...state, banked: true, pendingHold: false },
    payout: payoutForHolds(wager, state.holdsSurvived),
  };
}

describe('Tug state machine', () => {
  it('fail-path payout is zero', () => {
    let s = start();
    s = requestHold(s);
    // randomness ≡ 4 (mod 5) fails (need < 4)
    const { state, payout } = resolve(s, 4n);
    expect(state.snapped).toBe(true);
    expect(payout).toBe(0n);
  });

  it('bank-path payout matches the table', () => {
    const wager = 100n * 10n ** 18n;
    let s = start();
    // Survive two holds (randomness % 5 < 4)
    for (let i = 0; i < 2; i++) {
      s = requestHold(s);
      const r = resolve(s, BigInt(i)); // 0,1 survive
      s = r.state;
      expect(s.snapped).toBe(false);
    }
    expect(s.holdsSurvived).toBe(2);
    const { payout } = cashOut(s, wager);
    expect(payout).toBe(payoutForHolds(wager, 2));
  });

  it('auto-bank triggers exactly at hold 5', () => {
    let s = start();
    let lastPayout = 0n;
    for (let i = 0; i < 5; i++) {
      s = requestHold(s);
      const r = resolve(s, 0n); // always survive
      s = r.state;
      lastPayout = r.payout;
      if (i < 4) {
        expect(s.banked).toBe(false);
        expect(lastPayout).toBe(0n);
      }
    }
    expect(s.holdsSurvived).toBe(5);
    expect(s.banked).toBe(true);
    expect(lastPayout).toBe(payoutForHolds(100n * 10n ** 18n, 5));
  });
});
