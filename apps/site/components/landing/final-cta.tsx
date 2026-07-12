import { JitGhostStatic } from "@/components/brand/jit-ghost-static";
import { CopyButton } from "@/components/code/copy-button";
import { ButtonLink } from "@/components/ui/button-link";
import { Section } from "@/components/ui/section";
import { githubUrl, installCommand } from "@/lib/site";

export function FinalCta() {
  return (
    <Section id="get-started" ghostState="success" ghostLabel="ship it!">
      <div className="relative overflow-hidden rounded-panel border border-line-gold/50 bg-night-800 px-6 py-14 text-center sm:px-12">
        <div aria-hidden className="bg-hero-glow absolute inset-0" />
        <div className="relative flex flex-col items-center">
          <JitGhostStatic size={104} />
          <h2 className="mt-6 text-balance text-3xl font-semibold tracking-tight text-fg-strong sm:text-4xl">
            Ship the code you meant to write
          </h2>
          <p className="mt-4 max-w-[560px] text-pretty text-base leading-relaxed text-fg-muted">
            One schema in, specialized functions out. Read the docs, run the benchmarks on your own machine, and star
            the project if the generated code speaks for itself.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/docs">Read the documentation</ButtonLink>
            <ButtonLink href={githubUrl} variant="secondary" external>
              Contribute on GitHub
            </ButtonLink>
          </div>
          <span className="mt-6 inline-flex items-center gap-2 rounded-control border border-line-subtle bg-night-950/80 py-2 pl-4 pr-2 font-mono text-sm text-ghost-200">
            <span aria-hidden className="select-none text-fg-subtle">
              $
            </span>
            {installCommand}
            <CopyButton text={installCommand} label="Copy install command" />
          </span>
        </div>
      </div>
    </Section>
  );
}
