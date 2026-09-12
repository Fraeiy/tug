import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { computeMaxWager } from "@chain/casino-sdk/guest";

import { useCasinoHost } from "./lib/useCasinoHost";
import {
  EMPTY_HEX,
  INTENSITIES,
  INTENSITY_STEADY,
  MAX_HOLDS,
  PHASE_SETTLED,
  PHASE_WAITING_PLAYER_ACTION,
  PHASE_WAITING_RANDOMNESS,
  WAD,
  decodeGameState,
  encodeCashoutAction,
  encodeHoldAction,
  formatMultiplierFromCum,
  formatMultiplierWad,
  formatTokenAmountFloor,
  maxReservedProfit,
  multiplierFromCum,
  payoutFromCum,
  previewMultiplierAfterHold,
  validateWagerInput,
  worstCaseCum,
  type Intensity,
  type TugState,
} from "./lib/tug";
import {
  playBank,
  playButton,
  playHoldSurvived,
  playSnap,
  playTension,
  playWager,
  readMutedPreference,
  setMuted as persistMuted,
  stopAudio,
  unlockAudio,
} from "./lib/audio";
import {
  loadSessionStats,
  recordCompletedRound,
  shareResultText,
} from "./lib/session";
import { RopeStage, type RopeVisual } from "./components/RopeStage";

type RoundStatus =
  | "idle"
  | "opening"
  | "active"
  | "resolving"
  | "snapping"
  | "snapped"
  | "banked";

const WAGER_PRESETS = ["1", "5", "10", "25", "50"];

