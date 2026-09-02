# Eligibility gates — Tug

| Gate | Status | Evidence |
| ---- | ------ | -------- |
| Casino SDK exactly (contract, bridge, manifest) | PASS | `ICasinoGameV2` in `TugGame.sol`; guest bridge via `@chain/casino-sdk/guest`; `validateCasinoGameManifest` → `ok: true` |
| Local simulator flows | PASS | Drop-in `TugGame.sol`; `npm run simulate:tug` against local host |
| RTP 93–98%, paytable matches | PASS | Declared **0.95**; exhaustive vitest: for every intensity sequence of length 1..5, `C * mult(C) == RTP_WAD`; all-Steady regression matches prior ladder |
| Recognizable casino game | PASS | Wager → grip/hold/VRF → bank or snap → payout |
| Standalone outside iframe | PASS | Gated DEMO MODE (`?demo=1` / auto); hosted https://tug-static.vercel.app |
| Novel (not Tower/Mines clone; not dice/crash/plinko) | PASS | Per-hold grip intensity with continuous C-based multiplier |
| Jam widget on live page | PASS | `<script async src="https://jam.chain.wtf/widget.js">` in built HTML |
| Submission fields ready | PASS | See `sdk/casino-sdk/examples/tug-public/SUBMISSION.md` |

## Commands

```sh
cd sdk/casino-sdk
npm install
npm start              # simulator :3300 + tug :3200 + local chain/VRF
npm run test:tug       # unit tests (incl. exhaustive RTP invariant)
npm run simulate:tug   # live on-chain flows (requires npm start)
npm run build          # tests + static dist/
```
