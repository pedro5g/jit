"use client";

import { clsx } from "clsx";
import { useState } from "react";

export function OperationTabs({ tabs, panels }: { tabs: { id: string; label: string }[]; panels: React.ReactNode[] }) {
  const [active, setActive] = useState(0);

  return (
    <div>
      <div role="tablist" aria-label="Operations" className="mb-5 flex flex-wrap gap-1.5">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`op-tab-${tab.id}`}
            aria-selected={index === active}
            aria-controls={`op-panel-${tab.id}`}
            onClick={() => setActive(index)}
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
