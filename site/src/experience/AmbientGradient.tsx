import { useEffect, useRef } from "react";

interface Props { theme: "light" | "dark"; reducedMotion: boolean; className?: string }

// A small, smoothly upscaled field keeps the mesh independent of screen pixel density.
const WIDTH = 144;
const HEIGHT = 96;
const STRENGTHS = [1.1,1,.65];
const PALETTES = {
  light: { base: [238,233,226], shades: [[173,135,98], [255,255,253], [210,193,170]] },
  dark: { base: [48,55,64], shades: [[118,126,139], [8,13,19], [103,111,122]] },
} as const;

export function AmbientGradient({ theme, reducedMotion, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    // Retain the CSS background when canvas is unavailable.
    if (!canvas || typeof CanvasRenderingContext2D === "undefined") return;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    const image = context.createImageData(WIDTH, HEIGHT);
    const palette = PALETTES[theme];
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let frame = 0;
    let lastFrame = 0;
    let elapsed = 0;

    const draw = (time: number) => {
      // Unequal frequencies bend the field continuously without straight travel or a short loop.
      const phase = time * .2;
      const centers: [number,number][] = [
        [.12 + Math.sin(phase * .79) * .18, .2 + Math.cos(phase * 1.13) * .18],
        [.74 + Math.sin(phase * .61 + 2) * .2, .32 + Math.cos(phase * .83 + 1) * .24],
        [.48 + Math.sin(phase * .97 + 4) * .22, .64 + Math.cos(phase * .53 + 3) * .18],
      ];
      const weights = new Float64Array(3);
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const u = x / WIDTH;
          const v = y / HEIGHT;
          const warpedU = u + Math.sin(v * 5 + phase * .71) * .13;
          const warpedV = v + Math.sin(u * 4 - phase * .59) * .12;
          let total = 1;
          for (let i = 0; i < centers.length; i++) {
            const [cx,cy] = centers[i]!;
            const dx = (warpedU - cx) / (.48 + i * .04);
            const dy = (warpedV - cy) / (.34 + i * .06);
            weights[i] = Math.exp(-(dx * dx + dy * dy) * 2) * STRENGTHS[i]! * (.4 + Math.abs(u - .5) * 1.2);
            total += weights[i]!;
          }
          const index = (y * WIDTH + x) * 4;
          for (const channel of [0,1,2] as const) {
            let color: number = palette.base[channel];
            for (let i = 0; i < weights.length; i++) color += palette.shades[i]![channel] * weights[i]!;
            image.data[index + channel] = color / total;
          }
          image.data[index + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
    };
    const animate = (now: number) => {
      if (now - lastFrame >= 1000 / 24) {
        // Resume resets lastFrame, so throttled frames can safely use real elapsed time.
        elapsed += (now - lastFrame) / 1000;
        lastFrame = now;
        draw(elapsed);
      }
      frame = requestAnimationFrame(animate);
    };
    const syncAnimation = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!reducedMotion && !media.matches && visible && !document.hidden) {
        lastFrame = performance.now();
        frame = requestAnimationFrame(animate);
      }
    };
    draw(0);
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      syncAnimation();
    }) : null;
    observer?.observe(canvas);
    media.addEventListener("change", syncAnimation);
    document.addEventListener("visibilitychange", syncAnimation);
    syncAnimation();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      media.removeEventListener("change", syncAnimation);
      document.removeEventListener("visibilitychange", syncAnimation);
    };
  }, [theme, reducedMotion]);
  return <canvas ref={canvasRef} className={className} width={WIDTH} height={HEIGHT} aria-hidden="true" />;
}
