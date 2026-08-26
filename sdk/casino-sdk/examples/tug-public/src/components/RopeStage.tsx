import { MAX_HOLDS, formatMultiplier } from '../lib/tug';
import { PhysicsRope } from './PhysicsRope';

export type RopeVisual = 'idle' | 'tension' | 'fraying' | 'snap' | 'banked';

type Props = {
  holds: number;
  visual: RopeVisual;
  pending?: boolean;
  currentMult?: string;
  potentialLabel?: string;
  multPulse?: boolean;
};

export function RopeStage({
  holds,
  visual,
  pending,
  currentMult,
  potentialLabel,
  multPulse,
}: Props) {
  return (
    <section
      className={`stage visual-${visual}${pending ? ' is-pending' : ''}`}
      aria-live="polite"
    >
      <div className="stage-grain" aria-hidden />
      <div className="stage-vignette" aria-hidden />

      <header className="stage-headline">
        <p className="rule">
          <span>Survive</span> a hold to climb · <span>Bank</span> to cash out ·{' '}
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
          {[1, 2, 3, 4, 5].map(n => (
            <div
              key={n}
              className={`rung${holds >= n ? ' lit' : ''}${holds === n ? ' now' : ''}`}
              style={{ top: `${18 + ((n - 1) / (MAX_HOLDS - 1)) * 62}%` }}
            >
              <i />
              <em>{formatMultiplier(n)}</em>
            </div>
          ))}
        </div>

        <div className="rope-viewport">
          <PhysicsRope holds={holds} visual={visual} />
        </div>
      </div>

      <div className="stage-readout">
        <div className="readout-main">
          <span className="label">Current</span>
          <strong className={`mult${multPulse ? ' pulse' : ''}`}>
            {holds > 0 ? (currentMult ?? formatMultiplier(holds)) : '1.00×'}
          </strong>
        </div>
        {potentialLabel ? <p className="potential">{potentialLabel}</p> : null}
        <p className={`callout callout-${visual}`}>
          {visual === 'idle' && 'Place a wager, then start tugging.'}
          {visual === 'tension' && 'Rope holding. Bank now — or risk another pull.'}
          {visual === 'fraying' && 'Rope stretching under load…'}
          {visual === 'snap' && 'Snapped. Wager gone.'}
          {visual === 'banked' && 'Banked. Payout locked.'}
        </p>
      </div>
    </section>
  );
}
