/**
 * Which model runs, and everything that decision drags with it.
 *
 * §40's rule is that `CopilotService` must not know which model answered, and
 * this is where that knowledge stops. Tier selection, capability detection,
 * downloads, the reader's remembered preference and the fallback when a load
 * fails all live here; above it there is a `LanguageModelPort` or there is not.
 *
 * The fallback matters more than it looks. A WebGPU load can fail after the
 * download completes — an adapter that reports support and then refuses to
 * allocate is common on integrated GPUs — and the reader must not lose
 * retrieval because generation broke. Every failure here degrades the level
 * rather than throwing.
 */
import {
  DEFAULT_TIER,
  EMBEDDING_MODEL,
  GENERATION_MODELS,
  type GenerationModelSpec,
  type ModelTier,
  modelForTier,
  SELECTED_TIER_KEY,
} from "../../config/models.js";
import type { CapabilityLevel, CapabilityReport, EnvironmentCapabilities } from "../../core/entities/capability.js";
import type { EmbeddingPort } from "../../core/ports/embedding.js";
import type { LanguageModelPort } from "../../core/ports/language-model.js";
import type { LanguageModelAvailability, LanguageModelProviderPort } from "../../core/ports/language-model-provider.js";
import { BrowserEmbedder } from "../../infrastructure/embeddings/browser-embedder.js";
import { TransformersLanguageModel } from "../../infrastructure/models/transformers-language-model.js";
import { CopilotWorkerHost } from "../../infrastructure/models/worker-host.js";

export type ModelStatus = LanguageModelAvailability | "failed";

export interface ModelState {
  tier: ModelTier | "chrome-built-in";
  label: string;
  status: ModelStatus;
  /** 0–100 while downloading. */
  progress: number;
  loadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

export type ModelStateListener = (state: ModelState) => void;

/**
 * Memory below which the largest tier is not offered.
 *
 * `deviceMemory` is coarse — browsers report 0.25, 0.5, 1, 2, 4 or 8, capped
 * at 8 for privacy — but it is the only signal available before a download,
 * and the failure it prevents is the tab being killed mid-load.
 */
const MEMORY_FOR_LARGE_MODELS_GB = 8;

export function detectEnvironment(vectors: boolean, chromeBuiltIn = false): EnvironmentCapabilities {
  const navigatorLike = globalThis.navigator as (Navigator & { deviceMemory?: number; gpu?: unknown }) | undefined;

  const memory = navigatorLike?.deviceMemory;

  return {
    webgpu: typeof navigatorLike?.gpu === "object" && navigatorLike.gpu !== null,
    chromeBuiltIn,
    ...(typeof memory === "number" ? { deviceMemoryGb: memory } : {}),
    mobile: /Android|iPhone|iPad|iPod/i.test(navigatorLike?.userAgent ?? ""),
    vectors,
  };
}

export class ModelService {
  private readonly host = new CopilotWorkerHost();
  private readonly listeners = new Set<ModelStateListener>();

  private model: LanguageModelPort | null = null;
  private embedder: BrowserEmbedder | null = null;
  private embeddingReady = false;

  private state: ModelState = { tier: DEFAULT_TIER, label: "", status: "unsupported", progress: 0 };

  constructor(
    private readonly environment: EnvironmentCapabilities,
    private readonly builtInProvider: LanguageModelProviderPort | null = null
  ) {
    this.state = { ...this.state, ...this.initialState() };
  }

  private initialState(): Partial<ModelState> {
    if (this.environment.chromeBuiltIn) return { tier: "chrome-built-in", label: "Chrome built-in" };

    const spec = modelForTier(this.selectedTier);
    return { tier: spec.tier, label: spec.label };
  }

