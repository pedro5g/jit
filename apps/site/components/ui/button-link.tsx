import { clsx } from "clsx";
import Link from "next/link";

const variants = {
  primary: "bg-gold-200 text-night-900 shadow-[var(--shadow-gold)] hover:bg-gold-100 focus-visible:outline-gold-200",
  secondary:
    "border border-line bg-transparent text-ghost-100 hover:border-line-gold hover:text-gold-200 focus-visible:outline-gold-200",
  ghost: "text-fg-muted hover:text-ghost-100 focus-visible:outline-gold-200",
} as const;

export function ButtonLink({
  href,
  children,
  variant = "primary",
  external = false,
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof variants;
  external?: boolean;
  className?: string;
}) {
  const classes = clsx(
    "inline-flex items-center justify-center gap-2 rounded-control px-5 py-2.5 text-sm font-semibold",
    "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2",
    variants[variant],
    className
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
