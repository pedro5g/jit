import type { LanguageModelPort } from "./language-model.js";

export type LanguageModelAvailability = "unsupported" | "unavailable" | "needs-download" | "downloading" | "ready";
export type LanguageModelPreparation = "available" | "unsupported" | "unavailable";

/** A browser/runtime provider that can prepare a model behind the generation port. */
export interface LanguageModelProviderPort extends LanguageModelPort {
  availability(): Promise<LanguageModelAvailability>;
  initialize(onDownloadProgress?: (fraction: number) => void): Promise<LanguageModelPreparation>;
  readonly lastAvailabilityDetail?: string;
}
