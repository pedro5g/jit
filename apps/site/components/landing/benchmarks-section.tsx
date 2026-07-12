import { BenchmarkBarChart } from "@/components/benchmark/bar-chart";
import { BenchmarkTable } from "@/components/benchmark/benchmark-table";
import { EnvironmentCard } from "@/components/benchmark/environment-card";
import { ButtonLink } from "@/components/ui/button-link";
import { Section, SectionHeading } from "@/components/ui/section";
import { landingBenchmarkSuites } from "@/lib/benchmarks/data";

export function BenchmarksSection() {
  return (
    <Section
      id="benchmarks"
      className="bg-night-950/40"
      ghostState="running"
      ghostLabel="racing zod, typia and typebox…"
    >
      <SectionHeading
        eyebrow="Benchmarks"
        title="Measured against the fastest in the field"
        lead="Zod 4, typia's generated validators, TypeBox's compiled checkers, fast-json-stringify — the numbers below are the results published in the repository README, with the exact command to reproduce each suite."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {landingBenchmarkSuites.map((suite) => (
          <BenchmarkBarChart key={suite.id} suite={suite} link />
        ))}
      </div>

      <h3 className="sr-only">Benchmark results table</h3>
      <div className="mt-8">
        <BenchmarkTable suites={landingBenchmarkSuites} />
      </div>

      <div className="mt-8">
        <EnvironmentCard />
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-fg-subtle">
          Heap measurements, methodology and every other suite live on the benchmarks pages; run{" "}
          <span className="font-mono">pnpm bench:all</span> for your own hardware.
        </p>
        <ButtonLink href="/benchmarks" variant="secondary">
          See all suites →
        </ButtonLink>
      </div>
    </Section>
  );
}
