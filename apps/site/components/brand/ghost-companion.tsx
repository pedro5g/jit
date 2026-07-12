"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useGhostVisibility } from "@/hooks/use-ghost-visibility";
import { type GhostState, JitGhost } from "./jit-ghost";

const defaultLabels: Record<string, string> = {
  idle: "floating around…",
  observing: "reading the code…",
  typing: "emitting specialized code…",
  compiling: "running optimizer passes…",
  running: "racing the competition…",
  success: "ship it!",
};

/** viewport waypoints the ghost wanders through, one per section (§7) */
function waypointFor(index: number, vw: number, vh: number): { x: number; y: number; side: "left" | "right" } {
  const spots: { x: number; y: number; side: "left" | "right" }[] = [
    { x: vw - 92, y: vh - 190, side: "right" },
    { x: 24, y: vh * 0.42, side: "left" },
    { x: vw - 96, y: vh * 0.3, side: "right" },
    { x: 28, y: vh - 210, side: "left" },
    { x: vw - 88, y: vh * 0.55, side: "right" },
    { x: 22, y: vh * 0.24, side: "left" },
  ];
  return spots[index % spots.length];
}

/**
 * The landing mascot wanders the screen: each section sends it to a different
 * viewport waypoint where it drops the section's tip. Dismissible; brought
 * back live by the navbar ghost toggle; desktop only; reduced motion keeps a
 * fixed corner position.
 */
export function GhostCompanion() {
  const [enabled, setEnabled] = useGhostVisibility();
  const [active, setActive] = useState<{ state: string; label: string; index: number } | null>(null);
  const [side, setSide] = useState<"left" | "right">("right");
  const shipRef = useRef<HTMLDivElement>(null);
  const lastIndex = useRef(-1);

  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia("(max-width: 767px)").matches) return;

    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-ghost-state]"));
    if (sections.length === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const fly = (index: number) => {
      const ship = shipRef.current;
      if (!ship) return;
      const spot = reduced
        ? { x: window.innerWidth - 92, y: window.innerHeight - 190, side: "right" as const }
        : waypointFor(index, window.innerWidth, window.innerHeight);
      ship.style.transform = `translate3d(${spot.x.toFixed(0)}px, ${spot.y.toFixed(0)}px, 0)`;
      setSide(spot.side);
    };

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
          const index = sections.indexOf(best);
          const state = best.dataset.ghostState ?? "idle";
          setActive({
            state,
            label: best.dataset.ghostLabel ?? defaultLabels[state] ?? defaultLabels.idle,
            index,
          });
          if (index !== lastIndex.current) {
            lastIndex.current = index;
            fly(index);
          }
        } else {
          lastIndex.current = -1;
          setActive(null);
        }
      },
      { threshold: [0.15, 0.4] }
    );
    for (const section of sections) observer.observe(section);

    const onResize = () => {
      if (lastIndex.current >= 0) fly(lastIndex.current);
    };
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [enabled]);

  if (!enabled) return null;

  const pointingLeft = side === "right";

  return (
    <div
      ref={shipRef}
      className={`pointer-events-none fixed left-0 top-0 z-40 hidden transition-transform duration-900 ease-out will-change-transform motion-reduce:transition-none ${active ? "md:block" : ""}`}
    >
      <div className={`flex items-start gap-2 ${pointingLeft ? "flex-row" : "flex-row-reverse"}`}>
        {active && (
          <output
            aria-live="polite"
            className="pointer-events-auto mt-1 flex items-center gap-2 rounded-control border border-line-subtle bg-night-950/95 py-1.5 pl-3 pr-1.5 shadow-(--shadow-card) backdrop-blur"
          >
            <span className="font-mono text-[11px] text-fg-muted">{active.label}</span>
            <button
              type="button"
              aria-label="Hide the mascot"
              onClick={() => setEnabled(false)}
              className="inline-flex size-5 items-center justify-center rounded-sm text-fg-subtle hover:text-danger"
            >
              <X aria-hidden className="size-3" />
            </button>
          </output>
        )}
        <JitGhost size={64} state={(active?.state ?? "idle") as GhostState} follow="eyes" mirror={pointingLeft} />
      </div>
    </div>
  );
}
