# Tug — Chain (chain.wtf) Casino Jam entry

Complete jam entry built on the official `@chain/casino-sdk`. Tug is a five-hold
risk-selection wagering game: the player re-selects Ease, Steady, or Haul before
every contract-settled VRF hold, then banks or pulls again.

## Quick start

```sh
cd sdk/casino-sdk
npm install
npm start
```

- **Simulator**: http://localhost:3300 — set game URL to `http://localhost:3200`, pick **TugGame**
- **Tug UI**: http://localhost:3200
- **Standalone demo**: open http://localhost:3200 directly (auto DEMO MODE)

## One-command build

```sh
cd sdk/casino-sdk
npm run build
```

Runs SDK, RTP, state-machine, payout, randomness, simulation, and standalone-host
tests, then produces `examples/tug-public/dist/` for static hosting.

**Live demo:** https://tug-static.vercel.app  
**Source:** https://github.com/Fraeiy/tug  
**Submission fields:** `sdk/casino-sdk/examples/tug-public/SUBMISSION.md`

With the local stack running, exercise every on-chain flow:

```sh
npm run simulate:tug
```

## Layout

| Path | Role |
| ---- | ---- |
| `sdk/casino-sdk/` | Official Casino SDK + local simulator |
| `sdk/casino-sdk/simulator/contracts/TugGame.sol` | `ICasinoGameV2` game contract |
| `sdk/casino-sdk/examples/tug-public/` | Guest UI (forked from coinflip example) |
