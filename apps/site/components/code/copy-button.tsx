"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";

export function CopyButton({ text, label = "Copy to clipboard" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = setTimeout(() => setCopied(false), 1600);
      }}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-line-subtle text-fg-muted transition-colors duration-150 hover:border-line-gold hover:text-gold-200"
    >
      {copied ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
    </button>
  );
}
