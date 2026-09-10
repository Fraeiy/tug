import { useEffect, useRef } from "react";
import type { Intensity } from "../lib/tug";
import { INTENSITY_EASE, INTENSITY_HAUL, INTENSITY_STEADY } from "../lib/tug";
import type { RopeVisual } from "./RopeStage";

type Props = {
  holds: number;
  visual: RopeVisual;
  /** Grip chosen for the current / pending hold — scales strain beyond hold count. */
  intensity?: Intensity;
  className?: string;
};

type Point = {
  x: number;
  y: number;
  ox: number;
  oy: number;
  pinned: boolean;
};

type Fiber = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  rot: number;
  vr: number;
  len: number;
};

const SEGMENTS = 30;
const ITERATIONS = 5;
/** Base kg on the hanging weight per survived hold (1-based). */
export const HOLD_WEIGHTS = [1, 2.5, 5, 9, 15];
/** Extra kg added by the grip chosen for this tug. */
export const INTENSITY_WEIGHT: Record<number, number> = {
  [INTENSITY_EASE]: 0.5,
  [INTENSITY_STEADY]: 2,
  [INTENSITY_HAUL]: 6,
};

/**
 * Live Verlet rope: twisted hemp look, per-hold weight stretch, thrash under
 * load, and a physical mid-span snap with flying fibers.
 */
