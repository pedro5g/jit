"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

const VISIBLE_KEY = "jit:ghost-visible";

const defaultLabels: Record<string, string> = {
  idle: "floating around…",
  observing: "reading the code…",
  typing: "emitting specialized code…",
  compiling: "running optimizer passes…",
  running: "racing the competition…",
  success: "ship it!",
};

/**
 * The mascot follows the reader down the page (design system §7): sections
 * declare data-ghost-state / data-ghost-label and the companion reacts.
 * Hidden until a section is reached, dismissible, persisted in localStorage.
 */
export function GhostCompanion() {
  const [enabled, setEnabled] = useState(true);
  const [active, setActive] = useState<{ state: string; label: string } | null>(null);

  useEffect(() => {
    if (localStorage.getItem(VISIBLE_KEY) === "0") {
      setEnabled(false);
      return;
    }

    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-ghost-state]"));
    if (sections.length === 0) return;

    const visible = new Map<HTMLElement, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) visible.set(el, entry.intersectionRatio);
          else visible.delete(el);
        }
        let best: HTMLElement | null = null;
        let bestRatio = 0;
        for (const [el, ratio] of visible) {
          if (ratio > bestRatio) {
            best = el;
            bestRatio = ratio;
          }
        }
        if (best) {
          const state = best.dataset.ghostState ?? "idle";
          setActive({ state, label: best.dataset.ghostLabel ?? defaultLabels[state] ?? defaultLabels.idle });
        } else {
          setActive(null);
        }
      },
      { threshold: [0.15, 0.4] }
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  if (!enabled || !active) return null;

  return (
    <div className="fixed bottom-5 right-5 z-40 hidden flex-col items-end gap-2 md:flex">
      <div className="flex items-center gap-2 rounded-control border border-line-subtle bg-night-950/90 py-1.5 pl-3 pr-1.5 shadow-[var(--shadow-card)] backdrop-blur">
        <output aria-live="polite" className="font-mono text-[11px] text-fg-muted">
          {active.label}
        </output>
        <button
          type="button"
          aria-label="Hide the mascot"
          onClick={() => {
            localStorage.setItem(VISIBLE_KEY, "0");
            setEnabled(false);
          }}
          className="inline-flex size-5 items-center justify-center rounded-[4px] text-fg-subtle hover:text-danger"
        >
          <X aria-hidden className="size-3" />
        </button>
      </div>
      <div aria-hidden className={`ghost-state-${active.state}`}>
        {/* biome-ignore lint/performance/noImgElement: static brand SVG */}
        <img src="/brand/jit-ghost.svg" alt="" width={64} height={64} draggable={false} />
      </div>
    </div>
  );
}
