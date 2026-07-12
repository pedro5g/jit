import { Section, SectionHeading } from "@/components/ui/section";

const pipeline = ["schema DSL", "schema AST", "IR", "optimizer passes", "codegen", "Function / AOT module"];

const guarantees = [
  {
    title: "External bindings only",
    body: "Runtime values (regexes, refinement callbacks, query arguments) travel as __q0/__v0 bindings — never interpolated into generated source.",
  },
  {
    title: "Static shapes, static keys",
    body: "No for...in or Object.keys over known shapes. Property access is compiled per field, in declaration order.",
  },
  {
    title: "Cheapest checks first",
    body: "typeof → null → numeric → length → regex. The generated order is part of the contract, verified by byte-exact golden tests.",
  },
  {
    title: "Dedicated optimizer passes",
    body: "equal and query run their own IR passes — inline-vars, optimize-cost, reorder-compares — with cost tables tuned per operation.",
  },
];

export function OptimizerSection() {
  return (
    <Section id="optimizer" ghostState="compiling" ghostLabel="running optimizer passes…">
      <SectionHeading
        eyebrow="Optimizer pipeline"
        title="From schema to straight-line code"
        lead="Every emitter follows the same non-negotiable codegen rules; equal and query additionally run dedicated IR optimizer passes before emission."
      />
      <ol className="mb-12 flex flex-wrap items-center justify-center gap-y-3 font-mono text-sm">
        {pipeline.map((stage, index) => (
          <li key={stage} className="flex items-center">
            <span
              className={
                index === pipeline.length - 1
                  ? "rounded-pixel border-2 border-line-gold bg-gold-200/10 px-3 py-1.5 text-gold-200"
                  : "rounded-pixel border border-line-subtle bg-night-800 px-3 py-1.5 text-ghost-200"
              }
            >
              {stage}
            </span>
            {index < pipeline.length - 1 && (
              <span aria-hidden className="px-2 text-fg-subtle">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="grid gap-4 sm:grid-cols-2">
        {guarantees.map((item) => (
          <article key={item.title} className="rounded-card border border-line-subtle bg-night-800 p-6">
            <h3 className="text-base font-semibold text-fg-strong">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{item.body}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}
