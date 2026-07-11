import { FileSearch, Terminal, Type, Wrench } from "lucide-react";
import { CodePanel } from "@/components/code/code-panel";
import { FeatureCard } from "@/components/ui/feature-card";
import { Section, SectionHeading } from "@/components/ui/section";

const inferenceSnippet = `type User = JIT.Infer<typeof User>;
//   ^? { id: number; name: string; email: string;
//        role: "admin" | "user"; tags: string[] }`;

export function DxSection() {
  return (
    <Section id="developer-experience">
      <SectionHeading
        eyebrow="Developer experience"
        title="Compiled does not mean opaque"
        lead="Every compiled function carries its own source, hash and cache report — and the CLI explains what would be generated before you ship it."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FeatureCard title="Types inferred end-to-end" icon={<Type aria-hidden className="size-5" />}>
          <p>
            Schemas carry their TypeScript type — <span className="font-mono">JIT.Infer</span> on builders, typed params
            on queries, typed DTOs on mappers. A Standard Schema v1 facade covers framework interop.
          </p>
          <CodePanel code={inferenceSnippet} lang="ts" className="mt-4" />
        </FeatureCard>
        <FeatureCard title="Inspectable output" icon={<FileSearch aria-hidden className="size-5" />}>
          <p>
            <span className="font-mono">fn.source</span> returns the generated code,{" "}
            <span className="font-mono">fn.hash</span> a deterministic source hash and{" "}
            <span className="font-mono">fn.explain()</span> the operation, cache tier and source in one report — the
            same output this page embeds.
          </p>
        </FeatureCard>
        <FeatureCard title="CLI workflow" icon={<Terminal aria-hidden className="size-5" />}>
          <p>
            <span className="font-mono">jit init</span> scaffolds config, <span className="font-mono">jit doctor</span>{" "}
            checks the setup, <span className="font-mono">jit explain</span> previews generated code and{" "}
            <span className="font-mono">jit generate</span> writes the AOT modules.
          </p>
        </FeatureCard>
        <FeatureCard title="Two-tier compile cache" icon={<Wrench aria-hidden className="size-5" />}>
          <p>
            Tier A caches applied functions for schema-derived bindings; tier B caches source templates and rebinds user
            values per compile — repeated schemas never pay codegen twice. An MCP server (
            <span className="font-mono">jit-mcp</span>) exposes the same tooling to agents.
          </p>
        </FeatureCard>
      </div>
    </Section>
  );
}
