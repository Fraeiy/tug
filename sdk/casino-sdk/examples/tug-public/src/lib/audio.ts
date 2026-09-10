/** Lightweight Web Audio cues: physical rope and winch sounds, generated locally. */

import type { Intensity } from "./tug";

export const MUTE_STORAGE_KEY = "tug.audio.muted.v1";

let ctx: AudioContext | null = null;
let unlocked = false;
let muted = readMutedPreference();
let generation = 0;
const activeNodes = new Set<AudioScheduledSourceNode>();
const timers = new Set<number>();

export function readMutedPreference(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
  } catch {
    // A restricted storage context must not break play.
  }
  if (next) stopAudio();
}

export function unlockAudio(): void {
  unlocked = true;
  const audio = getCtx();
  if (audio?.state === "suspended") void audio.resume();
}

function getCtx(): AudioContext | null {
  if (!unlocked || muted || typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function track<T extends AudioScheduledSourceNode>(node: T): T {
  activeNodes.add(node);
  node.addEventListener("ended", () => activeNodes.delete(node), {
    once: true,
  });
  return node;
}

function later(fn: () => void, delay: number): void {
  const expectedGeneration = generation;
  const timer = window.setTimeout(() => {
    timers.delete(timer);
    if (expectedGeneration === generation && !muted) fn();
  }, delay);
  timers.add(timer);
}

export function stopAudio(): void {
  generation++;
  for (const timer of timers) window.clearTimeout(timer);
  timers.clear();
  for (const node of activeNodes) {
    try {
      node.stop();
    } catch {
      // Already stopped.
    }
  }
  activeNodes.clear();
}

function noiseBurst(duration: number, gain = 0.08, band = 1200): void {
  const audio = getCtx();
  if (!audio) return;
  const buffer = audio.createBuffer(
    1,
    Math.floor(audio.sampleRate * duration),
    audio.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = track(audio.createBufferSource());
  const filter = audio.createBiquadFilter();
  const gainNode = audio.createGain();
  const now = audio.currentTime;
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = band;
  filter.Q.value = 0.7;
  gainNode.gain.setValueAtTime(gain, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter).connect(gainNode).connect(audio.destination);
  source.start(now);
  source.stop(now + duration);
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
  const oscillator = track(audio.createOscillator());
  const gainNode = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (slideTo)
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(40, slideTo),
      now + duration,
    );
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(gain, now + 0.015);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gainNode).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

export function playButton(): void {
  noiseBurst(0.035, 0.018, 720);
  tone(118, 0.07, "triangle", 0.035, 92);
}

export function playTension(intensity: Intensity): void {
  stopAudio();
  const strength = [0.038, 0.052, 0.07][intensity];
  const start = [96, 108, 124][intensity];
  noiseBurst(0.3, strength, 340 + intensity * 130);
  tone(start, 0.38, "triangle", strength, start + 42 + intensity * 26);
  later(() => noiseBurst(0.22, strength * 0.8, 450 + intensity * 180), 230);
}

export function playHoldSurvived(holds: number): void {
  stopAudio();
  noiseBurst(0.06, 0.03, 900);
  const base = 220 + holds * 48;
  tone(base, 0.16, "triangle", 0.1);
  later(() => tone(base * 1.34, 0.28, "sine", 0.075), 55);
}

export function playSnap(): void {
  stopAudio();
  noiseBurst(0.18, 0.14, 1600);
  tone(160, 0.12, "sawtooth", 0.11, 55);
  later(() => {
    noiseBurst(0.35, 0.085, 220);
    tone(70, 0.5, "triangle", 0.095, 35);
  }, 40);
}

export function playBank(finalHold = false): void {
  stopAudio();
  noiseBurst(0.08, 0.035, 500);
  const notes = finalHold ? [196, 247, 330, 440] : [196, 247, 294, 392];
  notes.forEach((note, index) =>
    later(
      () =>
        tone(
          note,
          0.24 + index * 0.08,
          index % 2 ? "triangle" : "sine",
          0.08 - index * 0.01,
        ),
      index * 75,
    ),
  );
}

export function playWager(): void {
  playButton();
  later(() => tone(210, 0.18, "sine", 0.055), 40);
}
