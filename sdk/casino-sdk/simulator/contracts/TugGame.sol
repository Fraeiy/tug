// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { ICasinoGameV2, SessionContext, SessionPhase, StepResult } from '../../solidity/ICasinoGameV2.sol';

/**
 * @title TugGame
 * @notice Hold-or-bank tension game: chained binary VRF checks with a stopping time.
 *         Survive holds (p = 0.80) to climb the multiplier ladder, then bank — or risk
 *         another hold. Fail snaps the rope and loses the wager. Hold 5 auto-banks.
 *
 * Math (exact):
 *   p = 4/5 = 0.80
 *   RTP = 0.95
 *   mult(N) = RTP / p^N  for N = 1..5
 *   ⇒ p^N * mult(N) == RTP for every N
 */
contract TugGame is ICasinoGameV2 {
  uint256 private constant WAD = 1e18;
  uint256 private constant RTP_WAD = 95e16; // 0.95
  uint256 private constant P_NUM = 4;
  uint256 private constant P_DEN = 5;
  uint8 public constant MAX_HOLDS = 5;

  uint8 private constant ACTION_HOLD = 0;
  uint8 private constant ACTION_CASHOUT = 1;

  error TugGame__InvalidAction();
  error TugGame__NothingToBank();
  error TugGame__HoldPending();
  error TugGame__NoPendingHold();
  error TugGame__MaxHoldsReached();
  error TugGame__BadGameData();

  /// @dev Opaque session state stored in `SessionContext.gameState`.
  struct TugState {
    uint8 holdsSurvived;
    bool pendingHold;
    bool snapped;
    bool banked;
    bytes32 lastRandomness;
  }

  // -------------------------------------------------------------------------
  // Math
  // -------------------------------------------------------------------------

  /// @notice Survive probability of one hold, WAD-scaled (0.80e18).
  function surviveProbabilityWad() public pure returns (uint256) {
    return (WAD * P_NUM) / P_DEN;
  }

  /// @notice p^N in WAD for N = 1..5.
  function pPowWad(uint8 n) public pure returns (uint256) {
    require(n >= 1 && n <= MAX_HOLDS, 'TugGame: bad N');
    uint256 pow = WAD;
    for (uint8 i = 0; i < n; i++) {
      pow = (pow * P_NUM) / P_DEN;
    }
    return pow;
  }

  /// @notice mult(N) = RTP / p^N, WAD-scaled.
  function multiplierWad(uint8 n) public pure returns (uint256) {
    return (RTP_WAD * WAD) / pPowWad(n);
  }

  /// @notice Total player payout after banking at hold N: wager * mult(N).
  function payoutForHolds(uint256 wager, uint8 holds) public pure returns (uint256) {
    if (holds == 0) return 0;
    return (wager * multiplierWad(holds)) / WAD;
  }

  /// @notice Max payout path is auto-bank at hold 5.
  function maxPayoutForWager(uint256 wager) public pure returns (uint256) {
    return payoutForHolds(wager, MAX_HOLDS);
  }

  /// @dev Exact RTP invariant used by unit tests: p^N * mult(N) == RTP (WAD).
  function rtpProductWad(uint8 n) public pure returns (uint256) {
    return (pPowWad(n) * multiplierWad(n)) / WAD;
  }

  // -------------------------------------------------------------------------
  // ICasinoGameV2
  // -------------------------------------------------------------------------

  function quoteCaps(
    uint256 wager,
    bytes calldata /* gameData */
  ) external pure returns (uint256 maxEscrowStake, uint256 maxReservedProfit) {
    uint256 maxPayout = maxPayoutForWager(wager);
    maxEscrowStake = wager;
    maxReservedProfit = maxPayout > wager ? maxPayout - wager : 0;
  }

  function quoteRiskParams(
    uint256 wager,
    bytes calldata /* gameData */
  )
    external
    pure
    returns (
      uint256 maxPayout,
      uint256 probabilityWad,
      uint256 expectedPayout,
      uint256 subJackpotVarianceScaled
    )
  {
    maxPayout = maxPayoutForWager(wager);
    // Probability of reaching the max-payout path (survive all 5 holds).
    probabilityWad = pPowWad(MAX_HOLDS);
    expectedPayout = (wager * RTP_WAD) / WAD;
    subJackpotVarianceScaled = 0;
  }

  function onSessionStart(
    SessionContext calldata ctx
  ) external pure returns (StepResult memory stepResult) {
    if (ctx.gameData.length != 0) revert TugGame__BadGameData();

    uint256 maxPayout = maxPayoutForWager(ctx.wagerBase);
    uint256 maxReservedProfit = maxPayout > ctx.wagerBase ? maxPayout - ctx.wagerBase : 0;

    TugState memory state = TugState({
      holdsSurvived: 0,
      pendingHold: false,
      snapped: false,
      banked: false,
      lastRandomness: bytes32(0)
    });

    stepResult.newGameState = abi.encode(state);
    stepResult.escrowDelta = 0;
    stepResult.reservedProfitDelta = int256(maxReservedProfit);
    stepResult.nextPhase = SessionPhase.WAITING_PLAYER_ACTION;
    stepResult.requestRandomnessNow = false;
    stepResult.payout = 0;
  }

  function onPlayerAction(
    SessionContext calldata ctx,
    bytes calldata actionData
  ) external pure returns (StepResult memory stepResult) {
    TugState memory state = abi.decode(ctx.gameState, (TugState));
    if (state.pendingHold) revert TugGame__HoldPending();
    if (state.snapped || state.banked) revert TugGame__InvalidAction();

    uint8 action = _decodeAction(actionData);

    if (action == ACTION_HOLD) {
      if (state.holdsSurvived >= MAX_HOLDS) revert TugGame__MaxHoldsReached();
      state.pendingHold = true;
      stepResult.newGameState = abi.encode(state);
      stepResult.escrowDelta = 0;
      stepResult.reservedProfitDelta = 0;
      stepResult.nextPhase = SessionPhase.WAITING_RANDOMNESS;
      stepResult.requestRandomnessNow = true;
      stepResult.payout = 0;
      return stepResult;
    }

    if (action == ACTION_CASHOUT) {
      if (state.holdsSurvived == 0) revert TugGame__NothingToBank();
      return _settleBank(ctx, state);
    }

    revert TugGame__InvalidAction();
  }

  function onRandomness(
    SessionContext calldata ctx,
    bytes32 randomness
  ) external pure returns (StepResult memory stepResult) {
    TugState memory state = abi.decode(ctx.gameState, (TugState));
    if (!state.pendingHold) revert TugGame__NoPendingHold();

    state.pendingHold = false;
    state.lastRandomness = randomness;

    bool survived = _survived(randomness);
    if (!survived) {
      state.snapped = true;
      stepResult.newGameState = abi.encode(state);
      stepResult.escrowDelta = 0;
      // Facet finalize zeros reservedProfit; delta 0 keeps accounting simple.
      stepResult.reservedProfitDelta = 0;
      stepResult.nextPhase = SessionPhase.SETTLED;
      stepResult.requestRandomnessNow = false;
      stepResult.payout = 0;
      return stepResult;
    }

    state.holdsSurvived += 1;

    // Hold 5 auto-banks — no unbounded risk.
    if (state.holdsSurvived == MAX_HOLDS) {
      return _settleBank(ctx, state);
    }

    stepResult.newGameState = abi.encode(state);
    stepResult.escrowDelta = 0;
    stepResult.reservedProfitDelta = 0;
    stepResult.nextPhase = SessionPhase.WAITING_PLAYER_ACTION;
    stepResult.requestRandomnessNow = false;
    stepResult.payout = 0;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  function _settleBank(
    SessionContext calldata ctx,
    TugState memory state
  ) private pure returns (StepResult memory stepResult) {
    state.banked = true;
    state.pendingHold = false;
    uint256 payout = payoutForHolds(ctx.wagerBase, state.holdsSurvived);

    stepResult.newGameState = abi.encode(state);
    stepResult.escrowDelta = 0;
    // Keep reservedProfit intact through _finalizeSession's payout cap check
    // (escrow + reserved >= payout). Finalize zeros the reserve afterward,
    // releasing any unused portion automatically.
    stepResult.reservedProfitDelta = 0;
    stepResult.nextPhase = SessionPhase.SETTLED;
    stepResult.requestRandomnessNow = false;
    stepResult.payout = payout;
  }

  /// @dev Exact p = 4/5 via unbiased modulo on the VRF word.
  function _survived(bytes32 randomness) private pure returns (bool) {
    return uint256(randomness) % P_DEN < P_NUM;
  }

  function _decodeAction(bytes calldata actionData) private pure returns (uint8 action) {
    if (actionData.length == 0) revert TugGame__InvalidAction();
    (action) = abi.decode(actionData, (uint8));
  }
}
