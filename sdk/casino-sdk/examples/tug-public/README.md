# Tug — Chain Jam entry

Hold-or-bank tension game for [Chain Jam](https://jam.chain.wtf). Survive VRF holds
(p = 80%) to climb the multiplier ladder, then **bank** — or risk another hold.
Fail snaps the rope and loses the wager. Max 5 holds; hold 5 auto-banks.

Mechanic: **chained binary check with stopping time** (not dice / crash / plinko).

## Math

| Holds | Multiplier (`RTP / p^N`) |
| ----- | ------------------------ |
| 1     | 1.1875×                  |
| 2     | 1.484375×                |
| 3     | 1.85546875×              |
| 4     | 2.3193359375×            |
| 5     | 2.899169921875×          |

- `p = 0.80`, `RTP = 0.95` (93–98% band)
- Invariant (tested): `p^N * mult(N) == RTP` for every N

## Run locally (SDK simulator)

From the unzipped `@chain/casino-sdk` root:

```sh
npm install
npm start
```

- Simulator harness: http://localhost:3300  
  Point **Game URL** at `http://localhost:3200` and select **TugGame** once the
  drop-in contract in `simulator/contracts/TugGame.sol` auto-deploys.
- Tug UI: http://localhost:3200

## Standalone demo

Open the built page directly (no iframe). After ~1.8s without a host handshake,
**DEMO MODE** enables so the jam's standalone-playable gate is met. Force it with
`?demo=1`. Demo mode is clearly labeled; production iframe play uses the real
`@chain/casino-sdk` bridge only.

## Build

```sh
npm run build          # from SDK root: tests + static site
# or
npm --prefix examples/tug-public run build
```

Static output: `examples/tug-public/dist/` (deploy to any static host).

Confirm the jam widget is present in the built HTML:

```sh
findstr jam.chain.wtf examples\tug-public\dist\index.html
```

## Contract

`simulator/contracts/TugGame.sol` implements `ICasinoGameV2`:

1. `onSessionStart` → reserve `wager * mult(5) - wager`, wait for player
2. `onPlayerAction(HOLD)` → request VRF
3. `onRandomness` → survive (4/5) or snap; hold 5 auto-banks
4. `onPlayerAction(CASHOUT)` → pay `wager * mult(N)`

## Submission fields

See [`SUBMISSION.md`](./SUBMISSION.md).
