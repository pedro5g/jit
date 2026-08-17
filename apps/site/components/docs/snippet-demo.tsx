"use client";

import { RotateCcw, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SNIPPET_DEMO_EVENT, type SnippetDemoDetail } from "@/lib/assistant/bus";

/**
 * Lets the ghost answer a "what if I…" by rewriting the example on the page
 * instead of printing a variation in a panel beside it. The reader sees the
 * change where they were already looking.
 *
 * The rewrite is deliberately loud — a gold frame and a restore bar — because
 * documentation the reader cannot tell apart from a model's suggestion is
 * worse than no demonstration at all. Nothing here happens unasked: the
 * assistant offers it as a button.
 */
export function SnippetDemo() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const original = useRef<{ element: HTMLElement; html: string } | null>(null);

  const restore = useCallback(() => {
    const previous = original.current;
    if (!previous) return;

    previous.element.innerHTML = previous.html;
    previous.element.closest("figure, pre")?.classList.remove("snippet-demo");
    original.current = null;
    setActive(false);
  }, []);

  // a route change replaces the DOM this was holding on to
  // biome-ignore lint/correctness/useExhaustiveDependencies(pathname): the route changing IS the trigger; nothing in the body reads it
  useEffect(() => {
    original.current = null;
    setActive(false);
  }, [pathname]);

  useEffect(() => {
    const onDemo = (event: Event) => {
      const { code, near } = (event as CustomEvent<SnippetDemoDetail>).detail;
      if (!code.trim()) return;

      const article = document.querySelector("article#nd-page") ?? document.querySelector("article");
      if (!article) return;

      const blocks = Array.from(article.querySelectorAll<HTMLElement>("pre code"));
      if (blocks.length === 0) return;

      // the block under the heading the ghost named, else the first jit example
      const target =
        (near ? blocks.find((block) => headingAbove(block)?.toLowerCase().includes(near.toLowerCase())) : undefined) ??
        blocks.find((block) => block.textContent?.includes("JIT.")) ??
        blocks[0];

      restore();
      original.current = { element: target, html: target.innerHTML };
      target.textContent = code;
      target.closest("figure, pre")?.classList.add("snippet-demo");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setActive(true);
    };

    window.addEventListener(SNIPPET_DEMO_EVENT, onDemo);
    return () => window.removeEventListener(SNIPPET_DEMO_EVENT, onDemo);
  }, [restore]);

  if (!active) return null;

  return (
    <div className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-pill border border-line-gold/50 bg-night-950/95 py-1.5 pl-3 pr-1.5 shadow-(--shadow-card) backdrop-blur">
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-gold-200">
        <Sparkles aria-hidden className="size-3" />
        the ghost rewrote this example
      </span>
      <button
        type="button"
        onClick={restore}
        className="inline-flex items-center gap-1 rounded-pill border border-line-subtle px-2 py-0.5 text-[10px] text-fg-muted transition-colors hover:border-line-gold hover:text-gold-200"
      >
        <RotateCcw aria-hidden className="size-2.5" />
        restore the docs
      </button>
    </div>
  );
}

/** Text of the nearest heading above a code block, used to place the demo. */
function headingAbove(block: HTMLElement): string | null {
  let cursor: Element | null = block.closest("figure, pre");

  while (cursor) {
    cursor = cursor.previousElementSibling;
    if (cursor && /^h[1-4]$/i.test(cursor.tagName)) return cursor.textContent;
  }

  return null;
}
