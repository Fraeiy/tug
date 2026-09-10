export const SESSION_STATS_KEY = "tug.session-stats.v1";

export type SessionStats = {
  roundsPlayed: number;
  bestMultiplierWad: string;
  biggestWin: string;
  survivalStreak: number;
};

export const EMPTY_SESSION_STATS: SessionStats = {
  roundsPlayed: 0,
  bestMultiplierWad: "0",
  biggestWin: "0",
  survivalStreak: 0,
};

export function loadSessionStats(): SessionStats {
  if (typeof sessionStorage === "undefined") return EMPTY_SESSION_STATS;
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(SESSION_STATS_KEY) ?? "null",
    ) as Partial<SessionStats> | null;
    if (!parsed) return EMPTY_SESSION_STATS;
    return {
      roundsPlayed: Number.isSafeInteger(parsed.roundsPlayed)
        ? Math.max(0, parsed.roundsPlayed!)
        : 0,
      bestMultiplierWad: /^\d+$/.test(parsed.bestMultiplierWad ?? "")
        ? parsed.bestMultiplierWad!
        : "0",
      biggestWin: /^\d+$/.test(parsed.biggestWin ?? "")
        ? parsed.biggestWin!
        : "0",
      survivalStreak: Number.isSafeInteger(parsed.survivalStreak)
        ? Math.max(0, parsed.survivalStreak!)
        : 0,
    };
  } catch {
    return EMPTY_SESSION_STATS;
  }
}

export function recordCompletedRound(
  current: SessionStats,
  input: {
    multiplierWad: bigint;
    payout: bigint;
    holds: number;
    snapped: boolean;
  },
): SessionStats {
  const next = {
    roundsPlayed: current.roundsPlayed + 1,
    bestMultiplierWad: (input.multiplierWad > BigInt(current.bestMultiplierWad)
      ? input.multiplierWad
      : BigInt(current.bestMultiplierWad)
    ).toString(),
    biggestWin: (input.payout > BigInt(current.biggestWin)
      ? input.payout
      : BigInt(current.biggestWin)
    ).toString(),
    survivalStreak: input.snapped ? 0 : current.survivalStreak + input.holds,
  };
  try {
    sessionStorage.setItem(SESSION_STATS_KEY, JSON.stringify(next));
  } catch {
    // Session feedback remains available in memory when storage is restricted.
  }
  return next;
}

export function shareResultText(
  multiplier: string,
  payout: string,
  symbol: string,
): string {
  return `I survived Tug and banked a ${payout} ${symbol} gross payout at ${multiplier}. Can you hold longer?`;
}
