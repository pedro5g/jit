import type { ErrorLocale } from "../../errors/locale.js";
import { enUS } from "../../errors/locale.js";

/** Presentation-only runtime configuration. It contains no physical compiler knobs. */
export interface RuntimeConfig {
  /** Locale used when a diagnostic operation presents validation issues. */
  readonly locale: ErrorLocale;
}

/** Values accepted when creating or replacing an environment configuration. */
export interface RuntimeConfigInput {
  /** Locale used by errors created in this environment. */
  readonly locale?: ErrorLocale;
}

/** Resolves an immutable runtime configuration. */
export function resolveRuntimeConfig(input: RuntimeConfigInput = {}, base?: RuntimeConfig): RuntimeConfig {
  return Object.freeze({ locale: input.locale ?? base?.locale ?? enUS });
}
