"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";

/**
 * Scroll reveal with progressive enhancement: server HTML ships fully visible;
 * the hiding class is only applied on the client, then removed by an
 * IntersectionObserver. Reduced motion is handled in CSS.
 */
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"ssr" | "hidden" | "shown">("ssr");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.85) return; // already in view — don't blink

    setState("hidden");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setState("shown");
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={clsx(state !== "ssr" && "reveal", state === "shown" && "reveal-in", className)}>
      {children}
    </div>
  );
}
