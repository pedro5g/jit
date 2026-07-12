import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BenchmarkBarChart } from "@/components/benchmark/bar-chart";
import { BenchmarkTable } from "@/components/benchmark/benchmark-table";
import { EnvironmentCard } from "@/components/benchmark/environment-card";
import { Section, SectionHeading } from "@/components/ui/section";
import { benchmarkSuites, getSuite } from "@/lib/benchmarks/data";

export function generateStaticParams() {
  return benchmarkSuites.map((suite) => ({ suite: suite.id }));
}

export async function generateMetadata(props: { params: Promise<{ suite: string }> }): Promise<Metadata> {
  const params = await props.params;
  const suite = getSuite(params.suite);
  if (!suite) notFound();
  return {
    title: `${suite.title} — benchmark`,
    description: `${suite.description} Reproduce with ${suite.command}.`,
  };
}

export default async function SuitePage(props: { params: Promise<{ suite: string }> }) {
  const params = await props.params;
  const suite = getSuite(params.suite);
  if (!suite) notFound();

  return (
    <Section ghostState="running" ghostLabel={`timing ${suite.id}…`}>
      <p className="mb-6 font-mono text-xs text-fg-subtle">
        <Link href="/benchmarks" className="text-gold-200 hover:underline">
          benchmarks
        </Link>{" "}
        / {suite.group.toLowerCase()} / {suite.id}
      </p>
      <SectionHeading align="left" eyebrow={suite.group} title={suite.title} lead={suite.description} />
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <BenchmarkBarChart suite={suite} />
        <div className="flex flex-col gap-4">
          <div className="rounded-card border border-line-subtle bg-night-800 p-5">
            <h2 className="text-sm font-semibold text-fg-strong">Reproduce it</h2>
            <p className="mt-2 font-mono text-sm text-gold-200">{suite.command}</p>
            <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
              Clone the repository, install with pnpm, and run the command above. mitata prints avg times and heap per
              operation; results land in bench/results (gitignored).
            </p>
          </div>
          {suite.note && (
            <div className="rounded-card border border-line-gold/40 bg-gold-200/5 p-5 text-xs leading-relaxed text-fg-muted">
              {suite.note}
            </div>
          )}
        </div>
      </div>
      <div className="mt-8">
        <BenchmarkTable suites={[suite]} heap />
      </div>
      <div className="mt-8">
        <EnvironmentCard />
      </div>
    </Section>
  );
}
