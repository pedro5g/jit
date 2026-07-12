"use client";

import { clsx } from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

/** Stagger-reveals shiki .line spans inside the active panel's generated code. */
function typeGeneratedLines(panel: HTMLElement | null, timers: ReturnType<typeof setTimeout>[]) {
  if (!panel) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target = panel.querySelector(".op-generated");
  if (!target) return;
  const lines = target.querySelectorAll<HTMLElement>(".line");
  if (lines.length === 0) return;
  // cap the full reveal around 1.2s regardless of line count
  const step = Math.min(24, Math.max(10, 1200 / lines.length));
  target.classList.add("type-lines");
  lines.forEach((line, index) => {
    line.classList.remove("line-on");
    timers.push(setTimeout(() => line.classList.add("line-on"), 60 + index * step));
  });
}

export function OperationTabs({ tabs, panels }: { tabs: { id: string; label: string }[]; panels: React.ReactNode[] }) {
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const typedOnce = useRef(false);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  const typeActive = useCallback(
    (index: number) => {
      clearTimers();
      const panel = containerRef.current?.querySelector<HTMLElement>(`#op-panel-${tabs[index].id}`);
      typeGeneratedLines(panel ?? null, timersRef.current);
    },
    [tabs, clearTimers]
  );

  // first reveal happens when the section scrolls into view
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !typedOnce.current) {
            typedOnce.current = true;
            typeActive(0);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -20% 0px" }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      clearTimers();
    };
  }, [typeActive, clearTimers]);

  return (
    <div ref={containerRef}>
      <div role="tablist" aria-label="Operations" className="mb-5 flex flex-wrap gap-1.5">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`op-tab-${tab.id}`}
            aria-selected={index === active}
            aria-controls={`op-panel-${tab.id}`}
            onClick={() => {
              setActive(index);
              typedOnce.current = true;
              requestAnimationFrame(() => typeActive(index));
            }}
            className={clsx(
              "rounded-control px-3.5 py-1.5 font-mono text-sm transition-colors duration-150",
              index === active
                ? "bg-gold-200 text-night-900"
                : "border border-line-subtle text-fg-muted hover:border-line hover:text-ghost-100"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {panels.map((panel, index) => (
        <div
          key={tabs[index].id}
          role="tabpanel"
          id={`op-panel-${tabs[index].id}`}
          aria-labelledby={`op-tab-${tabs[index].id}`}
          hidden={index !== active}
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
