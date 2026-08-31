const FORBIDDEN = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bimportScripts\s*\(/,
  /\bindexedDB\b/,
  /\bcaches\s*\./,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bimport\s*\(/,
  /\bpostMessage\s*\(/,
  /\bnew\s+Worker\b/,
  /\bglobalThis\b/,
  /\bself\b/,
  /\bnavigator\b/,
  /\blocation\b/,
  /\.constructor\b/,
];

const ALLOWED_IMPORT = /^\s*import\s+\{\s*JIT\s*\}\s+from\s+["']@jit-compiler\/jit\/(?:runtime|define)["'];?\s*$/gm;

export function executableBlocks(answer: string): string[] {
  return [...answer.matchAll(/```(?:ts|tsx|typescript|js|javascript)\s*\n([\s\S]*?)```/gi)].map(
    (match) => match[1]?.trim() ?? ""
  );
}

export function prepareSnippet(code: string): { ok: true; code: string } | { ok: false; error: string } {
  const withoutAllowedImport = code.replace(ALLOWED_IMPORT, "");

  if (/^\s*import\b/m.test(withoutAllowedImport) || /^\s*export\b/m.test(withoutAllowedImport)) {
    return {
      ok: false,
      error: "Examples may only import JIT from the documented runtime or define entrypoint.",
    };
  }

  if (FORBIDDEN.some((pattern) => pattern.test(withoutAllowedImport))) {
    return {
      ok: false,
      error: "Examples may not access network, storage, workers, eval, or dynamic imports.",
    };
  }

  if (!/\bJIT\./.test(withoutAllowedImport)) {
    return { ok: false, error: "The example does not call JIT." };
  }

  return { ok: true, code: withoutAllowedImport };
}
