/** 16-bit section separator (design system §18.2): three rotated pixel squares. */
export function PixelDivider() {
  return (
    <div aria-hidden className="flex items-center justify-center gap-2.5 py-2">
      <span className="size-1.5 rotate-45 bg-ghost-500/40" />
      <span className="size-2 rotate-45 bg-gold-200/70" />
      <span className="size-1.5 rotate-45 bg-ghost-500/40" />
    </div>
  );
}
