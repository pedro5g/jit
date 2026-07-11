import { benchmarkEnvironment, proofStats } from "@/lib/benchmarks/data";

export function ProofStrip() {
  return (
    <section aria-label="Measured results" className="border-y border-line-subtle bg-night-950/60">
      <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
        <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {proofStats.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-1">
              <dd className="order-1 font-mono text-4xl font-semibold tabular-nums text-gold-200">{stat.value}</dd>
              <dt className="order-2 text-sm font-medium text-ghost-100">{stat.label}</dt>
              <dd className="order-3 font-mono text-xs text-fg-subtle">{stat.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 font-mono text-xs text-fg-subtle">
          {benchmarkEnvironment.runner} · {benchmarkEnvironment.runtime} · {benchmarkEnvironment.cpu} · captured{" "}
          {benchmarkEnvironment.captured} · reproduce with <span className="text-fg-muted">pnpm bench:*</span>
        </p>
      </div>
    </section>
  );
}
