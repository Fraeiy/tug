/** Web Audio cues — physical rope feel, not chiptune blips. */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noiseBurst(duration: number, gain = 0.08, band = 1200): void {
  const audio = getCtx();
  if (!audio) return;
  const length = Math.floor(audio.sampleRate * duration);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = band;
  filter.Q.value = 0.7;
  const g = audio.createGain();
  const now = audio.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(audio.destination);
  src.start(now);
  src.stop(now + duration);
}

function tone(
  frequency: number,
  duration: number,
  type: OscillatorType,
  gain = 0.1,
  slideTo?: number,
): void {
  const audio = getCtx();
  if (!audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  if (slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), now + duration);
  }
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(filter);
  filter.connect(g);
  g.connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/** Soft hemp creak while a hold resolves. */
export function playCreak(): void {
  noiseBurst(0.28, 0.045, 380);
  tone(92, 0.22, 'triangle', 0.05, 70);
}

/** Survived — taut ping that climbs with each hold. */
export function playHoldSurvived(holds: number): void {
  noiseBurst(0.06, 0.03, 900);
  const base = 220 + holds * 48;
  tone(base, 0.16, 'triangle', 0.11);
  setTimeout(() => tone(base * 1.34, 0.28, 'sine', 0.08), 55);
}

/** Snap — dry break + thud. */
export function playSnap(): void {
  noiseBurst(0.18, 0.14, 1600);
  tone(160, 0.12, 'sawtooth', 0.12, 55);
  setTimeout(() => {
    noiseBurst(0.35, 0.09, 220);
    tone(70, 0.5, 'triangle', 0.1, 35);
  }, 40);
}

/** Bank — locked winch, warm settle. */
export function playBank(): void {
  noiseBurst(0.08, 0.035, 500);
  tone(196, 0.22, 'sine', 0.09);
  setTimeout(() => tone(247, 0.32, 'triangle', 0.08), 70);
  setTimeout(() => tone(294, 0.45, 'sine', 0.07), 150);
  setTimeout(() => tone(392, 0.55, 'sine', 0.045), 240);
}

/** Wager locked in. */
export function playWager(): void {
  noiseBurst(0.05, 0.025, 600);
  tone(140, 0.12, 'triangle', 0.07);
  setTimeout(() => tone(210, 0.18, 'sine', 0.06), 40);
}
