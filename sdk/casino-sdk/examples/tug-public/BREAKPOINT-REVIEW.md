# Breakpoint UI review

Implemented on branch `ui/breakpoint`.

- Industrial hall artwork (153 KB WebP), Barlow Condensed display typography, larger canvas winch and steel weight.
- Five progress lamps independent of the three risk choices, persistent rules dialog access, compact portrait and landscape layouts, dedicated jam widget dock.
- Shorter tension and snap effects; existing bank notes retained.
- Fixed-step rope simulation for consistent speed across display refresh rates. Weight target reserves room within the canvas.
- Wager logic, payout math, contract, SDK bridge and manifest are unchanged.

Validation: TypeScript and production build pass. All 19 existing tests pass, including seeded million-round simulations for representative strategies. These tests do not establish full SDK simulator eligibility.

Still requires browser verification: this environment prevented Chromium launch with `socket() failed: Operation not permitted`. No screenshots or physical iPhone tests were completed. Check idle, active, snap, bank and fifth-hold automatic settlement at 390x664, 844x390, 320x568 and embedded 800x450. Verify rules, sound toggle, widget placement, and all controls remain visible. Confirm on real iOS Safari before deploying.

Run from this directory: `npm install --workspaces=false`, then `npm run dev`. Open the displayed URL with `?demo=1`.

No production deployment or jam submission was performed.
