import { clsx } from "clsx";

export function TerminalFrame({
  title,
  children,
  footer,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-panel border border-line-subtle bg-night-950 shadow-[var(--shadow-card)]",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-line-subtle bg-surface-900/70 px-4 py-3">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-3 rounded-full bg-surface-600" />
          <span className="size-3 rounded-full bg-surface-600" />
          <span className="size-3 rounded-full bg-gold-300/70" />
        </span>
        {title && <span className="ml-2 truncate font-mono text-xs text-fg-muted">{title}</span>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
      {footer && (
        <div className="border-t border-line-subtle bg-surface-900/40 px-4 py-2.5 font-mono text-xs text-fg-subtle">
          {footer}
        </div>
      )}
    </div>
  );
}
