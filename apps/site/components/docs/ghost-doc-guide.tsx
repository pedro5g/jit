"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { JitGhost } from "@/components/brand/jit-ghost";

const VISIBLE_KEY = "jit:ghost-visible";

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
];

const genericTips = [
  "reading with you…",
  "hover a code block to copy it",
  "this compiles to straight-line code",
  "psst — try it in the playground",
];

function tipFor(heading: string, index: number): string {
  for (const rule of tipRules) {
    if (rule.pattern.test(heading)) return rule.tip;
  }
  return genericTips[index % genericTips.length];
}

/**
 * The mascot reads the docs with you: it tracks the active heading, floats to
 * its height at the right edge of the content (left of the TOC when present),
 * points at it and drops a reading tip. Dismissible, lg+ screens only.
 */
export function GhostDocGuide() {
  const [enabled, setEnabled] = useState(true);
  const [active, setActive] = useState<{ text: string; tip: string; top: number } | null>(null);
  const [right, setRight] = useState(24);
  const frame = useRef(0);

  useEffect(() => {
    if (localStorage.getItem(VISIBLE_KEY) === "0") {
      setEnabled(false);
      return;
    }
    if (window.matchMedia("(max-width: 1023px)").matches) return;

    const headings = Array.from(document.querySelectorAll<HTMLElement>("article h2[id], article h3[id]"));
    if (headings.length === 0) return;

    const measureRight = () => {
      const toc = document.querySelector("#nd-toc");
      if (toc) {
        const rect = toc.getBoundingClientRect();
        if (rect.width > 0) {
          setRight(Math.max(16, window.innerWidth - rect.left + 16));
          return;
        }
      }
      setRight(24);
    };

    const update = () => {
      frame.current = 0;
      const line = window.innerHeight * 0.35;
      let current: HTMLElement | null = null;
      let index = 0;
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top <= line) {
          current = headings[i];
          index = i;
        }
      }
      if (!current) {
        setActive(null);
        return;
      }
      const headingTop = current.getBoundingClientRect().top;
      const top = Math.min(Math.max(headingTop, 96), window.innerHeight - 220);
      const text = current.textContent?.trim() ?? "";
      setActive({
        text: text.length > 34 ? `${text.slice(0, 33)}…` : text,
        tip: tipFor(text, index),
        top,
      });
    };

    const onScroll = () => {
      if (!frame.current) frame.current = requestAnimationFrame(update);
    };

    measureRight();
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measureRight);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measureRight);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  if (!enabled || !active) return null;

  return (
    <div
      className="fixed z-40 hidden flex-col items-end gap-1.5 transition-[top] duration-500 ease-out motion-reduce:transition-none lg:flex"
      style={{ top: active.top, right }}
    >
      <div className="flex max-w-70 items-start gap-2 rounded-control border border-line-subtle bg-night-950/95 py-1.5 pl-3 pr-1.5 shadow-(--shadow-card) backdrop-blur">
        <output aria-live="polite" className="flex flex-col font-mono text-[11px] leading-snug">
          <span className="text-ghost-100">{active.text}</span>
          <span className="text-fg-subtle">{active.tip}</span>
        </output>
        <button
          type="button"
          aria-label="Hide the reading guide"
          onClick={() => {
            localStorage.setItem(VISIBLE_KEY, "0");
            setEnabled(false);
          }}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:text-danger"
        >
          <X aria-hidden className="size-3" />
        </button>
      </div>
      <JitGhost size={56} state="observing" follow="none" mirror />
    </div>
  );
}
