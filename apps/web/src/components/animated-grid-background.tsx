import { useEffect, useRef } from 'react';

interface Point {
  sx: number;
  sy: number;
  sc: number;
  y: number;
  z: number;
  x: number;
}

const ACCENT: [number, number, number] = [0x38, 0xb6, 0xff]; // #38B6FF
const COLS = 56;
const ROWS = 40;
const X_MAX = 46;
const Z_NEAR = 3.2;
const Z_FAR = 95;
const CAM_Y = 7.2;

function col(a: number): string {
  return `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${a})`;
}

// Grade 3D com perspectiva + partículas flutuantes + pulsos de luz viajando
// pelas linhas — decoração de fundo das telas de autenticação. Portado do
// design de referência (canvas 2D puro, sem libs de WebGL/3D).
export function AnimatedGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const zs: number[] = [];
    const xs: number[] = [];
    for (let i = 0; i < ROWS; i++) zs.push(Z_NEAR * Math.pow(Z_FAR / Z_NEAR, i / (ROWS - 1)));
    for (let j = 0; j < COLS; j++) xs.push(-X_MAX + (2 * X_MAX * j) / (COLS - 1));

    const particles = Array.from({ length: 70 }, () => ({
      x: (Math.random() - 0.5) * 90,
      y: Math.random() * 16 - 2,
      z: Z_NEAR + Math.random() * (Z_FAR - Z_NEAR),
      s: 0.25 + Math.random() * 0.7,
      vy: 0.12 + Math.random() * 0.35,
      vz: -(0.05 + Math.random() * 0.25),
    }));

    const pulses = Array.from({ length: 7 }, () => ({
      xi: Math.floor(Math.random() * COLS),
      z: Z_NEAR + Math.random() * (Z_FAR - Z_NEAR),
      v: 3 + Math.random() * 6,
    }));

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let mx = 0;
    let my = 0;
    let targetMx = 0;
    let targetMy = 0;
    const onMove = (e: MouseEvent) => {
      targetMx = e.clientX / window.innerWidth - 0.5;
      targetMy = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener('mousemove', onMove);

    const wave = (x: number, z: number, t: number): number => {
      const edge = Math.pow(Math.abs(x) / X_MAX, 1.7);
      const amp = 0.5 + 3.6 * edge;
      const far = Math.min(1, 0.35 + z / 45);
      return (
        amp *
        far *
        (Math.sin(x * 0.16 + t * 0.55) * 0.62 +
          Math.sin(z * 0.115 - t * 0.8) * 0.5 +
          Math.sin((x * 0.7 + z * 0.5) * 0.1 + t * 0.35) * 0.45)
      );
    };

    const start = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const t = (now - start) / 1000;
      mx += (targetMx - mx) * 0.05;
      my += (targetMy - my) * 0.05;
      const cx = width / 2 - mx * 46;
      const horizon = height * 0.455 - my * 24;
      const f = Math.max(620, height * 0.78);

      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;

      const proj = (x: number, y: number, z: number): [number, number, number] => {
        const s = f / z;
        return [cx + x * s, horizon + (CAM_Y - y) * s, s];
      };
      const fog = (z: number): number => {
        const d = Math.max(0, Math.min(1, 1 - (z - Z_NEAR) / (Z_FAR - Z_NEAR)));
        const near = Math.min(1, (z - Z_NEAR) / 6);
        return Math.pow(d, 1.25) * (0.25 + 0.75 * near);
      };

      const pts: Point[][] = [];
      for (let i = 0; i < ROWS; i++) {
        const z = zs[i];
        const row: Point[] = [];
        for (let j = 0; j < COLS; j++) {
          const x = xs[j];
          const y = wave(x, z, t);
          const [sx, sy, sc] = proj(x, y, z);
          row.push({ sx, sy, sc, y, z, x });
        }
        pts.push(row);
      }

      const draw = (
        getPoint: (i: number, j: number) => { sx: number; sy: number },
        tint: (a: number) => string,
        mul: number,
      ) => {
        for (let i = 0; i < ROWS; i++) {
          const a = fog(zs[i]) * mul;
          if (a < 0.012) continue;
          ctx.beginPath();
          let started = false;
          for (let j = 0; j < COLS; j++) {
            const p = getPoint(i, j);
            if (p.sx < -900 || p.sx > width + 900) {
              started = false;
              continue;
            }
            if (!started) {
              ctx.moveTo(p.sx, p.sy);
              started = true;
            } else ctx.lineTo(p.sx, p.sy);
          }
          ctx.strokeStyle = tint(a * 0.42);
          ctx.stroke();
        }
        for (let j = 0; j < COLS; j += 1) {
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < ROWS; i++) {
            const p = getPoint(i, j);
            if (p.sx < -900 || p.sx > width + 900) {
              started = false;
              continue;
            }
            if (!started) {
              ctx.moveTo(p.sx, p.sy);
              started = true;
            } else ctx.lineTo(p.sx, p.sy);
          }
          ctx.strokeStyle = tint(0.11 * mul);
          ctx.stroke();
        }
      };

      const ceil = (i: number, j: number) => {
        const p = pts[i][j];
        const yc = 19 - p.y * 0.55;
        const s = f / p.z;
        return { sx: cx + p.x * s, sy: horizon + (CAM_Y - yc) * s };
      };
      draw(ceil, (a) => `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${a * 0.45})`, 0.5);

      draw((i, j) => pts[i][j], col, 1);

      for (let i = 0; i < ROWS; i += 2) {
        const a = fog(zs[i]);
        if (a < 0.06) continue;
        for (let j = 0; j < COLS; j += 3) {
          const p = pts[i][j];
          if (p.sx < -60 || p.sx > width + 60) continue;
          const r = Math.max(0.5, p.sc * 0.012);
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(190,232,255,${a * 0.5})`;
          ctx.fill();
        }
      }

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 2; i < ROWS; i += 7) {
        const a = fog(zs[i]);
        if (a < 0.12) continue;
        for (let j = (i * 5) % 9; j < COLS; j += 9) {
          const p = pts[i][j];
          if (p.sx < -60 || p.sx > width + 60) continue;
          const tw = 0.55 + 0.45 * Math.sin(t * 1.6 + i * 1.7 + j);
          const r = Math.max(1.1, p.sc * 0.03);
          const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * 6);
          g.addColorStop(0, `rgba(220,244,255,${a * tw * 0.9})`);
          g.addColorStop(0.35, col(a * tw * 0.35));
          g.addColorStop(1, col(0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, r * 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      pulses.forEach((pu) => {
        pu.z -= pu.v * 0.016 * 3;
        if (pu.z < Z_NEAR) {
          pu.z = Z_FAR;
          pu.xi = Math.floor(Math.random() * COLS);
        }
        const x = xs[pu.xi];
        const y = wave(x, pu.z, t);
        const p = proj(x, y, pu.z);
        if (p[0] < -80 || p[0] > width + 80) return;
        const a = fog(pu.z);
        const r = Math.max(1.6, p[2] * 0.05);
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 7);
        g.addColorStop(0, `rgba(235,250,255,${a})`);
        g.addColorStop(0.3, col(a * 0.5));
        g.addColorStop(1, col(0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r * 7, 0, Math.PI * 2);
        ctx.fill();

        const yb = wave(x, pu.z + 5, t);
        const pb = proj(x, yb, pu.z + 5);
        const grad = ctx.createLinearGradient(p[0], p[1], pb[0], pb[1]);
        grad.addColorStop(0, col(a * 0.55));
        grad.addColorStop(1, col(0));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.stroke();
        ctx.lineWidth = 1;
      });

      particles.forEach((pa) => {
        pa.y += pa.vy * 0.016;
        pa.z += pa.vz * 0.016 * 3;
        if (pa.y > 17) pa.y = -2;
        if (pa.z < Z_NEAR) {
          pa.z = Z_FAR;
          pa.x = (Math.random() - 0.5) * 90;
        }
        const p = proj(pa.x, pa.y, pa.z);
        if (p[0] < -40 || p[0] > width + 40 || p[1] < -40 || p[1] > height + 40) return;
        const a = fog(pa.z) * 0.85;
        const r = Math.max(0.6, p[2] * 0.006 * pa.s * 4);
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 4);
        g.addColorStop(0, `rgba(214,240,255,${a * 0.8})`);
        g.addColorStop(1, col(0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r * 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      const hz = ctx.createLinearGradient(0, horizon - height * 0.14, 0, horizon + height * 0.05);
      hz.addColorStop(0, col(0));
      hz.addColorStop(0.75, col(0.055));
      hz.addColorStop(1, col(0));
      ctx.fillStyle = hz;
      ctx.fillRect(0, horizon - height * 0.14, width, height * 0.19);

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    const onVisibilityChange = () => {
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
  );
}
