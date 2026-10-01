"use client";
import { useEffect, useRef } from "react";
import { drawCaption, SAMPLE_CAPTION } from "../lib/captions/caption-renderer.js";
import { getCaptionStyle } from "../lib/captions/caption-style-manager.js";

// Cards are tiny, so draw the sample ~2.3x larger than true scale: the look
// (font, colour, outline, box, animation) is what the card is for.
const CARD_ZOOM = 2.3;

const W = 320, H = 180; // drawn at 2x the card size for crisp text

function backdrop(ctx) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#3b4a63");
  g.addColorStop(0.55, "#2a3142");
  g.addColorStop(1, "#5a4636");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // A soft "scene" so outlines and shadows read like they will on footage.
  ctx.fillStyle = "rgba(255,220,170,0.18)";
  ctx.beginPath(); ctx.arc(W * 0.78, H * 0.28, H * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(10,12,18,0.35)";
  ctx.fillRect(0, H * 0.72, W, H * 0.28);
}

// Card thumbnail: a still frame (the third word being spoken), animating
// through the whole sample line while hovered.
export default function CaptionPreview({ opts, animate = false }) {
  const ref = useRef(null);
  const zoomed = { ...opts, fontScale: getCaptionStyle(opts.styleId).size * CARD_ZOOM };
  const key = JSON.stringify(zoomed);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    let raf = 0;
    const paint = (t) => {
      ctx.clearRect(0, 0, W, H);
      backdrop(ctx);
      drawCaption(ctx, SAMPLE_CAPTION, t, W, H, zoomed);
    };
    if (!animate) {
      paint(0.72);
      // Fonts may still be loading on first paint.
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => paint(0.72));
      return undefined;
    }
    const t0 = performance.now();
    const loop = (now) => {
      const t = ((now - t0) / 1000) % (SAMPLE_CAPTION.end + 0.5);
      paint(Math.min(t, SAMPLE_CAPTION.end - 0.001));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, animate]);

  return <canvas ref={ref} width={W} height={H} className="capcard__canvas" aria-hidden="true" />;
}
