import { JitGhostStatic } from "@/components/brand/jit-ghost-static";
import { PixelBadge } from "@/components/brand/pixel-badge";
import { CodePanel } from "@/components/code/code-panel";
import { Section, SectionHeading } from "@/components/ui/section";

const runtimeSnippet = `import { JIT } from "jit/runtime";

// compiles on first use, cached per schema
const isUser = JIT.validate(User).is().compile();

isUser(input);
isUser.source;    // inspect the generated code
isUser.explain(); // { operation, hash, source, cache }`;

const aotSnippet = `# Prisma-style workflow
pnpm jit init      # writes jit.config.ts
pnpm jit generate  # emits .mjs + .cjs + .d.ts

# generated modules have zero imports —
# the engine never ships to production
import { User } from "#jit";
User.is(input);`;

export function CompilationModesSection() {
  return (
    <Section id="compilation-modes" ghostState="idle" ghostLabel="building cartridges…">
      <SectionHeading
        eyebrow="Runtime JIT vs AOT"
        title="Two execution modes, same generated code"
        lead="Compile lazily at runtime when schemas are dynamic, or generate plain modules at build time when the environment is locked down. The emitted functions are identical."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <article className="flex flex-col rounded-panel border border-line-subtle bg-night-800 p-6 sm:p-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-fg-strong">Runtime cartridge</h3>
            <PixelBadge tone="gold">JIT</PixelBadge>
          </div>
          <CodePanel code={runtimeSnippet} lang="ts" title="runtime.ts" />
          <ul className="mt-5 flex flex-col gap-2 text-sm leading-relaxed text-fg-muted">
            <li>· compiles once per schema via globalThis.Function, then reuses the cached function</li>
            <li>· two cache tiers: applied functions and rebindable source templates</li>
            <li>· ideal for dynamic schemas and long-lived processes</li>
            <li>· requires an environment that allows runtime code generation</li>
          </ul>
        </article>
        <article className="relative flex flex-col rounded-panel border border-line-gold/60 bg-night-800 p-6 sm:p-8">
          <JitGhostStatic size={72} float={false} className="absolute -top-9 right-6" />
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-fg-strong">Build cartridge</h3>
            <PixelBadge tone="success">AOT</PixelBadge>
          </div>
          <CodePanel code={aotSnippet} lang="bash" title="jit generate" />
          <ul className="mt-5 flex flex-col gap-2 text-sm leading-relaxed text-fg-muted">
            <li>· pure .mjs + .cjs + .d.ts output with zero imports — error class and helpers inlined</li>
            <li>· no compile cost at runtime, predictable deploys</li>
            <li>· works under strict CSP, edge runtimes and locked-down environments</li>
            <li>· the final bundle keeps only the generated functions you import</li>
          </ul>
        </article>
      </div>
    </Section>
  );
}
