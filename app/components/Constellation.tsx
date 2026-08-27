"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#8052ff", "#2fd3df", "#ffb829", "#a78bfa", "#38bdf8", "#15846e"];

type Particle = {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  spin: number;
  orbit: boolean;
};

export function Constellation() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const current = ref.current;
    if (!current) return;
    const canvas: HTMLCanvasElement = current;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx: CanvasRenderingContext2D = context;

    let raf = 0;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function random(index: number, salt: number) {
      const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
      return value - Math.floor(value);
    }

    function seed() {
      particles = [];
      const cx = width * 0.53;
      const cy = height * 0.49;
      const scale = Math.min(width, height);

      for (let i = 0; i < 310; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const band = (i % 155) / 154;
        const angle = band * Math.PI * 3.05 + random(i, 1) * 0.5;
        const lobe = 0.54 + 0.24 * Math.sin(angle * 1.8) + random(i, 2) * 0.16;
        const radius = scale * (0.12 + band * 0.29) * lobe;
        const pinch = 0.7 + Math.abs(Math.sin(angle * 0.5)) * 0.38;
        const x = cx + side * Math.abs(Math.cos(angle)) * radius * 1.45 * pinch + (random(i, 3) - 0.5) * 22;
        const y = cy + Math.sin(angle) * radius + (random(i, 4) - 0.5) * 20;

        particles.push({
          x,
          y,
          homeX: x,
          homeY: y,
          vx: (random(i, 5) - 0.5) * 0.08,
          vy: (random(i, 6) - 0.5) * 0.08,
          size: 1.4 + random(i, 7) * 3.4,
          color: COLORS[i % COLORS.length],
          alpha: 0.28 + random(i, 8) * 0.68,
          spin: random(i, 9) * Math.PI,
          orbit: true,
        });
      }

      for (let i = 0; i < 78; i += 1) {
        const x = random(i, 11) * width;
        const y = random(i, 12) * height;
        particles.push({
          x,
          y,
          homeX: x,
          homeY: y,
          vx: (random(i, 13) - 0.5) * 0.12,
          vy: (random(i, 14) - 0.5) * 0.12,
          size: 1 + random(i, 15) * 2.4,
          color: COLORS[(i + 2) % COLORS.length],
          alpha: 0.12 + random(i, 16) * 0.24,
          spin: random(i, 17) * Math.PI,
          orbit: false,
        });
      }
    }

    function resize() {
      const parent = canvas.parentElement;
      width = Math.max(320, parent?.clientWidth ?? 560);
      height = Math.max(360, Math.round(width * 0.78));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      draw(0);
    }

    function triangle(p: Particle) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.lineTo(p.size * 0.9, p.size * 0.64);
      ctx.lineTo(-p.size * 0.9, p.size * 0.64);
      ctx.closePath();
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.restore();
    }

    function draw(time: number) {
      ctx.clearRect(0, 0, width, height);
      const drift = time * 0.00018;

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (!reducedMotion) {
          if (p.orbit) {
            p.x = p.homeX + Math.sin(drift * 1.9 + i * 0.41) * 2.4;
            p.y = p.homeY + Math.cos(drift * 1.5 + i * 0.27) * 2.1;
            p.spin += 0.0022;
          } else {
            p.x += p.vx;
            p.y += p.vy;
            p.spin += 0.0015;
            if (p.x < -8) p.x = width + 8;
            if (p.x > width + 8) p.x = -8;
            if (p.y < -8) p.y = height + 8;
            if (p.y > height + 8) p.y = -8;
          }
        }
        triangle(p);
      }

      if (!reducedMotion) raf = requestAnimationFrame(draw);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement ?? canvas);
    resize();
    if (!reducedMotion) raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="constellation" aria-hidden="true" />;
}
