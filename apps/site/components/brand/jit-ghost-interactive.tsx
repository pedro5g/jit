"use client";

import { clsx } from "clsx";
import { useEffect, useRef } from "react";

/**
 * Pointer-aware ghost (design system §8): the body drifts a few pixels toward
 * the cursor with a rAF lerp — no per-move React state. Disabled on coarse
 * pointers and under reduced motion; the static float remains.
 */
export function JitGhostInteractive({ size = 132, className }: { size?: number; className?: string }) {
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let frame = 0;

    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      // follow only within a comfortable radius, clamp to ±10px body shift
      const distance = Math.hypot(dx, dy);
      const reach = Math.min(distance, 340) / 340;
      targetX = Math.max(-10, Math.min(10, dx * 0.04)) * reach;
      targetY = Math.max(-8, Math.min(8, dy * 0.04)) * reach;
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const tick = () => {
      x += (targetX - x) * 0.12;
      y += (targetY - y) * 0.12;
      const rotate = x * 0.35;
      node.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rotate.toFixed(2)}deg)`;
      if (Math.abs(targetX - x) > 0.1 || Math.abs(targetY - y) > 0.1) {
        frame = requestAnimationFrame(tick);
      } else {
        frame = 0;
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div aria-hidden className={clsx("ghost-state-idle inline-flex", className)} style={{ width: size, height: size }}>
      <div ref={innerRef} className="relative flex size-full items-center justify-center will-change-transform">
        <span
          aria-hidden
          className="absolute inset-[12%] -z-10 rounded-full blur-[18px]"
          style={{ background: "radial-gradient(circle, var(--glow-gold), transparent 70%)" }}
        />
        {/* biome-ignore lint/performance/noImgElement: static brand SVG */}
        <img src="/brand/jit-ghost.svg" alt="" width={size} height={size} draggable={false} />
      </div>
    </div>
  );
}
