import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import type { HexString } from '@chain/casino-sdk';

/** Exact game math — mirrors TugGame.sol. Do not re-derive differently. */
export const WAD = 10n ** 18n;
export const RTP_WAD = 95n * 10n ** 16n; // 0.95
export const MAX_HOLDS = 5;
export const RTP = 0.95;

export const INTENSITY_EASE = 0;
export const INTENSITY_STEADY = 1;
export const INTENSITY_HAUL = 2;

export type Intensity = typeof INTENSITY_EASE | typeof INTENSITY_STEADY | typeof INTENSITY_HAUL;

export const INTENSITIES: ReadonlyArray<{
  id: Intensity;
  label: string;
  pDisplay: string;
  num: bigint;
  den: bigint;
}> = [
  { id: INTENSITY_EASE, label: 'Ease', pDisplay: '90%', num: 9n, den: 10n },
  { id: INTENSITY_STEADY, label: 'Steady', pDisplay: '80%', num: 4n, den: 5n },
  { id: INTENSITY_HAUL, label: 'Haul', pDisplay: '65%', num: 13n, den: 20n },
];

/** Regression display values for the all-STEADY path (old fixed ladder). */
export const STEADY_MULT_REGRESSION: Record<number, number> = {
  1: 1.1875,
  2: 1.484375,
  3: 1.8554688,
  4: 2.3193359,
  5: 2.8991699,
};

export const EMPTY_HEX = '0x' as HexString;
export const ACTION_HOLD = 0;
export const ACTION_CASHOUT = 1;

export const PHASE_NONE = 0;
export const PHASE_WAITING_RANDOMNESS = 1;
export const PHASE_WAITING_PLAYER_ACTION = 2;
export const PHASE_SETTLED = 3;
export const PHASE_FORFEITED = 4;
export const PHASE_CANCELLED = 5;

export type TugState = {
  holdsSurvived: number;
  pendingHold: boolean;
  snapped: boolean;
  banked: boolean;
  lastRandomness: HexString;
  cumNum: bigint;
  cumDen: bigint;
  pendingIntensity: number;
};

const GAME_STATE_PARAMS = [
  { type: 'uint8' },
  { type: 'bool' },
  { type: 'bool' },
  { type: 'bool' },
  { type: 'bytes32' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint8' },
] as const;

export function probabilityFraction(intensity: number): { num: bigint; den: bigint } {
  const row = INTENSITIES.find(i => i.id === intensity);
  if (!row) throw new Error(`invalid intensity: ${intensity}`);
  return { num: row.num, den: row.den };
}

export function probabilityForIntensity(intensity: number): bigint {
  const { num, den } = probabilityFraction(intensity);
  return (WAD * num) / den;
}

export function isValidIntensity(intensity: number): intensity is Intensity {
  return intensity === INTENSITY_EASE || intensity === INTENSITY_STEADY || intensity === INTENSITY_HAUL;
}

/** Apply one survived hold to the exact rational C = num/den. */
export function applySurvive(
  cumNum: bigint,
  cumDen: bigint,
  intensity: number,
): { cumNum: bigint; cumDen: bigint } {
  const { num, den } = probabilityFraction(intensity);
  return { cumNum: cumNum * num, cumDen: cumDen * den };
}

export function multiplierFromCum(cumNum: bigint, cumDen: bigint): bigint {
  if (cumNum <= 0n) throw new Error('zero num');
  return (RTP_WAD * cumDen) / cumNum;
}

/**
 * Exact RTP identity in integer math:
 * (cumNum * mult + (RTP_WAD * cumDen % cumNum)) / cumDen == RTP_WAD
 */
export function rtpProductFromCum(cumNum: bigint, cumDen: bigint): bigint {
  const mult = multiplierFromCum(cumNum, cumDen);
  const rem = (RTP_WAD * cumDen) % cumNum;
  return (cumNum * mult + rem) / cumDen;
}

export function payoutFromCum(wager: bigint, cumNum: bigint, cumDen: bigint): bigint {
  if (cumNum === 1n && cumDen === 1n) return 0n;
  return (wager * RTP_WAD * cumDen) / (cumNum * WAD);
}

export function previewMultiplierAfterHold(
  cumNum: bigint,
  cumDen: bigint,
  intensity: number,
): bigint {
  const next = applySurvive(cumNum, cumDen, intensity);
  return multiplierFromCum(next.cumNum, next.cumDen);
}

export function worstCaseCum(): { cumNum: bigint; cumDen: bigint } {
  let cumNum = 1n;
  let cumDen = 1n;
  for (let i = 0; i < MAX_HOLDS; i++) {
    const next = applySurvive(cumNum, cumDen, INTENSITY_HAUL);
    cumNum = next.cumNum;
    cumDen = next.cumDen;
  }
  return { cumNum, cumDen };
}

export function maxPayoutForWager(wager: bigint): bigint {
  const { cumNum, cumDen } = worstCaseCum();
  return payoutFromCum(wager, cumNum, cumDen);
}

export function maxReservedProfit(wager: bigint): bigint {
  const maxPayout = maxPayoutForWager(wager);
  return maxPayout > wager ? maxPayout - wager : 0n;
}

export function steadyCum(n: number): { cumNum: bigint; cumDen: bigint } {
  if (n < 1 || n > MAX_HOLDS) throw new Error(`bad N: ${n}`);
  let cumNum = 1n;
  let cumDen = 1n;
  for (let i = 0; i < n; i++) {
    const next = applySurvive(cumNum, cumDen, INTENSITY_STEADY);
    cumNum = next.cumNum;
    cumDen = next.cumDen;
  }
  return { cumNum, cumDen };
}

export function formatMultiplierFromCum(cumNum: bigint, cumDen: bigint): string {
  if (cumNum === 1n && cumDen === 1n) return '—';
  const exact = Number(multiplierFromCum(cumNum, cumDen)) / Number(WAD);
  return `${exact.toFixed(4)}×`;
}

export function formatMultiplierWad(multWad: bigint): string {
  const exact = Number(multWad) / Number(WAD);
  return `${exact.toFixed(4)}×`;
}

export function survivedFromRandomness(randomness: bigint, intensity: number): boolean {
  if (intensity === INTENSITY_EASE) return randomness % 10n < 9n;
  if (intensity === INTENSITY_STEADY) return randomness % 5n < 4n;
  if (intensity === INTENSITY_HAUL) return randomness % 20n < 13n;
  throw new Error(`invalid intensity: ${intensity}`);
}

export function encodeHoldAction(intensity: number): HexString {
  if (!isValidIntensity(intensity)) throw new Error(`invalid intensity: ${intensity}`);
  return encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint8' }],
    [ACTION_HOLD, intensity],
  );
}