export function App() {
  const { hostApi, snapshot, demoMode } = useCasinoHost();
  const [wagerInput, setWagerInput] = useState("10");
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<RoundStatus>("idle");
  const [state, setState] = useState<TugState | null>(null);
  const [payout, setPayout] = useState<bigint>(0n);
  const [wager, setWager] = useState<bigint>(0n);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [multPulse, setMultPulse] = useState(false);
  const [pendingIntensity, setPendingIntensity] = useState<Intensity | null>(
    null,
  );
  const [muted, setMuted] = useState(readMutedPreference);
  const [stats, setStats] = useState(loadSessionStats);
  const [shareState, setShareState] = useState<"idle" | "shared" | "copied">(
    "idle",
  );
  const heardRef = useRef<string>("");
  const prevHoldsRef = useRef(0);
  const actionLockRef = useRef(false);
  const roundEpochRef = useRef(0);
  const completedRoundsRef = useRef(new Set<string>());

  const decimals = snapshot?.token.decimals ?? 18;
  const symbol = snapshot?.token.symbol ?? "chUSD";
  const walletReady = snapshot?.wallet.status === "ready";
  const balance = useMemo(() => {
    const raw = snapshot?.balances.smartVaultBalance;
    return raw !== undefined ? BigInt(raw) : undefined;
  }, [snapshot?.balances.smartVaultBalance]);

  const maxWager = useMemo(() => {
    if (!snapshot) return undefined;
    const worst = worstCaseCum();
    const worstMult =
      Number(multiplierFromCum(worst.cumNum, worst.cumDen)) / Number(WAD);
    return computeMaxWager(snapshot, { maxMultiplierX: worstMult });
  }, [snapshot]);

  const activeRow = useMemo(() => {
    if (!snapshot || !sessionKey) return null;
    return (
      snapshot.sessions.items.find((item) => item.sessionKey === sessionKey) ??
      null
    );
  }, [snapshot, sessionKey]);

  const resolvedSessionId =
    sessionId ??
    activeRow?.sessionId ??
    (sessionKey?.includes(":") ? sessionKey.split(":")[1] : null);

  useEffect(() => {
    if (!activeRow) return;
    const decoded = activeRow.raw.gameState
      ? decodeGameState(activeRow.raw.gameState)
      : null;
    if (decoded) setState(decoded);
    if (activeRow.sessionId) setSessionId(activeRow.sessionId);

    if (activeRow.phase === PHASE_WAITING_RANDOMNESS || decoded?.pendingHold) {
      setStatus("resolving");
      return;
    }

    if (activeRow.isSettled || activeRow.phase === PHASE_SETTLED) {
      const pay =
        activeRow.payout !== undefined ? BigInt(activeRow.payout) : 0n;
      setPayout(pay);
      if (decoded?.snapped) {
        setStatus((current) =>
          current === "snapping" || current === "snapped"
            ? current
            : "snapping",
        );
      } else if (decoded?.banked || pay > 0n) setStatus("banked");
      else if (activeRow.payout !== undefined && pay === 0n)
        setStatus("snapped");
      return;
    }

    if (activeRow.phase === PHASE_WAITING_PLAYER_ACTION) {
      setStatus("active");
    }
  }, [activeRow]);

  // Let the state-driven rope break read before revealing the loss controls.
  // This timer is deliberately independent of canvas/animation events so a
  // throttled mobile frame or reduced-motion setting cannot stall the round.
  useEffect(() => {
    if (status !== "snapping") return;
    const timer = window.setTimeout(() => setStatus("snapped"), 700);
    return () => window.clearTimeout(timer);
  }, [status]);

  // Pulse multiplier text when a hold lands.
  useEffect(() => {
    const h = state?.holdsSurvived ?? 0;
    if (h > prevHoldsRef.current && status === "active") {
      setMultPulse(true);
      const t = window.setTimeout(() => setMultPulse(false), 220);
      prevHoldsRef.current = h;
      return () => window.clearTimeout(t);
    }
    if (h === 0) prevHoldsRef.current = 0;
    else prevHoldsRef.current = h;
  }, [state?.holdsSurvived, status]);

  useEffect(() => {
    if (!state) return;
    if (status === "snapped") {
      const key = `snap:${sessionId}`;
      if (heardRef.current !== key) {
        heardRef.current = key;
        playSnap();
        setShake(true);
        window.setTimeout(() => setShake(false), 520);
      }
    } else if (status === "banked") {
      const key = `bank:${sessionId}:${state.holdsSurvived}`;
      if (heardRef.current !== key) {
        heardRef.current = key;
        playBank(state.holdsSurvived === MAX_HOLDS);
      }
    } else if (
      status === "active" &&
      state.holdsSurvived > 0 &&
      !state.pendingHold
    ) {
      const key = `hold:${sessionId}:${state.holdsSurvived}`;
      if (heardRef.current !== key) {
        heardRef.current = key;
        playHoldSurvived(state.holdsSurvived);
      }
    }
  }, [status, state, sessionId]);

  useEffect(() => {
    if (status !== "banked" || !resolvedSessionId || !hostApi) return;
    void hostApi.revealOutcome({ sessionId: resolvedSessionId }).catch(() => {
      setError("Payout confirmation is delayed. Your settled round remains safe.");
    });
  }, [status, resolvedSessionId, hostApi]);

  useEffect(() => {
    const stop = () => stopAudio();
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", stop);
      stopAudio();
    };
  }, []);

  useEffect(() => {
    if (
      (status !== "snapped" && status !== "banked") ||
      !resolvedSessionId ||
      !state
    )
      return;
    if (completedRoundsRef.current.has(resolvedSessionId)) return;
    completedRoundsRef.current.add(resolvedSessionId);
    const multiplierWad =
      state.holdsSurvived > 0
        ? multiplierFromCum(state.cumNum, state.cumDen)
        : 0n;
    const netWin = payout > wager ? payout - wager : 0n;
    setStats((current) =>
      recordCompletedRound(current, {
        multiplierWad,
        payout: netWin,
        holds: state.holdsSurvived,
        snapped: status === "snapped",
      }),
    );
  }, [status, resolvedSessionId, state, payout, wager]);

  const visual: RopeVisual = useMemo(() => {
    if (status === "snapping" || status === "snapped") return "snap";
    if (status === "banked") return "banked";
    if (status === "resolving") return "fraying";
    if ((state?.holdsSurvived ?? 0) > 0) return "tension";
    return "idle";
  }, [status, state]);

  const holds = state?.holdsSurvived ?? 0;
  const cumNum = state?.cumNum ?? 1n;
  const cumDen = state?.cumDen ?? 1n;
  const currentMult = holds > 0 ? formatMultiplierFromCum(cumNum, cumDen) : "—";
  const potential =
    holds > 0 && wager > 0n ? payoutFromCum(wager, cumNum, cumDen) : 0n;
  const strainIntensity: Intensity =
    pendingIntensity ??
    (state?.pendingHold
      ? (state.pendingIntensity as Intensity)
      : INTENSITY_STEADY);

  const placeWager = useCallback(async () => {
    if (!hostApi || !snapshot || !walletReady || actionLockRef.current) return;
    actionLockRef.current = true;
    const epoch = ++roundEpochRef.current;
    setError(null);
    setBusy(true);
    try {
      unlockAudio();
      const parsed = validateWagerInput(wagerInput, decimals);
      if (balance !== undefined && parsed > balance)
        throw new Error("Insufficient balance.");
      if (maxWager !== undefined && parsed > maxWager) {
        throw new Error(
          `Max wager right now: ${formatUnits(maxWager, decimals)} ${symbol}`,
        );
      }
      const reserved = maxReservedProfit(parsed);
      const allowed = snapshot.casino?.maxAllowedReservedProfit;
      if (allowed && reserved > BigInt(allowed)) {
        throw new Error("That wager is above the live house risk limit.");
      }

      heardRef.current = "";
      prevHoldsRef.current = 0;
      setState(null);
      setPayout(0n);
      setWager(parsed);
      setStatus("opening");
      setSessionId(null);
      playWager();

      const { sessionKey: key } = await hostApi.openSession({
        wager: parsed.toString(),
        gameData: EMPTY_HEX,
        randomnessRequestData: EMPTY_HEX,
      });
      if (epoch !== roundEpochRef.current) return;
      setSessionKey(key);
      // Brief beat so the round doesn't feel instant/flat after Start.
      await new Promise((r) => setTimeout(r, 80));
      if (epoch === roundEpochRef.current) setStatus("active");
    } catch (err) {
      if (epoch === roundEpochRef.current) {
        setStatus("idle");
        setError(
          err instanceof Error ? err.message : "Failed to open session.",
        );
      }
    } finally {
      if (epoch === roundEpochRef.current) setBusy(false);
      actionLockRef.current = false;
    }
  }, [
    hostApi,
    snapshot,
    walletReady,
    wagerInput,
    decimals,
    balance,
    maxWager,
    symbol,
  ]);

  const requestHold = useCallback(
    async (intensity: Intensity) => {
      if (!hostApi || !resolvedSessionId || busy || actionLockRef.current)
        return;
      actionLockRef.current = true;
      setError(null);
      setBusy(true);
      setPendingIntensity(intensity);
      setStatus("resolving");
      unlockAudio();
      playTension(intensity);
      try {
        await hostApi.submitAction({
          sessionId: resolvedSessionId,
          actionData: encodeHoldAction(intensity),
          randomnessRequestData: EMPTY_HEX,
        });
      } catch (err) {
        setStatus("active");
        setPendingIntensity(null);
        setError(err instanceof Error ? err.message : "Hold failed.");
      } finally {
        actionLockRef.current = false;
        setBusy(false);
      }
    },
    [hostApi, resolvedSessionId, busy],
  );

  const cashOut = useCallback(async () => {
    if (
      !hostApi ||
      !resolvedSessionId ||
      busy ||
      actionLockRef.current ||
      holds < 1
    )
      return;
    actionLockRef.current = true;
    setError(null);
    setBusy(true);
    unlockAudio();
    playButton();
    try {
      await hostApi.submitAction({
        sessionId: resolvedSessionId,
        actionData: encodeCashoutAction(),
        randomnessRequestData: EMPTY_HEX,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bank failed.");
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  }, [hostApi, resolvedSessionId, busy, holds]);

  const resetRound = () => {
    roundEpochRef.current += 1;
    stopAudio();
    setSessionKey(null);
    setSessionId(null);
    setState(null);
    setPayout(0n);
    setWager(0n);
    setStatus("idle");
    setError(null);
    setPendingIntensity(null);
    actionLockRef.current = false;
    heardRef.current = "";
    setShareState("idle");
  };

  const toggleMute = () => {
    unlockAudio();
    const next = !muted;
    persistMuted(next);
    setMuted(next);
    if (!next) playButton();
  };

  const shareResult = async () => {
    const text = shareResultText(
      currentMult,
      formatTokenAmountFloor(payout, decimals, 4),
      symbol,
    );
    try {
      if (navigator.share) {
        await navigator.share({ title: "Tug result", text });
        setShareState("shared");
      } else {
        await navigator.clipboard.writeText(text);
        setShareState("copied");
      }
    } catch (shareError) {
      if ((shareError as DOMException).name !== "AbortError")
        setError("Could not share this result.");
    }
  };

  // Clear pending intensity once we're back to an active choice or finished.
  useEffect(() => {
    if (
      status === "active" ||
      status === "idle" ||
      status === "banked" ||
      status === "snapped"
    ) {
      setPendingIntensity(null);
    }
  }, [status]);

  if (!hostApi || !snapshot) {
    return (
      <div className="shell boot">
        <div className="boot-card">
          <p className="boot-kicker">CHAIN CASINO</p>
          <h1>Tug</h1>
          <p>Connecting…</p>
        </div>
      </div>
    );
  }

  const inRound =
    status === "active" || status === "resolving" || status === "opening";
  const finished = status === "snapped" || status === "banked";
  const canHold =
    inRound &&
    status === "active" &&
    holds < MAX_HOLDS &&
    !!resolvedSessionId &&
    !busy;
  const canBank =
    inRound &&
    status === "active" &&
    holds >= 1 &&
    !!resolvedSessionId &&
    !busy;
  const balanceLabel = walletReady
    ? `${Number(formatUnits(balance ?? 0n, decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`
    : snapshot.wallet.status;

  const potentialLabel =
    potential > 0n
      ? `Bank now · ${formatTokenAmountFloor(potential, decimals, 4)} ${symbol}`
      : undefined;

  return (
    <div
      className={`shell theme-${snapshot.ui.theme === "light" ? "light" : "dark"}${shake ? " is-shake" : ""}`}
    >
      <header className="topbar">
        <div className="brand logo-group">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 32 32" width="28" height="28">
              <path
                d="M16 4c-1.2 5-3.2 8.5-3.2 12s2 7.5 3.2 12c1.2-4.5 3.2-8 3.2-12s-2-7.5-3.2-12z"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div className="brand-text">
            <p className="eyebrow">Hold or bank</p>
            <h1>Tug</h1>
          </div>
        </div>
        <div className="topbar-meta" role="status" aria-live="polite">
          {demoMode && <span className="pill demo demo-badge">Demo</span>}
          <button
            type="button"
            className="sound-toggle"
            aria-pressed={muted}
            aria-label={muted ? "Unmute game sounds" : "Mute game sounds"}
            onClick={toggleMute}
          >
            Sound {muted ? "off" : "on"}
          </button>
          <div className="balance-pill">
            <span className="balance-pill-label">Balance</span>
            <strong className="amount">{balanceLabel}</strong>
          </div>
        </div>
      </header>

      <main className={`layout${finished ? ` outcome-${status}` : ""}`}>
        <RopeStage
          holds={holds}
          beforeRound={status === "idle" || status === "opening"}
          visual={visual}
          pending={status === "resolving"}
          currentMult={holds > 0 ? currentMult : undefined}
          potentialLabel={potentialLabel}
          multPulse={multPulse}
          intensity={strainIntensity}
        />

        <aside className="console">
          <div
            className="console-card decision"
            aria-busy={status === "resolving" || status === "snapping"}
          >
            <div className="meter" aria-hidden>
              <div
                className="meter-fill"
                style={{ width: `${(holds / MAX_HOLDS) * 100}%` }}
              />
              <span>
                {holds}/{MAX_HOLDS} holds
              </span>
              <span className="mobile-rtp">95% RTP</span>
            </div>

            {(status === "idle" || status === "opening") && (
              <>
                <label className="wager-field">
                  <span>Wager</span>
                  <div className="wager-row">
                    <input
                      type="number"
                      min={decimals >= 2 ? "0.01" : "1"}
                      max="1000"
                      step="0.01"
                      inputMode="decimal"
                      value={wagerInput}
                      disabled={!walletReady || busy}
                      onChange={(e) => setWagerInput(e.target.value)}
                    />
                    <em>{symbol}</em>
                  </div>
                </label>
                <div className="presets">
                  {WAGER_PRESETS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={wagerInput === v ? "on" : ""}
                      disabled={!walletReady || busy}
                      onClick={() => {
                        unlockAudio();
                        playButton();
                        setWagerInput(v);
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn primary xl"
                  disabled={!walletReady || busy}
                  onClick={() => void placeWager()}
                >
                  {busy ? "Locking wager…" : "Start round"}
                </button>
              </>
            )}

            {inRound && status !== "opening" && (
              <>
                <div className="choice-copy">
                  <p>
                    Current · <strong>{currentMult}</strong>
                    {potential > 0n && (
                      <span className="muted">
                        {" "}
                        · bank now for{" "}
                        {formatTokenAmountFloor(potential, decimals, 3)}{" "}
                        {symbol}
                      </span>
                    )}
                  </p>
                  <p className="risk">
                    {status === "resolving"
                      ? "Rope under load…"
                      : "Choose how hard to pull — risk resets every hold."}
                  </p>
                </div>

                {holds < MAX_HOLDS && (
                  <div className="intensity-grid">
                    {INTENSITIES.map((row) => {
                      const nextMultWad = previewMultiplierAfterHold(
                        cumNum,
                        cumDen,
                        row.id,
                      );
                      const nextPay =
                        wager > 0n ? (wager * nextMultWad) / WAD : 0n;
                      const failPct =
                        100 - Number(row.pDisplay.replace("%", ""));
                      return (
                        <button
                          key={row.id}
                          type="button"
                          className={`btn intensity xl intensity-${row.label.toLowerCase()}${
                            pendingIntensity === row.id ? " pulling" : ""
                          }`}
                          disabled={!canHold}
                          onClick={() => void requestHold(row.id)}
                        >
                          <span className="btn-kicker">
                            {status === "resolving" &&
                            pendingIntensity === row.id
                              ? "Pulling…"
                              : `${failPct}% snap`}
                          </span>
                          <span className="btn-title">{row.label}</span>
                          <span className="btn-survival">
                            {row.pDisplay} survive
                          </span>
                          <span className="btn-sub">
                            → {formatMultiplierWad(nextMultWad)}
                            {nextPay > 0n &&
                              ` · ${formatTokenAmountFloor(nextPay, decimals, 2)} ${symbol}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  className="btn secure xl bank-full"
                  disabled={!canBank}
                  onClick={() => void cashOut()}
                >
                  <span className="btn-kicker">Take it</span>
                  <span className="btn-title">Bank</span>
                  <span className="btn-sub">
                    {canBank
                      ? `${currentMult} · ${formatTokenAmountFloor(potential, decimals, 3)} ${symbol}`
                      : "Survive one hold first"}
                  </span>
                </button>
              </>
            )}

            {status === "snapping" && (
              <div className="snap-progress" role="status">
                <span>Rope snapped</span>
                <strong>Wager lost</strong>
              </div>
            )}

            {finished && (
              <>
                <div className={`outcome-card ${status}`}>
                  {status === "snapped" ? (
                    <>
                      <p className="outcome-kicker">Rope snapped</p>
                      <h2>Wager lost</h2>
                      <p>The rope gave out. Nothing paid.</p>
                    </>
                  ) : (
                    <>
                      <p className="outcome-kicker">
                        Gross payout · Hold {holds}
                      </p>
                      <h2>
                        {formatTokenAmountFloor(payout, decimals, 4)} {symbol}
                      </h2>
                      <p>Locked at {currentMult}</p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="btn primary xl"
                  onClick={resetRound}
                >
                  Play again
                </button>
                {status === "banked" &&
                  multiplierFromCum(cumNum, cumDen) >= 15n * 10n ** 17n && (
                    <button
                      type="button"
                      className="share-result"
                      onClick={() => void shareResult()}
                    >
                      {shareState === "shared"
                        ? "Shared"
                        : shareState === "copied"
                          ? "Copied"
                          : "Share result"}
                    </button>
                  )}
              </>
            )}

            {error && <p className="error">{error}</p>}
          </div>

          {stats.roundsPlayed > 0 && !inRound && (
            <dl className="session-stats" aria-label="This session">
              <div>
                <dt>Rounds</dt>
                <dd>{stats.roundsPlayed}</dd>
              </div>
              <div>
                <dt>Best</dt>
                <dd>{formatMultiplierWad(BigInt(stats.bestMultiplierWad))}</dd>
              </div>
              <div>
                <dt>Biggest win</dt>
                <dd>
                  {formatTokenAmountFloor(
                    BigInt(stats.biggestWin),
                    decimals,
                    2,
                  )}
                </dd>
              </div>
              <div>
                <dt>Streak</dt>
                <dd>{stats.survivalStreak}</dd>
              </div>
            </dl>
          )}

          <div className="console-card ladder">
            <div className="ladder-head">
              <h2>Grips</h2>
              <span>95% RTP</span>
            </div>
            <ol>
              {INTENSITIES.map((row) => (
                <li
                  key={row.id}
                  className={
                    pendingIntensity === row.id ||
                    (state?.pendingHold && state.pendingIntensity === row.id)
                      ? "on"
                      : ""
                  }
                >
                  <span className="n">{row.label[0]}</span>
                  <span className="bar">
                    <i
                      style={{
                        width: `${100 - Number(row.pDisplay.replace("%", ""))}%`,
                      }}
                    />
                  </span>
                  <span className="m">
                    {row.label} · {100 - Number(row.pDisplay.replace("%", ""))}%
                    snap
                  </span>
                </li>
              ))}
            </ol>
            <p className="fine">
              Mult = RTP ÷ cumulative survival. Hold 5 auto-banks. Re-pick risk
              every tug.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
