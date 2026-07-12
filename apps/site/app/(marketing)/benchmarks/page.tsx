import type { Metadata } from "next";
import { BenchmarkBarChart } from "@/components/benchmark/bar-chart";
import { EnvironmentCard } from "@/components/benchmark/environment-card";
import { ButtonLink } from "@/components/ui/button-link";
import { Section, SectionHeading } from "@/components/ui/section";
import { benchmarkGroups, benchmarkSuites } from "@/lib/benchmarks/data";

export const metadata: Metadata = {
  title: "Benchmarks",
  description:
    "Reproducible benchmarks of jit against Zod 4, typia, TypeBox and fast-json-stringify — validation, data operations, serialization, streaming and binary rowsets.",
};

export default function BenchmarksPage() {
  return (
    <Section ghostState="running" ghostLabel="racing the whole field…">
      <SectionHeading
        eyebrow="Benchmarks"
        title="Every suite, every competitor"
        lead="Results as published in the repository README. Each suite links to its detail page with heap measurements and the exact command to reproduce it on your machine."
      />
      <div className="mb-10">
        <EnvironmentCard />
      </div>
      <div className="flex flex-col gap-12">
        {benchmarkGroups.map((group) => (
          <div key={group}>
            <h2 className="mb-5 font-pixel-badge text-sm uppercase tracking-[0.2em] text-gold-200">{group}</h2>
            <div className="grid gap-5 lg:grid-cols-2">
              {benchmarkSuites
                .filter((suite) => suite.group === group)
                .map((suite) => (
                  <BenchmarkBarChart key={suite.id} suite={suite} link />
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-12 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-fg-subtle">
          Numbers vary by hardware — treat relative ratios, not absolutes, as the signal.
        </p>
        <ButtonLink href="/benchmarks/methodology" variant="secondary">
          How these numbers are produced →
        </ButtonLink>
      </div>
    </Section>
  );
}
