import { CodePanel } from "@/components/code/code-panel";
import { GeneratedBadge } from "@/components/code/generated-badge";
import { Section, SectionHeading } from "@/components/ui/section";
import { operationSnippets } from "@/lib/snippets/generated";
import { OperationTabs } from "./operation-tabs";

const stages = [
  {
    step: "01",
    title: "Schema",
    body: "zod-like builders describe the shape once. Types are inferred, checks are declarative, runtime values stay out of the source.",
  },
  {
    step: "02",
    title: "Normalized IR",
    body: "The schema AST is normalized into an operation-specific IR: static keys resolved, checks ordered cheapest-first, loops specialized, constants hoisted as external bindings.",
  },
  {
    step: "03",
    title: "Generated function",
    body: "One monomorphic function per operation — compiled at runtime via globalThis.Function and cached, or emitted ahead of time as plain modules.",
  },
];

export function CodegenSection() {
  return (
    <Section id="schema-to-code" className="bg-night-950/40">
      <SectionHeading
        eyebrow="Schema → IR → generated code"
        title="Every operation gets its own compiled function"
        lead="The output below is the real generated source for each operation — captured from the compiler, not a mockup. Pick an operation and read what actually runs."
      />
      <ol className="mb-12 grid gap-4 lg:grid-cols-3">
        {stages.map((stage) => (
          <li key={stage.step} className="rounded-card border border-line-subtle bg-night-800 p-6">
            <span className="font-pixel-badge text-xs text-gold-200">{stage.step}</span>
            <h3 className="mt-2 text-base font-semibold text-fg-strong">{stage.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{stage.body}</p>
          </li>
        ))}
      </ol>
      <OperationTabs
        tabs={operationSnippets.map((snippet) => ({ id: snippet.id, label: snippet.label }))}
        panels={operationSnippets.map((snippet) => (
          <div key={snippet.id} className="grid gap-5 lg:grid-cols-[2fr_3fr]">
            <CodePanel code={snippet.input} lang="ts" title="you write" copy />
            <CodePanel code={snippet.output} lang="js" title="jit generates" badge={<GeneratedBadge />} />
          </div>
        ))}
      />
      <p className="mt-6 font-mono text-xs text-fg-subtle">
        __q0 / __v0 are external bindings — runtime values are never interpolated into generated source.
      </p>
    </Section>
  );
}
