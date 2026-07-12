"use client";

import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type GhostState, JitGhost } from "@/components/brand/jit-ghost";
import { useGhostVisibility } from "@/hooks/use-ghost-visibility";

const GHOST_SIZE = 60;
const LANE_WIDTH = 88;

const tipRules: { pattern: RegExp; tip: string }[] = [
  { pattern: /install/i, tip: "copy it, run it — one dependency" },
  { pattern: /schema/i, tip: "everything below compiles from this shape" },
  { pattern: /valid/i, tip: "is() is a pure guard — zero allocation" },
  { pattern: /generate|aot|tree/i, tip: "the output has zero imports" },
  { pattern: /bench|perf/i, tip: "reproduce locally: pnpm bench:*" },
  { pattern: /query|rowset|binary/i, tip: "one fused loop, no intermediates" },
  { pattern: /cache/i, tip: "compiled once, cached per schema" },
  { pattern: /source|inspect|explain/i, tip: "fn.source shows the real output" },
  { pattern: /error|issue/i, tip: "issues are structured vectors" },
  { pattern: /lazy|stream/i, tip: "results arrive while bytes still stream" },
  { pattern: /mask|pii|sanit|secur/i, tip: "marked fields can never leak" },
];

const genericTips = [
  "reading with you…",
  "hover a code block to copy it",
  "this compiles to straight-line code",
  "psst — try it in the playground",
  "the ghost approves this section",
];

function tipFor(heading: string, kind: "heading" | "code", index: number): string {
  if (kind === "code") return "real code — the copy button is in the corner";
  for (const rule of tipRules) {
    if (rule.pattern.test(heading)) return rule.tip;
  }
  return genericTips[index % genericTips.length];
}

interface Target {
  index: number;
  text: string;
  tip: string;
  kind: "heading" | "code";
}

type Side = "left" | "right" | "dock";

/**
 * The mascot truly navigates the docs: it flies (x+y) to hover beside the
 * element you are reading, pins a pulsing pixel marker on it, points with
 * animated chevrons, bursts pixel dust when it moves, and types a reading tip.
 * All positioning is rAF-driven with CSS transitions doing the flight;
 * dismissible; lg+ pointers only; reduced motion gets static placement.
 */
