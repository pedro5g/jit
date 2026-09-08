import { createHash } from "node:crypto";

/**
 * Small, deliberately approximate source metrics for internal performance
 * investigations. They describe emitted source shape; they are not a parser
 * and must never become a runtime compiler policy.
 */
export interface SourceMetrics {
  readonly bytes: number;
  readonly sha256: string;
  readonly helpers: number;
  readonly branches: number;
  readonly loops: number;
  readonly bindings: number;
}

function count(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}

export function measureSource(source: string): SourceMetrics {
  const helpers = count(source, /\bfunction\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(/g);
  const branches = count(source, /\bif\s*\(/g) + count(source, /\bswitch\s*\(/g) + count(source, /\?\s*[^?:\n]+\s*:/g);
  const loops =
    count(source, /\bfor\s*\(/g) +
    count(source, /\bwhile\s*\(/g) +
    count(source, /\.(?:map|filter|reduce|forEach|some|every)\s*\(/g);
  const bindings = count(source, /\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*/g);

  return {
    bytes: Buffer.byteLength(source, "utf8"),
    sha256: createHash("sha256").update(source).digest("hex"),
    helpers,
    branches,
    loops,
    bindings,
  };
}
