import type { DownloadProgressDetails, ProgressReporter } from "./types";

export function clampProgress(progress: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(progress)));
}

/**
 * A download that reports per-file bytes can go backwards when a new file
 * starts. A progress bar that goes backwards reads as a bug, so the reported
 * value only ever climbs.
 */
export function createMonotonicProgressReporter(
  onProgress: ProgressReporter | undefined,
  options: { initial?: number; min?: number; max?: number } = {}
): ProgressReporter {
  const min = options.min ?? 0;
  const max = options.max ?? 100;
  let latest = options.initial ?? min;

  return (progress, details) => {
    latest = Math.max(latest, clampProgress(progress, min, max));
    onProgress?.(latest, details);
  };
}

interface TransformersProgressEvent {
  file?: string;
  loaded?: number;
  name?: string;
  progress?: number;
  status?: string;
  total?: number;
}

function isProgressEvent(event: unknown): event is TransformersProgressEvent {
  return Boolean(event && typeof event === "object");
}

/**
 * Turns transformers.js per-file events into one number. Files are summed by
 * bytes rather than averaged by percentage, so a 2 GB weight file does not
 * count the same as a 4 KB tokenizer config.
 */
export function createTransformersProgressCallback(onProgress: ProgressReporter | undefined) {
  const report = createMonotonicProgressReporter(onProgress, { max: 99 });
  const perFile = new Map<string, { loaded: number; total: number }>();

  return (event: unknown) => {
    if (!isProgressEvent(event)) return;
    if (event.status !== "progress") return;
    if (!event.file || typeof event.loaded !== "number" || typeof event.total !== "number" || event.total <= 0) return;

    perFile.set(`${event.name ?? "model"}:${event.file}`, {
      loaded: Math.max(0, Math.min(event.loaded, event.total)),
      total: event.total,
    });

    let loaded = 0;
    let total = 0;
    for (const file of perFile.values()) {
      loaded += file.loaded;
      total += file.total;
    }

    if (total > 0) report((loaded / total) * 100, { loadedBytes: loaded, totalBytes: total });
  };
}

/** Linear extrapolation from bytes already transferred. */
export function estimateRemainingMs({
  elapsedMs,
  loadedBytes,
  totalBytes,
}: {
  elapsedMs: number;
  loadedBytes?: number | undefined;
  totalBytes?: number | undefined;
}): number | undefined {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return undefined;
  if (!loadedBytes || !totalBytes || loadedBytes <= 0 || totalBytes <= loadedBytes) return undefined;

  const remaining = elapsedMs * ((totalBytes - loadedBytes) / loadedBytes);
  return Number.isFinite(remaining) ? Math.round(remaining) : undefined;
}

export function withRemainingTime(
  startedAt: number,
  details: DownloadProgressDetails | undefined
): DownloadProgressDetails | undefined {
  if (!details) return undefined;

  return {
    ...details,
    estimatedRemainingMs: estimateRemainingMs({
      elapsedMs: Date.now() - startedAt,
      loadedBytes: details.loadedBytes,
      totalBytes: details.totalBytes,
    }),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
