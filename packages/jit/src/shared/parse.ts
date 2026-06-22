export const isQuoted = (text: string | number): boolean => {
  const str = `${text}`; //normalize to string
  const len = str.length;
  if (len < 2) return false;
  const quote = str.charCodeAt(0);
  // 34 = '"', 39 = "'", 96 = '`'
  if (quote !== 34 && quote !== 39 && quote !== 96) {
    return false;
  }
  if (str.charCodeAt(len - 1) !== quote) {
    return false;
  }
  // ensure that the same quotation mark does not apply to the internal content.
  for (let i = 1; i < len - 1; i++) {
    if (str.charCodeAt(i) === quote) {
      return false;
    }
  }
  return true;
};

const ESC = new Array<string>(97).fill("");

ESC[8] = "\\b";
ESC[9] = "\\t";
ESC[10] = "\\n";
ESC[12] = "\\f";
ESC[13] = "\\r";
ESC[34] = '\\"';
ESC[92] = "\\\\";
ESC[96] = "\\`";

export function escapeString(str: string): string {
  let prev = 0;
  let out = "";

  for (let i = 0, len = str.length; i < len; i++) {
    const ch = str.charCodeAt(i);

    if (ch < 32 || ch === 34 || ch === 92 || ch === 96) {
      out += str.slice(prev, i) + ESC[ch];
      prev = i + 1;
      continue;
    }

    if (ch >= 0xd800 && ch <= 0xdfff) {
      if (ch <= 0xdbff && i + 1 < len) {
        const next = str.charCodeAt(i + 1);

        if (next >= 0xdc00 && next <= 0xdfff) {
          i++;
          continue;
        }
      }

      out += str.slice(prev, i) + "\\u" + ch.toString(16);
      prev = i + 1;
    }
  }

  return prev === 0 ? str : out + str.slice(prev);
}
const IDENTIFIER_PATTERN = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
export const isValidIdentifier = (name: keyof any): boolean => {
  return typeof name === "symbol" ? true : IDENTIFIER_PATTERN.test(`${name}`);
};

export declare namespace parseKey {
  type Options = Partial<{ parseAsJson: boolean }>;
}

export function parseKey<K extends keyof any>(key: K, options?: parseKey.Options): K | `${K & (string | number)}`;

export function parseKey(k: keyof any, options: parseKey.Options = {}, _str = globalThis.String(k)) {
  const parseAsJson = options.parseAsJson ?? parseKey.defaults.parseAsJson;

  if (typeof k === "symbol") {
    return _str;
  } else if (isQuoted(k)) {
    return escapeString(_str);
  } else if (parseAsJson) {
    return `"` + escapeString(_str) + `"`;
  } else if (isValidIdentifier(k)) {
    return escapeString(_str);
  } else {
    return `"` + escapeString(_str) + `"`;
  }
}

parseKey.defaults = {
  parseAsJson: false,
} satisfies Required<parseKey.Options>;

export function stringify_key(key: string): string {
  return isQuoted(key) ? (key.startsWith('"') && key.endsWith('"') ? key : `"${key}"`) : `"${key}"`;
}

export function stringify_literal(v: string | number | bigint | boolean | null | undefined): string {
  return typeof v === "string" ? stringify_key(v) : typeof v === "bigint" ? `${v}n` : `${v}`;
}

export function key_access(key: keyof any | undefined, isOptional: boolean): string {
  return typeof key !== "string"
    ? ""
    : isValidIdentifier(key)
      ? `${isOptional ? "?." : isQuoted(key) ? "" : "."}${isQuoted(key) ? `[${key.startsWith('"') && key.endsWith('"') ? key : `"${key}"`}]` : key}`
      : `${isOptional ? "?." : ""}[${parseKey(key)}]`;
}

export function index_accessor(index: keyof any | undefined, isOptional: boolean): string {
  const safe = isOptional ? "?." : "";
  return typeof index !== "number" ? "" : `${safe}[${index}]`;
}

export function join_path(path: (string | number)[], isOptional: boolean): string {
  return path.reduce<string>((xs, k, i) => {
    return i === 0
      ? `${k}`
      : typeof k === "number"
        ? `${xs}${index_accessor(k, isOptional)}`
        : `${xs}${key_access(k, isOptional)}`;
  }, "");
}

export function createIdentifier(x: string): string {
  const out = x.replace(/[^$_a-zA-Z]/, "_").replace(/[^$_a-zA-Z0-9]/g, "_");
  return out.length === 0 ? "_" : out;
}

export function ident(x: string, bindings: Map<string, string>, dontBind?: "dontBind"): string {
  const original = x;
  x = createIdentifier(x);
  let count = 1;
  while (bindings.has(x)) x = `${x.replace(/\d+$/, "")}${count++}`;
  if (dontBind === undefined) {
    bindings.set(original, x);
    bindings.set(x, original);
  }
  return x;
}
