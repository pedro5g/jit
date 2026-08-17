/** One retrievable slice of the documentation, produced by build-docs-index.mjs. */
export interface DocSection {
  /** Absolute site path, anchored at the heading it came from. */
  url: string;
  /** Frontmatter title of the page the section belongs to. */
  page: string;
  /** Frontmatter description of that page. */
  description: string;
  /** Heading text, or the page title for the intro section. */
  heading: string;
  /**
   * `page › parent heading › heading` — what distinguishes one "Performance"
   * section from the eleven others that share the word.
   */
  breadcrumb: string;
  /**
   * What the section is for. `history` marks the changelog and the migration
   * guide: right when the question is about a version, actively misleading
   * when it is about how the library behaves today.
   */
  kind: "history" | "reference" | "concept" | "guide" | "aot" | "runtime" | "overview";
  /**
   * Mostly a markdown table. It enumerates the surface in two words per row,
   * so it matches nearly every question and explains none of them.
   */
  dense?: boolean;
  /**
   * Pages this one is deliberately linked to, from its `related:` frontmatter.
   * A symbolic link the concept graph does not express on its own.
   */
  related?: string[];
  /** Heading level: 2, 3 or 4 — the page title counts as 0. */
  depth: number;
  /** Index of this piece when one heading was split into several. */
  part: number;
  /**
   * The section quotes an API the library no longer has — the migration guide
   * does this on purpose. The prompt labels it so the names are read as
   * counter-examples rather than as code to copy.
   */
  showsRemovedApis?: boolean;
  text: string;
}

/** One public `JIT.*` member, as the reference index declares it. */
export interface ApiMember {
  name: string;
  url: string;
  purpose: string;
}

export interface DocsIndex {
  /** Content digest — cached embeddings are keyed by it. */
  version: string;
  builtAt: string;
  /** The complete public surface, carried in every prompt. */
  api: ApiMember[];
  /**
   * Every method name the documentation actually calls. The audit treats these
   * as real by definition — a compiled artifact's surface is not reflected
   * anywhere else, and the docs are its specification.
   */
  methodsInDocs: string[];
  documents: DocSection[];
}

export interface RetrievedSection {
  section: DocSection;
  score: number;
  /** Which signals contributed, for the "why this source" debug view. */
  lexical: number;
  semantic: number;
}

export type ProviderRuntime = "chrome-built-in" | "webgpu-transformers";

export type ModelStatus = "unsupported" | "needs-download" | "downloading" | "ready" | "failed";

export interface ProviderState {
  runtime: ProviderRuntime;
  label: string;
  /** Catalog id of the local model, when one is selected. */
  modelId?: string | undefined;
  /** Bytes already cached, so the panel can say "resumes from 40%". */
  cachedBytes?: number | undefined;
  status: ModelStatus;
  /** 0–100 while downloading. */
  progress: number;
  error?: string | undefined;
  loadedBytes?: number | undefined;
  totalBytes?: number | undefined;
  estimatedRemainingMs?: number | undefined;
}

export interface DownloadProgressDetails {
  loadedBytes?: number | undefined;
  totalBytes?: number | undefined;
  estimatedRemainingMs?: number | undefined;
}

export type ProgressReporter = (progress: number, details?: DownloadProgressDetails) => void;

export interface GenerationRequest {
  /** Conversation so far, oldest first, without the system prompt. */
  messages: { role: "user" | "assistant"; content: string }[];
  /** Sections retrieved for the newest question. */
  context: RetrievedSection[];
  /** The complete public surface, so the model never invents a name. */
  api: ApiMember[];
  /** The real three-level surface, so namespaces list their own members. */
  surface?: import("./api-surface").ApiSurface | null | undefined;
  /** Page the reader is on, so the answer can stay local when it should. */
  currentUrl: string;
  /** Whatever is in the workspace editor, when the reader is in it. */
  editorCode?: string | undefined;
  /** What the pipeline worked out about the question before retrieving. */
  understanding?: import("./understanding").Understanding | undefined;
  maxTokens: number;
  signal: AbortSignal;
}

/** A text generator, whichever runtime is behind it. */
export interface AssistantProvider {
  readonly runtime: ProviderRuntime;
  readonly label: string;
  /** Resolves the current status without downloading anything. */
  availability(): Promise<ModelStatus>;
  /** Downloads and warms the model up, reporting progress. */
  prepare(onProgress?: ProgressReporter): Promise<void>;
  /** Streams the answer as deltas. */
  generate(request: GenerationRequest): AsyncIterable<string>;
  dispose?(): Promise<void> | void;
}
