import { describe, expect, it } from 'vitest';
import {
  INTENSITY_EASE,
  INTENSITY_HAUL,
  INTENSITY_STEADY,
  MAX_HOLDS,
  RTP_WAD,
  STEADY_MULT_REGRESSION,
  WAD,
  allIntensitySequences,
  applySurvive,
  maxPayoutForWager,
  multiplierFromCum,
  payoutFromCum,
  probabilityForIntensity,
  rtpProductFromCum,
  steadyCum,
  survivedFromRandomness,
  worstCaseCum,
} from './tug';

describe('Tug RTP invariant (intensity-aware)', () => {
  it('exhaustive: C * mult(C) == RTP for every intensity sequence of length 1..5', () => {
    const sequences = allIntensitySequences();
    expect(sequences.length).toBe(363);

    let checked = 0;
    for (const seq of sequences) {
      let cumNum = 1n;
      let cumDen = 1n;
      for (const intensity of seq) {
        const next = applySurvive(cumNum, cumDen, intensity);
        cumNum = next.cumNum;
        cumDen = next.cumDen;
        expect(rtpProductFromCum(cumNum, cumDen)).toBe(RTP_WAD);
        checked++;
      }
    }
    expect(checked).toBe(1641);
  });

  it('all-STEADY regression: mult(N) matches the prior fixed ladder', () => {
    for (let n = 1; n <= MAX_HOLDS; n++) {
      const { cumNum, cumDen } = steadyCum(n);
      const exact = Number(multiplierFromCum(cumNum, cumDen)) / Number(WAD);
      const declared = STEADY_MULT_REGRESSION[n];
      expect(Math.abs(exact - declared)).toBeLessThan(1e-7);
      expect(rtpProductFromCum(cumNum, cumDen)).toBe(RTP_WAD);
    }
  });

  it('fail-path payout is zero (C still 1/1)', () => {
    const wager = 10n ** 18n;
    expect(payoutFromCum(wager, 1n, 1n)).toBe(0n);
  });

  it('bank-path payout matches RTP * den / num for mixed intensities', () => {
    const wager = 100n * 10n ** 18n;
    let cumNum = 1n;
    let cumDen = 1n;
    ({ cumNum, cumDen } = applySurvive(cumNum, cumDen, INTENSITY_EASE));
    ({ cumNum, cumDen } = applySurvive(cumNum, cumDen, INTENSITY_HAUL));
    const payout = payoutFromCum(wager, cumNum, cumDen);
    // Same single-division formula the contract uses (not wager*floor(mult)/WAD).
    expect(payout).toBe((wager * RTP_WAD * cumDen) / (cumNum * WAD));
    expect(payout).toBeGreaterThan(0n);
  });

  it('auto-bank / max liability uses all-HAUL path (highest mult)', () => {
    const wager = 10n ** 18n;
    const worst = worstCaseCum();
    const steady5 = steadyCum(5);
    expect(multiplierFromCum(worst.cumNum, worst.cumDen)).toBeGreaterThan(
      multiplierFromCum(steady5.cumNum, steady5.cumDen),
    );
    expect(maxPayoutForWager(wager)).toBe(payoutFromCum(wager, worst.cumNum, worst.cumDen));
  });

  it('intensity survival checks are exact fractions', () => {
    let e = 0;
    for (let i = 0; i < 10000; i++) if (survivedFromRandomness(BigInt(i), INTENSITY_EASE)) e++;
    expect(e).toBe(9000);

    let s = 0;
    for (let i = 0; i < 5000; i++) if (survivedFromRandomness(BigInt(i), INTENSITY_STEADY)) s++;
    expect(s).toBe(4000);

    let h = 0;
    for (let i = 0; i < 10000; i++) if (survivedFromRandomness(BigInt(i), INTENSITY_HAUL)) h++;
    expect(h).toBe(6500);
  });

  it('probabilityForIntensity matches declared fractions', () => {
    expect(probabilityForIntensity(INTENSITY_EASE)).toBe((WAD * 9n) / 10n);
    expect(probabilityForIntensity(INTENSITY_STEADY)).toBe((WAD * 4n) / 5n);
    expect(probabilityForIntensity(INTENSITY_HAUL)).toBe((WAD * 13n) / 20n);
    expect(() => probabilityForIntensity(3)).toThrow();
  });
});
