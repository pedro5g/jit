import { clsx } from "clsx";
import { type HighlightLang, highlight } from "@/lib/highlight";
import { CopyButton } from "./copy-button";

export async function CodePanel({
  code,
  lang = "ts",
  title,
  badge,
  copy = false,
  className,
}: {
  code: string;
  lang?: HighlightLang;
  title?: string;
  badge?: React.ReactNode;
  copy?: boolean;
  className?: string;
}) {
  const html = await highlight(code, lang);

  return (
    <figure
      className={clsx(
        "code-panel overflow-hidden rounded-[14px] border border-line-subtle bg-night-950 shadow-[var(--shadow-card)]",
        className
      )}
    >
      {(title || badge || copy) && (
        <figcaption className="flex items-center gap-2 border-b border-line-subtle bg-surface-900/60 px-4 py-2.5">
          <span aria-hidden className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-surface-600" />
            <span className="size-2.5 rounded-full bg-surface-600" />
            <span className="size-2.5 rounded-full bg-gold-300/70" />
          </span>
          {title && <span className="ml-1 truncate font-mono text-xs text-fg-muted">{title}</span>}
          <span className="ml-auto flex items-center gap-2">
            {badge}
            {copy && <CopyButton text={code.trim()} />}
          </span>
        </figcaption>
      )}
      <div
        className="overflow-x-auto p-4"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML comes from Shiki over build-time constants, never user input
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </figure>
  );
}
