import { ApiSurface, type ApiSurfaceDocument } from "./api-surface";
import {
  API_SURFACE_URL,
  DEFAULT_GENERATION_MODEL,
  DOCS_INDEX_URL,
  EMBEDDING_MODEL,
  findGenerationModel,
  type GenerationModel,
  SELECTED_MODEL_KEY,
} from "./catalog";
import { isLanguageModelSupported, LanguageModelProvider } from "./providers/language-model";
import { isWebGpuAvailable, TransformersProvider, TransformersRuntime } from "./providers/transformers";
import { DocsRetriever } from "./retrieval";
import type { AssistantProvider, DocsIndex, ProgressReporter, RetrievedSection } from "./types";
import { conceptPages, conceptTerms, type Understanding } from "./understanding";
import { readVectors, writeVectors } from "./vector-cache";

/** Sections per embedding call — large enough to be worth a round trip. */
const EMBED_BATCH = 16;

/**
 * Everything the assistant needs that is not React: the retrieval index, the
 * provider chosen for this browser, and the optional semantic upgrade. One
 * instance per page, created on first open so nothing here costs anything to
 * a reader who never talks to the ghost.
 */
export class AssistantEngine {
  private retriever: DocsRetriever | null = null;
  private indexPromise: Promise<DocsRetriever> | null = null;
  private readonly host = new TransformersRuntime();
  private provider: AssistantProvider | null = null;
  private embeddingsReady = false;
  /** The real API surface, available once the index has loaded. */
  private surfaceValue: ApiSurface | null = null;

  /** Which local model the reader picked, remembered between visits. */
  get selectedModel(): GenerationModel {
    if (typeof localStorage === "undefined") return DEFAULT_GENERATION_MODEL;
    return findGenerationModel(localStorage.getItem(SELECTED_MODEL_KEY));
  }

  selectModel(model: GenerationModel) {
    localStorage?.setItem(SELECTED_MODEL_KEY, model.id);
    // the next provider must be built around the new weights
    this.provider = this.provider?.runtime === "chrome-built-in" ? this.provider : null;
    return this.localProvider();
  }

  /**
   * Chrome's built-in model first: it is already on the machine and costs the
   * reader nothing. A browser with neither that nor WebGPU still gets
   * retrieval, which is a working documentation search on its own.
   */
  selectProvider(): AssistantProvider | null {
    if (this.provider) return this.provider;

    if (isLanguageModelSupported()) this.provider = new LanguageModelProvider();
    else this.provider = this.localProvider();

    return this.provider;
  }

  /** Forces the WebGPU model even where a built-in one exists. */
  localProvider(): AssistantProvider | null {
    if (!isWebGpuAvailable()) return null;

    const provider = new TransformersProvider(this.host, this.selectedModel);
    this.provider = provider;
    return provider;
  }

  /** Stops an in-flight download and keeps whatever files completed. */
  cancelDownload() {
    this.host.cancel();
  }

  loadIndex(): Promise<DocsRetriever> {
    this.indexPromise ??= Promise.all([fetch(DOCS_INDEX_URL), fetch(API_SURFACE_URL)])
      .then(async ([indexResponse, surfaceResponse]) => {
        if (!indexResponse.ok) throw new Error(`The documentation index is unavailable (${indexResponse.status}).`);

        const index = (await indexResponse.json()) as DocsIndex;
        this.retriever = new DocsRetriever(index);

        // The surface is what makes the audit able to say "that name does not
        // exist". Losing it degrades the ghost to the shallow check rather
        // than breaking it, so a failure here must not take retrieval down.
        if (surfaceResponse.ok) {
          const document = (await surfaceResponse.json()) as ApiSurfaceDocument;
          this.surfaceValue = new ApiSurface(document, index.methodsInDocs ?? []);
        }

        return this.retriever;
      })
      .catch((error: unknown) => {
        this.indexPromise = null;
        throw error;
      });

    return this.indexPromise;
  }

  get hasSemanticSearch() {
    return this.embeddingsReady;
  }

  /** Empty until the index has loaded, which is the only time it is unknown. */
  get api() {
    return this.retriever?.index.api ?? [];
  }

  /** Null until the index has loaded, or if the surface failed to fetch. */
  get surface(): ApiSurface | null {
    return this.surfaceValue;
  }

  /**
   * Turns retrieval hybrid. Cached vectors make this instant on a second
   * visit; otherwise every section is embedded once, in batches, so the
   * progress bar moves and the tab stays responsive.
   */
  async enableSemanticSearch(onProgress?: ProgressReporter): Promise<void> {
    const retriever = await this.loadIndex();
    const version = retriever.index.version;

    const cached = await readVectors(version);
    if (cached) {
      retriever.setVectors(cached);
      this.embeddingsReady = retriever.hasVectors;
      onProgress?.(100);
      return;
    }

    const total = EMBEDDING_MODEL.approximateBytes;
    // the download is the slow half; give it most of the bar
    await this.host.preloadEmbeddings((loadedBytes) =>
      onProgress?.(Math.min(60, (loadedBytes / total) * 60), { loadedBytes, totalBytes: total })
    );

    const texts = retriever.index.documents.map((section) => `${section.page} — ${section.heading}\n${section.text}`);
    const vectors: Float32Array[] = [];

    for (let start = 0; start < texts.length; start += EMBED_BATCH) {
      vectors.push(...(await this.host.embed(texts.slice(start, start + EMBED_BATCH))));
      onProgress?.(60 + (vectors.length / texts.length) * 40);
    }

    retriever.setVectors(vectors);
    this.embeddingsReady = retriever.hasVectors;
    if (this.embeddingsReady) await writeVectors(version, vectors);

    onProgress?.(100);
  }

  /** Ranks sections for a question, using vectors when they are available. */
  async retrieve(question: string, currentUrl: string, understanding?: Understanding): Promise<RetrievedSection[]> {
    const retriever = await this.loadIndex();

    let queryVector: Float32Array | null = null;
    if (this.embeddingsReady) {
      const embedded = await this.host.embed([question]).catch(() => []);
      queryVector = embedded[0] ?? null;
    }

    return retriever.search(question, {
      limit: 6,
      currentUrl,
      queryVector,
      conceptTerms: understanding ? conceptTerms(understanding.concepts) : [],
      allowHistory: understanding?.wantsHistory ?? true,
      conceptPages: understanding ? conceptPages(understanding.concepts) : [],
    });
  }

  dispose() {
    this.host.dispose();
  }
}
