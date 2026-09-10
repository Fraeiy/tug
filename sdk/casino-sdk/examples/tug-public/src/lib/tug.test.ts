import { describe, expect, it } from "vitest";
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
  roll20FromRandomness,
  rtpProductFromCum,
  steadyCum,
  survivedFromRandomness,
  worstCaseCum,
  formatMultiplierFromCum,
  formatMultiplierWad,
  formatTokenAmountFloor,
  validateWagerInput,
} from "./tug";

const wordWithBytes = (...bytes: number[]) =>
  BigInt(
    `0x${bytes
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .padEnd(64, "0")}`,
  );

describe("Tug RTP invariant (intensity-aware)", () => {
  it("exhaustive: all 363 sequences preserve RTP and frontend/contract payout agreement", () => {
    const sequences = allIntensitySequences();
    expect(sequences.length).toBe(363);
    const wagers = [
      1n,
      10n ** 16n,
      10n ** 18n,
      5n * 10n ** 18n,
      10n * 10n ** 18n,
      25n * 10n ** 18n,
      50n * 10n ** 18n,
      1000n * 10n ** 18n,
    ];
    for (const seq of sequences) {
      let cumNum = 1n;
      let cumDen = 1n;
      for (const intensity of seq) {
        const next = applySurvive(cumNum, cumDen, intensity);
        cumNum = next.cumNum;
        cumDen = next.cumDen;
      }
      const multiplier = multiplierFromCum(cumNum, cumDen);
      expect(rtpProductFromCum(cumNum, cumDen)).toBe(RTP_WAD);
      expect(formatMultiplierFromCum(cumNum, cumDen)).toBe(
        formatMultiplierWad(multiplier),
      );
      for (const wager of wagers) {
        const contractPayout = (wager * RTP_WAD * cumDen) / (cumNum * WAD);
        expect(payoutFromCum(wager, cumNum, cumDen)).toBe(contractPayout);
        expect((wager * multiplier) / WAD).toBeLessThanOrEqual(contractPayout);
      }
    }
  });

  it("all-STEADY regression: mult(N) matches the prior fixed ladder", () => {
    for (let n = 1; n <= MAX_HOLDS; n++) {
      const { cumNum, cumDen } = steadyCum(n);
      const exact = Number(multiplierFromCum(cumNum, cumDen)) / Number(WAD);
      const declared = STEADY_MULT_REGRESSION[n];
      expect(Math.abs(exact - declared)).toBeLessThan(1e-7);
      expect(rtpProductFromCum(cumNum, cumDen)).toBe(RTP_WAD);
    }
  });

  it("fail-path payout is zero (C still 1/1)", () => {
    const wager = 10n ** 18n;
    expect(payoutFromCum(wager, 1n, 1n)).toBe(0n);
  });

  it("bank-path payout matches RTP * den / num for mixed intensities", () => {
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

  it("auto-bank / max liability uses all-HAUL path (highest mult)", () => {
    const wager = 10n ** 18n;
    const worst = worstCaseCum();
    const steady5 = steadyCum(5);
    expect(multiplierFromCum(worst.cumNum, worst.cumDen)).toBeGreaterThan(
      multiplierFromCum(steady5.cumNum, steady5.cumDen),
    );
    expect(maxPayoutForWager(wager)).toBe(
      payoutFromCum(wager, worst.cumNum, worst.cumDen),
    );
  });

  it("maps each complete accepted byte partition to exact declared fractions", () => {
    for (const [intensity, expected] of [
      [INTENSITY_EASE, 216],
      [INTENSITY_STEADY, 192],
      [INTENSITY_HAUL, 156],
    ] as const) {
      let survived = 0;
      for (let byte = 0; byte < 240; byte++) {
        if (survivedFromRandomness(wordWithBytes(byte), intensity)) survived++;
      }
      expect(survived).toBe(expected);
    }
  });

  it("handles survival boundaries and rejected bytes without gaps or overlap", () => {
    for (const [intensity, boundary] of [
      [INTENSITY_EASE, 18],
      [INTENSITY_STEADY, 16],
      [INTENSITY_HAUL, 13],
    ] as const) {
      expect(
        survivedFromRandomness(wordWithBytes(boundary - 1), intensity),
      ).toBe(true);
      expect(survivedFromRandomness(wordWithBytes(boundary), intensity)).toBe(
        false,
      );
      expect(
        survivedFromRandomness(wordWithBytes(boundary + 1), intensity),
      ).toBe(false);
    }
    expect(roll20FromRandomness(wordWithBytes(239))).toBe(19);
    expect(roll20FromRandomness(wordWithBytes(240, 7))).toBe(7);
  });

  it("probabilityForIntensity matches declared fractions", () => {
    expect(probabilityForIntensity(INTENSITY_EASE)).toBe((WAD * 9n) / 10n);
    expect(probabilityForIntensity(INTENSITY_STEADY)).toBe((WAD * 4n) / 5n);
    expect(probabilityForIntensity(INTENSITY_HAUL)).toBe((WAD * 13n) / 20n);
    expect(() => probabilityForIntensity(3)).toThrow();
  });

  it("validates token precision and floors every displayed financial value", () => {
    expect(validateWagerInput("0.01", 18)).toBe(10n ** 16n);
    expect(validateWagerInput("1.234567", 6)).toBe(1_234_567n);
    expect(validateWagerInput("1000", 6)).toBe(1_000_000_000n);
    expect(() => validateWagerInput("0", 18)).toThrow(/Minimum/);
    expect(() => validateWagerInput("1000.01", 18)).toThrow(/Maximum/);
    expect(() => validateWagerInput("1.0000001", 6)).toThrow(/decimal places/);
    expect(() => validateWagerInput("NaN", 18)).toThrow(/valid/);
    expect(formatTokenAmountFloor(1_239_999n, 6, 2)).toBe("1.23");
    expect(formatMultiplierWad(1_234_599_999_999_999_999n)).toBe("1.2345×");
  });
});
