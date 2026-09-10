import { describe, expect, it } from "vitest";
import {
  ACTION_HOLD,
  INTENSITY_EASE,
  INTENSITY_HAUL,
  INTENSITY_STEADY,
  MAX_HOLDS,
  applySurvive,
  decodeHoldAction,
  encodeCashoutAction,
  encodeHoldAction,
  isValidIntensity,
  payoutFromCum,
  survivedFromRandomness,
  type Intensity,
} from "./tug";
import { encodeAbiParameters } from "viem";

type State = {
  holdsSurvived: number;
  pendingHold: boolean;
  snapped: boolean;
  banked: boolean;
  cumNum: bigint;
  cumDen: bigint;
  pendingIntensity: number;
};

function start(): State {
  return {
    holdsSurvived: 0,
    pendingHold: false,
    snapped: false,
    banked: false,
    cumNum: 1n,
    cumDen: 1n,
    pendingIntensity: 0,
  };
}

function requestHold(state: State, intensity: number): State {
  if (state.pendingHold || state.snapped || state.banked)
    throw new Error("bad");
  if (state.holdsSurvived >= MAX_HOLDS) throw new Error("max");
  if (!isValidIntensity(intensity)) throw new Error("invalid intensity");
  return { ...state, pendingHold: true, pendingIntensity: intensity };
}

function resolve(
  state: State,
  randomness: bigint,
): { state: State; payout: bigint; wager: bigint } {
  const wager = 100n * 10n ** 18n;
  if (!state.pendingHold) throw new Error("no pending");
  let next = { ...state, pendingHold: false };
  if (!survivedFromRandomness(randomness, state.pendingIntensity)) {
    next = { ...next, snapped: true };
    return { state: next, payout: 0n, wager };
  }
  const cum = applySurvive(next.cumNum, next.cumDen, state.pendingIntensity);
  next = {
    ...next,
    cumNum: cum.cumNum,
    cumDen: cum.cumDen,
    holdsSurvived: next.holdsSurvived + 1,
  };
  if (next.holdsSurvived === MAX_HOLDS) {
    next = { ...next, banked: true };
    return {
      state: next,
      payout: payoutFromCum(wager, next.cumNum, next.cumDen),
      wager,
    };
  }
  return { state: next, payout: 0n, wager };
}

function cashOut(
  state: State,
  wager: bigint,
): { state: State; payout: bigint } {
  if (state.pendingHold || state.snapped || state.banked)
    throw new Error("bad");
  if (state.holdsSurvived < 1) throw new Error("nothing to bank");
  return {
    state: { ...state, banked: true, pendingHold: false },
    payout: payoutFromCum(wager, state.cumNum, state.cumDen),
  };
}

describe("Tug state machine (intensities)", () => {
  it("fail-path payout is zero", () => {
    let s = start();
    s = requestHold(s, INTENSITY_STEADY);
    const { state, payout } = resolve(s, BigInt(`0x${'10'.padEnd(64, '0')}`));
    expect(state.snapped).toBe(true);
    expect(payout).toBe(0n);
  });

  it("bank-path payout matches cumulative C after mixed grips", () => {
    const wager = 100n * 10n ** 18n;
    let s = start();
    const path: Intensity[] = [INTENSITY_EASE, INTENSITY_HAUL];
    for (const intensity of path) {
      s = requestHold(s, intensity);
      const r = resolve(s, 0n);
      s = r.state;
      expect(s.snapped).toBe(false);
    }
    expect(s.holdsSurvived).toBe(2);
    const { payout } = cashOut(s, wager);
    expect(payout).toBe(payoutFromCum(wager, s.cumNum, s.cumDen));
  });

  it("auto-bank triggers exactly at hold 5", () => {
    let s = start();
    let lastPayout = 0n;
    for (let i = 0; i < 5; i++) {
      s = requestHold(s, INTENSITY_STEADY);
      const r = resolve(s, 0n);
      s = r.state;
      lastPayout = r.payout;
      if (i < 4) {
        expect(s.banked).toBe(false);
        expect(lastPayout).toBe(0n);
      }
    }
    expect(s.holdsSurvived).toBe(5);
    expect(s.banked).toBe(true);
    expect(lastPayout).toBe(
      payoutFromCum(100n * 10n ** 18n, s.cumNum, s.cumDen),
    );
  });

  it("HOLD action without a valid intensity index is rejected", () => {
    expect(decodeHoldAction(encodeCashoutAction())).toBeNull();

    const bad = encodeAbiParameters(
      [{ type: "uint8" }, { type: "uint8" }],
      [ACTION_HOLD, 9],
    );
    expect(decodeHoldAction(bad)).toBeNull();

    expect(() => requestHold(start(), 9)).toThrow(/invalid intensity/);
    expect(() => encodeHoldAction(9)).toThrow(/invalid intensity/);
  });

  it("encodeHoldAction round-trips intensity", () => {
    for (const intensity of [
      INTENSITY_EASE,
      INTENSITY_STEADY,
      INTENSITY_HAUL,
    ]) {
      const decoded = decodeHoldAction(encodeHoldAction(intensity));
      expect(decoded).toEqual({ intensity });
    }
  });

  it("rejects duplicate, pending, terminal, and over-limit transitions", () => {
    let pending = requestHold(start(), INTENSITY_EASE);
    expect(() => requestHold(pending, INTENSITY_STEADY)).toThrow(/bad/);
    expect(() => cashOut(pending, 1n)).toThrow(/bad/);

    const snapped = resolve(pending, BigInt(`0x${"12".padEnd(64, "0")}`)).state;
    expect(snapped.snapped).toBe(true);
    expect(() => requestHold(snapped, INTENSITY_EASE)).toThrow(/bad/);
    expect(() => cashOut(snapped, 1n)).toThrow(/bad/);

    let bankable = resolve(requestHold(start(), INTENSITY_EASE), 0n).state;
    const banked = cashOut(bankable, 1n).state;
    expect(() => requestHold(banked, INTENSITY_EASE)).toThrow(/bad/);
    expect(() => cashOut(banked, 1n)).toThrow(/bad/);

    let five = start();
    for (let i = 0; i < MAX_HOLDS; i++)
      five = resolve(requestHold(five, INTENSITY_EASE), 0n).state;
    expect(five.banked).toBe(true);
    expect(() => requestHold(five, INTENSITY_EASE)).toThrow(/bad/);
  });
});
