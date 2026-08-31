"use client";

import { Download, HardDrive, X } from "lucide-react";
import type { ModelChoice } from "@/hooks/use-assistant";
import { formatBytes } from "@/lib/assistant/progress";
import type { ModelState } from "@/lib/copilot/application/services/model.service";
import type { GenerationModelSpec } from "@/lib/copilot/config/models";

/**
 * Where a download is agreed to, watched, and taken back.
 *
 * Every number here is measured rather than declared: the size comes from the
 * repository manifest and the "already have" figure from Cache Storage, so a
 * reader who downloaded the model last week is told they have it, and one who
 * cancelled halfway is told exactly how much is left.
 */
export function ModelPicker({
  models,
  provider,
  onSelect,
  onDownload,
  onCancel,
}: {
  models: ModelChoice[];
  provider: ModelState | null;
  onSelect: (model: GenerationModelSpec) => void;
  onDownload: () => void;
  onCancel: () => void;
}) {
  const downloading = provider?.status === "downloading";

  return (
    <div className="flex flex-col gap-1.5">
      {models.map((model) => {
        const total = model.approximateBytes;
        const active = model.selected;

        return (
          <div
            key={model.id}
            className={`rounded-control border px-2.5 py-2 transition-colors ${
              active ? "border-line-gold/60 bg-gold-200/5" : "border-line-subtle"
            }`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelect(model)}
                disabled={downloading}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
              >
                <span className="truncate text-xs font-semibold text-ghost-100">{model.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-fg-subtle">{formatBytes(total)}</span>
              </button>
            </div>

            <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">{model.summary}</p>
          </div>
        );
      })}

      {downloading ? (
        <DownloadProgress provider={provider} onCancel={onCancel} />
      ) : (
        <button
          type="button"
          onClick={onDownload}
          className="mt-0.5 inline-flex items-center justify-center gap-1.5 rounded-control border border-line-gold/50 bg-gold-200/10 px-2.5 py-1.5 text-[11px] text-gold-200 transition-colors hover:bg-gold-200/20"
        >
          <Download aria-hidden className="size-3" />
          {provider?.status === "failed" ? "Try the download again" : "Load the selected model"}
        </button>
      )}

      <p className="flex items-center gap-1.5 text-[10px] text-fg-subtle">
        <HardDrive aria-hidden className="size-3" />
        Stored in this browser. Cancelling keeps whatever finished.
      </p>
    </div>
  );
}

function DownloadProgress({ provider, onCancel }: { provider: ModelState; onCancel: () => void }) {
  const { loadedBytes, totalBytes, progress } = provider;

  return (
    <div className="mt-0.5 rounded-control border border-line-subtle px-2.5 py-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 font-mono text-[11px] text-ghost-100">
          {loadedBytes !== undefined && totalBytes !== undefined
            ? `${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`
            : `${Math.round(progress)}%`}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-control border border-line-subtle px-1.5 py-0.5 text-[10px] text-fg-muted hover:border-danger hover:text-danger"
        >
          <X aria-hidden className="size-3" />
          cancel
        </button>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-pill bg-surface-700">
        <div className="h-full bg-gold-200 transition-[width]" style={{ width: `${Math.min(100, progress)}%` }} />
      </div>
    </div>
  );
}
