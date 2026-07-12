"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BenchmarkSuite } from "@/lib/benchmarks/data";

function formatRatio(valueNs: number, bestNs: number): string {
  if (valueNs === bestNs) return "fastest";
  const ratio = valueNs / bestNs;
  return `${ratio >= 100 ? ratio.toFixed(0) : ratio.toFixed(2)}x slower than the fastest`;
}

/**
 * Animated, interactive benchmark bars: widths grow when the chart scrolls
 * into view (skipped under reduced motion) and each row shows a tooltip with
 * heap and the multiplier against the fastest entry on hover/focus.
 */
export function BenchmarkBarChart({ suite, link = false }: { suite: BenchmarkSuite; link?: boolean }) {
  const max = Math.max(...suite.entries.map((entry) => entry.valueNs));
  const best = Math.min(...suite.entries.map((entry) => entry.valueNs));
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <figure ref={ref} className="rounded-card border border-line-subtle bg-night-800 p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        {link ? (
          <Link href={`/benchmarks/${suite.id}`} className="text-sm font-semibold text-fg-strong hover:text-gold-200">
            {suite.title}
          </Link>
        ) : (
          <span className="text-sm font-semibold text-fg-strong">{suite.title}</span>
        )}
        <span className="font-mono text-[11px] text-fg-subtle">lower is better · {suite.command}</span>
      </figcaption>
      <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{suite.description}</p>
      <div className="mt-4 flex flex-col gap-2.5">
        {suite.entries.map((entry, index) => {
          const ratio = entry.valueNs / max;
          const active = activeRow === index;
          return (
            <button
              key={entry.name}
              type="button"
              aria-label={`${entry.name}: ${entry.display}${entry.heap ? `, ${entry.heap} heap per op` : ""}, ${formatRatio(entry.valueNs, best)}`}
              onMouseEnter={() => setActiveRow(index)}
              onMouseLeave={() => setActiveRow(null)}
              onFocus={() => setActiveRow(index)}
              onBlur={() => setActiveRow(null)}
              className={clsx(
                "relative grid w-full cursor-default grid-cols-[5.5rem_1fr_auto] items-center gap-2 rounded-md text-left outline-none sm:grid-cols-[8.5rem_1fr_auto] sm:gap-3",
                "focus-visible:ring-1 focus-visible:ring-gold-200/60"
              )}
            >
              <span className={clsx("truncate text-xs", active ? "text-ghost-100" : "text-fg-muted")}>
                {entry.name}
              </span>
              <span aria-hidden className="h-3 overflow-hidden rounded-pixel bg-night-950">
                <span
                  className={clsx(
                    "block h-full rounded-pixel transition-[width] duration-700 ease-out",
                    entry.highlight ? "bg-gold-200" : "bg-surface-600",
                    active && !entry.highlight && "bg-surface-600 brightness-125"
                  )}
                  style={{
                    width: inView ? `${Math.max(ratio * 100, 0.75)}%` : "0.75%",
                    transitionDelay: `${index * 90}ms`,
                  }}
                />
              </span>
              <span
                className={clsx(
                  "font-mono text-xs tabular-nums",
                  entry.highlight ? "font-semibold text-gold-200" : "text-fg-muted"
                )}
              >
                {entry.display}
              </span>
              {active && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute -top-9 left-24 z-10 whitespace-nowrap rounded-lg border border-line-gold/50 bg-night-950 px-3 py-1.5 font-mono text-[11px] text-ghost-100 shadow-(--shadow-card) sm:left-36"
                >
                  {entry.display}
                  {entry.heap && <span className="text-fg-subtle"> · {entry.heap} heap/op</span>}
                  <span className={entry.valueNs === best ? " text-gold-200" : " text-fg-muted"}>
                    {" "}
                    · {formatRatio(entry.valueNs, best)}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </figure>
  );
}
