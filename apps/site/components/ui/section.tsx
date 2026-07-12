import { clsx } from "clsx";
import { Reveal } from "@/components/motion/reveal";

export function Section({
  id,
  children,
  className,
  bleed,
  ghostState,
  ghostLabel,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
  bleed?: React.ReactNode;
  /** state the ghost companion adopts while this section is in view */
  ghostState?: string;
  /** speech-bubble text shown by the companion for this section */
  ghostLabel?: string;
}) {
  return (
    <section
      id={id}
      data-ghost-state={ghostState}
      data-ghost-label={ghostLabel}
      className={clsx("relative scroll-mt-24 py-14 sm:py-24", className)}
    >
      {bleed}
      <div className="relative mx-auto w-full max-w-300 px-5 sm:px-8">
        <Reveal>{children}</Reveal>
      </div>
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
    <div className={clsx("mb-12 max-w-190", align === "center" ? "mx-auto text-center" : "text-left")}>
      {eyebrow && <p className="mb-3 font-pixel-badge text-xs uppercase tracking-[0.2em] text-gold-200">{eyebrow}</p>}
      <h2 className="text-balance text-3xl font-semibold tracking-tight text-fg-strong sm:text-[2.6rem] sm:leading-[1.15]">
        {title}
      </h2>
      {lead && <p className="mt-4 text-pretty text-base leading-relaxed text-fg-muted sm:text-lg">{lead}</p>}
    </div>
  );
}
