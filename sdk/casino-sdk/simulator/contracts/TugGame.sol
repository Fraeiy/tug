// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { ICasinoGameV2, SessionContext, SessionPhase, StepResult } from '../../solidity/ICasinoGameV2.sol';

/**
 * @title TugGame
 * @notice Hold-or-bank with per-hold grip intensity.
 *         Ease (90%) / Steady (80%) / Haul (65%). Cumulative survival is tracked
 *         as an exact rational cumNum/cumDen. Bankable mult = RTP * den / num.
 *         Fail snaps; hold 5 auto-banks.
 *
 * Invariant (integer exact):
 *   (cumNum * multWad + (RTP_WAD * cumDen % cumNum)) / cumDen == RTP_WAD
 *   where multWad = (RTP_WAD * cumDen) / cumNum
 */
contract TugGame is ICasinoGameV2 {
  uint256 private constant WAD = 1e18;
  uint256 private constant RTP_WAD = 95e16; // 0.95

  uint8 public constant MAX_HOLDS = 5;
  uint8 public constant INTENSITY_EASE = 0;
  uint8 public constant INTENSITY_STEADY = 1;
  uint8 public constant INTENSITY_HAUL = 2;

  uint8 private constant ACTION_HOLD = 0;
  uint8 private constant ACTION_CASHOUT = 1;
  uint8 private constant ROLL_REJECT = 240; // 12 complete 0..19 partitions

  error TugGame__InvalidAction();
  error TugGame__NothingToBank();
  error TugGame__HoldPending();
  error TugGame__NoPendingHold();
  error TugGame__MaxHoldsReached();
  error TugGame__BadGameData();
  error TugGame__InvalidIntensity();

  struct TugState {
    uint8 holdsSurvived;
    bool pendingHold;
    bool snapped;
    bool banked;
    bytes32 lastRandomness;
    uint256 cumNum; // survival numerator, starts at 1
    uint256 cumDen; // survival denominator, starts at 1
    uint8 pendingIntensity;
  }

  // -------------------------------------------------------------------------
  // Math
  // -------------------------------------------------------------------------

  /// @notice Returns (num, den) for intensity survive probability.
  function probabilityFraction(uint8 intensity) public pure returns (uint256 num, uint256 den) {
    if (intensity == INTENSITY_EASE) return (9, 10);
    if (intensity == INTENSITY_STEADY) return (4, 5);
    if (intensity == INTENSITY_HAUL) return (13, 20);
    revert TugGame__InvalidIntensity();
  }

  function probabilityForIntensity(uint8 intensity) public pure returns (uint256) {
    (uint256 num, uint256 den) = probabilityFraction(intensity);
    return (WAD * num) / den;
  }

  function multiplierFromCum(uint256 cumNum, uint256 cumDen) public pure returns (uint256) {
    require(cumNum > 0, 'TugGame: zero num');
    return (RTP_WAD * cumDen) / cumNum;
  }

  /// @notice Exact RTP identity in integer math (includes division remainder).
  function rtpProductFromCum(uint256 cumNum, uint256 cumDen) public pure returns (uint256) {
    uint256 mult = multiplierFromCum(cumNum, cumDen);
    uint256 rem = (RTP_WAD * cumDen) % cumNum;
    return (cumNum * mult + rem) / cumDen;
  }

  function payoutFromCum(uint256 wager, uint256 cumNum, uint256 cumDen) public pure returns (uint256) {
    if (cumNum == 1 && cumDen == 1) return 0;
    return (wager * RTP_WAD * cumDen) / (cumNum * WAD);
  }

  function worstCaseCum() public pure returns (uint256 num, uint256 den) {
    num = 1;
    den = 1;
    (uint256 a, uint256 b) = probabilityFraction(INTENSITY_HAUL);
    for (uint8 i = 0; i < MAX_HOLDS; i++) {
      num *= a;
      den *= b;
    }
  }

  function maxPayoutForWager(uint256 wager) public pure returns (uint256) {
    (uint256 num, uint256 den) = worstCaseCum();
    return payoutFromCum(wager, num, den);
  }

  /// @dev Steady-only cum after N holds — regression vs old p^N ladder.
  function steadyCum(uint8 n) public pure returns (uint256 num, uint256 den) {
    require(n >= 1 && n <= MAX_HOLDS, 'TugGame: bad N');
    num = 1;
    den = 1;
    (uint256 a, uint256 b) = probabilityFraction(INTENSITY_STEADY);
    for (uint8 i = 0; i < n; i++) {
      num *= a;
      den *= b;
    }
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
    (uint256 num, uint256 den) = worstCaseCum();
    maxPayout = payoutFromCum(wager, num, den);
    probabilityWad = (WAD * num) / den;
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
      lastRandomness: bytes32(0),
      cumNum: 1,
      cumDen: 1,
      pendingIntensity: 0
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

    (uint8 action, uint8 intensity, bool hasIntensity) = _decodeAction(actionData);

    if (action == ACTION_HOLD) {
      if (state.holdsSurvived >= MAX_HOLDS) revert TugGame__MaxHoldsReached();
      if (!hasIntensity) revert TugGame__InvalidIntensity();
      probabilityForIntensity(intensity); // validates range

      state.pendingHold = true;
      state.pendingIntensity = intensity;
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

    uint8 intensity = state.pendingIntensity;
    state.pendingHold = false;
    state.lastRandomness = randomness;

    if (!_survived(randomness, intensity)) {
      state.snapped = true;
      stepResult.newGameState = abi.encode(state);
      stepResult.escrowDelta = 0;
      stepResult.reservedProfitDelta = 0;
      stepResult.nextPhase = SessionPhase.SETTLED;
      stepResult.requestRandomnessNow = false;
      stepResult.payout = 0;
      return stepResult;
    }

    (uint256 a, uint256 b) = probabilityFraction(intensity);
    state.cumNum *= a;
    state.cumDen *= b;
    state.holdsSurvived += 1;

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

  function _settleBank(
    SessionContext calldata ctx,
    TugState memory state
  ) private pure returns (StepResult memory stepResult) {
    state.banked = true;
    state.pendingHold = false;
    uint256 payout = payoutFromCum(ctx.wagerBase, state.cumNum, state.cumDen);

    stepResult.newGameState = abi.encode(state);
    stepResult.escrowDelta = 0;
    stepResult.reservedProfitDelta = 0;
    stepResult.nextPhase = SessionPhase.SETTLED;
    stepResult.requestRandomnessNow = false;
    stepResult.payout = payout;
  }

  function _survived(bytes32 randomness, uint8 intensity) private pure returns (bool) {
    uint8 roll = _roll20(randomness);
    if (intensity == INTENSITY_EASE) return roll < 18;
    if (intensity == INTENSITY_STEADY) return roll < 16;
    if (intensity == INTENSITY_HAUL) return roll < 13;
    revert TugGame__InvalidIntensity();
  }

  /// @dev SDK-documented rejection sampling: every accepted byte contributes
  ///      equally to each of the 20 outcomes. Exhausted seeds expand by hash.
  function _roll20(bytes32 randomness) private pure returns (uint8) {
    bytes32 seed = randomness;
    uint256 index = 0;
    while (true) {
      if (index == 32) {
        seed = keccak256(abi.encodePacked(seed));
        index = 0;
      }
      uint8 sample = uint8(seed[index]);
      index += 1;
      if (sample < ROLL_REJECT) return sample % 20;
    }
    revert TugGame__InvalidAction();
  }

  function _decodeAction(
    bytes calldata actionData
  ) private pure returns (uint8 action, uint8 intensity, bool hasIntensity) {
    if (actionData.length == 0) revert TugGame__InvalidAction();
    if (actionData.length >= 64) {
      (action, intensity) = abi.decode(actionData, (uint8, uint8));
      hasIntensity = true;
      return (action, intensity, hasIntensity);
    }
    (action) = abi.decode(actionData, (uint8));
    hasIntensity = false;
    intensity = 0;
  }
}
