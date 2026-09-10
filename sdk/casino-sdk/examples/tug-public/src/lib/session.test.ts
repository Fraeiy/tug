import { afterEach, describe, expect, it, vi } from "vitest";
import { MUTE_STORAGE_KEY, readMutedPreference, setMuted } from "./audio";
import {
  EMPTY_SESSION_STATS,
  loadSessionStats,
  recordCompletedRound,
  shareResultText,
} from "./session";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
}

describe("local preferences and session feedback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("persists mute preference without requiring audio support", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    setMuted(true);
    expect(storage.getItem(MUTE_STORAGE_KEY)).toBe("1");
    expect(readMutedPreference()).toBe(true);
    setMuted(false);
    expect(readMutedPreference()).toBe(false);
  });

  it("records only session-scoped, non-misleading round feedback", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    let stats = recordCompletedRound(EMPTY_SESSION_STATS, {
      multiplierWad: 2n * 10n ** 18n,
      payout: 5n * 10n ** 18n,
      holds: 3,
      snapped: false,
    });
    stats = recordCompletedRound(stats, {
      multiplierWad: 0n,
      payout: 0n,
      holds: 0,
      snapped: true,
    });
    expect(loadSessionStats()).toEqual({
      roundsPlayed: 2,
      bestMultiplierWad: (2n * 10n ** 18n).toString(),
      biggestWin: (5n * 10n ** 18n).toString(),
      survivalStreak: 0,
    });
    expect(shareResultText("2.0000×", "15", "chUSD")).toContain("gross payout");
  });
});
