import { useEffect, useRef } from 'react';
import { audioEngine } from '../../audio/engine';

type Props = {
  width?: number;
  height?: number;
  mode?: 'wave' | 'fft';
};

/** Live oscilloscope / spectrum display fed by the master analyser. */
export function Scope({ width = 180, height = 38, mode = 'wave' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      // grid
      ctx.strokeStyle = 'rgba(255,106,0,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      if (!audioEngine.isInited()) {
        raf = requestAnimationFrame(draw);
        return;
      }

      if (mode === 'fft') {
        const fft = audioEngine.getFft();
        const buf = fft.getValue() as Float32Array;
        const bars = buf.length;
        const bw = width / bars;
        for (let i = 0; i < bars; i++) {
          // dB values, typically -100..0
          const norm = Math.max(0, Math.min(1, (buf[i] + 100) / 100));
          const h = norm * height;
          ctx.fillStyle = `rgba(255,${106 + norm * 100},0,0.85)`;
          ctx.fillRect(i * bw, height - h, bw - 1, h);
        }
      } else {
        const analyser = audioEngine.getAnalyser();
        const buf = analyser.getValue() as Float32Array;
        ctx.strokeStyle = '#ff8a3d';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(255,106,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        const step = buf.length / width;
        for (let x = 0; x < width; x++) {
          const v = buf[Math.floor(x * step)] ?? 0;
          const y = height / 2 - v * (height / 2) * 0.9;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, mode]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,106,0,0.4)',
        display: 'block',
      }}
    />
  );
}
