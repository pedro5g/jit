export function GeneratedBadge({ children = "generated" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pixel border border-success/40 bg-success/10 px-2 py-0.5 font-pixel-badge text-[10px] uppercase tracking-wider text-success">
      <span aria-hidden className="size-1.5 bg-success" />
      {children}
    </span>
  );
}
