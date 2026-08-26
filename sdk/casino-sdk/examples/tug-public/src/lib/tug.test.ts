import { describe, expect, it } from 'vitest';
import {
  MAX_HOLDS,
  MULTIPLIER_TABLE,
  RTP,
  RTP_WAD,
  WAD,
  maxPayoutForWager,
  multiplierWad,
  pPowWad,
  payoutForHolds,
  rtpProductWad,
  survivedFromRandomness,
} from './tug';

describe('Tug RTP invariant', () => {
  it('p^N * mult(N) == RTP for every N = 1..5 (exact WAD)', () => {
    for (let n = 1; n <= MAX_HOLDS; n++) {
      expect(rtpProductWad(n)).toBe(RTP_WAD);
    }
  });

  it('declared display multipliers match RTP / p^N within jam table rounding', () => {
    for (let n = 1; n <= MAX_HOLDS; n++) {
      const exact = Number(multiplierWad(n)) / Number(WAD);
      const declared = MULTIPLIER_TABLE[n];
      expect(Math.abs(exact - declared)).toBeLessThan(1e-7);
      expect(SURVIVE_PRODUCT(exact, n)).toBeCloseTo(RTP, 12);
    }
  });

  it('fail-path payout is zero', () => {
    const wager = 10n ** 18n;
    expect(payoutForHolds(wager, 0)).toBe(0n);
  });

  it('bank-path payout matches the multiplier table', () => {
    const wager = 100n * 10n ** 18n;
    for (let n = 1; n <= MAX_HOLDS; n++) {
      const payout = payoutForHolds(wager, n);
      const expected = (wager * multiplierWad(n)) / WAD;
      expect(payout).toBe(expected);
      const ratio = Number(payout) / Number(wager);
      expect(Math.abs(ratio - MULTIPLIER_TABLE[n])).toBeLessThan(1e-7);
    }
  });

  it('auto-bank triggers exactly at hold 5 (max payout path)', () => {
    const wager = 10n ** 18n;
    expect(maxPayoutForWager(wager)).toBe(payoutForHolds(wager, 5));
    expect(maxPayoutForWager(wager)).not.toBe(payoutForHolds(wager, 4));
  });

  it('survive check is exact 4/5', () => {
    let survived = 0;
    for (let i = 0; i < 5000; i++) {
      if (survivedFromRandomness(BigInt(i))) survived++;
    }
    expect(survived).toBe(4000); // exactly 4/5 of 0..4999
  });

  it('pPowWad matches successive 4/5 multiplies', () => {
    expect(pPowWad(1)).toBe((WAD * 4n) / 5n);
    expect(pPowWad(2)).toBe((pPowWad(1) * 4n) / 5n);
    let expected = WAD;
    for (let i = 0; i < 5; i++) expected = (expected * 4n) / 5n;
    expect(pPowWad(5)).toBe(expected);
  });
});

function SURVIVE_PRODUCT(mult: number, n: number): number {
  return 0.8 ** n * mult;
}
