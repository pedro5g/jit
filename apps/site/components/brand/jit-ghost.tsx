"use client";

import { clsx } from "clsx";
import { useEffect, useRef } from "react";

export type GhostState = "idle" | "observing" | "typing" | "compiling" | "running" | "success";

/**
 * The living mascot (animation guide layers A+B+C): inline pixel SVG with
 * separately animatable parts — eyes blink and track the cursor, the body can
 * drift toward the pointer, and section states drive the wrapper animation.
 * All tracking is rAF-lerped; no React state on pointermove. Disabled on
 * coarse pointers and under reduced motion.
 */
export function JitGhost({
  size = 96,
  state = "idle",
  follow = "eyes",
  glow = false,
  mirror = false,
  className,
}: {
  size?: number;
  state?: GhostState;
  /** none: static · eyes: pupils track the cursor · full: body drifts too */
  follow?: "none" | "eyes" | "full";
  glow?: boolean;
  /** flip horizontally so the arm points left (e.g. at the docs content) */
  mirror?: boolean;
  className?: string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const eyesRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const eyes = eyesRef.current;
    const body = bodyRef.current;
    if (!eyes || !body) return;

    // desync blink between multiple ghosts on screen
    for (const rect of eyes.querySelectorAll("rect")) {
      rect.style.animationDelay = `${-(Math.random() * 5).toFixed(2)}s`;
    }

    if (follow === "none") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let targetEyeX = 0;
    let targetEyeY = 0;
    let targetBodyX = 0;
    let targetBodyY = 0;
    let eyeX = 0;
    let eyeY = 0;
    let bodyX = 0;
    let bodyY = 0;
    let frame = 0;

    const onMove = (event: PointerEvent) => {
      const rect = body.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const distance = Math.hypot(dx, dy);
      // eyes track anywhere nearby; the body only drifts within a radius
      targetEyeX = Math.max(-2.5, Math.min(2.5, dx * 0.02));
      targetEyeY = Math.max(-2, Math.min(2, dy * 0.02));
      if (follow === "full") {
        const reach = Math.min(distance, 360) / 360;
        targetBodyX = Math.max(-9, Math.min(9, dx * 0.035)) * reach;
        targetBodyY = Math.max(-7, Math.min(7, dy * 0.035)) * reach;
      }
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const tick = () => {
      eyeX += (targetEyeX - eyeX) * 0.16;
      eyeY += (targetEyeY - eyeY) * 0.16;
      eyes.style.transform = `translate(${eyeX.toFixed(2)}px, ${eyeY.toFixed(2)}px)`;
      let settled = Math.abs(targetEyeX - eyeX) < 0.05 && Math.abs(targetEyeY - eyeY) < 0.05;
      if (follow === "full") {
        bodyX += (targetBodyX - bodyX) * 0.11;
        bodyY += (targetBodyY - bodyY) * 0.11;
        body.style.transform = `translate(${bodyX.toFixed(2)}px, ${bodyY.toFixed(2)}px) rotate(${(bodyX * 0.35).toFixed(2)}deg)`;
        settled = settled && Math.abs(targetBodyX - bodyX) < 0.08 && Math.abs(targetBodyY - bodyY) < 0.08;
      }
      frame = settled ? 0 : requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [follow]);

  return (
    <div
      aria-hidden
      className={clsx("jit-ghost relative inline-flex select-none", `ghost-state-${state}`, className)}
      style={{ width: size, height: size }}
    >
      {glow && (
        <span
          aria-hidden
          className="absolute inset-[10%] -z-10 rounded-full blur-[18px]"
          style={{ background: "radial-gradient(circle, var(--glow-gold), transparent 70%)" }}
        />
      )}
      <div ref={bodyRef} className="size-full will-change-transform">
        <svg
          viewBox="0 0 64 64"
          width={size}
          height={size}
          shapeRendering="crispEdges"
          role="presentation"
          className={mirror ? "-scale-x-100" : undefined}
        >
          {/* body */}
          <path
            d="M12 60 L12 20 H16 V12 H20 V8 H24 V4 H40 V8 H44 V12 H48 V20 H52 V60 H46 L46 54 H40 L40 60 H34 L34 54 H28 L28 60 H22 L22 54 H16 L16 60 Z"
            fill="#ddd9b5"
          />
          {/* top-left highlight + right shade */}
          <rect x="16" y="12" width="4" height="8" fill="#f3efd1" />
          <rect x="20" y="8" width="4" height="4" fill="#f3efd1" />
          <rect x="24" y="4" width="6" height="4" fill="#f3efd1" />
          <rect x="48" y="20" width="4" height="36" fill="#beae82" />
          <rect x="44" y="12" width="4" height="8" fill="#beae82" />
          {/* terminal visor */}
          <rect x="16" y="22" width="32" height="16" rx="2" fill="#151a23" />
          {/* eyes + mouth — tracked and blinking */}
          <g ref={eyesRef} className="jit-ghost-eyes will-change-transform">
            <rect x="22" y="26" width="5" height="8" rx="1" fill="#f9f9f8" />
            <rect x="37" y="26" width="5" height="8" rx="1" fill="#f9f9f8" />
          </g>
          <rect className="jit-ghost-mouth" x="30" y="32" width="4" height="2" fill="#f9f9f8" opacity="0.65" />
          {/* little pointing arm */}
          <rect x="52" y="30" width="6" height="5" fill="#ddd9b5" />
          <rect x="56" y="28" width="4" height="4" fill="#f3efd1" />
        </svg>
      </div>
    </div>
  );
}
