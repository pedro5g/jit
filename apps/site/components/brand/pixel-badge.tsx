import { clsx } from "clsx";

const tones = {
  gold: "border-line-gold bg-gold-200/10 text-gold-200",
  ghost: "border-line bg-ghost-300/10 text-ghost-200",
  success: "border-success/40 bg-success/10 text-success",
  info: "border-info/40 bg-info/10 text-info",
} as const;

export function PixelBadge({
  children,
  tone = "ghost",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-pixel border-2 px-2.5 py-1 font-pixel-badge text-[10px] uppercase tracking-wider",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
