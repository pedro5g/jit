"use client";

import { Check, Copy } from "lucide-react";
import { useCopy } from "@/hooks/use-copy";

export function CopyButton({ text, label = "Copy to clipboard" }: { text: string; label?: string }) {
  const { copied, copyToClipboard } = useCopy();
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => copyToClipboard(text)}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-line-subtle text-fg-muted transition-colors duration-150 hover:border-line-gold hover:text-gold-200"
    >
      {copied ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
    </button>
  );
}
