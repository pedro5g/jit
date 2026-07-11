import { clsx } from "clsx";

export function FeatureCard({
  title,
  children,
  icon,
  className,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={clsx(
        "rounded-card border border-line-subtle bg-night-800 p-6 shadow-[var(--shadow-card)]",
        "transition-colors duration-200 hover:border-line",
        className
      )}
    >
      {icon && <div className="mb-4 text-gold-200">{icon}</div>}
      <h3 className="text-base font-semibold text-fg-strong">{title}</h3>
      {children && <div className="mt-2 text-sm leading-relaxed text-fg-muted">{children}</div>}
    </article>
  );
}
