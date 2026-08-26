import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { computeMaxWager } from '@chain/casino-sdk/guest';

import { useCasinoHost } from './lib/useCasinoHost';
import {
  EMPTY_HEX,
  MAX_HOLDS,
  MULTIPLIER_TABLE,
  PHASE_SETTLED,
  PHASE_WAITING_PLAYER_ACTION,
  PHASE_WAITING_RANDOMNESS,
  decodeGameState,
  encodeCashoutAction,
  encodeHoldAction,
  formatMultiplier,
  maxReservedProfit,
  payoutForHolds,
  type TugState,
} from './lib/tug';
import { playBank, playCreak, playHoldSurvived, playSnap, playWager } from './lib/audio';
import { RopeStage, type RopeVisual } from './components/RopeStage';

type RoundStatus = 'idle' | 'opening' | 'active' | 'resolving' | 'snapped' | 'banked';

const WAGER_PRESETS = ['1', '5', '10', '25', '50'];

export function App() {
  const { hostApi, snapshot, demoMode } = useCasinoHost();
  const [wagerInput, setWagerInput] = useState('10');
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<RoundStatus>('idle');
  const [state, setState] = useState<TugState | null>(null);
  const [payout, setPayout] = useState<bigint>(0n);
  const [wager, setWager] = useState<bigint>(0n);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const heardRef = useRef<string>('');
  const creakRef = useRef<number | null>(null);

  const decimals = snapshot?.token.decimals ?? 18;
  const symbol = snapshot?.token.symbol ?? 'chUSD';
  const walletReady = snapshot?.wallet.status === 'ready';
  const balance = useMemo(() => {
    const raw = snapshot?.balances.smartVaultBalance;
    return raw !== undefined ? BigInt(raw) : undefined;
  }, [snapshot?.balances.smartVaultBalance]);

  const maxWager = useMemo(() => {
    if (!snapshot) return undefined;
    return computeMaxWager(snapshot, { maxMultiplierX: MULTIPLIER_TABLE[5] });
  }, [snapshot]);

  const activeRow = useMemo(() => {
    if (!snapshot || !sessionKey) return null;
    return snapshot.sessions.items.find(item => item.sessionKey === sessionKey) ?? null;
  }, [snapshot, sessionKey]);

  const resolvedSessionId =
    sessionId ?? activeRow?.sessionId ?? (sessionKey?.includes(':') ? sessionKey.split(':')[1] : null);

  useEffect(() => {
    if (!activeRow) return;
    const decoded = activeRow.raw.gameState ? decodeGameState(activeRow.raw.gameState) : null;
    if (decoded) setState(decoded);
    if (activeRow.sessionId) setSessionId(activeRow.sessionId);

    if (activeRow.phase === PHASE_WAITING_RANDOMNESS || decoded?.pendingHold) {
      setStatus('resolving');
      return;
    }

    if (activeRow.isSettled || activeRow.phase === PHASE_SETTLED) {
      const pay = activeRow.payout !== undefined ? BigInt(activeRow.payout) : 0n;
      setPayout(pay);
      if (decoded?.snapped) setStatus('snapped');
      else if (decoded?.banked || pay > 0n) setStatus('banked');
      else if (activeRow.payout !== undefined && pay === 0n) setStatus('snapped');
      return;
    }

    if (activeRow.phase === PHASE_WAITING_PLAYER_ACTION) {
      setStatus('active');
    }
  }, [activeRow]);

  // Creak loop while resolving.
  useEffect(() => {
    if (status !== 'resolving') {
      if (creakRef.current) window.clearInterval(creakRef.current);
      creakRef.current = null;
      return;
    }
    playCreak();
    creakRef.current = window.setInterval(() => playCreak(), 420);
    return () => {
      if (creakRef.current) window.clearInterval(creakRef.current);
    };
  }, [status]);

  useEffect(() => {
    if (!state) return;
    if (status === 'snapped') {
      const key = `snap:${sessionId}`;
      if (heardRef.current !== key) {
        heardRef.current = key;
        playSnap();
        setShake(true);
        window.setTimeout(() => setShake(false), 520);
      }
    } else if (status === 'banked') {
      const key = `bank:${sessionId}:${state.holdsSurvived}`;
      if (heardRef.current !== key) {
        heardRef.current = key;
        playBank();
      }
    } else if (status === 'active' && state.holdsSurvived > 0 && !state.pendingHold) {
      const key = `hold:${sessionId}:${state.holdsSurvived}`;
      if (heardRef.current !== key) {
        heardRef.current = key;
        playHoldSurvived(state.holdsSurvived);
      }
    }
  }, [status, state, sessionId]);

  useEffect(() => {
    if (status !== 'banked' || !resolvedSessionId || !hostApi) return;
    const t = window.setTimeout(() => {
      void hostApi.revealOutcome({ sessionId: resolvedSessionId }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(t);
  }, [status, resolvedSessionId, hostApi]);

  const visual: RopeVisual = useMemo(() => {
    if (status === 'snapped') return 'snap';
    if (status === 'banked') return 'banked';
    if (status === 'resolving') return 'fraying';
    if ((state?.holdsSurvived ?? 0) > 0) return 'tension';
    return 'idle';
  }, [status, state]);

  const holds = state?.holdsSurvived ?? 0;
  const currentMult = holds > 0 ? formatMultiplier(holds) : '—';
  const nextMult = holds < MAX_HOLDS ? formatMultiplier(holds + 1) : 'AUTO';
  const potential = holds > 0 && wager > 0n ? payoutForHolds(wager, holds) : 0n;
  const nextPayout = holds < MAX_HOLDS && wager > 0n ? payoutForHolds(wager, holds + 1) : 0n;

  const placeWager = useCallback(async () => {
    if (!hostApi || !snapshot || !walletReady) return;
    setError(null);
    setBusy(true);
    try {
      const parsed = parseUnits(wagerInput, decimals);
      if (parsed <= 0n) throw new Error('Enter a wager greater than zero.');
      if (balance !== undefined && parsed > balance) throw new Error('Insufficient balance.');
      if (maxWager !== undefined && parsed > maxWager) {
        throw new Error(`Max wager right now: ${formatUnits(maxWager, decimals)} ${symbol}`);
      }
      const reserved = maxReservedProfit(parsed);
      const allowed = snapshot.casino?.maxAllowedReservedProfit;
      if (allowed && reserved > BigInt(allowed)) {
        throw new Error('That wager is above the live house risk limit.');
      }

      heardRef.current = '';
      setState(null);
      setPayout(0n);
      setWager(parsed);
      setStatus('opening');
      setSessionId(null);
      playWager();

      const { sessionKey: key } = await hostApi.openSession({
        wager: parsed.toString(),
        gameData: EMPTY_HEX,
        randomnessRequestData: EMPTY_HEX,
      });
      setSessionKey(key);
      setStatus('active');
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Failed to open session.');
    } finally {
      setBusy(false);
    }
  }, [hostApi, snapshot, walletReady, wagerInput, decimals, balance, maxWager, symbol]);

  const requestHold = useCallback(async () => {
    if (!hostApi || !resolvedSessionId || busy) return;
    setError(null);
    setBusy(true);
    setStatus('resolving');
    try {
      await hostApi.submitAction({
        sessionId: resolvedSessionId,
        actionData: encodeHoldAction(),
        randomnessRequestData: EMPTY_HEX,
      });
    } catch (err) {
      setStatus('active');
      setError(err instanceof Error ? err.message : 'Hold failed.');
    } finally {
      setBusy(false);
    }
  }, [hostApi, resolvedSessionId, busy]);

  const cashOut = useCallback(async () => {
    if (!hostApi || !resolvedSessionId || busy || holds < 1) return;
    setError(null);
    setBusy(true);
    try {
      await hostApi.submitAction({
        sessionId: resolvedSessionId,
        actionData: encodeCashoutAction(),
        randomnessRequestData: EMPTY_HEX,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bank failed.');
    } finally {
      setBusy(false);
    }
  }, [hostApi, resolvedSessionId, busy, holds]);

  const resetRound = () => {
    setSessionKey(null);
    setSessionId(null);
    setState(null);
    setPayout(0n);
    setWager(0n);
    setStatus('idle');
    setError(null);
    heardRef.current = '';
  };

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

  const inRound = status === 'active' || status === 'resolving' || status === 'opening';
  const finished = status === 'snapped' || status === 'banked';
  const canHold = inRound && status === 'active' && holds < MAX_HOLDS && !!resolvedSessionId && !busy;
  const canBank = inRound && status === 'active' && holds >= 1 && !!resolvedSessionId && !busy;
  const balanceLabel = walletReady
    ? `${Number(formatUnits(balance ?? 0n, decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`
    : snapshot.wallet.status;

  const potentialLabel =
    potential > 0n
      ? `Bank now · ${Number(formatUnits(potential, decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`
      : undefined;

  return (
    <div
      className={`shell theme-${snapshot.ui.theme === 'light' ? 'light' : 'dark'}${shake ? ' is-shake' : ''}`}
    >
      {/* Always-visible balance (fixed on mobile so it never scrolls away) */}
      <div className="balance-float" role="status" aria-live="polite">
        <span className="balance-float-label">Balance</span>
        <strong className="balance-float-value">{balanceLabel}</strong>
        {demoMode && <span className="pill demo compact">Demo</span>}
      </div>

      <header className="topbar">
        <div className="brand">
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
          <div>
            <p className="eyebrow">Original · Hold or bank</p>
            <h1>Tug</h1>
          </div>
        </div>
        <div className="topbar-meta topbar-meta-desktop">
          {demoMode && <span className="pill demo">Demo</span>}
          <span className="pill balance">{balanceLabel}</span>
        </div>
      </header>

      <main className={`layout${finished ? ` outcome-${status}` : ''}`}>
        <RopeStage
          holds={holds}
          visual={visual}
          pending={status === 'resolving'}
          currentMult={holds > 0 ? currentMult : undefined}
          potentialLabel={potentialLabel}
        />

        <aside className="console">
          <div className="console-card decision">
            <div className="meter" aria-hidden>
              <div className="meter-fill" style={{ width: `${(holds / MAX_HOLDS) * 100}%` }} />
              <span>
                {holds}/{MAX_HOLDS} holds
              </span>
            </div>

            {(status === 'idle' || status === 'opening') && (
              <>
                <label className="wager-field">
                  <span>Wager</span>
                  <div className="wager-row">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={wagerInput}
                      disabled={!walletReady || busy}
                      onChange={e => setWagerInput(e.target.value)}
                    />
                    <em>{symbol}</em>
                  </div>
                </label>
                <div className="presets">
                  {WAGER_PRESETS.map(v => (
                    <button
                      key={v}
                      type="button"
                      className={wagerInput === v ? 'on' : ''}
                      disabled={!walletReady || busy}
                      onClick={() => setWagerInput(v)}
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
                  {busy ? 'Locking wager…' : 'Start round'}
                </button>
                <p className="coach">
                  Each hold has an <strong>80%</strong> chance to climb the multiplier. After any
                  climb you can bank — or tug again.
                </p>
              </>
            )}

            {inRound && status !== 'opening' && (
              <>
                <div className="choice-copy">
                  <p>
                    Next hold → <strong>{nextMult}</strong>
                    {nextPayout > 0n && (
                      <>
                        {' '}
                        <span className="muted">
                          ({Number(formatUnits(nextPayout, decimals)).toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}{' '}
                          {symbol} if you make it)
                        </span>
                      </>
                    )}
                  </p>
                  <p className="risk">20% chance this tug snaps the rope.</p>
                </div>
                <div className="choice-grid">
                  <button
                    type="button"
                    className="btn risk xl"
                    disabled={!canHold}
                    onClick={() => void requestHold()}
                  >
                    <span className="btn-kicker">Risk it</span>
                    <span className="btn-title">
                      {status === 'resolving' ? 'Pulling…' : 'Hold'}
                    </span>
                    <span className="btn-sub">{nextMult} · 80%</span>
                  </button>
                  <button
                    type="button"
                    className="btn secure xl"
                    disabled={!canBank}
                    onClick={() => void cashOut()}
                  >
                    <span className="btn-kicker">Take it</span>
                    <span className="btn-title">Bank</span>
                    <span className="btn-sub">
                      {canBank
                        ? `${currentMult} · ${Number(formatUnits(potential, decimals)).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${symbol}`
                        : 'Survive one hold first'}
                    </span>
                  </button>
                </div>
              </>
            )}

            {finished && (
              <>
                <div className={`outcome-card ${status}`}>
                  {status === 'snapped' ? (
                    <>
                      <p className="outcome-kicker">Snapped</p>
                      <h2>Wager lost</h2>
                      <p>The rope gave out. Nothing paid.</p>
                    </>
                  ) : (
                    <>
                      <p className="outcome-kicker">Banked · Hold {holds}</p>
                      <h2>
                        +{Number(formatUnits(payout, decimals)).toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}{' '}
                        {symbol}
                      </h2>
                      <p>Locked at {currentMult}</p>
                    </>
                  )}
                </div>
                <button type="button" className="btn primary xl" onClick={resetRound}>
                  Play again
                </button>
              </>
            )}

            {error && <p className="error">{error}</p>}
          </div>

          <div className="console-card ladder">
            <div className="ladder-head">
              <h2>Climb</h2>
              <span>95% RTP</span>
            </div>
            <ol>
              {[1, 2, 3, 4, 5].map(n => (
                <li key={n} className={holds === n ? 'on' : holds > n ? 'done' : ''}>
                  <span className="n">H{n}</span>
                  <span className="bar">
                    <i style={{ width: `${(n / MAX_HOLDS) * 100}%` }} />
                  </span>
                  <span className="m">{formatMultiplier(n)}</span>
                </li>
              ))}
            </ol>
            <p className="fine">Hold 5 auto-banks. No unbounded risk.</p>
          </div>
        </aside>
      </main>
    </div>
  );
}