export function encodeCashoutAction(): HexString {
  return encodeAbiParameters([{ type: 'uint8' }], [ACTION_CASHOUT]);
}

export function decodeHoldAction(actionData: HexString): { intensity: Intensity } | null {
  try {
    const [action, intensity] = decodeAbiParameters(
      [{ type: 'uint8' }, { type: 'uint8' }],
      actionData,
    );
    if (Number(action) !== ACTION_HOLD) return null;
    if (!isValidIntensity(Number(intensity))) return null;
    return { intensity: Number(intensity) as Intensity };
  } catch {
    return null;
  }
}

export function decodeGameState(gameState: HexString): TugState | null {
  try {
    const [
      holdsSurvived,
      pendingHold,
      snapped,
      banked,
      lastRandomness,
      cumNum,
      cumDen,
      pendingIntensity,
    ] = decodeAbiParameters(GAME_STATE_PARAMS, gameState);
    return {
      holdsSurvived: Number(holdsSurvived),
      pendingHold,
      snapped,
      banked,
      lastRandomness: lastRandomness as HexString,
      cumNum,
      cumDen,
      pendingIntensity: Number(pendingIntensity),
    };
  } catch {
    return null;
  }
}

export function isTerminalPhase(phase: number | undefined): boolean {
  return phase === PHASE_SETTLED || phase === PHASE_FORFEITED || phase === PHASE_CANCELLED;
}

export function initialState(): TugState {
  return {
    holdsSurvived: 0,
    pendingHold: false,
    snapped: false,
    banked: false,
    lastRandomness: EMPTY_HEX,
    cumNum: 1n,
    cumDen: 1n,
    pendingIntensity: 0,
  };
}

export function allIntensitySequences(): Intensity[][] {
  const out: Intensity[][] = [];
  const ids: Intensity[] = [INTENSITY_EASE, INTENSITY_STEADY, INTENSITY_HAUL];
  const walk = (prefix: Intensity[]) => {
    if (prefix.length > 0) out.push([...prefix]);
    if (prefix.length >= MAX_HOLDS) return;
    for (const id of ids) walk([...prefix, id]);
  };
  walk([]);
  return out;
}
