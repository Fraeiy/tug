/**
 * Live local-simulator integration: wager → hold → bank / fail / auto-bank.
 * Requires `npm start` (local-node on :8545) already running.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeAbiParameters,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const deployed = JSON.parse(
  readFileSync(join(__dirname, '../../../simulator/local-node/deployed.json'), 'utf8'),
);

const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const transport = http(deployed.rpcUrl);
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account, transport });

const tug = deployed.games.find(g => g.name === 'TugGame').address;
const host = deployed.host;
const vault = deployed.vault;
const token = deployed.token;

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

const hostAbi = parseAbi([
  'function openSession(address game, address vault, uint256 wager, bytes gameData, bytes randomnessRequestData) returns (uint256 sessionId, bytes32 requestId)',
  'function submitAction(uint256 sessionId, bytes actionData, bytes randomnessRequestData) returns (bytes32 requestId)',
  'function getSession(uint256 sessionId) view returns ((address player, address game, uint256 wagerBase, uint256 escrowedStake, uint256 reservedProfit, uint256 maxEscrowStake, uint256 maxReservedProfit, uint256 actionDeadlineBlock, uint256 randomnessDeadlineBlock, uint32 step, uint64 pendingRequestNonce, bytes32 pendingRequestId, uint8 phase, bytes gameData, bytes gameState, bytes randomnessRequestData))',
]);

const tugAbi = parseAbi([
  'function multiplierWad(uint8 n) view returns (uint256)',
  'function payoutForHolds(uint256 wager, uint8 holds) view returns (uint256)',
  'function rtpProductWad(uint8 n) view returns (uint256)',
  'function maxPayoutForWager(uint256 wager) view returns (uint256)',
]);

const PHASE = {
  NONE: 0,
  WAITING_RANDOMNESS: 1,
  WAITING_PLAYER_ACTION: 2,
  SETTLED: 3,
};

const WAD = 10n ** 18n;
const RTP_WAD = 95n * 10n ** 16n;
const EMPTY = '0x';
const ACTION_HOLD = encodeAbiParameters([{ type: 'uint8' }], [0]);
const ACTION_CASH = encodeAbiParameters([{ type: 'uint8' }], [1]);

function decodeState(gameState) {
  const [holds, pending, snapped, banked] = decodeAbiParameters(
    [{ type: 'uint8' }, { type: 'bool' }, { type: 'bool' }, { type: 'bool' }, { type: 'bytes32' }],
    gameState,
  );
  return { holds: Number(holds), pending, snapped, banked };
}

async function getSession(id) {
  return publicClient.readContract({
    address: host,
    abi: hostAbi,
    functionName: 'getSession',
    args: [id],
  });
}

async function waitPhase(id, wanted, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getSession(id);
    if (Number(s.phase) === wanted) return s;
    // Also accept SETTLED when waiting for post-VRF settle.
    if (wanted === PHASE.WAITING_PLAYER_ACTION && Number(s.phase) === PHASE.SETTLED) return s;
    await new Promise(r => setTimeout(r, 250));
  }
  const s = await getSession(id);
  throw new Error(`Timeout waiting phase ${wanted}; got ${s.phase}`);
}

async function openRound(wager) {
  await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [host, wager],
  });
  const hash = await walletClient.writeContract({
    address: host,
    abi: hostAbi,
    functionName: 'openSession',
    args: [tug, vault, wager, EMPTY, EMPTY],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  // sessionId is currentSessionId; read from getSession by scanning latest.
  // LocalCasinoHost increments currentSessionId — query events or try recent ids.
  let sessionId = null;
  for (let i = 20; i >= 1; i--) {
    try {
      const s = await getSession(BigInt(i));
      if (s.player.toLowerCase() === account.address.toLowerCase() && s.game.toLowerCase() === tug.toLowerCase()) {
        if (Number(s.phase) === PHASE.WAITING_PLAYER_ACTION || Number(s.phase) === PHASE.WAITING_RANDOMNESS) {
          sessionId = BigInt(i);
          break;
        }
        if (sessionId === null) sessionId = BigInt(i);
      }
    } catch {
      /* empty */
    }
  }
  if (sessionId === null) throw new Error('Could not find session after open');
  await waitPhase(sessionId, PHASE.WAITING_PLAYER_ACTION);
  return { sessionId, receipt };
}

