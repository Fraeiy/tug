import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import type { HexString } from '@chain/casino-sdk';

/** Exact game math — mirrors TugGame.sol. Do not re-derive differently. */
export const WAD = 10n ** 18n;
export const RTP_WAD = 95n * 10n ** 16n; // 0.95
export const P_NUM = 4n;
export const P_DEN = 5n;
export const MAX_HOLDS = 5;
export const SURVIVE_P = 0.8;
export const RTP = 0.95;

/** Multiplier table from mult(N) = RTP / p^N (display rounding matches jam brief). */
export const MULTIPLIER_TABLE: Record<number, number> = {
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
};

const GAME_STATE_PARAMS = [
  { type: 'uint8' },
  { type: 'bool' },
  { type: 'bool' },
  { type: 'bool' },
  { type: 'bytes32' },
] as const;

export function pPowWad(n: number): bigint {
  if (n < 1 || n > MAX_HOLDS) throw new Error(`bad N: ${n}`);
  let pow = WAD;
  for (let i = 0; i < n; i++) {
    pow = (pow * P_NUM) / P_DEN;
  }
  return pow;
}

export function multiplierWad(n: number): bigint {
  return (RTP_WAD * WAD) / pPowWad(n);
}

/** RTP invariant: p^N * mult(N) == RTP (WAD). */
export function rtpProductWad(n: number): bigint {
  return (pPowWad(n) * multiplierWad(n)) / WAD;
}

export function payoutForHolds(wager: bigint, holds: number): bigint {
  if (holds <= 0) return 0n;
  return (wager * multiplierWad(holds)) / WAD;
}

export function maxPayoutForWager(wager: bigint): bigint {
  return payoutForHolds(wager, MAX_HOLDS);
}

export function maxReservedProfit(wager: bigint): bigint {
  const maxPayout = maxPayoutForWager(wager);
  return maxPayout > wager ? maxPayout - wager : 0n;
}

export function formatMultiplier(n: number): string {
  if (n <= 0) return '—';
  const exact = Number(multiplierWad(n)) / Number(WAD);
  return `${exact.toFixed(4)}×`;
}

export function surviveChanceDisplay(holdsAlready: number): string {
  // Next hold always has fixed p = 80%.
  void holdsAlready;
  return '80%';
}

/** Unbiased p = 4/5 survival check — mirrors TugGame._survived. */
export function survivedFromRandomness(randomness: bigint): boolean {
  return randomness % P_DEN < P_NUM;
}

export function encodeHoldAction(): HexString {
  return encodeAbiParameters([{ type: 'uint8' }], [ACTION_HOLD]);
}

export function encodeCashoutAction(): HexString {
  return encodeAbiParameters([{ type: 'uint8' }], [ACTION_CASHOUT]);
}

export function decodeGameState(gameState: HexString): TugState | null {
  try {
    const [holdsSurvived, pendingHold, snapped, banked, lastRandomness] = decodeAbiParameters(
      GAME_STATE_PARAMS,
      gameState,
    );
    return {
      holdsSurvived: Number(holdsSurvived),
      pendingHold,
      snapped,
      banked,
      lastRandomness: lastRandomness as HexString,
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
  };
}
