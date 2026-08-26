# Chain Jam — submission fields (ready to paste)

| Field | Value |
| ----- | ----- |
| **Title** | Tug |
| **URL** | https://tug-static.vercel.app |
| **Declared RTP** | 0.95 (95%) |
| **Source link** | `C:\Users\USER\tug-casino` (push to GitHub and paste the repo URL) |
| **Pitch** | Tug is a hold-or-bank tension game: each survived VRF hold climbs a fixed multiplier ladder (80% survive chance), then you choose to bank or risk another tug. Fail snaps the rope and loses the wager. Cap at 5 holds with auto-bank. Chained binary checks with a stopping time — not dice, crash, or plinko. |

## Eligibility self-check

- [x] Real `@chain/casino-sdk` / `ICasinoGameV2` contract + guest bridge + validated manifest (`ok: true`, canonical id `tug`)
- [x] Local simulator drop-in contract (`simulator/contracts/TugGame.sol`) — deployed + all flows passed
- [x] RTP 95% with automated `p^N * mult(N) == RTP` tests (vitest + on-chain)
- [x] Recognizable casino loop: wager → outcome → payout
- [x] Standalone playable via gated DEMO MODE when opened outside the iframe (`?demo=1` or auto)
- [x] Novel mechanic (not a classic / not banned templates)
- [x] Jam widget script on the live page (`https://jam.chain.wtf/widget.js`)
- [x] Hosted at https://tug-static.vercel.app (static build)