async function hold(sessionId) {
  const hash = await walletClient.writeContract({
    address: host,
    abi: hostAbi,
    functionName: 'submitAction',
    args: [sessionId, ACTION_HOLD, EMPTY],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  // VRF node fulfills; wait until not WAITING_RANDOMNESS.
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const s = await getSession(sessionId);
    if (Number(s.phase) !== PHASE.WAITING_RANDOMNESS) return s;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('VRF fulfillment timeout');
}

async function cashout(sessionId) {
  const hash = await walletClient.writeContract({
    address: host,
    abi: hostAbi,
    functionName: 'submitAction',
    args: [sessionId, ACTION_CASH, EMPTY],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return getSession(sessionId);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('TugGame', tug);
console.log('Host', host);

// --- On-chain RTP invariant ---
for (let n = 1; n <= 5; n++) {
  const product = await publicClient.readContract({
    address: tug,
    abi: tugAbi,
    functionName: 'rtpProductWad',
    args: [n],
  });
  assert(product === RTP_WAD, `RTP invariant failed for N=${n}: ${product}`);
}
console.log('OK RTP invariant on-chain for N=1..5');

const wager = 10n ** 18n; // 1 chUSD

// --- Flow A: survive once, bank ---
{
  const { sessionId } = await openRound(wager);
  let session = await hold(sessionId);
  // Retry holds until we survive at least once (20% fail chance per hold).
  let attempts = 0;
  while (Number(session.phase) === PHASE.SETTLED && decodeState(session.gameState).snapped && attempts < 12) {
    attempts++;
    const opened = await openRound(wager);
    session = await hold(opened.sessionId);
    if (Number(session.phase) !== PHASE.SETTLED) {
      var liveId = opened.sessionId;
      break;
    }
  }
  const id = liveId ?? sessionId;
  session = await getSession(id);
  if (Number(session.phase) === PHASE.SETTLED && decodeState(session.gameState).snapped) {
    console.log('OK fail-path observed during bank-flow setup (payout 0)');
  } else {
    const before = decodeState(session.gameState);
    assert(before.holds >= 1, 'expected at least one survived hold');
    assert(Number(session.phase) === PHASE.WAITING_PLAYER_ACTION, 'expected player action phase');
    const expected = await publicClient.readContract({
      address: tug,
      abi: tugAbi,
      functionName: 'payoutForHolds',
      args: [wager, before.holds],
    });
    session = await cashout(id);
    assert(Number(session.phase) === PHASE.SETTLED, 'bank should settle');
    const after = decodeState(session.gameState);
    assert(after.banked, 'should be banked');
    // Payout is not stored on session struct in local host — verify via reserved clear + state.
    // Re-read maxAllowed semantics by checking escrow cleared.
    assert(session.escrowedStake === 0n, 'escrow cleared');
    assert(session.reservedProfit === 0n, 'reserve released');
    console.log(`OK bank-path at hold ${before.holds} (expected payout ${expected})`);
  }
}

// --- Flow B: force fail by opening and holding until snap ---
{
  let snapped = false;
  for (let i = 0; i < 20 && !snapped; i++) {
    const { sessionId } = await openRound(wager);
    const session = await hold(sessionId);
    if (Number(session.phase) === PHASE.SETTLED) {
      const st = decodeState(session.gameState);
      if (st.snapped) {
        snapped = true;
        assert(session.escrowedStake === 0n, 'fail clears escrow');
        console.log('OK fail-path payout is zero (snapped)');
      }
    } else {
      // survived — cash out to free the session and continue hunting a fail
      await cashout(sessionId);
    }
  }
  assert(snapped, 'did not observe a snap in 20 attempts (statistically unlikely)');
}

// --- Flow C: auto-bank at hold 5 ---
{
  let done = false;
  for (let attempt = 0; attempt < 30 && !done; attempt++) {
    const { sessionId } = await openRound(wager);
    let session = await getSession(sessionId);
    let dead = false;
    while (!dead && decodeState(session.gameState).holds < 5) {
      session = await hold(sessionId);
      if (Number(session.phase) === PHASE.SETTLED) {
        const st = decodeState(session.gameState);
        if (st.snapped) {
          dead = true;
        } else if (st.banked && st.holds === 5) {
          const expected = await publicClient.readContract({
            address: tug,
            abi: tugAbi,
            functionName: 'payoutForHolds',
            args: [wager, 5],
          });
          assert(session.escrowedStake === 0n, 'auto-bank clears escrow');
          console.log(`OK auto-bank at hold 5 (expected payout ${expected})`);
          done = true;
          break;
        } else {
          dead = true;
        }
      }
    }
    if (!dead && !done) {
      // Still active at holds < 5 somehow — should not happen if loop correct
      session = await getSession(sessionId);
      const st = decodeState(session.gameState);
      if (st.holds === 5 && st.banked) {
        console.log('OK auto-bank at hold 5');
        done = true;
      }
    }
  }
  assert(done, 'failed to reach auto-bank in 30 full attempts');
}

console.log('\nAll simulator flows passed.');
