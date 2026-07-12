import type { Metadata } from "next";
import { EnvironmentCard } from "@/components/benchmark/environment-card";
import { Section, SectionHeading } from "@/components/ui/section";
import { githubUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Benchmark methodology",
  description:
    "How jit's benchmarks are produced: mitata, heap sampling, fair competitor configuration for Zod, typia and TypeBox, and how to reproduce every suite.",
};

const principles = [
  {
    title: "mitata, avg times, heap per op",
    body: "All suites run on mitata. Reported values are average times; heap per operation is mitata's allocation sampling. Nothing is hand-timed.",
  },
  {
    title: "Fair competitor setup",
    body: "TypeBox is measured through both TypeCompiler.Check (compiled) and Value.Check (dynamic) because it documents both modes. typia uses its generated createIs / createValidate output — its fastest published path. Zod 4 runs its standard is/safeParse API.",
  },
  {
    title: "Preallocated inputs",
    body: "High-load suites preallocate the input batches (10k/100k/1M rows) before measurement so only validation or query work is timed — no generation noise inside the loop.",
  },
  {
    title: "Same schema, same data",
    body: "Every implementation validates the identical shape over the identical dataset in each suite. Invalid-input suites place the broken rows deterministically (e.g. at the tail).",
  },
  {
    title: "Versioned, reproducible, honest",
    body: "Competitor versions are pinned in the repository lockfile. Every suite has a pnpm bench:* command; results vary by hardware, so relative ratios are the signal — not absolute nanoseconds.",
  },
  {
    title: "The floor is acknowledged",
    body: "Where a handwritten fused loop is faster than any library (end-to-end flows), it is listed as the physical floor rather than hidden.",
  },
];

export default function MethodologyPage() {
  return (
    <Section ghostState="observing" ghostLabel="checking the fine print…">
      <SectionHeading
        eyebrow="Methodology"
        title="How these numbers are produced"
        lead="Benchmarks are only useful when they can be re-run and argued with. Every number on this site comes from a committed suite with a one-line reproduce command."
      />
      <div className="mb-10">
        <EnvironmentCard />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {principles.map((item) => (
          <article key={item.title} className="rounded-card border border-line-subtle bg-night-800 p-6">
            <h2 className="text-base font-semibold text-fg-strong">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{item.body}</p>
          </article>
        ))}
      </div>
      <p className="mt-10 text-sm text-fg-subtle">
        The full benchmark sources live in{" "}
        <a href={`${githubUrl}/tree/main/bench`} target="_blank" rel="noreferrer" className="text-gold-200 underline">
          bench/
        </a>{" "}
        in the repository — <span className="font-mono">pnpm bench:all</span> runs everything.
      </p>
    </Section>
  );
}
