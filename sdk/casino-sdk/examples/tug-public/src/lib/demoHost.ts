/**
 * Demo / standalone host — gated behind DEMO MODE.
 *
 * Used only when the page is opened outside the Chain.wtf (or local simulator)
 * iframe so the jam's "standalone playable" eligibility gate is met. Production
 * iframe play uses the real `@chain/casino-sdk` bridge exclusively.
 *
 * Enable with `?demo=1` or automatically after the host handshake times out
 * when not embedded.
 */
import type { HostApiV1, HostSnapshotV1, HexString } from "@chain/casino-sdk";
import {
  EMPTY_HEX,
  MAX_HOLDS,
  PHASE_SETTLED,
  PHASE_WAITING_PLAYER_ACTION,
  PHASE_WAITING_RANDOMNESS,
  applySurvive,
  decodeGameState,
  decodeHoldAction,
  encodeCashoutAction,
  initialState,
  payoutFromCum,
  survivedFromRandomness,
  type TugState,
} from "./tug";
import { encodeAbiParameters } from "viem";

export const DEMO_FLAG = "demo";

export function wantsDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get(DEMO_FLAG) === "1" || params.get(DEMO_FLAG) === "true")
    return true;
  return false;
}

export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function encodeState(state: TugState): HexString {
  const randomness =
    state.lastRandomness === EMPTY_HEX
      ? (("0x" + "00".repeat(32)) as HexString)
      : state.lastRandomness;
  return encodeAbiParameters(
    [
      { type: "uint8" },
      { type: "bool" },
      { type: "bool" },
      { type: "bool" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint8" },
    ],
    [
      state.holdsSurvived,
      state.pendingHold,
      state.snapped,
      state.banked,
      randomness,
      state.cumNum,
      state.cumDen,
      state.pendingIntensity,
    ],
  );
}

function randomWord(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}

export type DemoControllers = {
  hostApi: HostApiV1;
  getSnapshot: () => HostSnapshotV1;
  subscribe: (fn: (s: HostSnapshotV1) => void) => () => void;
};

export function createDemoHost(): DemoControllers {
  let sessionCounter = 0;
  const revealedSessions = new Set<string>();
  const listeners = new Set<(s: HostSnapshotV1) => void>();

  const snapshot: HostSnapshotV1 = {
    apiVersion: 1,
    integration: {
      chainId: 31337,
      slug: "tug",
      gameAddress: "0x0000000000000000000000000000000000000a01",
      manifest: {
        schemaVersion: 1,
        gameId: "TugGame",
        apiVersion: 1,
        defaultLocale: "en",
        locales: { en: { name: "Tug", description: "Hold or bank." } },
      },
    },
    wallet: {
      address: "0x000000000000000000000000000000000000dE01",
      smartVaultAddress: "0x000000000000000000000000000000000000dE01",
      status: "ready",
    },
    token: { symbol: "chUSD", decimals: 18 },
    balances: { smartVaultBalance: (1_000_000n * 10n ** 18n).toString() },
    casino: {
      availableLiquidity: (10_000_000n * 10n ** 18n).toString(),
      maxBetRiskBps: 100,
      maxAllowedReservedProfit: (100_000n * 10n ** 18n).toString(),
      maxBetAmount: "0",
    },
    sessions: { items: [] },
    ui: { locale: "en", theme: "dark", viewport: { availableHeight: 800 } },
  };

  const push = () => {
    const copy = structuredClone(snapshot);
    for (const fn of listeners) fn(copy);
  };

  const findSession = (sessionId: string) =>
    snapshot.sessions.items.find((s) => s.sessionId === sessionId);

  const hostApi: HostApiV1 = {
    async reportContentSize() {},
    async openSession({ wager }) {
      sessionCounter += 1;
      const sessionId = String(sessionCounter);
      const sessionKey = `31337:${sessionId}`;
      const state = initialState();
      const wagerBi = BigInt(wager);
      const bal = BigInt(snapshot.balances.smartVaultBalance ?? "0");
      snapshot.balances.smartVaultBalance = (bal - wagerBi).toString();

      snapshot.sessions.items = [
        {
          sessionId,
          sessionKey,
          gameAddress: snapshot.integration.gameAddress,
          phase: PHASE_WAITING_PLAYER_ACTION,
          phaseName: "WAITING_PLAYER_ACTION",
          wager,
          payout: undefined,
          isSettled: false,
          openedAt: Date.now(),
          lastEventTimestamp: Date.now(),
          raw: {
            gameData: EMPTY_HEX,
            gameState: encodeState(state),
          },
        },
        ...snapshot.sessions.items.filter((s) => !s.isSettled).slice(0, 8),
      ];
      push();
      return {
        sessionKey,
        transactionHash: ("0x" + "ab".repeat(32)) as HexString,
      };
    },
    async submitAction({ sessionId, actionData }) {
      const row = findSession(sessionId);
      if (!row || row.isSettled) throw new Error("No active session");
      const state =
        decodeGameState(row.raw.gameState as HexString) ?? initialState();
      const wager = BigInt(row.wager ?? "0");
      const hold = decodeHoldAction(actionData as HexString);
      const isCash =
        actionData.toLowerCase() === encodeCashoutAction().toLowerCase();

      if (hold) {
        if (state.pendingHold || state.snapped || state.banked)
          throw new Error("Action already resolving");
        if (state.holdsSurvived >= MAX_HOLDS) throw new Error("Max holds");
        state.pendingHold = true;
        state.pendingIntensity = hold.intensity;
        row.phase = PHASE_WAITING_RANDOMNESS;
        row.phaseName = "WAITING_RANDOMNESS";
        row.raw.gameState = encodeState(state);
        push();

        await new Promise((r) => setTimeout(r, 450));
        const word = randomWord();
        const hex = `0x${word.toString(16).padStart(64, "0")}` as HexString;
        state.pendingHold = false;
        state.lastRandomness = hex;

        if (!survivedFromRandomness(word, hold.intensity)) {
          state.snapped = true;
          row.phase = PHASE_SETTLED;
          row.phaseName = "SETTLED";
          row.payout = "0";
          row.isSettled = true;
          row.settledAt = Date.now();
          row.raw.gameState = encodeState(state);
          row.raw.randomness = hex;
          push();
          return { transactionHash: ("0x" + "cd".repeat(32)) as HexString };
        }

        const cum = applySurvive(state.cumNum, state.cumDen, hold.intensity);
        state.cumNum = cum.cumNum;
        state.cumDen = cum.cumDen;
        state.holdsSurvived += 1;
        if (state.holdsSurvived === MAX_HOLDS) {
          state.banked = true;
          const payout = payoutFromCum(wager, state.cumNum, state.cumDen);
          row.phase = PHASE_SETTLED;
          row.phaseName = "SETTLED";
          row.payout = payout.toString();
          row.isSettled = true;
          row.settledAt = Date.now();
          row.raw.gameState = encodeState(state);
          row.raw.randomness = hex;
          push();
          return { transactionHash: ("0x" + "ef".repeat(32)) as HexString };
        }

        row.phase = PHASE_WAITING_PLAYER_ACTION;
        row.phaseName = "WAITING_PLAYER_ACTION";
        row.raw.gameState = encodeState(state);
        row.raw.randomness = hex;
        push();
        return { transactionHash: ("0x" + "11".repeat(32)) as HexString };
      }

      if (isCash) {
        if (state.pendingHold || state.snapped || state.banked)
          throw new Error("Cannot bank now");
        if (state.holdsSurvived < 1) throw new Error("Nothing to bank");
        state.banked = true;
        const payout = payoutFromCum(wager, state.cumNum, state.cumDen);
        row.phase = PHASE_SETTLED;
        row.phaseName = "SETTLED";
        row.payout = payout.toString();
        row.isSettled = true;
        row.settledAt = Date.now();
        row.raw.gameState = encodeState(state);
        push();
        return { transactionHash: ("0x" + "22".repeat(32)) as HexString };
      }

      throw new Error("Unknown action");
    },
    async cancelStuckRandomness() {
      return { transactionHash: ("0x" + "00".repeat(32)) as HexString };
    },
    async revealOutcome({ sessionId }) {
      if (revealedSessions.has(sessionId)) return;
      const row = findSession(sessionId);
      if (!row?.payout) return;
      revealedSessions.add(sessionId);
      const payout = BigInt(row.payout);
      if (payout > 0n) {
        const bal = BigInt(snapshot.balances.smartVaultBalance ?? "0");
        snapshot.balances.smartVaultBalance = (bal + payout).toString();
        push();
      }
    },
  };

  return {
    hostApi,
    getSnapshot: () => structuredClone(snapshot),
    subscribe: (fn) => {
      listeners.add(fn);
      fn(structuredClone(snapshot));
      return () => listeners.delete(fn);
    },
  };
}
