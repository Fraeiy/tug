# Tug — Chain Casino Game Jam

**Live standalone demo:** https://tug-static.vercel.app

Tug is a five-hold risk-selection wagering game. Before every hold, the player chooses how aggressively to pull. Ease, Steady and Haul each change both survival probability and potential payout. After surviving, the player can bank or choose a new risk level for the next pull.

It is novel because risk is selected again before every physical tug. It is not a crash, limbo, or passive multiplier game: every hold is an explicit wager decision followed by one contract-settled VRF outcome.

## How to play

1. Set your wager and start the round.
2. Choose Ease, Steady, or Haul. More risk means a higher payout.
3. Bank after surviving, or pull again. If the rope snaps, the wager is lost.

| Grip | Survival | Snap |
| --- | ---: | ---: |
| Ease | 90% | 10% |
| Steady | 80% | 20% |
| Haul | 65% | 35% |

The fifth successful hold auto-banks.

## RTP and payout math

For a selected sequence with survival probabilities `p₁ … pₙ`:

```text
cumulative survival C = p₁ × … × pₙ
gross cash-out multiplier = 0.95 / C
gross payout = floor(wagerBaseUnits × 0.95 × cumulativeDenominator
                     / cumulativeNumerator)
```

The 95% factor is applied once to the cumulative path, never once per hold. For example, Ease then Haul has `C = 0.90 × 0.65 = 0.585`, so its multiplier is `0.95 / 0.585 = 1.6239×` (displayed downward to four decimals). Contract payout uses one integer division in token base units; displayed financial values are also floored and never promise more than the contract pays.

Automated tests exhaust all `3¹ + 3² + 3³ + 3⁴ + 3⁵ = 363` possible grip sequences, wager boundaries, token precision, and fifth-hold auto-bank. A deterministic simulation runs 1,000,000 rounds per representative strategy.

## Chain Casino SDK integration

- Contract: [`../../simulator/contracts/TugGame.sol`](../../simulator/contracts/TugGame.sol)
- Guest bridge: [`src/lib/useCasinoHost.ts`](src/lib/useCasinoHost.ts)
- Manifest: [`public/game.manifest.json`](public/game.manifest.json)
- SDK interface: [`../../solidity/ICasinoGameV2.sol`](../../solidity/ICasinoGameV2.sol)

`TugGame` implements `ICasinoGameV2`. `onSessionStart` reserves the maximum all-Haul liability and waits for a player action. Each encoded hold requests Chain VRF. `onRandomness` derives an unbiased 20-way roll using byte rejection sampling (`byte < 240`), then survives or settles the loss. Cash-out and hold-five auto-bank settle the gross payout on-chain.

The iframe uses only `@chain/casino-sdk/guest` (`openSession`, `submitAction`, `revealOutcome`, and pushed host snapshots). The contract remains authoritative for outcomes and payouts.

## Local simulator

From `sdk/casino-sdk`:

```sh
npm install
npm start
```

- Tug: http://localhost:3200
- Chain simulator: http://localhost:3300
- Local chain: http://localhost:8545

In the simulator, use game URL `http://localhost:3200` and select the auto-deployed `TugGame`. To exercise contract-backed wager → hold → bank, snap, and five-hold auto-bank flows:

```sh
npm run simulate:tug
```

## Development and verification

```sh
npm --prefix examples/tug-public run dev
npm run test:sdk
npm run test:tug
npm --prefix examples/tug-public run check-types
npm --prefix simulator run check-types
npm run simulate:tug
npm run build
```

Production output is `examples/tug-public/dist/`.

## Standalone mode

Opening the root URL directly waits briefly for the Chain bridge, then starts a clearly labelled local demo if the page is not embedded. `?demo=1` forces demo mode for QA. Embedded pages never fall back to fake outcomes: the real Chain/simulator bridge must connect.

The demo is for playability only and is visibly labelled “Demo”; it does not represent an on-chain payout.

## Chain Jam widget

`index.html` contains the exact required integration:

```html
<script async src="https://jam.chain.wtf/widget.js"></script>
```

The original script and rendered widget remain interactive. The rendered container is docked outside normal layout flow with reserved stage space and mobile safe-area clearance.

## Technology

React 19, TypeScript, Vite, Solidity `0.8.30`, `viem`, `@chain/casino-sdk`, Canvas rope physics, CSS transitions, and original Web Audio synthesis. No animation or audio library is required.

## Known limitations

- Standalone outcomes and balances are intentionally local demo data; only embedded Chain/simulator sessions settle through the contract.
- Web Share availability depends on the browser; unsupported browsers use the clipboard fallback.
- Audio starts only after user interaction and can be muted persistently.
