"use client";

import { useEffect, useRef, useState } from "react";

type Phase = "typing" | "compiling" | "done";

const INTRO_SEEN_KEY = "jit:hero-intro-seen";

/**
 * Hero compile sequence (design system §12.3): schema types in, terminal
 * "compiles", generated code appears, wordmark pops. Runs once per session,
 * never blocks content (server HTML ships complete; reduced motion skips all).
 */
export function HeroSequence({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase | "ssr">("ssr");

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
    if (reduced || seen) {
      setPhase("done");
      return;
    }

    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));

    const typeLines = (selector: string, stepMs: number, startDelay: number) => {
      const panel = container.querySelector(selector);
      if (!panel) return 0;
      const lines = panel.querySelectorAll<HTMLElement>(".line");
      panel.classList.add("type-lines");
      lines.forEach((line, index) => {
        schedule(() => line.classList.add("line-on"), startDelay + index * stepMs);
      });
      return lines.length * stepMs;
    };

    setPhase("typing");
    const schemaDuration = typeLines(".hero-schema", 80, 150);

    schedule(() => setPhase("compiling"), 150 + schemaDuration + 100);

    const compileDone = 150 + schemaDuration + 800;
    schedule(() => {
      setPhase("done");
      typeLines(".hero-generated-panel", 26, 80);
    }, compileDone);

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={ref} className="hero-sequence" data-phase={phase === "ssr" ? "done" : phase}>
      {children}
      <output aria-live="polite" className="hero-status mt-3 flex items-center gap-2 font-mono text-xs text-fg-subtle">
        {phase === "compiling" ? (
          <>
            <span aria-hidden className="hero-spinner size-2 bg-gold-200" />
            <span className="text-gold-200">jit compile</span> › building specialized is()…
          </>
        ) : (
          <>
            <span aria-hidden className="size-2 bg-success" />
            <span className="text-success">compiled</span> · cached per schema · same output in AOT
          </>
        )}
      </output>
    </div>
  );
}
