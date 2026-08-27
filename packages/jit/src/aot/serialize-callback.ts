const CALLBACK_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "of",
  "return",
  "set",
  "static",
  "switch",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const CALLBACK_GLOBALS = new Set([
  "AggregateError",
  "Array",
  "ArrayBuffer",
  "atob",
  "Atomics",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "btoa",
  "clearInterval",
  "clearTimeout",
  "console",
  "crypto",
  "DataView",
  "Date",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "Error",
  "EvalError",
  "FinalizationRegistry",
  "Float32Array",
  "Float64Array",
  "Infinity",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "parseFloat",
  "parseInt",
  "performance",
  "Promise",
  "queueMicrotask",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "RegExp",
  "Set",
  "setInterval",
  "setTimeout",
  "SharedArrayBuffer",
  "String",
  "structuredClone",
  "Symbol",
  "SyntaxError",
  "TextDecoder",
  "TextEncoder",
  "TypeError",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "URIError",
  "URL",
  "URLSearchParams",
  "WeakMap",
  "WeakRef",
  "WeakSet",
]);

/**
 * Reconstructs a callback only when its source is standalone. AOT cannot
 * recreate lexical closures, native functions, bound functions or `this`.
 */
export function serializeCallback(value: Function): string | undefined {
  let source = Function.prototype.toString.call(value).trim();

  if (source.includes("[native code]") || source.startsWith("function bound ")) return undefined;

  if (!isFunctionExpressionSource(source) && !isArrowFunctionSource(source)) {
    source = normalizeMethodSource(source);
  }

  if (source === "") return undefined;

  try {
    // Syntax validation happens only in the build-time compilation path.
    Function(`return (${source});`);
  } catch {
    return undefined;
  }

  if (hasUnsupportedClosureReferences(source)) return undefined;

  return `(${source})`;
}

/**
 * Conservative free-identifier check. Rejecting an unusual callback is safer
 * than emitting a module that fails later with a hidden ReferenceError.
 */
function hasUnsupportedClosureReferences(source: string): boolean {
  if (/\b(?:this|super)\b/.test(source)) return true;

  const code = maskCallbackLiterals(source);
  const locals = new Set<string>(["arguments"]);

  for (const match of code.matchAll(/\bfunction(?:\s*\*)?\s*([A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^()]*)\)/g)) {
    if ((match[2] ?? "").includes("=")) return true;
    if (match[1]) locals.add(match[1]);
    collectBindingIdentifiers(match[2] ?? "", locals);
  }
  for (const match of code.matchAll(/(?:\(([^()]*)\)|([A-Za-z_$][A-Za-z0-9_$]*))\s*=>/g)) {
    if ((match[1] ?? "").includes("=")) return true;
    collectBindingIdentifiers(match[1] ?? match[2] ?? "", locals);
  }
  for (const match of code.matchAll(/\b(?:const|let|var|class|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    locals.add(match[1]);
  }
  for (const match of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    locals.add(match[1]);
  }

  for (const match of code.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const identifier = match[0];
    const start = match.index;
    const previous = previousNonWhitespace(code, start - 1);
    const next = nextNonWhitespace(code, start + identifier.length);

    if (previous === "." || next === ":") continue;
    if (CALLBACK_KEYWORDS.has(identifier) || CALLBACK_GLOBALS.has(identifier) || locals.has(identifier)) continue;
    return true;
  }

  return false;
}

function collectBindingIdentifiers(source: string, target: Set<string>): void {
  for (const match of source.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) target.add(match[0]);
}

function previousNonWhitespace(source: string, index: number): string | undefined {
  while (index >= 0 && /\s/.test(source[index] ?? "")) index--;
  return source[index];
}

function nextNonWhitespace(source: string, index: number): string | undefined {
  while (index < source.length && /\s/.test(source[index] ?? "")) index++;
  return source[index];
}

/** Masks comments and literal bodies while retaining `${...}` expressions. */
function maskCallbackLiterals(source: string): string {
  const output = source.split("");
  const templateOuterDepths: (number | undefined)[] = [];
  let state: "code" | "single" | "double" | "template" | "line" | "block" | "regex" = "code";
  let expressionDepth: number | undefined;
  let escaped = false;
  let regexClass = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (state === "line") {
      if (char === "\n") state = "code";
      else output[index] = " ";
      continue;
    }
    if (state === "block") {
      output[index] = " ";
      if (char === "*" && next === "/") {
        output[++index] = " ";
        state = "code";
      }
      continue;
    }
    if (state === "single" || state === "double") {
      output[index] = " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if ((state === "single" && char === "'") || (state === "double" && char === '"')) state = "code";
      continue;
    }
    if (state === "regex") {
      output[index] = " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "[") regexClass = true;
      else if (char === "]") regexClass = false;
      else if (char === "/" && !regexClass) {
        while (/[A-Za-z]/.test(source[index + 1] ?? "")) output[++index] = " ";
        state = "code";
      }
      continue;
    }
    if (state === "template") {
      output[index] = " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "`") {
        expressionDepth = templateOuterDepths.pop();
        state = "code";
      } else if (char === "$" && next === "{") {
        output[++index] = "{";
        expressionDepth = 1;
        state = "code";
      }
      continue;
    }

    if (expressionDepth !== undefined) {
      if (char === "{") expressionDepth++;
      else if (char === "}" && --expressionDepth === 0) {
        output[index] = " ";
        expressionDepth = undefined;
        state = "template";
        continue;
      }
    }
    if (char === "/" && next === "/") {
      output[index] = output[++index] = " ";
      state = "line";
    } else if (char === "/" && next === "*") {
      output[index] = output[++index] = " ";
      state = "block";
    } else if (char === "'") {
      output[index] = " ";
      state = "single";
    } else if (char === '"') {
      output[index] = " ";
      state = "double";
    } else if (char === "`") {
      output[index] = " ";
      templateOuterDepths.push(expressionDepth);
      expressionDepth = undefined;
      state = "template";
    } else if (char === "/" && startsRegexLiteral(output, index)) {
      output[index] = " ";
      regexClass = false;
      state = "regex";
    }
  }

  return output.join("");
}

function startsRegexLiteral(masked: readonly string[], index: number): boolean {
  let cursor = index - 1;

  while (cursor >= 0 && /\s/.test(masked[cursor] ?? "")) cursor--;
  if (cursor < 0) return true;
  const previous = masked[cursor] ?? "";

  if ("([{:;,=!?&|+-*%^~<>".includes(previous)) return true;
  const prefix = masked.slice(0, cursor + 1).join("");
  return /\b(?:case|delete|in|instanceof|new|return|throw|typeof|void|yield)\s*$/.test(prefix);
}

function isFunctionExpressionSource(source: string): boolean {
  return /^(?:async\s+)?function(?:\s*\*)?\b/.test(source);
}

function isArrowFunctionSource(source: string): boolean {
  return /^(?:async\s+)?(?:[A-Za-z_$][A-Za-z0-9_$]*|\([^)]*\))\s*=>/.test(source);
}

function normalizeMethodSource(source: string): string {
  const match = /^(async\s+)?(\*)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(\([\s\S]*)$/.exec(source);

  if (!match) return "";

  const asyncPrefix = match[1] ?? "";
  const generator = match[2] ? "*" : "";
  return `${asyncPrefix}function${generator} ${match[3]}${match[4]}`;
}
