# Chain Jam — submission fields (ready to paste)

| Field | Value |
| ----- | ----- |
| **Title** | Tug |
| **URL** | https://tug-static.vercel.app |
| **Declared RTP** | 0.95 (95%) — invariant holds under any mix of grip intensities |
| **Source link** | https://github.com/Fraeiy/tug |
| **Pitch** | Tug is a hold-or-bank rope game where you re-choose risk on every tug. Ease (90%), Steady (80%), or Haul (65%) — each grip updates a cumulative survival product, and the bankable multiplier is always RTP ÷ that product. Tower/Dragon Tower/Mines lock risk once per run; Tug doesn’t. Fail snaps the rope. Cap at 5 holds with auto-bank. 95% RTP. |

## Eligibility self-check

- [x] Real `@chain/casino-sdk` / `ICasinoGameV2` contract + guest bridge + validated manifest
- [x] Local simulator drop-in contract (`simulator/contracts/TugGame.sol`)
- [x] RTP 95% with exhaustive `C * mult(C) == RTP` tests over all intensity sequences
- [x] Recognizable casino loop: wager → outcome → payout
- [x] Standalone playable via gated DEMO MODE
- [x] Novel vs Tower/Mines: per-hold grip intensity
- [x] Jam widget on the live page
- [x] Hosted at https://tug-static.vercel.app
