import { useEffect, useRef } from "react";
import { INTENSITIES, MAX_HOLDS, type Intensity } from "../lib/tug";
import { PhysicsRope } from "./PhysicsRope";

export type RopeVisual = "idle" | "tension" | "fraying" | "snap" | "banked";

type Props = {
  beforeRound?: boolean;
  holds: number;
  visual: RopeVisual;
  pending?: boolean;
  currentMult?: string;
  potentialLabel?: string;
  multPulse?: boolean;
  intensity?: Intensity;
};

export function RopeStage({
  beforeRound = false,
  holds,
  visual,
  pending,
  currentMult,
  potentialLabel,
  multPulse,
  intensity = 1,
}: Props) {
  const jamDockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    const dockBadge = () => {
      const badge = document.getElementById("chain-jam-badge");
      const dock = jamDockRef.current;
      if (!badge || !dock || badge.parentElement === dock)
        return Boolean(badge);
      dock.appendChild(badge);
      return true;
    };

    if (!dockBadge()) {
      observer = new MutationObserver(() => {
        if (dockBadge()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      const badge = document.getElementById("chain-jam-badge");
      if (badge?.parentElement === jamDockRef.current)
        document.body.appendChild(badge);
    };
  }, []);

  return (
    <section
      className={`stage visual-${visual}${pending ? " is-pending" : ""}`}
      aria-live="polite"
    >
      <div className="stage-grain" aria-hidden />
      <div className="stage-vignette" aria-hidden />

      <header className="stage-headline">
        <p className="rule">
          Pick a <span>grip</span> each hold · <span>Bank</span> to cash out ·{" "}
          <span className="bad">Snap</span> loses the wager
        </p>
      </header>

      <div className="winch">
        <div className="winch-beam" aria-hidden>
          <span className="bolt" />
          <span className="bolt right" />
        </div>

        <div className="track" aria-hidden>
          <div className="track-rail" />
          {INTENSITIES.map((row, i) => (
            <div
              key={row.id}
              className={`rung${intensity === row.id && pending ? " now" : ""}${holds > i ? " lit" : ""}`}
              style={{ top: `${18 + (i / (MAX_HOLDS - 1)) * 50}%` }}
            >
              <i />
              <em>
                {row.label} {100 - Number(row.pDisplay.replace("%", ""))}% snap
              </em>
            </div>
          ))}
        </div>

        <div className="rope-viewport">
          <PhysicsRope
            key={visual === "snap" ? "snapped-rope" : "live-rope"}
            holds={holds}
            visual={visual}
            intensity={intensity}
          />
        </div>
      </div>

      <div className="stage-readout">
        <div className="readout-main">
          <span className="label">Multiplier</span>
          <strong className={`mult${multPulse ? " pulse" : ""}`}>
            {holds > 0 ? (currentMult ?? "—") : "1.00×"}
          </strong>
        </div>
        {potentialLabel ? <p className="potential">{potentialLabel}</p> : null}
        <p className={`callout callout-${visual}`}>
          {visual === "idle" &&
            (beforeRound ? "Set your wager." : "Choose your grip")}
          {visual === "tension" && "Bank your win or pull again"}
          {visual === "fraying" &&
            (holds === MAX_HOLDS - 1 ? "Final pull" : "Hold tight")}
          {visual === "snap" && "Rope snapped"}
          {visual === "banked" && "Win secured"}
        </p>
      </div>
      <div ref={jamDockRef} className="jam-dock" />
    </section>
  );
}
