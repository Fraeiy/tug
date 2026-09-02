# How Tug addresses the four Chain Jam scores

## Novelty
Tower / Dragon Tower / Mines (Stake, Shuffle, Rainbet, BC.Game) fix the risk
level **once** at the start of a run, then repeat the same binary check.
Tug’s delta: the player **re-chooses grip intensity on every hold** — Ease
(90%), Steady (80%), or Haul (65%) — and the bankable multiplier is recomputed
continuously from the **cumulative survival odds actually taken**
(`mult = RTP / C`). Same RTP invariant holds for any mix of grips; the
all-Steady path reproduces the old fixed ladder exactly. Still not dice,
crash, or plinko — and not a Tower clone with a reskin.

## Fun (still playing after 10 hours)
- Every hold is a discrete decision: which grip, then bank or tug again.
- Haul stretches the rope harder even on hold 1; Ease is safer and pays less.
- Multiplier climb + auto-bank at 5 keeps rounds short and replayable.
- Audio creak → survive ping / snap thud / bank settle makes each outcome hit.

## Simplicity (no manual)
One persistent rule on the stage:

> Pick a grip each hold · Bank to cash out · Snap loses the wager

Three grip buttons show survival % and the live next multiplier before you
commit; **Bank** sits underneath with the current locked payout.

## Visual & sound
- Crafted winch/rope physics (twisted hemp, kg weight tag, intensity-scaled strain).
- Distinct states: idle / tension / fraying / snap / banked.
- Synthesized physical audio (creak, taut ping, dry snap, warm bank).