export function PhysicsRope({
  holds,
  visual,
  intensity = INTENSITY_STEADY,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualRef = useRef(visual);
  const holdsRef = useRef(holds);
  const intensityRef = useRef(intensity);
  visualRef.current = visual;
  holdsRef.current = holds;
  intensityRef.current = intensity;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let points: Point[] = [];
    let restLen = 12;
    let snapped = false;
    let snapAt = -1;
    let fibers: Fiber[] = [];
    let time = 0;
    let lastVisual: RopeVisual = visualRef.current;
    let lastHolds = holdsRef.current;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let bounce = 0; // brief drop bounce when a new hold lands

    const topPin = () => ({ x: w * 0.5, y: h * 0.07 });
    const baseBottomY = () => h * 0.72;

    const gripBoost = () => {
      const g = intensityRef.current;
      if (g === INTENSITY_HAUL) return 1.55;
      if (g === INTENSITY_EASE) return 0.55;
      return 1;
    };

    const stretchPull = () => {
      const v = visualRef.current;
      const n = holdsRef.current;
      const grip = gripBoost();
      // ~12% lengthening per hold, scaled harder for Haul than Ease.
      let pull = 0.015 + n * 0.055 * grip;
      if (v === "fraying") {
        const jitter = 0.5 + n * 0.4 * grip;
        pull += 0.08 + 0.06 * grip + Math.sin(time * 16) * (0.02 * jitter);
      }
      if (v === "tension") pull += 0.015 * grip;
      if (v === "banked") pull *= 0.45;
      if (v === "idle") pull = 0.01;
      pull += bounce;
      return Math.min(0.4, pull);
    };

    const swayIntensity = () => {
      const v = visualRef.current;
      const n = holdsRef.current;
      const grip = gripBoost();
      if (v === "fraying") return (2.2 + n * 0.55) * grip;
      if (v === "tension") return (0.45 + n * 0.3) * grip;
      if (v === "idle") return 0.25;
      return 0.4 * grip;
    };

    const initRope = () => {
      points = [];
      fibers = [];
      snapped = false;
      snapAt = -1;
      bounce = 0;
      const top = topPin();
      const bottomY = baseBottomY();
      const span = bottomY - top.y;
      restLen = span / SEGMENTS;
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        const x = top.x + Math.sin(t * Math.PI) * 2;
        const y = top.y + span * t;
        points.push({ x, y, ox: x, oy: y, pinned: i === 0 });
      }
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initRope();
      // Mobile browser chrome and outcome content can resize the stage during
      // the break. Re-apply the state-driven snap after reinitialization.
      if (visualRef.current === "snap") triggerSnap();
    };

    const triggerSnap = () => {
      if (snapped) return;
      snapped = true;
      snapAt = Math.floor(SEGMENTS * 0.46);
      const mid = points[snapAt];
      for (let i = 0; i < 40; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 2 + Math.random() * 6.5;
        fibers.push({
          x: mid.x + (Math.random() - 0.5) * 14,
          y: mid.y + (Math.random() - 0.5) * 12,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 3,
          life: 0.8 + Math.random() * 1.0,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.55,
          len: 8 + Math.random() * 18,
        });
      }
      // Opposite-direction kick so halves fall apart (top recoils up, bottom drops).
      for (let i = 1; i < points.length; i++) {
        if (i <= snapAt) {
          points[i].ox = points[i].x + (Math.random() - 0.5) * 2;
          points[i].oy = points[i].y + 2 + Math.random();
        } else {
          points[i].ox = points[i].x + (Math.random() - 0.5) * 2;
          points[i].oy = points[i].y - 3 - Math.random() * 2;
          points[i].pinned = false;
        }
      }
      points[0].pinned = true;
    };

    const constrain = (a: Point, b: Point, length: number) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const diff = (dist - length) / dist;
      const offX = dx * 0.5 * diff;
      const offY = dy * 0.5 * diff;
      if (!a.pinned) {
        a.x += offX;
        a.y += offY;
      }
      if (!b.pinned) {
        b.x -= offX;
        b.y -= offY;
      }
    };

    const step = () => {
      time += 0.016;
      const v = visualRef.current;
      const n = holdsRef.current;

      if (n > lastHolds) {
        bounce = 0.06;
      }
      lastHolds = n;
      if (bounce > 0) bounce *= 0.88;

      if (v === "snap" && lastVisual !== "snap") triggerSnap();
      if (v !== "snap" && lastVisual === "snap") initRope();
      if (v === "idle" && (lastVisual === "banked" || lastVisual === "snap"))
        initRope();
      lastVisual = v;

      const pull = stretchPull();
      const top = topPin();
      points[0].x = top.x;
      points[0].y = top.y;
      points[0].ox = top.x;
      points[0].oy = top.y;
      points[0].pinned = true;

      if (!snapped) {
        const bottom = points[points.length - 1];
        const targetY = baseBottomY() + h * pull;
        const sway =
          Math.sin(time * (v === "fraying" ? 18 : 2.8)) * swayIntensity();
        bottom.x += (top.x + sway - bottom.x) * 0.42;
        bottom.y += (targetY - bottom.y) * 0.42;
        bottom.ox = bottom.x;
        bottom.oy = bottom.y;
        // Thin under load.
        const thin = 1 - Math.min(0.2, n * 0.035);
        restLen =
          ((baseBottomY() - top.y) / SEGMENTS) *
          (1 - Math.min(0.18, pull * 0.55)) *
          thin;
      }

      const gravity = snapped ? 0.62 : v === "fraying" ? 0.26 : 0.17;
      const damp = snapped ? 0.994 : 0.986;

      for (let i = 1; i < points.length; i++) {
        const p = points[i];
        if (p.pinned) continue;
        const vx = (p.x - p.ox) * damp;
        const vy = (p.y - p.oy) * damp;
        p.ox = p.x;
        p.oy = p.y;
        p.x += vx;
        p.y += vy + gravity;
        if (v === "fraying" && !snapped) {
          p.x += Math.sin(time * 34 + i * 0.6) * (0.4 + n * 0.12);
        }
      }

      for (let k = 0; k < ITERATIONS; k++) {
        for (let i = 0; i < points.length - 1; i++) {
          if (snapped && i === snapAt) continue;
          constrain(points[i], points[i + 1], restLen);
        }
        points[0].x = top.x;
        points[0].y = top.y;
      }

      fibers = fibers.filter((f) => f.life > 0);
      for (const f of fibers) {
        f.vy += 0.38;
        f.x += f.vx;
        f.y += f.vy;
        f.vx *= 0.98;
        f.rot += f.vr;
        f.life -= 0.016;
      }
    };

    const drawRopeStroke = (
      from: number,
      to: number,
      width: number,
      color: string,
      dash?: number[],
      offset = 0,
    ) => {
      if (to - from < 1) return;
      ctx.beginPath();
      const pStart = points[from];
      ctx.moveTo(pStart.x + offset, pStart.y);
      for (let i = from + 1; i <= to; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const mx = (p0.x + p1.x) / 2 + offset;
        const my = (p0.y + p1.y) / 2;
        ctx.quadraticCurveTo(p0.x + offset, p0.y, mx, my);
      }
      ctx.lineTo(points[to].x + offset, points[to].y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash(dash ?? []);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const palette = () => {
      const v = visualRef.current;
      if (v === "banked") {
        return {
          shadow: "rgba(20, 30, 12, 0.5)",
          dark: "#5a7340",
          mid: "#8fbf6a",
          light: "#c5e09a",
          hi: "rgba(230, 255, 200, 0.55)",
          ring: "#9ec784",
          tag: "#c5e09a",
        };
      }
      if (v === "snap") {
        return {
          shadow: "rgba(40, 10, 5, 0.55)",
          dark: "#5a2a1c",
          mid: "#a85a40",
          light: "#c47a58",
          hi: "rgba(255, 180, 150, 0.4)",
          ring: "#e08a72",
          tag: "#e08a72",
        };
      }
      if (v === "fraying") {
        return {
          shadow: "rgba(30, 15, 5, 0.55)",
          dark: "#8f611f",
          mid: "#d4a45a",
          light: "#b8843f",
          hi: "rgba(255, 220, 150, 0.6)",
          ring: "#e2b56a",
          tag: "#e8c07a",
        };
      }
      return {
        shadow: "rgba(20, 12, 5, 0.55)",
        dark: "#8f611f",
        mid: "#b8843f",
        light: "#c49a5c",
        hi: "rgba(240, 210, 160, 0.5)",
        ring: "#e2b56a",
        tag: "#e8c07a",
      };
    };

    /** Twisted multi-strand hemp rope. */
    const drawHalf = (
      from: number,
      to: number,
      colors: ReturnType<typeof palette>,
      width: number,
    ) => {
      ctx.save();
      ctx.translate(2.5, 3.5);
      drawRopeStroke(from, to, width + 4, colors.shadow);
      ctx.restore();

      // Dark under-strand
      drawRopeStroke(from, to, width * 1.05, colors.dark, undefined, -1.2);
      // Mid hemp
      drawRopeStroke(from, to, width, colors.mid);
      // Light twist strand
      drawRopeStroke(from, to, width * 0.55, colors.light, undefined, 1.1);
      // Helical highlight dashes
      drawRopeStroke(
        from,
        to,
        Math.max(1.4, width * 0.2),
        colors.hi,
        [4, 7],
        0.4,
      );
      // Fine alternating fibers catch the light without another animation loop.
      drawRopeStroke(
        from,
        to,
        width * 0.13,
        colors.dark,
        [2, 6],
        -width * 0.25,
      );
      drawRopeStroke(from, to, width * 0.12, colors.hi, [3, 6], width * 0.3);

      // Frayed hairlines past hold 2
      if (holdsRef.current >= 2 && !snapped && visualRef.current !== "idle") {
        ctx.globalAlpha = 0.35 + holdsRef.current * 0.08;
        drawRopeStroke(from, to, 1.2, colors.light, [2, 14], -width * 0.55);
        drawRopeStroke(from, to, 1.0, colors.dark, [3, 18], width * 0.5);
        ctx.globalAlpha = 1;
      }
    };

    const drawWeight = (bot: Point, colors: ReturnType<typeof palette>) => {
      const n = holdsRef.current;
      const baseKg =
        n > 0
          ? (HOLD_WEIGHTS[n - 1] ?? HOLD_WEIGHTS[HOLD_WEIGHTS.length - 1])
          : 0;
      const gripKg = INTENSITY_WEIGHT[intensityRef.current] ?? 2;
      const showGrip =
        visualRef.current === "fraying" || visualRef.current === "tension";
      const kg =
        n > 0 ? baseKg + (showGrip ? gripKg : 0) : showGrip ? gripKg : 0;
      const scale =
        1 + Math.max(0, n - 1) * 0.12 + (showGrip ? gripBoost() * 0.12 : 0);
      const cx = bot.x;
      const cy = bot.y + 14;

      // Iron weight body
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.beginPath();
      ctx.moveTo(-16, -4);
      ctx.lineTo(16, -4);
      ctx.lineTo(13, 16);
      ctx.lineTo(-13, 16);
      ctx.closePath();
      ctx.fillStyle = "#1a1410";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors.ring;
      ctx.stroke();
      // Hook ring
      ctx.beginPath();
      ctx.arc(0, -10, 7, 0, Math.PI * 2);
      ctx.strokeStyle = colors.ring;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();

      // kg tag
      const label = n > 0 ? `${kg}kg` : "READY";
      ctx.font = '700 11px "Inter", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width;
      const tagY = cy + 22 * scale;
      const padX = 8;
      const tagW = tw + padX * 2;
      const tagH = 18;
      ctx.beginPath();
      roundRectPath(ctx, cx - tagW / 2, tagY - tagH / 2, tagW, tagH, 9);
      ctx.fillStyle = "#1a1410";
      ctx.fill();
      ctx.strokeStyle = "#b8843f";
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.fillStyle = colors.tag;
      ctx.fillText(label, cx, tagY + 0.5);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const colors = palette();
      const n = holdsRef.current;
      const tautWidth = (snapped ? 8.5 : 12 - Math.min(3.5, n * 0.45)) * 1.17;

      if (snapped && snapAt > 0) {
        drawHalf(0, snapAt, colors, tautWidth);
        drawHalf(snapAt + 1, points.length - 1, colors, tautWidth);
      } else {
        drawHalf(0, points.length - 1, colors, tautWidth);
      }

      // Top drum
      const top = points[0];
      ctx.fillStyle = "#2c241c";
      ctx.strokeStyle = "#5a4c3c";
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, top.x - 34, top.y - 14, 68, 22, 6);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = "#e2b56a";
      ctx.arc(top.x, top.y - 3, 3.5, 0, Math.PI * 2);
      ctx.fill();

      drawWeight(points[points.length - 1], colors);

      for (const f of fibers) {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
        ctx.strokeStyle = "#c48a4a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-f.len * 0.5, 0);
        ctx.lineTo(f.len * 0.5, 0);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      if (visualRef.current === "fraying" && !snapped) {
        const mid = points[Math.floor(points.length * 0.5)];
        const glow = ctx.createRadialGradient(
          mid.x,
          mid.y,
          4,
          mid.x,
          mid.y,
          60,
        );
        glow.addColorStop(0, "rgba(226, 181, 106, 0.32)");
        glow.addColorStop(1, "rgba(226, 181, 106, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, 60, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = () => {
      if (!running) return;
      step();
      draw();
      raf = window.requestAnimationFrame(loop);
    };

    resize();
    const ro = new ResizeObserver(() => resize());
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    raf = window.requestAnimationFrame(loop);

    return () => {
      running = false;
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "physics-rope"}
      aria-hidden
    />
  );
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
