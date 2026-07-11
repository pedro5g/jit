import { clsx } from "clsx";

export function Section({
  id,
  children,
  className,
  bleed,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
  bleed?: React.ReactNode;
}) {
  return (
    <section id={id} className={clsx("relative scroll-mt-24 py-20 sm:py-24", className)}>
      {bleed}
      <div className="relative mx-auto w-full max-w-[1200px] px-5 sm:px-8">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "center",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: "center" | "left";
}) {
  return (
    <div className={clsx("mb-12 max-w-[760px]", align === "center" ? "mx-auto text-center" : "text-left")}>
      {eyebrow && <p className="mb-3 font-pixel-badge text-xs uppercase tracking-[0.2em] text-gold-200">{eyebrow}</p>}
      <h2 className="text-balance text-3xl font-semibold tracking-tight text-fg-strong sm:text-[2.6rem] sm:leading-[1.15]">
        {title}
      </h2>
      {lead && <p className="mt-4 text-pretty text-base leading-relaxed text-fg-muted sm:text-lg">{lead}</p>}
    </div>
  );
}
