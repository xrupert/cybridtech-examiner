"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#8052ff", "#ffb829", "#15846e", "#c084fc", "#38bdf8", "#67e8f9", "#a78bfa"];

type Particle = {
  x: number; y: number; vx: number; vy: number; s: number; c: string; a: number; spin: number;
};

export function Constellation() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const particles: Particle[] = [];

    function resize() {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth || 520;
      const h = Math.max(360, Math.round(w * 0.86));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!particles.length) seed(w, h);
    }

    function seed(w: number, h: number) {
      particles.length = 0;
      const cx = w * 0.52;
      const cy = h * 0.5;
      for (let i = 0; i < 220; i++) {
        const t = i / 220;
        const ang = t * Math.PI * 8.2 + (i % 5) * 0.4;
        const lobe = 0.55 + 0.45 * Math.sin(t * Math.PI * 3.2);
        const rad = Math.min(w, h) * 0.34 * lobe * (0.35 + (i % 9) / 12);
        particles.push({
          x: cx + Math.cos(ang) * rad * 1.25 + (Math.random() - 0.5) * 18,
          y: cy + Math.sin(ang) * rad + Math.sin(t * 12) * 16,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
          s: 2 + (i % 5),
          c: COLORS[i % COLORS.length],
          a: 0.35 + Math.random() * 0.65,
          spin: Math.random() * Math.PI,
        });
      }
      for (let i = 0; i < 70; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.12,
          s: 1.5 + Math.random() * 2,
          c: COLORS[i % COLORS.length],
          a: 0.15 + Math.random() * 0.25,
          spin: Math.random() * Math.PI,
        });
      }
    }

    function tick() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.spin += 0.01;
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.beginPath();
        ctx.moveTo(0, -p.s);
        ctx.lineTo(p.s * 0.9, p.s * 0.6);
        ctx.lineTo(-p.s * 0.9, p.s * 0.6);
        ctx.closePath();
        ctx.strokeStyle = p.c;
        ctx.globalAlpha = p.a;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="constellation" aria-hidden />;
}
