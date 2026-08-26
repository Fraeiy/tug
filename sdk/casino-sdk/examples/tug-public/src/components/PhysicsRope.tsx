import { useEffect, useRef } from 'react';
import type { RopeVisual } from './RopeStage';

type Props = {
  holds: number;
  visual: RopeVisual;
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

const SEGMENTS = 28;
const ITERATIONS = 4;

/**
 * Live Verlet rope: elongates with each survived hold, thrashes while a hold
 * resolves, and physically tears into falling ends on snap.
 */
export function PhysicsRope({ holds, visual, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualRef = useRef(visual);
  const holdsRef = useRef(holds);
  visualRef.current = visual;
  holdsRef.current = holds;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
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
    let w = 0;
    let h = 0;
    let dpr = 1;

    const topPin = () => ({ x: w * 0.5, y: h * 0.08 });
    const baseBottomY = () => h * 0.78;

    const stretchPull = () => {
      const v = visualRef.current;
      const n = holdsRef.current;
      let pull = 0.02 + n * 0.038;
      if (v === 'fraying') pull += 0.12 + Math.sin(time * 14) * 0.03;
      if (v === 'tension') pull += 0.025;
      if (v === 'banked') pull *= 0.5;
      if (v === 'idle') pull = 0.012;
      return Math.min(0.28, pull);
    };

    const initRope = () => {
      points = [];
      fibers = [];
      snapped = false;
      snapAt = -1;
      const top = topPin();
      const bottomY = baseBottomY();
      const span = bottomY - top.y;
      restLen = span / SEGMENTS;
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        const x = top.x + Math.sin(t * Math.PI) * 3;
        const y = top.y + span * t;
        points.push({ x, y, ox: x, oy: y, pinned: i === 0 });
      }
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(280, rect.width);
      h = Math.max(420, rect.height);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initRope();
    };

    const triggerSnap = () => {
      if (snapped) return;
      snapped = true;
      snapAt = Math.floor(SEGMENTS * 0.48);
      const mid = points[snapAt];
      for (let i = 0; i < 32; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 1.8 + Math.random() * 5.5;
        fibers.push({
          x: mid.x + (Math.random() - 0.5) * 12,
          y: mid.y + (Math.random() - 0.5) * 10,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 2.5,
          life: 0.75 + Math.random() * 0.9,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.45,
          len: 7 + Math.random() * 16,
        });
      }
      for (let i = 1; i < points.length; i++) {
        if (i <= snapAt) {
          points[i].ox = points[i].x - (1.5 + Math.random());
          points[i].oy = points[i].y - 0.8;
        } else {
          points[i].ox = points[i].x + (1.5 + Math.random());
          points[i].oy = points[i].y - 2;
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

      // Transitions
      if (v === 'snap' && lastVisual !== 'snap') triggerSnap();
      if (v !== 'snap' && lastVisual === 'snap') initRope();
      if (v === 'idle' && (lastVisual === 'banked' || lastVisual === 'snap')) initRope();
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
          Math.sin(time * (v === 'fraying' ? 18 : 2.6)) * (v === 'fraying' ? 11 : 2.2);
        bottom.x += (top.x + sway - bottom.x) * 0.4;
        bottom.y += (targetY - bottom.y) * 0.4;
        bottom.ox = bottom.x;
        bottom.oy = bottom.y;
        const taut = 1 - Math.min(0.24, pull * 0.95);
        restLen = ((baseBottomY() - top.y) / SEGMENTS) * taut;
      }

      const gravity = snapped ? 0.58 : v === 'fraying' ? 0.24 : 0.17;
      const damp = snapped ? 0.993 : 0.986;

      for (let i = 1; i < points.length; i++) {
        const p = points[i];
        if (p.pinned) continue;
        const vx = (p.x - p.ox) * damp;
        const vy = (p.y - p.oy) * damp;
        p.ox = p.x;
        p.oy = p.y;
        p.x += vx;
        p.y += vy + gravity;
        if (v === 'fraying' && !snapped) {
          p.x += Math.sin(time * 32 + i * 0.65) * 0.65;
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

      fibers = fibers.filter(f => f.life > 0);
      for (const f of fibers) {
        f.vy += 0.36;
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
    ) => {
      if (to - from < 1) return;
      ctx.beginPath();
      ctx.moveTo(points[from].x, points[from].y);
      for (let i = from + 1; i <= to; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const mx = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
      }
      ctx.lineTo(points[to].x, points[to].y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash ?? []);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const palette = () => {
      const v = visualRef.current;
      if (v === 'banked') {
        return {
          shadow: 'rgba(20, 30, 12, 0.45)',
          core: '#6f8f4e',
          mid: '#a4c57a',
          hi: 'rgba(220, 245, 180, 0.55)',
          ring: '#9ec784',
        };
      }
      if (v === 'snap') {
        return {
          shadow: 'rgba(40, 10, 5, 0.5)',
          core: '#6a3224',
          mid: '#a85a40',
          hi: 'rgba(255, 180, 150, 0.35)',
          ring: '#e08a72',
        };
      }
      if (v === 'fraying') {
        return {
          shadow: 'rgba(30, 15, 5, 0.5)',
          core: '#7a4a22',
          mid: '#d4a45a',
          hi: 'rgba(255, 220, 150, 0.55)',
          ring: '#e2b56a',
        };
      }
      return {
        shadow: 'rgba(20, 12, 5, 0.5)',
        core: '#6d4524',
        mid: '#c49a5c',
        hi: 'rgba(240, 210, 160, 0.45)',
        ring: '#e2b56a',
      };
    };

    const drawHalf = (from: number, to: number, colors: ReturnType<typeof palette>, width: number) => {
      ctx.save();
      ctx.translate(3, 4);
      drawRopeStroke(from, to, width + 3, colors.shadow);
      ctx.restore();
      drawRopeStroke(from, to, width, colors.mid);
      drawRopeStroke(from, to, width * 0.55, colors.core);
      drawRopeStroke(from, to, Math.max(1.5, width * 0.22), colors.hi, [5, 9]);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const colors = palette();
      const tautWidth = snapped ? 9 : 11.5 - Math.min(3.2, holdsRef.current * 0.4);

      if (snapped && snapAt > 0) {
        drawHalf(0, snapAt, colors, tautWidth);
        drawHalf(snapAt + 1, points.length - 1, colors, tautWidth);
      } else {
        drawHalf(0, points.length - 1, colors, tautWidth);
      }

      const top = points[0];
      ctx.fillStyle = '#2c241c';
      ctx.strokeStyle = '#5a4c3c';
      ctx.lineWidth = 1.5;
      roundRect(ctx, top.x - 34, top.y - 14, 68, 22, 6);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = '#e2b56a';
      ctx.arc(top.x, top.y - 3, 3.5, 0, Math.PI * 2);
      ctx.fill();

      const bot = points[points.length - 1];
      ctx.beginPath();
      ctx.arc(bot.x, bot.y + 12, 15, 0, Math.PI * 2);
      ctx.fillStyle = '#2a221c';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.ring;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bot.x, bot.y + 12, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = '#12100e';
      ctx.fill();

      // Hold badge in the ring
      if (!snapped && holdsRef.current > 0) {
        ctx.fillStyle = colors.ring;
        ctx.font = '700 11px "DM Sans", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(holdsRef.current), bot.x, bot.y + 12);
      }

      for (const f of fibers) {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.globalAlpha = Math.max(0, f.life);
        ctx.strokeStyle = '#c48a4a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-f.len * 0.5, 0);
        ctx.lineTo(f.len * 0.5, 0);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      if (visualRef.current === 'fraying' && !snapped) {
        const mid = points[Math.floor(points.length * 0.5)];
        const glow = ctx.createRadialGradient(mid.x, mid.y, 4, mid.x, mid.y, 56);
        glow.addColorStop(0, 'rgba(226, 181, 106, 0.3)');
        glow.addColorStop(1, 'rgba(226, 181, 106, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, 56, 0, Math.PI * 2);
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

  return <canvas ref={canvasRef} className={className ?? 'physics-rope'} aria-hidden />;
}

function roundRect(
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
