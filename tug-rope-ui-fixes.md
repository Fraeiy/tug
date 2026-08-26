# Tug — Rope, Weight & UI Fix Instructions

Context: mobile header (balance pill) is overlapping the logo. Rope looks flat/static.
Need: realistic rope, snap-on-loss animation, per-hold weight mechanic, and general UI polish.

---

## 1. Fix header overlap (mobile)

The balance pill is overflowing into the logo area on small screens. Apply:

```css
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  flex-wrap: nowrap;
}

.logo-group {
  flex-shrink: 0;
  min-width: 0;
}

.balance-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 20px;
  flex-shrink: 1;
  min-width: 0;
}

.balance-pill .amount {
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 400px) {
  .balance-pill { font-size: 11px; padding: 5px 8px; }
  .balance-pill .amount { font-size: 12px; }
  .demo-badge { padding: 3px 8px; font-size: 10px; }
}
```

Give logo, balance pill, and demo badge distinct `flex-shrink` priorities so the balance pill shrinks/truncates before it can cover the logo.

---

## 2. Realistic rope texture + sway

Replace the flat gradient with a twisted-strand look and subtle tension jitter:

```css
.rope {
  background: repeating-linear-gradient(
    115deg,
    #b8843f 0px, #b8843f 4px,
    #8f611f 4px, #8f611f 8px
  );
  border-radius: 6px;
  box-shadow: inset -2px 0 3px rgba(0,0,0,.4), inset 2px 0 3px rgba(255,255,255,.15);
}
```

```js
function ropeTension(el, intensity) {
  let t = 0;
  return setInterval(() => {
    t += 0.15;
    const angle = Math.sin(t) * intensity;
    el.style.transform = `rotate(${angle}deg)`;
  }, 30);
}
// Increase `intensity` (e.g. 0.5 -> 2.5) as the multiplier climbs per hold.
// Clear the interval on bank/snap/reset.
```

Optional: past the 2x multiplier tier, swap in a "frayed" edge sprite or add a couple of hairline strands peeling off via `::before`/`::after` to show wear.

---

## 3. Snap animation (on loss)

Split the rope into two DOM pieces (top half / bottom half) at the break point when a hold fails:

```css
@keyframes ropeSnap {
  0%   { transform: scaleY(1) rotate(0deg); opacity: 1; }
  15%  { transform: scaleY(1.05) rotate(-2deg); }
  40%  { transform: translateY(10px) rotate(8deg); opacity: 1; }
  100% { transform: translateY(120px) rotate(25deg); opacity: 0; }
}

.rope.snapping-top {
  animation: ropeSnap 0.45s ease-in forwards;
}
.rope.snapping-bottom {
  animation: ropeSnap 0.45s ease-in forwards reverse;
}
```

- Apply `.snapping-top` to the upper piece, mirrored fall to the lower piece.
- Add a quick screen-shake on the game container (~150ms, small random translate jitter) fired at the same moment.
- Fire a snap sound effect on the same trigger.
- The combo of split + opposite-direction fall + shake is what sells "snap" — a simple fade/scale-out reads as a glitch, not a break.

---

## 4. Per-hold weight mechanic

Show a weight tag pulling on the rope that increases with each successful hold, stretching the rope visually as it goes.

```js
// Call this on each successful hold, passing the hold index (1-based)
const HOLD_WEIGHTS = [1, 2.5, 5, 9, 15]; // kg per hold — tune to match your multiplier curve

function applyHoldWeight(holdIndex, ropeEl, weightLabelEl, weightIconEl) {
  const kg = HOLD_WEIGHTS[holdIndex - 1] ?? HOLD_WEIGHTS[HOLD_WEIGHTS.length - 1];

  weightLabelEl.textContent = `${kg}kg`;

  const stretchFactor = 1 + (holdIndex - 1) * 0.12; // rope lengthens ~12% per hold
  const thinFactor = 1 - (holdIndex - 1) * 0.04;    // thins slightly under load

  ropeEl.style.transform = `scaleY(${stretchFactor}) scaleX(${thinFactor})`;
  ropeEl.style.transformOrigin = 'top center';

  weightIconEl.style.transform = `translateY(${(holdIndex - 1) * 6}px) scale(${1 + (holdIndex - 1) * 0.15})`;

  weightIconEl.animate([
    { transform: weightIconEl.style.transform + ' translateY(-8px)' },
    { transform: weightIconEl.style.transform }
  ], { duration: 220, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}
```

```css
.weight-tag {
  position: absolute;
  bottom: -28px;
  left: 50%;
  transform: translateX(-50%);
  background: #1a1410;
  border: 1px solid #b8843f;
  color: #e8c07a;
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

.weight-icon {
  width: 22px;
  height: 22px;
  transition: transform 0.25s ease-out;
}
```

- Mount `.weight-icon` + `.weight-tag` at the ball/orb position at the bottom of the rope.
- Call `applyHoldWeight()` on every successful hold.
- Reset rope transform and weight label to base state on round reset, bank, or snap.

---

## 5. General UI polish

- Multiplier text: pulse on climb (scale 1 → 1.15 → 1, ~200ms) instead of an instant number change.
- Multiplier tier list (right side): bold + gold border on the currently active tier — right now they're all visually identical.
- Match corner radius across wager input and preset buttons (the active "10" state currently has a harder radius than the others).
- Add an ~80ms delay between tapping "Start round" and the rope beginning to move, so the action doesn't feel instant/flat.
