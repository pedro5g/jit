import { benchmarkEnvironment } from "@/lib/benchmarks/data";

export function EnvironmentCard() {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line-subtle bg-night-800 p-5 font-mono text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
      <span>
        {benchmarkEnvironment.runner} · {benchmarkEnvironment.runtime} · {benchmarkEnvironment.os} ·{" "}
        {benchmarkEnvironment.cpu} · captured {benchmarkEnvironment.captured}
      </span>
      <span>{benchmarkEnvironment.competitors}</span>
    </div>
  );
}
