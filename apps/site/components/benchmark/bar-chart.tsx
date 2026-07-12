import { clsx } from "clsx";
import Link from "next/link";
import type { BenchmarkSuite } from "@/lib/benchmarks/data";

export function BenchmarkBarChart({ suite, link = false }: { suite: BenchmarkSuite; link?: boolean }) {
  const max = Math.max(...suite.entries.map((entry) => entry.valueNs));

  return (
    <figure className="rounded-card border border-line-subtle bg-night-800 p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        {link ? (
          <Link href={`/benchmarks/${suite.id}`} className="text-sm font-semibold text-fg-strong hover:text-gold-200">
            {suite.title}
          </Link>
        ) : (
          <span className="text-sm font-semibold text-fg-strong">{suite.title}</span>
        )}
        <span className="font-mono text-[11px] text-fg-subtle">lower is better · {suite.command}</span>
      </figcaption>
      <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{suite.description}</p>
      <div className="mt-4 flex flex-col gap-2.5">
        {suite.entries.map((entry) => {
          const ratio = entry.valueNs / max;
          return (
            <div
              key={entry.name}
              className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 sm:grid-cols-[8.5rem_1fr_auto] sm:gap-3"
            >
              <span className="truncate text-xs text-fg-muted" title={entry.name}>
                {entry.name}
              </span>
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
