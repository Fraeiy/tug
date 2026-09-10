import { describe, expect, it } from "vitest";
import {
  INTENSITY_EASE,
  INTENSITY_HAUL,
  INTENSITY_STEADY,
  RTP,
  applySurvive,
  type Intensity,
} from "./tug";

const SEED = 0x5eedc0de;
const ROUNDS = 1_000_000;

function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    do {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
    } while (state >= 4_294_967_280); // rejection makes modulo 20 exact
    return state % 20;
  };
}

const survives = (roll: number, intensity: Intensity) =>
  roll <
  (intensity === INTENSITY_EASE
    ? 18
    : intensity === INTENSITY_STEADY
      ? 16
      : 13);

describe("seeded one-million-round probability simulation", () => {
  it("matches survival, snap, and 95% RTP across representative strategies", () => {
    const scenarios: Array<[string, Intensity[]]> = [
      ["one Ease and bank", [INTENSITY_EASE]],
      ["one Steady and bank", [INTENSITY_STEADY]],
      ["one Haul and bank", [INTENSITY_HAUL]],
      ["bank after hold 2", [INTENSITY_EASE, INTENSITY_STEADY]],
      ["bank after hold 3", [INTENSITY_HAUL, INTENSITY_EASE, INTENSITY_STEADY]],
      [
        "bank after hold 4",
        [INTENSITY_EASE, INTENSITY_STEADY, INTENSITY_HAUL, INTENSITY_EASE],
      ],
      ["five Ease auto-bank", Array(5).fill(INTENSITY_EASE)],
      ["five Steady auto-bank", Array(5).fill(INTENSITY_STEADY)],
      ["five Haul auto-bank", Array(5).fill(INTENSITY_HAUL)],
      ["mixed auto-bank A", [0, 1, 2, 1, 0]],
      ["mixed auto-bank B", [2, 0, 2, 1, 0]],
    ];
    const results = [];

    for (const [name, sequence] of scenarios) {
      const nextRoll = generator(
        SEED ^ sequence.reduce<number>((n, value, i) => n + (value + 1) * (i + 17), 0),
      );
      let wins = 0;
      for (let round = 0; round < ROUNDS; round++) {
        let won = true;
        for (const intensity of sequence) {
          if (!survives(nextRoll(), intensity)) {
            won = false;
            break;
          }
        }
        if (won) wins++;
      }

      let cumNum = 1n;
      let cumDen = 1n;
      for (const intensity of sequence)
        ({ cumNum, cumDen } = applySurvive(cumNum, cumDen, intensity));
      const expectedSurvival = Number(cumNum) / Number(cumDen);
      const observedSurvival = wins / ROUNDS;
      const standardError = Math.sqrt(
        (expectedSurvival * (1 - expectedSurvival)) / ROUNDS,
      );
      const zScore = (observedSurvival - expectedSurvival) / standardError;
      const observedRtp = observedSurvival * (RTP / expectedSurvival);
      expect(Math.abs(zScore)).toBeLessThan(5);
      expect(Math.abs(observedRtp - RTP)).toBeLessThan(
        5 * standardError * (RTP / expectedSurvival),
      );
      results.push({
        name,
        expectedSurvival,
        observedSurvival,
        expectedSnap: 1 - expectedSurvival,
        observedSnap: 1 - observedSurvival,
        expectedRtp: RTP,
        observedRtp,
        zScore,
      });
    }

    console.info(
      `TUG_SIMULATION seed=${SEED} rounds_per_scenario=${ROUNDS}`,
      JSON.stringify(results),
    );
  }, 30_000);
});