export function GhostDocGuide() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useGhostVisibility();
  const [target, setTarget] = useState<Target | null>(null);
  const [side, setSide] = useState<Side>("right");
  const [ghostState, setGhostState] = useState<GhostState>("observing");
  const [typed, setTyped] = useState("");
  const [burst, setBurst] = useState(0);

  const shipRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const lastIndex = useRef(-1);
  const stateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // typewriter for the tip text
  useEffect(() => {
    if (!target) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(target.tip);
      return;
    }
    setTyped("");
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setTyped(target.tip.slice(0, i));
      if (i >= target.tip.length) clearInterval(interval);
    }, 22);
    return () => clearInterval(interval);
  }, [target]);

  // biome-ignore lint/correctness/useExhaustiveDependencies(pathname): targets must be re-collected when the docs route changes
  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia("(max-width: 1023px)").matches) return;

    const article = document.querySelector<HTMLElement>("article#nd-page") ?? document.querySelector("article");
    if (!article) return;
    const nodes = Array.from(article.querySelectorAll<HTMLElement>("h2[id], h3[id], .prose > pre, .prose > figure"));
    if (nodes.length === 0) return;

    const kindOf = (el: HTMLElement): "heading" | "code" => (/^h[23]$/i.test(el.tagName) ? "heading" : "code");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const labelFor = (el: HTMLElement): string => {
      if (kindOf(el) === "heading") {
        const text = el.textContent?.trim() ?? "";
        return text.length > 30 ? `${text.slice(0, 29)}…` : text;
      }
      // nearest heading above names the code block
      let cursor: HTMLElement | null = el;
      while (cursor) {
        cursor = cursor.previousElementSibling as HTMLElement | null;
        if (cursor && /^h[23]$/i.test(cursor.tagName)) {
          const text = cursor.textContent?.trim() ?? "code";
          return `${text.length > 24 ? `${text.slice(0, 23)}…` : text} · code`;
        }
      }
      return "code block";
    };

    const update = () => {
      frame.current = 0;
      const line = window.innerHeight * 0.38;
      let activeEl: HTMLElement | null = null;
      let activeIndex = -1;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].getBoundingClientRect().top <= line) {
          activeEl = nodes[i];
          activeIndex = i;
        }
      }
      if (!activeEl) {
        // nothing passed yet (top of the page) — greet at the first section
        activeEl = nodes[0];
        activeIndex = 0;
      }

      const ship = shipRef.current;
      const marker = markerRef.current;
      if (!activeEl || !ship) {
        if (activeIndex === -1) {
          lastIndex.current = -1;
          setTarget(null);
          if (marker) marker.style.opacity = "0";
        }
        return;
      }

      const articleRect = article.getBoundingClientRect();
      const sidebar = document.querySelector("#nd-sidebar")?.getBoundingClientRect();
      const toc = document.querySelector("#nd-toc")?.getBoundingClientRect();
      const targetRect = activeEl.getBoundingClientRect();

      const rightEdge = toc && toc.width > 0 ? toc.left : window.innerWidth;
      const leftEdge = sidebar && sidebar.width > 0 ? sidebar.right : 0;
      const spaceRight = rightEdge - articleRect.right;
      const spaceLeft = articleRect.left - leftEdge;

      let nextSide: Side;
      let x: number;
      if (spaceRight >= LANE_WIDTH) {
        nextSide = "right";
        x = Math.min(articleRect.right + 14, rightEdge - GHOST_SIZE - 16);
      } else if (spaceLeft >= LANE_WIDTH) {
        nextSide = "left";
        x = Math.max(leftEdge + 12, articleRect.left - GHOST_SIZE - 26);
      } else {
        nextSide = "dock";
        x = window.innerWidth - GHOST_SIZE - 24;
      }
      const y =
        nextSide === "dock"
          ? window.innerHeight - 190
          : Math.min(Math.max(targetRect.top - 10, 84), window.innerHeight - 230);

      ship.style.transform = `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, 0)`;

      if (marker) {
        const markerX = Math.max(articleRect.left - 24, 8);
        const markerY = targetRect.top + (kindOf(activeEl) === "heading" ? 6 : 10);
        marker.style.transform = `translate3d(${markerX.toFixed(0)}px, ${markerY.toFixed(0)}px, 0)`;
        marker.style.opacity = "1";
      }

      setSide(nextSide);
      if (activeIndex !== lastIndex.current) {
        lastIndex.current = activeIndex;
        const kind = kindOf(activeEl);
        const label = labelFor(activeEl);
        setTarget({ index: activeIndex, text: label, tip: tipFor(label, kind, activeIndex), kind });
        if (!reduced) {
          setBurst((tick) => tick + 1);
          setGhostState("running");
          if (stateTimer.current) clearTimeout(stateTimer.current);
          stateTimer.current = setTimeout(() => setGhostState("observing"), 750);
        }
      }
    };

    const onScrollOrResize = () => {
      if (!frame.current) frame.current = requestAnimationFrame(update);
    };

    lastIndex.current = -1;
    update();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      if (frame.current) cancelAnimationFrame(frame.current);
      if (stateTimer.current) clearTimeout(stateTimer.current);
    };
  }, [pathname, enabled]);

  if (!enabled) return null;

  const pointing = side === "right" || side === "dock";

  return (
    <>
      {/* pixel marker pinned on the element being read */}
      <div
        ref={markerRef}
        aria-hidden
        className={`pointer-events-none fixed left-0 top-0 z-30 hidden size-3 opacity-0 transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none ${target ? "lg:block" : ""}`}
      >
        <span className="guide-marker-ring" />
        <span className="guide-marker-diamond" />
      </div>

      {/* the ghost ship: flies to the active element */}
      <div
        ref={shipRef}
        className={`pointer-events-none fixed left-0 top-0 z-40 hidden transition-transform duration-700 ease-out will-change-transform motion-reduce:transition-none ${target ? "lg:block" : ""}`}
      >
        <div className={`flex items-start gap-1.5 ${pointing ? "flex-row" : "flex-row-reverse"}`}>
          <div className={`mt-6 flex flex-col gap-0 ${pointing ? "items-end" : "items-start"}`}>
            {target && (
              <div className="pointer-events-auto mb-1.5 flex max-w-64 items-start gap-2 rounded-control border border-line-subtle bg-night-950/95 py-1.5 pl-3 pr-1.5 shadow-(--shadow-card) backdrop-blur">
                <output
                  aria-live="polite"
                  aria-label={`${target.text}: ${target.tip}`}
                  className="flex flex-col font-mono text-[11px] leading-snug"
                >
                  <span className="truncate text-ghost-100">{target.text}</span>
                  <span className="text-fg-subtle">
                    {typed}
                    {typed.length < target.tip.length && <span aria-hidden className="guide-caret" />}
                  </span>
                </output>
                <button
                  type="button"
                  aria-label="Hide the reading guide"
                  onClick={() => {
                    setEnabled(false);
                  }}
                  className="pointer-events-auto inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:text-danger"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </div>
            )}
            <div
              aria-hidden
              className={`flex items-center gap-0.5 ${pointing ? "mr-1 self-start" : "ml-1 self-end"}`}
              style={{ "--chevron-shift": pointing ? "-3px" : "3px" } as React.CSSProperties}
            >
              <span className="guide-chevron" data-dir={pointing ? "left" : "right"} />
              <span className="guide-chevron" data-dir={pointing ? "left" : "right"} />
              <span className="guide-chevron" data-dir={pointing ? "left" : "right"} />
            </div>
          </div>
          <div className="relative">
            <JitGhost size={GHOST_SIZE} state={ghostState} follow="none" mirror={pointing} />
            {/* pixel dust burst on every hop */}
            {burst > 0 && (
              <span aria-hidden key={burst} className="absolute inset-0">
                <span
                  className="guide-sparkle"
                  style={{ left: 6, top: 26, "--sparkle-x": "-16px", "--sparkle-y": "6px" } as React.CSSProperties}
                />
                <span
                  className="guide-sparkle"
                  style={
                    {
                      left: 10,
                      top: 40,
                      "--sparkle-x": "-12px",
                      "--sparkle-y": "16px",
                      animationDelay: "0.08s",
                    } as React.CSSProperties
                  }
                />
                <span
                  className="guide-sparkle"
                  style={
                    {
                      right: 8,
                      top: 32,
                      "--sparkle-x": "14px",
                      "--sparkle-y": "10px",
                      animationDelay: "0.14s",
                    } as React.CSSProperties
                  }
                />
                <span
                  className="guide-sparkle"
                  style={
                    {
                      right: 12,
                      top: 46,
                      "--sparkle-x": "10px",
                      "--sparkle-y": "18px",
                      animationDelay: "0.2s",
                    } as React.CSSProperties
                  }
                />
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
