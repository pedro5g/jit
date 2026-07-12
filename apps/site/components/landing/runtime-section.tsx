import { PixelBadge } from "@/components/brand/pixel-badge";
import { Section, SectionHeading } from "@/components/ui/section";
import { jsrUrl, npmUrl } from "@/lib/site";

const targets = [
  {
    name: "Node.js 22+",
    badge: "primary",
    body: "The reference runtime — the full test suite, benchmarks and CI run here. Both JIT and AOT modes are supported.",
  },
  {
    name: "Browsers",
    badge: "aot-first",
    body: "Generated functions are plain JavaScript. Runtime compilation needs new Function — blocked by strict CSP — so prefer AOT output for browser bundles.",
  },
  {
    name: "Deno & JSR",
    badge: "@jit/compiler",
    body: "Published on JSR as @jit/compiler alongside npm. Dual ESM + CJS builds with subpath exports for runtime, CLI and MCP.",
  },
  {
    name: "Edge & serverless",
    badge: "aot",
    body: "AOT modules have zero imports and zero codegen at runtime — predictable cold starts in restricted environments.",
  },
];

export function RuntimeSection() {
  return (
    <Section id="runtimes" className="bg-night-950/40" ghostState="idle" ghostLabel="checking runtime support…">
      <SectionHeading
        eyebrow="Runtime compatibility"
        title="Honest about where each mode runs"
        lead="Runtime JIT needs an environment that allows code generation. AOT removes that requirement entirely — the generated modules are just JavaScript files."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {targets.map((target) => (
          <article key={target.name} className="rounded-card border border-line-subtle bg-night-800 p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-fg-strong">{target.name}</h3>
              <PixelBadge tone="gold">{target.badge}</PixelBadge>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{target.body}</p>
          </article>
        ))}
      </div>
      <p className="mt-6 text-sm text-fg-subtle">
        Distributed via{" "}
        <a href={npmUrl} target="_blank" rel="noreferrer" className="text-gold-200 underline">
          npm
        </a>{" "}
        and{" "}
        <a href={jsrUrl} target="_blank" rel="noreferrer" className="text-gold-200 underline">
          JSR
        </a>
        , MIT licensed.
      </p>
    </Section>
  );
}