  subscribe(listener: ModelStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(patch: Partial<ModelState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  get current(): ModelState {
    return this.state;
  }

  /** The loaded model, or null at the retrieval-only capability levels. */
  get readyModel(): LanguageModelPort | null {
    return this.model;
  }

  /** Synchronizes optional semantic capability after artifacts are loaded. */
  setVectorAvailability(available: boolean) {
    this.environment.vectors = available;
  }

  /**
   * Tiers this machine can actually run, largest first.
   *
   * §77: a phone reporting WebGPU is still a phone. Offering a 3 GB download
   * there is offering a crash, so the list is filtered before the reader ever
   * sees a picker.
   */
  get availableTiers(): GenerationModelSpec[] {
    if (!this.environment.webgpu) return [];

    const memory = this.environment.deviceMemoryGb ?? MEMORY_FOR_LARGE_MODELS_GB;

    return GENERATION_MODELS.filter((spec) => {
      if (this.environment.mobile && spec.tier !== "light") return false;
      if (spec.tier === "strong" && memory < MEMORY_FOR_LARGE_MODELS_GB) return false;
      return true;
    });
  }

  get selectedTier(): ModelTier {
    const stored = globalThis.localStorage?.getItem(SELECTED_TIER_KEY);
    const available = this.availableTiers;

    const chosen = available.find((spec) => spec.tier === stored);
    if (chosen) return chosen.tier;

    // The default is not always available — a phone gets `light` whatever the
    // config says — so it is resolved against the filtered list, not asserted.
    return available.find((spec) => spec.tier === DEFAULT_TIER)?.tier ?? available[0]?.tier ?? DEFAULT_TIER;
  }

  selectTier(tier: ModelTier) {
    globalThis.localStorage?.setItem(SELECTED_TIER_KEY, tier);

    // The next model must be built around the new weights. Chrome's built-in
    // model is not a tier and survives the change.
    if (this.state.tier !== "chrome-built-in") this.model = null;

    const spec = modelForTier(tier);
    this.emit({ tier, label: spec.label, status: "needs-download", progress: 0 });
  }

  async status(): Promise<ModelStatus> {
    const status = this.environment.chromeBuiltIn
      ? this.builtInProvider
        ? await this.builtInProvider.availability()
        : "unsupported"
      : !this.environment.webgpu
        ? "unsupported"
        : this.model
          ? "ready"
          : "needs-download";

    this.emit({ status });
    return status;
  }

  /**
   * Loads whatever this browser can run, reporting progress.
   *
   * Chrome's built-in model first: it is already on the machine and costs the
   * reader nothing. A browser with neither that nor WebGPU gets `null`, and
   * every caller treats that as a capability level rather than a failure.
   */
  async prepare(): Promise<LanguageModelPort | null> {
    if (this.model) return this.model;

    if (this.environment.chromeBuiltIn) {
      const provider = this.builtInProvider;
      if (!provider) {
        this.emit({ status: "unsupported", progress: 0 });
        return null;
      }

      const availability = await provider.availability();
      if (availability === "unsupported" || availability === "unavailable") {
        this.emit({
          tier: "chrome-built-in",
          label: provider.label,
          status: availability,
          progress: 0,
          ...(provider.lastAvailabilityDetail ? { error: provider.lastAvailabilityDetail } : {}),
        });
        return null;
      }

      this.emit({ tier: "chrome-built-in", label: provider.label, status: "downloading", progress: 0 });
      const prepared = await provider.initialize((fraction) =>
        this.emit({ progress: Math.min(99, Math.round(fraction * 100)) })
      );
      if (prepared !== "available") {
        this.emit({
          status: prepared,
          progress: 0,
          ...(provider.lastAvailabilityDetail ? { error: provider.lastAvailabilityDetail } : {}),
        });
        return null;
      }

      this.model = provider;
      this.emit({ status: "ready", progress: 100 });
      return this.model;
    }

    if (!this.environment.webgpu) {
      this.emit({ status: "unsupported", progress: 0 });
      return null;
    }

    const spec = modelForTier(this.selectedTier);
    this.emit({
      tier: spec.tier,
      label: spec.label,
      status: "downloading",
      progress: 0,
      totalBytes: spec.approximateBytes,
    });

    try {
      await this.host.preloadGeneration(spec.repo, spec.dtype, (loadedBytes) => {
        this.emit({
          loadedBytes,
          progress: Math.min(99, Math.round((loadedBytes / spec.approximateBytes) * 100)),
        });
      });

      this.model = new TransformersLanguageModel(this.host, spec);
      this.emit({ status: "ready", progress: 100 });
      return this.model;
    } catch (error) {
      // Degrade, never throw: retrieval is still a working product.
      this.emit({
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "The model failed to load.",
      });
      return null;
    }
  }

  /**
   * The query embedder, loaded on demand.
   *
   * Separate from `prepare` because it is a hundredth of the download and buys
   * a whole capability level on its own: semantic search with no generation is
   * §79's level 1, and it is what a reader who does not want a gigabyte gets.
   */
  async prepareEmbedding(onProgress?: (progress: number) => void): Promise<EmbeddingPort | null> {
    if (this.embeddingReady && this.embedder) return this.embedder;
    if (!this.environment.webgpu || !this.environment.vectors) return null;

    this.embedder ??= new BrowserEmbedder(this.host);

    try {
      await this.embedder.preload((loadedBytes) =>
        onProgress?.(Math.min(99, Math.round((loadedBytes / EMBEDDING_MODEL.approximateBytes) * 100)))
      );

      this.embeddingReady = true;
      onProgress?.(100);
      return this.embedder;
    } catch {
      // Semantic search is an upgrade, not a requirement. Losing it drops the
      // level by one and changes nothing else.
      this.embeddingReady = false;
      return null;
    }
  }

  /** What this browser can do right now, for the banner and the debug panel. */
  capability(): CapabilityReport {
    const environment = this.environment;

    let level: CapabilityLevel = "search";
    let reason = "Documentation search: exact API lookup and full-text ranking over the shipped index.";

    if (this.embeddingReady) {
      level = "hybrid-search";
      reason = "Hybrid search: meaning as well as words, in Portuguese and English.";
    }

    if (this.model) {
      level = "navigate";
      reason = `Explanations and navigation, answered locally by ${this.state.label}.`;
    } else if (!environment.webgpu && !environment.chromeBuiltIn) {
      reason = `${reason} This browser has no WebGPU, so no local model can run here.`;
    } else if (this.state.status === "failed") {
      reason = `${reason} The local model failed to load, so answers are search results rather than explanations.`;
    }

    return { level, environment, reason };
  }

  cancelDownload() {
    this.host.cancelDownload();
    this.model = null;
    this.emit({ status: "needs-download", progress: 0 });
  }

  dispose() {
    this.host.dispose();
    this.listeners.clear();
  }
}
