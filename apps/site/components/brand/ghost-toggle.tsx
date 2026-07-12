"use client";

import { clsx } from "clsx";
import { useGhostVisibility } from "@/hooks/use-ghost-visibility";

/** Navbar control that shows/hides every mascot on the site (design §11.3). */
export function GhostToggle({ className }: { className?: string }) {
  const [visible, setVisible] = useGhostVisibility();

  return (
    <button
      type="button"
      aria-pressed={visible}
      aria-label={visible ? "Hide the ghost mascot" : "Show the ghost mascot"}
      title={visible ? "Hide the ghost" : "Bring the ghost back"}
      onClick={() => setVisible(!visible)}
      className={clsx(
        "inline-flex size-9 items-center justify-center rounded-control border transition-all duration-150",
        visible
          ? "border-line-gold/50 bg-gold-200/10 hover:bg-gold-200/20"
          : "border-line-subtle opacity-50 grayscale hover:opacity-80",
        className
      )}
    >
      <svg viewBox="0 0 64 64" width={20} height={20} shapeRendering="crispEdges" aria-hidden="true">
        <path
          d="M12 60 L12 20 H16 V12 H20 V8 H24 V4 H40 V8 H44 V12 H48 V20 H52 V60 H46 L46 54 H40 L40 60 H34 L34 54 H28 L28 60 H22 L22 54 H16 L16 60 Z"
          fill="#ddd9b5"
        />
        <rect x="16" y="22" width="32" height="16" rx="2" fill="#151a23" />
        <rect x="22" y="26" width="5" height="8" rx="1" fill="#f9f9f8" />
        <rect x="37" y="26" width="5" height="8" rx="1" fill="#f9f9f8" />
      </svg>
    </button>
  );
}
