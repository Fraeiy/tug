# Eligibility gates — Tug

| Gate | Status | Evidence |
| ---- | ------ | -------- |
| Casino SDK exactly (contract, bridge, manifest) | PASS | `ICasinoGameV2` in `TugGame.sol`; guest bridge via `@chain/casino-sdk/guest`; `validateCasinoGameManifest` → `ok: true` |
| Local simulator flows | PASS | Drop-in deploy at `0xa513…c853`; `npm run simulate:tug` — bank, fail, auto-bank, on-chain RTP |
| RTP 93–98%, paytable matches | PASS | Declared 0.95; vitest + on-chain `rtpProductWad(N) == RTP_WAD` for N=1..5 |
| Recognizable casino game | PASS | Wager → hold/VRF → bank or snap → payout |
| Standalone outside iframe | PASS | Gated DEMO MODE (`?demo=1` / auto after host timeout); hosted https://tug-static.vercel.app |
| Novel (not dice/crash/plinko/classic) | PASS | Chained binary checks with stopping time |
| Jam widget on live page | PASS | `<script async src="https://jam.chain.wtf/widget.js">` in built + hosted HTML |
| Submission fields ready | PASS | See `sdk/casino-sdk/examples/tug-public/SUBMISSION.md` |

## Commands

```sh
cd sdk/casino-sdk
npm install
npm start              # simulator :3300 + tug :3200 + local chain/VRF
npm run test:tug       # unit tests
npm run simulate:tug   # live on-chain flows (requires npm start)
npm run build          # tests + static dist/
```
