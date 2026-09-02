import { INTENSITIES, MAX_HOLDS, type Intensity } from '../lib/tug';
import { PhysicsRope } from './PhysicsRope';

export type RopeVisual = 'idle' | 'tension' | 'fraying' | 'snap' | 'banked';

type Props = {
  holds: number;
  visual: RopeVisual;
  pending?: boolean;
  currentMult?: string;
  potentialLabel?: string;
  multPulse?: boolean;
  intensity?: Intensity;
};

export function RopeStage({
  holds,
  visual,
  pending,
  currentMult,
  potentialLabel,
  multPulse,
  intensity = 1,
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
          Pick a <span>grip</span> each hold · <span>Bank</span> to cash out ·{' '}
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
              className={`rung${intensity === row.id && pending ? ' now' : ''}${holds > i ? ' lit' : ''}`}
              style={{ top: `${18 + (i / (MAX_HOLDS - 1)) * 50}%` }}
            >
              <i />
              <em>
                {row.label} {row.pDisplay}
              </em>
            </div>
          ))}
        </div>

        <div className="rope-viewport">
          <PhysicsRope holds={holds} visual={visual} intensity={intensity} />
        </div>
      </div>

      <div className="stage-readout">
        <div className="readout-main">
          <span className="label">Current</span>
          <strong className={`mult${multPulse ? ' pulse' : ''}`}>
            {holds > 0 ? (currentMult ?? '—') : '1.00×'}
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
