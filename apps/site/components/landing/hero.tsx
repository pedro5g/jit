import { JitGhost } from "@/components/brand/jit-ghost";
import { PixelBadge } from "@/components/brand/pixel-badge";
import { CodePanel } from "@/components/code/code-panel";
import { CopyButton } from "@/components/code/copy-button";
import { GeneratedBadge } from "@/components/code/generated-badge";
import { ButtonLink } from "@/components/ui/button-link";
import { TerminalFrame } from "@/components/ui/terminal-frame";
import { githubUrl, installCommand } from "@/lib/site";
import { heroGeneratedExcerpt, userSchemaSource } from "@/lib/snippets/user-schema";
import { HeroParticles } from "./hero-particles";
import { HeroSequence } from "./hero-sequence";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="bg-hero-glow absolute inset-0" />
      <div aria-hidden className="bg-tech-grid absolute inset-0" />
      <HeroParticles />
      <div className="relative mx-auto grid w-full max-w-300 gap-12 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-28">
        <div className="flex max-w-155 flex-col items-start justify-center">
          <p className="mb-5 font-pixel-badge text-xs uppercase tracking-[0.24em] text-gold-200">
            The compiled data engine
          </p>
          <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-fg-strong sm:text-6xl">
            Compile intent.
            <br />
            Run <span className="text-gold-200">specialized</span> code.
          </h1>
          <p className="mt-6 text-pretty text-base leading-relaxed text-fg-muted sm:text-lg">
            jit is a schema-first data engine for TypeScript. Describe a shape once and it compiles specialized
            JavaScript for every operation — validation, equality, cloning, diffing, queries, serialization and more —
            at runtime or ahead of time.
          </p>
          <div className="mt-8 flex w-full flex-wrap items-center gap-3">
            <ButtonLink href="/docs/quick-start" className="w-full sm:w-auto">
              Get started
            </ButtonLink>
            <ButtonLink href={githubUrl} variant="secondary" external>
              Star on GitHub
            </ButtonLink>
            <span className="inline-flex items-center gap-2 rounded-control border border-line-subtle bg-night-950/80 py-2 pl-4 pr-2 font-mono text-sm text-ghost-200">
              <span aria-hidden className="select-none text-fg-subtle">
                $
              </span>
              {installCommand}
              <CopyButton text={installCommand} label="Copy install command" />
            </span>
          </div>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <PixelBadge tone="info">TypeScript-first</PixelBadge>
            <PixelBadge tone="success">Node 22+</PixelBadge>
            <PixelBadge>Browsers &amp; edge via AOT</PixelBadge>
          </div>
        </div>

        <div className="relative flex flex-col justify-center">
          <div className="absolute -top-6 right-2 z-10 hidden items-end gap-1 lg:flex">
            <JitGhost size={132} follow="full" glow />
            <span aria-hidden className="hero-wordmark mb-3 font-pixel text-3xl text-gold-200">
              jit.
            </span>
          </div>
          <HeroSequence>
            <div className="mb-5 flex items-end justify-center gap-2 lg:hidden">
              <JitGhost size={88} follow="eyes" glow />
              <span aria-hidden className="hero-wordmark mb-2 font-pixel text-2xl text-gold-200">
                jit.
              </span>
            </div>
            <TerminalFrame
              title="user.schema.ts — jit compile"
              footer={
                <span>
                  compiled on first use via <span className="text-ghost-300">globalThis.Function</span> · cached per
                  schema · AOT emits the same code as plain modules
                </span>
              }
              className="lg:mt-10"
            >
              <div className="flex flex-col gap-3">
                <CodePanel code={userSchemaSource} lang="ts" title="schema" className="hero-schema" />
                <div className="hero-generated">
                  <CodePanel
                    code={heroGeneratedExcerpt}
                    lang="js"
                    title="Users.is.source"
                    badge={<GeneratedBadge />}
                    className="hero-generated-panel"
                  />
                </div>
              </div>
            </TerminalFrame>
          </HeroSequence>
        </div>
      </div>
    </section>
  );
}
