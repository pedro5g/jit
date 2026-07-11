import { clsx } from "clsx";
import { Section, SectionHeading } from "@/components/ui/section";
import { benchmarkEnvironment, benchmarkSuites } from "@/lib/benchmarks/data";
import { githubUrl } from "@/lib/site";

function BarChart({ suite }: { suite: (typeof benchmarkSuites)[number] }) {
  const max = Math.max(...suite.entries.map((entry) => entry.valueNs));

  return (
    <figure className="rounded-card border border-line-subtle bg-night-800 p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-fg-strong">{suite.title}</span>
        <span className="font-mono text-[11px] text-fg-subtle">lower is better · {suite.command}</span>
      </figcaption>
      <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{suite.description}</p>
      <div className="mt-4 flex flex-col gap-2.5">
        {suite.entries.map((entry) => {
          const ratio = entry.valueNs / max;
          return (
            <div key={entry.name} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3">
              <span className="truncate text-xs text-fg-muted">{entry.name}</span>
              <span aria-hidden className="h-3 overflow-hidden rounded-pixel bg-night-950">
                <span
                  className={clsx("block h-full rounded-pixel", entry.highlight ? "bg-gold-200" : "bg-surface-600")}
                  style={{ width: `${Math.max(ratio * 100, 0.75)}%` }}
                />
              </span>
              <span
                className={clsx(
                  "font-mono text-xs tabular-nums",
                  entry.highlight ? "font-semibold text-gold-200" : "text-fg-muted"
                )}
              >
                {entry.display}
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export function BenchmarksSection() {
  return (
    <Section id="benchmarks" className="bg-night-950/40">
      <SectionHeading
        eyebrow="Benchmarks"
        title="Measured, versioned, reproducible"
        lead="Numbers below are the results published in the repository README. Every suite states its environment and the exact command to reproduce it on your machine."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {benchmarkSuites.map((suite) => (
          <BarChart key={suite.id} suite={suite} />
        ))}
      </div>

      <h3 className="sr-only">Benchmark results table</h3>
      <div className="mt-8 overflow-x-auto rounded-card border border-line-subtle">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <caption className="sr-only">
            All benchmark results with environment {benchmarkEnvironment.runtime}, {benchmarkEnvironment.cpu}
          </caption>
          <thead>
            <tr className="border-b border-line-subtle bg-surface-900/50">
              <th scope="col" className="px-4 py-3 font-semibold text-fg-strong">
                Suite
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-fg-strong">
                Implementation
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold text-fg-strong">
                Avg time
              </th>
            </tr>
          </thead>
          <tbody>
            {benchmarkSuites.flatMap((suite) =>
              suite.entries.map((entry, index) => (
                <tr key={`${suite.id}-${entry.name}`} className="border-b border-line-subtle last:border-b-0">
                  {index === 0 && (
                    <th
                      scope="rowgroup"
                      rowSpan={suite.entries.length}
                      className="border-r border-line-subtle px-4 py-3 align-top font-normal text-fg-muted"
                    >
                      {suite.title}
                    </th>
                  )}
                  <td className={clsx("px-4 py-2.5", entry.highlight ? "text-gold-200" : "text-fg-muted")}>
                    {entry.name}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ghost-200">{entry.display}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-8 flex flex-col gap-2 rounded-card border border-line-subtle bg-night-800 p-5 font-mono text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
        <span>
          {benchmarkEnvironment.runner} · {benchmarkEnvironment.runtime} · {benchmarkEnvironment.os} ·{" "}
          {benchmarkEnvironment.cpu} · captured {benchmarkEnvironment.captured}
        </span>
        <span>{benchmarkEnvironment.competitors}</span>
      </div>
      <p className="mt-4 text-sm text-fg-subtle">
        Full tables, methodology and heap measurements live in the{" "}
        <a href={`${githubUrl}#why-compiled`} target="_blank" rel="noreferrer" className="text-gold-200 underline">
          repository README
        </a>
        ; run <span className="font-mono">pnpm bench:all</span> for your own hardware.
      </p>
    </Section>
  );
}
