import type { LanguageModelProviderPort } from "../../core/ports/language-model-provider.js";
import { ChromeLanguageModel, isChromeLanguageModelSupported } from "./chrome-language-model.js";

/** Composition-root factory; application services depend only on the provider port. */
export function createBuiltInLanguageModelProvider(): LanguageModelProviderPort | null {
  return isChromeLanguageModelSupported() ? new ChromeLanguageModel() : null;
}
