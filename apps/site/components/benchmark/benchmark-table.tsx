import { clsx } from "clsx";
import { type BenchmarkSuite, benchmarkEnvironment } from "@/lib/benchmarks/data";

export function BenchmarkTable({ suites, heap = false }: { suites: BenchmarkSuite[]; heap?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line-subtle">
      <table className="w-full min-w-140 border-collapse text-left text-sm">
        <caption className="sr-only">
          Benchmark results with environment {benchmarkEnvironment.runtime}, {benchmarkEnvironment.cpu}
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
            {heap && (
              <th scope="col" className="px-4 py-3 text-right font-semibold text-fg-strong">
                Heap/op
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {suites.flatMap((suite) =>
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
                {heap && (
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-fg-muted">{entry.heap ?? "—"}</td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
