import type { RuntimeFingerprint } from "./target-profile.js";

/** Reads Node runtime information without importing Node-only modules. */
export function detectRuntimeFingerprint(): RuntimeFingerprint {
  const runtime = globalThis as typeof globalThis & {
    readonly process?: {
      readonly version?: string;
      readonly versions?: Readonly<Record<string, string | undefined>>;
      readonly arch?: string;
      readonly platform?: string;
    };
  };
  const processValue = runtime.process;
  const versions = processValue?.versions;

  return Object.freeze({
    ...(processValue?.version === undefined ? {} : { node: processValue.version }),
    ...(versions?.v8 === undefined ? {} : { v8: versions.v8 }),
    ...(versions?.uv === undefined ? {} : { uv: versions.uv }),
    ...(processValue?.arch === undefined ? {} : { arch: processValue.arch }),
    ...(processValue?.platform === undefined ? {} : { platform: processValue.platform }),
  });
}
