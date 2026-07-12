"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts a stat like "15.9x" or "207x" up from zero the first time it scrolls
 * into view. Falls back to the static value without JS or with reduced motion.
 */
export function CountUp({ value, durationMs = 900 }: { value: string; durationMs?: number }) {
  const match = value.match(/^([\d.]+)(.*)$/);
  const target = match ? Number.parseFloat(match[1]) : null;
  const suffix = match ? match[2] : "";
  const decimals = match?.[1].includes(".") ? (match[1].split(".")[1]?.length ?? 0) : 0;

  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const node = ref.current;
    if (!node || target === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect();
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min((now - start) / durationMs, 1);
            const eased = 1 - (1 - progress) ** 3;
            setDisplay(`${(target * eased).toFixed(decimals)}${suffix}`);
            if (progress < 1) frame = requestAnimationFrame(tick);
          };
          frame = requestAnimationFrame(tick);
        }
      },
      { rootMargin: "0px 0px -10% 0px" }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [target, suffix, decimals, durationMs]);

  return <span ref={ref}>{display}</span>;
}
