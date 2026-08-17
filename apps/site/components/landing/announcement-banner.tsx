"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const DISMISS_KEY = "jit:banner-dismissed";

export function AnnouncementBanner() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div className="relative z-50 border-b border-line-gold/40 bg-gold-200/10">
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-center gap-3 px-10 py-2 text-center">
        <p className="text-xs text-ghost-100 sm:text-sm">
          <span className="font-pixel-badge uppercase tracking-wider text-gold-200">jit 2.0</span>{" "}
          <span className="text-fg-muted">—</span> recursive schemas, a two-way JSON Schema bridge and one capability
          API.{" "}
          <Link href="/docs/whats-new" className="font-semibold text-gold-200 underline">
            See what&apos;s new →
          </Link>
        </p>
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, "1");
            setVisible(false);
          }}
          className="absolute right-3 inline-flex size-6 items-center justify-center rounded-[6px] text-fg-subtle hover:text-ghost-100"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
