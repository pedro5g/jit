var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// lib/lab/compiler/virtual-fs.ts
var files = /* @__PURE__ */ new Map();
function resetVirtualFiles() {
  files.clear();
}
function readVirtualFile(path) {
  const value = files.get(normalize(path));
  if (value === void 0) throw new Error(`virtual file not found: ${path}`);
  return value;
}
function existsSync(path) {
  const normalized = normalize(path);
  return files.has(normalized) || [...files.keys()].some((file2) => file2.startsWith(`${normalized}/`));
}
function mkdirSync(_path, _options) {
  return void 0;
}
function readFileSync(path, _encoding) {
  return readVirtualFile(path);
}
function writeFileSync(path, content) {
  files.set(normalize(path), content);
}
function rmSync(path, options) {
  const normalized = normalize(path);
  files.delete(normalized);
  if (options?.recursive) {
    for (const file2 of files.keys()) {
      if (file2.startsWith(`${normalized}/`)) files.delete(file2);
    }
  }
}
function normalize(path) {
  const absolute = path.startsWith("/");
  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}` || (absolute ? "/" : ".");
}

// lib/lab/compiler/virtual-path.ts
function basename(path) {
  const normalized = normalize2(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
function join(...parts) {
  return normalize2(parts.filter(Boolean).join("/"));
}
function resolve(...parts) {
  const joined = parts.filter(Boolean).join("/");
  return normalize2(joined.startsWith("/") ? joined : `/${joined}`);
}
function relative(from, to) {
  const left = resolve(from).split("/").filter(Boolean);
  const right = resolve(to).split("/").filter(Boolean);
  let shared = 0;
  while (shared < left.length && left[shared] === right[shared]) shared++;
  return [...left.slice(shared).map(() => ".."), ...right.slice(shared)].join("/") || ".";
}
function normalize2(path) {
  const absolute = path.startsWith("/");
  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}` || (absolute ? "/" : ".");
}

// ../../packages/jit/src/runtime/artifact-registry.ts
var REGISTRY = /* @__PURE__ */ new WeakMap();
function registerArtifact(value, artifact) {
  REGISTRY.set(value, artifact);
}
function getArtifact(value) {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return void 0;
  return REGISTRY.get(value);
}

// ../../packages/jit/src/runtime/cache/compile-cache.ts
var cacheStore = /* @__PURE__ */ new WeakMap();
function getCompileCached(schema, key, build, options) {
  if (options?.cache === false) return build();
  let entry = cacheStore.get(schema);
  if (!entry) {
    entry = /* @__PURE__ */ new Map();
    cacheStore.set(schema, entry);
  }
  if (entry.has(key)) return entry.get(key);
  const built = build();
  entry.set(key, built);
  return built;
}

// ../../packages/jit/src/core/ats/create-schema.ts
function createSchema(type, def, annotations) {
  return {
    type,
    _type: null,
    def,
    annotations
  };
}

// ../../packages/jit/src/shared/parse.ts
var parse_exports = {};
__export(parse_exports, {
  createIdentifier: () => createIdentifier,
  escapeString: () => escapeString,
  ident: () => ident,
  index_accessor: () => index_accessor,
  isQuoted: () => isQuoted,
  isValidIdentifier: () => isValidIdentifier,
  join_path: () => join_path,
  key_access: () => key_access,
  parseKey: () => parseKey,
  stringify_key: () => stringify_key,
  stringify_literal: () => stringify_literal
});
var isQuoted = (text) => {
  const str = `${text}`;
  const len = str.length;
  if (len < 2) return false;
  const quote = str.charCodeAt(0);
  if (quote !== 34 && quote !== 39 && quote !== 96) {
    return false;
  }
  if (str.charCodeAt(len - 1) !== quote) {
    return false;
  }
  for (let i = 1; i < len - 1; i++) {
    if (str.charCodeAt(i) === quote) {
      return false;
    }
  }
  return true;
};
var ESC = new Array(97).fill("");
ESC[8] = "\\b";
ESC[9] = "\\t";
ESC[10] = "\\n";
ESC[12] = "\\f";
ESC[13] = "\\r";
ESC[34] = '\\"';
ESC[92] = "\\\\";
ESC[96] = "\\`";
function escapeString(str) {
  let prev = 0;
  let out = "";
  for (let i = 0, len = str.length; i < len; i++) {
    const ch = str.charCodeAt(i);
    if (ch < 32 || ch === 34 || ch === 92 || ch === 96) {
      out += str.slice(prev, i) + ESC[ch];
      prev = i + 1;
      continue;
    }
    if (ch >= 55296 && ch <= 57343) {
      if (ch <= 56319 && i + 1 < len) {
        const next = str.charCodeAt(i + 1);
        if (next >= 56320 && next <= 57343) {
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
var IDENTIFIER_PATTERN = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
var isValidIdentifier = (name) => {
  return typeof name === "symbol" ? true : IDENTIFIER_PATTERN.test(`${name}`);
};
function parseKey(k, options = {}, _str = globalThis.String(k)) {
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
  parseAsJson: false
};
function stringify_key(key) {
  return isQuoted(key) ? key.startsWith('"') && key.endsWith('"') ? key : `"${key}"` : `"${key}"`;
}
function stringify_literal(v) {
  return typeof v === "string" ? stringify_key(v) : typeof v === "bigint" ? `${v}n` : `${v}`;
}
function key_access(key, isOptional2) {
  return typeof key !== "string" ? "" : isValidIdentifier(key) ? `${isOptional2 ? "?." : isQuoted(key) ? "" : "."}${isQuoted(key) ? `[${key.startsWith('"') && key.endsWith('"') ? key : `"${key}"`}]` : key}` : `${isOptional2 ? "?." : ""}[${parseKey(key)}]`;
}
function index_accessor(index, isOptional2) {
  const safe = isOptional2 ? "?." : "";
  return typeof index !== "number" ? "" : `${safe}[${index}]`;
}
function join_path(path, isOptional2) {
  return path.reduce((xs, k, i) => {
    return i === 0 ? `${k}` : typeof k === "number" ? `${xs}${index_accessor(k, isOptional2)}` : `${xs}${key_access(k, isOptional2)}`;
  }, "");
}
function createIdentifier(x) {
  const out = x.replace(/[^$_a-zA-Z]/, "_").replace(/[^$_a-zA-Z0-9]/g, "_");
  return out.length === 0 ? "_" : out;
}
function ident(x, bindings, dontBind) {
  const original = x;
  x = createIdentifier(x);
  let count = 1;
  while (bindings.has(x)) x = `${x.replace(/\d+$/, "")}${count++}`;
  if (dontBind === void 0) {
    bindings.set(original, x);
    bindings.set(x, original);
  }
  return x;
}

// ../../packages/jit/src/shared/regexes.ts
var regexes_exports = {};
__export(regexes_exports, {
  base64: () => base64,
  base64url: () => base64url,
  bigint: () => bigint,
  boolean: () => boolean,
  browserEmail: () => browserEmail,
  cidrv4: () => cidrv4,
  cidrv6: () => cidrv6,
  cuid: () => cuid,
  cuid2: () => cuid2,
  date: () => date,
  datetime: () => datetime,
  domain: () => domain,
  duration: () => duration,
  e164: () => e164,
  email: () => email,
  emoji: () => emoji,
  extendedDuration: () => extendedDuration,
  guid: () => guid,
  hash: () => hash,
  hex: () => hex,
  hostname: () => hostname,
  html5Email: () => html5Email,
  httpProtocol: () => httpProtocol,
  idnEmail: () => idnEmail,
  integer: () => integer,
  ipv4: () => ipv4,
  ipv6: () => ipv6,
  jwt: () => jwt,
  ksuid: () => ksuid,
  lowercase: () => lowercase,
  mac: () => mac,
  md5_hex: () => md5_hex,
  nanoid: () => nanoid,
  number: () => number,
  rfc5322Email: () => rfc5322Email,
  sha1_hex: () => sha1_hex,
  sha256_hex: () => sha256_hex,
  sha384_hex: () => sha384_hex,
  sha512_hex: () => sha512_hex,
  time: () => time,
  ulid: () => ulid,
  unicodeEmail: () => unicodeEmail,
  uppercase: () => uppercase,
  uuid: () => uuid,
  uuid4: () => uuid4,
  uuid6: () => uuid6,
  uuid7: () => uuid7,
  xid: () => xid
});
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var extendedDuration = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(
    `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`
  );
};
var uuid4 = /* @__PURE__ */ uuid(4);
var uuid6 = /* @__PURE__ */ uuid(6);
var uuid7 = /* @__PURE__ */ uuid(7);
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
var html5Email = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var browserEmail = html5Email;
var rfc5322Email = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
var unicodeEmail = /^[^\s@"]{1,64}@[^\s@]{1,255}$/u;
var idnEmail = unicodeEmail;
var EMOJI_SOURCE = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(EMOJI_SOURCE, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var mac = (delimiter) => {
  const escapedDelim = escapeRegex(delimiter ?? ":");
  return new RegExp(`^(?:[0-9A-F]{2}${escapedDelim}){5}[0-9A-F]{2}$|^(?:[0-9a-f]{2}${escapedDelim}){5}[0-9a-f]{2}$`);
};
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var hostname = /^(?=.{1,253}\.?$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-0-9a-zA-Z]{0,61}[0-9a-zA-Z])?)*\.?$/;
var domain = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
var httpProtocol = /^https?$/;
var jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var DATE_SOURCE = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${DATE_SOURCE}$`);
function timeSource(options) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  if (typeof options.precision !== "number") return `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  if (options.precision === -1) return hhmm;
  if (options.precision === 0) return `${hhmm}:[0-5]\\d`;
  return `${hhmm}:[0-5]\\d\\.\\d{${options.precision}}`;
}
function time(options = {}) {
  return new RegExp(`^${timeSource(options)}$`);
}
function datetime(options = {}) {
  const timePart = timeSource(options);
  const zones = ["Z"];
  if (options.local) zones.push("");
  if (options.offset) zones.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  return new RegExp(`^${DATE_SOURCE}T(?:${timePart}(?:${zones.join("|")}))$`);
}
var bigint = /^-?\d+n?$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
var hex = /^[0-9a-fA-F]*$/;
function fixedBase64(bodyLength, padding) {
  return new RegExp(`^[A-Za-z0-9+/]{${bodyLength}}${padding}$`);
}
function fixedBase64url(length) {
  return new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
}
var HASH_REGEXES = {
  md5: {
    hex: /^[0-9a-fA-F]{32}$/,
    base64: /* @__PURE__ */ fixedBase64(22, "=="),
    base64url: /* @__PURE__ */ fixedBase64url(22)
  },
  sha1: {
    hex: /^[0-9a-fA-F]{40}$/,
    base64: /* @__PURE__ */ fixedBase64(27, "="),
    base64url: /* @__PURE__ */ fixedBase64url(27)
  },
  sha256: {
    hex: /^[0-9a-fA-F]{64}$/,
    base64: /* @__PURE__ */ fixedBase64(43, "="),
    base64url: /* @__PURE__ */ fixedBase64url(43)
  },
  sha384: {
    hex: /^[0-9a-fA-F]{96}$/,
    base64: /* @__PURE__ */ fixedBase64(64, ""),
    base64url: /* @__PURE__ */ fixedBase64url(64)
  },
  sha512: {
    hex: /^[0-9a-fA-F]{128}$/,
    base64: /* @__PURE__ */ fixedBase64(86, "=="),
    base64url: /* @__PURE__ */ fixedBase64url(86)
  }
};
function hash(algorithm, encoding = "hex") {
  return HASH_REGEXES[algorithm][encoding];
}
var md5_hex = HASH_REGEXES.md5.hex;
var sha1_hex = HASH_REGEXES.sha1.hex;
var sha256_hex = HASH_REGEXES.sha256.hex;
var sha384_hex = HASH_REGEXES.sha384.hex;
var sha512_hex = HASH_REGEXES.sha512.hex;

// ../../packages/jit/src/shared/utils.ts
var utils_exports = {};
__export(utils_exports, {
  Is_Array: () => Is_Array,
  Object_hasOwn: () => Object_hasOwn,
  Object_is: () => Object_is,
  Object_keys: () => Object_keys
});
var Object_keys = globalThis.Object.keys;
var Object_hasOwn = (x, k) => !!x && (typeof x === "object" || typeof x === "function") && globalThis.Object.prototype.hasOwnProperty.call(x, k);
var Object_is = globalThis.Object.is;
var Is_Array = globalThis.Array.isArray;

// ../../packages/jit/src/core/ats/type-name.ts
var TypeName = {
  string: "string",
  number: "number",
  int: "int",
  nan: "nan",
  null: "null",
  nullable: "nullable",
  nullish: "nullish",
  boolean: "boolean",
  object: "object",
  optional: "optional",
  array: "array",
  set: "set",
  tuple: "tuple",
  union: "union",
  xor: "xor",
  not: "not",
  record: "record",
  map: "map",
  unknown: "unknown",
  file: "file",
  any: "any",
  void: "void",
  never: "never",
  enum: "enum",
  literal: "literal",
  bigint: "bigint",
  date: "date",
  symbol: "symbol",
  regex: "regex",
  undefined: "undefined",
  intersection: "intersection",
  default: "default",
  brand: "brand",
  lazy: "lazy",
  transform: "transform",
  pipe: "pipe",
  refine: "refine",
  coerce: "coerce",
  readonly: "readonly",
  promise: "promise",
  instanceof: "instanceof",
  discriminatedUnion: "discriminatedUnion",
  json: "json",
  custom: "custom",
  templateLiteral: "templateLiteral",
  function: "function",
  temporal: "temporal",
  codec: "codec",
  when: "when"
};
var TypeNames = utils_exports.Object_keys(TypeName);

// ../../packages/jit/src/errors/jit-error.ts
var JITError = class extends Error {
  /**
   * Creates a JIT error with a stable code and optional structured details.
   *
   * @param code - The stable machine-readable error code.
   * @param message - The human-readable error message.
   * @param options - Optional path and metadata details.
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = "JITError";
    this.code = code;
    this.path = options.path;
    this.meta = options.meta;
  }
};

// ../../packages/jit/src/errors/validation-error.ts
var JITValidationError = class extends JITError {
  constructor(issues) {
    const first = issues[0];
    super("VALIDATION_FAILED", first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "validation failed", {
      meta: issues
    });
    this.name = "JITValidationError";
    this.issues = issues;
  }
};

// ../../packages/jit/src/compiler/schema-nodes.ts
function buildSchemaNode(schema, buildNode) {
  switch (schema.type) {
    case TypeName.optional:
      return { kind: "guard", optional: true, nullable: false, inner: buildNode(innerType(schema)) };
    case TypeName.nullable:
      return { kind: "guard", optional: false, nullable: true, inner: buildNode(innerType(schema)) };
    case TypeName.nullish:
      return { kind: "guard", optional: true, nullable: true, inner: buildNode(innerType(schema)) };
    case TypeName.default:
    case TypeName.brand:
    case TypeName.transform:
    case TypeName.pipe:
    case TypeName.readonly:
    case TypeName.refine:
    case TypeName.coerce:
      return buildNode(innerType(schema));
    case TypeName.lazy:
      return buildNode(schema.def.getter());
    case TypeName.array:
      return { kind: "array", element: buildNode(schema.def.element) };
    case TypeName.set:
      return { kind: "set", element: buildNode(schema.def.element) };
    case TypeName.map:
      return {
        kind: "map",
        key: buildNode(schema.def.key),
        value: buildNode(schema.def.value)
      };
    case TypeName.record:
      return { kind: "record", value: buildNode(schema.def.value) };
    case TypeName.tuple:
      return { kind: "tuple", items: schema.def.items.map(buildNode) };
    case TypeName.object: {
      const props = schema.def.props;
      return {
        kind: "object",
        props: Object.keys(props).map((key) => ({ key, schema: props[key], value: buildNode(props[key]) }))
      };
    }
    default:
      return void 0;
  }
}
function isPrimitiveLikeSchema(schema) {
  switch (schema.type) {
    case TypeName.any:
    case TypeName.unknown:
    case TypeName.never:
    case TypeName.void:
    case TypeName.undefined:
    case TypeName.null:
    case TypeName.symbol:
    case TypeName.boolean:
    case TypeName.nan:
    case TypeName.int:
    case TypeName.bigint:
    case TypeName.number:
    case TypeName.string:
    case TypeName.literal:
    case TypeName.enum:
    case TypeName.file:
    case TypeName.regex:
    case TypeName.instanceof:
      return true;
    default:
      return false;
  }
}
function innerType(schema) {
  return schema.def.innerType;
}
function emitGuardTest(optional3, nullable3, source) {
  if (optional3 && nullable3) return `${source} != null`;
  if (optional3) return `${source} !== undefined`;
  return `${source} !== null`;
}

// ../../packages/jit/src/compiler/clone/build-clone-ir.ts
function buildCloneIR(schema) {
  return {
    kind: "program",
    param: "value",
    body: buildCloneNode(schema)
  };
}
function buildCloneNode(schema) {
  if (schema.type === TypeName.date) return { kind: "date" };
  if (schema.type === TypeName.union) return buildUnionNode(schema);
  if (schema.type === TypeName.intersection) return buildIntersectionNode(schema);
  if (schema.type === TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode(schema);
  const node = buildSchemaNode(schema, buildCloneNode);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };
  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler clone IR for type: ${schema.type}`);
}
function buildUnionNode(schema) {
  if (schema.def.options.every((option) => isPrimitiveLikeSchema(option))) {
    return { kind: "reuse" };
  }
  return {
    kind: "union",
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildCloneNode(option)
    }))
  };
}
function buildIntersectionNode(schema) {
  return {
    kind: "intersection",
    options: schema.def.options.map(buildCloneNode)
  };
}
function buildDiscriminatedUnionNode(schema) {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildCloneNode(option)
    }))
  };
}

// ../../packages/jit/src/compiler/ir/ir.ts
function irVar(name) {
  return { kind: "var", name };
}
function literal(value) {
  return { kind: "literal", value };
}
function not(expr) {
  return { kind: "not", expr };
}
function strictEqual(left, right) {
  return { kind: "binary", op: "strictEqual", left, right };
}
function notStrictEqual(left, right) {
  return { kind: "binary", op: "notStrictEqual", left, right };
}
function sameValue(left, right) {
  return { kind: "sameValue", left, right };
}
function sameNumber(left, right) {
  return { kind: "sameNumber", left, right };
}
function schemaGuard(schema, value) {
  return { kind: "schema_guard", schema, value };
}
function loadProp(base, key) {
  return { kind: "load_prop", base, key };
}
function loadIndex(base, index) {
  return { kind: "load_index", base, index };
}
function call(callee, args = []) {
  return { kind: "call", callee, args };
}
function binary(op, left, right) {
  return { kind: "binary", op, left, right };
}
function allOf(operands) {
  return { kind: "nary", op: "and", operands };
}
function objectLiteral(entries) {
  return { kind: "object_literal", entries };
}
function arrayLiteral(elements = []) {
  return { kind: "array_literal", elements };
}
function construct(ctor, args = []) {
  return { kind: "construct", ctor, args };
}
function letDecl(target, expr) {
  return expr === void 0 ? { kind: "let", target } : { kind: "let", target, expr };
}
function store(target, expr) {
  return { kind: "store", target, expr };
}
function exprStmt(expr) {
  return { kind: "expr_stmt", expr };
}
function forRange(index, length, body) {
  return { kind: "for_range", index, length, body };
}
function forOf(item, iterable, body) {
  return { kind: "for_of", item, iterable, body };
}
function append(target, cursor, value) {
  return { kind: "append", target, cursor, value };
}
function sortByKey(target, key, direction) {
  return { kind: "sort_by_key", target, key, direction };
}
function mapExprChildren(expr, mapExpr) {
  switch (expr.kind) {
    case "var":
    case "literal":
      return expr;
    case "not":
      return { ...expr, expr: mapExpr(expr.expr) };
    case "binary":
    case "sameValue":
    case "sameNumber":
      return { ...expr, left: mapExpr(expr.left), right: mapExpr(expr.right) };
    case "nary":
      return { ...expr, operands: expr.operands.map(mapExpr) };
    case "schema_guard":
      return { ...expr, value: mapExpr(expr.value) };
    case "load_prop":
      return { ...expr, base: mapExpr(expr.base) };
    case "load_index":
      return { ...expr, base: mapExpr(expr.base), index: mapExpr(expr.index) };
    case "call":
      return { ...expr, callee: mapExpr(expr.callee), args: expr.args.map(mapExpr) };
    case "object_literal":
      return { ...expr, entries: expr.entries.map((entry) => ({ ...entry, value: mapExpr(entry.value) })) };
    case "array_literal":
      return { ...expr, elements: expr.elements.map(mapExpr) };
    case "construct":
      return { ...expr, args: expr.args.map(mapExpr) };
  }
}
function mapNodeExprs(node, mapExpr) {
  switch (node.kind) {
    case "assign":
      return { ...node, expr: mapExpr(node.expr) };
    case "let":
      return node.expr === void 0 ? node : { ...node, expr: mapExpr(node.expr) };
    case "store":
      return { ...node, target: mapExpr(node.target), expr: mapExpr(node.expr) };
    case "expr_stmt":
      return { ...node, expr: mapExpr(node.expr) };
    case "hash_compare":
      return { ...node, leftHash: mapExpr(node.leftHash), rightHash: mapExpr(node.rightHash) };
    case "map_equal":
    case "binary_search_equal":
      return { ...node, left: mapExpr(node.left), right: mapExpr(node.right) };
    case "if":
      return { ...node, test: mapExpr(node.test) };
    case "for":
      return { ...node, from: mapExpr(node.from) };
    case "for_range":
      return { ...node, length: mapExpr(node.length) };
    case "for_of":
      return { ...node, iterable: mapExpr(node.iterable) };
    case "append":
      return { ...node, value: mapExpr(node.value) };
    case "return":
      return { ...node, value: mapExpr(node.value) };
    case "block":
    case "sort_by_key":
      return node;
  }
}
function mapNodeBodies(node, mapNodes) {
  switch (node.kind) {
    case "block":
      return { ...node, body: mapNodes(node.body) };
    case "if":
      return {
        ...node,
        then: mapNodes(node.then),
        ...node.otherwise ? { otherwise: mapNodes(node.otherwise) } : {}
      };
    case "for":
    case "for_range":
    case "for_of":
    case "map_equal":
    case "binary_search_equal":
      return { ...node, body: mapNodes(node.body) };
    default:
      return node;
  }
}

// ../../packages/jit/src/compiler/source/literal.ts
function emitLiteral(value) {
  switch (typeof value) {
    case "string":
      return parse_exports.parseKey(value, { parseAsJson: true });
    case "bigint":
      return `${value}n`;
    case "undefined":
      return "undefined";
    default:
      return String(value);
  }
}
function emitObjectKey(key) {
  return parse_exports.parseKey(key);
}

// ../../packages/jit/src/compiler/defaults.ts
var NO_DEFAULT = /* @__PURE__ */ Symbol("jit.no-static-default");
function emitStaticDefaultSource(schema) {
  const value = getStaticDefaultValue(schema);
  if (value === NO_DEFAULT) return void 0;
  return emitStaticDefaultValueSource(value, /* @__PURE__ */ new Set());
}
function staticDefaultIRExpr(schema) {
  const value = getStaticDefaultValue(schema);
  if (value === NO_DEFAULT) return void 0;
  return staticValueIRExpr(value, /* @__PURE__ */ new Set());
}
function emitDefaultedValue(schema, valueExpr) {
  const defaultSource = emitStaticDefaultSource(schema);
  return defaultSource === void 0 ? valueExpr : `(${valueExpr} === undefined ? ${defaultSource} : ${valueExpr})`;
}
function getStaticDefaultValue(schema) {
  let current = schema;
  while (true) {
    switch (current.type) {
      case TypeName.default: {
        const value = current.def.defaultValue;
        return typeof value === "function" ? NO_DEFAULT : value;
      }
      case TypeName.optional:
      case TypeName.nullish:
        return NO_DEFAULT;
      case TypeName.nullable:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType;
        continue;
      case TypeName.lazy:
        current = current.def.getter?.();
        continue;
      default:
        return NO_DEFAULT;
    }
  }
}
function emitStaticDefaultValueSource(value, seen) {
  if (value instanceof Date) return `new Date(${value.getTime()})`;
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
    case "undefined":
      return emitLiteral(value);
    case "object":
      return emitStaticObjectDefaultSource(value, seen);
    default:
      return void 0;
  }
}
function staticValueIRExpr(value, seen) {
  if (value instanceof Date) return construct("Date", [literal(value.getTime())]);
  if (value === null) return literal(null);
  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
    case "undefined":
      return literal(value);
    case "object":
      return staticObjectDefaultIRExpr(value, seen);
    default:
      return void 0;
  }
}
function emitStaticObjectDefaultSource(value, seen) {
  if (seen.has(value)) return void 0;
  seen.add(value);
  if (Array.isArray(value)) {
    const elements = value.map((element) => emitStaticDefaultValueSource(element, seen));
    seen.delete(value);
    return elements.every((element) => element !== void 0) ? `[${elements.join(", ")}]` : void 0;
  }
  if (!isPlainObject(value)) {
    seen.delete(value);
    return void 0;
  }
  const entries = [];
  for (const key of Object.keys(value)) {
    const emitted = emitStaticDefaultValueSource(value[key], seen);
    if (emitted === void 0) {
      seen.delete(value);
      return void 0;
    }
    entries.push(`${emitObjectKey(key)}: ${emitted}`);
  }
  seen.delete(value);
  return `{ ${entries.join(", ")} }`;
}
function staticObjectDefaultIRExpr(value, seen) {
  if (seen.has(value)) return void 0;
  seen.add(value);
  if (Array.isArray(value)) {
    const elements = value.map((element) => staticValueIRExpr(element, seen));
    seen.delete(value);
    return elements.every((element) => element !== void 0) ? arrayLiteral(elements) : void 0;
  }
  if (!isPlainObject(value)) {
    seen.delete(value);
    return void 0;
  }
  const entries = [];
  for (const key of Object.keys(value)) {
    const emitted = staticValueIRExpr(value[key], seen);
    if (emitted === void 0) {
      seen.delete(value);
      return void 0;
    }
    entries.push({ key, value: emitted });
  }
  seen.delete(value);
  return objectLiteral(entries);
}
function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// ../../packages/jit/src/compiler/emitter/code-writer.ts
var CodeWriter = class {
  #lines = [];
  #indent = 0;
  line(text = "") {
    this.#lines.push(`${"  ".repeat(this.#indent)}${text}`);
  }
  indent(fn) {
    this.#indent++;
    fn();
    this.#indent--;
  }
  toString() {
    return this.#lines.join("\n");
  }
};

// ../../packages/jit/src/compiler/emitter/emit-state.ts
function createEmitState() {
  const counts = /* @__PURE__ */ new Map();
  return {
    nextVar(prefix) {
      const next = counts.get(prefix) ?? 0;
      const name = next === 0 ? prefix : `${prefix}${next}`;
      counts.set(prefix, next + 1);
      return name;
    }
  };
}

// ../../packages/jit/src/compiler/source/access.ts
function emitPropertyAccess(base, key) {
  return `${base}${parse_exports.key_access(key, false)}`;
}
function emitIndexAccess(base, index) {
  return `${base}[${index}]`;
}

// ../../packages/jit/src/compiler/resolvers/resolve-wrappers.ts
function resolveWrappers(schema) {
  let current = schema;
  let optional3 = false;
  let nullable3 = false;
  while (true) {
    if (current.type === TypeName.optional) {
      optional3 = true;
      current = innerType2(current);
      continue;
    }
    if (current.type === TypeName.nullable) {
      nullable3 = true;
      current = innerType2(current);
      continue;
    }
    if (current.type === TypeName.nullish) {
      optional3 = true;
      nullable3 = true;
      current = innerType2(current);
      continue;
    }
    if (current.type === TypeName.default || current.type === TypeName.brand || current.type === TypeName.transform || current.type === TypeName.pipe || current.type === TypeName.readonly || current.type === TypeName.refine || current.type === TypeName.coerce) {
      current = innerType2(current);
      continue;
    }
    if (current.type === TypeName.lazy) {
      current = current.def.getter();
      continue;
    }
    break;
  }
  return {
    base: current,
    optional: optional3,
    nullable: nullable3
  };
}
function innerType2(schema) {
  return schema.def.innerType;
}

// ../../packages/jit/src/compiler/source/guard.ts
function emitSchemaGuard(schema, value) {
  const resolved = resolveWrappers(schema);
  const base = resolved.base;
  const inner = emitBaseGuard(base, value);
  const defaultable = emitStaticDefaultSource(schema) !== void 0;
  if (resolved.optional && resolved.nullable) return `(${value} == null || (${inner}))`;
  if (resolved.optional) return `(${value} === undefined || (${inner}))`;
  if (resolved.nullable) {
    return defaultable ? `(${value} === undefined || ${value} === null || (${inner}))` : `(${value} === null || (${inner}))`;
  }
  if (defaultable) return `(${value} === undefined || (${inner}))`;
  return inner;
}
function emitBaseGuard(schema, value) {
  switch (schema.type) {
    case TypeName.any:
    case TypeName.unknown:
      return "true";
    case TypeName.never:
      return "false";
    case TypeName.void:
    case TypeName.undefined:
      return `${value} === undefined`;
    case TypeName.null:
      return `${value} === null`;
    case TypeName.string:
      return `typeof ${value} === "string"`;
    case TypeName.number:
    case TypeName.int:
    case TypeName.nan:
      return `typeof ${value} === "number"`;
    case TypeName.boolean:
      return `typeof ${value} === "boolean"`;
    case TypeName.bigint:
      return `typeof ${value} === "bigint"`;
    case TypeName.symbol:
      return `typeof ${value} === "symbol"`;
    case TypeName.date:
      return `${value} instanceof Date`;
    case TypeName.regex:
      return `${value} instanceof RegExp`;
    case TypeName.file:
      return `(typeof File !== "undefined" && ${value} instanceof File)`;
    case TypeName.json:
      return "true";
    case TypeName.custom:
      return "true";
    case TypeName.templateLiteral:
      return `typeof ${value} === "string"`;
    case TypeName.function:
      return `typeof ${value} === "function"`;
    case TypeName.temporal:
      return emitTemporalGuard(schema, value);
    case TypeName.codec:
      return emitSchemaGuard(schema.def.input, value);
    case TypeName.literal:
      return emitLiteralGuard(schema, value);
    case TypeName.enum:
      return emitEnumGuard(schema, value);
    case TypeName.array:
      return `Array.isArray(${value})`;
    case TypeName.set:
      return `${value} instanceof Set`;
    case TypeName.map:
      return `${value} instanceof Map`;
    case TypeName.record:
      return `${value} !== null && typeof ${value} === "object" && !Array.isArray(${value})`;
    case TypeName.object:
      return emitObjectGuard(schema, value);
    case TypeName.tuple:
      return `Array.isArray(${value})`;
    case TypeName.union:
      return `(${schema.def.options.map((option) => emitSchemaGuard(option, value)).join(" || ")})`;
    case TypeName.xor:
      return emitXorGuard(schema, value);
    case TypeName.not:
      return `!(${emitSchemaGuard(schema.def.innerType, value)})`;
    case TypeName.when:
      return `((${emitSchemaGuard(schema.def.thenType, value)}) || (${emitSchemaGuard(schema.def.otherwiseType, value)}))`;
    case TypeName.discriminatedUnion:
      return emitDiscriminatedUnionGuard(schema, value);
    case TypeName.intersection:
      return `(${schema.def.options.map((option) => emitSchemaGuard(option, value)).join(" && ")})`;
    case TypeName.instanceof:
      return emitInstanceOfGuard(schema, value);
    default:
      return "true";
  }
}
function emitXorGuard(schema, value) {
  const tests = schema.def.options.map((option) => emitSchemaGuard(option, value));
  if (tests.length === 0) return "false";
  return `(${tests.map((test) => `((${test}) ? 1 : 0)`).join(" + ")} === 1)`;
}
function emitObjectGuard(schema, value) {
  const props = schema.def.props;
  const checks = Object.entries(props).map(([key, prop]) => emitSchemaGuard(prop, emitPropertyAccess(value, key)));
  const objectCheck = `${value} !== null && typeof ${value} === "object" && !Array.isArray(${value})`;
  return checks.length === 0 ? objectCheck : `(${objectCheck} && ${checks.join(" && ")})`;
}
function emitLiteralGuard(schema, value) {
  const literal3 = schema.def.value;
  if (typeof literal3 === "number") {
    return `${value} === ${emitLiteral(literal3)} || (${value} !== ${value} && ${emitLiteral(literal3)} !== ${emitLiteral(literal3)})`;
  }
  return `${value} === ${emitLiteral(literal3)}`;
}
function emitEnumGuard(schema, value) {
  const values = Object.values(schema.def.values);
  if (values.length === 0) return "false";
  return `(${values.map((enumValue) => `${value} === ${emitLiteral(enumValue)}`).join(" || ")})`;
}
function emitDiscriminatedUnionGuard(schema, value) {
  const discriminator = schema.def.discriminator;
  const tags = schema.def.options.map((option) => {
    const tag = literalDiscriminatorValue(option, discriminator);
    return tag === void 0 ? void 0 : `${emitPropertyAccess(value, discriminator)} === ${emitLiteral(tag)}`;
  });
  const filtered = tags.filter((tag) => tag !== void 0);
  return filtered.length === 0 ? "false" : `(${filtered.join(" || ")})`;
}
function emitInstanceOfGuard(schema, value) {
  const name = schema.def.ctor.name;
  if (!name) return `${value} !== null && typeof ${value} === "object"`;
  return `(typeof ${name} !== "undefined" && ${value} instanceof ${name})`;
}
function emitTemporalGuard(schema, value) {
  const ctor = temporalConstructorName(schema.def.kind);
  return `(globalThis.Temporal !== undefined && ${value} instanceof globalThis.Temporal.${ctor})`;
}
function temporalConstructorName(kind) {
  switch (kind) {
    case "instant":
      return "Instant";
    case "plainDate":
      return "PlainDate";
    case "plainTime":
      return "PlainTime";
    case "plainDateTime":
      return "PlainDateTime";
    case "zonedDateTime":
      return "ZonedDateTime";
    case "plainYearMonth":
      return "PlainYearMonth";
    case "plainMonthDay":
      return "PlainMonthDay";
    case "duration":
      return "Duration";
  }
}
function literalDiscriminatorValue(schema, discriminator) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.object) return void 0;
  const props = resolved.def.props;
  const prop = props[discriminator];
  const propBase = prop ? resolveWrappers(prop).base : void 0;
  if (propBase?.type !== TypeName.literal) return void 0;
  const value = propBase.def.value;
  return typeof value === "string" || typeof value === "number" ? value : void 0;
}

// ../../packages/jit/src/compiler/clone/emit-clone.ts
function emitClone(program) {
  const writer = new CodeWriter();
  const inline = emitInlineClone(program.body, program.param);
  writer.line(`function clone(${program.param}) {`);
  writer.indent(() => {
    if (inline) {
      writer.line(`return ${inline};`);
    } else {
      emitCloneTo(writer, createEmitState(), program.body, program.param, "out");
      writer.line("return out;");
    }
  });
  writer.line("}");
  return writer.toString();
}
function emitCloneBody(program) {
  const writer = new CodeWriter();
  const inline = emitInlineClone(program.body, program.param);
  if (inline) {
    writer.line(`return ${inline};`);
  } else {
    emitCloneTo(writer, createEmitState(), program.body, program.param, "out");
    writer.line("return out;");
  }
  return writer.toString();
}
function emitCloneTo(writer, state, node, source, target) {
  const inline = emitInlineClone(node, source);
  if (inline) {
    writer.line(`const ${target} = ${inline};`);
    return;
  }
  switch (node.kind) {
    case "array":
      emitArrayClone(writer, state, node, source, target);
      return;
    case "tuple":
      emitTupleClone(writer, state, node, source, target);
      return;
    case "record":
      emitRecordClone(writer, state, node, source, target);
      return;
    case "set":
      emitSetClone(writer, state, node, source, target);
      return;
    case "map":
      emitMapClone(writer, state, node, source, target);
      return;
    case "guard":
      emitGuardClone(writer, state, node, source, target);
      return;
    case "union":
      emitUnionClone(writer, state, node, source, target);
      return;
    case "intersection":
      emitIntersectionClone(writer, state, node, source, target);
      return;
    case "discriminatedUnion":
      emitDiscriminatedUnionClone(writer, state, node, source, target);
      return;
    case "object":
      emitObjectClone(writer, state, node, source, target);
      return;
    case "date":
    case "reuse":
      return;
  }
}
function emitInlineClone(node, source) {
  switch (node.kind) {
    case "reuse":
      return source;
    case "date":
      return `new Date(${source}.getTime())`;
    case "object":
      return emitInlineObjectClone(node, source);
    case "tuple":
      return emitInlineTupleClone(node, source);
    case "array":
    case "record":
    case "set":
    case "map":
    case "guard":
    case "union":
    case "intersection":
    case "discriminatedUnion":
      return void 0;
  }
}
function emitInlineObjectClone(node, source) {
  const props = [];
  for (const prop of node.props) {
    const propSource = emitDefaultedValue(prop.schema, emitPropertyAccess(source, prop.key));
    const cloned = emitInlineClone(prop.value, propSource);
    if (!cloned) {
      return void 0;
    }
    props.push(`${emitObjectKey(prop.key)}: ${cloned}`);
  }
  return `{ ${props.join(", ")} }`;
}
function emitInlineTupleClone(node, source) {
  const items = [];
  for (let index = 0; index < node.items.length; index++) {
    const cloned = emitInlineClone(node.items[index], `${source}[${index}]`);
    if (!cloned) {
      return void 0;
    }
    items.push(cloned);
  }
  return `[${items.join(", ")}]`;
}
function emitObjectClone(writer, state, node, source, target) {
  const entries = [];
  for (const prop of node.props) {
    const propSource = emitDefaultedValue(prop.schema, emitPropertyAccess(source, prop.key));
    const inline = emitInlineClone(prop.value, propSource);
    if (inline) {
      entries.push(`${emitObjectKey(prop.key)}: ${inline}`);
      continue;
    }
    const propTarget = state.nextVar(`${target}_${prop.key}`);
    emitCloneTo(writer, state, prop.value, propSource, propTarget);
    entries.push(`${emitLiteral(prop.key)}: ${propTarget}`);
  }
  writer.line(`const ${target} = { ${entries.join(", ")} };`);
}
function emitTupleClone(writer, state, node, source, target) {
  const entries = [];
  for (let index = 0; index < node.items.length; index++) {
    const itemSource = `${source}[${index}]`;
    const inline = emitInlineClone(node.items[index], itemSource);
    if (inline) {
      entries.push(inline);
      continue;
    }
    const itemTarget = state.nextVar(`${target}_${index}`);
    emitCloneTo(writer, state, node.items[index], itemSource, itemTarget);
    entries.push(itemTarget);
  }
  writer.line(`const ${target} = [${entries.join(", ")}];`);
}
function emitArrayClone(writer, state, node, source, target) {
  const len = state.nextVar("len");
  const index = state.nextVar("i");
  const item = state.nextVar("item");
  writer.line(`const ${len} = ${source}.length;`);
  writer.line(`const ${target} = new Array(${len});`);
  writer.line(`for (let ${index} = 0; ${index} < ${len}; ${index}++) {`);
  writer.indent(() => {
    const itemSource = `${source}[${index}]`;
    const inline = emitInlineClone(node.element, itemSource);
    if (inline) {
      writer.line(`${target}[${index}] = ${inline};`);
      return;
    }
    emitCloneTo(writer, state, node.element, itemSource, item);
    writer.line(`${target}[${index}] = ${item};`);
  });
  writer.line("}");
}
function emitRecordClone(writer, state, node, source, target) {
  const keys = state.nextVar("keys");
  const len = state.nextVar("len");
  const index = state.nextVar("i");
  const key = state.nextVar("key");
  const clonedValue = state.nextVar("clonedValue");
  writer.line(`const ${keys} = Object.keys(${source});`);
  writer.line(`const ${target} = {};`);
  writer.line(`for (let ${index} = 0, ${len} = ${keys}.length; ${index} < ${len}; ${index}++) {`);
  writer.indent(() => {
    writer.line(`const ${key} = ${keys}[${index}];`);
    emitCloneTo(writer, state, node.value, `${source}[${key}]`, clonedValue);
    writer.line(`${target}[${key}] = ${clonedValue};`);
  });
  writer.line("}");
}
function emitSetClone(writer, state, node, source, target) {
  const item = state.nextVar("item");
  const clonedValue = state.nextVar("clonedValue");
  writer.line(`const ${target} = new Set();`);
  writer.line(`for (const ${item} of ${source}) {`);
  writer.indent(() => {
    emitCloneTo(writer, state, node.element, item, clonedValue);
    writer.line(`${target}.add(${clonedValue});`);
  });
  writer.line("}");
}
function emitMapClone(writer, state, node, source, target) {
  const entry = state.nextVar("entry");
  const key = state.nextVar("key");
  const mapValue = state.nextVar("mapValue");
  const nextKey = state.nextVar("nextKey");
  const nextValue = state.nextVar("nextValue");
  writer.line(`const ${target} = new Map();`);
  writer.line(`for (const ${entry} of ${source}) {`);
  writer.indent(() => {
    writer.line(`const ${key} = ${entry}[0];`);
    writer.line(`const ${mapValue} = ${entry}[1];`);
    emitCloneTo(writer, state, node.key, key, nextKey);
    emitCloneTo(writer, state, node.value, mapValue, nextValue);
    writer.line(`${target}.set(${nextKey}, ${nextValue});`);
  });
  writer.line("}");
}
function emitGuardClone(writer, state, node, source, target) {
  writer.line(`let ${target} = ${source};`);
  writer.line(`if (${emitGuardTest(node.optional, node.nullable, source)}) {`);
  writer.indent(() => {
    const inner = state.nextVar(`${target}_inner`);
    emitCloneTo(writer, state, node.inner, source, inner);
    writer.line(`${target} = ${inner};`);
  });
  writer.line("}");
}
function emitUnionClone(writer, state, node, source, target) {
  writer.line(`let ${target};`);
  for (let index = 0; index < node.options.length; index++) {
    const option = node.options[index];
    const keyword = index === 0 ? "if" : "else if";
    writer.line(`${keyword} (${emitSchemaGuard(option.schema, source)}) {`);
    writer.indent(() => {
      const optionTarget = state.nextVar(`${target}_${index}`);
      emitCloneTo(writer, state, option.node, source, optionTarget);
      writer.line(`${target} = ${optionTarget};`);
    });
    writer.line("}");
  }
}
function emitIntersectionClone(writer, state, node, source, target) {
  const parts = [];
  for (let index = 0; index < node.options.length; index++) {
    const optionTarget = state.nextVar(`${target}_${index}`);
    emitCloneTo(writer, state, node.options[index], source, optionTarget);
    parts.push(optionTarget);
  }
  writer.line(`const ${target} = Object.assign({}, ${parts.join(", ")});`);
}
function emitDiscriminatedUnionClone(writer, state, node, source, target) {
  const tag = emitPropertyAccess(source, node.discriminator);
  writer.line(`let ${target};`);
  for (let index = 0; index < node.options.length; index++) {
    const option = node.options[index];
    const value = literalDiscriminatorValue(option.schema, node.discriminator);
    if (value === void 0) continue;
    const keyword = index === 0 ? "if" : "else if";
    writer.line(`${keyword} (${tag} === ${emitLiteral(value)}) {`);
    writer.indent(() => {
      const optionTarget = state.nextVar(`${target}_${index}`);
      emitCloneTo(writer, state, option.node, source, optionTarget);
      writer.line(`${target} = ${optionTarget};`);
    });
    writer.line("}");
  }
}

// ../../packages/jit/src/compiler/clone.ts
function emitCloneSource(schema) {
  return emitClone(buildCloneIR(schema));
}
function compileClone(schema, options) {
  return getCompileCached(
    schema,
    "clone",
    () => {
      const program = buildCloneIR(schema);
      const body = emitCloneBody(program);
      const compiled = globalThis.Function(`return function clone(value) {
${body}
};`)();
      registerArtifact(compiled, {
        kind: "operation",
        schema,
        op: "clone"
      });
      return compiled;
    },
    options
  );
}

// ../../packages/jit/src/compiler/codec/emit-codec.ts
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder();
function emitCodec(schema, options = {}) {
  const version = options.version ?? 1;
  if (!Number.isInteger(version) || version < 0 || version > 255) {
    throw new JITError("INVALID_OPERATION", `codec version must be an integer in [0, 255], got ${version}`);
  }
  const writer = new CodeWriter();
  const context = {
    writer,
    bindingNames: [],
    bindingValues: [],
    enumBindings: /* @__PURE__ */ new Map(),
    varCounter: 0
  };
  const usesStrings = hasStringLeaf(schema, /* @__PURE__ */ new Set());
  if (usesStrings) {
    bindValue(context, "__enc", textEncoder);
    bindValue(context, "__dec", textDecoder);
  }
  writer.line("function _write(value, u8, dv, o) {");
  writer.indent(() => {
    emitWrite(context, schema, "value");
    writer.line("return o;");
  });
  writer.line("}");
  writer.line("function encode(value) {");
  writer.indent(() => {
    writer.line("let size = 1;");
    emitSize(context, schema, "value");
    writer.line("const buf = new ArrayBuffer(size);");
    writer.line("const dv = new DataView(buf);");
    writer.line("const u8 = new Uint8Array(buf);");
    writer.line(`u8[0] = ${version};`);
    writer.line("return u8.subarray(0, _write(value, u8, dv, 1));");
  });
  writer.line("}");
  writer.line("function encodeInto(value, target) {");
  writer.indent(() => {
    writer.line("if (!(target instanceof Uint8Array)) {");
    writer.indent(() => {
      writer.line('throw new TypeError("jit codec: encodeInto target must be a Uint8Array");');
    });
    writer.line("}");
    writer.line('if (target.length < 1) throw new RangeError("jit codec: target buffer too small");');
    writer.line("const dv = new DataView(target.buffer, target.byteOffset, target.byteLength);");
    writer.line(`target[0] = ${version};`);
    writer.line("return _write(value, target, dv, 1);");
  });
  writer.line("}");
  writer.line("function decode(input) {");
  writer.indent(() => {
    writer.line("const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);");
    writer.line("const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);");
    writer.line(`if (u8.length < 1 || u8[0] !== ${version}) {`);
    writer.indent(() => {
      writer.line(
        `throw new RangeError("jit codec: schema version mismatch: expected ${version}, got " + (u8.length < 1 ? "empty buffer" : u8[0]));`
      );
    });
    writer.line("}");
    writer.line("let o = 1;");
    const result = emitRead(context, schema);
    writer.line(`return ${result};`);
  });
  writer.line("}");
  writer.line("return { encode: encode, encodeInto: encodeInto, decode: decode };");
  return {
    source: writer.toString(),
    bindingNames: context.bindingNames,
    bindingValues: context.bindingValues
  };
}
function nextVar(context, prefix) {
  return `${prefix}${++context.varCounter}`;
}
function bindValue(context, name, value) {
  if (!context.bindingNames.includes(name)) {
    context.bindingNames.push(name);
    context.bindingValues.push(value);
  }
  return name;
}
function enumBinding(context, schema) {
  let name = context.enumBindings.get(schema);
  if (!name) {
    name = `__c${context.bindingNames.length}`;
    context.bindingNames.push(name);
    context.bindingValues.push(Object.values(schema.def.values));
    context.enumBindings.set(schema, name);
  }
  return name;
}
function resolveCodecWrappers(schema) {
  let current = schema;
  let guarded = false;
  while (true) {
    switch (current.type) {
      case TypeName.optional:
      case TypeName.nullable:
      case TypeName.nullish:
        guarded = true;
        current = current.def.innerType;
        continue;
      case TypeName.default:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType;
        continue;
      case TypeName.lazy:
        current = current.def.getter();
        continue;
      default:
        return { base: current, guarded };
    }
  }
}
function hasStringLeaf(schema, seen) {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const base = resolveCodecWrappers(schema).base;
  switch (base.type) {
    case TypeName.string:
    case TypeName.record:
      return true;
    case TypeName.object: {
      const props = base.def.props;
      return Object.keys(props).some((key) => hasStringLeaf(props[key], seen));
    }
    case TypeName.array:
    case TypeName.set:
      return hasStringLeaf(base.def.element, seen);
    case TypeName.map:
      return hasStringLeaf(base.def.key, seen) || hasStringLeaf(base.def.value, seen);
    case TypeName.tuple: {
      const items = base.def.items ?? [];
      const rest = base.def.rest;
      return items.some((item) => hasStringLeaf(item, seen)) || rest !== void 0 && hasStringLeaf(rest, seen);
    }
    case TypeName.union:
    case TypeName.discriminatedUnion:
    case TypeName.intersection: {
      const opts = base.def.options;
      return opts.some((option) => hasStringLeaf(option, seen));
    }
    default:
      return false;
  }
}
function objectLayout(schema) {
  const props = schema.def.props;
  const guarded = [];
  for (const key of Object.keys(props)) {
    if (resolveCodecWrappers(props[key]).guarded) {
      guarded.push({ key, bit: guarded.length });
    }
  }
  return { guarded, maskBytes: Math.ceil(guarded.length / 4) };
}
function unsupported(kind) {
  throw new JITError(
    "UNSUPPORTED_SCHEMA",
    `binary codec does not support ${kind} schemas \u2014 a binary layout requires rigid, explicitly-typed structures`
  );
}
function taggedOptions(schema) {
  const discriminator = schema.def.discriminator;
  const options = schema.def.options;
  const tagged = options.map((option) => {
    const base = resolveCodecWrappers(option).base;
    if (base.type !== TypeName.object) unsupported("discriminated union with non-object option");
    const prop = base.def.props[discriminator];
    const propBase = prop ? resolveCodecWrappers(prop).base : void 0;
    if (propBase?.type !== TypeName.literal) unsupported("discriminated union without literal tag");
    const value = propBase.def.value;
    if (typeof value !== "string" && typeof value !== "number") unsupported("discriminated union with non-scalar tag");
    return { option: resolveCodecWrappers(option).base, tag: value };
  });
  if (tagged.length > 255) unsupported("union with more than 255 options");
  return tagged;
}
function emitSize(context, schema, valueExpr) {
  const resolved = resolveCodecWrappers(schema);
  const writer = context.writer;
  if (resolved.guarded) {
    writer.line("size += 1;");
    writer.line(`if (${valueExpr} != null) {`);
    writer.indent(() => {
      emitBaseSize(context, resolved.base, valueExpr);
    });
    writer.line("}");
    return;
  }
  emitBaseSize(context, resolved.base, valueExpr);
}
function emitBaseSize(context, schema, valueExpr) {
  const writer = context.writer;
  switch (schema.type) {
    case TypeName.number:
    case TypeName.nan:
    case TypeName.date:
    case TypeName.bigint:
      writer.line("size += 8;");
      return;
    case TypeName.int:
      writer.line("size += 4;");
      return;
    case TypeName.boolean:
    case TypeName.enum:
      writer.line("size += 1;");
      return;
    case TypeName.literal:
    case TypeName.null:
    case TypeName.undefined:
      return;
    case TypeName.string:
      writer.line(`size += 4 + ${valueExpr}.length * 3;`);
      return;
    case TypeName.object: {
      const props = schema.def.props;
      const layout = objectLayout(schema);
      const holder = hoist(context, valueExpr);
      if (layout.maskBytes > 0) writer.line(`size += ${layout.maskBytes};`);
      for (const key of Object.keys(props)) {
        const prop = props[key];
        const resolved = resolveCodecWrappers(prop);
        const propExpr = emitPropertyAccess(holder, key);
        if (resolved.guarded) {
          writer.line(`if (${propExpr} != null) {`);
          writer.indent(() => {
            emitBaseSize(context, resolved.base, propExpr);
          });
          writer.line("}");
        } else {
          emitBaseSize(context, resolved.base, propExpr);
        }
      }
      return;
    }
    case TypeName.array: {
      const element = schema.def.element;
      const holder = hoist(context, valueExpr);
      const index = nextVar(context, "i");
      const item = nextVar(context, "e");
      writer.line("size += 4;");
      writer.line(`for (let ${index} = 0; ${index} < ${holder}.length; ${index}++) {`);
      writer.indent(() => {
        writer.line(`const ${item} = ${holder}[${index}];`);
        emitSize(context, element, item);
      });
      writer.line("}");
      return;
    }
    case TypeName.tuple: {
      const items = schema.def.items ?? [];
      const rest = schema.def.rest;
      const holder = hoist(context, valueExpr);
      items.forEach((item, position) => {
        emitSize(context, item, `${holder}[${position}]`);
      });
      if (rest) {
        const index = nextVar(context, "i");
        writer.line("size += 4;");
        writer.line(`for (let ${index} = ${items.length}; ${index} < ${holder}.length; ${index}++) {`);
        writer.indent(() => {
          emitSize(context, rest, `${holder}[${index}]`);
        });
        writer.line("}");
      }
      return;
    }
    case TypeName.set: {
      const element = schema.def.element;
      const holder = hoist(context, valueExpr);
      const item = nextVar(context, "e");
      writer.line("size += 4;");
      writer.line(`for (const ${item} of ${holder}) {`);
      writer.indent(() => {
        emitSize(context, element, item);
      });
      writer.line("}");
      return;
    }
    case TypeName.map: {
      const keySchema = schema.def.key;
      const valueSchema = schema.def.value;
      const holder = hoist(context, valueExpr);
      const entry = nextVar(context, "e");
      writer.line("size += 4;");
      writer.line(`for (const ${entry} of ${holder}) {`);
      writer.indent(() => {
        emitSize(context, keySchema, `${entry}[0]`);
        emitSize(context, valueSchema, `${entry}[1]`);
      });
      writer.line("}");
      return;
    }
    case TypeName.record: {
      const valueSchema = schema.def.value;
      const holder = hoist(context, valueExpr);
      const keys = nextVar(context, "k");
      const index = nextVar(context, "i");
      writer.line(`const ${keys} = Object.keys(${holder});`);
      writer.line("size += 4;");
      writer.line(`for (let ${index} = 0; ${index} < ${keys}.length; ${index}++) {`);
      writer.indent(() => {
        writer.line(`size += 4 + ${keys}[${index}].length * 3;`);
        emitSize(context, valueSchema, `${holder}[${keys}[${index}]]`);
      });
      writer.line("}");
      return;
    }
    case TypeName.union: {
      const options = schema.def.options;
      const holder = hoist(context, valueExpr);
      if (options.length === 0 || options.length > 255) unsupported("union with 0 or more than 255 options");
      writer.line("size += 1;");
      options.forEach((option, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${emitSchemaGuard(option, holder)}) {`);
        writer.indent(() => {
          emitSize(context, option, holder);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line('throw new RangeError("jit codec: value matched no union option");');
      });
      writer.line("}");
      return;
    }
    case TypeName.discriminatedUnion: {
      const discriminator = schema.def.discriminator;
      const tagged = taggedOptions(schema);
      const holder = hoist(context, valueExpr);
      const tag = nextVar(context, "t");
      writer.line(`const ${tag} = ${emitPropertyAccess(holder, discriminator)};`);
      writer.line("size += 1;");
      tagged.forEach((entry, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${emitLiteral(entry.tag)}) {`);
        writer.indent(() => {
          emitBaseSize(context, entry.option, holder);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line(`throw new RangeError("jit codec: unknown discriminator value: " + ${tag});`);
      });
      writer.line("}");
      return;
    }
    case TypeName.intersection: {
      const options = schema.def.options;
      const holder = hoist(context, valueExpr);
      for (const option of options) {
        const base = resolveCodecWrappers(option).base;
        if (base.type !== TypeName.object) unsupported("intersection of non-object");
        emitBaseSize(context, base, holder);
      }
      return;
    }
    default:
      unsupported(schema.type);
  }
}
function emitWrite(context, schema, valueExpr) {
  const resolved = resolveCodecWrappers(schema);
  const writer = context.writer;
  if (resolved.guarded) {
    writer.line(`if (${valueExpr} === undefined) {`);
    writer.indent(() => {
      writer.line("dv.setUint8(o, 0); o += 1;");
    });
    writer.line(`} else if (${valueExpr} === null) {`);
    writer.indent(() => {
      writer.line("dv.setUint8(o, 1); o += 1;");
    });
    writer.line("} else {");
    writer.indent(() => {
      writer.line("dv.setUint8(o, 2); o += 1;");
      emitBaseWrite(context, resolved.base, valueExpr);
    });
    writer.line("}");
    return;
  }
  emitBaseWrite(context, resolved.base, valueExpr);
}
function emitStringWrite(context, valueExpr) {
  const writer = context.writer;
  const result = nextVar(context, "w");
  writer.line(`const ${result} = __enc.encodeInto(${valueExpr}, u8.subarray(o + 4));`);
  writer.line(`if (${result}.read !== ${valueExpr}.length) {`);
  writer.indent(() => {
    writer.line('throw new RangeError("jit codec: target buffer too small");');
  });
  writer.line("}");
  writer.line(`dv.setUint32(o, ${result}.written, true); o += 4 + ${result}.written;`);
}
function emitBaseWrite(context, schema, valueExpr) {
  const writer = context.writer;
  switch (schema.type) {
    case TypeName.number:
    case TypeName.nan:
      writer.line(`dv.setFloat64(o, ${valueExpr}, true); o += 8;`);
      return;
    case TypeName.int:
      writer.line(`if (${valueExpr} !== (${valueExpr} | 0)) {`);
      writer.indent(() => {
        writer.line(`throw new RangeError("jit codec: int32 overflow: " + ${valueExpr});`);
      });
      writer.line("}");
      writer.line(`dv.setInt32(o, ${valueExpr}, true); o += 4;`);
      return;
    case TypeName.bigint:
      writer.line(`dv.setBigInt64(o, ${valueExpr}, true); o += 8;`);
      return;
    case TypeName.date:
      writer.line(`dv.setFloat64(o, ${valueExpr}.getTime(), true); o += 8;`);
      return;
    case TypeName.boolean:
      writer.line(`dv.setUint8(o, ${valueExpr} ? 1 : 0); o += 1;`);
      return;
    case TypeName.enum:
      writer.line(`dv.setUint8(o, ${enumBinding(context, schema)}.indexOf(${valueExpr})); o += 1;`);
      return;
    case TypeName.literal:
    case TypeName.null:
    case TypeName.undefined:
      return;
    case TypeName.string:
      emitStringWrite(context, valueExpr);
      return;
    case TypeName.object: {
      const props = schema.def.props;
      const layout = objectLayout(schema);
      const holder = hoist(context, valueExpr);
      const maskVars = [];
      for (let byte = 0; byte < layout.maskBytes; byte++) {
        const mask2 = nextVar(context, "m");
        maskVars.push(mask2);
        writer.line(`let ${mask2} = 0;`);
      }
      for (const guarded of layout.guarded) {
        const propExpr = emitPropertyAccess(holder, guarded.key);
        const mask2 = maskVars[guarded.bit >> 2];
        const shift = (guarded.bit & 3) * 2;
        writer.line(
          `if (${propExpr} === null) ${mask2} |= ${1 << shift}; else if (${propExpr} !== undefined) ${mask2} |= ${2 << shift};`
        );
      }
      for (const mask2 of maskVars) {
        writer.line(`dv.setUint8(o, ${mask2}); o += 1;`);
      }
      for (const key of Object.keys(props)) {
        const resolved = resolveCodecWrappers(props[key]);
        const propExpr = emitPropertyAccess(holder, key);
        if (resolved.guarded) {
          writer.line(`if (${propExpr} != null) {`);
          writer.indent(() => {
            emitBaseWrite(context, resolved.base, propExpr);
          });
          writer.line("}");
        } else {
          emitBaseWrite(context, resolved.base, propExpr);
        }
      }
      return;
    }
    case TypeName.array: {
      const element = schema.def.element;
      const holder = hoist(context, valueExpr);
      const index = nextVar(context, "i");
      const item = nextVar(context, "e");
      writer.line(`dv.setUint32(o, ${holder}.length, true); o += 4;`);
      writer.line(`for (let ${index} = 0; ${index} < ${holder}.length; ${index}++) {`);
      writer.indent(() => {
        writer.line(`const ${item} = ${holder}[${index}];`);
        emitWrite(context, element, item);
      });
      writer.line("}");
      return;
    }
    case TypeName.tuple: {
      const items = schema.def.items ?? [];
      const rest = schema.def.rest;
      const holder = hoist(context, valueExpr);
      items.forEach((item, position) => {
        emitWrite(context, item, `${holder}[${position}]`);
      });
      if (rest) {
        const index = nextVar(context, "i");
        writer.line(`dv.setUint32(o, ${holder}.length - ${items.length}, true); o += 4;`);
        writer.line(`for (let ${index} = ${items.length}; ${index} < ${holder}.length; ${index}++) {`);
        writer.indent(() => {
          emitWrite(context, rest, `${holder}[${index}]`);
        });
        writer.line("}");
      }
      return;
    }
    case TypeName.set: {
      const element = schema.def.element;
      const holder = hoist(context, valueExpr);
      const item = nextVar(context, "e");
      writer.line(`dv.setUint32(o, ${holder}.size, true); o += 4;`);
      writer.line(`for (const ${item} of ${holder}) {`);
      writer.indent(() => {
        emitWrite(context, element, item);
      });
      writer.line("}");
      return;
    }
    case TypeName.map: {
      const keySchema = schema.def.key;
      const valueSchema = schema.def.value;
      const holder = hoist(context, valueExpr);
      const entry = nextVar(context, "e");
      writer.line(`dv.setUint32(o, ${holder}.size, true); o += 4;`);
      writer.line(`for (const ${entry} of ${holder}) {`);
      writer.indent(() => {
        emitWrite(context, keySchema, `${entry}[0]`);
        emitWrite(context, valueSchema, `${entry}[1]`);
      });
      writer.line("}");
      return;
    }
    case TypeName.record: {
      const valueSchema = schema.def.value;
      const holder = hoist(context, valueExpr);
      const keys = nextVar(context, "k");
      const index = nextVar(context, "i");
      writer.line(`const ${keys} = Object.keys(${holder});`);
      writer.line(`dv.setUint32(o, ${keys}.length, true); o += 4;`);
      writer.line(`for (let ${index} = 0; ${index} < ${keys}.length; ${index}++) {`);
      writer.indent(() => {
        emitStringWrite(context, `${keys}[${index}]`);
        emitWrite(context, valueSchema, `${holder}[${keys}[${index}]]`);
      });
      writer.line("}");
      return;
    }
    case TypeName.union: {
      const options = schema.def.options;
      const holder = hoist(context, valueExpr);
      options.forEach((option, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${emitSchemaGuard(option, holder)}) {`);
        writer.indent(() => {
          writer.line(`dv.setUint8(o, ${position}); o += 1;`);
          emitWrite(context, option, holder);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line('throw new RangeError("jit codec: value matched no union option");');
      });
      writer.line("}");
      return;
    }
    case TypeName.discriminatedUnion: {
      const discriminator = schema.def.discriminator;
      const tagged = taggedOptions(schema);
      const holder = hoist(context, valueExpr);
      const tag = nextVar(context, "t");
      writer.line(`const ${tag} = ${emitPropertyAccess(holder, discriminator)};`);
      tagged.forEach((entry, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${emitLiteral(entry.tag)}) {`);
        writer.indent(() => {
          writer.line(`dv.setUint8(o, ${position}); o += 1;`);
          emitBaseWrite(context, entry.option, holder);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line(`throw new RangeError("jit codec: unknown discriminator value: " + ${tag});`);
      });
      writer.line("}");
      return;
    }
    case TypeName.intersection: {
      const options = schema.def.options;
      const holder = hoist(context, valueExpr);
      for (const option of options) {
        const base = resolveCodecWrappers(option).base;
        if (base.type !== TypeName.object) unsupported("intersection of non-object");
        emitBaseWrite(context, base, holder);
      }
      return;
    }
    default:
      unsupported(schema.type);
  }
}
function emitRead(context, schema) {
  const resolved = resolveCodecWrappers(schema);
  const writer = context.writer;
  if (resolved.guarded) {
    const flag = nextVar(context, "p");
    const holder = nextVar(context, "r");
    writer.line(`const ${flag} = dv.getUint8(o); o += 1;`);
    writer.line(`let ${holder};`);
    writer.line(`if (${flag} === 1) {`);
    writer.indent(() => {
      writer.line(`${holder} = null;`);
    });
    writer.line(`} else if (${flag} === 2) {`);
    writer.indent(() => {
      writer.line(`${holder} = ${emitBaseRead(context, resolved.base)};`);
    });
    writer.line("}");
    return holder;
  }
  return emitBaseRead(context, resolved.base);
}
function emitStringRead(context) {
  const writer = context.writer;
  const length = nextVar(context, "l");
  const holder = nextVar(context, "t");
  writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
  writer.line(`if (o + ${length} > u8.length) throw new RangeError("jit codec: truncated buffer");`);
  writer.line(`const ${holder} = __dec.decode(u8.subarray(o, o + ${length})); o += ${length};`);
  return holder;
}
function emitObjectEntries(context, schema) {
  const writer = context.writer;
  const props = schema.def.props;
  const layout = objectLayout(schema);
  const maskVars = [];
  const guardedByKey = new Map(layout.guarded.map((entry) => [entry.key, entry]));
  for (let byte = 0; byte < layout.maskBytes; byte++) {
    const mask2 = nextVar(context, "m");
    maskVars.push(mask2);
    writer.line(`const ${mask2} = dv.getUint8(o); o += 1;`);
  }
  const entries = [];
  for (const key of Object.keys(props)) {
    const guarded = guardedByKey.get(key);
    if (!guarded) {
      entries.push(`${emitLiteral(key)}: ${emitRead(context, props[key])}`);
      continue;
    }
    const resolved = resolveCodecWrappers(props[key]);
    const mask2 = maskVars[guarded.bit >> 2];
    const shift = (guarded.bit & 3) * 2;
    const state = nextVar(context, "s");
    const holder = nextVar(context, "r");
    writer.line(`const ${state} = (${mask2} >> ${shift}) & 3;`);
    writer.line(`let ${holder};`);
    writer.line(`if (${state} === 1) {`);
    writer.indent(() => {
      writer.line(`${holder} = null;`);
    });
    writer.line(`} else if (${state} === 2) {`);
    writer.indent(() => {
      writer.line(`${holder} = ${emitBaseRead(context, resolved.base)};`);
    });
    writer.line("}");
    entries.push(`${emitLiteral(key)}: ${holder}`);
  }
  return entries;
}
function emitBaseRead(context, schema) {
  const writer = context.writer;
  switch (schema.type) {
    case TypeName.number:
    case TypeName.nan: {
      const holder = nextVar(context, "n");
      writer.line(`const ${holder} = dv.getFloat64(o, true); o += 8;`);
      return holder;
    }
    case TypeName.int: {
      const holder = nextVar(context, "n");
      writer.line(`const ${holder} = dv.getInt32(o, true); o += 4;`);
      return holder;
    }
    case TypeName.bigint: {
      const holder = nextVar(context, "n");
      writer.line(`const ${holder} = dv.getBigInt64(o, true); o += 8;`);
      return holder;
    }
    case TypeName.date: {
      const holder = nextVar(context, "d");
      writer.line(`const ${holder} = new Date(dv.getFloat64(o, true)); o += 8;`);
      return holder;
    }
    case TypeName.boolean: {
      const holder = nextVar(context, "b");
      writer.line(`const ${holder} = dv.getUint8(o) !== 0; o += 1;`);
      return holder;
    }
    case TypeName.enum: {
      const holder = nextVar(context, "n");
      writer.line(`const ${holder} = ${enumBinding(context, schema)}[dv.getUint8(o)]; o += 1;`);
      return holder;
    }
    case TypeName.literal:
      return emitLiteral(schema.def.value);
    case TypeName.null:
      return "null";
    case TypeName.undefined:
      return "undefined";
    case TypeName.string:
      return emitStringRead(context);
    case TypeName.object:
      return `{ ${emitObjectEntries(context, schema).join(", ")} }`;
    case TypeName.array: {
      const element = schema.def.element;
      const length = nextVar(context, "l");
      const out = nextVar(context, "a");
      const index = nextVar(context, "i");
      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Array(${length});`);
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        writer.line(`${out}[${index}] = ${emitRead(context, element)};`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.tuple: {
      const items = schema.def.items ?? [];
      const rest = schema.def.rest;
      const slots = items.map((item) => {
        const slot = nextVar(context, "e");
        writer.line(`const ${slot} = ${emitRead(context, item)};`);
        return slot;
      });
      const out = nextVar(context, "a");
      if (!rest) {
        writer.line(`const ${out} = [${slots.join(", ")}];`);
        return out;
      }
      const length = nextVar(context, "l");
      const index = nextVar(context, "i");
      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Array(${items.length} + ${length});`);
      slots.forEach((slot, position) => {
        writer.line(`${out}[${position}] = ${slot};`);
      });
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        writer.line(`${out}[${items.length} + ${index}] = ${emitRead(context, rest)};`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.set: {
      const element = schema.def.element;
      const length = nextVar(context, "l");
      const out = nextVar(context, "a");
      const index = nextVar(context, "i");
      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Set();`);
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        writer.line(`${out}.add(${emitRead(context, element)});`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.map: {
      const keySchema = schema.def.key;
      const valueSchema = schema.def.value;
      const length = nextVar(context, "l");
      const out = nextVar(context, "a");
      const index = nextVar(context, "i");
      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Map();`);
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        const key = nextVar(context, "e");
        writer.line(`const ${key} = ${emitRead(context, keySchema)};`);
        writer.line(`${out}.set(${key}, ${emitRead(context, valueSchema)});`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.record: {
      const valueSchema = schema.def.value;
      const length = nextVar(context, "l");
      const out = nextVar(context, "a");
      const index = nextVar(context, "i");
      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = {};`);
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        const key = emitStringRead(context);
        writer.line(`${out}[${key}] = ${emitRead(context, valueSchema)};`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.union: {
      const options = schema.def.options;
      const tag = nextVar(context, "t");
      const holder = nextVar(context, "r");
      writer.line(`const ${tag} = dv.getUint8(o); o += 1;`);
      writer.line(`let ${holder};`);
      options.forEach((option, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${position}) {`);
        writer.indent(() => {
          writer.line(`${holder} = ${emitRead(context, option)};`);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line(`throw new RangeError("jit codec: invalid union tag: " + ${tag});`);
      });
      writer.line("}");
      return holder;
    }
    case TypeName.discriminatedUnion: {
      const tagged = taggedOptions(schema);
      const tag = nextVar(context, "t");
      const holder = nextVar(context, "r");
      writer.line(`const ${tag} = dv.getUint8(o); o += 1;`);
      writer.line(`let ${holder};`);
      tagged.forEach((entry, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${position}) {`);
        writer.indent(() => {
          writer.line(`${holder} = ${emitBaseRead(context, entry.option)};`);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line(`throw new RangeError("jit codec: invalid union tag: " + ${tag});`);
      });
      writer.line("}");
      return holder;
    }
    case TypeName.intersection: {
      const options = schema.def.options;
      const entries = [];
      for (const option of options) {
        const base = resolveCodecWrappers(option).base;
        if (base.type !== TypeName.object) unsupported("intersection of non-object");
        entries.push(...emitObjectEntries(context, base));
      }
      return `{ ${entries.join(", ")} }`;
    }
    default:
      unsupported(schema.type);
  }
}
function hoist(context, expr) {
  if (parse_exports.isValidIdentifier(expr)) return expr;
  const holder = nextVar(context, "v");
  context.writer.line(`const ${holder} = ${expr};`);
  return holder;
}

// ../../packages/jit/src/compiler/diff/build-diff-ir.ts
function buildDiffIR(schema) {
  return {
    kind: "program",
    leftParam: "left",
    rightParam: "right",
    body: buildDiffNode(schema)
  };
}
function buildDiffNode(schema) {
  if (schema.type === TypeName.date) return { kind: "date" };
  if (schema.type === TypeName.union) return buildUnionNode2(schema);
  if (schema.type === TypeName.intersection) return buildIntersectionNode2(schema);
  if (schema.type === TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode2(schema);
  const node = buildSchemaNode(schema, buildDiffNode);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };
  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler diff IR for type: ${schema.type}`);
}
function buildUnionNode2(schema) {
  if (schema.def.options.every((option) => isPrimitiveLikeSchema(option))) {
    return { kind: "reuse" };
  }
  return {
    kind: "union",
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildDiffNode(option)
    }))
  };
}
function buildIntersectionNode2(schema) {
  return {
    kind: "intersection",
    options: schema.def.options.map(buildDiffNode)
  };
}
function buildDiscriminatedUnionNode2(schema) {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildDiffNode(option)
    }))
  };
}

// ../../packages/jit/src/compiler/diff/emit-diff.ts
function emitDiff(program) {
  const writer = new CodeWriter();
  writer.line(`function diff(${program.leftParam}, ${program.rightParam}) {`);
  writer.indent(
    () => emitDiffBodyLines(writer, createEmitState(), program.body, program.leftParam, program.rightParam)
  );
  writer.line("}");
  return writer.toString();
}
function emitDiffBody(program) {
  const writer = new CodeWriter();
  emitDiffBodyLines(writer, createEmitState(), program.body, program.leftParam, program.rightParam);
  return writer.toString();
}
function emitDiffBodyLines(writer, state, node, left, right) {
  writer.line("const changes = [];");
  writer.line(`if (Object.is(${left}, ${right})) {`);
  writer.indent(() => writer.line("return changes;"));
  writer.line("}");
  emitDiffNode(writer, state, node, left, right, []);
  writer.line("return changes;");
}
function emitDiffNode(writer, state, node, left, right, path) {
  switch (node.kind) {
    case "reuse":
      writer.line(`if (!Object.is(${left}, ${right})) {`);
      writer.indent(() => emitChange(writer, "update", path, right));
      writer.line("}");
      return;
    case "date":
      writer.line(`if (${left}.getTime() !== ${right}.getTime()) {`);
      writer.indent(() => emitChange(writer, "update", path, right));
      writer.line("}");
      return;
    case "union":
      emitUnionDiff(writer, state, node, left, right, path);
      return;
    case "intersection":
      emitIntersectionDiff(writer, state, node, left, right, path);
      return;
    case "discriminatedUnion":
      emitDiscriminatedUnionDiff(writer, state, node, left, right, path);
      return;
    case "guard":
      emitGuardDiff(writer, state, node, left, right, path);
      return;
    case "object":
      emitObjectDiff(writer, state, node, left, right, path);
      return;
    case "array":
      emitArrayDiff(writer, state, node, left, right, path);
      return;
    case "tuple":
      emitTupleDiff(writer, state, node, left, right, path);
      return;
    case "record":
      emitRecordDiff(writer, state, node, left, right, path);
      return;
    case "set":
      emitSetDiff(writer, state, left, right, path);
      return;
    case "map":
      emitMapDiff(writer, state, left, right, path);
      return;
  }
}
function emitGuardDiff(writer, state, node, left, right, path) {
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(
      `if (!(${emitGuardTest(node.optional, node.nullable, left)}) || !(${emitGuardTest(
        node.optional,
        node.nullable,
        right
      )})) {`
    );
    writer.indent(() => emitChange(writer, "update", path, right));
    writer.line("} else {");
    writer.indent(() => emitDiffNode(writer, state, node.inner, left, right, path));
    writer.line("}");
  });
  writer.line("}");
}
function emitObjectDiff(writer, state, node, left, right, path) {
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    for (const prop of node.props) {
      const leftValue = emitDefaultedValue(prop.schema, emitPropertyAccess(left, prop.key));
      const rightValue = emitDefaultedValue(prop.schema, emitPropertyAccess(right, prop.key));
      emitDiffNode(writer, state, prop.value, leftValue, rightValue, [...path, prop.key]);
    }
  });
  writer.line("}");
}
function emitUnionDiff(writer, state, node, left, right, path) {
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    if (node.options.length === 0) {
      emitChange(writer, "update", path, right);
      return;
    }
    let prefix = "if";
    for (const option of node.options) {
      writer.line(`${prefix} (${emitSchemaGuard(option.schema, left)}) {`);
      writer.indent(() => {
        writer.line(`if (${emitSchemaGuard(option.schema, right)}) {`);
        writer.indent(() => emitDiffNode(writer, state, option.node, left, right, path));
        writer.line("} else {");
        writer.indent(() => emitChange(writer, "update", path, right));
        writer.line("}");
      });
      prefix = "} else if";
    }
    writer.line("} else {");
    writer.indent(() => emitChange(writer, "update", path, right));
    writer.line("}");
  });
  writer.line("}");
}
function emitIntersectionDiff(writer, state, node, left, right, path) {
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    for (const option of node.options) {
      emitDiffNode(writer, state, option, left, right, path);
    }
  });
  writer.line("}");
}
function emitDiscriminatedUnionDiff(writer, state, node, left, right, path) {
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    if (node.options.length === 0) {
      emitChange(writer, "update", path, right);
      return;
    }
    let prefix = "if";
    for (const option of node.options) {
      writer.line(`${prefix} (${emitSchemaGuard(option.schema, left)}) {`);
      writer.indent(() => {
        writer.line(`if (${emitSchemaGuard(option.schema, right)}) {`);
        writer.indent(() => emitDiffNode(writer, state, option.node, left, right, path));
        writer.line("} else {");
        writer.indent(() => emitChange(writer, "update", path, right));
        writer.line("}");
      });
      prefix = "} else if";
    }
    writer.line("} else {");
    writer.indent(() => emitChange(writer, "update", path, right));
    writer.line("}");
  });
  writer.line("}");
}
function emitTupleDiff(writer, state, node, left, right, path) {
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    for (let index = 0; index < node.items.length; index++) {
      emitDiffNode(writer, state, node.items[index], `${left}[${index}]`, `${right}[${index}]`, [...path, index]);
    }
  });
  writer.line("}");
}
function emitArrayDiff(writer, state, node, left, right, path) {
  const leftLen = state.nextVar("leftLen");
  const rightLen = state.nextVar("rightLen");
  const commonLen = state.nextVar("commonLen");
  const index = state.nextVar("i");
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(`const ${leftLen} = ${left}.length;`);
    writer.line(`const ${rightLen} = ${right}.length;`);
    writer.line(`const ${commonLen} = ${leftLen} < ${rightLen} ? ${leftLen} : ${rightLen};`);
    writer.line(`for (let ${index} = 0; ${index} < ${commonLen}; ${index}++) {`);
    writer.indent(() => {
      emitDiffNode(writer, state, node.element, `${left}[${index}]`, `${right}[${index}]`, [...path, { expr: index }]);
    });
    writer.line("}");
    writer.line(`for (let ${index} = ${commonLen}; ${index} < ${rightLen}; ${index}++) {`);
    writer.indent(() => emitChange(writer, "add", [...path, { expr: index }], `${right}[${index}]`));
    writer.line("}");
    writer.line(`for (let ${index} = ${commonLen}; ${index} < ${leftLen}; ${index}++) {`);
    writer.indent(() => emitChange(writer, "remove", [...path, { expr: index }]));
    writer.line("}");
  });
  writer.line("}");
}
function emitRecordDiff(writer, state, node, left, right, path) {
  const leftKeys = state.nextVar("leftKeys");
  const rightKeys = state.nextVar("rightKeys");
  const len = state.nextVar("len");
  const index = state.nextVar("i");
  const key = state.nextVar("key");
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(`const ${leftKeys} = Object.keys(${left});`);
    writer.line(`const ${rightKeys} = Object.keys(${right});`);
    writer.line(`for (let ${index} = 0, ${len} = ${rightKeys}.length; ${index} < ${len}; ${index}++) {`);
    writer.indent(() => {
      writer.line(`const ${key} = ${rightKeys}[${index}];`);
      writer.line(`if (!Object.prototype.hasOwnProperty.call(${left}, ${key})) {`);
      writer.indent(() => emitChange(writer, "add", [...path, { expr: key }], `${right}[${key}]`));
      writer.line("} else {");
      writer.indent(
        () => emitDiffNode(writer, state, node.value, `${left}[${key}]`, `${right}[${key}]`, [...path, { expr: key }])
      );
      writer.line("}");
    });
    writer.line("}");
    writer.line(`for (let ${index} = 0, ${len} = ${leftKeys}.length; ${index} < ${len}; ${index}++) {`);
    writer.indent(() => {
      writer.line(`const ${key} = ${leftKeys}[${index}];`);
      writer.line(`if (!Object.prototype.hasOwnProperty.call(${right}, ${key})) {`);
      writer.indent(() => emitChange(writer, "remove", [...path, { expr: key }]));
      writer.line("}");
    });
    writer.line("}");
  });
  writer.line("}");
}
function emitSetDiff(writer, state, left, right, path) {
  const item = state.nextVar("item");
  const iter = state.nextVar("iter");
  const step = state.nextVar("step");
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(`let changed = ${left}.size !== ${right}.size;`);
    writer.line("if (!changed) {");
    writer.indent(() => {
      writer.line(`const ${iter} = ${right}.values();`);
      writer.line(`let ${step} = ${iter}.next();`);
      writer.line(`while (!${step}.done) {`);
      writer.indent(() => {
        writer.line(`const ${item} = ${step}.value;`);
        writer.line(`if (!${left}.has(${item})) {`);
        writer.indent(() => {
          writer.line("changed = true;");
          writer.line("break;");
        });
        writer.line("}");
        writer.line(`${step} = ${iter}.next();`);
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("if (changed) {");
    writer.indent(() => emitChange(writer, "update", path, right));
    writer.line("}");
  });
  writer.line("}");
}
function emitMapDiff(writer, state, left, right, path) {
  const entry = state.nextVar("entry");
  const iter = state.nextVar("iter");
  const step = state.nextVar("step");
  const key = state.nextVar("key");
  const value = state.nextVar("value");
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(`let changed = ${left}.size !== ${right}.size;`);
    writer.line("if (!changed) {");
    writer.indent(() => {
      writer.line(`const ${iter} = ${right}.entries();`);
      writer.line(`let ${step} = ${iter}.next();`);
      writer.line(`while (!${step}.done) {`);
      writer.indent(() => {
        writer.line(`const ${entry} = ${step}.value;`);
        writer.line(`const ${key} = ${entry}[0];`);
        writer.line(`const ${value} = ${entry}[1];`);
        writer.line(`if (!${left}.has(${key}) || !Object.is(${left}.get(${key}), ${value})) {`);
        writer.indent(() => {
          writer.line("changed = true;");
          writer.line("break;");
        });
        writer.line("}");
        writer.line(`${step} = ${iter}.next();`);
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("if (changed) {");
    writer.indent(() => emitChange(writer, "update", path, right));
    writer.line("}");
  });
  writer.line("}");
}
function emitChange(writer, type, path, value) {
  const valuePart = value === void 0 ? "" : `, value: ${value}`;
  writer.line(`changes[changes.length] = { type: ${emitLiteral(type)}, path: ${emitPath(path)}${valuePart} };`);
}
function emitPath(path) {
  return `[${path.map(emitPathPart).join(", ")}]`;
}
function emitPathPart(part) {
  if (typeof part === "object") return part.expr;
  return emitLiteral(part);
}

// ../../packages/jit/src/compiler/diff.ts
function emitDiffSource(schema) {
  return emitDiff(buildDiffIR(schema));
}
function compileDiff(schema, options) {
  return getCompileCached(
    schema,
    "diff",
    () => {
      const program = buildDiffIR(schema);
      const body = emitDiffBody(program);
      const compiled = globalThis.Function(`return function diff(left, right) {
${body}
};`)();
      registerArtifact(compiled, {
        kind: "operation",
        schema,
        op: "diff"
      });
      return compiled;
    },
    options
  );
}

// ../../packages/jit/src/runtime/index/build-index.ts
function buildIndex(items, key) {
  const index = /* @__PURE__ */ new Map();
  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i];
    index.set(item[key], item);
  }
  return index;
}

// ../../packages/jit/src/runtime/index/index-cache.ts
var INDEX_CACHE = /* @__PURE__ */ new WeakMap();
function getIndex(items, key) {
  const cached = INDEX_CACHE.get(items);
  if (cached && cached.key === key) {
    return cached.map;
  }
  const map2 = buildIndex(items, key);
  INDEX_CACHE.set(items, { key, map: map2 });
  return map2;
}

// ../../packages/jit/src/compiler/emitter/emit-expr.ts
var BINARY_OPERATORS = {
  strictEqual: "===",
  notStrictEqual: "!==",
  or: "||",
  and: "&&",
  add: "+",
  divide: "/",
  greaterThan: ">",
  greaterThanOrEqual: ">=",
  lessThan: "<",
  lessThanOrEqual: "<="
};
var COMPARISON_OPERATORS = /* @__PURE__ */ new Set([
  "strictEqual",
  "notStrictEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual"
]);
function emitExpr(expr) {
  switch (expr.kind) {
    case "var":
      return expr.name;
    case "literal":
      return emitLiteral(expr.value);
    case "not":
      return `!(${emitExpr(expr.expr)})`;
    case "binary":
      return `(${emitExpr(expr.left)} ${BINARY_OPERATORS[expr.op]} ${emitExpr(expr.right)})`;
    case "nary":
      return `(${expr.operands.map(emitConditionRaw).join(expr.op === "and" ? " && " : " || ")})`;
    case "sameValue":
      return `Object.is(${emitExpr(expr.left)}, ${emitExpr(expr.right)})`;
    case "sameNumber": {
      const left = emitExpr(expr.left);
      const right = emitExpr(expr.right);
      return `(${left} === ${right} || (${left} !== ${left} && ${right} !== ${right}))`;
    }
    case "schema_guard":
      return emitSchemaGuard(expr.schema, emitExpr(expr.value));
    case "load_prop":
      return emitPropertyAccess(emitExpr(expr.base), expr.key);
    case "load_index":
      return emitIndexAccess(emitExpr(expr.base), emitExpr(expr.index));
    case "call":
      return `${emitExpr(expr.callee)}(${expr.args.map(emitExpr).join(", ")})`;
    case "object_literal": {
      if (expr.entries.length === 0) return "{}";
      const entries = expr.entries.map((entry) => `${emitLiteral(entry.key)}: ${emitExpr(entry.value)}`);
      return `{ ${entries.join(", ")} }`;
    }
    case "array_literal":
      return `[${expr.elements.map(emitExpr).join(", ")}]`;
    case "construct":
      return `new ${expr.ctor}(${expr.args.map(emitExpr).join(", ")})`;
  }
}
function emitConditionRaw(expr) {
  if (expr.kind === "binary" && COMPARISON_OPERATORS.has(expr.op)) {
    return `${emitExpr(expr.left)} ${BINARY_OPERATORS[expr.op]} ${emitExpr(expr.right)}`;
  }
  if (expr.kind === "not") {
    return `!(${emitConditionRaw(expr.expr)})`;
  }
  return emitExpr(expr);
}

// ../../packages/jit/src/compiler/emitter/emit-node.ts
function emitNode(writer, node) {
  switch (node.kind) {
    case "block":
      for (const child of node.body) emitNode(writer, child);
      return;
    case "assign":
      writer.line(`const ${node.target.name} = ${emitExpr(node.expr)};`);
      return;
    case "let":
      if (node.expr === void 0) {
        writer.line(`let ${node.target.name};`);
      } else {
        writer.line(`let ${node.target.name} = ${emitExpr(node.expr)};`);
      }
      return;
    case "store":
      writer.line(`${emitExpr(node.target)} = ${emitExpr(node.expr)};`);
      return;
    case "expr_stmt":
      writer.line(`${emitExpr(node.expr)};`);
      return;
    case "hash_compare":
      writer.line(`if (${emitExpr(node.leftHash)} !== ${emitExpr(node.rightHash)}) {`);
      writer.indent(() => {
        writer.line("return false;");
      });
      writer.line("}");
      return;
    case "map_equal":
      emitMapEqual(writer, node);
      return;
    case "binary_search_equal":
      emitBinarySearchEqual(writer, node);
      return;
    case "if":
      writer.line(`if (${emitTestExpr(node.test)}) {`);
      writer.indent(() => {
        for (const child of node.then) emitNode(writer, child);
      });
      if (node.otherwise && node.otherwise.length > 0) {
        writer.line("} else {");
        writer.indent(() => {
          for (const child of node.otherwise ?? []) emitNode(writer, child);
        });
      }
      writer.line("}");
      return;
    case "for":
      writer.line(`for (let ${node.index.name} = ${emitExpr(node.from)}; ${node.index.name}-- !== 0;) {`);
      writer.indent(() => {
        for (const child of node.body) emitNode(writer, child);
      });
      writer.line("}");
      return;
    case "for_range": {
      const index = node.index.name;
      writer.line(`for (let ${index} = 0; ${index} < ${emitExpr(node.length)}; ${index}++) {`);
      writer.indent(() => {
        for (const child of node.body) emitNode(writer, child);
      });
      writer.line("}");
      return;
    }
    case "for_of":
      writer.line(`for (const ${node.item.name} of ${emitExpr(node.iterable)}) {`);
      writer.indent(() => {
        for (const child of node.body) emitNode(writer, child);
      });
      writer.line("}");
      return;
    case "append":
      writer.line(`${node.target.name}[${node.cursor.name}++] = ${emitExpr(node.value)};`);
      return;
    case "sort_by_key":
      writer.line(`${node.target.name}.sort((left, right) => {`);
      writer.indent(() => {
        writer.line(`const leftValue = ${emitPropertyAccess("left", node.key)};`);
        writer.line(`const rightValue = ${emitPropertyAccess("right", node.key)};`);
        writer.line("if (leftValue === rightValue) return 0;");
        if (node.direction === "desc") {
          writer.line("return leftValue < rightValue ? 1 : -1;");
        } else {
          writer.line("return leftValue < rightValue ? -1 : 1;");
        }
      });
      writer.line("});");
      return;
    case "return":
      writer.line(`return ${emitExpr(node.value)};`);
      return;
  }
}
function emitTestExpr(expr) {
  if (expr.kind === "binary") {
    const left = emitExpr(expr.left);
    const right = emitExpr(expr.right);
    if (expr.op === "strictEqual") return `${left} === ${right}`;
    if (expr.op === "notStrictEqual") return `${left} !== ${right}`;
  }
  if (expr.kind === "nary") {
    const op = expr.op === "and" ? " && " : " || ";
    return expr.operands.map((operand) => `(${emitConditionRaw(operand)})`).join(op);
  }
  if (expr.kind === "not") {
    const inner = expr.expr;
    if (inner.kind === "sameNumber") {
      const left = emitExpr(inner.left);
      const right = emitExpr(inner.right);
      return `${left} !== ${right} && (${left} === ${left} || ${right} === ${right})`;
    }
    if (inner.kind === "sameValue") {
      return `!Object.is(${emitExpr(inner.left)}, ${emitExpr(inner.right)})`;
    }
    if (inner.kind === "binary" && inner.op === "strictEqual") {
      return `${emitExpr(inner.left)} !== ${emitExpr(inner.right)}`;
    }
    if (inner.kind === "call") {
      return `!${emitExpr(inner)}`;
    }
    if (inner.kind === "nary") {
      return `!(${emitTestExpr(inner)})`;
    }
  }
  return emitExpr(expr);
}
function emitMapEqual(writer, node) {
  writer.line(`const ${node.length.name} = ${emitExpr(node.left)}.length;`);
  writer.line(`if (${node.length.name} !== ${emitExpr(node.right)}.length) {`);
  writer.indent(() => {
    writer.line("return false;");
  });
  writer.line("}");
  writer.line(`if (${node.length.name} < 64) {`);
  writer.indent(() => {
    writer.line(`for (let ${node.index.name} = 0; ${node.index.name} < ${node.length.name}; ${node.index.name}++) {`);
    writer.indent(() => {
      writer.line(`const ${node.leftItem.name} = ${emitExpr(node.left)}[${node.index.name}];`);
      writer.line("let found = false;");
      writer.line(`for (let j = 0; j < ${node.length.name}; j++) {`);
      writer.indent(() => {
        writer.line(`const ${node.rightItem.name} = ${emitExpr(node.right)}[j];`);
        writer.line(
          `if (${emitPropertyAccess(node.rightItem.name, node.key)} === ${emitPropertyAccess(node.leftItem.name, node.key)}) {`
        );
        writer.indent(() => {
          writer.line("found = true;");
          for (const child of node.body) emitNode(writer, child);
          writer.line("break;");
        });
        writer.line("}");
      });
      writer.line("}");
      writer.line("if (!found) {");
      writer.indent(() => {
        writer.line("return false;");
      });
      writer.line("}");
    });
    writer.line("}");
  });
  writer.line("} else {");
  writer.indent(() => {
    writer.line(`let ${node.rightIndex.name};`);
    writer.line(`${node.rightIndex.name} = __getIndex(${emitExpr(node.right)}, ${emitLiteral(node.key)});`);
    writer.line(`for (let ${node.index.name} = 0; ${node.index.name} < ${node.length.name}; ${node.index.name}++) {`);
    writer.indent(() => {
      writer.line(`const ${node.leftItem.name} = ${emitExpr(node.left)}[${node.index.name}];`);
      writer.line(
        `const ${node.rightItem.name} = ${node.rightIndex.name}.get(${emitPropertyAccess(node.leftItem.name, node.key)});`
      );
      writer.line(
        `if (${node.rightItem.name} === undefined && !${node.rightIndex.name}.has(${emitPropertyAccess(node.leftItem.name, node.key)})) {`
      );
      writer.indent(() => {
        writer.line("return false;");
      });
      writer.line("}");
      for (const child of node.body) emitNode(writer, child);
    });
    writer.line("}");
  });
  writer.line("}");
}
function emitBinarySearchEqual(writer, node) {
  const compareLeft = node.direction === "desc" ? ">" : "<";
  writer.line(`const ${node.length.name} = ${emitExpr(node.left)}.length;`);
  writer.line(`if (${node.length.name} !== ${emitExpr(node.right)}.length) {`);
  writer.indent(() => {
    writer.line("return false;");
  });
  writer.line("}");
  writer.line(`for (let ${node.index.name} = 0; ${node.index.name} < ${node.length.name}; ${node.index.name}++) {`);
  writer.indent(() => {
    writer.line(`const ${node.leftItem.name} = ${emitExpr(node.left)}[${node.index.name}];`);
    writer.line(`let ${node.searchLow.name} = 0;`);
    writer.line(`let ${node.searchHigh.name} = ${node.length.name} - 1;`);
    writer.line(`let ${node.rightItem.name};`);
    writer.line(`while (${node.searchLow.name} <= ${node.searchHigh.name}) {`);
    writer.indent(() => {
      writer.line(`const ${node.searchMid.name} = (${node.searchLow.name} + ${node.searchHigh.name}) >> 1;`);
      writer.line(`const ${node.found.name} = ${emitExpr(node.right)}[${node.searchMid.name}];`);
      writer.line(
        `if (${emitPropertyAccess(node.found.name, node.key)} === ${emitPropertyAccess(node.leftItem.name, node.key)}) {`
      );
      writer.indent(() => {
        writer.line(`${node.rightItem.name} = ${node.found.name};`);
        writer.line("break;");
      });
      writer.line("}");
      writer.line(
        `if (${emitPropertyAccess(node.found.name, node.key)} ${compareLeft} ${emitPropertyAccess(node.leftItem.name, node.key)}) {`
      );
      writer.indent(() => {
        writer.line(`${node.searchLow.name} = ${node.searchMid.name} + 1;`);
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line(`${node.searchHigh.name} = ${node.searchMid.name} - 1;`);
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line(`if (${node.rightItem.name} === undefined) {`);
    writer.indent(() => {
      writer.line("return false;");
    });
    writer.line("}");
    for (const child of node.body) emitNode(writer, child);
  });
  writer.line("}");
}

// ../../packages/jit/src/compiler/emitter/emit-equal.ts
function emitEqual(program) {
  const writer = new CodeWriter();
  const [left, right] = program.params;
  writer.line(`function equal(${left.name}, ${right.name}) {`);
  writer.indent(() => {
    for (const node of program.body) emitNode(writer, node);
  });
  writer.line("}");
  return writer.toString();
}
function emitEqualBody(program) {
  const writer = new CodeWriter();
  for (const node of program.body) emitNode(writer, node);
  return writer.toString();
}

// ../../packages/jit/src/runtime/hash/hash-cache.ts
var HASH_CACHE = /* @__PURE__ */ new WeakMap();
function getHash(value, compute) {
  const cached = HASH_CACHE.get(value);
  if (cached !== void 0) {
    return cached;
  }
  const hash4 = compute(value);
  HASH_CACHE.set(value, hash4);
  return hash4;
}
function isHashCacheable(value) {
  return typeof value === "object" && value !== null || typeof value === "function";
}

// ../../packages/jit/src/runtime/hash/hash-combine.ts
function combineHash(left, right) {
  return (left << 5) - left + right | 0;
}

// ../../packages/jit/src/runtime/hash/hash-primitives.ts
function hashNumber(value) {
  return value | 0;
}
function hashString(value) {
  let hash4 = 0;
  for (let i = 0, len = value.length; i < len; i++) {
    hash4 = hash4 * 31 + value.charCodeAt(i) | 0;
  }
  return hash4;
}
function hashBoolean(value) {
  return value ? 1 : 0;
}
function hashBigInt(value) {
  return Number(value & 0xffffffffn) | 0;
}
function hashUnknown(value) {
  switch (typeof value) {
    case "string":
      return hashString(value);
    case "number":
      return hashNumber(value);
    case "boolean":
      return hashBoolean(value);
    case "bigint":
      return hashBigInt(value);
    case "undefined":
      return 0;
    case "symbol":
      return hashString(String(value));
    case "object":
      return value === null ? 1 : hashString(Object.prototype.toString.call(value));
    case "function":
      return hashString("function");
  }
}

// ../../packages/jit/src/compiler/hash.ts
function emitHashSource(schema) {
  return `function hash(value) {
${emitHashBody(schema)}
}`;
}
function compileHash(schema, options) {
  return getCompileCached(
    schema,
    "hash",
    () => {
      const compute = globalThis.Function(
        "__combineHash",
        "__hashNumber",
        "__hashString",
        "__hashBoolean",
        "__hashBigInt",
        "__hashUnknown",
        `return function computeHash(value) {
${emitHashBody(schema)}
};`
      )(combineHash, hashNumber, hashString, hashBoolean, hashBigInt, hashUnknown);
      const compiled = ((value) => {
        if (isHashCacheable(value)) {
          return getHash(value, compute);
        }
        return compute(value);
      });
      registerArtifact(compiled, {
        kind: "operation",
        schema,
        op: "hash"
      });
      return compiled;
    },
    options
  );
}
function emitHashBody(schema) {
  const lines = [];
  emitHashInto(lines, schema, "value", "h", 1);
  lines.push("  return h;");
  return lines.join("\n");
}
function emitHashInto(lines, schema, value, target, depth) {
  const pad = "  ".repeat(depth);
  const next = `${target}_${depth}`;
  switch (schema.type) {
    case "number":
    case "int":
    case "nan":
      lines.push(`${pad}let ${target} = __hashNumber(${value});`);
      return;
    case "string":
      lines.push(`${pad}let ${target} = __hashString(${value});`);
      return;
    case "boolean":
      lines.push(`${pad}let ${target} = __hashBoolean(${value});`);
      return;
    case "bigint":
      lines.push(`${pad}let ${target} = __hashBigInt(${value});`);
      return;
    case "date":
      lines.push(`${pad}let ${target} = __hashNumber(${value}.getTime());`);
      return;
    case "null":
      lines.push(`${pad}let ${target} = 1;`);
      return;
    case "undefined":
    case "void":
      lines.push(`${pad}let ${target} = 0;`);
      return;
    case "literal":
    case "enum":
    case "any":
    case "unknown":
    case "never":
    case "symbol":
    case "file":
    case "regex":
      lines.push(`${pad}let ${target} = __hashUnknown(${value});`);
      return;
    case "optional":
      lines.push(`${pad}let ${target};`);
      lines.push(`${pad}if (${value} === undefined) {`);
      lines.push(`${pad}  ${target} = 0;`);
      lines.push(`${pad}} else {`);
      emitHashInto(lines, schema.def.innerType, value, next, depth + 1);
      lines.push(`${pad}  ${target} = ${next};`);
      lines.push(`${pad}}`);
      return;
    case "nullable":
      lines.push(`${pad}let ${target};`);
      lines.push(`${pad}if (${value} === null) {`);
      lines.push(`${pad}  ${target} = 1;`);
      lines.push(`${pad}} else {`);
      emitHashInto(lines, schema.def.innerType, value, next, depth + 1);
      lines.push(`${pad}  ${target} = ${next};`);
      lines.push(`${pad}}`);
      return;
    case "nullish":
      lines.push(`${pad}let ${target};`);
      lines.push(`${pad}if (${value} == null) {`);
      lines.push(`${pad}  ${target} = ${value} === null ? 1 : 0;`);
      lines.push(`${pad}} else {`);
      emitHashInto(lines, schema.def.innerType, value, next, depth + 1);
      lines.push(`${pad}  ${target} = ${next};`);
      lines.push(`${pad}}`);
      return;
    case "readonly":
    case "default":
    case "brand":
    case "transform":
    case "pipe":
    case "coerce":
    case "refine":
      emitHashInto(lines, schema.def.innerType, value, target, depth);
      return;
    case "array": {
      lines.push(`${pad}let ${target} = ${schema.type === "array" ? "17" : "0"};`);
      lines.push(`${pad}for (let i = 0, len = ${value}.length; i < len; i++) {`);
      emitHashInto(lines, schema.def.element, `${value}[i]`, next, depth + 1);
      lines.push(`${pad}  ${target} = __combineHash(${target}, ${next});`);
      lines.push(`${pad}}`);
      return;
    }
    case "object": {
      lines.push(`${pad}let ${target} = 23;`);
      const props = schema.def.props;
      for (const key of Object.keys(props)) {
        lines.push(`${pad}{`);
        emitHashInto(lines, props[key], emitDefaultedValue(props[key], emitPropertyAccess(value, key)), next, depth);
        lines.push(`${pad}  ${target} = __combineHash(${target}, ${next});`);
        lines.push(`${pad}}`);
      }
      return;
    }
    default:
      lines.push(`${pad}let ${target} = __hashUnknown(${value});`);
      return;
  }
}

// ../../packages/jit/src/core/hints/hint-merge.ts
function mergeHints(left, right) {
  if (!left) return right ?? {};
  if (!right) return left;
  const collection = mergeCollection(left.collection, right.collection);
  const entity = right.entity ?? left.entity;
  const index = right.index ?? left.index;
  const order = right.order ?? left.order;
  const compare = mergeOptional(left.compare, right.compare);
  const clone3 = mergeOptional(left.clone, right.clone);
  const hash4 = mergeOptional(left.hash, right.hash);
  const diff3 = mergeOptional(left.diff, right.diff);
  const serialize = mergeOptional(left.serialize, right.serialize);
  return {
    ...entity ? { entity } : {},
    ...index ? { index } : {},
    ...order ? { order } : {},
    ...collection ? { collection } : {},
    ...compare ? { compare } : {},
    ...clone3 ? { clone: clone3 } : {},
    ...hash4 ? { hash: hash4 } : {},
    ...diff3 ? { diff: diff3 } : {},
    ...serialize ? { serialize } : {}
  };
}
function mergeOptional(left, right) {
  if (!left) return right;
  if (!right) return left;
  return {
    ...left,
    ...right
  };
}
function mergeCollection(left, right) {
  if (!left) return right;
  if (!right) return left;
  const ordered = left.ordered || right.ordered ? {
    ...left.ordered,
    ...right.ordered
  } : void 0;
  return {
    ...left,
    ...right,
    ...ordered ? { ordered } : {}
  };
}

// ../../packages/jit/src/core/hints/hint-resolver.ts
function resolveHints(schema) {
  let current = schema;
  let hints = {};
  while (current) {
    const annotations = current.annotations;
    hints = mergeHints(annotations?.hints, hints);
    current = innerSchema(current);
  }
  if (hints.order && !hints.order.key && typeof hints.collection?.identify === "string") {
    hints = mergeHints(hints, {
      order: {
        ...hints.order,
        key: hints.collection.identify
      }
    });
  }
  return hints;
}
function innerSchema(schema) {
  if (schema.type === "optional" || schema.type === "nullable" || schema.type === "nullish" || schema.type === "readonly" || schema.type === "promise" || schema.type === "default" || schema.type === "brand" || schema.type === "transform" || schema.type === "pipe" || schema.type === "refine" || schema.type === "coerce") {
    return schema.def.innerType;
  }
  if (schema.type === "lazy") return schema.def.getter();
  return void 0;
}

// ../../packages/jit/src/core/hints/hint-schema.ts
function attachHint(schema, hints) {
  const annotations = schema.annotations ?? {};
  return {
    type: schema.type,
    _type: null,
    def: schema.def,
    annotations: {
      ...annotations,
      hints: mergeHints(annotations.hints, hints)
    }
  };
}

// ../../packages/jit/src/compiler/resolvers/resolve-hints.ts
function resolveCompilerHints(schema) {
  const resolved = resolveWrappers(schema);
  return {
    base: resolved.base,
    hints: resolveHints(schema)
  };
}
function resolveHintKey(key) {
  if (typeof key === "string") return key;
  if (Array.isArray(key) && key.length === 1 && typeof key[0] === "string") return key[0];
  return void 0;
}

// ../../packages/jit/src/compiler/strategy/resolve-strategy.ts
function resolveEqualStrategy(schema) {
  const { base, hints } = resolveCompilerHints(schema);
  const identifyKey = resolveHintKey(hints.index?.key ?? hints.collection?.identify);
  const entityKey = resolveHintKey(hints.entity?.key);
  const key = identifyKey ?? entityKey;
  const ordered = hints.order ?? hints.collection?.ordered;
  if (ordered && !key) {
    throw new JITError("INVALID_OPERATION", "ordered() requires a string key for compiler strategies");
  }
  return {
    type: "equal",
    array: base.type === "array" && ordered && key ? { type: "binary-search", key, direction: resolveDirection(ordered.direction) } : base.type === "array" && (hints.index || hints.collection?.indexed === true) && key ? { type: "map", key } : { type: "loop" },
    hash: hints.hash ? { type: "hash-short-circuit", strategy: hints.hash.strategy } : { type: "none" }
  };
}
function resolveDirection(direction) {
  return direction === "asc" || direction === "desc" ? direction : void 0;
}

// ../../packages/jit/src/compiler/ir/scope.ts
var Scope = class {
  #counts = /* @__PURE__ */ new Map();
  #names = /* @__PURE__ */ new Set();
  createVar(prefix) {
    const safePrefix = prefix.replace(/[^$_a-zA-Z0-9]/g, "_").replace(/^[^$_a-zA-Z]/, "_") || "_";
    let next = this.#counts.get(safePrefix) ?? 0;
    let name = next === 0 ? safePrefix : `${safePrefix}${next}`;
    while (this.#names.has(name)) {
      next++;
      name = `${safePrefix}${next}`;
    }
    this.#counts.set(safePrefix, next + 1);
    this.#names.add(name);
    return irVar(name);
  }
};

// ../../packages/jit/src/compiler/ir/builders/build-equal-ir.ts
function buildEqualIR(schema, strategy = resolveEqualStrategy(schema)) {
  const scope = new Scope();
  const left = irVar("l");
  const right = irVar("r");
  const body = [
    { kind: "if", test: strictEqual(left, right), then: [{ kind: "return", value: literal(true) }] }
  ];
  if (strategy.hash.type === "hash-short-circuit") {
    body.push({
      kind: "hash_compare",
      leftHash: call(irVar("__hash"), [left]),
      rightHash: call(irVar("__hash"), [right])
    });
  }
  appendSchemaCompare(body, schema, left, right, scope, strategy);
  body.push({ kind: "return", value: literal(true) });
  return {
    kind: "program",
    params: [left, right],
    body
  };
}
function appendSchemaCompare(body, schema, left, right, scope, strategy) {
  const resolved = resolveWrappers(schema);
  if (resolved.optional || resolved.nullable) {
    appendResolvedWrapperCompare(body, resolved, left, right, scope, strategy);
    return;
  }
  const base = resolved.base;
  switch (base.type) {
    case TypeName.any:
    case TypeName.unknown:
    case TypeName.never:
    case TypeName.void:
    case TypeName.undefined:
    case TypeName.literal:
    case TypeName.enum:
    case TypeName.file:
      appendCompareOrFail(body, sameValue(left, right));
      return;
    case TypeName.nan:
    case TypeName.int:
    case TypeName.number:
      appendCompareOrFail(body, sameNumber(left, right));
      return;
    case TypeName.null:
    case TypeName.symbol:
    case TypeName.boolean:
    case TypeName.bigint:
    case TypeName.string:
      appendCompareOrFail(body, strictEqual(left, right));
      return;
    case TypeName.date:
      appendCompareOrFail(body, sameValue(call(loadProp(left, "getTime")), call(loadProp(right, "getTime"))));
      return;
    case TypeName.array:
      appendArrayCompare(body, base, left, right, scope, strategy);
      return;
    case TypeName.object:
      appendObjectCompare(body, base, left, right, scope);
      return;
    case TypeName.union:
      appendUnionCompare(body, base, left, right, scope, strategy);
      return;
    case TypeName.intersection:
      appendIntersectionCompare(body, base, left, right, scope, strategy);
      return;
    case TypeName.discriminatedUnion:
      appendDiscriminatedUnionCompare(body, base, left, right, scope, strategy);
      return;
    default:
      throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler equal IR for type: ${base.type}`);
  }
}
function appendCompareOrFail(body, expr) {
  body.push({ kind: "if", test: not(expr), then: [{ kind: "return", value: literal(false) }] });
}
function appendResolvedWrapperCompare(body, resolved, left, right, scope, strategy) {
  const inner = [];
  if (resolved.optional) {
    inner.push({
      kind: "if",
      test: orCompare(strictEqual(left, literal(void 0)), strictEqual(right, literal(void 0))),
      then: [{ kind: "return", value: literal(false) }]
    });
  }
  if (resolved.nullable) {
    inner.push({
      kind: "if",
      test: orCompare(strictEqual(left, literal(null)), strictEqual(right, literal(null))),
      then: [{ kind: "return", value: literal(false) }]
    });
  }
  appendSchemaCompare(inner, resolved.base, left, right, scope, strategy);
  body.push({ kind: "if", test: not(sameValue(left, right)), then: inner });
}
function appendArrayCompare(body, schema, left, right, scope, strategy) {
  const len = scope.createVar("len");
  const ix = scope.createVar("i");
  const leftItem = scope.createVar("li");
  const rightItem = scope.createVar("ri");
  const loopBody = [
    { kind: "assign", target: leftItem, expr: loadIndex(left, ix) },
    { kind: "assign", target: rightItem, expr: loadIndex(right, ix) }
  ];
  appendSchemaCompare(loopBody, schema.def.element, leftItem, rightItem, scope, strategy);
  if (strategy.array.type === "map") {
    body.push({
      kind: "map_equal",
      left,
      right,
      key: strategy.array.key,
      length: len,
      index: ix,
      leftItem,
      rightItem,
      rightIndex: scope.createVar("rightIndex"),
      body: loopBody.slice(2)
    });
    return;
  }
  if (strategy.array.type === "binary-search") {
    body.push({
      kind: "binary_search_equal",
      left,
      right,
      key: strategy.array.key,
      length: len,
      index: ix,
      leftItem,
      rightItem,
      searchLow: scope.createVar("low"),
      searchHigh: scope.createVar("high"),
      searchMid: scope.createVar("mid"),
      found: scope.createVar("found"),
      direction: strategy.array.direction,
      body: loopBody.slice(2)
    });
    return;
  }
  body.push(
    { kind: "assign", target: len, expr: loadProp(left, "length") },
    {
      kind: "if",
      test: notStrictEqual(len, loadProp(right, "length")),
      then: [{ kind: "return", value: literal(false) }]
    },
    { kind: "for", index: ix, from: len, body: loopBody }
  );
}
function appendObjectCompare(body, schema, left, right, scope) {
  const props = schema.def.props;
  for (const key of Object.keys(props)) {
    const prop = props[key];
    const leftProp = loadProp(left, key);
    const rightProp = loadProp(right, key);
    const defaultExpr = staticDefaultIRExpr(prop);
    let leftValue = leftProp;
    let rightValue = rightProp;
    if (defaultExpr || shouldHoistObjectProp(prop)) {
      const leftVar = scope.createVar(`l_${key}`);
      const rightVar = scope.createVar(`r_${key}`);
      body.push(
        defaultExpr ? letDecl(leftVar, leftProp) : { kind: "assign", target: leftVar, expr: leftProp },
        defaultExpr ? letDecl(rightVar, rightProp) : { kind: "assign", target: rightVar, expr: rightProp }
      );
      if (defaultExpr) {
        body.push(
          { kind: "if", test: strictEqual(leftVar, literal(void 0)), then: [store(leftVar, defaultExpr)] },
          { kind: "if", test: strictEqual(rightVar, literal(void 0)), then: [store(rightVar, defaultExpr)] }
        );
      }
      leftValue = leftVar;
      rightValue = rightVar;
    }
    appendSchemaCompare(body, prop, leftValue, rightValue, scope, {
      type: "equal",
      array: { type: "loop" },
      hash: { type: "none" }
    });
  }
}
function shouldHoistObjectProp(schema) {
  const resolved = resolveWrappers(schema).base;
  return resolved.type === TypeName.object || resolved.type === TypeName.array;
}
function appendUnionCompare(body, schema, left, right, scope, strategy) {
  const options = schema.def.options;
  const branches = [];
  if (options.every(isAtomicEqualSchema)) {
    appendCompareOrFail(body, sameNumber(left, right));
    return;
  }
  for (const option of options) {
    const then = [
      { kind: "if", test: not(schemaGuard(option, right)), then: [{ kind: "return", value: literal(false) }] }
    ];
    appendSchemaCompare(then, option, left, right, scope, strategy);
    then.push({ kind: "return", value: literal(true) });
    branches.push({ kind: "if", test: schemaGuard(option, left), then });
  }
  body.push(...branches, { kind: "return", value: literal(false) });
}
function isAtomicEqualSchema(schema) {
  const base = resolveWrappers(schema).base;
  return isPrimitiveLikeSchema(base) && base.type !== TypeName.regex && base.type !== TypeName.instanceof;
}
function appendIntersectionCompare(body, schema, left, right, scope, strategy) {
  const options = schema.def.options;
  for (const option of options) {
    appendSchemaCompare(body, option, left, right, scope, strategy);
  }
}
function appendDiscriminatedUnionCompare(body, schema, left, right, scope, strategy) {
  const discriminator = schema.def.discriminator;
  const leftTag = loadProp(left, discriminator);
  const rightTag = loadProp(right, discriminator);
  const options = schema.def.options;
  for (const option of options) {
    const tag = literalDiscriminatorValue(option, discriminator);
    if (tag === void 0) continue;
    const then = [
      { kind: "if", test: notStrictEqual(rightTag, literal(tag)), then: [{ kind: "return", value: literal(false) }] }
    ];
    appendSchemaCompare(then, option, left, right, scope, strategy);
    then.push({ kind: "return", value: literal(true) });
    body.push({ kind: "if", test: strictEqual(leftTag, literal(tag)), then });
  }
  body.push({ kind: "return", value: literal(false) });
}
function orCompare(left, right) {
  return { kind: "binary", op: "or", left, right };
}

// ../../packages/jit/src/compiler/ir/optimizer/cost/optimize-cost.ts
function optimizeCost(program) {
  return { ...program, body: optimizeNodes(program.body) };
}
function optimizeNodes(nodes) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > 0) {
      out.push(...run.sort((left, right) => nodeCost(left) - nodeCost(right)));
      run = [];
    }
  };
  for (const node of nodes) {
    if (isPureFailureCheck(node)) {
      run.push(node);
      continue;
    }
    flush();
    if (node.kind === "if") {
      out.push({
        ...node,
        then: optimizeNodes(node.then),
        ...node.otherwise ? { otherwise: optimizeNodes(node.otherwise) } : {}
      });
      continue;
    }
    if (node.kind === "for") {
      out.push({ ...node, body: optimizeNodes(node.body) });
      continue;
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: optimizeNodes(node.body) });
      continue;
    }
    out.push(node);
  }
  flush();
  return out;
}
function isPureFailureCheck(node) {
  return node.kind === "if" && node.then.length === 1 && node.then[0].kind === "return" && node.then[0].value.kind === "literal" && node.then[0].value.value === false && isPureExpr(node.test);
}
function isPureExpr(expr) {
  switch (expr.kind) {
    case "var":
    case "literal":
      return true;
    case "not":
      return isPureExpr(expr.expr);
    case "binary":
    case "sameValue":
      return isPureExpr(expr.left) && isPureExpr(expr.right);
    case "sameNumber":
      return false;
    case "nary":
      return expr.operands.every(isPureExpr);
    case "schema_guard":
      return isPureExpr(expr.value);
    case "load_prop":
      return isPureExpr(expr.base);
    case "load_index":
      return isPureExpr(expr.base) && isPureExpr(expr.index);
    case "call":
    case "object_literal":
    case "array_literal":
    case "construct":
      return false;
  }
}
function nodeCost(node) {
  return node.kind === "if" ? exprCost(node.test) : 0;
}
function exprCost(expr) {
  switch (expr.kind) {
    case "literal":
    case "var":
      return 1;
    case "load_prop":
      return 2 + exprCost(expr.base);
    case "load_index":
      return 4 + exprCost(expr.base) + exprCost(expr.index);
    case "not":
      return exprCost(expr.expr);
    case "binary":
    case "sameValue":
      return 1 + exprCost(expr.left) + exprCost(expr.right);
    case "sameNumber":
      return 20;
    case "nary":
      return 1 + expr.operands.reduce((total, operand) => total + exprCost(operand), 0);
    case "schema_guard":
      return 10 + exprCost(expr.value);
    case "call":
      return 100;
    case "object_literal":
    case "array_literal":
    case "construct":
      return 50;
  }
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/dedupe-loads.ts
function dedupeLoads(program) {
  return { ...program, body: dedupeNodes(program.body, /* @__PURE__ */ new Map()) };
}
function dedupeNodes(nodes, loads) {
  const out = [];
  for (const node of nodes) {
    if (node.kind === "assign" && (node.expr.kind === "load_prop" || node.expr.kind === "load_index")) {
      const key = loadKey(node.expr);
      if (key) {
        const existing = loads.get(key);
        if (existing) {
          out.push({ ...node, expr: existing });
          continue;
        }
        loads.set(key, node.target);
      }
    }
    if (node.kind === "if") {
      const next = {
        ...node,
        then: dedupeNodes(node.then, new Map(loads)),
        ...node.otherwise ? { otherwise: dedupeNodes(node.otherwise, new Map(loads)) } : {}
      };
      out.push(next);
      continue;
    }
    if (node.kind === "for") {
      out.push({ ...node, body: dedupeNodes(node.body, /* @__PURE__ */ new Map()) });
      continue;
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: dedupeNodes(node.body, /* @__PURE__ */ new Map()) });
      continue;
    }
    out.push(node);
  }
  return out;
}
function loadKey(expr) {
  if (expr.kind === "load_prop") return `${exprKey(expr.base)}.${expr.key}`;
  if (expr.kind === "load_index") return `${exprKey(expr.base)}[${exprKey(expr.index)}]`;
  return void 0;
}
function exprKey(expr) {
  switch (expr.kind) {
    case "var":
      return expr.name;
    case "literal":
      return String(expr.value);
    case "load_prop":
      return `${exprKey(expr.base)}.${expr.key}`;
    case "load_index":
      return `${exprKey(expr.base)}[${exprKey(expr.index)}]`;
    case "schema_guard":
      return `guard(${exprKey(expr.value)})`;
    default:
      return expr.kind;
  }
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/eliminate-dead.ts
function eliminateDead(program) {
  return { ...program, body: eliminateNodes(program.body) };
}
function eliminateNodes(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.kind === "if" && isAlwaysFalse(node.test)) continue;
    if (node.kind === "if") {
      out.push({
        ...node,
        then: eliminateNodes(node.then),
        ...node.otherwise ? { otherwise: eliminateNodes(node.otherwise) } : {}
      });
      continue;
    }
    if (node.kind === "for") {
      out.push({ ...node, body: eliminateNodes(node.body) });
      continue;
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: eliminateNodes(node.body) });
      continue;
    }
    out.push(node);
  }
  return out;
}
function isAlwaysFalse(expr) {
  return expr.kind === "not" && expr.expr.kind === "literal" && expr.expr.value === true;
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/flatten-blocks.ts
function flattenBlocks(program) {
  return { ...program, body: flattenNodes(program.body) };
}
function flattenNodes(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.kind === "block") {
      out.push(...flattenNodes(node.body));
      continue;
    }
    out.push(mapNodeBodies(node, flattenNodes));
  }
  return out;
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/hoist-array-elements.ts
function hoistArrayElements(program) {
  return { ...program, body: rewriteNodes(program.body) };
}
function rewriteNodes(nodes) {
  return nodes.map((node) => {
    if (node.kind === "for") return { ...node, body: dedupeIndexLoads(node.body, /* @__PURE__ */ new Map()) };
    if (node.kind === "if") {
      return {
        ...node,
        then: rewriteNodes(node.then),
        ...node.otherwise ? { otherwise: rewriteNodes(node.otherwise) } : {}
      };
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal")
      return { ...node, body: rewriteNodes(node.body) };
    return node;
  });
}
function dedupeIndexLoads(nodes, loads) {
  const out = [];
  for (const node of nodes) {
    if (node.kind === "assign" && node.expr.kind === "load_index") {
      const key = `${exprKey2(node.expr.base)}[${exprKey2(node.expr.index)}]`;
      const existing = loads.get(key);
      if (existing) {
        out.push({ ...node, expr: existing });
        continue;
      }
      loads.set(key, node.target);
    }
    out.push(node);
  }
  return out;
}
function exprKey2(expr) {
  switch (expr.kind) {
    case "var":
      return expr.name;
    case "literal":
      return String(expr.value);
    case "load_prop":
      return `${exprKey2(expr.base)}.${expr.key}`;
    case "load_index":
      return `${exprKey2(expr.base)}[${exprKey2(expr.index)}]`;
    case "schema_guard":
      return `guard(${exprKey2(expr.value)})`;
    default:
      return expr.kind;
  }
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/hoist-loads.ts
function hoistLoads(program) {
  const usedNames = new Set(program.params.map((param2) => param2.name));
  collectNodeNames(program.body, usedNames);
  return { ...program, body: hoistNodes(program.body, usedNames) };
}
function hoistNodes(nodes, usedNames) {
  const out = [];
  for (const node of nodes) {
    if (node.kind === "assign") {
      const hoisted = [];
      const expr = hoistExpr(node.expr, hoisted, usedNames);
      out.push(...hoisted, { ...node, expr });
      continue;
    }
    if (node.kind === "if") {
      out.push({
        ...node,
        then: hoistNodes(node.then, usedNames),
        ...node.otherwise ? { otherwise: hoistNodes(node.otherwise, usedNames) } : {}
      });
      continue;
    }
    if (node.kind === "for") {
      out.push({ ...node, body: hoistNodes(node.body, usedNames) });
      continue;
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: hoistNodes(node.body, usedNames) });
      continue;
    }
    out.push(node);
  }
  return out;
}
function hoistExpr(expr, hoisted, usedNames) {
  if (expr.kind === "load_prop" && expr.base.kind === "load_prop") {
    const target = createHoistedVar(expr.base, usedNames);
    hoisted.push({ kind: "assign", target, expr: expr.base });
    return loadProp(target, expr.key);
  }
  return expr;
}
function createHoistedVar(expr, usedNames) {
  let name = loadName(expr);
  let suffix = 1;
  while (usedNames.has(name)) {
    name = `${loadName(expr)}${suffix++}`;
  }
  usedNames.add(name);
  return { kind: "var", name };
}
function loadName(expr) {
  return `${exprName(expr.base)}_${expr.key}`.replace(/[^$_a-zA-Z0-9]/g, "_").replace(/^[^$_a-zA-Z]/, "_");
}
function exprName(expr) {
  if (expr.kind === "var") return expr.name;
  if (expr.kind === "load_prop") return loadName(expr);
  return expr.kind;
}
function collectNodeNames(nodes, names) {
  for (const node of nodes) {
    if (node.kind === "assign") names.add(node.target.name);
    if (node.kind === "if") {
      collectNodeNames(node.then, names);
      if (node.otherwise) collectNodeNames(node.otherwise, names);
    }
    if (node.kind === "for") {
      names.add(node.index.name);
      collectNodeNames(node.body, names);
    }
    if (node.kind === "map_equal") {
      names.add(node.length.name);
      names.add(node.index.name);
      names.add(node.leftItem.name);
      names.add(node.rightItem.name);
      names.add(node.rightIndex.name);
      collectNodeNames(node.body, names);
    }
    if (node.kind === "binary_search_equal") {
      names.add(node.length.name);
      names.add(node.index.name);
      names.add(node.leftItem.name);
      names.add(node.rightItem.name);
      names.add(node.searchLow.name);
      names.add(node.searchHigh.name);
      names.add(node.searchMid.name);
      names.add(node.found.name);
      collectNodeNames(node.body, names);
    }
  }
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/inline-vars.ts
function inlineVars(program) {
  const usages = /* @__PURE__ */ new Map();
  collectUsages(program.body, usages);
  return { ...program, body: inlineNodes(program.body, usages, /* @__PURE__ */ new Map()) };
}
function inlineNodes(nodes, usages, replacements) {
  const out = [];
  const localReplacements = new Map(replacements);
  for (const node of nodes) {
    if (node.kind === "assign") {
      const expr = replaceExpr(node.expr, localReplacements);
      if ((usages.get(node.target.name) ?? 0) === 1 && isInlineSafe(expr)) {
        localReplacements.set(node.target.name, expr);
        continue;
      }
      out.push({ ...node, expr });
      continue;
    }
    if (node.kind === "if") {
      out.push({
        ...node,
        test: replaceExpr(node.test, localReplacements),
        then: inlineNodes(node.then, usages, localReplacements),
        ...node.otherwise ? { otherwise: inlineNodes(node.otherwise, usages, localReplacements) } : {}
      });
      continue;
    }
    if (node.kind === "for") {
      out.push({
        ...node,
        from: replaceExpr(node.from, localReplacements),
        body: inlineNodes(node.body, usages, /* @__PURE__ */ new Map())
      });
      continue;
    }
    if (node.kind === "hash_compare") {
      out.push({
        ...node,
        leftHash: replaceExpr(node.leftHash, localReplacements),
        rightHash: replaceExpr(node.rightHash, localReplacements)
      });
      continue;
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({
        ...node,
        left: replaceExpr(node.left, localReplacements),
        right: replaceExpr(node.right, localReplacements),
        body: inlineNodes(node.body, usages, /* @__PURE__ */ new Map())
      });
      continue;
    }
    if (node.kind === "return") {
      out.push({ ...node, value: replaceExpr(node.value, localReplacements) });
      continue;
    }
    out.push(node);
  }
  return out;
}
function collectUsages(nodes, usages) {
  for (const node of nodes) {
    if (node.kind === "assign") collectExprUsages(node.expr, usages);
    if (node.kind === "if") {
      collectExprUsages(node.test, usages);
      collectUsages(node.then, usages);
      if (node.otherwise) collectUsages(node.otherwise, usages);
    }
    if (node.kind === "for") {
      collectExprUsages(node.from, usages);
      collectUsages(node.body, usages);
    }
    if (node.kind === "hash_compare") {
      collectExprUsages(node.leftHash, usages);
      collectExprUsages(node.rightHash, usages);
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      collectExprUsages(node.left, usages);
      collectExprUsages(node.right, usages);
      collectUsages(node.body, usages);
    }
    if (node.kind === "return") collectExprUsages(node.value, usages);
  }
}
function collectExprUsages(expr, usages) {
  switch (expr.kind) {
    case "var":
      usages.set(expr.name, (usages.get(expr.name) ?? 0) + 1);
      return;
    case "not":
      collectExprUsages(expr.expr, usages);
      return;
    case "binary":
    case "sameValue":
      collectExprUsages(expr.left, usages);
      collectExprUsages(expr.right, usages);
      return;
    case "sameNumber":
      collectExprUsages(expr.left, usages);
      collectExprUsages(expr.right, usages);
      collectExprUsages(expr.left, usages);
      collectExprUsages(expr.right, usages);
      return;
    case "schema_guard":
      collectExprUsages(expr.value, usages);
      return;
    case "load_prop":
      collectExprUsages(expr.base, usages);
      return;
    case "load_index":
      collectExprUsages(expr.base, usages);
      collectExprUsages(expr.index, usages);
      return;
    case "call":
      collectExprUsages(expr.callee, usages);
      for (const arg of expr.args) collectExprUsages(arg, usages);
      return;
    case "nary":
      for (const operand of expr.operands) collectExprUsages(operand, usages);
      return;
    case "object_literal":
      for (const entry of expr.entries) collectExprUsages(entry.value, usages);
      return;
    case "array_literal":
      for (const element of expr.elements) collectExprUsages(element, usages);
      return;
    case "construct":
      for (const arg of expr.args) collectExprUsages(arg, usages);
      return;
    case "literal":
      return;
  }
}
function replaceExpr(expr, replacements) {
  switch (expr.kind) {
    case "var":
      return replacements.get(expr.name) ?? expr;
    case "not":
      return { ...expr, expr: replaceExpr(expr.expr, replacements) };
    case "binary":
    case "sameValue":
    case "sameNumber":
      return { ...expr, left: replaceExpr(expr.left, replacements), right: replaceExpr(expr.right, replacements) };
    case "schema_guard":
      return { ...expr, value: replaceExpr(expr.value, replacements) };
    case "load_prop":
      return { ...expr, base: replaceExpr(expr.base, replacements) };
    case "load_index":
      return { ...expr, base: replaceExpr(expr.base, replacements), index: replaceExpr(expr.index, replacements) };
    case "call":
      return {
        ...expr,
        callee: replaceExpr(expr.callee, replacements),
        args: expr.args.map((arg) => replaceExpr(arg, replacements))
      };
    case "nary":
      return { ...expr, operands: expr.operands.map((operand) => replaceExpr(operand, replacements)) };
    case "object_literal":
      return {
        ...expr,
        entries: expr.entries.map((entry) => ({ ...entry, value: replaceExpr(entry.value, replacements) }))
      };
    case "array_literal":
      return { ...expr, elements: expr.elements.map((element) => replaceExpr(element, replacements)) };
    case "construct":
      return { ...expr, args: expr.args.map((arg) => replaceExpr(arg, replacements)) };
    case "literal":
      return expr;
  }
}
function isInlineSafe(expr) {
  switch (expr.kind) {
    case "var":
    case "literal":
      return true;
    case "load_prop":
      return isInlineSafe(expr.base);
    case "load_index":
      return isInlineSafe(expr.base) && isInlineSafe(expr.index);
    case "not":
      return isInlineSafe(expr.expr);
    case "binary":
    case "sameValue":
    case "sameNumber":
      return isInlineSafe(expr.left) && isInlineSafe(expr.right);
    case "nary":
      return expr.operands.every(isInlineSafe);
    case "schema_guard":
      return isInlineSafe(expr.value);
    case "call":
    case "object_literal":
    case "array_literal":
    case "construct":
      return false;
  }
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/loop-fusion.ts
function loopFusion(program) {
  return { ...program, body: fuseNodes(program.body) };
}
function fuseNodes(nodes) {
  const out = [];
  let ix = 0;
  while (ix < nodes.length) {
    const current = rewriteChildLoops(nodes[ix]);
    const next = nodes[ix + 1] ? rewriteChildLoops(nodes[ix + 1]) : void 0;
    if (current.kind === "for" && next?.kind === "for" && canFuse(current, next)) {
      out.push({ ...current, body: [...current.body, ...next.body] });
      ix += 2;
      continue;
    }
    out.push(current);
    ix++;
  }
  return out;
}
function rewriteChildLoops(node) {
  if (node.kind === "if") {
    return {
      ...node,
      then: fuseNodes(node.then),
      ...node.otherwise ? { otherwise: fuseNodes(node.otherwise) } : {}
    };
  }
  if (node.kind === "for") return { ...node, body: fuseNodes(node.body) };
  return node;
}
function canFuse(left, right) {
  return left.index.name === right.index.name && exprKey3(left.from) === exprKey3(right.from) && !hasControlFlowOrCall(left.body) && !hasControlFlowOrCall(right.body);
}
function hasControlFlowOrCall(nodes) {
  for (const node of nodes) {
    if (node.kind === "return") return true;
    if (node.kind === "assign" && hasCall(node.expr)) return true;
    if (node.kind === "if") return true;
    if (node.kind === "for") return true;
  }
  return false;
}
function hasCall(expr) {
  switch (expr.kind) {
    case "call":
      return true;
    case "not":
      return hasCall(expr.expr);
    case "binary":
    case "sameValue":
    case "sameNumber":
      return hasCall(expr.left) || hasCall(expr.right);
    case "schema_guard":
      return hasCall(expr.value);
    case "load_prop":
      return hasCall(expr.base);
    case "load_index":
      return hasCall(expr.base) || hasCall(expr.index);
    case "nary":
      return expr.operands.some(hasCall);
    case "object_literal":
      return expr.entries.some((entry) => hasCall(entry.value));
    case "array_literal":
      return expr.elements.some(hasCall);
    case "construct":
      return expr.args.some(hasCall);
    case "literal":
    case "var":
      return false;
  }
}
function exprKey3(expr) {
  switch (expr.kind) {
    case "var":
      return expr.name;
    case "literal":
      return String(expr.value);
    case "load_prop":
      return `${exprKey3(expr.base)}.${expr.key}`;
    case "load_index":
      return `${exprKey3(expr.base)}[${exprKey3(expr.index)}]`;
    case "schema_guard":
      return `guard(${exprKey3(expr.value)})`;
    default:
      return expr.kind;
  }
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/loop-hoist.ts
function loopHoist(program) {
  return { ...program, body: hoistLoopInvariants(program.body) };
}
function hoistLoopInvariants(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.kind === "for") {
      const before = [];
      const body = [];
      const loopLocals = collectAssignedNames(node.body);
      for (const child of node.body) {
        if (child.kind === "assign" && !referencesVar(child.expr, node.index.name) && !referencesAny(child.expr, loopLocals)) {
          before.push(child);
          continue;
        }
        body.push(child);
      }
      out.push(...before, { ...node, body: hoistLoopInvariants(body) });
      continue;
    }
    if (node.kind === "if") {
      out.push({
        ...node,
        then: hoistLoopInvariants(node.then),
        ...node.otherwise ? { otherwise: hoistLoopInvariants(node.otherwise) } : {}
      });
      continue;
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: hoistLoopInvariants(node.body) });
      continue;
    }
    out.push(node);
  }
  return out;
}
function collectAssignedNames(nodes) {
  const names = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    if (node.kind === "assign") names.add(node.target.name);
    if (node.kind === "for") {
      names.add(node.index.name);
      for (const name of collectAssignedNames(node.body)) names.add(name);
    }
    if (node.kind === "if") {
      for (const name of collectAssignedNames(node.then)) names.add(name);
      if (node.otherwise) {
        for (const name of collectAssignedNames(node.otherwise)) names.add(name);
      }
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      for (const name of collectAssignedNames(node.body)) names.add(name);
    }
  }
  return names;
}
function referencesAny(expr, names) {
  for (const name of names) {
    if (referencesVar(expr, name)) return true;
  }
  return false;
}
function referencesVar(expr, name) {
  switch (expr.kind) {
    case "var":
      return expr.name === name;
    case "not":
      return referencesVar(expr.expr, name);
    case "binary":
    case "sameValue":
    case "sameNumber":
      return referencesVar(expr.left, name) || referencesVar(expr.right, name);
    case "schema_guard":
      return referencesVar(expr.value, name);
    case "load_prop":
      return referencesVar(expr.base, name);
    case "load_index":
      return referencesVar(expr.base, name) || referencesVar(expr.index, name);
    case "call":
      return referencesVar(expr.callee, name) || expr.args.some((arg) => referencesVar(arg, name));
    case "nary":
      return expr.operands.some((operand) => referencesVar(operand, name));
    case "object_literal":
      return expr.entries.some((entry) => referencesVar(entry.value, name));
    case "array_literal":
      return expr.elements.some((element) => referencesVar(element, name));
    case "construct":
      return expr.args.some((arg) => referencesVar(arg, name));
    case "literal":
      return false;
  }
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/loop-simplify.ts
function loopSimplify(program) {
  return { ...program, body: simplifyNodes(program.body) };
}
function simplifyNodes(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.kind === "if") {
      const then = simplifyNodes(node.then);
      const otherwise = node.otherwise ? simplifyNodes(node.otherwise) : void 0;
      if (then.length === 0 && (!otherwise || otherwise.length === 0)) continue;
      out.push({ ...node, then, ...otherwise && otherwise.length > 0 ? { otherwise } : {} });
      continue;
    }
    if (node.kind === "for") {
      const body = simplifyNodes(node.body);
      if (body.length === 0) continue;
      out.push({ ...node, body });
      continue;
    }
    if (node.kind === "block") {
      out.push(...simplifyNodes(node.body));
      continue;
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: simplifyNodes(node.body) });
      continue;
    }
    out.push(node);
  }
  return out;
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/normalize-logic.ts
function normalizeLogic(program) {
  return { ...program, body: normalizeNodes(program.body) };
}
function normalizeNodes(nodes) {
  return nodes.map((node) => mapNodeExprs(mapNodeBodies(node, normalizeNodes), normalizeExpr));
}
function normalizeExpr(expr) {
  const next = mapExprChildren(expr, normalizeExpr);
  if (next.kind === "not") return normalizeNot(next.expr);
  if (next.kind === "nary") return normalizeNary(next);
  if (next.kind === "binary" && next.left.kind === "literal" && next.right.kind === "literal") {
    return foldComparison(next.op, next.left.value, next.right.value) ?? next;
  }
  return next;
}
function foldComparison(op, left, right) {
  switch (op) {
    case "strictEqual":
      return literal(left === right);
    case "notStrictEqual":
      return literal(left !== right);
    case "greaterThan":
      return literal(left > right);
    case "greaterThanOrEqual":
      return literal(left >= right);
    case "lessThan":
      return literal(left < right);
    case "lessThanOrEqual":
      return literal(left <= right);
    default:
      return void 0;
  }
}
function normalizeNot(inner) {
  if (inner.kind === "not") return inner.expr;
  if (inner.kind === "literal" && typeof inner.value === "boolean") return literal(!inner.value);
  if (inner.kind === "binary" && inner.op === "strictEqual") return { ...inner, op: "notStrictEqual" };
  if (inner.kind === "binary" && inner.op === "notStrictEqual") return { ...inner, op: "strictEqual" };
  if (inner.kind === "nary") {
    return normalizeNary({
      kind: "nary",
      op: inner.op === "and" ? "or" : "and",
      operands: inner.operands.map((operand) => normalizeExpr(not(operand)))
    });
  }
  return not(inner);
}
function normalizeNary(expr) {
  const absorbing = expr.op !== "and";
  const neutral = !absorbing;
  const operands = [];
  const seen = /* @__PURE__ */ new Set();
  for (const operand of flattenOperands(expr.op, expr.operands)) {
    if (operand.kind === "literal" && typeof operand.value === "boolean") {
      if (operand.value === absorbing) return literal(absorbing);
      continue;
    }
    const key = exprKey4(operand);
    if (seen.has(key)) continue;
    seen.add(key);
    operands.push(operand);
  }
  if (operands.length === 0) return literal(neutral);
  return { ...expr, operands };
}
function flattenOperands(op, operands) {
  const out = [];
  for (const operand of operands) {
    if (operand.kind === "nary" && operand.op === op) {
      out.push(...flattenOperands(op, operand.operands));
      continue;
    }
    out.push(operand);
  }
  return out;
}
var opaqueKeys = /* @__PURE__ */ new WeakMap();
var opaqueKeyCounter = 0;
function opaqueKey(value) {
  let key = opaqueKeys.get(value);
  if (key === void 0) {
    key = ++opaqueKeyCounter;
    opaqueKeys.set(value, key);
  }
  return key;
}
function exprKey4(expr) {
  switch (expr.kind) {
    case "var":
      return `v:${expr.name}`;
    case "literal":
      return `l:${typeof expr.value}:${String(expr.value)}`;
    case "not":
      return `!(${exprKey4(expr.expr)})`;
    case "binary":
      return `b:${expr.op}(${exprKey4(expr.left)},${exprKey4(expr.right)})`;
    case "nary":
      return `n:${expr.op}(${expr.operands.map(exprKey4).join(",")})`;
    case "sameValue":
      return `sv(${exprKey4(expr.left)},${exprKey4(expr.right)})`;
    case "sameNumber":
      return `sn(${exprKey4(expr.left)},${exprKey4(expr.right)})`;
    case "schema_guard":
      return `g${opaqueKey(expr.schema)}(${exprKey4(expr.value)})`;
    case "load_prop":
      return `${exprKey4(expr.base)}.${expr.key}`;
    case "load_index":
      return `${exprKey4(expr.base)}[${exprKey4(expr.index)}]`;
    case "call":
      return `c:${exprKey4(expr.callee)}(${expr.args.map(exprKey4).join(",")})`;
    case "object_literal":
      return `o{${expr.entries.map((entry) => `${entry.key}:${exprKey4(entry.value)}`).join(",")}}`;
    case "array_literal":
      return `a[${expr.elements.map(exprKey4).join(",")}]`;
    case "construct":
      return `new:${expr.ctor}(${expr.args.map(exprKey4).join(",")})`;
  }
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/reorder-compares.ts
function reorderCompares(program) {
  return { ...program, body: reorderNodes(program.body) };
}
function reorderNodes(nodes) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > 0) {
      out.push(...run.sort((left, right) => compareCost(left) - compareCost(right)));
      run = [];
    }
  };
  for (const node of nodes) {
    if (isPureCompareReturn(node)) {
      run.push(node);
      continue;
    }
    flush();
    if (node.kind === "if") {
      out.push({
        ...node,
        then: reorderNodes(node.then),
        ...node.otherwise ? { otherwise: reorderNodes(node.otherwise) } : {}
      });
      continue;
    }
    if (node.kind === "for") {
      out.push({ ...node, body: reorderNodes(node.body) });
      continue;
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: reorderNodes(node.body) });
      continue;
    }
    out.push(node);
  }
  flush();
  return out;
}
function isPureCompareReturn(node) {
  return node.kind === "if" && node.then.length === 1 && node.then[0].kind === "return" && node.then[0].value.kind === "literal" && node.then[0].value.value === false && isPureExpr2(node.test);
}
function isPureExpr2(expr) {
  switch (expr.kind) {
    case "var":
    case "literal":
      return true;
    case "not":
      return isPureExpr2(expr.expr);
    case "binary":
    case "sameValue":
    case "sameNumber":
      return isPureExpr2(expr.left) && isPureExpr2(expr.right);
    case "nary":
      return expr.operands.every(isPureExpr2);
    case "schema_guard":
      return isPureExpr2(expr.value);
    case "load_prop":
      return isPureExpr2(expr.base);
    case "load_index":
      return isPureExpr2(expr.base) && isPureExpr2(expr.index);
    case "call":
    case "object_literal":
    case "array_literal":
    case "construct":
      return false;
  }
}
function compareCost(node) {
  return node.kind === "if" ? exprCost2(node.test) : 0;
}
function exprCost2(expr) {
  switch (expr.kind) {
    case "literal":
    case "var":
      return 1;
    case "load_prop":
    case "load_index":
      return 2 + exprCost2(expr.base);
    case "not":
      return exprCost2(expr.expr);
    case "binary":
    case "sameValue":
    case "sameNumber":
      return 1 + exprCost2(expr.left) + exprCost2(expr.right);
    case "nary":
      return 1 + expr.operands.reduce((total, operand) => total + exprCost2(operand), 0);
    case "schema_guard":
      return 10 + exprCost2(expr.value);
    case "call":
      return 100;
    case "object_literal":
    case "array_literal":
    case "construct":
      return 50;
  }
}

// ../../packages/jit/src/compiler/ir/optimizer/cost/expr-cost.ts
function exprCost3(expr) {
  switch (expr.kind) {
    case "literal":
    case "var":
      return 1;
    case "load_prop":
      return 2 + exprCost3(expr.base);
    case "load_index":
      return 4 + exprCost3(expr.base) + exprCost3(expr.index);
    case "not":
      return exprCost3(expr.expr);
    case "binary":
    case "sameValue":
      return 1 + exprCost3(expr.left) + exprCost3(expr.right);
    case "sameNumber":
      return 20;
    case "nary":
      return 1 + expr.operands.reduce((total, operand) => total + exprCost3(operand), 0);
    case "schema_guard":
      return 10 + exprCost3(expr.value);
    case "call":
      return 100;
    case "object_literal":
    case "array_literal":
    case "construct":
      return 50;
  }
}

// ../../packages/jit/src/compiler/ir/optimizer/passes/reorder-conditions.ts
function reorderConditions(program) {
  return { ...program, body: reorderNodes2(program.body) };
}
function reorderNodes2(nodes) {
  return nodes.map((node) => mapNodeExprs(mapNodeBodies(node, reorderNodes2), reorderExpr));
}
function reorderExpr(expr) {
  const next = mapExprChildren(expr, reorderExpr);
  if (next.kind !== "nary" || next.operands.length < 2) return next;
  const ranked = next.operands.map((operand, index) => ({ operand, index, cost: exprCost3(operand) }));
  ranked.sort((left, right) => left.cost - right.cost || left.index - right.index);
  return { ...next, operands: ranked.map((entry) => entry.operand) };
}

// ../../packages/jit/src/compiler/ir/optimizer/optimize-ir.ts
var optimizeEqualIRPasses = [
  flattenBlocks,
  dedupeLoads,
  hoistLoads,
  loopFusion,
  loopHoist,
  hoistArrayElements,
  loopSimplify,
  eliminateDead,
  optimizeCost,
  inlineVars,
  reorderCompares
];
function optimizeIRWith(program, passes) {
  let next = program;
  for (const pass of passes) {
    next = pass(next);
  }
  return next;
}
function optimizeIR(program) {
  return optimizeIRWith(program, optimizeEqualIRPasses);
}
var optimizeQueryIRPasses = [flattenBlocks, normalizeLogic, reorderConditions];
function optimizeQueryIR(program) {
  return optimizeIRWith(program, optimizeQueryIRPasses);
}

// ../../packages/jit/src/compiler/equal.ts
function emitEqualSource(schema) {
  const strategy = resolveEqualStrategy(schema);
  return emitEqual(optimizeIR(buildEqualIR(schema, strategy)));
}
function compileEqual(schema, options) {
  return getCompileCached(
    schema,
    "equal",
    () => {
      const strategy = resolveEqualStrategy(schema);
      const program = optimizeIR(buildEqualIR(schema, strategy));
      const body = emitEqualBody(program);
      const hash4 = strategy.hash.type === "hash-short-circuit" ? compileHash(schema, options) : void 0;
      const compiled = globalThis.Function(
        "__hash",
        "__getIndex",
        `return function equal(l, r) {
${body}
};`
      )(hash4, getIndex);
      registerArtifact(compiled, {
        kind: "operation",
        schema,
        op: "equal"
      });
      return compiled;
    },
    options
  );
}

// ../../packages/jit/src/compiler/source/format-mask.ts
function countFormatPlaceholders(pattern) {
  let count = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (pattern.charCodeAt(index) === 35) count++;
  }
  return count;
}
function emitFormatMaskExpression(value, pattern) {
  const parts = [];
  let cursor = 0;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    parts.push(character === "#" ? `${value}[${cursor++}]` : emitLiteral(character));
  }
  return parts.length === 0 ? '""' : parts.join(" + ");
}
function emitStrictFormatCondition(value, pattern) {
  const checks = [`${value}.length !== ${pattern.length}`];
  for (let index = 0; index < pattern.length; index++) {
    const code = pattern.charCodeAt(index);
    checks.push(
      code === 35 ? `(${value}.charCodeAt(${index}) < 48 || ${value}.charCodeAt(${index}) > 57)` : `${value}.charCodeAt(${index}) !== ${code}`
    );
  }
  return checks.join(" || ");
}

// ../../packages/jit/src/compiler/format.ts
function emitFormatSource(schema) {
  if (schema.type !== TypeName.string) {
    throw new JITError("UNSUPPORTED_SCHEMA", "format compilation requires a string schema");
  }
  const checks = schema.def.checks ?? [];
  const selected = checks.filter((check) => check.kind === "format" || check.kind === "phoneBR");
  if (selected.length === 0) {
    throw new JITError("UNSUPPORTED_SCHEMA", "format compilation requires .format(), .cpf(), .cnpj(), or .phoneBR()");
  }
  const lines = [
    "function format(value) {",
    '  if (typeof value !== "string") throw new TypeError("format expects a string");',
    "  let output = value;"
  ];
  for (const check of selected) {
    if (check.kind === "phoneBR") {
      lines.push('  output = output.replace(/\\D+/g, "");');
      lines.push(
        '  if (output.length !== 10 && output.length !== 11) throw new RangeError("format expected 10 or 11 digits");'
      );
      lines.push(
        `  output = output.length === 10 ? ${emitFormatMaskExpression("output", "(##) ####-####")} : ${emitFormatMaskExpression("output", "(##) #####-####")};`
      );
      continue;
    }
    const spec = check.value;
    if (spec.mode === "strict") {
      lines.push(
        `  if (${emitStrictFormatCondition("output", spec.pattern)}) throw new RangeError(${emitLiteral(`format expected ${spec.pattern}`)});`
      );
      continue;
    }
    const length = countFormatPlaceholders(spec.pattern);
    if (spec.stripNonDigits) lines.push('  output = output.replace(/\\D+/g, "");');
    lines.push(
      `  if (output.length !== ${length}) throw new RangeError(${emitLiteral(`format expected ${length} characters`)});`
    );
    lines.push(`  output = ${emitFormatMaskExpression("output", spec.pattern)};`);
  }
  lines.push("  return output;", "}");
  return lines.join("\n");
}
function compileFormat(schema, options) {
  return getCompileCached(
    schema,
    "format",
    () => {
      const compiled = globalThis.Function(`return (${emitFormatSource(schema)});`)();
      registerArtifact(compiled, { kind: "operation", schema, op: "format" });
      return compiled;
    },
    options
  );
}

// ../../packages/jit/src/compiler/security/emit-scrub.ts
function emitScrub(schema, selector) {
  const writer = new CodeWriter();
  const context = { writer, selector, varCounter: 0 };
  const rewrites = subtreeMatches(schema, selector);
  writer.line("function scrub(value) {");
  writer.indent(() => {
    if (!rewrites) {
      writer.line("return value;");
      return;
    }
    const output = emitScrubExpr(context, schema, "value");
    writer.line(`return ${output};`);
  });
  writer.line("}");
  return { source: writer.toString(), rewrites };
}
function nextVar2(context, prefix) {
  return `${prefix}${++context.varCounter}`;
}
function emitScrubExpr(context, schema, valueExpr) {
  const resolved = resolveScrubWrappers(schema);
  const base = resolved.base;
  const action = context.selector(base);
  const writer = context.writer;
  const guard = (inner) => {
    if (!resolved.optional && !resolved.nullable) return inner(valueExpr);
    const holder = hoist2(context, valueExpr);
    const result = nextVar2(context, "r");
    const presentTest = resolved.optional && resolved.nullable ? `${holder} != null` : resolved.optional ? `${holder} !== undefined` : `${holder} !== null`;
    writer.line(`let ${result} = ${holder};`);
    writer.line(`if (${presentTest}) {`);
    writer.indent(() => {
      writer.line(`${result} = ${inner(holder)};`);
    });
    writer.line("}");
    return result;
  };
  if (action) {
    return guard((source) => {
      const holder = hoist2(context, source);
      return action(holder, writer, (prefix) => nextVar2(context, prefix));
    });
  }
  switch (base.type) {
    case TypeName.object: {
      const props = base.def.props;
      return guard((source) => {
        const holder = hoist2(context, source);
        const entries = Object.keys(props).map((key) => {
          const propExpr = emitPropertyAccess(holder, key);
          const rewritten = subtreeMatches(props[key], context.selector) ? emitScrubExpr(context, props[key], propExpr) : propExpr;
          return `${emitLiteral(key)}: ${rewritten}`;
        });
        return `{ ${entries.join(", ")} }`;
      });
    }
    case TypeName.array: {
      const element = base.def.element;
      return guard((source) => {
        const holder = hoist2(context, source);
        const out = nextVar2(context, "a");
        const index = nextVar2(context, "i");
        const item = nextVar2(context, "e");
        writer.line(`const ${out} = new Array(${holder}.length);`);
        writer.line(`for (let ${index} = 0; ${index} < ${holder}.length; ${index}++) {`);
        writer.indent(() => {
          writer.line(`const ${item} = ${holder}[${index}];`);
          writer.line(`${out}[${index}] = ${emitScrubExpr(context, element, item)};`);
        });
        writer.line("}");
        return out;
      });
    }
    default:
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `scrub compilers support marked fields inside objects and arrays; found ${base.type}`
      );
  }
}
function hoist2(context, expr) {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(expr)) return expr;
  const holder = nextVar2(context, "s");
  context.writer.line(`const ${holder} = ${expr};`);
  return holder;
}
function resolveScrubWrappers(schema) {
  let current = schema;
  let optional3 = false;
  let nullable3 = false;
  while (true) {
    switch (current.type) {
      case TypeName.optional:
        optional3 = true;
        current = current.def.innerType;
        continue;
      case TypeName.nullable:
        nullable3 = true;
        current = current.def.innerType;
        continue;
      case TypeName.nullish:
        optional3 = true;
        nullable3 = true;
        current = current.def.innerType;
        continue;
      case TypeName.default:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType;
        continue;
      case TypeName.lazy:
        current = current.def.getter();
        continue;
      default:
        return { base: current, optional: optional3, nullable: nullable3 };
    }
  }
}
function subtreeMatches(schema, selector) {
  const base = resolveScrubWrappers(schema).base;
  if (selector(base)) return true;
  switch (base.type) {
    case TypeName.object: {
      const props = base.def.props;
      return Object.keys(props).some((key) => subtreeMatches(props[key], selector));
    }
    case TypeName.array:
      return subtreeMatches(base.def.element, selector);
    default:
      return false;
  }
}

// ../../packages/jit/src/compiler/mask.ts
function emitMaskSource(schema) {
  return emitScrub(schema, selectPii).source;
}
function compileMask(schema, options) {
  return getCompileCached(
    schema,
    "mask",
    () => {
      const emitted = emitScrub(schema, selectPii);
      const compiled = globalThis.Function(
        `return ${emitted.source.replace("function scrub", "function mask")};`
      )();
      registerArtifact(compiled, {
        kind: "operation",
        schema,
        op: "mask"
      });
      return compiled;
    },
    options
  );
}
function selectPii(base) {
  const strategy = base.def.pii;
  if (strategy === void 0) return void 0;
  const isString = base.type === TypeName.string;
  const isNumber = base.type === TypeName.number || base.type === TypeName.int;
  if (!isString && !isNumber) {
    throw new JITError("UNSUPPORTED_SCHEMA", `pii masking supports string and number fields; found ${base.type}`);
  }
  switch (strategy) {
    case "redact":
      return () => isString ? '"***"' : "0";
    case "mask":
      return (value) => isString ? `(${value}.length > 4 ? "***" + ${value}.slice(-4) : "***")` : "0";
    case "hash":
      return (value, writer, nextVar4) => {
        if (!isString) return `(Math.imul(2166136261 ^ ${value}, 16777619) >>> 0)`;
        const hash4 = nextVar4("h");
        const index = nextVar4("i");
        writer.line(`let ${hash4} = 2166136261;`);
        writer.line(`for (let ${index} = 0; ${index} < ${value}.length; ${index}++) {`);
        writer.indent(() => {
          writer.line(`${hash4} = Math.imul(${hash4} ^ ${value}.charCodeAt(${index}), 16777619);`);
        });
        writer.line("}");
        return `(${hash4} >>> 0).toString(16)`;
      };
  }
}

// ../../packages/jit/src/compiler/sanitize.ts
var SCRIPT_BLOCK_REGEX = /<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1\s*>/gi;
var HTML_TAG_REGEX = /<[^>]*>/g;
var HTML_TAG_PARTS_REGEX = /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?>/g;
var AMP_REGEX = /&/g;
var LT_REGEX = /</g;
var GT_REGEX = />/g;
var QUOTE_REGEX = /"/g;
var APOSTROPHE_REGEX = /'/g;
var CONTROL_REGEX = new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", "g");
var SQL_IDENTIFIER_REGEX = /^[^A-Za-z_$]+|[^A-Za-z0-9_$]+/g;
var PATH_TRAVERSAL_REGEX = /\.\.+/g;
var PATH_SEGMENT_REGEX = /[\\/:*?"<>|]/g;
var SANITIZE_BINDINGS = [
  "__scriptBlocks",
  "__htmlTags",
  "__htmlTagParts",
  "__amp",
  "__lt",
  "__gt",
  "__quote",
  "__apostrophe",
  "__controls",
  "__sqlIdentifier",
  "__pathTraversal",
  "__pathSegment"
];
var SANITIZE_VALUES = [
  SCRIPT_BLOCK_REGEX,
  HTML_TAG_REGEX,
  HTML_TAG_PARTS_REGEX,
  AMP_REGEX,
  LT_REGEX,
  GT_REGEX,
  QUOTE_REGEX,
  APOSTROPHE_REGEX,
  CONTROL_REGEX,
  SQL_IDENTIFIER_REGEX,
  PATH_TRAVERSAL_REGEX,
  PATH_SEGMENT_REGEX
];
var sanitizeChainBindings = {
  names: SANITIZE_BINDINGS,
  values: SANITIZE_VALUES
};
function emitSanitizeChain(valueExpr, spec = { preset: "text" }, bindRegex) {
  const resolved = resolveSanitizeSpec(spec);
  const regex2 = (pattern) => bindRegex?.(pattern) ?? staticRegexReference(pattern);
  let output = valueExpr;
  if (resolved.normalize) output = `${output}.normalize(${emitLiteral(resolved.normalize)})`;
  if (resolved.html === "strip") {
    output = `${output}.replace(${regex2(SCRIPT_BLOCK_REGEX)}, "").replace(${regex2(HTML_TAG_REGEX)}, "").replace(${regex2(LT_REGEX)}, "&lt;").replace(${regex2(GT_REGEX)}, "&gt;")`;
  } else if (resolved.html === "escape") {
    output = `${output}.replace(${regex2(AMP_REGEX)}, "&amp;").replace(${regex2(LT_REGEX)}, "&lt;").replace(${regex2(GT_REGEX)}, "&gt;").replace(${regex2(QUOTE_REGEX)}, "&quot;").replace(${regex2(APOSTROPHE_REGEX)}, "&#39;")`;
  } else if (typeof resolved.html === "object") {
    const conditions = resolved.html.tags.map((tag) => `name === ${emitLiteral(tag)}`).join(" || ") || "false";
    output = `${output}.replace(${regex2(SCRIPT_BLOCK_REGEX)}, "").replace(${regex2(HTML_TAG_PARTS_REGEX)}, (_tag, slash, rawName) => { const name = rawName.toLowerCase(); return ${conditions} ? "<" + slash + name + ">" : ""; })`;
  }
  if (resolved.controls) {
    output = `${output}.replace(${regex2(CONTROL_REGEX)}, ${emitLiteral(resolved.controls === "space" ? " " : "")})`;
  }
  if (resolved.sqlIdentifier) output = `${output}.replace(${regex2(SQL_IDENTIFIER_REGEX)}, "_")`;
  if (resolved.pathSegment) {
    output = `${output}.replace(${regex2(PATH_TRAVERSAL_REGEX)}, "_").replace(${regex2(PATH_SEGMENT_REGEX)}, "_")`;
  }
  for (const rule of resolved.patterns) {
    output = `${output}.replace(${regex2(rule.pattern)}, ${emitLiteral(rule.replacement ?? "")})`;
  }
  if (resolved.trim) output = `${output}.trim()`;
  if (resolved.maxLength !== void 0) output = `${output}.slice(0, ${resolved.maxLength})`;
  return output;
}
function emitSanitizeSource(schema) {
  return emitScrub(schema, selectSanitize).source;
}
function compileSanitize(schema, options) {
  return getCompileCached(
    schema,
    "sanitize",
    () => {
      const emitted = emitScrub(schema, selectSanitize);
      const compiled = globalThis.Function(
        ...SANITIZE_BINDINGS,
        `return ${emitted.source.replace("function scrub", "function sanitize")};`
      )(...SANITIZE_VALUES);
      registerArtifact(compiled, {
        kind: "operation",
        schema,
        op: "sanitize"
      });
      return compiled;
    },
    options
  );
}
function selectSanitize(base) {
  if (base.type !== TypeName.string) return void 0;
  const checks = base.def.checks ?? [];
  const sanitizeChecks = checks.filter((check) => check.kind === "sanitize");
  if (sanitizeChecks.length === 0) return void 0;
  let probe = "value";
  for (const check of sanitizeChecks) probe = emitSanitizeChain(probe, check.value);
  if (probe === "value") return void 0;
  return (value) => {
    let output = value;
    for (const check of sanitizeChecks) output = emitSanitizeChain(output, check.value);
    return output;
  };
}
function resolveSanitizeSpec(spec) {
  const presets = Array.isArray(spec.preset) ? spec.preset : [spec.preset ?? "text"];
  let html;
  let controls;
  let sqlIdentifier = false;
  let pathSegment = false;
  for (const preset of presets) {
    if (preset === "text") html = "strip";
    else if (preset === "htmlEscape") html = "escape";
    else if (preset === "sqlIdentifier") {
      controls = "remove";
      sqlIdentifier = true;
    } else if (preset === "pathSegment") {
      controls = "remove";
      pathSegment = true;
    }
  }
  if (spec.html !== void 0) html = spec.html;
  if (spec.controls !== void 0) controls = spec.controls === "preserve" ? void 0 : spec.controls;
  return {
    html,
    controls,
    normalize: spec.normalize,
    trim: spec.trim === true,
    maxLength: spec.maxLength,
    patterns: spec.patterns ?? [],
    sqlIdentifier,
    pathSegment
  };
}
function staticRegexReference(pattern) {
  const index = SANITIZE_VALUES.indexOf(pattern);
  return index === -1 ? String(pattern) : SANITIZE_BINDINGS[index];
}

// ../../packages/jit/src/compiler/serialize/emit-serialize.ts
function emitSerialize(schema) {
  const writer = new CodeWriter();
  const context = { writer, varCounter: 0 };
  const needsStringHelper = hasStringLeaf2(schema, /* @__PURE__ */ new Set());
  writer.line("(function () {");
  writer.indent(() => {
    if (needsStringHelper) emitStringHelper(writer);
    writer.line("function stringify(value) {");
    writer.indent(() => {
      writer.line('let s = "";');
      emitAppend(context, schema, "value");
      writer.line("return s;");
    });
    writer.line("}");
    writer.line("return stringify;");
  });
  writer.line("})()");
  return writer.toString();
}
function emitStringHelper(writer) {
  writer.line("const __se = /[\\u0000-\\u001f\\u0022\\u005c\\ud800-\\udfff]/;");
  writer.line("function str(value) {");
  writer.indent(() => {
    writer.line("const len = value.length;");
    writer.line("if (len < 42) {");
    writer.indent(() => {
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        writer.line("const code = value.charCodeAt(i);");
        writer.line("if (code < 32 || code === 34 || code === 92 || (code > 55295 && code < 57344)) {");
        writer.indent(() => {
          writer.line("return JSON.stringify(value);");
        });
        writer.line("}");
      });
      writer.line("}");
      writer.line(`return '"' + value + '"';`);
    });
    writer.line("}");
    writer.line("if (__se.test(value)) return JSON.stringify(value);");
    writer.line(`return '"' + value + '"';`);
  });
  writer.line("}");
}
function hasStringLeaf2(schema, seen) {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const current = schema;
  switch (current.type) {
    case TypeName.string:
      return true;
    case TypeName.enum:
      return Object.values(current.def.values).some(
        (value) => typeof value === "string"
      );
    case TypeName.record:
      return true;
    case TypeName.object: {
      const props = current.def.props;
      return Object.keys(props).some((key) => hasStringLeaf2(props[key], seen));
    }
    case TypeName.array:
      return hasStringLeaf2(current.def.element, seen);
    case TypeName.tuple: {
      const items = current.def.items ?? [];
      return items.some((item) => hasStringLeaf2(item, seen));
    }
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.default:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return hasStringLeaf2(current.def.innerType, seen);
    case TypeName.lazy:
      return hasStringLeaf2(current.def.getter(), seen);
    default:
      return false;
  }
}
function nextVar3(context, prefix) {
  return `${prefix}${++context.varCounter}`;
}
function emitAppend(context, schema, valueExpr) {
  const resolved = resolveSerializeWrappers(schema);
  const writer = context.writer;
  if (resolved.nullable || resolved.optional) {
    writer.line(`if (${valueExpr} == null) {`);
    writer.indent(() => {
      writer.line('s += "null";');
    });
    writer.line("} else {");
    writer.indent(() => {
      emitBaseAppend(context, resolved.base, valueExpr);
    });
    writer.line("}");
    return;
  }
  emitBaseAppend(context, resolved.base, valueExpr);
}
function emitBaseAppend(context, schema, valueExpr) {
  const writer = context.writer;
  switch (schema.type) {
    case TypeName.string:
      writer.line(`s += str(${valueExpr});`);
      return;
    case TypeName.number:
    case TypeName.int:
    case TypeName.nan:
      writer.line(`s += Number.isFinite(${valueExpr}) ? "" + ${valueExpr} : "null";`);
      return;
    case TypeName.boolean:
      writer.line(`s += ${valueExpr} ? "true" : "false";`);
      return;
    case TypeName.null:
      writer.line('s += "null";');
      return;
    case TypeName.date:
      writer.line(`s += '"' + ${valueExpr}.toISOString() + '"';`);
      return;
    case TypeName.literal: {
      const literalValue = schema.def.value;
      writer.line(`s += ${JSON.stringify(JSON.stringify(literalValue) ?? "null")};`);
      return;
    }
    case TypeName.enum: {
      const values = Object.values(schema.def.values);
      if (values.every((entry) => typeof entry === "string")) {
        writer.line(`s += str(${valueExpr});`);
      } else {
        writer.line(`s += JSON.stringify(${valueExpr});`);
      }
      return;
    }
    case TypeName.object:
      emitObjectAppend(context, schema, valueExpr);
      return;
    case TypeName.array: {
      const element = schema.def.element;
      const holder = hoist3(context, valueExpr);
      const index = nextVar3(context, "i");
      const item = nextVar3(context, "e");
      writer.line(`s += "[";`);
      writer.line(`for (let ${index} = 0; ${index} < ${holder}.length; ${index}++) {`);
      writer.indent(() => {
        writer.line(`if (${index} !== 0) s += ",";`);
        writer.line(`const ${item} = ${holder}[${index}];`);
        emitAppend(context, element, item);
      });
      writer.line("}");
      writer.line(`s += "]";`);
      return;
    }
    case TypeName.tuple: {
      const items = schema.def.items ?? [];
      const holder = hoist3(context, valueExpr);
      writer.line(`s += "[";`);
      items.forEach((item, position) => {
        if (position > 0) writer.line(`s += ",";`);
        emitAppend(context, item, `${holder}[${position}]`);
      });
      writer.line(`s += "]";`);
      return;
    }
    case TypeName.record: {
      const valueSchema = schema.def.value;
      const holder = hoist3(context, valueExpr);
      const keys = nextVar3(context, "k");
      const index = nextVar3(context, "i");
      const item = nextVar3(context, "e");
      writer.line(`s += "{";`);
      writer.line(`const ${keys} = Object.keys(${holder});`);
      writer.line(`for (let ${index} = 0; ${index} < ${keys}.length; ${index}++) {`);
      writer.indent(() => {
        writer.line(`if (${index} !== 0) s += ",";`);
        writer.line(`s += str(${keys}[${index}]) + ":";`);
        writer.line(`const ${item} = ${holder}[${keys}[${index}]];`);
        emitAppend(context, valueSchema, item);
      });
      writer.line("}");
      writer.line(`s += "}";`);
      return;
    }
    case TypeName.union:
    case TypeName.discriminatedUnion:
    case TypeName.any:
    case TypeName.unknown:
      writer.line(`s += JSON.stringify(${valueExpr}) ?? "null";`);
      return;
    default:
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `serialize does not support ${schema.type} schemas (not representable in JSON)`
      );
  }
}
function emitObjectAppend(context, schema, valueExpr) {
  const writer = context.writer;
  const props = schema.def.props;
  const keys = Object.keys(props);
  const holder = hoist3(context, valueExpr);
  const optionality = keys.map(
    (key) => resolveSerializeWrappers(props[key]).optional && emitStaticDefaultSource(props[key]) === void 0
  );
  const firstRequired = optionality.indexOf(false);
  const needsRuntimeComma = optionality.some((optional3, position) => optional3 && position < firstRequired) || firstRequired === -1;
  writer.line(`s += "{";`);
  if (keys.length === 0) {
    writer.line(`s += "}";`);
    return;
  }
  if (needsRuntimeComma) {
    const flag = nextVar3(context, "f");
    writer.line(`let ${flag} = false;`);
    keys.forEach((key, position) => {
      const rawPropExpr = emitPropertyAccess(holder, key);
      const propExpr = emitDefaultedValue(props[key], rawPropExpr);
      const keyPrefix = JSON.stringify(`${JSON.stringify(key)}:`);
      const emitProp = () => {
        writer.line(`if (${flag}) s += ",";`);
        writer.line(`${flag} = true;`);
        writer.line(`s += ${keyPrefix};`);
        emitAppend(context, props[key], propExpr);
      };
      if (optionality[position]) {
        writer.line(`if (${rawPropExpr} !== undefined) {`);
        writer.indent(emitProp);
        writer.line("}");
      } else {
        emitProp();
      }
    });
    writer.line(`s += "}";`);
    return;
  }
  let hasPrevious = false;
  keys.forEach((key, position) => {
    const rawPropExpr = emitPropertyAccess(holder, key);
    const propExpr = emitDefaultedValue(props[key], rawPropExpr);
    const keyToken = `${JSON.stringify(key)}:`;
    const prefix = hasPrevious ? `,${keyToken}` : keyToken;
    if (optionality[position]) {
      writer.line(`if (${rawPropExpr} !== undefined) {`);
      writer.indent(() => {
        writer.line(`s += ${JSON.stringify(`,${keyToken}`)};`);
        emitAppend(context, props[key], propExpr);
      });
      writer.line("}");
      return;
    }
    writer.line(`s += ${JSON.stringify(prefix)};`);
    emitAppend(context, props[key], propExpr);
    hasPrevious = true;
  });
  writer.line(`s += "}";`);
}
function hoist3(context, expr) {
  if (parse_exports.isValidIdentifier(expr)) return expr;
  const holder = nextVar3(context, "v");
  context.writer.line(`const ${holder} = ${expr};`);
  return holder;
}
function resolveSerializeWrappers(schema) {
  let current = schema;
  let optional3 = false;
  let nullable3 = false;
  while (true) {
    switch (current.type) {
      case TypeName.optional:
        optional3 = true;
        current = current.def.innerType;
        continue;
      case TypeName.nullable:
        nullable3 = true;
        current = current.def.innerType;
        continue;
      case TypeName.nullish:
        optional3 = true;
        nullable3 = true;
        current = current.def.innerType;
        continue;
      case TypeName.default:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType;
        continue;
      case TypeName.lazy:
        current = current.def.getter();
        continue;
      default:
        return { base: current, optional: optional3, nullable: nullable3 };
    }
  }
}

// ../../packages/jit/src/compiler/validate/emit-validate.ts
var EMAIL_REGEX = regexes_exports.email;
var UUID_REGEX = /* @__PURE__ */ regexes_exports.uuid();
var ValidatorEmitter = class {
  constructor(mode, awaited = false) {
    this.mode = mode;
    this.awaited = awaited;
    this.writer = new CodeWriter();
    this.bindingNames = [];
    this.bindingValues = [];
    this.bindingIds = /* @__PURE__ */ new Map();
    this.helperSources = [];
    this.predicateNames = /* @__PURE__ */ new Map();
    this.helperCounter = 0;
    this.varCounter = 0;
    this.rootMode = mode;
  }
  bindings() {
    return { names: this.bindingNames, values: this.bindingValues };
  }
  helpers() {
    return this.helperSources;
  }
  bind(value) {
    const existing = this.bindingIds.get(value);
    if (existing) return existing;
    const name = `__v${this.bindingNames.length}`;
    this.bindingNames.push(name);
    this.bindingValues.push(value);
    this.bindingIds.set(value, name);
    return name;
  }
  nextVar(prefix) {
    return `${prefix}${++this.varCounter}`;
  }
  /**
   * Emits validation statements for `schema` against `valueExpr`.
   * Returns the output expression for parse mode (the validated/transformed
   * value); is-mode returns the holder variable.
   */
  emitNode(schema, valueExpr, path, contextExpr) {
    const current = schema;
    if (current.type === TypeName.when) {
      return this.emitWhen(current, valueExpr, path, contextExpr);
    }
    const unwrapped = unwrapValidation(schema, this);
    const writer = this.writer;
    const holder = this.nextVar("v");
    const output = this.nextVar("o");
    writer.line(`let ${holder} = ${valueExpr};`);
    if (this.mode === "parse") writer.line(`let ${output} = ${holder};`);
    const finish = () => this.mode === "parse" ? output : holder;
    if (unwrapped.emptyAsUndefined) {
      writer.line(`if (${holder} === "") {`);
      writer.indent(() => {
        writer.line(`${holder} = undefined;`);
        if (this.mode === "parse") writer.line(`${output} = ${holder};`);
      });
      writer.line("}");
    }
    const emitValidated = () => {
      if (unwrapped.coerce) {
        writer.line(`${holder} = ${unwrapped.coerce}(${holder});`);
        if (this.mode === "parse") writer.line(`${output} = ${holder};`);
      }
      const innerOut = this.emitBase(unwrapped, holder, path);
      for (const refine3 of unwrapped.refines) {
        const refinePath = appendIssuePath(path, refine3.path);
        const emitRefine = () => {
          this.failIf(
            `!${refine3.binding}(${holder})`,
            refinePath,
            "custom",
            "refinement",
            refine3.message ?? "refinement rejected the value"
          );
        };
        if (refine3.when) {
          writer.line(`if (${refine3.when}({ value: ${holder} })) {`);
          writer.indent(emitRefine);
          writer.line("}");
        } else {
          emitRefine();
        }
      }
      if (this.mode === "parse") {
        writer.line(`${output} = ${innerOut};`);
        for (const pipe3 of unwrapped.pipes) {
          writer.line(`${output} = ${pipe3}(${output});`);
        }
      }
    };
    if (unwrapped.defaultValue) {
      const { binding, isFactory } = unwrapped.defaultValue;
      const defaultExpr = isFactory ? `${binding}()` : binding;
      if (this.mode === "parse") {
        writer.line(`if (${holder} === undefined) {`);
        writer.indent(() => {
          writer.line(`${output} = ${defaultExpr};`);
        });
        writer.line("} else {");
        writer.indent(emitValidated);
        writer.line("}");
      } else {
        writer.line(`if (${holder} !== undefined) {`);
        writer.indent(emitValidated);
        writer.line("}");
      }
      return finish();
    }
    const guards = [];
    if (unwrapped.optional) guards.push(`${holder} !== undefined`);
    if (unwrapped.nullable) guards.push(`${holder} !== null`);
    if (guards.length > 0) {
      writer.line(`if (${guards.join(" && ")}) {`);
      writer.indent(emitValidated);
      writer.line("}");
      return finish();
    }
    emitValidated();
    return finish();
  }
  /** Emits `if (<failCondition>) { fail }` — early return or issue push. */
  failIf(failCondition, path, code, expected, message) {
    const writer = this.writer;
    writer.line(`if (${failCondition}) {`);
    writer.indent(() => {
      this.emitFail(path, code, expected, message);
    });
    writer.line("}");
  }
  emitFail(path, code, expected, message, received) {
    const writer = this.writer;
    if (this.mode === "is") {
      writer.line("return false;");
      return;
    }
    const pathSource = path.kind === "static" ? emitLiteral(path.source) : path.source;
    const receivedPart = received ? `, received: ${received}` : "";
    writer.line(
      `issues[issues.length] = { path: ${pathSource}, code: ${emitLiteral(code)}, expected: ${emitLiteral(expected)}, message: ${emitLiteral(message)}${receivedPart} };`
    );
  }
  /** Type guard + checks + children for the unwrapped base schema. */
  emitBase(unwrapped, value, path) {
    const schema = unwrapped.base;
    if (schema.def.coerce === true) {
      switch (schema.type) {
        case TypeName.string:
          this.writer.line(`${value} = String(${value});`);
          break;
        case TypeName.number:
        case TypeName.int:
          this.writer.line(`${value} = Number(${value});`);
          break;
        case TypeName.boolean:
          this.writer.line(`${value} = Boolean(${value});`);
          break;
        case TypeName.bigint:
          this.writer.line(`try { ${value} = BigInt(${value}); } catch {}`);
          break;
        case TypeName.date:
          this.writer.line(`${value} = new Date(${value});`);
          break;
        default:
          break;
      }
    }
    switch (schema.type) {
      case TypeName.any:
      case TypeName.unknown:
        return value;
      case TypeName.never:
        this.emitFail(path, "invalid_type", "never", "no value is assignable to never");
        return value;
      case TypeName.void:
      case TypeName.undefined:
        this.failIf(`${value} !== undefined`, path, "invalid_type", "undefined", "expected undefined");
        return value;
      case TypeName.null:
        this.failIf(`${value} !== null`, path, "invalid_type", "null", "expected null");
        return value;
      case TypeName.nan:
        this.failIf(`${value} === ${value}`, path, "invalid_type", "nan", "expected NaN");
        return value;
      case TypeName.string:
        return this.emitString(schema, value, path);
      case TypeName.number:
        return this.emitNumber(schema, value, path, false);
      case TypeName.int:
        return this.emitNumber(schema, value, path, true);
      case TypeName.boolean:
        return this.emitTypeofLeaf(value, path, "boolean");
      case TypeName.bigint:
        return this.emitTypeofLeaf(value, path, "bigint");
      case TypeName.symbol:
        return this.emitTypeofLeaf(value, path, "symbol");
      case TypeName.date:
        return this.emitDate(schema, value, path);
      case TypeName.regex:
        this.failIf(`!(${value} instanceof RegExp)`, path, "invalid_type", "RegExp", "expected a RegExp");
        return value;
      case TypeName.file:
        this.failIf(
          `!(typeof File !== "undefined" && ${value} instanceof File)`,
          path,
          "invalid_type",
          "File",
          "expected a File"
        );
        return value;
      case TypeName.json:
        return this.emitJson(value, path);
      case TypeName.custom:
        return this.emitCustom(schema, value, path);
      case TypeName.not:
        return this.emitNot(schema, value, path);
      case TypeName.templateLiteral:
        return this.emitTemplateLiteral(schema, value, path);
      case TypeName.function:
        this.failIf(`typeof ${value} !== "function"`, path, "expected_function", "function", "expected function");
        return value;
      case TypeName.temporal:
        return this.emitTemporal(schema, value, path);
      case TypeName.codec:
        return this.emitCodec(schema, value, path);
      case TypeName.literal: {
        const literalSource = emitLiteral(schema.def.value);
        const literalText = String(schema.def.value);
        const test = typeof schema.def.value === "number" && Number.isNaN(schema.def.value) ? `${value} === ${value}` : `${value} !== ${literalSource}`;
        this.failIf(test, path, "invalid_literal", literalText, `expected literal ${literalText}`);
        return value;
      }
      case TypeName.enum: {
        const values = Object.values(schema.def.values);
        const test = values.map((option) => `${value} !== ${emitLiteral(option)}`).join(" && ");
        this.failIf(
          values.length === 0 ? "true" : test,
          path,
          "invalid_enum",
          values.map((option) => String(option)).join(" | "),
          "expected one of the enum values"
        );
        return value;
      }
      case TypeName.array:
        return this.emitArray(schema, value, path);
      case TypeName.tuple:
        return this.emitTuple(schema, value, path);
      case TypeName.set:
        return this.emitSet(schema, value, path);
      case TypeName.map:
        return this.emitMap(schema, value, path);
      case TypeName.record:
        return this.emitRecord(schema, value, path);
      case TypeName.object:
        return this.emitObject(schema, value, path, unwrapped.fieldTransforms);
      case TypeName.union:
        return this.emitUnion(schema, value, path);
      case TypeName.xor:
        return this.emitXor(schema, value, path);
      case TypeName.discriminatedUnion:
        return this.emitDiscriminatedUnion(schema, value, path);
      case TypeName.intersection: {
        const options = schema.def.options;
        const rebuild = this.mode === "parse" && options.some((option) => needsBuild(option));
        const outputs = options.map((option) => this.emitNode(option, value, path));
        if (!rebuild) return value;
        const merged = this.nextVar("o");
        this.writer.line(`const ${merged} = Object.assign({}, ${outputs.join(", ")});`);
        return merged;
      }
      case TypeName.instanceof: {
        const guard = emitSchemaGuard(schema, value);
        this.failIf(`!(${guard})`, path, "invalid_type", "instance", "expected a class instance");
        return value;
      }
      case TypeName.promise: {
        if (this.awaited) {
          this.writer.line(`${value} = await ${value};`);
          return this.emitNode(schema.def.innerType, value, path);
        }
        this.failIf(
          `!(${value} !== null && typeof ${value} === "object" && typeof ${value}.then === "function")`,
          path,
          "invalid_type",
          "Promise",
          "expected a thenable"
        );
        return value;
      }
      default:
        return value;
    }
  }
  emitWhen(schema, valueExpr, path, contextExpr) {
    const sibling = contextExpr ? emitPropertyAccess(contextExpr, schema.def.key) : "undefined";
    const matcher = schema.def.is;
    const test = typeof matcher === "function" ? `${this.bind(matcher)}(${sibling})` : `${sibling} === ${emitLiteral(matcher)}`;
    if (this.mode === "is") {
      this.writer.line(`if (${test}) {`);
      this.writer.indent(() => {
        this.emitNode(schema.def.thenType, valueExpr, path, contextExpr);
      });
      this.writer.line("} else {");
      this.writer.indent(() => {
        this.emitNode(schema.def.otherwiseType, valueExpr, path, contextExpr);
      });
      this.writer.line("}");
      return valueExpr;
    }
    const out = this.nextVar("w");
    this.writer.line(`let ${out};`);
    this.writer.line(`if (${test}) {`);
    this.writer.indent(() => {
      const branchOut = this.emitNode(schema.def.thenType, valueExpr, path, contextExpr);
      this.writer.line(`${out} = ${branchOut};`);
    });
    this.writer.line("} else {");
    this.writer.indent(() => {
      const branchOut = this.emitNode(schema.def.otherwiseType, valueExpr, path, contextExpr);
      this.writer.line(`${out} = ${branchOut};`);
    });
    this.writer.line("}");
    return out;
  }
  /**
   * Emits a fail-or-descend gate: on type failure records the issue and
   * skips the nested block, so children never touch a wrong-typed value.
   */
  typeGate(failCondition, path, code, expected, message, body, received) {
    const writer = this.writer;
    if (this.mode === "is") {
      writer.line(`if (${failCondition}) {`);
      writer.indent(() => {
        writer.line("return false;");
      });
      writer.line("}");
      body();
      return;
    }
    writer.line(`if (${failCondition}) {`);
    writer.indent(() => {
      this.emitFail(path, code, expected, message, received);
    });
    writer.line("} else {");
    writer.indent(body);
    writer.line("}");
  }
  emitTypeofLeaf(value, path, expected) {
    this.failIf(`typeof ${value} !== "${expected}"`, path, `expected_${expected}`, expected, `expected ${expected}`);
    return value;
  }
  requiredMessage(schema, fallback) {
    return typeof schema.def.requiredMessage === "string" ? schema.def.requiredMessage : fallback;
  }
  emitJson(value, path) {
    this.failIf(
      `!${this.emitJsonPredicate()}(${value})`,
      path,
      "invalid_json",
      "JSON value",
      "expected a JSON-encodable value"
    );
    return value;
  }
  emitCustom(schema, value, path) {
    const predicate = schema.def.predicate;
    if (predicate) {
      this.failIf(
        `!${this.bind(predicate)}(${value})`,
        path,
        "custom",
        "custom",
        schema.def.message ?? "custom predicate rejected the value"
      );
    }
    return value;
  }
  emitNot(schema, value, path) {
    const inner = schema.def.innerType;
    this.failIf(
      `${this.emitOptionPredicate(inner)}(${value})`,
      path,
      "invalid_not",
      "not",
      "value matched a forbidden schema"
    );
    return value;
  }
  emitTemplateLiteral(schema, value, path) {
    const regex2 = buildTemplateLiteralRegex(schema.def.parts);
    this.typeGate(
      `typeof ${value} !== "string"`,
      path,
      "expected_string",
      "string",
      "expected string",
      () => {
        this.failIf(
          `!${this.bind(regex2)}.test(${value})`,
          path,
          "invalid_template_literal",
          "template literal",
          "expected a matching template literal string"
        );
      },
      `typeof ${value}`
    );
    return value;
  }
  emitDate(schema, value, path) {
    const checks = schema.def.checks ?? [];
    this.typeGate(
      `!(${value} instanceof Date) || ${value}.getTime() !== ${value}.getTime()`,
      path,
      "invalid_date",
      "Date",
      this.requiredMessage(schema, "expected a valid Date"),
      () => {
        this.emitDateLikeChecks(checks, value, path, "date");
      }
    );
    return value;
  }
  emitTemporal(schema, value, path) {
    const kind = schema.def.kind;
    const ctor = temporalConstructorName2(kind);
    const expected = `Temporal.${ctor}`;
    this.typeGate(
      `!(globalThis.Temporal !== undefined && ${value} instanceof globalThis.Temporal.${ctor})`,
      path,
      "invalid_temporal",
      expected,
      this.requiredMessage(schema, `expected ${expected}`),
      () => {
        this.emitDateLikeChecks(
          schema.def.checks ?? [],
          value,
          path,
          kind
        );
      }
    );
    return value;
  }
  emitDateLikeChecks(checks, value, path, target) {
    for (const check of checks) {
      switch (check.kind) {
        case "min": {
          const bound = this.dateLikeBound(check.value, target);
          this.failIf(
            this.dateLikeCompare(value, bound, target, "<"),
            path,
            "too_small",
            `>= ${String(check.value)}`,
            check.message ?? `expected a value >= ${String(check.value)}`
          );
          break;
        }
        case "max": {
          const bound = this.dateLikeBound(check.value, target);
          this.failIf(
            this.dateLikeCompare(value, bound, target, ">"),
            path,
            "too_big",
            `<= ${String(check.value)}`,
            check.message ?? `expected a value <= ${String(check.value)}`
          );
          break;
        }
        case "between": {
          const range = check.value;
          const min = this.dateLikeBound(range.min, target);
          const max = this.dateLikeBound(range.max, target);
          this.failIf(
            `${this.dateLikeCompare(value, min, target, "<")} || ${this.dateLikeCompare(value, max, target, ">")}`,
            path,
            "out_of_range",
            `${String(range.min)}..${String(range.max)}`,
            check.message ?? `expected a value between ${String(range.min)} and ${String(range.max)}`
          );
          break;
        }
        case "daysOfWeek": {
          const days = check.value ?? [];
          const dayExpr = target === "date" ? `(((${value}.getDay() + 6) % 7) + 1)` : `${value}.dayOfWeek`;
          const test = days.map((day) => `${dayExpr} !== ${emitLiteral(day)}`).join(" && ");
          this.failIf(
            days.length === 0 ? "true" : `typeof ${dayExpr} !== "number" || (${test})`,
            path,
            "invalid_day_of_week",
            days.join(" | "),
            check.message ?? "expected an allowed day of week"
          );
          break;
        }
        case "monthsOfYear": {
          const months = check.value ?? [];
          const monthExpr = target === "date" ? `(${value}.getMonth() + 1)` : `${value}.month`;
          const test = months.map((month) => `${monthExpr} !== ${emitLiteral(month)}`).join(" && ");
          this.failIf(
            months.length === 0 ? "true" : `typeof ${monthExpr} !== "number" || (${test})`,
            path,
            "invalid_month_of_year",
            months.join(" | "),
            check.message ?? "expected an allowed month"
          );
          break;
        }
        case "truncateTo":
          this.failIf(
            this.truncateFailure(value, check.value, target),
            path,
            "invalid_precision",
            String(check.value),
            check.message ?? `expected value truncated to ${String(check.value)}`
          );
          break;
        default:
          break;
      }
    }
  }
  dateLikeBound(value, target) {
    if (target === "date") {
      const time2 = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
      return emitLiteral(time2);
    }
    return emitLiteral(value instanceof Date ? value.toISOString() : String(value));
  }
  dateLikeCompare(value, bound, target, operator) {
    return target === "date" ? `${value}.getTime() ${operator} ${bound}` : `${value}.toString() ${operator} ${bound}`;
  }
  truncateFailure(value, unit, target) {
    if (target === "date") {
      if (unit === "minute") return `${value}.getSeconds() !== 0 || ${value}.getMilliseconds() !== 0`;
      if (unit === "second") return `${value}.getMilliseconds() !== 0`;
      return "false";
    }
    const second = `(${value}.second ?? 0)`;
    const millisecond = `(${value}.millisecond ?? 0)`;
    const microsecond = `(${value}.microsecond ?? 0)`;
    const nanosecond = `(${value}.nanosecond ?? 0)`;
    if (unit === "minute")
      return `${second} !== 0 || ${millisecond} !== 0 || ${microsecond} !== 0 || ${nanosecond} !== 0`;
    if (unit === "second") return `${millisecond} !== 0 || ${microsecond} !== 0 || ${nanosecond} !== 0`;
    return `${microsecond} !== 0 || ${nanosecond} !== 0`;
  }
  emitCodec(schema, value, path) {
    const input = schema.def.input;
    const inputOut = this.emitNode(input, value, path);
    if (this.mode === "is") return value;
    const decoded = this.nextVar("c");
    this.writer.line(`let ${decoded};`);
    this.writer.line("try {");
    this.writer.indent(() => {
      this.writer.line(`${decoded} = ${this.bind(schema.def.decode)}(${inputOut});`);
    });
    this.writer.line("} catch {");
    this.writer.indent(() => {
      this.emitFail(path, "invalid_codec", "codec decode", "codec decode failed");
    });
    this.writer.line("}");
    return this.emitNode(schema.def.output, decoded, path);
  }
  emitJsonPredicate() {
    const name = `${this.rootMode === "is" ? "ij" : "pj"}${++this.helperCounter}`;
    this.helperSources.push(`function ${name}(value) {
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "boolean") return true;
  if (type === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!${name}(value[i])) return false;
    }
    return true;
  }
  if (type !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    if (!${name}(value[keys[i]])) return false;
  }
  return true;
}`);
    return name;
  }
  emitString(schema, value, path) {
    const checks = schema.def.checks ?? [];
    this.typeGate(
      `typeof ${value} !== "string"`,
      path,
      "expected_string",
      "string",
      this.requiredMessage(schema, "expected string"),
      () => {
        for (const check of checks) {
          if (check.kind === "trim") this.writer.line(`${value} = ${value}.trim();`);
          if (check.kind === "normalize") {
            const form = typeof check.value === "string" ? emitLiteral(check.value) : "";
            this.writer.line(`${value} = ${value}.normalize(${form});`);
          }
          if (check.kind === "lowercase") this.writer.line(`${value} = ${value}.toLowerCase();`);
          if (check.kind === "uppercase") this.writer.line(`${value} = ${value}.toUpperCase();`);
          if (check.kind === "sanitize") {
            this.writer.line(
              `${value} = ${emitSanitizeChain(value, check.value, (pattern) => this.bind(pattern))};`
            );
          }
          if (check.kind === "format") {
            const spec = check.value;
            const length = countFormatPlaceholders(spec.pattern);
            if (spec.mode === "strict") {
              this.failIf(
                emitStrictFormatCondition(value, spec.pattern),
                path,
                "invalid_format",
                spec.pattern,
                check.message ?? `expected the ${spec.pattern} format`
              );
            } else {
              if (spec.stripNonDigits) this.writer.line(`${value} = ${value}.replace(/\\D+/g, "");`);
              this.failIf(
                `${value}.length !== ${emitLiteral(length)}`,
                path,
                "invalid_format",
                `length === ${length}`,
                check.message ?? `expected ${length} characters before formatting`
              );
            }
          }
          if (check.kind === "phoneBR") {
            this.writer.line(`${value} = ${value}.replace(/\\D+/g, "");`);
            this.failIf(
              `${value}.length !== 10 && ${value}.length !== 11`,
              path,
              "invalid_format",
              "Brazilian phone with 10 or 11 digits",
              check.message ?? "expected a Brazilian phone number"
            );
          }
        }
        for (const check of checks) {
          switch (check.kind) {
            case "min":
              this.failIf(
                `${value}.length < ${emitLiteral(check.value)}`,
                path,
                "too_small",
                `length >= ${check.value}`,
                check.message ?? `expected at least ${check.value} characters`
              );
              break;
            case "max":
              this.failIf(
                `${value}.length > ${emitLiteral(check.value)}`,
                path,
                "too_big",
                `length <= ${check.value}`,
                check.message ?? `expected at most ${check.value} characters`
              );
              break;
            case "length":
              this.failIf(
                `${value}.length !== ${emitLiteral(check.value)}`,
                path,
                "invalid_length",
                `length === ${check.value}`,
                check.message ?? `expected exactly ${check.value} characters`
              );
              break;
            case "oneOf": {
              const values = check.value ?? [];
              const test = values.map((option) => `${value} !== ${emitLiteral(option)}`).join(" && ");
              this.failIf(
                values.length === 0 ? "true" : test,
                path,
                "invalid_enum",
                values.join(" | "),
                check.message ?? "expected one of the allowed values"
              );
              break;
            }
            case "startsWith":
              this.failIf(
                `!${value}.startsWith(${emitLiteral(check.value)})`,
                path,
                "invalid_string",
                `startsWith ${check.value}`,
                check.message ?? `expected string to start with ${check.value}`
              );
              break;
            case "endsWith":
              this.failIf(
                `!${value}.endsWith(${emitLiteral(check.value)})`,
                path,
                "invalid_string",
                `endsWith ${check.value}`,
                check.message ?? `expected string to end with ${check.value}`
              );
              break;
            case "includes":
              this.failIf(
                `!${value}.includes(${emitLiteral(check.value)})`,
                path,
                "invalid_string",
                `includes ${check.value}`,
                check.message ?? `expected string to include ${check.value}`
              );
              break;
            case "digitsLength": {
              const lengths = Array.isArray(check.value) ? check.value : [check.value];
              const test = lengths.map((length) => `${value}.length !== ${emitLiteral(length)}`).join(" && ");
              this.failIf(
                lengths.length === 0 ? "true" : test,
                path,
                "invalid_length",
                lengths.map((length) => `length === ${length}`).join(" | "),
                check.message ?? `expected ${lengths.join(" or ")} digits`
              );
              break;
            }
            default:
              break;
          }
        }
        for (const check of checks) {
          switch (check.kind) {
            case "regex":
              this.failIf(
                `!${this.bind(check.value)}.test(${value})`,
                path,
                "invalid_format",
                "regex",
                check.message ?? "expected the value to match the pattern"
              );
              break;
            case "email":
              this.failIf(
                `!${this.bind(check.value instanceof RegExp ? check.value : EMAIL_REGEX)}.test(${value})`,
                path,
                "invalid_format",
                "email",
                check.message ?? "expected a valid email"
              );
              break;
            case "uuid":
              this.failIf(
                `!${this.bind(check.value instanceof RegExp ? check.value : UUID_REGEX)}.test(${value})`,
                path,
                "invalid_format",
                "uuid",
                check.message ?? "expected a valid uuid"
              );
              break;
            case "url": {
              const holder = this.nextVar("u");
              this.writer.line(`let ${holder} = true;`);
              this.writer.line(`try { new URL(${value}); } catch { ${holder} = false; }`);
              this.failIf(`!${holder}`, path, "invalid_format", "url", check.message ?? "expected a valid URL");
              break;
            }
            case "httpUrl": {
              const holder = this.nextVar("u");
              const parsed = this.nextVar("url");
              this.writer.line(`let ${holder} = true;`);
              this.writer.line(
                `try { const ${parsed} = new URL(${value}); ${holder} = ${parsed}.protocol === "http:" || ${parsed}.protocol === "https:"; } catch { ${holder} = false; }`
              );
              this.failIf(
                `!${holder}`,
                path,
                "invalid_format",
                "httpUrl",
                check.message ?? "expected a valid HTTP(S) URL"
              );
              break;
            }
            case "stringFormat": {
              const spec = check.value;
              this.failIf(
                `!${this.bind(spec.pattern)}.test(${value})`,
                path,
                "invalid_format",
                spec.name,
                check.message ?? `expected a valid ${spec.name}`
              );
              break;
            }
            default:
              if (check.value instanceof RegExp) {
                this.failIf(
                  `!${this.bind(check.value)}.test(${value})`,
                  path,
                  "invalid_format",
                  check.kind,
                  check.message ?? `expected a valid ${check.kind}`
                );
              }
              break;
          }
        }
        if (this.rootMode === "parse") {
          for (const check of checks) {
            if (check.kind === "format") {
              const spec = check.value;
              if (spec.mode === "transform") {
                const length = countFormatPlaceholders(spec.pattern);
                this.writer.line(`if (${value}.length === ${length}) {`);
                this.writer.indent(() => {
                  this.writer.line(`${value} = ${emitFormatMaskExpression(value, spec.pattern)};`);
                });
                this.writer.line("}");
              }
            }
            if (check.kind === "phoneBR") {
              this.writer.line(`if (${value}.length === 10) {`);
              this.writer.indent(() => {
                this.writer.line(`${value} = ${emitFormatMaskExpression(value, "(##) ####-####")};`);
              });
              this.writer.line(`} else if (${value}.length === 11) {`);
              this.writer.indent(() => {
                this.writer.line(`${value} = ${emitFormatMaskExpression(value, "(##) #####-####")};`);
              });
              this.writer.line("}");
            }
          }
        }
      },
      `typeof ${value}`
    );
    return value;
  }
  emitNumber(schema, value, path, forceInteger) {
    const checks = schema.def.checks ?? [];
    this.typeGate(
      `typeof ${value} !== "number"`,
      path,
      "expected_number",
      "number",
      this.requiredMessage(schema, "expected number"),
      () => {
        if (forceInteger || checks.some((check) => check.kind === "integer")) {
          const integerMessage = checks.find((check) => check.kind === "integer")?.message;
          this.failIf(
            `!Number.isInteger(${value})`,
            path,
            "not_integer",
            "integer",
            integerMessage ?? "expected an integer"
          );
        }
        for (const check of checks) {
          switch (check.kind) {
            case "min":
              this.failIf(
                `${value} < ${emitLiteral(check.value)}`,
                path,
                "too_small",
                `>= ${check.value}`,
                check.message ?? `expected a number >= ${check.value}`
              );
              break;
            case "max":
              this.failIf(
                `${value} > ${emitLiteral(check.value)}`,
                path,
                "too_big",
                `<= ${check.value}`,
                check.message ?? `expected a number <= ${check.value}`
              );
              break;
            case "moreThan":
              this.failIf(
                `${value} <= ${emitLiteral(check.value)}`,
                path,
                "too_small",
                `> ${check.value}`,
                check.message ?? `expected a number > ${check.value}`
              );
              break;
            case "lessThan":
              this.failIf(
                `${value} >= ${emitLiteral(check.value)}`,
                path,
                "too_big",
                `< ${check.value}`,
                check.message ?? `expected a number < ${check.value}`
              );
              break;
            case "oneOf": {
              const values = check.value ?? [];
              const test = values.map((option) => `${value} !== ${emitLiteral(option)}`).join(" && ");
              this.failIf(
                values.length === 0 ? "true" : test,
                path,
                "invalid_enum",
                values.map((option) => String(option)).join(" | "),
                check.message ?? "expected one of the allowed values"
              );
              break;
            }
            case "positive":
              this.failIf(`${value} <= 0`, path, "not_positive", "> 0", check.message ?? "expected a positive number");
              break;
            case "negative":
              this.failIf(`${value} >= 0`, path, "not_negative", "< 0", check.message ?? "expected a negative number");
              break;
            case "finite":
              this.failIf(
                `!Number.isFinite(${value})`,
                path,
                "not_finite",
                "finite",
                check.message ?? "expected a finite number"
              );
              break;
            case "safe":
              this.failIf(
                `!Number.isSafeInteger(${value})`,
                path,
                "not_safe",
                "safe integer",
                check.message ?? "expected a safe integer"
              );
              break;
            case "int32":
              this.failIf(
                `!Number.isInteger(${value}) || ${value} < -2147483648 || ${value} > 2147483647`,
                path,
                "not_int32",
                "int32",
                check.message ?? "expected a 32-bit signed integer"
              );
              break;
            case "float32":
              this.failIf(
                `!Number.isFinite(${value}) || Math.fround(${value}) !== ${value}`,
                path,
                "not_float32",
                "float32",
                check.message ?? "expected a float32-representable number"
              );
              break;
            case "float64":
              this.failIf(
                `!Number.isFinite(${value})`,
                path,
                "not_float64",
                "float64",
                check.message ?? "expected a finite float64 number"
              );
              break;
            case "multipleOf":
              this.failIf(
                `${value} % ${emitLiteral(check.value)} !== 0`,
                path,
                "not_multiple_of",
                `multiple of ${check.value}`,
                check.message ?? `expected a multiple of ${check.value}`
              );
              break;
            default:
              break;
          }
        }
      },
      `typeof ${value}`
    );
    return value;
  }
  emitArray(schema, value, path) {
    const element = schema.def.element;
    const checks = schema.def.checks ?? [];
    const build = this.mode === "parse" && needsBuild(element);
    const out = build ? this.nextVar("b") : value;
    if (build) this.writer.line(`let ${out};`);
    this.typeGate(
      `!Array.isArray(${value})`,
      path,
      "expected_array",
      "array",
      "expected array",
      () => {
        for (const check of checks) {
          switch (check.kind) {
            case "min":
              this.failIf(
                `${value}.length < ${emitLiteral(check.value)}`,
                path,
                "too_small",
                `length >= ${check.value}`,
                check.message ?? `expected at least ${check.value} items`
              );
              break;
            case "max":
              this.failIf(
                `${value}.length > ${emitLiteral(check.value)}`,
                path,
                "too_big",
                `length <= ${check.value}`,
                check.message ?? `expected at most ${check.value} items`
              );
              break;
            case "length":
              this.failIf(
                `${value}.length !== ${emitLiteral(check.value)}`,
                path,
                "invalid_length",
                `length === ${check.value}`,
                check.message ?? `expected exactly ${check.value} items`
              );
              break;
            case "nonEmpty":
              this.failIf(
                `${value}.length === 0`,
                path,
                "too_small",
                "length >= 1",
                check.message ?? "expected a non-empty array"
              );
              break;
            default:
              break;
          }
        }
        const index = this.nextVar("i");
        if (build) this.writer.line(`${out} = new Array(${value}.length);`);
        this.writer.line(`for (let ${index} = 0; ${index} < ${value}.length; ${index}++) {`);
        this.writer.indent(() => {
          const elementOut = this.emitNode(element, `${value}[${index}]`, dynamicChild(path, index));
          if (build) this.writer.line(`${out}[${index}] = ${elementOut};`);
        });
        this.writer.line("}");
      },
      `typeof ${value}`
    );
    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }
  emitTuple(schema, value, path) {
    const items = schema.def.items ?? [];
    const rest = schema.def.rest;
    const build = this.mode === "parse" && (items.some((item) => needsBuild(item)) || rest !== void 0 && needsBuild(rest));
    const out = build ? this.nextVar("b") : value;
    if (build) this.writer.line(`let ${out};`);
    this.typeGate(
      `!Array.isArray(${value})`,
      path,
      "expected_array",
      "tuple",
      "expected tuple",
      () => {
        const lengthTest = rest ? `${value}.length < ${items.length}` : `${value}.length !== ${items.length}`;
        this.failIf(
          lengthTest,
          path,
          "invalid_length",
          rest ? `length >= ${items.length}` : `length === ${items.length}`,
          rest ? `expected at least ${items.length} items` : `expected exactly ${items.length} items`
        );
        if (build) this.writer.line(`${out} = new Array(${value}.length);`);
        items.forEach((item, position) => {
          const itemOut = this.emitNode(item, `${value}[${position}]`, staticChild(path, `[${position}]`));
          if (build) this.writer.line(`${out}[${position}] = ${itemOut};`);
        });
        if (rest) {
          const index = this.nextVar("i");
          this.writer.line(`for (let ${index} = ${items.length}; ${index} < ${value}.length; ${index}++) {`);
          this.writer.indent(() => {
            const restOut = this.emitNode(rest, `${value}[${index}]`, dynamicChild(path, index));
            if (build) this.writer.line(`${out}[${index}] = ${restOut};`);
          });
          this.writer.line("}");
        }
      },
      `typeof ${value}`
    );
    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }
  emitSet(schema, value, path) {
    const element = schema.def.element;
    const build = this.mode === "parse" && needsBuild(element);
    const out = build ? this.nextVar("b") : value;
    if (build) this.writer.line(`let ${out};`);
    this.typeGate(
      `!(${value} instanceof Set)`,
      path,
      "expected_set",
      "Set",
      "expected a Set",
      () => {
        const item = this.nextVar("e");
        if (build) this.writer.line(`${out} = new Set();`);
        this.writer.line(`for (const ${item} of ${value}) {`);
        this.writer.indent(() => {
          const elementOut = this.emitNode(element, item, staticChild(path, "[element]"));
          if (build) this.writer.line(`${out}.add(${elementOut});`);
        });
        this.writer.line("}");
      },
      `typeof ${value}`
    );
    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }
  emitMap(schema, value, path) {
    const keySchema = schema.def.key;
    const valueSchema = schema.def.value;
    const build = this.mode === "parse" && (needsBuild(keySchema) || needsBuild(valueSchema));
    const out = build ? this.nextVar("b") : value;
    if (build) this.writer.line(`let ${out};`);
    this.typeGate(
      `!(${value} instanceof Map)`,
      path,
      "expected_map",
      "Map",
      "expected a Map",
      () => {
        const entry = this.nextVar("e");
        if (build) this.writer.line(`${out} = new Map();`);
        this.writer.line(`for (const ${entry} of ${value}) {`);
        this.writer.indent(() => {
          const keyOut = this.emitNode(keySchema, `${entry}[0]`, staticChild(path, "[key]"));
          const valueOut = this.emitNode(valueSchema, `${entry}[1]`, staticChild(path, "[value]"));
          if (build) this.writer.line(`${out}.set(${keyOut}, ${valueOut});`);
        });
        this.writer.line("}");
      },
      `typeof ${value}`
    );
    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }
  emitRecord(schema, value, path) {
    const valueSchema = schema.def.value;
    const build = this.mode === "parse" && needsBuild(valueSchema);
    const out = build ? this.nextVar("b") : value;
    if (build) this.writer.line(`let ${out};`);
    this.typeGate(
      `${value} === null || typeof ${value} !== "object" || Array.isArray(${value})`,
      path,
      "expected_object",
      "record",
      "expected a plain object",
      () => {
        const keys = this.nextVar("k");
        const index = this.nextVar("i");
        if (build) this.writer.line(`${out} = {};`);
        this.writer.line(`const ${keys} = Object.keys(${value});`);
        this.writer.line(`for (let ${index} = 0; ${index} < ${keys}.length; ${index}++) {`);
        this.writer.indent(() => {
          const valueOut = this.emitNode(
            valueSchema,
            `${value}[${keys}[${index}]]`,
            dynamicKeyChild(path, `${keys}[${index}]`)
          );
          if (build) this.writer.line(`${out}[${keys}[${index}]] = ${valueOut};`);
        });
        this.writer.line("}");
      },
      `typeof ${value}`
    );
    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }
  emitObject(schema, value, path, fieldTransforms) {
    const props = schema.def.props;
    const unknownKeys = schema.def.unknownKeys;
    const catchall2 = schema.def.catchall;
    const keys = Object.keys(props);
    const catchallBuild = catchall2 !== void 0 && needsBuild(catchall2);
    const preserveUnknownKeys = unknownKeys === "passthrough" || catchall2 !== void 0;
    const build = this.mode === "parse" && (fieldTransforms !== void 0 || unknownKeys === "strip" || catchallBuild || keys.some((key) => needsBuild(props[key])));
    const out = build ? this.nextVar("b") : value;
    if (build) this.writer.line(`let ${out};`);
    this.typeGate(
      `${value} === null || typeof ${value} !== "object" || Array.isArray(${value})`,
      path,
      "expected_object",
      "object",
      "expected object",
      () => {
        const outputs = [];
        for (const key of keys) {
          const propOut = this.emitNode(props[key], emitPropertyAccess(value, key), staticChild(path, key), value);
          const transform3 = fieldTransforms?.[key];
          outputs.push({ key, expr: transform3 ? `${transform3}(${propOut}, ${value})` : propOut });
        }
        if (build && preserveUnknownKeys) {
          this.writer.line(`${out} = Object.assign({}, ${value});`);
        }
        if (unknownKeys === "strict" || catchall2 !== void 0) {
          const known = this.nextVar("k");
          const index = this.nextVar("i");
          const keyTest = keys.map((key) => `${known}[${index}] !== ${emitLiteral(key)}`).join(" && ");
          const unknownTest = keys.length === 0 ? "true" : keyTest;
          this.writer.line(`const ${known} = Object.keys(${value});`);
          this.writer.line(`for (let ${index} = 0; ${index} < ${known}.length; ${index}++) {`);
          this.writer.indent(() => {
            if (unknownKeys === "strict") {
              this.failIf(
                unknownTest,
                dynamicKeyChild(path, `${known}[${index}]`),
                "unknown_key",
                "known keys only",
                "object contains unknown keys"
              );
              return;
            }
            if (catchall2 !== void 0) {
              this.writer.line(`if (${unknownTest}) {`);
              this.writer.indent(() => {
                const catchallOut = this.emitNode(
                  catchall2,
                  `${value}[${known}[${index}]]`,
                  dynamicKeyChild(path, `${known}[${index}]`)
                );
                if (build && catchallBuild) this.writer.line(`${out}[${known}[${index}]] = ${catchallOut};`);
              });
              this.writer.line("}");
            }
          });
          this.writer.line("}");
        }
        if (build) {
          if (!preserveUnknownKeys) {
            const entries = outputs.map((entry) => `${emitLiteral(entry.key)}: ${entry.expr}`).join(", ");
            this.writer.line(`${out} = { ${entries} };`);
          } else {
            for (const entry of outputs) {
              this.writer.line(`${emitPropertyAccess(out, entry.key)} = ${entry.expr};`);
            }
          }
        }
      },
      `typeof ${value}`
    );
    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }
  /**
   * Deep union validation: every option becomes a hoisted boolean predicate
   * (same Function scope, so `__v*` bindings stay reachable) running the full
   * is-mode pipeline — inner checks and refines included. Parse mode selects
   * the branch with the predicate and re-runs parse only for options that
   * rebuild their output (defaults/transforms/string mutations); coercions
   * inside union options do not participate in branch selection.
   */
  emitUnion(schema, value, path) {
    const options = schema.def.options;
    const tests = options.map(
      (option) => isShallowOption(option) ? `(${emitSchemaGuard(option, value)})` : `${this.emitOptionPredicate(option)}(${value})`
    );
    const matchTest = tests.join(" || ");
    if (this.mode === "is" || options.every((option) => !needsBuild(option))) {
      this.failIf(
        options.length === 0 ? "true" : `!(${matchTest})`,
        path,
        "invalid_union",
        "union",
        "value matched no union option"
      );
      return value;
    }
    const out = this.nextVar("o");
    this.writer.line(`let ${out} = ${value};`);
    options.forEach((option, position) => {
      this.writer.line(`${position === 0 ? "if" : "} else if"} (${tests[position]}) {`);
      this.writer.indent(() => {
        if (needsBuild(option)) {
          const branchOut = this.emitNode(option, value, path);
          this.writer.line(`${out} = ${branchOut};`);
        }
      });
    });
    this.writer.line("} else {");
    this.writer.indent(() => {
      this.emitFail(path, "invalid_union", "union", "value matched no union option");
    });
    this.writer.line("}");
    return out;
  }
  emitXor(schema, value, path) {
    const options = schema.def.options;
    const tests = options.map((option) => `${this.emitOptionPredicate(option)}(${value})`);
    const count = tests.length === 0 ? "0" : tests.map((test) => `(${test} ? 1 : 0)`).join(" + ");
    const build = this.mode === "parse" && options.some(needsBuild);
    if (this.mode === "is" || !build) {
      this.failIf(`${count} !== 1`, path, "invalid_xor", "exactly one schema", "value must match exactly one schema");
      return value;
    }
    const out = this.nextVar("o");
    this.writer.line(`let ${out} = ${value};`);
    this.writer.line(`if (${count} !== 1) {`);
    this.writer.indent(() => {
      this.emitFail(path, "invalid_xor", "exactly one schema", "value must match exactly one schema");
    });
    this.writer.line("} else {");
    this.writer.indent(() => {
      options.forEach((option, position) => {
        this.writer.line(`${position === 0 ? "if" : "} else if"} (${tests[position]}) {`);
        this.writer.indent(() => {
          if (needsBuild(option)) {
            const branchOut = this.emitNode(option, value, path);
            this.writer.line(`${out} = ${branchOut};`);
          }
        });
      });
      if (options.length > 0) this.writer.line("}");
    });
    this.writer.line("}");
    return out;
  }
  /** Emits (once per option schema) a hoisted `function iuN(value)` deep check. */
  emitOptionPredicate(option) {
    const existing = this.predicateNames.get(option);
    if (existing) return existing;
    const name = `${this.rootMode === "is" ? "iu" : "pu"}${++this.helperCounter}`;
    const savedWriter = this.writer;
    const savedMode = this.mode;
    const savedAwaited = this.awaited;
    this.predicateNames.set(option, name);
    this.writer = new CodeWriter();
    this.mode = "is";
    this.awaited = false;
    this.writer.line(`function ${name}(value) {`);
    this.writer.indent(() => {
      this.emitNode(option, "value", { kind: "static", source: "" });
      this.writer.line("return true;");
    });
    this.writer.line("}");
    this.helperSources.push(this.writer.toString());
    this.writer = savedWriter;
    this.mode = savedMode;
    this.awaited = savedAwaited;
    return name;
  }
  emitDiscriminatedUnion(schema, value, path) {
    const discriminator = schema.def.discriminator;
    const options = schema.def.options;
    const tagged = options.map((option) => ({ option, tag: literalTag(option, discriminator) })).filter((entry) => entry.tag !== void 0);
    const build = this.mode === "parse" && tagged.some((entry) => needsBuild(entry.option));
    const out = build ? this.nextVar("o") : value;
    if (build) this.writer.line(`let ${out} = ${value};`);
    this.typeGate(
      `${value} === null || typeof ${value} !== "object"`,
      path,
      "expected_object",
      "object",
      "expected object",
      () => {
        if (tagged.length === 0) {
          this.emitFail(path, "invalid_union", "discriminated union", "unknown discriminator value");
          return;
        }
        const tag = this.nextVar("t");
        this.writer.line(`const ${tag} = ${emitPropertyAccess(value, discriminator)};`);
        tagged.forEach((entry, position) => {
          this.writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${emitLiteral(entry.tag)}) {`);
          this.writer.indent(() => {
            const branchOut = this.emitNode(entry.option, value, path);
            if (build) this.writer.line(`${out} = ${branchOut};`);
          });
        });
        this.writer.line("} else {");
        this.writer.indent(() => {
          this.emitFail(path, "invalid_union", "discriminated union", "unknown discriminator value");
        });
        this.writer.line("}");
      },
      `typeof ${value}`
    );
    return out;
  }
};
function isShallowOption(schema) {
  let current = schema;
  while (current.type === TypeName.optional || current.type === TypeName.nullable || current.type === TypeName.nullish || current.type === TypeName.brand || current.type === TypeName.readonly || current.type === TypeName.lazy) {
    current = current.type === TypeName.lazy ? current.def.getter() : current.def.innerType;
  }
  switch (current.type) {
    case TypeName.any:
    case TypeName.unknown:
    case TypeName.void:
    case TypeName.undefined:
    case TypeName.null:
    case TypeName.boolean:
    case TypeName.bigint:
    case TypeName.symbol:
    case TypeName.literal:
    case TypeName.enum:
      return true;
    case TypeName.string:
    case TypeName.number:
      return (current.def.checks ?? []).length === 0;
    default:
      return false;
  }
}
function buildTemplateLiteralRegex(parts) {
  return new RegExp(`^${parts.map(templateLiteralPartSource).join("")}$`, "u");
}
function temporalConstructorName2(kind) {
  switch (kind) {
    case "instant":
      return "Instant";
    case "plainDate":
      return "PlainDate";
    case "plainTime":
      return "PlainTime";
    case "plainDateTime":
      return "PlainDateTime";
    case "zonedDateTime":
      return "ZonedDateTime";
    case "plainYearMonth":
      return "PlainYearMonth";
    case "plainMonthDay":
      return "PlainMonthDay";
    case "duration":
      return "Duration";
  }
}
function templateLiteralPartSource(part) {
  return typeof part === "string" ? escapeRegExp(part) : templateLiteralSchemaSource(part);
}
function templateLiteralSchemaSource(schema) {
  const current = schema;
  switch (current.type) {
    case TypeName.string:
      return "[\\s\\S]*";
    case TypeName.number:
      return "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?";
    case TypeName.int:
      return "-?(?:0|[1-9]\\d*)";
    case TypeName.boolean:
      return "(?:true|false)";
    case TypeName.bigint:
      return "-?(?:0|[1-9]\\d*)";
    case TypeName.null:
      return "null";
    case TypeName.undefined:
      return "undefined";
    case TypeName.literal:
      return escapeRegExp(String(current.def.value));
    case TypeName.enum: {
      const values = Object.values(current.def.values);
      return values.length === 0 ? "(?!)" : `(?:${values.map((value) => escapeRegExp(String(value))).join("|")})`;
    }
    case TypeName.union:
    case TypeName.xor:
      return `(?:${current.def.options.map((option) => templateLiteralSchemaSource(option)).join("|")})`;
    case TypeName.optional:
      return `(?:${templateLiteralSchemaSource(current.def.innerType)}|undefined)`;
    case TypeName.nullable:
      return `(?:${templateLiteralSchemaSource(current.def.innerType)}|null)`;
    case TypeName.nullish:
      return `(?:${templateLiteralSchemaSource(current.def.innerType)}|null|undefined)`;
    case TypeName.default:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return templateLiteralSchemaSource(current.def.innerType);
    case TypeName.when:
      return `(?:${templateLiteralSchemaSource(current.def.thenType)}|${templateLiteralSchemaSource(current.def.otherwiseType)})`;
    case TypeName.lazy:
      return templateLiteralSchemaSource(current.def.getter());
    default:
      throw new Error(`templateLiteral cannot compile ${current.type} parts`);
  }
}
function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
function staticChild(path, segment) {
  const joiner = segment.startsWith("[") ? "" : path.source === "" ? "" : ".";
  if (path.kind === "static") {
    return { kind: "static", source: `${path.source}${joiner}${segment}` };
  }
  return { kind: "dynamic", source: `${path.source} + ${emitLiteral(`${joiner}${segment}`)}` };
}
function dynamicChild(path, indexVar) {
  const prefix = path.kind === "static" ? emitLiteral(`${path.source}[`) : `${path.source} + "["`;
  return { kind: "dynamic", source: `${prefix} + ${indexVar} + "]"` };
}
function dynamicKeyChild(path, keyExpr) {
  const prefix = path.kind === "static" ? emitLiteral(path.source === "" ? "" : `${path.source}.`) : `${path.source} + "."`;
  return { kind: "dynamic", source: `${prefix} + ${keyExpr}` };
}
function appendIssuePath(path, segments) {
  if (!segments || segments.length === 0) return path;
  const suffix = issuePathSuffix(segments, path.source !== "");
  if (path.kind === "static") {
    return { kind: "static", source: `${path.source}${suffix}` };
  }
  return { kind: "dynamic", source: `${path.source} + ${emitLiteral(suffix)}` };
}
function issuePathSuffix(segments, hasBase) {
  let suffix = "";
  let base = hasBase;
  for (const segment of segments) {
    if (typeof segment === "number") {
      suffix += `[${segment}]`;
      base = true;
      continue;
    }
    suffix += `${base ? "." : ""}${segment}`;
    base = true;
  }
  return suffix;
}
function literalTag(option, discriminator) {
  const base = unwrapPassthrough(option);
  if (base.type !== TypeName.object) return void 0;
  const prop = base.def.props[discriminator];
  if (!prop) return void 0;
  const propBase = unwrapPassthrough(prop);
  if (propBase.type !== TypeName.literal) return void 0;
  const literalValue = propBase.def.value;
  return typeof literalValue === "string" || typeof literalValue === "number" ? literalValue : void 0;
}
function unwrapPassthrough(schema) {
  let current = schema;
  while (true) {
    switch (current.type) {
      case TypeName.optional:
      case TypeName.nullable:
      case TypeName.nullish:
      case TypeName.default:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType;
        continue;
      case TypeName.lazy:
        current = current.def.getter();
        continue;
      default:
        return current;
    }
  }
}
function unwrapValidation(schema, emitter) {
  let current = schema;
  let optional3 = false;
  let nullable3 = false;
  let defaultValue;
  let coerce3;
  const refines = [];
  const pipes = [];
  let fieldTransforms;
  while (true) {
    if (current.type === TypeName.optional) {
      optional3 = true;
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.nullable) {
      nullable3 = true;
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.nullish) {
      optional3 = true;
      nullable3 = true;
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.default) {
      if (!defaultValue) {
        const raw = current.def.defaultValue;
        defaultValue = { binding: emitter.bind(raw), isFactory: typeof raw === "function" };
      }
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.coerce) {
      coerce3 = coerce3 ?? emitter.bind(current.def.coercer);
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.refine) {
      refines.unshift({
        binding: emitter.bind(current.def.predicate),
        ...typeof current.def.message === "string" ? { message: current.def.message } : {},
        ...Array.isArray(current.def.path) ? { path: current.def.path } : {},
        ...typeof current.def.when === "function" ? { when: emitter.bind(current.def.when) } : {}
      });
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.pipe) {
      pipes.unshift(emitter.bind(current.def.transform));
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.transform) {
      fieldTransforms = fieldTransforms ?? bindFieldTransforms(current.def.transforms, emitter);
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.brand || current.type === TypeName.readonly) {
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.lazy) {
      current = current.def.getter();
      continue;
    }
    break;
  }
  return {
    base: current,
    optional: optional3,
    nullable: nullable3,
    defaultValue,
    emptyAsUndefined: hasNoEmptyCheck(current),
    coerce: coerce3,
    refines,
    pipes,
    fieldTransforms
  };
}
function bindFieldTransforms(spec, emitter) {
  const bindings = {};
  for (const [key, fn] of Object.entries(spec)) {
    if (typeof fn === "function") bindings[key] = emitter.bind(fn);
  }
  return bindings;
}
function hasNoEmptyCheck(schema) {
  if (schema.type !== TypeName.string) return false;
  const checks = schema.def.checks ?? [];
  return checks.some((check) => check.kind === "noEmpty");
}
function needsBuild(schema) {
  const current = schema;
  switch (current.type) {
    case TypeName.default:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
    // parseAsync settles promise wrappers, so the output always differs.
    case TypeName.promise:
    case TypeName.codec:
      return true;
    case TypeName.when:
      return needsBuild(current.def.thenType) || needsBuild(current.def.otherwiseType);
    case TypeName.not:
      return false;
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
      return needsBuild(current.def.innerType);
    case TypeName.string: {
      const checks = current.def.checks ?? [];
      if (current.def.coerce === true) return true;
      return checks.some(
        (check) => check.kind === "trim" || check.kind === "lowercase" || check.kind === "uppercase" || check.kind === "sanitize" || check.kind === "noEmpty" || check.kind === "format" || check.kind === "phoneBR"
      );
    }
    case TypeName.number:
    case TypeName.int:
    case TypeName.boolean:
    case TypeName.bigint:
    case TypeName.date:
      return current.def.coerce === true;
    case TypeName.array:
    case TypeName.set:
      return needsBuild(current.def.element);
    case TypeName.map:
      return needsBuild(current.def.key) || needsBuild(current.def.value);
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion:
    case TypeName.intersection:
      return current.def.options.some(needsBuild);
    case TypeName.tuple: {
      const items = current.def.items ?? [];
      const rest = current.def.rest;
      return items.some(needsBuild) || rest !== void 0 && needsBuild(rest);
    }
    case TypeName.record:
      return needsBuild(current.def.value);
    case TypeName.object: {
      const props = current.def.props;
      const catchall2 = current.def.catchall;
      if (current.def.unknownKeys === "strip") return true;
      if (catchall2 !== void 0 && needsBuild(catchall2)) return true;
      return Object.keys(props).some((key) => needsBuild(props[key]));
    }
    default:
      return false;
  }
}
function containsPromise(schema, seen = /* @__PURE__ */ new Set()) {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const current = schema;
  if (current.def === void 0) {
    return current.schema !== void 0 && containsPromise(current.schema, seen);
  }
  if (current.type === TypeName.promise) return true;
  const def = current.def;
  if (def.innerType && containsPromise(def.innerType, seen)) return true;
  if (def.element && containsPromise(def.element, seen)) return true;
  if (def.key && containsPromise(def.key, seen)) return true;
  if (def.value && containsPromise(def.value, seen)) return true;
  if (def.input && containsPromise(def.input, seen)) return true;
  if (def.output && containsPromise(def.output, seen)) return true;
  if (def.thenType && containsPromise(def.thenType, seen)) return true;
  if (def.otherwiseType && containsPromise(def.otherwiseType, seen)) return true;
  if (def.rest && containsPromise(def.rest, seen)) return true;
  if (def.items?.some((item) => containsPromise(item, seen))) return true;
  if (def.options?.some((option) => containsPromise(option, seen))) return true;
  if (def.props) {
    const props = def.props;
    if (Object.keys(props).some((key) => containsPromise(props[key], seen))) return true;
  }
  return false;
}
function rootHasReadonly(schema, seen = /* @__PURE__ */ new Set()) {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const current = schema;
  if (current.type === TypeName.readonly) return true;
  if (current.type === TypeName.lazy) return rootHasReadonly(current.def.getter(), seen);
  switch (current.type) {
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.default:
    case TypeName.brand:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return rootHasReadonly(current.def.innerType, seen);
    case TypeName.when:
      return rootHasReadonly(current.def.thenType, seen) || rootHasReadonly(current.def.otherwiseType, seen);
    case TypeName.not:
      return rootHasReadonly(current.def.innerType, seen);
    default:
      return false;
  }
}
function emitFreezeOutput(writer, output) {
  writer.line(
    `if (${output} !== null && (typeof ${output} === "object" || typeof ${output} === "function")) { ${output} = Object.freeze(${output}); }`
  );
}
function emitValidator(schema, options = {}) {
  const emitIs = options.is ?? true;
  const emitSafeParse = options.safeParse ?? true;
  const emitSafeParseAsync = options.safeParseAsync ?? true;
  const freezesOutput = rootHasReadonly(schema);
  let parseEmitter;
  if (emitSafeParse) {
    const emitter = new ValidatorEmitter("parse");
    parseEmitter = emitter;
    emitter.writer.line("function safeParse(value) {");
    emitter.writer.indent(() => {
      emitter.writer.line("const issues = [];");
      const output = emitter.emitNode(schema, "value", { kind: "static", source: "" });
      emitter.writer.line("if (issues.length !== 0) {");
      emitter.writer.indent(() => {
        emitter.writer.line("return { success: false, issues: issues };");
      });
      emitter.writer.line("}");
      if (freezesOutput) emitFreezeOutput(emitter.writer, output);
      emitter.writer.line(`return { success: true, data: ${output} };`);
    });
    emitter.writer.line("}");
  }
  let asyncEmitter;
  if (emitSafeParseAsync && containsPromise(schema)) {
    const emitter = new ValidatorEmitter("parse", true);
    asyncEmitter = emitter;
    for (const value of parseEmitter?.bindings().values ?? []) emitter.bind(value);
    emitter.writer.line("async function safeParseAsync(value) {");
    emitter.writer.indent(() => {
      emitter.writer.line("const issues = [];");
      const output = emitter.emitNode(schema, "value", { kind: "static", source: "" });
      emitter.writer.line("if (issues.length !== 0) {");
      emitter.writer.indent(() => {
        emitter.writer.line("return { success: false, issues: issues };");
      });
      emitter.writer.line("}");
      if (freezesOutput) emitFreezeOutput(emitter.writer, output);
      emitter.writer.line(`return { success: true, data: ${output} };`);
    });
    emitter.writer.line("}");
  }
  let isEmitter;
  if (emitIs) {
    const emitter = new ValidatorEmitter("is");
    isEmitter = emitter;
    for (const value of (asyncEmitter ?? parseEmitter)?.bindings().values ?? []) emitter.bind(value);
    emitter.writer.line("function is(value) {");
    emitter.writer.indent(() => {
      emitter.emitNode(schema, "value", { kind: "static", source: "" });
      emitter.writer.line("return true;");
    });
    emitter.writer.line("}");
  }
  const emitters = [isEmitter, parseEmitter, asyncEmitter].filter(
    (emitter) => Boolean(emitter)
  );
  const bindings = (isEmitter ?? asyncEmitter ?? parseEmitter)?.bindings() ?? { names: [], values: [] };
  const helperBlocks = emitters.flatMap((emitter) => emitter.helpers());
  const helperSource = helperBlocks.length > 0 ? `${helperBlocks.join("\n")}
` : "";
  const functionSource = emitters.map((emitter) => emitter.writer.toString()).join("\n");
  const returnedEntries = [
    ...isEmitter ? ["is: is"] : [],
    ...parseEmitter ? ["safeParse: safeParse"] : [],
    ...asyncEmitter ? ["safeParseAsync: safeParseAsync"] : []
  ];
  const returned = `return { ${returnedEntries.join(", ")} };`;
  const source = `${helperSource}${functionSource}${functionSource.length > 0 ? "\n" : ""}${returned}`;
  return { source, bindings };
}

// ../../packages/jit/src/compiler/binary-rowset.ts
var DEFAULT_DYNAMIC_BYTES = 8 * 1024 * 1024;
var EMPTY_BUFFER = new ArrayBuffer(0);
var EMPTY_BYTES = new Uint8Array(EMPTY_BUFFER);
var EMPTY_INT32 = new Int32Array(EMPTY_BUFFER);
var EMPTY_UINT32 = new Uint32Array(EMPTY_BUFFER);
var EMPTY_FLOAT32 = new Float32Array(EMPTY_BUFFER);
var EMPTY_FLOAT64 = new Float64Array(EMPTY_BUFFER);
var EMPTY_BIGINT64 = new BigInt64Array(EMPTY_BUFFER);
var EMPTY_OFFSETS = new Uint32Array(EMPTY_BUFFER);
function isBinaryRowSet(value) {
  return value !== null && typeof value === "object" && value.__jitBinaryRowSet === true;
}
function isBinaryArray(value) {
  return value !== null && typeof value === "object" && value.__jitBinaryArray === true;
}
function compileBinaryArray(schema, options = {}, hints = {}) {
  const arraySchema = schema;
  const element = resolveBinaryElement(arraySchema.def.element, "binary rowset");
  const objectSchema = element.schema;
  const layout = createBinaryRowLayout(objectSchema, options.memoryLayout, hints.adaptiveStringFields, element.union);
  const strategy = options.strategy ?? "dynamic";
  const state = createBinaryArrayState(layout, strategy, options);
  const writer = compileRowWriter(layout);
  const hydrate = compileRowHydrator(layout);
  const api = {
    __jitBinaryArray: true,
    schema: arraySchema,
    layout,
    strategy,
    load(values, length) {
      const count = normalizeLength(values.length, length);
      const target = allocateRowBuffer(state, layout, strategy, options, count);
      const dictionaries = createDictionaries(layout);
      resetDictionaries(dictionaries, layout);
      prepareAdaptiveDictionaries(values, count, layout, dictionaries);
      writer(values, count, target, dictionaries);
      return createRowSet(
        objectSchema,
        layout,
        strategy,
        dictionaries,
        target,
        count,
        hydrate
      );
    },
    hydrate,
    clear() {
      state.buffer = void 0;
      state.bufferOffset = 0;
      state.byteLength = 0;
    }
  };
  return Object.freeze(api);
}
function emitBinaryRowSetWriterSource(layout) {
  const writer = new CodeWriter();
  writer.line("function writeRows(input, len, target, dictionaries) {");
  writer.indent(() => {
    emitRowViewBindings(writer, layout.fields, "target");
    emitDictionaryBindings(writer, layout.fields, true);
    emitRowCursorDeclarations(writer, layout, layout.fields);
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = input[i];");
      for (let mask2 = 0; mask2 < layout.maskBytes; mask2++) writer.line(`let m${mask2} = 0;`);
      emitGuardMasks(writer, layout);
      for (let mask2 = 0; mask2 < layout.maskBytes; mask2++) {
        writer.line(`u8[${emitMaskIndex(layout, mask2)}] = m${mask2};`);
      }
      for (const field of layout.fields) emitWriteField(writer, field);
      emitRowCursorAdvance(writer, layout, layout.fields);
    });
    writer.line("}");
  });
  writer.line("}");
  writer.line("return writeRows;");
  return writer.toString();
}
function emitBinaryHydrateSource(layout) {
  const writer = new CodeWriter();
  writer.line("function hydrate(rowset) {");
  writer.indent(() => {
    emitRowViewBindings(writer, layout.fields);
    if (hasDictionary(layout.fields)) writer.line("const dictionaries = rowset.dictionaries;");
    emitDictionaryBindings(writer, layout.fields);
    writer.line("const len = rowset.count;");
    writer.line("const out = new Array(len);");
    emitRowCursorDeclarations(writer, layout, layout.fields);
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      emitHydratedObjectAssignment(writer, layout, "out[i]");
      emitRowCursorAdvance(writer, layout, layout.fields);
    });
    writer.line("}");
    writer.line("return out;");
  });
  writer.line("}");
  writer.line("return hydrate;");
  return writer.toString();
}
function emitBinaryQuerySource(layout, program) {
  const plan = createBinaryQueryPlan(program.nodes);
  const lookup = createFieldLookup(layout);
  validateBinaryQueryPlan(lookup, plan);
  const accessedFields = collectQueryAccessFields(layout, lookup, plan);
  const writer = new CodeWriter();
  const hasParams = Boolean(program.params?.length);
  writer.line(`function query(rowset${hasParams ? ", params" : ""}) {`);
  writer.indent(() => {
    emitRowViewBindings(writer, accessedFields);
    if (hasDictionary(accessedFields)) writer.line("const dictionaries = rowset.dictionaries;");
    writer.line("const len = rowset.count;");
    emitDictionaryBindings(writer, accessedFields);
    const prepared = new PreparedValues(writer);
    const aggregateKey = plan.aggregate?.key;
    const cacheAggregateValue = aggregateKey !== void 0 && filtersReadField(plan.filters, aggregateKey);
    const comparableOverrides = cacheAggregateValue ? /* @__PURE__ */ new Map([[aggregateKey, "v"]]) : void 0;
    const condition = emitBinaryFilter(plan, lookup, prepared, comparableOverrides);
    if (plan.aggregate) {
      emitBinaryAggregateQuery(writer, layout, lookup, plan, condition, accessedFields, cacheAggregateValue);
    } else {
      emitBinaryArrayQuery(writer, layout, plan, condition, accessedFields);
    }
  });
  writer.line("}");
  return writer.toString();
}
function compileBinaryQuery(target, program, options) {
  const layout = target.layout;
  const schema = target.schema;
  const bindingNames = program.bindings.map((_, index) => `__q${index}`);
  const cacheKey = `binary-query:${serializeBinaryLayout(layout)}:${serializeQueryNodes(program.nodes)}`;
  const template = getCompileCached(
    schema,
    cacheKey,
    () => {
      const source = emitBinaryQuerySource(layout, program);
      return {
        source,
        create: globalThis.Function(...bindingNames, `return ${source};`)
      };
    },
    options
  );
  const compiled = template.create(...program.bindings);
  registerArtifact(compiled, {
    kind: "query",
    source: template.source,
    bindingNames,
    bindingValues: program.bindings
  });
  return compiled;
}
function compileRowWriter(layout) {
  return globalThis.Function(emitBinaryRowSetWriterSource(layout))();
}
function compileRowHydrator(layout) {
  return globalThis.Function(emitBinaryHydrateSource(layout))();
}
function getBinaryRowSetByteLength(layout, count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`jit binary rowset: count must be a non-negative integer, got ${count}`);
  }
  if (layout.memoryLayout !== "columnar") return count * layout.rowSize;
  let byteLength = layout.maskBytes * count;
  for (const field of layout.columns) {
    byteLength = alignTo(byteLength, alignmentForSize(field.size));
    byteLength += field.size * count;
  }
  return alignTo(byteLength, layout.alignment);
}
function createColumnOffsets(layout, count) {
  if (layout.memoryLayout !== "columnar") return EMPTY_OFFSETS;
  const offsets = new Uint32Array(layout.columns.length);
  let byteOffset = layout.maskBytes * count;
  for (const field of layout.columns) {
    if (field.columnIndex === void 0) {
      throw new JITError("INVALID_OPERATION", `binary column ${field.key} is missing its physical index`);
    }
    byteOffset = alignTo(byteOffset, alignmentForSize(field.size));
    offsets[field.columnIndex] = byteOffset / field.size;
    byteOffset += field.size * count;
  }
  return offsets;
}
function capacityForByteLength(layout, available) {
  if (layout.memoryLayout !== "columnar") {
    return layout.rowSize === 0 ? Number.MAX_SAFE_INTEGER : Math.floor(available / layout.rowSize);
  }
  let low = 0;
  let high = Math.floor(available / Math.max(layout.rowSize, 1));
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (getBinaryRowSetByteLength(layout, middle) <= available) low = middle;
    else high = middle - 1;
  }
  return low;
}
function createBinaryArrayState(layout, strategy, options) {
  const source = options.buffer;
  const buffer = source instanceof Uint8Array ? source.buffer : source;
  const bufferOffset = source instanceof Uint8Array ? source.byteOffset : 0;
  const byteLength = source instanceof Uint8Array ? source.byteLength : buffer?.byteLength ?? 0;
  if (source instanceof Uint8Array && bufferOffset % layout.alignment !== 0) {
    throw new JITError(
      "INVALID_OPERATION",
      `binary caller buffer byteOffset must be aligned to ${layout.alignment} bytes`
    );
  }
  if (strategy === "static" && options.capacity === void 0 && source === void 0) {
    throw new JITError("INVALID_OPERATION", "binary static strategy requires a row capacity or caller buffer");
  }
  if (strategy === "static" && options.capacity !== void 0 && options.capacity < 0) {
    throw new JITError("INVALID_OPERATION", "binary static capacity must be non-negative");
  }
  return {
    buffer: buffer ?? (strategy === "static" && options.capacity !== void 0 ? new ArrayBuffer(getBinaryRowSetByteLength(layout, options.capacity)) : void 0),
    bufferOffset,
    byteLength: buffer !== void 0 ? byteLength : strategy === "static" && options.capacity !== void 0 ? getBinaryRowSetByteLength(layout, options.capacity) : 0
  };
}
function allocateRowBuffer(state, layout, strategy, options, count) {
  const needed = getBinaryRowSetByteLength(layout, count);
  if (strategy === "exact") {
    const buffer = new ArrayBuffer(needed);
    const bytes2 = new Uint8Array(buffer);
    return createRowTarget(layout, bytes2, count, count);
  }
  if (strategy === "static") {
    const available = state.byteLength;
    if (needed > available) {
      throw new RangeError(`jit binary rowset: static capacity exceeded (${needed} bytes > ${available} bytes)`);
    }
    const buffer = state.buffer ?? EMPTY_BUFFER;
    const bytes2 = new Uint8Array(buffer, state.bufferOffset, needed);
    return createRowTarget(layout, bytes2, capacityForByteLength(layout, available), count);
  }
  const minBytes = Math.max(options.initialBytes ?? DEFAULT_DYNAMIC_BYTES, needed);
  if (state.buffer === void 0 || state.byteLength < needed) {
    let nextSize = Math.max(state.byteLength, 1);
    while (nextSize < minBytes) nextSize *= 2;
    state.buffer = new ArrayBuffer(nextSize);
    state.bufferOffset = 0;
    state.byteLength = nextSize;
  }
  const bytes = new Uint8Array(state.buffer, state.bufferOffset, needed);
  return createRowTarget(layout, bytes, capacityForByteLength(layout, state.byteLength), count);
}
function createRowTarget(layout, bytes, capacity, count) {
  const elements4 = bytes.byteLength / 4;
  const elements8 = bytes.byteLength / 8;
  return {
    bytes,
    int32: layout.views.int32 ? new Int32Array(bytes.buffer, bytes.byteOffset, elements4) : EMPTY_INT32,
    uint32: layout.views.uint32 ? new Uint32Array(bytes.buffer, bytes.byteOffset, elements4) : EMPTY_UINT32,
    float32: layout.views.float32 ? new Float32Array(bytes.buffer, bytes.byteOffset, elements4) : EMPTY_FLOAT32,
    float64: layout.views.float64 ? new Float64Array(bytes.buffer, bytes.byteOffset, elements8) : EMPTY_FLOAT64,
    bigint64: layout.views.bigint64 ? new BigInt64Array(bytes.buffer, bytes.byteOffset, elements8) : EMPTY_BIGINT64,
    offsets: createColumnOffsets(layout, count),
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    capacity
  };
}
function createRowSet(schema, layout, strategy, dictionaries, target, count, hydrate) {
  const rowset = {
    __jitBinaryRowSet: true,
    schema,
    layout,
    buffer: target.bytes.buffer,
    bytes: target.bytes,
    int32: target.int32,
    uint32: target.uint32,
    float32: target.float32,
    float64: target.float64,
    bigint64: target.bigint64,
    offsets: target.offsets,
    view: target.view,
    count,
    capacity: target.capacity,
    strategy,
    dictionaries,
    hydrate() {
      return hydrate(rowset);
    },
    release() {
      rowset.buffer = EMPTY_BUFFER;
      rowset.bytes = EMPTY_BYTES;
      rowset.int32 = EMPTY_INT32;
      rowset.uint32 = EMPTY_UINT32;
      rowset.float32 = EMPTY_FLOAT32;
      rowset.float64 = EMPTY_FLOAT64;
      rowset.bigint64 = EMPTY_BIGINT64;
      rowset.offsets = EMPTY_OFFSETS;
      rowset.view = new DataView(EMPTY_BUFFER);
      rowset.count = 0;
      rowset.capacity = 0;
    }
  };
  return rowset;
}
function normalizeLength(actual, length) {
  if (length === void 0) return actual;
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`jit binary rowset: length must be a non-negative integer, got ${length}`);
  }
  if (length > actual) {
    throw new RangeError(`jit binary rowset: length ${length} exceeds input length ${actual}`);
  }
  return length;
}
function resetDictionaries(dictionaries, layout) {
  for (const dictionary of dictionaries) {
    dictionary.ids.clear();
    dictionary.values.length = 0;
    dictionary.identity = false;
  }
  for (const field of layout.fields) {
    if (field.dictionaryIndex === void 0 || field.values === void 0) continue;
    const dictionary = dictionaries[field.dictionaryIndex];
    for (const value of field.values) {
      dictionary.ids.set(value, dictionary.values.length);
      dictionary.values[dictionary.values.length] = value;
    }
  }
}
function createDictionaries(layout) {
  return layout.fields.filter((field) => field.dictionaryIndex !== void 0).map(() => createDictionary());
}
function createDictionary() {
  return { ids: /* @__PURE__ */ new Map(), values: [], identity: false };
}
function prepareAdaptiveDictionaries(input, count, layout, dictionaries) {
  const sampleSize = Math.min(count, 1024);
  if (sampleSize === 0) return;
  for (const field of layout.fields) {
    if (field.dictionaryMode !== "adaptive" || field.dictionaryIndex === void 0) continue;
    const values = /* @__PURE__ */ new Set();
    let present = 0;
    for (let index = 0; index < sampleSize; index++) {
      const value = input[index][field.key];
      if (typeof value !== "string" && typeof value !== "number") continue;
      present++;
      values.add(value);
    }
    dictionaries[field.dictionaryIndex].identity = present > 0 && values.size * 2 >= present;
  }
}
function resolveBinaryElement(schema, feature) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type === TypeName.object) {
    return { schema: resolved, union: void 0 };
  }
  if (resolved.type === TypeName.intersection) {
    return {
      schema: flattenObjectIntersection(resolved, feature),
      union: void 0
    };
  }
  if (resolved.type === TypeName.union || resolved.type === TypeName.discriminatedUnion) {
    return flattenObjectUnion(resolved, feature);
  }
  throw new JITError(
    "UNSUPPORTED_SCHEMA",
    `${feature} expects object, object intersection, or discriminated object union elements`
  );
}
function flattenObjectIntersection(schema, feature) {
  const options = schema.def.options;
  const fields = /* @__PURE__ */ new Map();
  for (const option of options) {
    const object2 = resolveObjectOption(option, feature);
    for (const key of Object.keys(object2.def.props)) {
      const next = resolvedObjectField(object2.def.props[key]);
      const previous = fields.get(key);
      if (previous && fieldSignature(key, previous.base) !== fieldSignature(key, next.base)) {
        throw new JITError(
          "UNSUPPORTED_SCHEMA",
          `${feature} intersection has incompatible physical definitions for field ${JSON.stringify(key)}`
        );
      }
      fields.set(
        key,
        previous ? {
          base: previous.base,
          optional: previous.optional && next.optional,
          nullable: previous.nullable && next.nullable
        } : next
      );
    }
  }
  return createObjectSchema(fields);
}
function flattenObjectUnion(schema, feature) {
  const options = schema.def.options.map((option) => resolveObjectOption(option, feature));
  const explicit = schema.type === TypeName.discriminatedUnion ? schema.def.discriminator : void 0;
  const discriminator = explicit ?? inferLiteralDiscriminator(options);
  if (!discriminator) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      `${feature} object unions require a shared field with a distinct string or number literal in every option`
    );
  }
  const variants = options.map((option, tag) => {
    const discriminatorSchema = option.def.props[discriminator];
    const value = discriminatorSchema ? scalarLiteralValue(discriminatorSchema) : void 0;
    if (value === void 0) {
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `${feature} discriminator ${JSON.stringify(discriminator)} must be a required string or number literal`
      );
    }
    return {
      tag,
      value,
      keys: Object.keys(option.def.props)
    };
  });
  const values = new Set(variants.map((variant) => `${typeof variant.value}:${String(variant.value)}`));
  if (values.size !== variants.length) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      `${feature} discriminator ${JSON.stringify(discriminator)} contains duplicate literal values`
    );
  }
  const keys = [];
  const seen = /* @__PURE__ */ new Set();
  const merged = /* @__PURE__ */ new Map();
  for (const option of options) {
    for (const key of Object.keys(option.def.props)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys[keys.length] = key;
      }
    }
  }
  for (const key of keys) {
    if (key === discriminator) {
      const literalSchemas = variants.map((variant) => createSchema(TypeName.literal, { value: variant.value }));
      merged.set(key, {
        base: createSchema(TypeName.union, { options: literalSchemas }),
        optional: false,
        nullable: false
      });
      continue;
    }
    let selected;
    let present = 0;
    for (const option of options) {
      const field = option.def.props[key];
      if (!field) continue;
      const next = resolvedObjectField(field);
      if (selected && fieldSignature(key, selected.base) !== fieldSignature(key, next.base)) {
        throw new JITError(
          "UNSUPPORTED_SCHEMA",
          `${feature} union has incompatible physical definitions for field ${JSON.stringify(key)}`
        );
      }
      selected = selected ? {
        base: selected.base,
        optional: selected.optional || next.optional,
        nullable: selected.nullable || next.nullable
      } : next;
      present++;
    }
    if (selected)
      merged.set(key, {
        ...selected,
        optional: selected.optional || present !== options.length
      });
  }
  return {
    schema: createObjectSchema(merged),
    union: { discriminator, variants }
  };
}
function resolveObjectOption(schema, feature) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type === TypeName.object) return resolved;
  if (resolved.type === TypeName.intersection) return flattenObjectIntersection(resolved, feature);
  throw new JITError("UNSUPPORTED_SCHEMA", `${feature} composition options must resolve to object schemas`);
}
function inferLiteralDiscriminator(options) {
  const first = options[0];
  if (!first) return void 0;
  for (const key of Object.keys(first.def.props)) {
    const seen = /* @__PURE__ */ new Set();
    let valid = true;
    for (const option of options) {
      const schema = option.def.props[key];
      const value = schema ? scalarLiteralValue(schema) : void 0;
      if (value === void 0) {
        valid = false;
        break;
      }
      const signature = `${typeof value}:${String(value)}`;
      if (seen.has(signature)) {
        valid = false;
        break;
      }
      seen.add(signature);
    }
    if (valid) return key;
  }
  return void 0;
}
function scalarLiteralValue(schema) {
  const resolved = resolveWrappers(schema);
  if (resolved.optional || resolved.nullable || resolved.base.type !== TypeName.literal) return void 0;
  const value = resolved.base.def.value;
  return typeof value === "string" || typeof value === "number" ? value : void 0;
}
function resolvedObjectField(schema) {
  const resolved = resolveWrappers(schema);
  return {
    base: resolved.base,
    optional: resolved.optional,
    nullable: resolved.nullable
  };
}
function createObjectSchema(fields) {
  const props = {};
  for (const [key, field] of fields) {
    let schema = field.base;
    if (field.nullable) schema = createSchema(TypeName.nullable, { innerType: schema });
    if (field.optional) schema = createSchema(TypeName.optional, { innerType: schema });
    props[key] = schema;
  }
  return createSchema(TypeName.object, { props });
}
function fieldSignature(key, schema) {
  const descriptor = describeField(key, schema);
  return JSON.stringify([descriptor.kind, descriptor.size, descriptor.values, descriptor.literal]);
}
function createBinaryRowLayout(schema, requestedLayout = "auto", adaptiveStringFields, union2 = void 0) {
  const props = schema.def.props;
  const entries = [];
  let dictionaryIndex = 0;
  let guarded = 0;
  for (const key of Object.keys(props)) {
    const resolved = resolveWrappers(props[key]);
    if (resolved.optional || resolved.nullable) guarded++;
  }
  const maskBytes = Math.ceil(guarded / 4);
  let guardIndex = 0;
  let alignment = 1;
  let payloadBytes = maskBytes;
  for (const key of Object.keys(props)) {
    const resolved = resolveWrappers(props[key]);
    const descriptor = describeField(key, resolved.base, adaptiveStringFields);
    const fieldAlignment = alignmentForSize(descriptor.size);
    if (fieldAlignment > alignment) alignment = fieldAlignment;
    const guard = resolved.optional || resolved.nullable ? {
      maskOffset: guardIndex >> 2,
      shift: (guardIndex++ & 3) * 2,
      maskStride: 0
    } : void 0;
    entries[entries.length] = {
      key,
      descriptor,
      guard,
      dictionaryIndex: descriptor.dictionary ? dictionaryIndex++ : void 0
    };
    payloadBytes += descriptor.size;
  }
  const packedOffsets = /* @__PURE__ */ new Map();
  let packedRowSize = maskBytes;
  for (const entry of entries) {
    packedOffsets.set(entry.key, packedRowSize);
    packedRowSize += entry.descriptor.size;
  }
  const naturallyAligned = packedRowSize % alignment === 0 && entries.every((entry) => {
    const fieldAlignment = alignmentForSize(entry.descriptor.size);
    return (packedOffsets.get(entry.key) ?? 0) % fieldAlignment === 0;
  });
  const memoryLayout = requestedLayout === "auto" ? naturallyAligned ? "aligned" : "packed" : requestedLayout;
  const offsets = memoryLayout === "packed" ? packedOffsets : /* @__PURE__ */ new Map();
  const columnIndexes = /* @__PURE__ */ new Map();
  let nextOffset = memoryLayout === "packed" ? packedRowSize : maskBytes;
  if (memoryLayout === "aligned") {
    for (const size of [1, 4, 8]) {
      if (!entries.some((entry) => entry.descriptor.size === size)) continue;
      nextOffset = alignTo(nextOffset, alignmentForSize(size));
      for (const entry of entries) {
        if (entry.descriptor.size !== size) continue;
        offsets.set(entry.key, nextOffset);
        nextOffset += size;
      }
    }
  }
  if (memoryLayout === "columnar") {
    let columnIndex = 0;
    for (const size of [1, 4, 8]) {
      for (const entry of entries) {
        if (entry.descriptor.size !== size) continue;
        columnIndexes.set(entry.key, columnIndex++);
      }
    }
  }
  const rowSize = memoryLayout === "columnar" ? payloadBytes : memoryLayout === "aligned" ? alignTo(nextOffset, alignment) : nextOffset;
  const requiredAlignment = memoryLayout === "packed" ? 1 : alignment;
  const fields = entries.map((entry) => {
    const columnIndex = columnIndexes.get(entry.key);
    return {
      key: entry.key,
      kind: entry.descriptor.kind,
      offset: offsets.get(entry.key) ?? nextOffset,
      size: entry.descriptor.size,
      access: fieldAccess(entry.descriptor, memoryLayout),
      ...entry.guard ? {
        guard: {
          maskOffset: entry.guard.maskOffset,
          shift: entry.guard.shift,
          maskStride: memoryLayout === "columnar" ? maskBytes : 0
        }
      } : {},
      ...columnIndex !== void 0 ? { columnIndex } : {},
      ...entry.dictionaryIndex !== void 0 ? {
        dictionaryIndex: entry.dictionaryIndex,
        dictionaryMode: entry.descriptor.dictionary
      } : {},
      ...entry.descriptor.values ? { values: entry.descriptor.values } : {},
      ...entry.descriptor.literal !== void 0 ? { literal: entry.descriptor.literal } : {}
    };
  });
  const columns = memoryLayout === "columnar" ? fields.filter((field) => field.columnIndex !== void 0).sort((left, right) => (left.columnIndex ?? 0) - (right.columnIndex ?? 0)) : [];
  return {
    schema,
    rowSize,
    maskBytes,
    alignment: requiredAlignment,
    paddingBytes: memoryLayout === "columnar" ? 0 : rowSize - payloadBytes,
    memoryLayout,
    views: createViewUsage(fields),
    fields,
    columns,
    union: union2
  };
}
function fieldAccess(descriptor, memoryLayout) {
  if (descriptor.size === 0) return "none";
  if (descriptor.size === 1) return "byte";
  if (memoryLayout === "packed") return "dataView";
  switch (descriptor.kind) {
    case "int32":
      return "int32";
    case "float32":
      return "float32";
    case "float64":
    case "date":
      return "float64";
    case "bigint":
      return "bigint64";
    case "string":
    case "enum":
    case "literalUnion":
      return "uint32";
    default:
      throw new JITError("INVALID_OPERATION", `binary field ${descriptor.kind} has no aligned access strategy`);
  }
}
function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}
function alignmentForSize(size) {
  if (size === 8) return 8;
  if (size === 4) return 4;
  return 1;
}
function createViewUsage(fields) {
  let int32 = false;
  let uint32 = false;
  let float32 = false;
  let float64 = false;
  let bigint64 = false;
  for (const field of fields) {
    switch (field.access) {
      case "int32":
        int32 = true;
        break;
      case "uint32":
        uint32 = true;
        break;
      case "float32":
        float32 = true;
        break;
      case "float64":
        float64 = true;
        break;
      case "bigint64":
        bigint64 = true;
        break;
      default:
        break;
    }
  }
  return { int32, uint32, float32, float64, bigint64 };
}
function getAccessNeeds(fields) {
  const views = createViewUsage(fields);
  let bytes = false;
  let dataView = false;
  let words = false;
  let doubles = false;
  for (const field of fields) {
    if (field.guard !== void 0 || field.access === "byte") bytes = true;
    if (field.access === "dataView") dataView = true;
    if (field.access === "int32" || field.access === "uint32" || field.access === "float32") words = true;
    if (field.access === "float64" || field.access === "bigint64") doubles = true;
  }
  return { bytes, dataView, words, doubles, views };
}
function emitRowViewBindings(writer, fields, source = "rowset") {
  const needs = getAccessNeeds(fields);
  const columnIndexes = /* @__PURE__ */ new Set();
  if (needs.bytes) writer.line(`const u8 = ${source}.bytes;`);
  if (needs.dataView) writer.line(`const dv = ${source}.view;`);
  if (needs.views.int32) writer.line(`const int32 = ${source}.int32;`);
  if (needs.views.uint32) writer.line(`const uint32 = ${source}.uint32;`);
  if (needs.views.float32) writer.line(`const float32 = ${source}.float32;`);
  if (needs.views.float64) writer.line(`const float64 = ${source}.float64;`);
  if (needs.views.bigint64) writer.line(`const bigint64 = ${source}.bigint64;`);
  for (const field of fields) {
    if (field.columnIndex !== void 0) columnIndexes.add(field.columnIndex);
  }
  if (columnIndexes.size > 0) {
    writer.line(`const offsets = ${source}.offsets;`);
    for (const columnIndex of columnIndexes) writer.line(`const b${columnIndex} = offsets[${columnIndex}];`);
  }
}
function emitDictionaryBindings(writer, fields, includeAdaptiveMode = false) {
  for (const field of fields) {
    if (field.dictionaryIndex !== void 0) {
      writer.line(`const d${field.dictionaryIndex} = dictionaries[${field.dictionaryIndex}];`);
      if (includeAdaptiveMode && field.dictionaryMode === "adaptive") {
        writer.line(`const a${field.dictionaryIndex} = d${field.dictionaryIndex}.identity;`);
      }
    }
  }
}
function hasDictionary(fields) {
  return fields.some((field) => field.dictionaryIndex !== void 0);
}
function emitRowCursorDeclarations(writer, layout, fields) {
  if (layout.memoryLayout === "columnar") return;
  const needs = getAccessNeeds(fields);
  if (needs.bytes || needs.dataView) writer.line("let o = 0;");
  if (needs.words) writer.line("let w = 0;");
  if (needs.doubles) writer.line("let d = 0;");
}
function emitRowCursorAdvance(writer, layout, fields) {
  if (layout.memoryLayout === "columnar") return;
  const needs = getAccessNeeds(fields);
  if (needs.bytes || needs.dataView) writer.line(`o += ${layout.rowSize};`);
  if (needs.words) writer.line(`w += ${layout.rowSize / 4};`);
  if (needs.doubles) writer.line(`d += ${layout.rowSize / 8};`);
}
function describeField(key, schema, adaptiveStringFields) {
  switch (schema.type) {
    case TypeName.number:
    case TypeName.nan:
      return numberField(schema);
    case TypeName.int:
      return { kind: "int32", size: 4 };
    case TypeName.boolean:
      return { kind: "boolean", size: 1 };
    case TypeName.bigint:
      return { kind: "bigint", size: 8 };
    case TypeName.date:
      return { kind: "date", size: 8 };
    case TypeName.string:
      return {
        kind: "string",
        size: 4,
        dictionary: adaptiveStringFields?.has(key) ? "adaptive" : "dynamic"
      };
    case TypeName.enum: {
      const values = Object.values(schema.def.values);
      return {
        kind: "enum",
        size: values.length <= 255 ? 1 : 4,
        dictionary: "fixed",
        values
      };
    }
    case TypeName.literal:
      return {
        kind: "literal",
        size: 0,
        literal: schema.def.value
      };
    case TypeName.null:
      return { kind: "null", size: 0 };
    case TypeName.undefined:
      return { kind: "undefined", size: 0 };
    case TypeName.union:
    case TypeName.xor: {
      const values = literalUnionValues(schema);
      if (values)
        return {
          kind: "literalUnion",
          size: values.length <= 255 ? 1 : 4,
          dictionary: "fixed",
          values
        };
      break;
    }
  }
  throw new JITError(
    "UNSUPPORTED_SCHEMA",
    `binary rowset does not support field ${JSON.stringify(key)} (${schema.type}); use flat scalar object fields in v1`
  );
}
function numberField(schema) {
  const checks = (schema.def.checks ?? []).map(
    (check) => check.kind
  );
  if (checks.includes("int32")) return { kind: "int32", size: 4 };
  if (checks.includes("float32")) return { kind: "float32", size: 4 };
  return { kind: "float64", size: 8 };
}
function literalUnionValues(schema) {
  const values = [];
  const options = schema.def.options;
  for (const option of options) {
    const resolved = resolveWrappers(option).base;
    if (resolved.type !== TypeName.literal) return void 0;
    const value = resolved.def.value;
    if (typeof value !== "string" && typeof value !== "number") return void 0;
    values[values.length] = value;
  }
  return values;
}
function emitGuardMasks(writer, layout) {
  for (const field of layout.fields) {
    if (!field.guard) continue;
    const prop = emitPropertyAccess("item", field.key);
    const mask2 = `m${field.guard.maskOffset}`;
    writer.line(
      `if (${prop} === null) ${mask2} |= ${1 << field.guard.shift}; else if (${prop} !== undefined) ${mask2} |= ${2 << field.guard.shift};`
    );
  }
}
function emitWriteField(writer, field) {
  const prop = emitPropertyAccess("item", field.key);
  const write = () => emitWriteScalar(writer, field, prop);
  if (!field.guard) {
    write();
    return;
  }
  writer.line(`if (${prop} != null) {`);
  writer.indent(write);
  writer.line("}");
}
function emitWriteScalar(writer, field, valueExpr) {
  const offset = emitByteIndex(field);
  switch (field.kind) {
    case "float64":
      writer.line(
        field.access === "dataView" ? `dv.setFloat64(${offset}, ${valueExpr}, true);` : `float64[${emitTypedIndex(field)}] = ${valueExpr};`
      );
      return;
    case "float32":
      writer.line(
        field.access === "dataView" ? `dv.setFloat32(${offset}, ${valueExpr}, true);` : `float32[${emitTypedIndex(field)}] = ${valueExpr};`
      );
      return;
    case "int32":
      writer.line(
        field.access === "dataView" ? `dv.setInt32(${offset}, ${valueExpr}, true);` : `int32[${emitTypedIndex(field)}] = ${valueExpr};`
      );
      return;
    case "boolean":
      writer.line(`u8[${offset}] = ${valueExpr} ? 1 : 0;`);
      return;
    case "bigint":
      writer.line(
        field.access === "dataView" ? `dv.setBigInt64(${offset}, ${valueExpr}, true);` : `bigint64[${emitTypedIndex(field)}] = ${valueExpr};`
      );
      return;
    case "date":
      writer.line(
        field.access === "dataView" ? `dv.setFloat64(${offset}, ${valueExpr}.getTime(), true);` : `float64[${emitTypedIndex(field)}] = ${valueExpr}.getTime();`
      );
      return;
    case "string":
    case "enum":
    case "literalUnion":
      emitDictionaryWrite(writer, field, valueExpr, offset);
      return;
    case "literal":
    case "null":
    case "undefined":
      return;
  }
}
function emitDictionaryWrite(writer, field, valueExpr, offset) {
  const dictionary = `d${field.dictionaryIndex}`;
  const code = `c${field.dictionaryIndex}_${field.offset}`;
  const emitIndexedWrite = (declaration) => {
    writer.line(`${declaration === "let" ? "let " : ""}${code} = ${dictionary}.ids.get(${valueExpr});`);
    writer.line(`if (${code} === undefined) {`);
    writer.indent(() => {
      if (field.dictionaryMode === "fixed") {
        writer.line(
          `throw new RangeError("jit binary rowset: value not in fixed dictionary for ${field.key}: " + ${valueExpr});`
        );
      } else {
        writer.line(`${code} = ${dictionary}.values.length;`);
        writer.line(`${dictionary}.ids.set(${valueExpr}, ${code});`);
        writer.line(`${dictionary}.values[${code}] = ${valueExpr};`);
      }
    });
    writer.line("}");
  };
  if (field.dictionaryMode === "adaptive") {
    writer.line(`let ${code};`);
    writer.line(`if (a${field.dictionaryIndex}) {`);
    writer.indent(() => {
      writer.line(`${code} = ${dictionary}.values.length;`);
      writer.line(`${dictionary}.values[${code}] = ${valueExpr};`);
    });
    writer.line("} else {");
    writer.indent(() => emitIndexedWrite("assign"));
    writer.line("}");
  } else {
    emitIndexedWrite("let");
  }
  if (field.size === 1) writer.line(`u8[${offset}] = ${code};`);
  else if (field.access === "dataView") writer.line(`dv.setUint32(${offset}, ${code}, true);`);
  else writer.line(`uint32[${emitTypedIndex(field)}] = ${code};`);
}
function emitObjectExpression(fields, selected) {
  const wanted = selected ? new Set(selected) : void 0;
  const entries = [];
  for (const field of fields) {
    if (wanted && !wanted.has(field.key)) continue;
    entries[entries.length] = `${emitLiteral(field.key)}: ${emitFieldValue(field)}`;
  }
  return `{ ${entries.join(", ")} }`;
}
function emitHydratedObjectAssignment(writer, layout, target) {
  const union2 = layout.union;
  if (!union2) {
    writer.line(`${target} = ${emitObjectExpression(layout.fields)};`);
    return;
  }
  const discriminator = layout.fields.find((field) => field.key === union2.discriminator);
  if (!discriminator) {
    throw new JITError("INVALID_OPERATION", `binary union discriminator ${union2.discriminator} is missing`);
  }
  writer.line(`switch (${emitFieldComparable(discriminator)}) {`);
  writer.indent(() => {
    for (const variant of union2.variants) {
      writer.line(`case ${variant.tag}:`);
      writer.indent(() => {
        writer.line(`${target} = ${emitObjectExpression(layout.fields, variant.keys)};`);
        writer.line("break;");
      });
    }
    writer.line("default:");
    writer.indent(() => writer.line('throw new RangeError("jit binary rowset: invalid union tag");'));
  });
  writer.line("}");
}
function emitFieldValue(field) {
  const read = emitScalarRead(field);
  if (!field.guard) return read;
  const state = emitGuardState(field);
  return `(${state} === 1 ? null : ${state} === 2 ? ${read} : undefined)`;
}
function emitScalarRead(field) {
  const offset = emitByteIndex(field);
  switch (field.kind) {
    case "float64":
      return field.access === "dataView" ? `dv.getFloat64(${offset}, true)` : `float64[${emitTypedIndex(field)}]`;
    case "float32":
      return field.access === "dataView" ? `dv.getFloat32(${offset}, true)` : `float32[${emitTypedIndex(field)}]`;
    case "int32":
      return field.access === "dataView" ? `dv.getInt32(${offset}, true)` : `int32[${emitTypedIndex(field)}]`;
    case "boolean":
      return `u8[${offset}] !== 0`;
    case "bigint":
      return field.access === "dataView" ? `dv.getBigInt64(${offset}, true)` : `bigint64[${emitTypedIndex(field)}]`;
    case "date":
      return field.access === "dataView" ? `new Date(dv.getFloat64(${offset}, true))` : `new Date(float64[${emitTypedIndex(field)}])`;
    case "string":
    case "enum":
    case "literalUnion":
      return `d${field.dictionaryIndex}.values[${field.size === 1 ? `u8[${offset}]` : field.access === "dataView" ? `dv.getUint32(${offset}, true)` : `uint32[${emitTypedIndex(field)}]`}]`;
    case "literal":
      return emitLiteral(field.literal);
    case "null":
      return "null";
    case "undefined":
      return "undefined";
  }
}
function emitFieldComparable(field) {
  const offset = emitByteIndex(field);
  switch (field.kind) {
    case "boolean":
      return `u8[${offset}]`;
    case "date":
      return field.access === "dataView" ? `dv.getFloat64(${offset}, true)` : `float64[${emitTypedIndex(field)}]`;
    case "string":
    case "enum":
    case "literalUnion":
      return field.size === 1 ? `u8[${offset}]` : field.access === "dataView" ? `dv.getUint32(${offset}, true)` : `uint32[${emitTypedIndex(field)}]`;
    default:
      return emitScalarRead(field);
  }
}
function emitTypedIndex(field) {
  if (field.columnIndex !== void 0) return `b${field.columnIndex} + i`;
  if (field.size === 8) return `d + ${field.offset / 8}`;
  if (field.size === 4) return `w + ${field.offset / 4}`;
  throw new JITError("INVALID_OPERATION", `binary field ${field.key} does not use a typed index`);
}
function emitByteIndex(field) {
  return field.columnIndex === void 0 ? `o + ${field.offset}` : `b${field.columnIndex} + i`;
}
function emitMaskIndex(layout, maskOffset) {
  if (layout.memoryLayout !== "columnar") return `o + ${maskOffset}`;
  if (layout.maskBytes === 1) return "i";
  return `i * ${layout.maskBytes} + ${maskOffset}`;
}
function emitGuardState(field) {
  if (!field.guard) return "2";
  const maskIndex = field.guard.maskStride === 0 ? `o + ${field.guard.maskOffset}` : field.guard.maskStride === 1 ? "i" : `i * ${field.guard.maskStride} + ${field.guard.maskOffset}`;
  return `((u8[${maskIndex}] >> ${field.guard.shift}) & 3)`;
}
function createBinaryQueryPlan(nodes) {
  const filters = [];
  let select;
  let aggregate;
  for (const node of nodes) {
    switch (node.kind) {
      case "filter":
        filters[filters.length] = node;
        break;
      case "select:fields":
        select = node;
        break;
      case "aggregate":
        aggregate = node;
        break;
      default:
        throw new JITError(
          "INVALID_QUERY",
          `binary rowset query supports filter, select, and aggregate in v1; received ${node.kind}`
        );
    }
  }
  if (select && aggregate) {
    throw new JITError("INVALID_QUERY", "binary rowset aggregate cannot be combined with select in v1");
  }
  return { filters, select, aggregate };
}
function createFieldLookup(layout) {
  return { fields: new Map(layout.fields.map((field) => [field.key, field])) };
}
function validateBinaryQueryPlan(lookup, plan) {
  for (const filter of plan.filters) validateCondition(lookup, filter.condition);
  if (plan.select) validateKeys(lookup, plan.select.fields, "binary query select");
  if (plan.aggregate?.key) validateKeys(lookup, [plan.aggregate.key], `binary query ${plan.aggregate.op}`);
}
function validateCondition(lookup, condition) {
  switch (condition.kind) {
    case "compare":
      validateValue(lookup, condition.left);
      validateValue(lookup, condition.right);
      return;
    case "logical":
      validateCondition(lookup, condition.left);
      validateCondition(lookup, condition.right);
      return;
    case "not":
      validateCondition(lookup, condition.inner);
      return;
  }
}
function validateValue(lookup, value) {
  if (value.kind === "field") validateKeys(lookup, [value.key], "binary query filter");
}
function validateKeys(lookup, keys, label) {
  for (const key of keys) {
    if (!lookup.fields.has(key)) throw new JITError("INVALID_QUERY", `${label} received unknown key ${key}`);
  }
}
function collectQueryAccessFields(layout, lookup, plan) {
  const keys = /* @__PURE__ */ new Set();
  for (const filter of plan.filters) collectConditionFieldKeys(filter.condition, keys);
  if (plan.aggregate?.key) {
    keys.add(plan.aggregate.key);
  } else if (!plan.aggregate) {
    if (plan.select) {
      for (const key of plan.select.fields) keys.add(key);
    } else {
      for (const field of layout.fields) keys.add(field.key);
    }
  }
  return layout.fields.filter((field) => keys.has(field.key) && lookup.fields.has(field.key));
}
function collectConditionFieldKeys(condition, keys) {
  switch (condition.kind) {
    case "compare":
      if (condition.left.kind === "field") keys.add(condition.left.key);
      if (condition.right.kind === "field") keys.add(condition.right.key);
      return;
    case "logical":
      collectConditionFieldKeys(condition.left, keys);
      collectConditionFieldKeys(condition.right, keys);
      return;
    case "not":
      collectConditionFieldKeys(condition.inner, keys);
      return;
  }
}
function filtersReadField(filters, key) {
  const keys = /* @__PURE__ */ new Set();
  for (const filter of filters) collectConditionFieldKeys(filter.condition, keys);
  return keys.has(key);
}
function emitBinaryFilter(plan, lookup, prepared, comparableOverrides) {
  if (plan.filters.length === 0) return void 0;
  return plan.filters.map((filter) => emitCondition(filter.condition, lookup, prepared, comparableOverrides)).join(" && ");
}
function emitBinaryArrayQuery(writer, layout, plan, condition, accessedFields) {
  writer.line("const out = new Array(len);");
  writer.line("let j = 0;");
  emitRowCursorDeclarations(writer, layout, accessedFields);
  writer.line("for (let i = 0; i < len; i++) {");
  writer.indent(() => {
    const accepted = () => {
      if (layout.union && !plan.select) {
        emitHydratedObjectAssignment(writer, layout, "out[j++]");
      } else {
        writer.line(`out[j++] = ${emitObjectExpression(layout.fields, plan.select?.fields)};`);
      }
    };
    if (condition) {
      writer.line(`if (${condition}) {`);
      writer.indent(accepted);
      writer.line("}");
    } else {
      accepted();
    }
    emitRowCursorAdvance(writer, layout, accessedFields);
  });
  writer.line("}");
  writer.line("out.length = j;");
  writer.line("return out;");
}
function emitBinaryAggregateQuery(writer, layout, lookup, plan, condition, accessedFields, cacheAggregateValue) {
  const aggregate = plan.aggregate;
  if (!aggregate) return;
  const field = aggregate.key ? lookup.fields.get(aggregate.key) : void 0;
  const accepted = (body) => {
    if (condition) {
      writer.line(`if (${condition}) {`);
      writer.indent(body);
      writer.line("}");
    } else {
      body();
    }
  };
  if (aggregate.op === "count") {
    writer.line("let acc = 0;");
    emitRowCursorDeclarations(writer, layout, accessedFields);
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      accepted(() => writer.line("acc++;"));
      emitRowCursorAdvance(writer, layout, accessedFields);
    });
    writer.line("}");
    writer.line("return acc;");
    return;
  }
  if (!field) throw new JITError("INVALID_QUERY", `binary query ${aggregate.op} requires a field key`);
  if (field.kind !== "float64" && field.kind !== "float32" && field.kind !== "int32") {
    throw new JITError("INVALID_QUERY", `binary query ${aggregate.op} expects a numeric field`);
  }
  const rawValue = emitFieldComparable(field);
  const value = cacheAggregateValue ? "v" : rawValue;
  const present = field.guard ? `${emitGuardState(field)} === 2` : "true";
  switch (aggregate.op) {
    case "sum":
      writer.line("let acc = 0;");
      emitRowCursorDeclarations(writer, layout, accessedFields);
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        if (cacheAggregateValue) writer.line(`const v = ${rawValue};`);
        const shouldAdd = condition ? field.guard ? `(${condition}) && ${present}` : condition : present;
        if (shouldAdd === "true") writer.line(`acc += ${value};`);
        else writer.line(`acc += (${shouldAdd}) ? ${value} : 0;`);
        emitRowCursorAdvance(writer, layout, accessedFields);
      });
      writer.line("}");
      writer.line("return acc;");
      return;
    case "avg":
      writer.line("let acc = 0;");
      writer.line("let n = 0;");
      emitRowCursorDeclarations(writer, layout, accessedFields);
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        if (cacheAggregateValue) writer.line(`const v = ${rawValue};`);
        accepted(() => {
          writer.line(`if (${present}) {`);
          writer.indent(() => {
            writer.line(`acc += ${value};`);
            writer.line("n++;");
          });
          writer.line("}");
        });
        emitRowCursorAdvance(writer, layout, accessedFields);
      });
      writer.line("}");
      writer.line("return n === 0 ? undefined : acc / n;");
      return;
    case "min":
    case "max": {
      const op = aggregate.op === "min" ? "<" : ">";
      writer.line("let acc;");
      emitRowCursorDeclarations(writer, layout, accessedFields);
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        if (cacheAggregateValue) writer.line(`const v = ${rawValue};`);
        accepted(() => {
          writer.line(`if (${present}) {`);
          writer.indent(() => {
            writer.line(`const candidate = ${value};`);
            writer.line(`if (acc === undefined || candidate ${op} acc) acc = candidate;`);
          });
          writer.line("}");
        });
        emitRowCursorAdvance(writer, layout, accessedFields);
      });
      writer.line("}");
      writer.line("return acc;");
      return;
    }
  }
}
function emitCondition(condition, lookup, prepared, comparableOverrides) {
  switch (condition.kind) {
    case "compare":
      return emitCompare(condition.left, condition.op, condition.right, lookup, prepared, comparableOverrides);
    case "logical":
      return `(${emitCondition(condition.left, lookup, prepared, comparableOverrides)} ${condition.op === "and" ? "&&" : "||"} ${emitCondition(
        condition.right,
        lookup,
        prepared,
        comparableOverrides
      )})`;
    case "not":
      return `!(${emitCondition(condition.inner, lookup, prepared, comparableOverrides)})`;
  }
}
function emitCompare(left, op, right, lookup, prepared, comparableOverrides) {
  if (left.kind === "field") {
    const field = expectField(lookup, left.key);
    return emitFieldCompare(field, op, right, prepared, comparableOverrides?.get(left.key));
  }
  if (right.kind === "field") {
    const field = expectField(lookup, right.key);
    return emitFieldCompare(field, reverseCompare(op), left, prepared, comparableOverrides?.get(right.key));
  }
  throw new JITError("INVALID_QUERY", "binary rowset comparisons require at least one field operand");
}
function emitFieldCompare(field, op, value, prepared, comparableOverride) {
  if (field.dictionaryMode === "adaptive") {
    throw new JITError("INVALID_QUERY", `binary adaptive string field ${field.key} is projection-only`);
  }
  const comparable = comparableOverride ?? emitFieldComparable(field);
  const valueExpr = prepared.valueFor(field, value);
  const equality = field.guard === void 0 ? `${comparable} === ${valueExpr}` : `((${prepared.rawFor(value)} === undefined && ${emitGuardState(field)} === 0) || (${prepared.rawFor(
    value
  )} === null && ${emitGuardState(field)} === 1) || (${emitGuardState(field)} === 2 && ${comparable} === ${valueExpr}))`;
  if (op === "eq") return equality;
  if (op === "neq") return `!(${equality})`;
  if (field.kind === "string" || field.kind === "enum" || field.kind === "literalUnion") {
    throw new JITError("INVALID_QUERY", `binary rowset ${op} does not support dictionary fields`);
  }
  const present = field.guard ? `${emitGuardState(field)} === 2 && ` : "";
  const operator = op === "gt" ? ">" : op === "gte" ? ">=" : op === "lt" ? "<" : "<=";
  return `(${present}${comparable} ${operator} ${valueExpr})`;
}
function expectField(lookup, key) {
  const field = lookup.fields.get(key);
  if (!field) throw new JITError("INVALID_QUERY", `binary rowset query received unknown key ${key}`);
  return field;
}
function reverseCompare(op) {
  switch (op) {
    case "gt":
      return "lt";
    case "gte":
      return "lte";
    case "lt":
      return "gt";
    case "lte":
      return "gte";
    default:
      return op;
  }
}
var PreparedValues = class {
  #writer;
  #prepared = /* @__PURE__ */ new Map();
  constructor(writer) {
    this.#writer = writer;
  }
  rawFor(value) {
    switch (value.kind) {
      case "binding":
        return value.name;
      case "param":
        return `params${emitPropertyAccess("", value.name)}`;
      case "literal":
        return emitLiteral(value.value);
      case "field":
        throw new JITError("INVALID_QUERY", "field-to-field dictionary comparisons are not supported in binary v1");
    }
  }
  valueFor(field, value) {
    if (field.kind === "boolean") {
      const raw = this.rawFor(value);
      const key = `boolean:${raw}`;
      const existing = this.#prepared.get(key);
      if (existing) return existing;
      const name = `p${this.#prepared.size}`;
      this.#writer.line(`const ${name} = ${raw} === true ? 1 : ${raw} === false ? 0 : -1;`);
      this.#prepared.set(key, name);
      return name;
    }
    if (field.kind === "date") {
      const raw = this.rawFor(value);
      const key = `date:${raw}`;
      const existing = this.#prepared.get(key);
      if (existing) return existing;
      const name = `p${this.#prepared.size}`;
      this.#writer.line(`const ${name} = ${raw} instanceof Date ? ${raw}.getTime() : ${raw};`);
      this.#prepared.set(key, name);
      return name;
    }
    if (field.kind === "string" || field.kind === "enum" || field.kind === "literalUnion") {
      const raw = this.rawFor(value);
      const key = `dict:${field.dictionaryIndex}:${raw}`;
      const existing = this.#prepared.get(key);
      if (existing) return existing;
      const name = `p${this.#prepared.size}`;
      this.#writer.line(`const ${name} = d${field.dictionaryIndex}.ids.get(${raw});`);
      this.#prepared.set(key, name);
      return name;
    }
    return this.rawFor(value);
  }
};
function serializeQueryNodes(nodes) {
  return nodes.map(serializeQueryNode).join(";");
}
function serializeBinaryLayout(layout) {
  return JSON.stringify([
    layout.memoryLayout,
    layout.rowSize,
    layout.maskBytes,
    layout.union ? [layout.union.discriminator, layout.union.variants.map((variant) => [variant.tag, variant.value, variant.keys])] : void 0,
    layout.fields.map((field) => [
      field.key,
      field.kind,
      field.offset,
      field.size,
      field.access,
      field.columnIndex,
      field.guard?.maskOffset,
      field.guard?.shift
    ])
  ]);
}
function serializeQueryNode(node) {
  switch (node.kind) {
    case "filter":
      return `f(${serializeCondition(node.condition)})`;
    case "select:fields":
      return `s(${node.fields.join(",")})`;
    case "aggregate":
      return `a(${node.op},${node.key ?? ""})`;
    case "unique":
      return `u(${node.key})`;
    case "keyed":
      return `k(${node.key})`;
    case "groupBy":
      return `g(${node.key})`;
    case "orderBy":
      return `o(${node.key},${node.direction})`;
    case "delete":
      return "d()";
    case "update":
      return `m(${Object.keys(node.patch).join(",")})`;
  }
}
function serializeCondition(condition) {
  switch (condition.kind) {
    case "compare":
      return `${condition.op}(${serializeValue(condition.left)},${serializeValue(condition.right)})`;
    case "logical":
      return `${condition.op}(${serializeCondition(condition.left)},${serializeCondition(condition.right)})`;
    case "not":
      return `not(${serializeCondition(condition.inner)})`;
  }
}
function serializeValue(value) {
  switch (value.kind) {
    case "field":
      return `.${value.key}`;
    case "binding":
      return `$${value.name}`;
    case "param":
      return `p:${value.name}`;
    case "literal":
      return `#${typeof value.value}:${String(value.value)}`;
  }
}

// ../../packages/jit/src/compiler/validate.ts
var VALIDATOR_OPS = ["is", "parse", "safeParse", "parseAsync", "safeParseAsync"];
function emitValidatorSource(schema, options) {
  return emitValidator(schema, emitOptionsForValidatorOps(options?.ops ?? VALIDATOR_OPS)).source;
}
function compileValidator(schema, options) {
  return compileValidatorSelection(schema, VALIDATOR_OPS, options);
}
function compileValidatorSelection(schema, ops, options) {
  const normalizedOps = normalizeValidatorOps(ops);
  const cacheKey = `validator:${normalizedOps.join(",")}`;
  return getCompileCached(
    schema,
    cacheKey,
    () => {
      const emitted = emitValidator(schema, emitOptionsForValidatorOps(normalizedOps));
      const compiled = globalThis.Function(...emitted.bindings.names, emitted.source)(...emitted.bindings.values);
      const selection = {};
      const safeParse = compiled.safeParse;
      const parse = (value) => {
        if (!safeParse) throw new Error("parse requires safeParse generation");
        const result = safeParse(value);
        if (result.success) return result.data;
        throw new JITValidationError(result.issues);
      };
      const safeParseAsync = compiled.safeParseAsync ?? (safeParse ? async (value) => safeParse(value) : void 0);
      const parseAsync = async (value) => {
        if (!safeParseAsync) throw new Error("parseAsync requires async validation generation");
        const result = await safeParseAsync(value);
        if (result.success) return result.data;
        throw new JITValidationError(result.issues);
      };
      if (normalizedOps.includes("is") && compiled.is) {
        selection.is = compiled.is;
        registerValidatorArtifact(compiled.is, schema, "is");
      }
      if (normalizedOps.includes("safeParse") && safeParse) {
        selection.safeParse = safeParse;
        registerValidatorArtifact(safeParse, schema, "safeParse");
      }
      if (normalizedOps.includes("parse")) {
        selection.parse = parse;
        registerValidatorArtifact(parse, schema, "parse");
      }
      if (normalizedOps.includes("safeParseAsync") && safeParseAsync) {
        selection.safeParseAsync = safeParseAsync;
        registerValidatorArtifact(safeParseAsync, schema, "safeParseAsync");
      }
      if (normalizedOps.includes("parseAsync")) {
        selection.parseAsync = parseAsync;
        registerValidatorArtifact(parseAsync, schema, "parseAsync");
      }
      return selection;
    },
    options
  );
}
function registerValidatorArtifact(fn, schema, op) {
  registerArtifact(fn, { kind: "validator", schema, op });
}
function normalizeValidatorOps(ops) {
  const normalized = [];
  for (const op of VALIDATOR_OPS) {
    if (ops.includes(op)) normalized.push(op);
  }
  return normalized;
}
function emitOptionsForValidatorOps(ops) {
  return {
    is: ops.includes("is"),
    safeParse: ops.includes("safeParse") || ops.includes("parse") || ops.includes("safeParseAsync") || ops.includes("parseAsync"),
    safeParseAsync: ops.includes("safeParseAsync") || ops.includes("parseAsync")
  };
}

// ../../packages/jit/src/transforms/wrappers/wrappers.ts
function optional(schema) {
  return /* @__PURE__ */ createSchema(
    TypeName.optional,
    {
      innerType: schema
    },
    schema.annotations
  );
}
function nullable(schema) {
  return /* @__PURE__ */ createSchema(
    TypeName.nullable,
    {
      innerType: schema
    },
    schema.annotations
  );
}
function nullish(schema) {
  return /* @__PURE__ */ createSchema(
    TypeName.nullish,
    {
      innerType: schema
    },
    schema.annotations
  );
}
function readonly(schema) {
  return /* @__PURE__ */ createSchema(
    TypeName.readonly,
    {
      innerType: schema
    },
    schema.annotations
  );
}
function promise(schema) {
  return /* @__PURE__ */ createSchema(
    TypeName.promise,
    {
      innerType: schema
    },
    schema.annotations
  );
}
function defaultTo(schema, defaultValue) {
  return /* @__PURE__ */ createSchema(
    TypeName.default,
    {
      innerType: schema,
      defaultValue
    },
    schema.annotations
  );
}
function brand(schema, brandName) {
  return /* @__PURE__ */ createSchema(
    TypeName.brand,
    {
      innerType: schema,
      brand: brandName
    },
    schema.annotations
  );
}
function pipe(schema, transform3) {
  return /* @__PURE__ */ createSchema(
    TypeName.pipe,
    {
      innerType: schema,
      transform: transform3
    },
    schema.annotations
  );
}
function transform(schema, transforms) {
  return /* @__PURE__ */ createSchema(
    TypeName.transform,
    {
      innerType: schema,
      transforms
    },
    schema.annotations
  );
}
function refine(schema, predicate, options) {
  const normalized = typeof options === "string" ? { message: options } : options;
  return /* @__PURE__ */ createSchema(
    TypeName.refine,
    {
      innerType: schema,
      predicate,
      ...normalized?.message !== void 0 ? { message: normalized.message } : {},
      ...normalized?.path !== void 0 ? { path: normalized.path } : {},
      ...normalized?.when !== void 0 ? { when: normalized.when } : {}
    },
    schema.annotations
  );
}
function coerce(schema, coercer) {
  return /* @__PURE__ */ createSchema(
    TypeName.coerce,
    {
      innerType: schema,
      coercer
    },
    schema.annotations
  );
}

// ../../packages/jit/src/transforms/object/object.ts
function isOptionalSchema(schema) {
  return schema.type === TypeName.optional;
}
function partial(schema, keys) {
  const props = {};
  const selected = keys ? new Set(keys) : void 0;
  for (const key in schema.def.props) {
    props[key] = selected === void 0 || selected.has(key) ? optional(schema.def.props[key]) : schema.def.props[key];
  }
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props,
      unknownKeys: schema.def.unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks
    },
    schema.annotations
  );
}
function pick(schema, keys) {
  const props = {};
  for (const key of keys) {
    props[key] = schema.def.props[key];
  }
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props,
      unknownKeys: schema.def.unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks
    },
    schema.annotations
  );
}
function omit(schema, keys) {
  const props = {};
  const omitted = new Set(keys);
  for (const key in schema.def.props) {
    if (!omitted.has(key)) {
      props[key] = schema.def.props[key];
    }
  }
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props,
      unknownKeys: schema.def.unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks
    },
    schema.annotations
  );
}
function extend(schema, extension) {
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: {
        ...schema.def.props,
        ...extension
      },
      unknownKeys: schema.def.unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks
    },
    schema.annotations
  );
}
function merge(left, right) {
  const unknownKeys = right.def.unknownKeys ?? left.def.unknownKeys;
  const catchall2 = right.def.catchall ?? left.def.catchall;
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: {
        ...left.def.props,
        ...right.def.props
      },
      unknownKeys,
      catchall: catchall2,
      checks: [...left.def.checks, ...right.def.checks]
    },
    right.annotations ?? left.annotations
  );
}
function required(schema, keys) {
  const props = {};
  const selected = keys ? new Set(keys) : void 0;
  for (const key in schema.def.props) {
    const prop = schema.def.props[key];
    props[key] = (selected === void 0 || selected.has(key)) && isOptionalSchema(prop) ? prop.def.innerType : prop;
  }
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props,
      unknownKeys: schema.def.unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks
    },
    schema.annotations
  );
}
function strict(schema) {
  return withUnknownKeys(schema, "strict");
}
function loose(schema) {
  return withUnknownKeys(schema, "passthrough");
}
function catchall(schema, catchallSchema) {
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: schema.def.props,
      unknownKeys: "passthrough",
      catchall: catchallSchema,
      checks: schema.def.checks
    },
    schema.annotations
  );
}
function keyOf(schema) {
  const values = Object.keys(schema.def.props);
  return /* @__PURE__ */ createSchema(TypeName.enum, {
    values
  });
}
function withUnknownKeys(schema, unknownKeys) {
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: schema.def.props,
      unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks
    },
    schema.annotations
  );
}

// ../../packages/jit/src/core/builder/unwrap-schema.ts
function unwrapSchema(schemaLike) {
  return "schema" in schemaLike ? schemaLike.schema : schemaLike;
}

// ../../packages/jit/src/core/builder/create-builder.ts
var standardSchemaCache = /* @__PURE__ */ new WeakMap();
var baseBuilderPrototype = {
  is(value) {
    return compileValidator(this.schema).is(value);
  },
  safeParse(value) {
    return compileValidator(this.schema).safeParse(value);
  },
  parse(value) {
    return compileValidator(this.schema).parse(value);
  },
  safeParseAsync(value) {
    return compileValidator(this.schema).safeParseAsync(value);
  },
  parseAsync(value) {
    return compileValidator(this.schema).parseAsync(value);
  },
  optional() {
    return createBuilder(optional(this.schema));
  },
  required(message) {
    return createBuilder(requiredFieldSchema(this.schema, message));
  },
  nullable() {
    return createBuilder(nullable(this.schema));
  },
  nullish() {
    return createBuilder(nullish(this.schema));
  },
  readonly() {
    return createBuilder(readonly(this.schema));
  },
  promise() {
    return createBuilder(promise(this.schema));
  },
  default(defaultValue) {
    return createBuilder(defaultTo(this.schema, defaultValue));
  },
  brand(brandName) {
    return createBuilder(brand(this.schema, brandName));
  },
  pipe(transform3) {
    return createBuilder(pipe(this.schema, transform3));
  },
  or(right) {
    return createBuilder(
      createSchema(TypeName.union, {
        options: [this.schema, unwrapSchema(right)]
      })
    );
  },
  and(right) {
    return createBuilder(
      createSchema(TypeName.intersection, {
        options: [this.schema, unwrapSchema(right)]
      })
    );
  },
  xor(right) {
    return createBuilder(
      createSchema(TypeName.xor, {
        options: [this.schema, unwrapSchema(right)]
      })
    );
  },
  not() {
    return createBuilder(
      createSchema(TypeName.not, {
        innerType: this.schema
      })
    );
  },
  when(key, options) {
    return createConditionalBuilder(this.schema, key, options);
  },
  where(key, options) {
    return createConditionalBuilder(this.schema, key, options);
  },
  refine(predicate, options) {
    return createBuilder(refine(this.schema, predicate, options));
  },
  coerce(coercer) {
    return createBuilder(coerce(this.schema, coercer));
  },
  apply(fn) {
    return fn(this);
  },
  entity(options) {
    return createBuilder(
      attachHint(this.schema, {
        entity: {
          ...options,
          type: "entity"
        }
      })
    );
  },
  keyed(key) {
    return createBuilder(
      attachHint(this.schema, {
        entity: {
          type: "entity",
          key,
          cacheIndex: true
        },
        index: {
          type: "index",
          key
        },
        collection: {
          identify: key,
          indexed: true,
          unique: true
        }
      })
    );
  },
  groupBy(key) {
    return createBuilder(
      attachHint(this.schema, {
        collection: {
          groupBy: key
        }
      })
    );
  },
  sortBy(key, direction) {
    return createBuilder(
      attachHint(this.schema, {
        order: {
          type: "order",
          key,
          ...direction ? { direction } : {}
        },
        collection: {
          ordered: {
            type: "order",
            key,
            ...direction ? { direction } : {}
          }
        }
      })
    );
  },
  uniqueBy(key) {
    return createBuilder(
      attachHint(this.schema, {
        collection: {
          identify: key,
          uniqueBy: key,
          unique: true
        }
      })
    );
  },
  indexBy(key) {
    return createBuilder(
      attachHint(this.schema, {
        index: {
          type: "index",
          key
        },
        collection: {
          identify: key,
          indexed: true
        }
      })
    );
  },
  ordered(key, direction) {
    return createBuilder(
      attachHint(this.schema, {
        order: {
          type: "order",
          key,
          ...direction ? { direction } : {}
        },
        collection: {
          identify: key,
          ordered: {
            type: "order",
            key,
            ...direction ? { direction } : {}
          }
        }
      })
    );
  },
  hash(strategy) {
    return createBuilder(
      attachHint(this.schema, {
        hash: {
          type: "hash",
          ...strategy ? { strategy } : {}
        }
      })
    );
  },
  min(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "min", value, message }));
  },
  max(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "max", value, message }));
  },
  gte(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "min", value, message }));
  },
  lte(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "max", value, message }));
  },
  between(min, max, message) {
    return createBuilder(appendCheck(this.schema, { kind: "between", value: { min, max }, message }));
  },
  daysOfWeek(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "daysOfWeek", value, message }));
  },
  monthsOfYear(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "monthsOfYear", value, message }));
  },
  truncateTo(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "truncateTo", value, message }));
  },
  length(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "length", value, message }));
  },
  oneOf(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "oneOf", value, message }));
  },
  startsWith(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "startsWith", value, message }));
  },
  endsWith(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "endsWith", value, message }));
  },
  includes(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "includes", value, message }));
  },
  regex(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "regex", value, message }));
  },
  email(regexOrMessage, message) {
    const override = regexOrMessage instanceof RegExp ? regexOrMessage : void 0;
    const text = typeof regexOrMessage === "string" ? regexOrMessage : message;
    return createBuilder(appendCheck(this.schema, { kind: "email", value: override, message: text }));
  },
  uuid(versionOrMessage, message) {
    const version = typeof versionOrMessage === "number" ? versionOrMessage : void 0;
    const text = typeof versionOrMessage === "string" ? versionOrMessage : message;
    return createBuilder(
      appendCheck(this.schema, { kind: "uuid", value: version ? regexes_exports.uuid(version) : void 0, message: text })
    );
  },
  url(message) {
    return createBuilder(appendCheck(this.schema, { kind: "url", message }));
  },
  httpUrl(message) {
    return createBuilder(appendCheck(this.schema, { kind: "httpUrl", message }));
  },
  jwt(message) {
    return createBuilder(appendCheck(this.schema, { kind: "jwt", value: regexes_exports.jwt, message }));
  },
  stringFormat(name, pattern, message) {
    return createBuilder(appendCheck(this.schema, { kind: "stringFormat", value: { name, pattern }, message }));
  },
  noEmpty() {
    return createBuilder(appendCheck(this.schema, { kind: "noEmpty" }));
  },
  trim() {
    return createBuilder(appendCheck(this.schema, { kind: "trim" }));
  },
  normalize(value) {
    return createBuilder(appendCheck(this.schema, { kind: "normalize", value }));
  },
  lowercase() {
    return createBuilder(appendCheck(this.schema, { kind: "lowercase" }));
  },
  toLowerCase() {
    return createBuilder(appendCheck(this.schema, { kind: "lowercase" }));
  },
  uppercase() {
    return createBuilder(appendCheck(this.schema, { kind: "uppercase" }));
  },
  toUpperCase() {
    return createBuilder(appendCheck(this.schema, { kind: "uppercase" }));
  },
  positive(message) {
    return createBuilder(appendCheck(this.schema, { kind: "positive", message }));
  },
  negative(message) {
    return createBuilder(appendCheck(this.schema, { kind: "negative", message }));
  },
  nonnegative(message) {
    return createBuilder(appendCheck(this.schema, { kind: "min", value: 0, message }));
  },
  nonpositive(message) {
    return createBuilder(appendCheck(this.schema, { kind: "max", value: 0, message }));
  },
  moreThan(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "moreThan", value, message }));
  },
  gt(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "moreThan", value, message }));
  },
  lessThan(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "lessThan", value, message }));
  },
  lt(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "lessThan", value, message }));
  },
  multipleOf(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "multipleOf", value, message }));
  },
  step(value, message) {
    return createBuilder(appendCheck(this.schema, { kind: "multipleOf", value, message }));
  },
  finite(message) {
    return createBuilder(appendCheck(this.schema, { kind: "finite", message }));
  },
  safe(message) {
    return createBuilder(appendCheck(this.schema, { kind: "safe", message }));
  },
  int(message) {
    return createBuilder(appendCheck(this.schema, { kind: "integer", message }));
  },
  int32(message) {
    return createBuilder(appendCheck(this.schema, { kind: "int32", message }));
  },
  float32(message) {
    return createBuilder(appendCheck(this.schema, { kind: "float32", message }));
  },
  float64(message) {
    return createBuilder(appendCheck(this.schema, { kind: "float64", message }));
  },
  nonEmpty(message) {
    return createBuilder(appendCheck(this.schema, { kind: "nonEmpty", message }));
  },
  binary(options) {
    if (this.schema.type !== TypeName.array) {
      throw new JITError("INVALID_OPERATION", "binary rowsets can only be compiled from array schemas");
    }
    return compileBinaryArray(this.schema, options);
  },
  sanitize(options = "text") {
    const value = normalizeSanitizeOptions(options);
    return createBuilder(appendCheck(this.schema, { kind: "sanitize", value }));
  },
  guid(message) {
    return createBuilder(appendCheck(this.schema, { kind: "guid", value: regexes_exports.guid, message }));
  },
  cuid(message) {
    return createBuilder(appendCheck(this.schema, { kind: "cuid", value: regexes_exports.cuid, message }));
  },
  cuid2(message) {
    return createBuilder(appendCheck(this.schema, { kind: "cuid2", value: regexes_exports.cuid2, message }));
  },
  ulid(message) {
    return createBuilder(appendCheck(this.schema, { kind: "ulid", value: regexes_exports.ulid, message }));
  },
  xid(message) {
    return createBuilder(appendCheck(this.schema, { kind: "xid", value: regexes_exports.xid, message }));
  },
  ksuid(message) {
    return createBuilder(appendCheck(this.schema, { kind: "ksuid", value: regexes_exports.ksuid, message }));
  },
  nanoid(message) {
    return createBuilder(appendCheck(this.schema, { kind: "nanoid", value: regexes_exports.nanoid, message }));
  },
  duration(message) {
    return createBuilder(appendCheck(this.schema, { kind: "duration", value: regexes_exports.duration, message }));
  },
  ipv4(message) {
    return createBuilder(appendCheck(this.schema, { kind: "ipv4", value: regexes_exports.ipv4, message }));
  },
  ipv6(message) {
    return createBuilder(appendCheck(this.schema, { kind: "ipv6", value: regexes_exports.ipv6, message }));
  },
  cidrv4(message) {
    return createBuilder(appendCheck(this.schema, { kind: "cidrv4", value: regexes_exports.cidrv4, message }));
  },
  cidrv6(message) {
    return createBuilder(appendCheck(this.schema, { kind: "cidrv6", value: regexes_exports.cidrv6, message }));
  },
  base64(message) {
    return createBuilder(appendCheck(this.schema, { kind: "base64", value: regexes_exports.base64, message }));
  },
  base64url(message) {
    return createBuilder(appendCheck(this.schema, { kind: "base64url", value: regexes_exports.base64url, message }));
  },
  hostname(message) {
    return createBuilder(appendCheck(this.schema, { kind: "hostname", value: regexes_exports.hostname, message }));
  },
  domain(message) {
    return createBuilder(appendCheck(this.schema, { kind: "domain", value: regexes_exports.domain, message }));
  },
  e164(message) {
    return createBuilder(appendCheck(this.schema, { kind: "e164", value: regexes_exports.e164, message }));
  },
  hex(message) {
    return createBuilder(appendCheck(this.schema, { kind: "hex", value: regexes_exports.hex, message }));
  },
  date(message) {
    return createBuilder(appendCheck(this.schema, { kind: "date", value: regexes_exports.date, message }));
  },
  emoji(message) {
    return createBuilder(appendCheck(this.schema, { kind: "emoji", value: regexes_exports.emoji(), message }));
  },
  mac(delimiter, message) {
    return createBuilder(appendCheck(this.schema, { kind: "mac", value: regexes_exports.mac(delimiter), message }));
  },
  time(options, message) {
    return createBuilder(appendCheck(this.schema, { kind: "time", value: regexes_exports.time(options ?? {}), message }));
  },
  datetime(options, message) {
    return createBuilder(
      appendCheck(this.schema, { kind: "datetime", value: regexes_exports.datetime(options ?? {}), message })
    );
  },
  digest(algorithm, encoding, message) {
    return createBuilder(
      appendCheck(this.schema, { kind: "digest", value: regexes_exports.hash(algorithm, encoding), message })
    );
  },
  format(pattern, options, message) {
    const mode = options?.mode ?? "transform";
    return createBuilder(
      appendCheck(this.schema, {
        kind: "format",
        value: {
          pattern,
          mode,
          stripNonDigits: options?.stripNonDigits ?? mode === "transform"
        },
        message
      })
    );
  },
  cpf(message) {
    return createBuilder(
      appendCheck(this.schema, {
        kind: "format",
        value: { pattern: "###.###.###-##", mode: "transform", stripNonDigits: true },
        message
      })
    );
  },
  cnpj(message) {
    return createBuilder(
      appendCheck(this.schema, {
        kind: "format",
        value: { pattern: "##.###.###/####-##", mode: "transform", stripNonDigits: true },
        message
      })
    );
  },
  phoneBR(message) {
    return createBuilder(appendCheck(this.schema, { kind: "phoneBR", message }));
  },
  pii(strategy = "redact") {
    return createBuilder({
      ...this.schema,
      def: { ...this.schema.def, pii: strategy }
    });
  }
};
Object.defineProperty(baseBuilderPrototype, "~standard", {
  enumerable: false,
  configurable: false,
  get() {
    return getStandardSchema(this.schema);
  }
});
function appendCheck(schema, check) {
  const def = schema.def;
  const entry = {
    kind: check.kind,
    ...check.value !== void 0 ? { value: check.value } : {},
    ...check.message !== void 0 ? { message: check.message } : {}
  };
  const checks = def.checks ? [...def.checks, entry] : [entry];
  return {
    ...schema,
    def: { ...schema.def, checks }
  };
}
var UNSAFE_HTML_TAGS = /* @__PURE__ */ new Set([
  "base",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "style"
]);
function normalizeSanitizeOptions(options) {
  const spec = typeof options === "string" ? { preset: options } : options;
  if (spec.maxLength !== void 0 && (!Number.isSafeInteger(spec.maxLength) || spec.maxLength < 0)) {
    throw new JITError("INVALID_OPERATION", "sanitize maxLength must be a non-negative safe integer");
  }
  if (typeof spec.html === "object") {
    const seen = /* @__PURE__ */ new Set();
    for (const rawTag of spec.html.tags) {
      const tag = rawTag.toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
        throw new JITError("INVALID_OPERATION", `invalid allowed HTML tag ${JSON.stringify(rawTag)}`);
      }
      if (UNSAFE_HTML_TAGS.has(tag)) {
        throw new JITError("INVALID_OPERATION", `unsafe HTML tag ${JSON.stringify(rawTag)} cannot be allowed`);
      }
      seen.add(tag);
    }
    return { ...spec, html: { mode: "allow", tags: Object.freeze([...seen]) } };
  }
  return spec;
}
function requiredFieldSchema(schema, message) {
  let required2 = schema;
  if (schema.type === TypeName.optional || schema.type === TypeName.default) {
    required2 = schema.def.innerType;
  } else if (schema.type === TypeName.nullish) {
    required2 = nullable(schema.def.innerType);
  }
  if (message === void 0) return required2;
  return {
    ...required2,
    def: { ...required2.def, requiredMessage: message }
  };
}
function createConditionalBuilder(schema, key, options) {
  const requiredBuilder = createBuilder(requiredFieldSchema(schema));
  const baseBuilder = createBuilder(schema);
  return createBuilder(
    createSchema(TypeName.when, {
      key,
      is: options.is,
      thenType: unwrapSchema(options.then(requiredBuilder)),
      otherwiseType: unwrapSchema(options.otherwise ? options.otherwise(baseBuilder) : baseBuilder)
    })
  );
}
var objectBuilderPrototype = {
  ...baseBuilderPrototype,
  partial(first, ...rest) {
    const keys = first === void 0 ? void 0 : normalizeKeys(first, rest);
    return createBuilder(
      partial(this.schema, keys)
    );
  },
  required(first, ...rest) {
    const keys = first === void 0 ? void 0 : normalizeKeys(first, rest);
    return createBuilder(
      required(this.schema, keys)
    );
  },
  strict() {
    return createBuilder(strict(this.schema));
  },
  loose() {
    return createBuilder(loose(this.schema));
  },
  catchall(schema) {
    return createBuilder(
      catchall(this.schema, unwrapSchema(schema))
    );
  },
  keyof() {
    return createBuilder(keyOf(this.schema));
  },
  transform(transforms) {
    return createBuilder(transform(this.schema, transforms));
  },
  pick(first, ...rest) {
    return createBuilder(
      pick(this.schema, normalizeKeys(first, rest))
    );
  },
  omit(first, ...rest) {
    return createBuilder(
      omit(this.schema, normalizeKeys(first, rest))
    );
  },
  extend(extension) {
    const props = {};
    for (const key in extension) {
      props[key] = unwrapSchema(extension[key]);
    }
    return createBuilder(extend(this.schema, props));
  },
  merge(right) {
    return createBuilder(merge(this.schema, unwrapSchema(right)));
  }
};
var functionBuilderPrototype = {
  ...baseBuilderPrototype,
  implement(implementation) {
    const { args, output } = compileFunctionValidators(this.schema);
    return (...rawArgs) => {
      const parsedArgs = args.parse(rawArgs);
      const result = implementation(...parsedArgs);
      return output ? output.parse(result) : result;
    };
  },
  implementAsync(implementation) {
    const { args, output } = compileFunctionValidators(this.schema);
    return async (...rawArgs) => {
      const parsedArgs = args.parse(rawArgs);
      const result = await implementation(...parsedArgs);
      return output ? output.parseAsync(result) : result;
    };
  }
};
var codecBuilderPrototype = {
  ...baseBuilderPrototype,
  decode(value) {
    return compileValidator(this.schema).parse(value);
  },
  encode(value) {
    const schema = this.schema;
    const output = compileValidator(schema.def.output).parse(value);
    const encoded = schema.def.encode(output);
    return compileValidator(schema.def.input).parse(encoded);
  }
};
attachStandardSchemaGetter(objectBuilderPrototype);
attachStandardSchemaGetter(functionBuilderPrototype);
attachStandardSchemaGetter(codecBuilderPrototype);
function compileFunctionValidators(schema) {
  return {
    args: compileValidator(schema.def.args),
    output: schema.def.output ? compileValidator(schema.def.output) : void 0
  };
}
function normalizeKeys(first, rest) {
  return typeof first === "string" ? [first, ...rest] : first;
}
function getStandardSchema(schema) {
  const cached = standardSchemaCache.get(schema);
  if (cached) return cached;
  const standard = createStandardSchema(schema);
  standardSchemaCache.set(schema, standard);
  return standard;
}
function createStandardSchema(schema) {
  const safeParse = compileValidatorSelection(schema, ["safeParse"]).safeParse;
  return {
    version: 1,
    vendor: "jit",
    validate(value) {
      const result = safeParse(value);
      if (result.success) return { value: result.data };
      return { issues: result.issues.map(toStandardIssue) };
    }
  };
}
function toStandardIssue(issue) {
  const path = parseIssuePath(issue.path);
  return path.length === 0 ? { message: issue.message } : { message: issue.message, path };
}
function parseIssuePath(path) {
  if (path === "") return [];
  const segments = [];
  const regex2 = /([^.[\]]+)|\[(\d+)\]/g;
  let match;
  while ((match = regex2.exec(path)) !== null) {
    if (match[1] !== void 0) {
      segments.push(match[1]);
    } else if (match[2] !== void 0) {
      segments.push(Number(match[2]));
    }
  }
  return segments;
}
function attachStandardSchemaGetter(prototype) {
  Object.defineProperty(prototype, "~standard", {
    enumerable: false,
    configurable: false,
    get() {
      return getStandardSchema(this.schema);
    }
  });
}
function createBuilder(schema) {
  const prototype = schema.type === TypeName.object ? objectBuilderPrototype : schema.type === TypeName.function ? functionBuilderPrototype : schema.type === TypeName.codec ? codecBuilderPrototype : baseBuilderPrototype;
  const builder = Object.create(prototype);
  builder.schema = schema;
  return builder;
}

// ../../packages/jit/src/aot/emit-type.ts
function emitTypeScriptType(schema) {
  const current = schema;
  switch (current.type) {
    case TypeName.string:
      return emitOneOfType(current, "string");
    case TypeName.number:
    case TypeName.int:
      return emitOneOfType(current, "number");
    case TypeName.nan:
      return "number";
    case TypeName.boolean:
      return "boolean";
    case TypeName.bigint:
      return "bigint";
    case TypeName.symbol:
      return "symbol";
    case TypeName.date:
      return "Date";
    case TypeName.regex:
      return "RegExp";
    case TypeName.null:
      return "null";
    case TypeName.undefined:
    case TypeName.void:
      return "undefined";
    case TypeName.any:
      return "any";
    case TypeName.unknown:
      return "unknown";
    case TypeName.never:
      return "never";
    case TypeName.literal: {
      const value = current.def.value;
      return typeof value === "string" ? JSON.stringify(value) : String(value);
    }
    case TypeName.enum: {
      const values = Object.values(current.def.values);
      return values.map((value) => typeof value === "string" ? JSON.stringify(value) : String(value)).join(" | ");
    }
    case TypeName.object: {
      const props = current.def.props;
      const entries = Object.keys(props).map((key) => {
        const prop = props[key];
        const optional3 = isOptional(prop);
        const safeKey = parse_exports.isValidIdentifier(key) ? key : JSON.stringify(key);
        return `${safeKey}${optional3 ? "?" : ""}: ${emitTypeScriptType(prop)}`;
      });
      return entries.length === 0 ? "{}" : `{ ${entries.join("; ")} }`;
    }
    case TypeName.array:
      return `${wrapForSuffix(emitTypeScriptType(current.def.element))}[]`;
    case TypeName.set:
      return `Set<${emitTypeScriptType(current.def.element)}>`;
    case TypeName.map:
      return `Map<${emitTypeScriptType(current.def.key)}, ${emitTypeScriptType(current.def.value)}>`;
    case TypeName.record:
      return `Record<string, ${emitTypeScriptType(current.def.value)}>`;
    case TypeName.tuple: {
      const items = current.def.items ?? [];
      return `[${items.map(emitTypeScriptType).join(", ")}]`;
    }
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion: {
      const options = current.def.options;
      return options.map(emitTypeScriptType).join(" | ");
    }
    case TypeName.not:
      return "unknown";
    case TypeName.when:
      return `${emitTypeScriptType(current.def.thenType)} | ${emitTypeScriptType(current.def.otherwiseType)}`;
    case TypeName.intersection: {
      const options = current.def.options;
      return options.map(emitTypeScriptType).join(" & ");
    }
    case TypeName.optional:
      return `${emitTypeScriptType(current.def.innerType)} | undefined`;
    case TypeName.nullable:
      return `${emitTypeScriptType(current.def.innerType)} | null`;
    case TypeName.nullish:
      return `${emitTypeScriptType(current.def.innerType)} | null | undefined`;
    case TypeName.default:
    case TypeName.brand:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return emitTypeScriptType(current.def.innerType);
    case TypeName.readonly:
      return emitReadonlyType(current.def.innerType);
    case TypeName.lazy:
      return emitTypeScriptType(current.def.getter());
    case TypeName.promise:
      return `Promise<${emitTypeScriptType(current.def.innerType)}>`;
    default:
      return "unknown";
  }
}
function emitReadonlyType(schema) {
  const current = schema;
  switch (current.type) {
    case TypeName.array:
      return `readonly ${wrapForSuffix(emitTypeScriptType(current.def.element))}[]`;
    case TypeName.tuple: {
      const items = current.def.items ?? [];
      return `readonly [${items.map(emitTypeScriptType).join(", ")}]`;
    }
    case TypeName.set:
      return `ReadonlySet<${emitTypeScriptType(current.def.element)}>`;
    case TypeName.map:
      return `ReadonlyMap<${emitTypeScriptType(current.def.key)}, ${emitTypeScriptType(current.def.value)}>`;
    default:
      return `Readonly<${emitTypeScriptType(schema)}>`;
  }
}
function isOptional(schema) {
  if (schema.type === TypeName.optional || schema.type === TypeName.nullish || schema.type === TypeName.default) {
    return true;
  }
  if (schema.type === TypeName.brand || schema.type === TypeName.readonly || schema.type === TypeName.refine || schema.type === TypeName.coerce || schema.type === TypeName.pipe || schema.type === TypeName.transform || schema.type === TypeName.nullable) {
    return isOptional(schema.def.innerType);
  }
  return false;
}
function emitOneOfType(schema, fallback) {
  const checks = schema.def.checks ?? [];
  const oneOf = checks.find((check) => check.kind === "oneOf");
  if (!Array.isArray(oneOf?.value) || oneOf.value.length === 0) return fallback;
  return oneOf.value.map((value) => typeof value === "string" ? JSON.stringify(value) : String(value)).join(" | ");
}
function wrapForSuffix(type) {
  if (type.includes("|") || type.includes("&")) return `(${type})`;
  return type;
}

// ../../packages/jit/src/aot/generate.ts
var AOT_OPERATIONS = [
  "is",
  "parse",
  "safeParse",
  "hash",
  "equal",
  "clone",
  "diff",
  "stringify",
  "fromJSON",
  "format",
  "mask",
  "sanitize",
  "codec"
];
function generate(options) {
  const layout = resolveOutputLayout(options.outDir, options.packageName, options.format ?? "javascript");
  const compilerPackageName = options.types?.package ?? "@jit-compiler/jit";
  const skipped = [];
  const js = [];
  const dts = [];
  const tsTypes = [];
  const exportNames = [];
  const typeNames = /* @__PURE__ */ new Map();
  const publicNames = /* @__PURE__ */ new Set([...Object.keys(options.schemas), ...Object.keys(options.functions ?? {})]);
  const internalNames = /* @__PURE__ */ new Set();
  let needsRuntimeGetIndex = false;
  let needsValidationError = false;
  let needsHashHelpers = false;
  js.push("// Generated by jit \u2014 do not edit.");
  if (layout.format === "typescript") {
    js.push("// @ts-nocheck -- generated internals are typed at the public export boundary.");
  }
  dts.push("// Generated by jit \u2014 do not edit.");
  for (const [name, input] of Object.entries(options.typeSchemas ?? {})) {
    if (!isValidIdentifier(name) || name in options.schemas || name in (options.functions ?? {})) continue;
    const schema = unwrapSchema(input);
    const valueType = `export type ${name} = ${emitTypeScriptType(schema)};`;
    const strictType = `export type ${name}Strict<TValue> = TValue;`;
    typeNames.set(schema, name);
    dts.push(valueType, strictType);
    tsTypes.push(valueType, strictType);
  }
  for (const name of Object.keys(options.schemas)) {
    if (readAotExportMode(options.schemas[name]) !== "grouped") {
      skipped.push({
        schema: name,
        operation: "schema",
        reason: "raw schemas and array-style compile markers do not emit AOT output; export compiled functions or use JIT.compile(schema, { ... })"
      });
      continue;
    }
    const schema = unwrapSchema(options.schemas[name]);
    const operations = [];
    const sourceFile = options.sources?.get(name);
    const requested = readRequestedOps(options.schemas[name]);
    const wants = (op) => requested === void 0 || requested.includes(op);
    if (requested) {
      for (const op of requested) {
        if (!AOT_OPS.has(op)) {
          skipped.push({
            schema: name,
            operation: op,
            reason: "runtime-only operation (not generated ahead of time)"
          });
        }
      }
    }
    if (sourceFile && layout.format !== "typescript") {
      const specifier = typeImportSpecifier(options.outDir, sourceFile);
      const valueType = `export type ${name} = import(${JSON.stringify(compilerPackageName)}).Typeof<typeof import(${JSON.stringify(specifier)}).${name}>;`;
      const strictType = `export type ${name}Strict<TValue> = import(${JSON.stringify(compilerPackageName)}).Strict<typeof import(${JSON.stringify(specifier)}).${name}, TValue>;`;
      dts.push(valueType, strictType);
      tsTypes.push(valueType, strictType);
    } else {
      const valueType = `export type ${name} = ${emitTypeScriptType(schema)};`;
      const strictType = `export type ${name}Strict<TValue> = TValue;`;
      dts.push(valueType, strictType);
      tsTypes.push(valueType, strictType);
    }
    const wantsValidator = wants("is") || wants("parse") || wants("safeParse") || wants("fromJSON");
    const validator2 = wantsValidator ? tryEmit(name, "validator", skipped, () => emitValidator(schema)) : void 0;
    if (validator2) {
      const inlined = inlineBindings(validator2.bindings.names, validator2.bindings.values);
      if (inlined === void 0) {
        skipped.push({
          schema: name,
          operation: "validator",
          reason: "refine/transform/default callbacks cannot be serialized ahead of time"
        });
      } else {
        const validatorName = internalIdentifier(`${name}_validator`);
        js.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
        js.push(...inlined.map((line) => `  ${line}`));
        js.push(...indentBlock(validator2.source));
        js.push("})();");
        if (wants("is")) {
          const binding = internalIdentifier(`${name}_is`);
          js.push(`const ${binding} = /*#__PURE__*/ ((v) => v.is)(${validatorName});`);
          operations.push({
            prop: "is",
            type: `(value: unknown) => value is ${name}`,
            binding
          });
        }
        if (wants("safeParse")) {
          const binding = internalIdentifier(`${name}_safeParse`);
          js.push(`const ${binding} = /*#__PURE__*/ ((v) => v.safeParse)(${validatorName});`);
          operations.push({
            prop: "safeParse",
            type: `(value: unknown) => { readonly success: true; readonly data: ${name} } | { readonly success: false; readonly issues: readonly { readonly path: string; readonly code: string; readonly expected: string; readonly message: string; readonly received?: string }[] }`,
            binding
          });
        }
        if (wants("parse") || wants("fromJSON")) {
          const parseBinding = internalIdentifier(`${name}_parse`);
          needsValidationError = true;
          js.push(
            `const ${parseBinding} = /*#__PURE__*/ ((v) => (value) => { const r = v.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); })(${validatorName});`
          );
          if (wants("parse")) {
            operations.push({
              prop: "parse",
              type: `(value: unknown) => ${name}`,
              binding: parseBinding
            });
          }
          if (wants("fromJSON")) {
            const binding = internalIdentifier(`${name}_fromJSON`);
            js.push(
              `const ${binding} = /*#__PURE__*/ ((parse) => (json) => parse(JSON.parse(json)))(${parseBinding});`
            );
            operations.push({
              prop: "fromJSON",
              type: `(json: string) => ${name}`,
              binding
            });
          }
        }
      }
    }
    const equalSource = wants("equal") ? tryEmit(name, "equal", skipped, () => emitEqualSource(schema)) : void 0;
    const equalNeedsHash = equalSource?.includes("__hash");
    const hashSource2 = wants("hash") || equalNeedsHash ? tryEmit(name, "hash", skipped, () => emitHashSource(schema)) : void 0;
    let hashBinding;
    if (hashSource2) {
      needsHashHelpers = true;
      hashBinding = internalIdentifier(`${name}_hash`);
      js.push(`const ${hashBinding} = /*#__PURE__*/ (() => {`);
      js.push(...indentBlock(`const compute = (${hashSource2});`));
      js.push("  return (value) => {");
      js.push('    if ((typeof value === "object" && value !== null) || typeof value === "function") {');
      js.push("      const cached = __hashCache.get(value);");
      js.push("      if (cached !== undefined) return cached;");
      js.push("      const hash = compute(value);");
      js.push("      __hashCache.set(value, hash);");
      js.push("      return hash;");
      js.push("    }");
      js.push("    return compute(value);");
      js.push("  };");
      js.push("})();");
      if (wants("hash")) operations.push({ prop: "hash", type: `(value: ${name}) => number`, binding: hashBinding });
    }
    if (equalSource) {
      const needsHash = equalSource.includes("__hash");
      const needsIndex = equalSource.includes("__getIndex");
      if (needsHash && !hashSource2) {
        skipped.push({
          schema: name,
          operation: "equal",
          reason: "hash short-circuit hints need an emittable hash"
        });
      } else {
        if (needsIndex) needsRuntimeGetIndex = true;
        const binding = internalIdentifier(`${name}_equal`);
        if (needsHash) {
          js.push(`const ${binding} = /*#__PURE__*/ ((__hash) => (${equalSource}))(${hashBinding});`);
        } else {
          js.push(`const ${binding} = (${equalSource});`);
        }
        operations.push({
          prop: "equal",
          type: `(left: ${name}, right: ${name}) => boolean`,
          binding
        });
      }
    }
    const cloneSource = wants("clone") ? tryEmit(name, "clone", skipped, () => emitCloneSource(schema)) : void 0;
    if (cloneSource) {
      const binding = internalIdentifier(`${name}_clone`);
      js.push(`const ${binding} = (${cloneSource});`);
      operations.push({ prop: "clone", type: `(value: ${name}) => ${name}`, binding });
    }
    const diffSource = wants("diff") ? tryEmit(name, "diff", skipped, () => emitDiffSource(schema)) : void 0;
    if (diffSource) {
      const binding = internalIdentifier(`${name}_diff`);
      js.push(`const ${binding} = (${diffSource});`);
      operations.push({
        prop: "diff",
        type: `(left: ${name}, right: ${name}) => readonly { readonly type: "add" | "remove" | "update"; readonly path: readonly PropertyKey[]; readonly value?: unknown }[]`,
        binding
      });
    }
    const serializeSource = wants("stringify") ? tryEmit(name, "stringify", skipped, () => emitSerialize(schema)) : void 0;
    if (serializeSource) {
      const binding = internalIdentifier(`${name}_stringify`);
      js.push(`const ${binding} = (${serializeSource});`);
      operations.push({
        prop: "stringify",
        type: `(value: ${name}) => string`,
        binding
      });
    }
    const formatSource = wants("format") ? tryEmit(name, "format", skipped, () => emitFormatSource(schema)) : void 0;
    if (formatSource) {
      const binding = internalIdentifier(`${name}_format`);
      js.push(`const ${binding} = (${formatSource});`);
      operations.push({ prop: "format", type: `(value: string) => string`, binding });
    }
    const maskSource = wants("mask") ? tryEmit(name, "mask", skipped, () => emitMaskSource(schema)) : void 0;
    if (maskSource) {
      const binding = internalIdentifier(`${name}_mask`);
      js.push(`const ${binding} = (${maskSource});`);
      operations.push({ prop: "mask", type: `(value: ${name}) => ${name}`, binding });
    }
    const sanitizeSource = wants("sanitize") ? tryEmit(name, "sanitize", skipped, () => emitSanitizeSource(schema)) : void 0;
    if (sanitizeSource) {
      const regexConsts = sanitizeChainBindings.names.map(
        (bindingName, position) => `const ${bindingName} = ${String(sanitizeChainBindings.values[position])};`
      );
      const binding = internalIdentifier(`${name}_sanitize`);
      js.push(`const ${binding} = /*#__PURE__*/ (() => {`);
      js.push(...regexConsts.map((line) => `  ${line}`));
      js.push(...indentBlock(`return (${sanitizeSource});`));
      js.push("})();");
      operations.push({
        prop: "sanitize",
        type: `(value: ${name}) => ${name}`,
        binding
      });
    }
    const codec2 = wants("codec") ? tryEmit(name, "codec", skipped, () => emitCodec(schema)) : void 0;
    if (codec2) {
      const inlined = inlineCodecBindings(codec2.bindingNames, codec2.bindingValues);
      if (inlined === void 0) {
        skipped.push({
          schema: name,
          operation: "codec",
          reason: "codec bindings cannot be serialized"
        });
      } else {
        const binding = internalIdentifier(`${name}_codec`);
        js.push(`const ${binding} = /*#__PURE__*/ (() => {`);
        js.push(...inlined.map((line) => `  ${line}`));
        js.push(...indentBlock(codec2.source));
        js.push("})();");
        operations.push({
          prop: "codec",
          type: `{ readonly encode: (value: ${name}) => Uint8Array; readonly encodeInto: (value: ${name}, target: Uint8Array) => number; readonly decode: (bytes: Uint8Array | ArrayBuffer) => ${name} }`,
          binding
        });
      }
    }
    for (const extraName of readExtraNames(options.schemas[name])) {
      const artifact = getArtifact(options.schemas[name][extraName]);
      if (!artifact) {
        skipped.push({
          schema: name,
          operation: extraName,
          reason: "extra is not a registered compiled source artifact"
        });
        continue;
      }
      if (artifact.kind === "validator") {
        skipped.push({
          schema: name,
          operation: extraName,
          reason: "validator functions must be compiled on the object or exported as standalone AOT functions"
        });
        continue;
      }
      if (artifact.kind === "operation") {
        skipped.push({
          schema: name,
          operation: extraName,
          reason: "operation functions must be compiled on the object or exported as standalone AOT functions"
        });
        continue;
      }
      const inlined = inlineBindings(artifact.bindingNames, artifact.bindingValues);
      if (inlined === void 0) {
        skipped.push({
          schema: name,
          operation: extraName,
          reason: `${artifact.kind} bindings hold callbacks that cannot be serialized ahead of time`
        });
        continue;
      }
      const binding = internalIdentifier(`${name}_${extraName}`);
      js.push(`const ${binding} = /*#__PURE__*/ (() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      js.push(`  return (${artifact.source});`);
      js.push("})();");
      const extraType = sourceFile ? `typeof import(${JSON.stringify(typeImportSpecifier(options.outDir, sourceFile))}).${name}[${JSON.stringify(extraName)}]` : "unknown";
      operations.push({ prop: extraName, type: extraType, binding });
    }
    if (operations.length === 0) {
      skipped.push({
        schema: name,
        operation: "schema",
        reason: "no buildable AOT functions were selected for this grouped export"
      });
      continue;
    }
    if (layout.format === "typescript") {
      js.push(`const ${name}: {`);
      js.push(...operations.map((operation) => `  readonly ${operation.prop}: ${operation.type};`));
      js.push("} = /*#__PURE__*/ Object.freeze({");
    } else {
      js.push(`const ${name} = /*#__PURE__*/ Object.freeze({`);
    }
    js.push(...operations.map((operation) => `  ${operation.prop}: ${operation.binding},`));
    js.push("});");
    js.push("");
    exportNames.push(name);
    dts.push(`export declare const ${name}: {`);
    dts.push(...operations.map((operation) => `  readonly ${operation.prop}: ${operation.type};`));
    dts.push("};");
    dts.push("");
  }
  for (const name of Object.keys(options.functions ?? {})) {
    emitStandaloneArtifact(name, options.functions?.[name], options.sources?.get(name));
  }
  function emitStandaloneArtifact(name, value, sourceFile) {
    if (!isValidIdentifier(name)) {
      skipped.push({
        schema: name,
        operation: "export",
        reason: "standalone AOT export names must be valid JavaScript identifiers"
      });
      return;
    }
    if (name in options.schemas) {
      skipped.push({
        schema: name,
        operation: "export",
        reason: "standalone AOT export name collides with a grouped export"
      });
      return;
    }
    const artifact = getArtifact(value);
    if (!artifact) {
      skipped.push({
        schema: name,
        operation: "export",
        reason: "export is not a registered compiled JIT function"
      });
      return;
    }
    const declaredType = artifact.kind === "validator" ? standaloneType(artifact, typeNames.get(artifact.schema)) : artifact.kind === "operation" ? operationType(artifact, typeNames.get(artifact.schema)) : sourceFile ? `typeof import(${JSON.stringify(typeImportSpecifier(options.outDir, sourceFile))}).${name}` : "unknown";
    const declaration = `const ${name}${layout.format === "typescript" ? `: ${declaredType}` : ""} =`;
    if (artifact.kind === "validator") {
      if (artifact.op === "parseAsync" || artifact.op === "safeParseAsync") {
        skipped.push({
          schema: name,
          operation: artifact.op,
          reason: "async validator functions are runtime-only in AOT output"
        });
        return;
      }
      const validator2 = tryEmit(
        name,
        artifact.op,
        skipped,
        () => emitValidator(artifact.schema, {
          is: artifact.op === "is",
          safeParse: artifact.op === "safeParse" || artifact.op === "parse",
          safeParseAsync: false
        })
      );
      if (!validator2) return;
      const inlined2 = inlineBindings(validator2.bindings.names, validator2.bindings.values);
      if (inlined2 === void 0) {
        skipped.push({
          schema: name,
          operation: artifact.op,
          reason: "refine/transform/default callbacks cannot be serialized ahead of time"
        });
        return;
      }
      const validatorName = internalIdentifier(`${name}_validator`);
      js.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
      js.push(...inlined2.map((line) => `  ${line}`));
      js.push(...indentBlock(validator2.source));
      js.push("})();");
      if (artifact.op === "is") {
        js.push(`${declaration} /*#__PURE__*/ ((v) => v.is)(${validatorName});`);
      } else if (artifact.op === "safeParse") {
        js.push(`${declaration} /*#__PURE__*/ ((v) => v.safeParse)(${validatorName});`);
      } else {
        needsValidationError = true;
        js.push(
          `${declaration} /*#__PURE__*/ ((v) => (value) => { const r = v.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); })(${validatorName});`
        );
      }
      exportNames.push(name);
      dts.push(`export declare const ${name}: ${standaloneType(artifact, typeNames.get(artifact.schema))};`);
      dts.push("");
      return;
    }
    if (artifact.kind === "operation") {
      const schema = artifact.schema;
      const op = artifact.op;
      if (op === "hash") {
        const hashSource2 = tryEmit(name, "hash", skipped, () => emitHashSource(schema));
        if (!hashSource2) return;
        needsHashHelpers = true;
        js.push(`${declaration} /*#__PURE__*/ (() => {`);
        js.push(...indentBlock(`const compute = (${hashSource2});`));
        js.push("  return (value) => {");
        js.push('    if ((typeof value === "object" && value !== null) || typeof value === "function") {');
        js.push("      const cached = __hashCache.get(value);");
        js.push("      if (cached !== undefined) return cached;");
        js.push("      const hash = compute(value);");
        js.push("      __hashCache.set(value, hash);");
        js.push("      return hash;");
        js.push("    }");
        js.push("    return compute(value);");
        js.push("  };");
        js.push("})();");
      } else if (op === "equal") {
        const equalSource = tryEmit(name, "equal", skipped, () => emitEqualSource(schema));
        if (!equalSource) return;
        const needsHash = equalSource.includes("__hash");
        const needsIndex = equalSource.includes("__getIndex");
        if (needsIndex) needsRuntimeGetIndex = true;
        if (needsHash) {
          const hashSource2 = tryEmit(name, "hash", skipped, () => emitHashSource(schema));
          if (!hashSource2) return;
          needsHashHelpers = true;
          const hashBinding = internalIdentifier(`${name}_hash`);
          js.push(`const ${hashBinding} = /*#__PURE__*/ (() => {`);
          js.push(...indentBlock(`const compute = (${hashSource2});`));
          js.push("  return (value) => {");
          js.push('    if ((typeof value === "object" && value !== null) || typeof value === "function") {');
          js.push("      const cached = __hashCache.get(value);");
          js.push("      if (cached !== undefined) return cached;");
          js.push("      const hash = compute(value);");
          js.push("      __hashCache.set(value, hash);");
          js.push("      return hash;");
          js.push("    }");
          js.push("    return compute(value);");
          js.push("  };");
          js.push("})();");
          js.push(`${declaration} /*#__PURE__*/ ((__hash) => (${equalSource}))(${hashBinding});`);
        } else {
          js.push(`${declaration} (${equalSource});`);
        }
      } else if (op === "clone") {
        const cloneSource = tryEmit(name, "clone", skipped, () => emitCloneSource(schema));
        if (!cloneSource) return;
        js.push(`${declaration} (${cloneSource});`);
      } else if (op === "diff") {
        const diffSource = tryEmit(name, "diff", skipped, () => emitDiffSource(schema));
        if (!diffSource) return;
        js.push(`${declaration} (${diffSource});`);
      } else if (op === "stringify") {
        const serializeSource = tryEmit(name, "stringify", skipped, () => emitSerialize(schema));
        if (!serializeSource) return;
        js.push(`${declaration} (${serializeSource});`);
      } else if (op === "fromJSON") {
        const validator2 = tryEmit(name, "fromJSON", skipped, () => emitValidator(schema));
        if (!validator2) return;
        const inlined2 = inlineBindings(validator2.bindings.names, validator2.bindings.values);
        if (inlined2 === void 0) {
          skipped.push({
            schema: name,
            operation: "fromJSON",
            reason: "refine/transform/default callbacks cannot be serialized ahead of time"
          });
          return;
        }
        needsValidationError = true;
        const validatorName = internalIdentifier(`${name}_validator`);
        js.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
        js.push(...inlined2.map((line) => `  ${line}`));
        js.push(...indentBlock(validator2.source));
        js.push("})();");
        js.push(
          `${declaration} /*#__PURE__*/ ((v) => (json) => { const r = v.safeParse(JSON.parse(json)); if (r.success) return r.data; throw new JITValidationError(r.issues); })(${validatorName});`
        );
      } else if (op === "format") {
        const formatSource = tryEmit(name, "format", skipped, () => emitFormatSource(schema));
        if (!formatSource) return;
        js.push(`${declaration} (${formatSource});`);
      } else if (op === "mask") {
        const maskSource = tryEmit(name, "mask", skipped, () => emitMaskSource(schema));
        if (!maskSource) return;
        js.push(`${declaration} (${maskSource});`);
      } else if (op === "sanitize") {
        const sanitizeSource = tryEmit(name, "sanitize", skipped, () => emitSanitizeSource(schema));
        if (!sanitizeSource) return;
        const regexConsts = sanitizeChainBindings.names.map(
          (bindingName, position) => `const ${bindingName} = ${String(sanitizeChainBindings.values[position])};`
        );
        js.push(`${declaration} /*#__PURE__*/ (() => {`);
        js.push(...regexConsts.map((line) => `  ${line}`));
        js.push(...indentBlock(`return (${sanitizeSource});`));
        js.push("})();");
      } else {
        const codec2 = tryEmit(name, "codec", skipped, () => emitCodec(schema));
        if (!codec2) return;
        const inlined2 = inlineCodecBindings(codec2.bindingNames, codec2.bindingValues);
        if (inlined2 === void 0) {
          skipped.push({
            schema: name,
            operation: "codec",
            reason: "codec bindings cannot be serialized"
          });
          return;
        }
        js.push(`${declaration} /*#__PURE__*/ (() => {`);
        js.push(...inlined2.map((line) => `  ${line}`));
        js.push(...indentBlock(codec2.source));
        js.push("})();");
      }
      exportNames.push(name);
      dts.push(
        `export declare const ${name}: ${operationType(artifact, typeNames.get(artifact.schema))};`
      );
      dts.push("");
      return;
    }
    const inlined = inlineBindings(artifact.bindingNames, artifact.bindingValues);
    if (inlined === void 0) {
      skipped.push({
        schema: name,
        operation: artifact.kind,
        reason: `${artifact.kind} bindings hold callbacks that cannot be serialized ahead of time`
      });
      return;
    }
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    js.push(`  return (${artifact.source});`);
    js.push("})();");
    exportNames.push(name);
    dts.push(
      `export declare const ${name}: ${sourceFile ? `typeof import(${JSON.stringify(typeImportSpecifier(options.outDir, sourceFile))}).${name}` : "unknown"};`
    );
    dts.push("");
  }
  function internalIdentifier(preferred) {
    let candidate = preferred;
    let suffix = 1;
    while (publicNames.has(candidate) || internalNames.has(candidate)) {
      candidate = `${preferred}_${suffix++}`;
    }
    internalNames.add(candidate);
    return candidate;
  }
  const helpers = [];
  if (needsValidationError) {
    helpers.push(
      "class JITValidationError extends Error {",
      "  constructor(issues) {",
      "    const first = issues[0];",
      '    super(first ? (first.path ? first.path + ": " : "") + first.message : "validation failed");',
      '    this.name = "JITValidationError";',
      '    this.code = "VALIDATION_FAILED";',
      "    this.issues = issues;",
      "  }",
      "}"
    );
  }
  if (needsHashHelpers) {
    helpers.push(
      "const __hashCache = new WeakMap();",
      "function __hashNumber(value) { return value | 0; }",
      "function __hashBoolean(value) { return value ? 1 : 0; }",
      "function __hashBigInt(value) { return Number(value & 0xffffffffn) | 0; }",
      "function __hashString(value) {",
      "  let hash = 0;",
      "  for (let i = 0, len = value.length; i < len; i++) {",
      "    hash = (hash * 31 + value.charCodeAt(i)) | 0;",
      "  }",
      "  return hash;",
      "}",
      "function __hashUnknown(value) {",
      "  switch (typeof value) {",
      '    case "string": return __hashString(value);',
      '    case "number": return __hashNumber(value);',
      '    case "boolean": return __hashBoolean(value);',
      '    case "bigint": return __hashBigInt(value);',
      '    case "undefined": return 0;',
      '    case "symbol": return __hashString(String(value));',
      '    case "object": return value === null ? 1 : __hashString(Object.prototype.toString.call(value));',
      '    case "function": return __hashString("function");',
      "  }",
      "}",
      "function __combineHash(left, right) { return ((left << 5) - left + right) | 0; }"
    );
  }
  if (needsRuntimeGetIndex) {
    helpers.push(
      "const __indexCache = new WeakMap();",
      "function __getIndex(items, key) {",
      "  const cached = __indexCache.get(items);",
      "  if (cached !== undefined && cached.key === key) return cached.map;",
      "  const map = new Map();",
      "  for (let i = 0, len = items.length; i < len; i++) map.set(items[i][key], items[i]);",
      "  __indexCache.set(items, { key: key, map: map });",
      "  return map;",
      "}"
    );
  }
  const preludeIndex = layout.format === "typescript" ? 2 : 1;
  if (helpers.length > 0) js.splice(preludeIndex, 0, ...helpers);
  if (layout.format === "typescript" && tsTypes.length > 0) js.splice(preludeIndex, 0, ...tsTypes, "");
  if (exportNames.length === 0) return { files: [], skipped };
  if (options.clean !== false) cleanGeneratedFiles(options.outDir);
  mkdirSync(options.outDir, { recursive: true });
  const emit = {
    subpathModules: options.emit?.subpathModules === true,
    manifest: options.emit?.manifest === true,
    plans: options.emit?.plans === true
  };
  const body = js.join("\n");
  const exportList = exportNames.join(", ");
  const esm = exportNames.length > 0 ? `${body}
export { ${exportList} };
` : `${body}
export {};
`;
  const cjs = exportNames.length > 0 ? `${body}
module.exports = { ${exportList} };
` : `${body}
module.exports = {};
`;
  while (dts[dts.length - 1] === "") dts.pop();
  const types = `${dts.join("\n")}
`;
  const subpathModules = emit.subpathModules ? buildSubpathModules(options.outDir, exportNames, options.sources, layout) : [];
  const files2 = [];
  if (layout.format === "typescript") {
    files2.push(writeFile(options.outDir, "index.ts", esm));
  } else if (layout.kind === "package") {
    files2.push(writeFile(options.outDir, "index.mjs", esm), writeFile(options.outDir, "index.cjs", cjs));
    if (layout.format === "javascript") {
      files2.push(writeFile(options.outDir, "index.d.ts", types), writeFile(options.outDir, "index.d.cts", types));
    }
  } else {
    files2.push(writeFile(options.outDir, "index.js", esm));
    if (layout.format === "javascript") files2.push(writeFile(options.outDir, "index.d.ts", types));
  }
  files2.push(...subpathModules.flatMap((module) => module.files));
  if (layout.kind === "package") {
    files2.push(writePackageJson(options.outDir, layout, subpathModules));
  }
  if (emit.manifest) {
    files2.push(writeManifest(options.outDir, layout, exportNames, subpathModules, options));
  }
  if (emit.plans) {
    files2.push(...writePlans(options.outDir, exportNames, subpathModules, options));
  }
  return { files: files2, skipped };
}
function buildSubpathModules(outDir, exportNames, sources, layout) {
  if (!sources) return [];
  const bySource = /* @__PURE__ */ new Map();
  for (const name of exportNames) {
    const source = sources.get(name);
    if (!source) continue;
    const exports = bySource.get(source);
    if (exports) exports.push(name);
    else bySource.set(source, [name]);
  }
  const usedNames = /* @__PURE__ */ new Set();
  const modules = [];
  for (const [sourceFile, names] of bySource) {
    const moduleName = uniqueModuleName(moduleNameFromSource(sourceFile), usedNames);
    const exportList = names.join(", ");
    const importExtension = layout.format === "typescript" ? ".js" : layout.jsExtension;
    const esm = `export { ${exportList} } from "./index${importExtension}";
`;
    const dts = `export { ${exportList} } from "./index${importExtension}";
`;
    const files2 = [writeFile(outDir, `${moduleName}${layout.jsExtension}`, esm)];
    if (layout.format === "javascript") {
      files2.push(writeFile(outDir, `${moduleName}.d.ts`, dts));
    }
    if (layout.kind === "package" && layout.format !== "typescript") {
      const cjsBindings = names.map((name) => `${name}: root.${name}`).join(", ");
      const cjs = `const root = require("./index.cjs");
module.exports = { ${cjsBindings} };
`;
      files2.push(writeFile(outDir, `${moduleName}.cjs`, cjs));
      if (layout.format === "javascript") {
        const dcts = `export { ${exportList} } from "./index.cjs";
`;
        files2.push(writeFile(outDir, `${moduleName}.d.cts`, dcts));
      }
    }
    modules.push({ name: moduleName, sourceFile, exports: names, files: files2 });
  }
  return modules;
}
function writePackageJson(outDir, layout, modules) {
  if (layout.format === "typescript") {
    const exportsMap2 = {
      "./package.json": "./package.json",
      ".": {
        types: "./index.ts",
        default: "./index.ts"
      }
    };
    for (const module of modules) {
      exportsMap2[`./${module.name}`] = {
        types: `./${module.name}.ts`,
        default: `./${module.name}.ts`
      };
    }
    return writeFile(
      outDir,
      "package.json",
      `${JSON.stringify(
        {
          name: layout.packageName,
          version: "0.0.0",
          type: "module",
          types: "./index.ts",
          exports: exportsMap2,
          sideEffects: false
        },
        null,
        2
      )}
`
    );
  }
  const withTypes = layout.format === "javascript";
  const exportsMap = {
    "./package.json": "./package.json",
    ".": {
      ...withTypes ? { types: "./index.d.ts" } : {},
      import: "./index.mjs",
      require: "./index.cjs"
    }
  };
  for (const module of modules) {
    exportsMap[`./${module.name}`] = {
      ...withTypes ? { types: `./${module.name}.d.ts` } : {},
      import: `./${module.name}.mjs`,
      require: `./${module.name}.cjs`
    };
  }
  return writeFile(
    outDir,
    "package.json",
    `${JSON.stringify(
      {
        name: layout.packageName,
        version: "0.0.0",
        type: "module",
        main: "./index.cjs",
        module: "./index.mjs",
        ...withTypes ? { types: "./index.d.ts" } : {},
        exports: exportsMap,
        sideEffects: false
      },
      null,
      2
    )}
`
  );
}
function writeManifest(outDir, layout, exportNames, modules, options) {
  const moduleByExport = /* @__PURE__ */ new Map();
  for (const module of modules) {
    for (const name of module.exports) moduleByExport.set(name, module.name);
  }
  const manifestFiles = [
    `index${layout.jsExtension}`,
    ...layout.format === "javascript" ? ["index.d.ts"] : [],
    ...layout.kind === "package" ? [
      ...layout.format !== "typescript" ? ["index.cjs"] : [],
      ...layout.format === "javascript" ? ["index.d.cts"] : [],
      "package.json"
    ] : [],
    ...modules.flatMap((module) => [
      `${module.name}${layout.jsExtension}`,
      ...layout.format === "javascript" ? [`${module.name}.d.ts`] : [],
      ...layout.kind === "package" && layout.format !== "typescript" ? [`${module.name}.cjs`] : [],
      ...layout.kind === "package" && layout.format === "javascript" ? [`${module.name}.d.cts`] : []
    ])
  ];
  if (options.emit?.manifest === true) manifestFiles.push("manifest.json");
  if (options.emit?.plans === true) {
    const planNames = modules.length > 0 ? modules.map((module) => module.name) : ["index"];
    manifestFiles.push(...planNames.map((module) => `plans/${module}.json`));
  }
  return writeFile(
    outDir,
    "manifest.json",
    `${JSON.stringify(
      {
        version: 1,
        layout: layout.kind,
        format: layout.format,
        ...layout.kind === "package" ? { packageName: layout.packageName } : {},
        files: manifestFiles,
        modules: modules.length > 0 ? modules.map((module) => ({
          name: module.name,
          source: manifestSourceSpecifier(outDir, module.sourceFile),
          import: layout.kind === "package" ? `${layout.packageName}/${module.name}` : `./${module.name}${layout.format === "typescript" ? ".js" : layout.jsExtension}`,
          exports: module.exports
        })) : [
          {
            name: "index",
            import: layout.kind === "package" ? layout.packageName : `./index${layout.format === "typescript" ? ".js" : layout.jsExtension}`,
            exports: exportNames
          }
        ],
        artifacts: exportNames.map((name) => ({
          ...describeExport(name, options),
          module: moduleByExport.get(name) ?? "index"
        }))
      },
      null,
      2
    )}
`
  );
}
function writePlans(outDir, exportNames, modules, options) {
  const plansDir = join(
    /* turbopackIgnore: true */
    outDir,
    "plans"
  );
  mkdirSync(plansDir, { recursive: true });
  if (modules.length === 0) {
    return [writePlan(plansDir, "index", exportNames, options)];
  }
  return modules.map((module) => writePlan(plansDir, module.name, module.exports, options));
}
function writePlan(plansDir, moduleName, exportNames, options) {
  return writeFile(
    plansDir,
    `${moduleName}.json`,
    `${JSON.stringify(
      {
        version: 1,
        module: moduleName,
        artifacts: exportNames.map((name) => describeExport(name, options))
      },
      null,
      2
    )}
`
  );
}
function describeExport(name, options) {
  const schema = options.schemas[name];
  if (schema !== void 0) {
    return { name, kind: "grouped", operations: readRequestedOps(schema) ?? [] };
  }
  const artifact = getArtifact(options.functions?.[name]);
  if (!artifact) return { name, kind: "unknown", operations: [] };
  if (artifact.kind === "validator") return { name, kind: "validator", operations: [artifact.op] };
  if (artifact.kind === "operation") return { name, kind: "operation", operations: [artifact.op] };
  return { name, kind: artifact.kind, operations: [artifact.kind] };
}
function tryEmit(schema, operation, skipped, emit) {
  try {
    return emit();
  } catch (error) {
    skipped.push({
      schema,
      operation,
      reason: error instanceof Error ? error.message : String(error)
    });
    return void 0;
  }
}
function standaloneType(artifact, namedType) {
  if (namedType) {
    return validatorType(artifact.op, namedType);
  }
  const valueType = emitTypeScriptType(artifact.schema);
  return validatorType(artifact.op, valueType);
}
function validatorType(op, valueType) {
  switch (op) {
    case "is":
      return `(value: unknown) => value is ${valueType}`;
    case "parse":
      return `(value: unknown) => ${valueType}`;
    case "safeParse":
      return `(value: unknown) => { readonly success: true; readonly data: ${valueType} } | { readonly success: false; readonly issues: readonly { readonly path: string; readonly code: string; readonly expected: string; readonly message: string; readonly received?: string }[] }`;
    case "parseAsync":
      return `(value: unknown) => Promise<${valueType}>`;
    case "safeParseAsync":
      return `(value: unknown) => Promise<{ readonly success: true; readonly data: ${valueType} } | { readonly success: false; readonly issues: readonly { readonly path: string; readonly code: string; readonly expected: string; readonly message: string; readonly received?: string }[] }>`;
  }
}
function operationType(artifact, namedType) {
  if (namedType) {
    return operationSignature(artifact.op, namedType);
  }
  const valueType = emitTypeScriptType(artifact.schema);
  return operationSignature(artifact.op, valueType);
}
function operationSignature(op, valueType) {
  switch (op) {
    case "hash":
      return `(value: ${valueType}) => number`;
    case "equal":
      return `(left: ${valueType}, right: ${valueType}) => boolean`;
    case "clone":
      return `(value: ${valueType}) => ${valueType}`;
    case "diff":
      return `(left: ${valueType}, right: ${valueType}) => readonly { readonly type: "add" | "remove" | "update"; readonly path: readonly PropertyKey[]; readonly value?: unknown }[]`;
    case "mask":
    case "sanitize":
      return `(value: ${valueType}) => ${valueType}`;
    case "stringify":
      return `(value: ${valueType}) => string`;
    case "fromJSON":
      return `(json: string) => ${valueType}`;
    case "format":
      return `(value: string) => string`;
    case "codec":
      return `{ readonly encode: (value: ${valueType}) => Uint8Array; readonly encodeInto: (value: ${valueType}, target: Uint8Array) => number; readonly decode: (bytes: Uint8Array | ArrayBuffer) => ${valueType} }`;
  }
}
function inlineBindings(names, values) {
  const lines = [];
  for (let index = 0; index < names.length; index++) {
    const value = values[index];
    const literal3 = serializeBindingValue(value);
    if (literal3 === void 0) return void 0;
    lines.push(`const ${names[index]} = ${literal3};`);
  }
  return lines;
}
function inlineCodecBindings(names, values) {
  const lines = [];
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    const value = values[index];
    if (name === "__enc") {
      lines.push("const __enc = new TextEncoder();");
      continue;
    }
    if (name === "__dec") {
      lines.push("const __dec = new TextDecoder();");
      continue;
    }
    const literal3 = serializeBindingValue(value);
    if (literal3 === void 0) return void 0;
    lines.push(`const ${name} = ${literal3};`);
  }
  return lines;
}
function serializeBindingValue(value) {
  if (value instanceof RegExp) return String(value);
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (value === void 0) return "undefined";
  if (Array.isArray(value)) {
    const parts = value.map(serializeBindingValue);
    if (parts.some((part) => part === void 0)) return void 0;
    return `[${parts.join(", ")}]`;
  }
  return void 0;
}
function typeImportSpecifier(outDir, sourceFile) {
  const relativePath = relative(
    resolve(
      /* turbopackIgnore: true */
      outDir
    ),
    resolve(
      /* turbopackIgnore: true */
      sourceFile
    )
  ).split("\\").join("/");
  const mapped = relativePath.replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs").replace(/\.ts$/, ".js");
  return mapped.startsWith(".") ? mapped : `./${mapped}`;
}
function manifestSourceSpecifier(outDir, sourceFile) {
  const relativePath = relative(
    resolve(
      /* turbopackIgnore: true */
      outDir
    ),
    resolve(
      /* turbopackIgnore: true */
      sourceFile
    )
  ).split("\\").join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}
function moduleNameFromSource(sourceFile) {
  const rawName = basename(sourceFile).replace(/\.jit\.(ts|mts|cts|js|mjs|cjs)$/, "").replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "");
  const normalized = rawName.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "schema";
}
function uniqueModuleName(preferred, used) {
  let candidate = preferred;
  let suffix = 1;
  while (used.has(candidate)) candidate = `${preferred}-${++suffix}`;
  used.add(candidate);
  return candidate;
}
function resolveOutputLayout(outDir, configuredPackageName, format3) {
  const segments = resolve(
    /* turbopackIgnore: true */
    outDir
  ).split(/[\\/]+/);
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0) {
    return {
      kind: "local",
      format: format3,
      packageName: configuredPackageName ?? "@jit/generated",
      jsExtension: format3 === "typescript" ? ".ts" : ".js"
    };
  }
  const first = segments[nodeModulesIndex + 1];
  const second = segments[nodeModulesIndex + 2];
  const inferred = first?.startsWith("@") && second ? `${first}/${second}` : first;
  return {
    kind: "package",
    format: format3,
    packageName: configuredPackageName ?? inferred ?? "@jit/generated",
    jsExtension: format3 === "typescript" ? ".ts" : ".mjs"
  };
}
var AOT_OPS = new Set(AOT_OPERATIONS);
var GENERATED_FILES = [
  "index.js",
  "index.mjs",
  "index.cjs",
  "index.ts",
  "index.d.ts",
  "index.d.cts",
  "manifest.json"
];
function readExtraNames(input) {
  const candidate = input.extras;
  if (Array.isArray(candidate) && candidate.every((key) => typeof key === "string")) {
    return candidate;
  }
  return [];
}
function readRequestedOps(input) {
  const candidate = input.ops;
  if (Array.isArray(candidate) && candidate.every((op) => typeof op === "string")) {
    return candidate;
  }
  return void 0;
}
function readAotExportMode(input) {
  const candidate = input.__jitAot;
  return candidate === "grouped" ? candidate : void 0;
}
function indentBlock(source) {
  return source.split("\n").map((line) => line.length > 0 ? `  ${line}` : line);
}
function writeFile(dir, name, content) {
  const path = join(
    /* turbopackIgnore: true */
    dir,
    name
  );
  writeFileSync(path, content);
  return path;
}
function cleanGeneratedFiles(dir) {
  const manifest = readGeneratedManifest(dir);
  for (const file2 of manifest.files) {
    rmSync(join(
      /* turbopackIgnore: true */
      dir,
      file2
    ), { force: true });
  }
  for (const file2 of GENERATED_FILES) {
    rmSync(join(
      /* turbopackIgnore: true */
      dir,
      file2
    ), { force: true });
  }
  if (isGeneratedPackageJson(dir)) {
    rmSync(join(
      /* turbopackIgnore: true */
      dir,
      "package.json"
    ), { force: true });
  }
  rmSync(join(
    /* turbopackIgnore: true */
    dir,
    "plans"
  ), { recursive: true, force: true });
}
function isGeneratedPackageJson(dir) {
  const path = join(
    /* turbopackIgnore: true */
    dir,
    "package.json"
  );
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed.version === "0.0.0" && parsed.sideEffects === false && parsed.exports !== void 0;
  } catch {
    return false;
  }
}
function readGeneratedManifest(dir) {
  const path = join(
    /* turbopackIgnore: true */
    dir,
    "manifest.json"
  );
  if (!existsSync(path)) return { files: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed.files)) return { files: [] };
    return { files: parsed.files.filter((file2) => typeof file2 === "string" && !file2.includes("..")) };
  } catch {
    return { files: [] };
  }
}

// ../../packages/jit/src/core/host.ts
var AOT_ARTIFACT = /* @__PURE__ */ Symbol.for("@jit/aot-artifact");

// ../../packages/jit/src/factories/index.ts
var factories_exports = {};
__export(factories_exports, {
  COMPILE_OPS: () => COMPILE_OPS,
  DTO_OPS: () => DTO_OPS,
  KeyedWatchedList: () => KeyedWatchedList,
  MAPPER_OPS: () => MAPPER_OPS,
  MODEL_OPS: () => MODEL_OPS,
  WatchedList: () => WatchedList,
  any: () => any,
  array: () => array,
  bigint: () => bigint2,
  boolean: () => boolean2,
  brand: () => brand2,
  clone: () => clone,
  codec: () => codec,
  coerce: () => coerce2,
  compile: () => compile,
  compileClone: () => compileClone,
  compileDiff: () => compileDiff,
  compileEqual: () => compileEqual,
  compileGroupBy: () => compileGroupBy,
  compileHash: () => compileHash,
  compileMerge: () => compileMerge,
  compileNormalize: () => compileNormalize,
  compileOmit: () => compileOmit,
  compilePick: () => compilePick,
  compilePipeline: () => compilePipeline,
  compileSortBy: () => compileSortBy,
  compileTransform: () => compileTransform,
  compileUniqueBy: () => compileUniqueBy,
  compileUpdate: () => compileUpdate,
  const: () => constant,
  custom: () => custom,
  date: () => date2,
  default: () => defaultTo2,
  diff: () => diff,
  discriminatedUnion: () => discriminatedUnion,
  dto: () => dto,
  enum: () => nativeEnum,
  equal: () => equal,
  file: () => file,
  format: () => format,
  function: () => functionSchema,
  hash: () => hash2,
  instanceOf: () => instanceOf,
  int: () => int,
  intersection: () => intersection,
  iso: () => iso,
  json: () => json2,
  lazy: () => lazy,
  literal: () => literal2,
  map: () => map,
  mapper: () => mapper,
  mask: () => mask,
  model: () => model,
  nan: () => nan,
  never: () => never,
  not: () => not2,
  null: () => nullType,
  nullable: () => nullable2,
  nullish: () => nullish2,
  number: () => number2,
  object: () => object,
  optional: () => optional2,
  param: () => param,
  pipe: () => pipe2,
  process: () => process,
  promise: () => promise2,
  query: () => query,
  readonly: () => readonly2,
  record: () => record,
  refine: () => refine2,
  regex: () => regex,
  regexes: () => regexes_exports,
  sanitize: () => sanitize,
  serializer: () => serializer,
  set: () => set,
  stream: () => stream,
  string: () => string,
  symbol: () => symbol,
  templateLiteral: () => templateLiteral,
  templateLiterals: () => templateLiteral,
  temporal: () => temporal,
  transform: () => transform2,
  tuple: () => tuple,
  undefined: () => undefinedType,
  union: () => union,
  unknown: () => unknown,
  update: () => update,
  validate: () => validate,
  validator: () => validator,
  void: () => voidType,
  watch: () => watch,
  watchedList: () => watchedList,
  xor: () => xor
});

// ../../packages/jit/src/compiler/object-ops.ts
function emitMergeSource(schema) {
  const writer = new CodeWriter();
  const objectSchema = expectObjectSchema(schema, "compileMerge");
  writer.line("function merge(left, right) {");
  writer.indent(() => {
    emitMergeTo(writer, createEmitState(), objectSchema, "left", "right", "out");
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}
function compileMerge(schema) {
  return globalThis.Function(`return ${emitMergeSource(schema)};`)();
}
function emitPickSource(schema, keys) {
  const objectSchema = expectObjectSchema(schema, "compilePick");
  const selectedKeys = validateObjectKeys(objectSchema, keys, "compilePick");
  return emitProjectSource("pick", selectedKeys);
}
function compilePick(schema, keys) {
  return globalThis.Function(`return ${emitPickSource(schema, keys)};`)();
}
function emitOmitSource(schema, keys) {
  const objectSchema = expectObjectSchema(schema, "compileOmit");
  const omitted = new Set(validateObjectKeys(objectSchema, keys, "compileOmit"));
  const selectedKeys = Object.keys(objectSchema.def.props).filter((key) => !omitted.has(key));
  return emitProjectSource("omit", selectedKeys);
}
function compileOmit(schema, keys) {
  return globalThis.Function(`return ${emitOmitSource(schema, keys)};`)();
}
function emitTransformSource(schema, transforms) {
  const objectSchema = expectObjectSchema(schema, "compileTransform");
  const transformKeys = validateObjectKeys(objectSchema, Object.keys(transforms), "compileTransform");
  const transformNames = new Map(transformKeys.map((key, index) => [key, `__t${index}`]));
  const entries = Object.keys(objectSchema.def.props).map((key) => {
    const source = emitPropertyAccess("value", key);
    const transformName = transformNames.get(key);
    const value = transformName ? `${transformName}(${source}, value)` : source;
    return `${emitLiteral(key)}: ${value}`;
  });
  const writer = new CodeWriter();
  writer.line("function transform(value) {");
  writer.indent(() => writer.line(`return { ${entries.join(", ")} };`));
  writer.line("}");
  return writer.toString();
}
function compileTransform(schema, transforms) {
  const objectSchema = expectObjectSchema(schema, "compileTransform");
  const transformKeys = validateObjectKeys(objectSchema, Object.keys(transforms), "compileTransform");
  const bindings = transformKeys.map((key) => transforms[key]);
  return globalThis.Function(
    ...transformKeys.map((_, index) => `__t${index}`),
    `return ${emitTransformSource(schema, transforms)};`
  )(...bindings);
}
function emitNormalizeSource(schema, key) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.array) {
    throw new JITError("INVALID_OPERATION", "compileNormalize expects an array schema");
  }
  const element = resolveWrappers(resolved.def.element).base;
  if (element.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "compileNormalize expects an array of object schema");
  }
  const objectSchema = element;
  const normalizeKey2 = key ?? resolveNormalizeKey(schema);
  if (!normalizeKey2) {
    throw new JITError("INVALID_OPERATION", "compileNormalize requires a key or a .keyed()/index/entity hint");
  }
  validateObjectKeys(objectSchema, [normalizeKey2], "compileNormalize");
  const idAccess = emitPropertyAccess("item", normalizeKey2);
  const writer = new CodeWriter();
  writer.line("function normalize(value) {");
  writer.indent(() => {
    writer.line("const len = value.length;");
    writer.line("const byId = {};");
    writer.line("const ids = new Array(len);");
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = value[i];");
      writer.line(`const id = ${idAccess};`);
      writer.line("ids[i] = id;");
      writer.line("byId[id] = item;");
    });
    writer.line("}");
    writer.line("return { byId, ids };");
  });
  writer.line("}");
  return writer.toString();
}
function compileNormalize(schema, key) {
  return globalThis.Function(`return ${emitNormalizeSource(schema, key)};`)();
}
function emitGroupBySource(schema, key) {
  const { objectSchema, key: groupKey } = expectArrayObjectKey(schema, key, "compileGroupBy", resolveGroupByKey);
  validateObjectKeys(objectSchema, [groupKey], "compileGroupBy");
  const keyAccess = emitPropertyAccess("item", groupKey);
  const writer = new CodeWriter();
  writer.line("function groupBy(value) {");
  writer.indent(() => {
    writer.line("const out = {};");
    writer.line("for (let i = 0, len = value.length; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = value[i];");
      writer.line(`const key = ${keyAccess};`);
      writer.line("let group = out[key];");
      writer.line("if (group === undefined) {");
      writer.indent(() => {
        writer.line("group = [];");
        writer.line("out[key] = group;");
      });
      writer.line("}");
      writer.line("group[group.length] = item;");
    });
    writer.line("}");
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}
function compileGroupBy(schema, key) {
  return globalThis.Function(`return ${emitGroupBySource(schema, key)};`)();
}
function emitSortBySource(schema, key, direction) {
  const hints = resolveHints(schema);
  const hintKey = typeof hints.order?.key === "string" ? hints.order.key : resolveNormalizeKey(schema);
  const sortKey = key ?? hintKey;
  if (!sortKey) {
    throw new JITError("INVALID_OPERATION", "compileSortBy requires a key or a .ordered()/.keyed()/index/entity hint");
  }
  const { objectSchema } = expectArrayObjectKey(schema, sortKey, "compileSortBy", () => sortKey);
  const sortDirection = direction ?? (typeof hints.order?.direction === "string" ? hints.order.direction : "asc");
  const leftAccess = emitPropertyAccess("left", sortKey);
  const rightAccess = emitPropertyAccess("right", sortKey);
  const writer = new CodeWriter();
  validateObjectKeys(objectSchema, [sortKey], "compileSortBy");
  writer.line("function sortBy(value) {");
  writer.indent(() => {
    writer.line("const out = value.slice();");
    writer.line("out.sort((left, right) => {");
    writer.indent(() => {
      writer.line(`const leftValue = ${leftAccess};`);
      writer.line(`const rightValue = ${rightAccess};`);
      writer.line("if (leftValue === rightValue) return 0;");
      if (sortDirection === "desc") {
        writer.line("return leftValue < rightValue ? 1 : -1;");
      } else {
        writer.line("return leftValue < rightValue ? -1 : 1;");
      }
    });
    writer.line("});");
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}
function compileSortBy(schema, key, direction) {
  return globalThis.Function(`return ${emitSortBySource(schema, key, direction)};`)();
}
function emitUniqueBySource(schema, key) {
  const { objectSchema, key: uniqueKey } = expectArrayObjectKey(schema, key, "compileUniqueBy", resolveNormalizeKey);
  validateObjectKeys(objectSchema, [uniqueKey], "compileUniqueBy");
  const keyAccess = emitPropertyAccess("item", uniqueKey);
  const writer = new CodeWriter();
  writer.line("function uniqueBy(value) {");
  writer.indent(() => {
    writer.line("const seen = new Set();");
    writer.line("const out = [];");
    writer.line("for (let i = 0, len = value.length; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = value[i];");
      writer.line(`const key = ${keyAccess};`);
      writer.line("if (!seen.has(key)) {");
      writer.indent(() => {
        writer.line("seen.add(key);");
        writer.line("out[out.length] = item;");
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}
function compileUniqueBy(schema, key) {
  return globalThis.Function(`return ${emitUniqueBySource(schema, key)};`)();
}
function emitMergeTo(writer, state, schema, left, right, target) {
  const entries = [];
  const changed = [];
  writer.line(`let ${target} = ${left};`);
  writer.line(`if (${right} !== undefined && !Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    for (const key of Object.keys(schema.def.props)) {
      const propSchema = schema.def.props[key];
      const next = state.nextVar(`next_${key}`);
      emitMergeProp(writer, state, propSchema, emitPropertyAccess(left, key), emitPropertyAccess(right, key), next);
      entries.push(`${emitLiteral(key)}: ${next}`);
      changed.push(`!Object.is(${next}, ${emitPropertyAccess(left, key)})`);
    }
    writer.line(`if (${changed.join(" || ")}) {`);
    writer.indent(() => writer.line(`${target} = { ${entries.join(", ")} };`));
    writer.line("}");
  });
  writer.line("}");
}
function emitMergeProp(writer, state, schema, left, right, target) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.object) {
    writer.line(`const ${target} = ${right} !== undefined ? ${right} : ${left};`);
    return;
  }
  writer.line(`let ${target} = ${left};`);
  writer.line(`if (${right} !== undefined && !Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(`if (${left} == null || ${right} == null) {`);
    writer.indent(() => writer.line(`${target} = ${right};`));
    writer.line("} else {");
    writer.indent(() => {
      const merged = state.nextVar(`${target}_merged`);
      emitMergeTo(writer, state, resolved, left, right, merged);
      writer.line(`${target} = ${merged};`);
    });
    writer.line("}");
  });
  writer.line("}");
}
function emitProjectSource(name, selectedKeys) {
  const entries = selectedKeys.map((key) => `${emitLiteral(key)}: ${emitPropertyAccess("value", key)}`);
  const writer = new CodeWriter();
  writer.line(`function ${name}(value) {`);
  writer.indent(() => writer.line(`return { ${entries.join(", ")} };`));
  writer.line("}");
  return writer.toString();
}
function expectObjectSchema(schema, compilerName) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects an object schema`);
  }
  return resolved;
}
function validateObjectKeys(schema, keys, compilerName) {
  const props = schema.def.props;
  for (const key of keys) {
    if (!(key in props)) {
      throw new JITError("INVALID_OPERATION", `${compilerName} received unknown key ${JSON.stringify(key)}`, {
        path: [key]
      });
    }
  }
  return [...keys];
}
function resolveNormalizeKey(schema) {
  const hints = resolveHints(schema);
  const key = hints.collection?.uniqueBy ?? hints.index?.key ?? hints.collection?.identify ?? hints.entity?.key;
  return typeof key === "string" ? key : void 0;
}
function resolveGroupByKey(schema) {
  const hints = resolveHints(schema);
  const key = hints.collection?.groupBy ?? hints.index?.key ?? hints.collection?.identify ?? hints.entity?.key;
  return typeof key === "string" ? key : void 0;
}
function expectArrayObjectKey(schema, key, compilerName, resolveKey) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.array) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects an array schema`);
  }
  const element = resolveWrappers(resolved.def.element).base;
  if (element.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects an array of object schema`);
  }
  const resolvedKey = key ?? resolveKey(schema);
  if (!resolvedKey) {
    throw new JITError("INVALID_OPERATION", `${compilerName} requires a key or a compatible array hint`);
  }
  return { objectSchema: element, key: resolvedKey };
}

// ../../packages/jit/src/compiler/pipeline.ts
function emitPipelineProgram(schema) {
  const bindings = [];
  const writer = new CodeWriter();
  writer.line("function pipeline(value) {");
  writer.indent(() => {
    writer.line("let out = value;");
    emitPipelineSteps(writer, schema, bindings);
    writer.line("return out;");
  });
  writer.line("}");
  return { source: writer.toString(), bindings };
}
function compilePipeline(schema) {
  const program = emitPipelineProgram(schema);
  const bindingNames = program.bindings.map((_, index) => `__p${index}`);
  return globalThis.Function(
    ...bindingNames,
    "__JITError",
    `return ${program.source};`
  )(...program.bindings, JITError);
}
function emitPipelineSteps(writer, schema, bindings) {
  if (hasInnerType(schema)) {
    emitPipelineSteps(writer, schema.def.innerType, bindings);
  }
  switch (schema.type) {
    case TypeName.coerce: {
      const binding = addBinding(bindings, schema.def.coercer);
      writer.line(`out = ${binding}(out);`);
      return;
    }
    case TypeName.transform: {
      const transformSchema = schema;
      const transforms = transformSchema.def.transforms;
      const keys = objectKeys(transformSchema.def.innerType, transforms);
      const entries = keys.map((key) => {
        const transform3 = transforms[key];
        const source = emitPropertyAccess("out", key);
        const value = typeof transform3 === "function" ? `${addBinding(bindings, transform3)}(${source}, out)` : source;
        return `${emitLiteral(key)}: ${value}`;
      });
      writer.line(`out = { ${entries.join(", ")} };`);
      return;
    }
    case TypeName.pipe: {
      const binding = addBinding(bindings, schema.def.transform);
      writer.line(`out = ${binding}(out);`);
      return;
    }
    case TypeName.refine: {
      const binding = addBinding(bindings, schema.def.predicate);
      writer.line(`if (!${binding}(out)) {`);
      writer.indent(() => writer.line('throw new __JITError("REFINE_FAILED", "Refine predicate failed");'));
      writer.line("}");
      return;
    }
  }
}
function objectKeys(schema, transforms) {
  const base = unwrapBase(schema);
  return base.type === TypeName.object ? Object.keys(base.def.props) : Object.keys(transforms);
}
function unwrapBase(schema) {
  let current = schema;
  while (hasInnerType(current)) {
    current = current.def.innerType;
  }
  return current;
}
function addBinding(bindings, value) {
  const name = `__p${bindings.length}`;
  bindings[bindings.length] = value;
  return name;
}
function hasInnerType(schema) {
  return schema.type === TypeName.optional || schema.type === TypeName.nullable || schema.type === TypeName.nullish || schema.type === TypeName.default || schema.type === TypeName.brand || schema.type === TypeName.transform || schema.type === TypeName.pipe || schema.type === TypeName.refine || schema.type === TypeName.coerce || schema.type === TypeName.readonly || schema.type === TypeName.promise;
}

// ../../packages/jit/src/compiler/update/build-update-ir.ts
function buildUpdateIR(schema) {
  return {
    kind: "program",
    valueParam: "value",
    patchParam: "patch",
    body: buildUpdateNode(schema)
  };
}
function buildUpdateNode(schema) {
  if (schema.type === TypeName.date) return { kind: "date" };
  if (schema.type === TypeName.union) return buildUnionNode3(schema);
  if (schema.type === TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode3(schema);
  const node = buildSchemaNode(schema, buildUpdateNode);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };
  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler update IR for type: ${schema.type}`);
}
function buildUnionNode3(schema) {
  if (schema.def.options.every((option) => isPrimitiveLikeSchema(option))) {
    return { kind: "reuse" };
  }
  return {
    kind: "union",
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildUpdateNode(option)
    }))
  };
}
function buildDiscriminatedUnionNode3(schema) {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: buildUpdateNode(option)
    }))
  };
}

// ../../packages/jit/src/compiler/update/emit-update.ts
function emitUpdateBody(program) {
  const writer = new CodeWriter();
  emitUpdateBodyLines(writer, createEmitState(), program.body, program.valueParam, program.patchParam);
  return writer.toString();
}
function emitUpdateBodyLines(writer, state, node, value, patch) {
  emitUpdateTo(writer, state, node, value, patch, "out");
  writer.line("return out;");
}
function emitUpdateTo(writer, state, node, value, patch, target) {
  switch (node.kind) {
    case "reuse":
      writer.line(`let ${target} = ${value};`);
      writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
      writer.indent(() => writer.line(`${target} = ${patch};`));
      writer.line("}");
      return;
    case "date":
      writer.line(`let ${target} = ${value};`);
      writer.line(
        `if (${patch} !== undefined && !Object.is(${value}, ${patch}) && ${value}.getTime() !== ${patch}.getTime()) {`
      );
      writer.indent(() => writer.line(`${target} = new Date(${patch}.getTime());`));
      writer.line("}");
      return;
    case "union":
      emitUnionUpdateTo(writer, state, node, value, patch, target);
      return;
    case "discriminatedUnion":
      emitDiscriminatedUnionUpdateTo(writer, state, node, value, patch, target);
      return;
    case "guard":
      emitGuardUpdateTo(writer, state, node, value, patch, target);
      return;
    case "object":
      emitObjectUpdateTo(writer, state, node, value, patch, target);
      return;
    case "array":
      emitArrayUpdateTo(writer, state, node, value, patch, target);
      return;
    case "tuple":
      emitTupleUpdateTo(writer, state, node, value, patch, target);
      return;
    case "record":
      emitRecordUpdateTo(writer, state, node, value, patch, target);
      return;
    case "set":
      emitSetUpdateTo(writer, value, patch, target);
      return;
    case "map":
      emitMapUpdateTo(writer, value, patch, target);
      return;
  }
}
function emitGuardUpdateTo(writer, state, node, value, patch, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    writer.line(`if (!(${emitGuardTest(node.optional, node.nullable, patch)})) {`);
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line(`} else if (!(${emitGuardTest(node.optional, node.nullable, value)})) {`);
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line("} else {");
    writer.indent(() => {
      const inner = state.nextVar(`${target}_inner`);
      emitUpdateTo(writer, state, node.inner, value, patch, inner);
      writer.line(`${target} = ${inner};`);
    });
    writer.line("}");
  });
  writer.line("}");
}
function emitObjectUpdateTo(writer, state, node, value, patch, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined) {`);
  writer.indent(() => {
    const entries = [];
    const changedVars = [];
    for (const prop of node.props) {
      const rawPropValue = emitPropertyAccess(value, prop.key);
      const defaultedPropValue = emitDefaultedValue(prop.schema, rawPropValue);
      const propValue = defaultedPropValue === rawPropValue ? rawPropValue : state.nextVar(`value_${prop.key}`);
      const propPatch = emitPropertyAccess(patch, prop.key);
      const propNext = state.nextVar(`next_${prop.key}`);
      if (propValue !== rawPropValue) {
        writer.line(`const ${propValue} = ${defaultedPropValue};`);
      }
      emitUpdateTo(writer, state, prop.value, propValue, propPatch, propNext);
      changedVars.push(`${propNext} !== ${propValue}`);
      entries.push(`${emitLiteral(prop.key)}: ${propNext}`);
    }
    writer.line(`if (${changedVars.join(" || ")}) {`);
    writer.indent(() => writer.line(`${target} = { ${entries.join(", ")} };`));
    writer.line("}");
  });
  writer.line("}");
}
function emitUnionUpdateTo(writer, state, node, value, patch, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    if (node.options.length === 0) {
      writer.line(`${target} = ${patch};`);
      return;
    }
    let prefix = "if";
    for (const option of node.options) {
      writer.line(`${prefix} (${emitSchemaGuard(option.schema, value)}) {`);
      writer.indent(() => {
        const next = state.nextVar(`${target}_branch`);
        emitUpdateTo(writer, state, option.node, value, patch, next);
        writer.line(`${target} = ${next};`);
      });
      prefix = "} else if";
    }
    writer.line("} else {");
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line("}");
  });
  writer.line("}");
}
function emitDiscriminatedUnionUpdateTo(writer, state, node, value, patch, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    if (node.options.length === 0) {
      writer.line(`${target} = ${patch};`);
      return;
    }
    let prefix = "if";
    for (const option of node.options) {
      writer.line(`${prefix} (${emitSchemaGuard(option.schema, value)}) {`);
      writer.indent(() => {
        const tag = literalDiscriminatorValue(option.schema, node.discriminator);
        const next = state.nextVar(`${target}_branch`);
        if (tag !== void 0) {
          const patchTag = emitPropertyAccess(patch, node.discriminator);
          writer.line(`if (${patchTag} !== undefined && ${patchTag} !== ${emitLiteral(tag)}) {`);
          writer.indent(() => writer.line(`${target} = ${patch};`));
          writer.line("} else {");
          writer.indent(() => {
            emitUpdateTo(writer, state, option.node, value, patch, next);
            writer.line(`${target} = ${next};`);
          });
          writer.line("}");
          return;
        }
        emitUpdateTo(writer, state, option.node, value, patch, next);
        writer.line(`${target} = ${next};`);
      });
      prefix = "} else if";
    }
    writer.line("} else {");
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line("}");
  });
  writer.line("}");
}
function emitTupleUpdateTo(writer, state, node, value, patch, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined) {`);
  writer.indent(() => {
    const entries = [];
    const changedVars = [];
    for (let index = 0; index < node.items.length; index++) {
      const itemNext = state.nextVar(`next_${index}`);
      emitUpdateTo(writer, state, node.items[index], `${value}[${index}]`, `${patch}[${index}]`, itemNext);
      changedVars.push(`${itemNext} !== ${value}[${index}]`);
      entries.push(itemNext);
    }
    writer.line(`if (${changedVars.join(" || ")}) {`);
    writer.indent(() => writer.line(`${target} = [${entries.join(", ")}];`));
    writer.line("}");
  });
  writer.line("}");
}
function emitArrayUpdateTo(writer, state, node, value, patch, target) {
  const len = state.nextVar("len");
  const patchLen = state.nextVar("patchLen");
  const index = state.nextVar("i");
  const item = state.nextVar("item");
  const patchItem = state.nextVar("patchItem");
  const next = state.nextVar("next");
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined) {`);
  writer.indent(() => {
    writer.line(`const ${len} = ${value}.length;`);
    writer.line(`const ${patchLen} = ${patch}.length;`);
    writer.line(`for (let ${index} = 0; ${index} < ${patchLen}; ${index}++) {`);
    writer.indent(() => {
      writer.line(`const ${patchItem} = ${patch}[${index}];`);
      writer.line(`if (${patchItem} !== undefined) {`);
      writer.indent(() => {
        writer.line(`if (${index} >= ${len}) {`);
        writer.indent(() => {
          writer.line(`if (${target} === ${value}) {`);
          writer.indent(() => writer.line(`${target} = ${value}.slice();`));
          writer.line("}");
          writer.line(`${target}[${index}] = ${patchItem};`);
        });
        writer.line("} else {");
        writer.indent(() => {
          writer.line(`const ${item} = ${value}[${index}];`);
          emitUpdateTo(writer, state, node.element, item, patchItem, next);
          writer.line(`if (${next} !== ${item}) {`);
          writer.indent(() => {
            writer.line(`if (${target} === ${value}) {`);
            writer.indent(() => writer.line(`${target} = ${value}.slice();`));
            writer.line("}");
            writer.line(`${target}[${index}] = ${next};`);
          });
          writer.line("}");
        });
        writer.line("}");
      });
      writer.line("}");
    });
    writer.line("}");
  });
  writer.line("}");
}
function emitRecordUpdateTo(writer, state, node, value, patch, target) {
  const keys = state.nextVar("keys");
  const patchKeys = state.nextVar("patchKeys");
  const len = state.nextVar("len");
  const index = state.nextVar("i");
  const key = state.nextVar("key");
  const next = state.nextVar("next");
  const recordOut = state.nextVar("recordOut");
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    writer.line(`let changed = false;`);
    writer.line(`const ${keys} = Object.keys(${value});`);
    writer.line(`const ${patchKeys} = Object.keys(${patch});`);
    writer.line(`if (${keys}.length !== ${patchKeys}.length) {`);
    writer.indent(() => writer.line("changed = true;"));
    writer.line("}");
    writer.line(`for (let ${index} = 0, ${len} = ${patchKeys}.length; ${index} < ${len}; ${index}++) {`);
    writer.indent(() => {
      writer.line(`const ${key} = ${patchKeys}[${index}];`);
      emitUpdateTo(writer, state, node.value, `${value}[${key}]`, `${patch}[${key}]`, next);
      writer.line(`if (${next} !== ${value}[${key}]) {`);
      writer.indent(() => {
        writer.line("changed = true;");
        writer.line("break;");
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("if (changed) {");
    writer.indent(() => {
      writer.line(`const ${recordOut} = {};`);
      writer.line(`for (let ${index} = 0, ${len} = ${patchKeys}.length; ${index} < ${len}; ${index}++) {`);
      writer.indent(() => {
        writer.line(`const ${key} = ${patchKeys}[${index}];`);
        emitUpdateTo(writer, state, node.value, `${value}[${key}]`, `${patch}[${key}]`, next);
        writer.line(`${recordOut}[${key}] = ${next};`);
      });
      writer.line("}");
      writer.line(`${target} = ${recordOut};`);
    });
    writer.line("}");
  });
  writer.line("}");
}
function emitSetUpdateTo(writer, value, patch, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    writer.line(`if (${value}.size !== ${patch}.size) {`);
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line("} else {");
    writer.indent(() => {
      writer.line(`const iter = ${patch}.values();`);
      writer.line("let step = iter.next();");
      writer.line("while (!step.done) {");
      writer.indent(() => {
        writer.line("const item = step.value;");
        writer.line(`if (!${value}.has(item)) {`);
        writer.indent(() => {
          writer.line(`${target} = ${patch};`);
          writer.line("break;");
        });
        writer.line("}");
        writer.line("step = iter.next();");
      });
      writer.line("}");
    });
    writer.line("}");
  });
  writer.line("}");
}
function emitMapUpdateTo(writer, value, patch, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    writer.line(`if (${value}.size !== ${patch}.size) {`);
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line("} else {");
    writer.indent(() => {
      writer.line(`const iter = ${patch}.entries();`);
      writer.line("let step = iter.next();");
      writer.line("while (!step.done) {");
      writer.indent(() => {
        writer.line("const entry = step.value;");
        writer.line("const key = entry[0];");
        writer.line("const nextValue = entry[1];");
        writer.line(`if (!${value}.has(key) || !Object.is(${value}.get(key), nextValue)) {`);
        writer.indent(() => {
          writer.line(`${target} = ${patch};`);
          writer.line("break;");
        });
        writer.line("}");
        writer.line("step = iter.next();");
      });
      writer.line("}");
    });
    writer.line("}");
  });
  writer.line("}");
}

// ../../packages/jit/src/compiler/update.ts
function compileUpdate(schema, options) {
  assertUpdateable(schema);
  return getCompileCached(
    schema,
    "update",
    () => {
      const program = buildUpdateIR(schema);
      const body = emitUpdateBody(program);
      return globalThis.Function(`return function update(value, patch) {
${body}
};`)();
    },
    options
  );
}
function assertUpdateable(schema) {
  if (schema.type === TypeName.readonly) {
    throw new JITError("READONLY_FIELD", "Cannot compile updates for readonly schemas");
  }
  if (schema.type === TypeName.lazy) {
    assertUpdateable(schema.def.getter());
    return;
  }
  if (hasInnerType2(schema)) {
    assertUpdateable(schema.def.innerType);
    return;
  }
  if (schema.type === TypeName.object) {
    const objectSchema = schema;
    for (const child of Object.values(objectSchema.def.props)) {
      assertUpdateable(child);
    }
  }
}
function hasInnerType2(schema) {
  return schema.type === TypeName.optional || schema.type === TypeName.nullable || schema.type === TypeName.nullish || schema.type === TypeName.default || schema.type === TypeName.brand || schema.type === TypeName.transform || schema.type === TypeName.pipe || schema.type === TypeName.refine || schema.type === TypeName.coerce || schema.type === TypeName.promise;
}

// ../../packages/jit/src/compiler/mapper/build-mapper-ir.ts
var SOURCE = irVar("source");
var LIST = irVar("list");
var LEN = irVar("len");
var OUT = irVar("out");
var INDEX = irVar("i");
function buildMapperIR(fields) {
  const prelude = [];
  const output = objectLiteral(buildEntries(fields, SOURCE, "f", prelude));
  const map2 = {
    kind: "program",
    params: [SOURCE],
    body: [...prelude, { kind: "return", value: output }]
  };
  const many = {
    kind: "program",
    params: [LIST],
    body: [
      { kind: "assign", target: LEN, expr: loadProp(LIST, "length") },
      { kind: "assign", target: OUT, expr: construct("Array", [LEN]) },
      forRange(INDEX, LEN, [
        { kind: "assign", target: SOURCE, expr: loadIndex(LIST, INDEX) },
        ...prelude,
        store(loadIndex(OUT, INDEX), output)
      ]),
      { kind: "return", value: OUT }
    ]
  };
  return { map: map2, many };
}
function buildEntries(fields, base, prefix, prelude) {
  return fields.map((field) => ({
    key: field.key,
    value: buildFieldValue(field, base, `${prefix}_${identifier(field.key)}`, prelude)
  }));
}
function buildFieldValue(field, base, prefix, prelude) {
  const source = field.source;
  switch (source.kind) {
    case "copy":
      return loadProp(base, source.from);
    case "copy-object": {
      if (!source.fromOptional) {
        return objectLiteral(buildEntries(source.fields, loadProp(base, source.from), prefix, prelude));
      }
      const src = irVar(`${prefix}_src`);
      const value = irVar(`${prefix}_val`);
      const inner = [];
      const nested = objectLiteral(buildEntries(source.fields, src, prefix, inner));
      prelude.push({ kind: "assign", target: src, expr: loadProp(base, source.from) }, letDecl(value), {
        kind: "if",
        test: notStrictEqual(src, literal(void 0)),
        then: [...inner, store(value, nested)]
      });
      return value;
    }
    case "copy-array": {
      const src = irVar(`${prefix}_src`);
      const len = irVar(`${prefix}_len`);
      const out = irVar(`${prefix}_out`);
      const index = irVar(`${prefix}_i`);
      const item = irVar(`${prefix}_item`);
      const inner = [];
      const element = source.element === void 0 ? item : objectLiteral(buildEntries(source.element, item, prefix, inner));
      const loop = [
        { kind: "assign", target: len, expr: loadProp(src, "length") },
        { kind: "assign", target: out, expr: construct("Array", [len]) },
        forRange(index, len, [
          { kind: "assign", target: item, expr: loadIndex(src, index) },
          ...inner,
          store(loadIndex(out, index), element)
        ])
      ];
      if (!source.fromOptional) {
        prelude.push({ kind: "assign", target: src, expr: loadProp(base, source.from) }, ...loop);
        return out;
      }
      const value = irVar(`${prefix}_val`);
      prelude.push({ kind: "assign", target: src, expr: loadProp(base, source.from) }, letDecl(value), {
        kind: "if",
        test: notStrictEqual(src, literal(void 0)),
        then: [...loop, store(value, out)]
      });
      return value;
    }
    case "via":
      return { kind: "call", callee: irVar(source.binding), args: [loadProp(SOURCE, source.from), SOURCE] };
    case "computed":
      return { kind: "call", callee: irVar(source.binding), args: [SOURCE] };
    case "default": {
      if (source.from === void 0) return irVar(source.binding);
      const value = irVar(`${prefix}_val`);
      prelude.push(letDecl(value, loadProp(SOURCE, source.from)), {
        kind: "if",
        test: strictEqual(value, literal(void 0)),
        then: [store(value, irVar(source.binding))]
      });
      return value;
    }
  }
}
function identifier(key) {
  return key.replace(/[^$_a-zA-Z0-9]/g, "_").replace(/^[^$_a-zA-Z]/, "_");
}

// ../../packages/jit/src/compiler/mapper/build-mapper-plan.ts
function buildMapperPlan(sourceSchema, targetSchema, overrides = {}) {
  const source = expectObjectSchema2(sourceSchema, "mapper source");
  const target = expectObjectSchema2(targetSchema, "mapper target");
  const bindings = [];
  const bindingNames = [];
  const bind = (value) => {
    const name = `__m${bindings.length}`;
    bindings[bindings.length] = value;
    bindingNames[bindingNames.length] = name;
    return name;
  };
  for (const key of Object.keys(overrides)) {
    if (!(key in target.def.props)) {
      throw new JITError("INVALID_MAPPER", `mapper override references unknown target field ${JSON.stringify(key)}`, {
        path: [key]
      });
    }
  }
  const fields = planObjectFields(source, target, overrides, bind, []);
  return { fields, bindingNames, bindings };
}
function planObjectFields(source, target, overrides, bind, path) {
  const fields = [];
  for (const key of Object.keys(target.def.props)) {
    const targetProp = target.def.props[key];
    const fieldPath = [...path, key];
    const override = overrides[key];
    if (override !== void 0) {
      fields[fields.length] = { key, source: planOverride(source, key, override, bind, fieldPath) };
      continue;
    }
    const planned = planAutoMatch(source, key, targetProp, bind, fieldPath);
    if (planned) fields[fields.length] = { key, source: planned };
  }
  return fields;
}
function planOverride(source, key, override, bind, path) {
  if (typeof override === "function") {
    return { kind: "computed", binding: bind(override) };
  }
  if (typeof override !== "object" || override === null) {
    throw new JITError("INVALID_MAPPER", `mapper override for ${JSON.stringify(key)} must be a function or object`, {
      path
    });
  }
  if (override.via !== void 0) {
    if (typeof override.from !== "string") {
      throw new JITError("INVALID_MAPPER", `mapper override for ${JSON.stringify(key)} with via requires from`, {
        path
      });
    }
    expectSourceField(source, override.from, path);
    return { kind: "via", from: override.from, binding: bind(override.via) };
  }
  if (override.from !== void 0) {
    expectSourceField(source, override.from, path);
    const planned = planAutoMatch(source, override.from, void 0, bind, path);
    if (!planned) {
      throw new JITError(
        "INVALID_MAPPER",
        `mapper cannot copy source field ${JSON.stringify(override.from)}; use via to convert it`,
        { path }
      );
    }
    return planned;
  }
  if ("default" in override) {
    const from = key in source.def.props ? key : void 0;
    return { kind: "default", from, binding: bind(override.default) };
  }
  throw new JITError("INVALID_MAPPER", `mapper override for ${JSON.stringify(key)} must define from, via, or default`, {
    path
  });
}
function planAutoMatch(source, from, targetProp, bind, path) {
  const sourceProp = source.def.props[from];
  if (sourceProp === void 0) {
    if (targetProp !== void 0 && resolveWrappers(targetProp).optional) return void 0;
    throw new JITError(
      "INVALID_MAPPER",
      `mapper target field ${JSON.stringify(path[path.length - 1])} has no source match and no override`,
      { path }
    );
  }
  const sourceResolved = resolveWrappers(sourceProp);
  const targetResolved = targetProp === void 0 ? void 0 : resolveWrappers(targetProp);
  if (targetResolved && sourceResolved.optional && !targetResolved.optional) {
    throw new JITError(
      "INVALID_MAPPER",
      `mapper source field ${JSON.stringify(from)} is optional but the target field is required; use default or via`,
      { path }
    );
  }
  const sourceBase = sourceResolved.base;
  const targetBase = targetResolved?.base;
  if (sourceBase.type === TypeName.object && (targetBase === void 0 || targetBase.type === TypeName.object)) {
    const nestedTarget = targetBase ?? sourceBase;
    const fields = planObjectFields(sourceBase, nestedTarget, {}, bind, path);
    return { kind: "copy-object", from, fromOptional: sourceResolved.optional, fields };
  }
  if (sourceBase.type === TypeName.array && (targetBase === void 0 || targetBase.type === TypeName.array)) {
    const sourceElement = resolveWrappers(sourceBase.def.element).base;
    const targetElement = targetBase === void 0 ? sourceElement : resolveWrappers(targetBase.def.element).base;
    if (sourceElement.type === TypeName.object && targetElement.type === TypeName.object) {
      const element = planObjectFields(sourceElement, targetElement, {}, bind, path);
      return { kind: "copy-array", from, fromOptional: sourceResolved.optional, element };
    }
    if (isCompatibleBase(sourceElement.type, targetElement.type)) {
      return { kind: "copy-array", from, fromOptional: sourceResolved.optional, element: void 0 };
    }
    if (targetResolved?.optional) return void 0;
    throw new JITError("INVALID_MAPPER", `mapper array field ${JSON.stringify(from)} has incompatible element types`, {
      path
    });
  }
  if (targetBase === void 0 || isCompatibleBase(sourceBase.type, targetBase.type)) {
    return { kind: "copy", from, fromOptional: sourceResolved.optional };
  }
  if (targetResolved?.optional) return void 0;
  throw new JITError(
    "INVALID_MAPPER",
    `mapper field ${JSON.stringify(from)} has type ${sourceBase.type} but the target expects ${targetBase.type}`,
    { path }
  );
}
function isCompatibleBase(source, target) {
  if (source === target) return true;
  if (source === TypeName.int && target === TypeName.number) return true;
  return false;
}
function expectSourceField(source, from, path) {
  if (!(from in source.def.props)) {
    throw new JITError("INVALID_MAPPER", `mapper override references unknown source field ${JSON.stringify(from)}`, {
      path
    });
  }
}
function expectObjectSchema2(schema, label) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.object) {
    throw new JITError("INVALID_MAPPER", `${label} must be an object schema`);
  }
  return resolved;
}

// ../../packages/jit/src/compiler/mapper.ts
var MAPPER_OPS = ["map", "many"];
function createMapperFacade(sourceSchema, targetSchema, overrides = {}, options) {
  const plan = buildMapperPlan(sourceSchema, targetSchema, overrides);
  const selections = /* @__PURE__ */ new Map();
  const select = (operations) => {
    const normalized = normalizeMapperOps(operations);
    const key = normalized.join(",");
    const cached = selections.get(key);
    if (cached) return cached;
    const selection = compileMapperPlanSelection(
      sourceSchema,
      targetSchema,
      plan,
      normalized,
      options
    );
    selections.set(key, selection);
    return selection;
  };
  const target = {
    get(...operations) {
      return select(operations);
    }
  };
  for (const operation of MAPPER_OPS) {
    Object.defineProperty(target, operation, {
      configurable: false,
      enumerable: true,
      get() {
        return select([operation])[operation];
      }
    });
  }
  const facade = Object.freeze(target);
  registerMapperArtifact(facade, plan, MAPPER_OPS);
  return facade;
}
function compileMapperPlanSelection(sourceSchema, targetSchema, plan, operations, options) {
  const normalized = normalizeMapperOps(operations);
  const operationKey = normalized.join(",");
  if (normalized.length === 0) {
    const empty = Object.freeze({});
    registerMapperArtifact(empty, plan, normalized, "{}");
    return empty;
  }
  const template = getCompileCached(
    sourceSchema,
    `mapper:${targetKey(targetSchema)}:${operationKey}:${serializeFields(plan.fields)}`,
    () => {
      const source = emitMapper(plan, normalized);
      return {
        source,
        create: globalThis.Function(...plan.bindingNames, `return ${source};`)
      };
    },
    options
  );
  const compiled = Object.freeze(template.create(...plan.bindings));
  registerMapperArtifact(compiled, plan, normalized, template.source);
  const compiledOperations = compiled;
  for (const operation of normalized) {
    const compiledOperation = compiledOperations[operation];
    if (compiledOperation) {
      registerMapperArtifact(compiledOperation, plan, [operation], emitMapperFunction(plan, operation));
    }
  }
  return compiled;
}
function emitMapper(plan, operations) {
  const programs = buildMapperIR(plan.fields);
  const writer = new CodeWriter();
  writer.line("{");
  writer.indent(() => {
    operations.forEach((operation, index) => {
      emitMapperFunctionBody(writer, programs, operation, index < operations.length - 1 ? "," : "");
    });
  });
  writer.line("}");
  return writer.toString();
}
function emitMapperFunction(plan, operation) {
  const programs = buildMapperIR(plan.fields);
  const writer = new CodeWriter();
  emitMapperFunctionBody(writer, programs, operation, "", false);
  return writer.toString();
}
function emitMapperFunctionBody(writer, programs, operation, suffix, property = true) {
  const parameter = operation === "map" ? "source" : "list";
  const prefix = property ? `${operation}: ` : "";
  writer.line(`${prefix}function ${operation}(${parameter}) {`);
  writer.indent(() => {
    for (const node of programs[operation].body) emitNode(writer, node);
  });
  writer.line(`}${suffix}`);
}
function registerMapperArtifact(value, plan, operations, source) {
  registerArtifact(value, {
    kind: "mapper",
    get source() {
      return source ?? emitMapper(plan, operations);
    },
    bindingNames: plan.bindingNames,
    bindingValues: plan.bindings
  });
}
function normalizeMapperOps(operations) {
  for (const operation of operations) {
    if (!MAPPER_OPS.includes(operation)) {
      throw new JITError("INVALID_OPERATION", `unknown mapper operation: ${String(operation)}`);
    }
  }
  return MAPPER_OPS.filter((operation) => operations.includes(operation));
}
var targetKeys = /* @__PURE__ */ new WeakMap();
var targetKeyCounter = 0;
function targetKey(schema) {
  let key = targetKeys.get(schema);
  if (key === void 0) {
    key = ++targetKeyCounter;
    targetKeys.set(schema, key);
  }
  return key;
}
function serializeFields(fields) {
  return fields.map(serializeField).join(";");
}
function serializeField(field) {
  const source = field.source;
  switch (source.kind) {
    case "copy":
      return `${field.key}<c:${source.from}:${source.fromOptional ? "?" : ""}>`;
    case "copy-object":
      return `${field.key}<o:${source.from}:${source.fromOptional ? "?" : ""}[${serializeFields(source.fields)}]>`;
    case "copy-array":
      return `${field.key}<a:${source.from}:${source.fromOptional ? "?" : ""}[${source.element ? serializeFields(source.element) : "*"}]>`;
    case "via":
      return `${field.key}<v:${source.from}:${source.binding}>`;
    case "computed":
      return `${field.key}<x:${source.binding}>`;
    case "default":
      return `${field.key}<d:${source.from ?? ""}:${source.binding}>`;
  }
}

// ../../packages/jit/src/factories/collection/collection.ts
function array(element) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.array, {
      element: unwrapSchema(element)
    })
  );
}
function set(element) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.set, {
      element: unwrapSchema(element)
    })
  );
}
function map(key, value) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.map, {
      key: unwrapSchema(key),
      value: unwrapSchema(value)
    })
  );
}
function record(key, value) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.record, {
      key: unwrapSchema(key),
      value: unwrapSchema(value)
    })
  );
}
function tuple(...items) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.tuple, {
      items: items.map(unwrapSchema),
      rest: void 0
    })
  );
}

// ../../packages/jit/src/compiler/codec.ts
function compileCodec(schema, options) {
  const version = options?.version ?? 1;
  return getCompileCached(
    schema,
    `codec:v${version}`,
    () => {
      const emitted = emitCodec(schema, { version });
      const compiled = globalThis.Function(
        ...emitted.bindingNames,
        emitted.source
      )(...emitted.bindingValues);
      registerArtifact(compiled, {
        kind: "operation",
        schema,
        op: "codec"
      });
      return compiled;
    },
    options
  );
}

// ../../packages/jit/src/compiler/serialize.ts
function emitSerializeSource(schema) {
  return emitSerialize(schema);
}
function compileSerialize(schema, options) {
  return getCompileCached(
    schema,
    "serialize",
    () => {
      const compiled = globalThis.Function(`return ${emitSerialize(schema)};`)();
      registerArtifact(compiled, {
        kind: "operation",
        schema,
        op: "stringify"
      });
      return compiled;
    },
    options
  );
}

// ../../packages/jit/src/factories/compile.ts
var COMPILE_OPS = [
  "is",
  "parse",
  "safeParse",
  "parseAsync",
  "safeParseAsync",
  "equal",
  "clone",
  "diff",
  "hash",
  "update",
  "stringify",
  "fromJSON",
  "format",
  "mask",
  "sanitize",
  "codec"
];
function compile(schema, opsOrCompiled, extras) {
  const unwrapped = unwrapSchema(schema);
  if (!Array.isArray(opsOrCompiled)) {
    return compileObjectSelection(unwrapped, opsOrCompiled);
  }
  const ops = opsOrCompiled;
  const selection = {
    schema: unwrapped,
    ops: Object.freeze([...ops])
  };
  const validatorOps = collectValidatorOps(ops);
  let validator2;
  const getValidator = () => {
    validator2 = validator2 ?? compileValidatorSelection(unwrapped, validatorOps);
    return validator2;
  };
  for (const op of ops) {
    switch (op) {
      case "is":
        selection.is = getValidator().is;
        break;
      case "parse":
        selection.parse = getValidator().parse;
        break;
      case "safeParse":
        selection.safeParse = getValidator().safeParse;
        break;
      case "parseAsync":
        selection.parseAsync = getValidator().parseAsync;
        break;
      case "safeParseAsync":
        selection.safeParseAsync = getValidator().safeParseAsync;
        break;
      case "fromJSON": {
        const parse = getValidator().parse;
        const fromJSON = ((json4) => parse(JSON.parse(json4)));
        registerArtifact(fromJSON, {
          kind: "operation",
          schema: unwrapped,
          op: "fromJSON"
        });
        selection.fromJSON = fromJSON;
        break;
      }
      case "format":
        selection.format = compileFormat(unwrapped);
        break;
      case "equal":
        selection.equal = compileEqual(unwrapped);
        break;
      case "clone":
        selection.clone = compileClone(unwrapped);
        break;
      case "diff":
        selection.diff = compileDiff(unwrapped);
        break;
      case "hash":
        selection.hash = compileHash(unwrapped);
        break;
      case "update":
        selection.update = compileUpdate(unwrapped);
        break;
      case "stringify":
        selection.stringify = compileSerialize(unwrapped);
        break;
      case "mask":
        selection.mask = compileMask(unwrapped);
        break;
      case "sanitize":
        selection.sanitize = compileSanitize(unwrapped);
        break;
      case "codec":
        selection.codec = compileCodec(unwrapped);
        break;
      default:
        throw new JITError("INVALID_OPERATION", `unknown compile op "${String(op)}"`);
    }
  }
  const extraNames = [];
  if (extras) {
    for (const key of Object.keys(extras)) {
      if (key === "schema" || key === "ops" || key === "extras" || key in selection) {
        throw new JITError("INVALID_OPERATION", `extra "${key}" collides with a compiled operation or reserved key`);
      }
      selection[key] = extras[key];
      extraNames.push(key);
    }
  }
  selection.extras = Object.freeze(extraNames);
  return Object.freeze(selection);
}
function compileObjectSelection(schema, compiled) {
  const selection = {
    schema,
    ops: Object.freeze([]),
    extras: Object.freeze([])
  };
  const ops = [];
  const extras = [];
  for (const key of Object.keys(compiled)) {
    if (key === "schema" || key === "ops" || key === "extras") {
      throw new JITError("INVALID_OPERATION", `compiled key "${key}" is reserved`);
    }
    selection[key] = compiled[key];
    if (isCompileOp(key)) ops.push(key);
    else extras.push(key);
  }
  selection.ops = Object.freeze(ops);
  selection.extras = Object.freeze(extras);
  Object.defineProperty(selection, "__jitAot", {
    enumerable: false,
    value: "grouped"
  });
  return Object.freeze(selection);
}
function isCompileOp(value) {
  return COMPILE_OPS.includes(value);
}
function collectValidatorOps(ops) {
  const validatorOps = /* @__PURE__ */ new Set();
  for (const op of ops) {
    if (op === "is" || op === "parse" || op === "safeParse" || op === "parseAsync" || op === "safeParseAsync") {
      validatorOps.add(op);
    }
    if (op === "fromJSON") validatorOps.add("parse");
  }
  return [...validatorOps];
}

// ../../packages/jit/src/factories/composition/composition.ts
function union(...options) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.union, {
      options: options.map(unwrapSchema)
    })
  );
}
function xor(...options) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.xor, {
      options: options.map(unwrapSchema)
    })
  );
}
function not2(schema) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.not, {
      innerType: unwrapSchema(schema)
    })
  );
}
function intersection(...options) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.intersection, {
      options: options.map(unwrapSchema)
    })
  );
}
function discriminatedUnion(discriminator, options) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.discriminatedUnion, {
      discriminator,
      options: options.map(unwrapSchema)
    })
  );
}

// ../../packages/jit/src/factories/dto.ts
var DTO_TRANSPORT_OPS = Object.freeze([
  "is",
  "parse",
  "safeParse",
  "parseAsync",
  "safeParseAsync",
  "fromJSON",
  "stringify",
  "codec"
]);
var DTO_MAPPING_OPS = Object.freeze(["from", "many"]);
var DTO_OPS = Object.freeze([...DTO_TRANSPORT_OPS, ...DTO_MAPPING_OPS]);
function dto(sourceOrTarget, maybeTarget, ...rest) {
  const hasSource = maybeTarget !== void 0;
  const overrides = rest[0] ?? {};
  const sourceSchema = hasSource ? unwrapSchema(sourceOrTarget) : void 0;
  const targetSchema = unwrapSchema(
    hasSource ? maybeTarget : sourceOrTarget
  );
  const availableOps = hasSource ? DTO_OPS : DTO_TRANSPORT_OPS;
  const selections = /* @__PURE__ */ new Map();
  let mapper2;
  const getMapper = () => {
    if (!sourceSchema) throw new JITError("INVALID_OPERATION", "DTO mapping requires a source schema");
    mapper2 ??= createMapperFacade(sourceSchema, targetSchema, overrides);
    return mapper2;
  };
  const select = (ops) => {
    const normalized = normalizeDtoOps(ops, hasSource);
    const key = normalized.join(",");
    const cached = selections.get(key);
    if (cached) return cached;
    const transportOps = normalized.filter(isDtoTransportOp);
    const mappingOps = normalized.filter(isDtoMappingOp);
    const validatorOps = collectValidatorOps2(transportOps);
    const validator2 = validatorOps.length > 0 ? compileValidatorSelection(targetSchema, validatorOps) : void 0;
    const selectedMapper = mappingOps.length > 0 ? getMapper().get(...mappingOps.map((op) => op === "from" ? "map" : "many")) : void 0;
    const selection = {
      schema: targetSchema,
      ops: Object.freeze([...transportOps]),
      extras: Object.freeze([...mappingOps])
    };
    Object.defineProperty(selection, "operations", {
      enumerable: false,
      value: Object.freeze([...normalized])
    });
    for (const op of normalized) {
      switch (op) {
        case "is":
        case "parse":
        case "safeParse":
        case "parseAsync":
        case "safeParseAsync":
          selection[op] = validator2?.[op];
          break;
        case "fromJSON": {
          const parse = validator2?.parse;
          if (!parse) throw new JITError("INVALID_OPERATION", "DTO fromJSON requires parse generation");
          selection.fromJSON = (json4) => parse(JSON.parse(json4));
          break;
        }
        case "stringify":
          selection.stringify = compileSerialize(targetSchema);
          break;
        case "codec":
          selection.codec = compileCodec(targetSchema);
          break;
        case "from":
          selection.from = selectedMapper?.map;
          break;
        case "many":
          selection.many = selectedMapper?.many;
          break;
      }
    }
    Object.defineProperty(selection, "__jitAot", { enumerable: false, value: "grouped" });
    const compiled = Object.freeze(selection);
    selections.set(key, compiled);
    return compiled;
  };
  const target = {
    schema: targetSchema,
    ops: DTO_TRANSPORT_OPS,
    extras: hasSource ? DTO_MAPPING_OPS : Object.freeze([]),
    get(...ops) {
      return select(ops);
    }
  };
  Object.defineProperty(target, "operations", { enumerable: false, value: availableOps });
  Object.defineProperty(target, "__jitAot", { enumerable: false, value: "grouped" });
  for (const op of availableOps) {
    Object.defineProperty(target, op, {
      configurable: false,
      enumerable: true,
      get() {
        return select([op])[op];
      }
    });
  }
  return Object.freeze(target);
}
function normalizeDtoOps(ops, hasSource) {
  for (const op of ops) {
    if (!DTO_OPS.includes(op)) {
      throw new JITError("INVALID_OPERATION", `unknown DTO operation ${JSON.stringify(op)}`);
    }
    if (!hasSource && isDtoMappingOp(op)) {
      throw new JITError("INVALID_OPERATION", `DTO operation ${JSON.stringify(op)} requires a source schema`);
    }
  }
  return DTO_OPS.filter((op) => ops.includes(op) && (hasSource || !isDtoMappingOp(op)));
}
function collectValidatorOps2(ops) {
  const selected = /* @__PURE__ */ new Set();
  for (const op of ops) {
    if (isValidatorOp(op)) selected.add(op);
    else if (op === "fromJSON") selected.add("parse");
  }
  return [...selected];
}
function isValidatorOp(value) {
  return value === "is" || value === "parse" || value === "safeParse" || value === "parseAsync" || value === "safeParseAsync";
}
function isDtoTransportOp(value) {
  return DTO_TRANSPORT_OPS.includes(value);
}
function isDtoMappingOp(value) {
  return value === "from" || value === "many";
}

// ../../packages/jit/src/factories/primitive/empty-def.ts
var emptyDef = {};

// ../../packages/jit/src/factories/primitive/string.ts
function string() {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.string, emptyDef)
  );
}

// ../../packages/jit/src/factories/iso.ts
var iso = {
  date: (message) => string().date(message),
  time: (options, message) => string().time(options, message),
  datetime: (options, message) => string().datetime(options, message),
  duration: (message) => string().duration(message)
};

// ../../packages/jit/src/factories/mapper.ts
function mapper(source, target, ...rest) {
  const [overrides, options] = rest;
  return createMapperFacade(
    unwrapSchema(source),
    unwrapSchema(target),
    overrides ?? {},
    options
  );
}

// ../../packages/jit/src/factories/model.ts
var MODEL_OPS = [
  "is",
  "parse",
  "safeParse",
  "safeParseAsync",
  "parseAsync",
  "equal",
  "clone",
  "diff",
  "hash",
  "update",
  "stringify",
  "fromJSON",
  "format",
  "mask",
  "sanitize",
  "codec"
];
function model(schema, options) {
  const unwrapped = unwrapSchema(schema);
  const selections = /* @__PURE__ */ new Map();
  const select = (ops) => {
    const normalized = normalizeModelOps(ops);
    const key = normalized.join(",");
    const cached = selections.get(key);
    if (cached) return cached;
    const selection = {
      schema: unwrapped,
      ops: Object.freeze([...normalized])
    };
    const validatorOps = collectValidatorOps3(normalized);
    const validator2 = validatorOps.length > 0 ? compileValidatorSelection(unwrapped, validatorOps) : void 0;
    for (const op of normalized) {
      selection[op] = compileModelOperation(op, unwrapped, validator2);
    }
    Object.defineProperty(selection, "__jitAot", {
      enumerable: false,
      value: "grouped"
    });
    const compiled = Object.freeze(selection);
    selections.set(key, compiled);
    return compiled;
  };
  if (options) {
    const selected = [];
    for (const key of Object.keys(options)) {
      if (!isModelOp(key)) throw new JITError("INVALID_OPERATION", `unknown model operation ${JSON.stringify(key)}`);
      if (options[key]) selected.push(key);
    }
    return select(selected);
  }
  const target = {
    schema: unwrapped,
    ops: MODEL_OPS,
    get(...ops) {
      return select(ops);
    }
  };
  for (const op of MODEL_OPS) {
    Object.defineProperty(target, op, {
      configurable: false,
      enumerable: true,
      get() {
        return select([op])[op];
      }
    });
  }
  Object.defineProperty(target, "__jitAot", {
    enumerable: false,
    value: "grouped"
  });
  return Object.freeze(target);
}
function compileModelOperation(op, schema, validator2) {
  switch (op) {
    case "is":
    case "parse":
    case "safeParse":
    case "parseAsync":
    case "safeParseAsync":
      return validator2?.[op];
    case "equal":
      return compileEqual(schema);
    case "clone":
      return compileClone(schema);
    case "diff":
      return compileDiff(schema);
    case "hash":
      return compileHash(schema);
    case "update":
      return compileUpdate(schema);
    case "stringify":
      return compileSerialize(schema);
    case "fromJSON": {
      const parse = validator2?.parse;
      if (!parse) throw new JITError("INVALID_OPERATION", "fromJSON requires the parse compiler");
      return (json4) => parse(JSON.parse(json4));
    }
    case "format":
      return compileFormat(schema);
    case "mask":
      return compileMask(schema);
    case "sanitize":
      return compileSanitize(schema);
    case "codec":
      return compileCodec(schema);
  }
}
function normalizeModelOps(ops) {
  const normalized = [];
  for (const op of ops) {
    if (!isModelOp(op)) throw new JITError("INVALID_OPERATION", `unknown model operation ${JSON.stringify(op)}`);
  }
  for (const op of MODEL_OPS) {
    if (ops.includes(op)) normalized.push(op);
  }
  return normalized;
}
function isModelOp(value) {
  return MODEL_OPS.includes(value);
}
function isValidatorOp2(value) {
  return value === "is" || value === "parse" || value === "safeParse" || value === "parseAsync" || value === "safeParseAsync";
}
function collectValidatorOps3(ops) {
  const selected = /* @__PURE__ */ new Set();
  for (const op of ops) {
    if (isValidatorOp2(op)) selected.add(op);
    else if (op === "fromJSON") selected.add("parse");
  }
  return [...selected];
}

// ../../packages/jit/src/factories/object/object.ts
function object(shape) {
  const props = {};
  for (const key in shape) {
    props[key] = unwrapSchema(shape[key]);
  }
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.object, {
      props,
      unknownKeys: void 0,
      catchall: void 0,
      checks: []
    })
  );
}

// ../../packages/jit/src/factories/primitive/any.ts
function any() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.any, emptyDef));
}

// ../../packages/jit/src/factories/primitive/bigint.ts
function bigint2() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.bigint, emptyDef));
}

// ../../packages/jit/src/factories/primitive/boolean.ts
function boolean2() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.boolean, emptyDef));
}

// ../../packages/jit/src/factories/primitive/date.ts
function date2() {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.date, emptyDef)
  );
}

// ../../packages/jit/src/factories/primitive/file.ts
function file() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.file, emptyDef));
}

// ../../packages/jit/src/factories/primitive/int.ts
function int() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.int, emptyDef));
}

// ../../packages/jit/src/factories/primitive/nan.ts
function nan() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.nan, emptyDef));
}

// ../../packages/jit/src/factories/primitive/never.ts
function never() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.never, emptyDef));
}

// ../../packages/jit/src/factories/primitive/null.ts
function nullType() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.null, emptyDef));
}

// ../../packages/jit/src/factories/primitive/number.ts
function number2() {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.number, emptyDef)
  );
}

// ../../packages/jit/src/factories/primitive/regex.ts
function regex() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.regex, emptyDef));
}

// ../../packages/jit/src/factories/primitive/symbol.ts
function symbol() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.symbol, emptyDef));
}

// ../../packages/jit/src/factories/primitive/undefined.ts
function undefinedType() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.undefined, emptyDef));
}

// ../../packages/jit/src/factories/primitive/unknown.ts
function unknown() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.unknown, emptyDef));
}

// ../../packages/jit/src/factories/primitive/void.ts
function voidType() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.void, emptyDef));
}

// ../../packages/jit/src/compiler/lazy-query.ts
function explainQueryExecution(program, outputMode) {
  const barriers = program.nodes.filter((node) => node.kind === "orderBy").map(() => "orderBy");
  const retainedState = [];
  for (const node of program.nodes) {
    if (node.kind === "unique") retainedState[retainedState.length] = `Set(${node.key})`;
    else if (node.kind === "chunk") retainedState[retainedState.length] = `chunk(${node.size})`;
    else if (node.kind === "window") retainedState[retainedState.length] = `window(${node.size})`;
    else if (node.kind === "pairwise") retainedState[retainedState.length] = "previous-item";
    else if (node.kind === "scan") retainedState[retainedState.length] = "accumulator";
    else if (node.kind === "groupAdjacentBy") retainedState[retainedState.length] = `adjacent-group(${node.key})`;
  }
  return {
    outputMode,
    materializes: barriers.length > 0,
    materializationReason: barriers.length > 0 ? "global ordering requires complete input" : void 0,
    earlyTermination: program.nodes.some((node) => node.kind === "take" || node.kind === "takeWhile"),
    retainedState,
    estimatedAllocationsPerResult: program.nodes.some(
      (node) => node.kind === "select:fields" || node.kind === "chunk" || node.kind === "window" || node.kind === "pairwise"
    ) ? 1 : 0,
    barriers
  };
}
function emitQueryIteratorSource(schema, program) {
  return emitPipelineSource(schema, program, false);
}
function emitQueryAsyncIteratorSource(schema, program) {
  return emitPipelineSource(schema, program, true);
}
function compileQueryIterator(schema, program, options) {
  return compileLazy(schema, program, "generator", options);
}
function compileQueryAsyncIterator(schema, program, options) {
  return compileLazy(
    schema,
    program,
    "async-generator",
    options
  );
}
function compileQueryVisitor(schema, program, options) {
  if (!program.nodes.every(isFusibleNode)) {
    const iterator = compileQueryIterator(schema, program, options);
    const visitor2 = program.params?.length ? (input, params, consume) => {
      let count = 0;
      for (const value of iterator(
        input,
        params
      )) {
        consume(value);
        count++;
      }
      return count;
    } : (input, consume) => {
      let count = 0;
      for (const value of iterator(input)) {
        consume(value);
        count++;
      }
      return count;
    };
    return visitor2;
  }
  const bindingNames = program.bindings.map((_, index) => `__q${index}`);
  const template = getCompileCached(
    schema,
    `query:visitor:${serializePipeline(program.nodes)}`,
    () => {
      const source = emitQueryVisitorSource(schema, program);
      return { source, create: globalThis.Function(...bindingNames, `return ${source};`) };
    },
    options
  );
  const visitor = template.create(...program.bindings);
  registerArtifact(visitor, {
    kind: "query",
    source: template.source,
    bindingNames,
    bindingValues: program.bindings
  });
  return visitor;
}
function emitQueryVisitorSource(schema, program) {
  const collection = resolveCollection(schema);
  validatePipeline(program.nodes, collection.props);
  if (!program.nodes.every(isFusibleNode)) {
    throw new JITError("INVALID_QUERY", "direct visitor supports filter/select/take/drop/*While/unique pipelines");
  }
  const hasParams = Boolean(program.params?.length);
  const lines = ["(function () {", `function visit(input${hasParams ? ", params" : ""}, consume) {`];
  program.nodes.forEach((node, index) => {
    if (node.kind === "take" || node.kind === "drop") lines.push(`  let count${index} = 0;`);
    else if (node.kind === "dropWhile") lines.push(`  let dropping${index} = true;`);
    else if (node.kind === "unique") lines.push(`  const seen${index} = new Set();`);
  });
  lines.push("  let emitted = 0;");
  const body = emitVisitorBody(program.nodes);
  if (collection.kind === "array") {
    lines.push("  if (Array.isArray(input)) {");
    lines.push("    for (let i = 0, len = input.length; i < len; i++) {");
    lines.push("      const item = input[i];");
    for (const line of body) lines.push(`      ${line}`);
    lines.push("    }");
    lines.push("    return emitted;");
    lines.push("  }");
  }
  lines.push(`  for (const ${collection.kind === "map" ? "entry" : "item"} of input) {`);
  if (collection.kind === "map") lines.push("    const item = entry[1];");
  for (const line of body) lines.push(`    ${line}`);
  lines.push("  }");
  lines.push("  return emitted;");
  lines.push("}", "return visit;", "})()");
  return lines.join("\n");
}
function emitVisitorBody(nodes) {
  const body = ["let output = item;"];
  nodes.forEach((node, index) => {
    switch (node.kind) {
      case "filter":
        body.push(`if (!(${emitCondition2(node.condition)})) continue;`);
        break;
      case "select:fields":
        body.push(`output = ${emitProjection(node.fields)};`);
        break;
      case "take":
        body.push(`if (count${index}++ === ${node.count}) return emitted;`);
        break;
      case "drop":
        body.push(`if (count${index}++ < ${node.count}) continue;`);
        break;
      case "takeWhile":
        body.push(`if (!(${emitCondition2(node.condition)})) return emitted;`);
        break;
      case "dropWhile":
        body.push(`if (dropping${index} && (${emitCondition2(node.condition)})) continue;`);
        body.push(`dropping${index} = false;`);
        break;
      case "unique":
        body.push(`const key${index} = item${emitPropertyAccess("", node.key)};`);
        body.push(`if (seen${index}.has(key${index})) continue;`);
        body.push(`seen${index}.add(key${index});`);
        break;
      default:
        break;
    }
  });
  body.push("consume(output);", "emitted++;");
  return body;
}
function compileLazy(schema, program, mode, options) {
  const bindingNames = program.bindings.map((_, index) => `__q${index}`);
  const key = `query:${mode}:${serializePipeline(program.nodes)}`;
  const template = getCompileCached(
    schema,
    key,
    () => {
      const source = mode === "generator" ? emitQueryIteratorSource(schema, program) : emitQueryAsyncIteratorSource(schema, program);
      return { source, create: globalThis.Function(...bindingNames, `return ${source};`) };
    },
    options
  );
  const compiled = template.create(...program.bindings);
  registerArtifact(compiled, {
    kind: "query",
    source: template.source,
    bindingNames,
    bindingValues: program.bindings
  });
  return compiled;
}
function emitPipelineSource(schema, program, async) {
  const collection = resolveCollection(schema);
  validatePipeline(program.nodes, collection.props);
  const hasParams = Boolean(program.params?.length);
  const lines = [];
  const star = async ? "async function*" : "function*";
  const awaitPrefix = async ? "await " : "";
  const forAwait = async ? "for await" : "for";
  if (collection.kind === "map") {
    lines.push(`${star} source(input) {`);
    lines.push(`  ${forAwait} (const entry of input) yield entry[1];`);
    lines.push("}");
  }
  let stage = collection.kind === "map" ? "source(input)" : "input";
  let stageIndex = 0;
  for (let nodeIndex = 0; nodeIndex < program.nodes.length; ) {
    const name = `stage${stageIndex++}`;
    const node = program.nodes[nodeIndex];
    const fused = [];
    while (nodeIndex < program.nodes.length && isFusibleNode(program.nodes[nodeIndex])) {
      fused[fused.length] = program.nodes[nodeIndex++];
    }
    lines.push(`${star} ${name}(input, params) {`);
    if (fused.length > 0) {
      emitFusedStage(lines, fused, forAwait, !async && collection.kind === "array" && stageIndex === 1);
    } else {
      emitStage(lines, node, "input", async, awaitPrefix, forAwait);
      nodeIndex++;
    }
    lines.push("}");
    stage = `${name}(${stage}, ${hasParams ? "params" : "undefined"})`;
  }
  lines.push(`function query(input${hasParams ? ", params" : ""}) {`);
  lines.push(`  return ${stage};`);
  lines.push("}");
  lines.push("return query;");
  return `(function() {
${lines.join("\n")}
})()`;
}
function isFusibleNode(node) {
  return node.kind === "filter" || node.kind === "select:fields" || node.kind === "take" || node.kind === "drop" || node.kind === "takeWhile" || node.kind === "dropWhile" || node.kind === "unique";
}
function emitFusedStage(lines, nodes, forAwait, directArray) {
  nodes.forEach((node, index) => {
    if (node.kind === "take" || node.kind === "drop") lines.push(`  let count${index} = 0;`);
    else if (node.kind === "dropWhile") lines.push(`  let dropping${index} = true;`);
    else if (node.kind === "unique") lines.push(`  const seen${index} = new Set();`);
  });
  const body = ["let output = item;"];
  nodes.forEach((node, index) => {
    switch (node.kind) {
      case "filter":
        body.push(`if (!(${emitCondition2(node.condition)})) continue;`);
        break;
      case "select:fields":
        body.push(`output = ${emitProjection(node.fields)};`);
        break;
      case "take":
        body.push(`if (count${index}++ === ${node.count}) return;`);
        break;
      case "drop":
        body.push(`if (count${index}++ < ${node.count}) continue;`);
        break;
      case "takeWhile":
        body.push(`if (!(${emitCondition2(node.condition)})) return;`);
        break;
      case "dropWhile":
        body.push(`if (dropping${index} && (${emitCondition2(node.condition)})) continue;`);
        body.push(`dropping${index} = false;`);
        break;
      case "unique":
        body.push(`const key${index} = item${emitPropertyAccess("", node.key)};`);
        body.push(`if (seen${index}.has(key${index})) continue;`);
        body.push(`seen${index}.add(key${index});`);
        break;
      default:
        break;
    }
  });
  body.push("yield output;");
  if (directArray) {
    lines.push("  if (Array.isArray(input)) {");
    lines.push("    for (let i = 0, len = input.length; i < len; i++) {");
    lines.push("      const item = input[i];");
    for (const line of body) lines.push(`      ${line}`);
    lines.push("    }");
    lines.push("    return;");
    lines.push("  }");
  }
  lines.push(`  ${forAwait} (const item of input) {`);
  for (const line of body) lines.push(`    ${line}`);
  lines.push("  }");
}
function emitStage(lines, node, previous, async, awaitPrefix, forAwait) {
  const loop = (body) => {
    lines.push(`  ${forAwait} (const item of ${previous}) {`);
    for (const line of body) lines.push(`    ${line}`);
    lines.push("  }");
  };
  switch (node.kind) {
    case "filter":
      loop([`if (${emitCondition2(node.condition)}) yield item;`]);
      return;
    case "select:fields":
      loop([`yield ${emitProjection(node.fields)};`]);
      return;
    case "flatMap":
      loop([
        `const nested = item${emitPropertyAccess("", node.key)};`,
        `${forAwait} (const value of nested) yield value;`
      ]);
      return;
    case "take":
      lines.push("  let count = 0;");
      lines.push(`  ${forAwait} (const item of ${previous}) {`);
      lines.push(`    if (count++ === ${node.count}) return;`);
      lines.push("    yield item;");
      lines.push("  }");
      return;
    case "drop":
      lines.push("  let count = 0;");
      loop([`if (count++ >= ${node.count}) yield item;`]);
      return;
    case "takeWhile":
      loop([`if (!(${emitCondition2(node.condition)})) return;`, "yield item;"]);
      return;
    case "dropWhile":
      lines.push("  let dropping = true;");
      loop([`if (dropping && (${emitCondition2(node.condition)})) continue;`, "dropping = false;", "yield item;"]);
      return;
    case "unique":
      lines.push("  const seen = new Set();");
      loop([
        `const key = item${emitPropertyAccess("", node.key)};`,
        "if (seen.has(key)) continue;",
        "seen.add(key);",
        "yield item;"
      ]);
      return;
    case "chunk":
      lines.push(`  let chunk = new Array(${node.size});`);
      lines.push("  let count = 0;");
      loop([
        "chunk[count++] = item;",
        `if (count === ${node.size}) { yield chunk; chunk = new Array(${node.size}); count = 0; }`
      ]);
      lines.push("  if (count !== 0) { chunk.length = count; yield chunk; }");
      return;
    case "window":
      lines.push(`  const window = new Array(${node.size});`);
      lines.push("  let count = 0;");
      loop([
        `window[count % ${node.size}] = item;`,
        "count++;",
        `if (count >= ${node.size}) {`,
        `  const out = new Array(${node.size});`,
        `  for (let i = 0; i < ${node.size}; i++) out[i] = window[(count + i) % ${node.size}];`,
        "  yield out;",
        "}"
      ]);
      return;
    case "pairwise":
      lines.push("  let previousItem;");
      lines.push("  let hasPrevious = false;");
      loop(["if (hasPrevious) yield [previousItem, item];", "previousItem = item;", "hasPrevious = true;"]);
      return;
    case "scan":
      lines.push(`  let accumulator = ${node.initialBinding};`);
      loop([`accumulator = ${awaitPrefix}${node.updateBinding}(accumulator, item);`, "yield accumulator;"]);
      return;
    case "groupAdjacentBy":
      lines.push("  let group = [];");
      lines.push("  let groupKey;");
      lines.push("  let started = false;");
      loop([
        `const key = item${emitPropertyAccess("", node.key)};`,
        "if (started && key !== groupKey) { yield group; group = []; }",
        "groupKey = key;",
        "started = true;",
        "group[group.length] = item;"
      ]);
      lines.push("  if (started) yield group;");
      return;
    case "orderBy":
      lines.push(`  const values = ${async ? "[]" : `Array.from(${previous})`};`);
      if (async) lines.push(`  ${forAwait} (const item of ${previous}) values[values.length] = item;`);
      lines.push(
        `  values.sort((left, right) => left${emitPropertyAccess("", node.key)} < right${emitPropertyAccess("", node.key)} ? ${node.direction === "asc" ? -1 : 1} : left${emitPropertyAccess("", node.key)} > right${emitPropertyAccess("", node.key)} ? ${node.direction === "asc" ? 1 : -1} : 0);`
      );
      lines.push("  yield* values;");
      return;
    case "keyed":
    case "groupBy":
    case "aggregate":
    case "delete":
    case "update":
      throw new JITError("INVALID_QUERY", `${node.kind} is not an incremental output operation`);
  }
}
function emitCondition2(condition) {
  switch (condition.kind) {
    case "compare": {
      const operators = { eq: "===", neq: "!==", gt: ">", gte: ">=", lt: "<", lte: "<=" };
      return `${emitValue(condition.left)} ${operators[condition.op]} ${emitValue(condition.right)}`;
    }
    case "logical":
      return `(${emitCondition2(condition.left)} ${condition.op === "and" ? "&&" : "||"} ${emitCondition2(condition.right)})`;
    case "not":
      return `!(${emitCondition2(condition.inner)})`;
  }
}
function emitValue(value) {
  switch (value.kind) {
    case "field":
      return `item${emitPropertyAccess("", value.key)}`;
    case "binding":
      return value.name;
    case "param":
      return `params${emitPropertyAccess("", value.name)}`;
    case "literal":
      return emitLiteral(value.value);
  }
}
function emitProjection(fields) {
  return `{ ${fields.map((field) => `${emitLiteral(field)}: item${emitPropertyAccess("", field)}`).join(", ")} }`;
}
function resolveCollection(schema) {
  const collection = resolveWrappers(schema).base;
  if (collection.type !== TypeName.array && collection.type !== TypeName.set && collection.type !== TypeName.map) {
    throw new JITError("INVALID_QUERY", "lazy query expects an array, set, or map schema");
  }
  const element = collection.type === TypeName.map ? resolveWrappers(collection.def.value).base : resolveWrappers(collection.def.element).base;
  if (element.type !== TypeName.object) throw new JITError("INVALID_QUERY", "lazy query expects object elements");
  return { kind: collection.type, props: element.def.props };
}
function validatePipeline(nodes, props) {
  for (const node of nodes) {
    if (node.kind === "select:fields" || node.kind === "flatMap" || node.kind === "unique" || node.kind === "orderBy" || node.kind === "groupAdjacentBy") {
      const keys = node.kind === "select:fields" ? node.fields : [node.key];
      for (const key of keys)
        if (!(key in props)) throw new JITError("INVALID_QUERY", `lazy query received unknown key ${key}`);
    }
  }
}
function serializePipeline(nodes) {
  return JSON.stringify(nodes, (_key, value) => typeof value === "bigint" ? `${value}n` : value);
}

// ../../packages/jit/src/compiler/emitter/emit-query.ts
function emitQuery(program) {
  const writer = new CodeWriter();
  const params = program.params.map((param2) => param2.name).join(", ");
  writer.line(`function query(${params}) {`);
  writer.indent(() => {
    for (const node of program.body) emitNode(writer, node);
  });
  writer.line("}");
  return writer.toString();
}

// ../../packages/jit/src/compiler/ir/builders/build-query-ir.ts
var VALUE = irVar("value");
var PARAMS = irVar("params");
var LEN2 = irVar("len");
var OUT2 = irVar("out");
var CURSOR = irVar("j");
var INDEX2 = irVar("i");
var ITEM = irVar("item");
var ENTRY = irVar("entry");
var SEEN = irVar("seen");
var UNIQUE_KEY = irVar("uniqueKey");
var COLLECT_KEY = irVar("collectKey");
var GROUP = irVar("group");
var PROJECTED = irVar("projected");
var COMPARE_OPERATORS = {
  eq: "strictEqual",
  neq: "notStrictEqual",
  gt: "greaterThan",
  gte: "greaterThanOrEqual",
  lt: "lessThan",
  lte: "lessThanOrEqual"
};
function buildQueryIR(target, plan, options = {}) {
  const body = plan.mutation ? buildMutationQuery(target, plan) : plan.aggregate ? buildAggregateQuery(target, plan, plan.aggregate) : plan.collector ? buildCollectedQuery(target, plan) : buildArrayQuery(target, plan);
  return { kind: "program", params: options.hasParams ? [VALUE, PARAMS] : [VALUE], body };
}
function buildArrayQuery(target, plan) {
  if (shouldProjectAfterOrder(plan)) return buildArrayQueryWithPostOrderProjection(target, plan);
  const selected = buildProjection(plan.select);
  const body = [
    ...buildLoopHeader(target, plan, construct("Array", [LEN2])),
    letDecl(CURSOR, literal(0)),
    buildInputLoop(target, buildGuardedBody(plan, [append(OUT2, CURSOR, selected)])),
    store(loadProp(OUT2, "length"), CURSOR)
  ];
  if (plan.orderBy) body.push(sortByKey(OUT2, plan.orderBy.key, plan.orderBy.direction));
  body.push({ kind: "return", value: OUT2 });
  return body;
}
function buildArrayQueryWithPostOrderProjection(target, plan) {
  const orderBy = plan.orderBy;
  const body = [
    ...buildLoopHeader(target, plan, construct("Array", [LEN2])),
    letDecl(CURSOR, literal(0)),
    buildInputLoop(target, buildGuardedBody(plan, [append(OUT2, CURSOR, ITEM)])),
    store(loadProp(OUT2, "length"), CURSOR)
  ];
  if (orderBy) body.push(sortByKey(OUT2, orderBy.key, orderBy.direction));
  body.push(
    { kind: "assign", target: PROJECTED, expr: construct("Array", [CURSOR]) },
    forRange(INDEX2, CURSOR, [
      { kind: "assign", target: ITEM, expr: loadIndex(OUT2, INDEX2) },
      store(loadIndex(PROJECTED, INDEX2), buildProjection(plan.select))
    ]),
    { kind: "return", value: PROJECTED }
  );
  return body;
}
function buildCollectedQuery(target, plan) {
  const collector = plan.collector;
  if (!collector) return [];
  const selected = buildProjection(plan.select);
  const collect = [{ kind: "assign", target: COLLECT_KEY, expr: loadProp(ITEM, collector.key) }];
  if (collector.kind === "keyed") {
    collect.push(exprStmt(call(loadProp(OUT2, "set"), [COLLECT_KEY, selected])));
  } else {
    collect.push(
      letDecl(GROUP, loadIndex(OUT2, COLLECT_KEY)),
      {
        kind: "if",
        test: strictEqual(GROUP, literal(void 0)),
        then: [store(GROUP, arrayLiteral()), store(loadIndex(OUT2, COLLECT_KEY), GROUP)]
      },
      store(loadIndex(GROUP, loadProp(GROUP, "length")), selected)
    );
  }
  const outInitializer = collector.kind === "keyed" ? construct("Map") : call(loadProp(irVar("Object"), "create"), [literal(null)]);
  return [
    ...buildLoopHeader(target, plan, outInitializer),
    buildInputLoop(target, buildGuardedBody(plan, collect)),
    { kind: "return", value: OUT2 }
  ];
}
var ACC = irVar("acc");
var ACC_COUNT = irVar("n");
function buildAggregateQuery(target, plan, aggregate) {
  const body = [];
  if (target.kind === "array") {
    body.push({ kind: "assign", target: LEN2, expr: loadProp(VALUE, "length") });
  }
  if (plan.unique) body.push({ kind: "assign", target: SEEN, expr: construct("Set") });
  const field = aggregate.key === void 0 ? ITEM : loadProp(ITEM, aggregate.key);
  switch (aggregate.op) {
    case "sum":
    case "count": {
      const increment = aggregate.op === "count" ? literal(1) : field;
      body.push(
        letDecl(ACC, literal(0)),
        buildInputLoop(target, buildGuardedBody(plan, [store(ACC, binary("add", ACC, increment))])),
        { kind: "return", value: ACC }
      );
      return body;
    }
    case "avg":
      body.push(
        letDecl(ACC, literal(0)),
        letDecl(ACC_COUNT, literal(0)),
        buildInputLoop(
          target,
          buildGuardedBody(plan, [
            store(ACC, binary("add", ACC, field)),
            store(ACC_COUNT, binary("add", ACC_COUNT, literal(1)))
          ])
        ),
        {
          kind: "if",
          test: strictEqual(ACC_COUNT, literal(0)),
          then: [{ kind: "return", value: literal(void 0) }]
        },
        { kind: "return", value: binary("divide", ACC, ACC_COUNT) }
      );
      return body;
    case "min":
    case "max": {
      const wins = binary(aggregate.op === "min" ? "lessThan" : "greaterThan", field, ACC);
      body.push(
        letDecl(ACC),
        buildInputLoop(
          target,
          buildGuardedBody(plan, [
            {
              kind: "if",
              test: { kind: "nary", op: "or", operands: [strictEqual(ACC, literal(void 0)), wins] },
              then: [store(ACC, field)]
            }
          ])
        ),
        { kind: "return", value: ACC }
      );
      return body;
    }
  }
}
function buildMutationQuery(target, plan) {
  const mutation = plan.mutation;
  if (!mutation) return [];
  const condition = buildFilterTest(plan);
  const test = condition ?? literal(false);
  const loopBody = mutation.kind === "delete" ? [{ kind: "if", test: not(test), then: buildMutationKeep(target, ITEM) }] : [
    {
      kind: "if",
      test,
      then: buildMutationKeep(target, buildPatchObject(target.objectSchema, mutation)),
      otherwise: buildMutationKeep(target, ITEM)
    }
  ];
  const outInitializer = target.kind === "array" ? construct("Array", [LEN2]) : target.kind === "set" ? construct("Set") : construct("Map");
  const body = [...buildLoopHeader(target, plan, outInitializer)];
  if (target.kind === "array") body.push(letDecl(CURSOR, literal(0)));
  body.push(buildInputLoop(target, loopBody));
  if (target.kind === "array") body.push(store(loadProp(OUT2, "length"), CURSOR));
  body.push({ kind: "return", value: OUT2 });
  return body;
}
function buildMutationKeep(target, value) {
  switch (target.kind) {
    case "array":
      return [append(OUT2, CURSOR, value)];
    case "set":
      return [exprStmt(call(loadProp(OUT2, "add"), [value]))];
    case "map":
      return [exprStmt(call(loadProp(OUT2, "set"), [loadIndex(ENTRY, literal(0)), value]))];
  }
}
function buildPatchObject(schema, mutation) {
  if (mutation.kind !== "update") return ITEM;
  const entries = Object.keys(schema.def.props).map((key) => {
    const binding = mutation.patch[key];
    return { key, value: binding ? irVar(binding.name) : loadProp(ITEM, key) };
  });
  return objectLiteral(entries);
}
function buildLoopHeader(target, plan, outInitializer) {
  const header = [
    { kind: "assign", target: LEN2, expr: loadProp(VALUE, target.kind === "array" ? "length" : "size") }
  ];
  if (plan.unique) header.push({ kind: "assign", target: SEEN, expr: construct("Set") });
  header.push({ kind: "assign", target: OUT2, expr: outInitializer });
  return header;
}
function buildInputLoop(target, body) {
  switch (target.kind) {
    case "array":
      return forRange(INDEX2, LEN2, [{ kind: "assign", target: ITEM, expr: loadIndex(VALUE, INDEX2) }, ...body]);
    case "set":
      return forOf(ITEM, VALUE, body);
    case "map":
      return forOf(ENTRY, VALUE, [{ kind: "assign", target: ITEM, expr: loadIndex(ENTRY, literal(1)) }, ...body]);
  }
}
function buildGuardedBody(plan, accepted) {
  const unique = plan.unique;
  const inner = unique ? [
    { kind: "assign", target: UNIQUE_KEY, expr: loadProp(ITEM, unique.key) },
    {
      kind: "if",
      test: not(call(loadProp(SEEN, "has"), [UNIQUE_KEY])),
      then: [exprStmt(call(loadProp(SEEN, "add"), [UNIQUE_KEY])), ...accepted]
    }
  ] : accepted;
  const condition = buildFilterTest(plan);
  return condition ? [{ kind: "if", test: condition, then: inner }] : inner;
}
function buildFilterTest(plan) {
  if (plan.filters.length === 0) return void 0;
  return allOf(plan.filters.map((filter) => buildCondition(filter.condition)));
}
function buildCondition(condition) {
  switch (condition.kind) {
    case "compare":
      return binary(COMPARE_OPERATORS[condition.op], buildValue(condition.left), buildValue(condition.right));
    case "logical":
      return {
        kind: "nary",
        op: condition.op,
        operands: [buildCondition(condition.left), buildCondition(condition.right)]
      };
    case "not":
      return not(buildCondition(condition.inner));
  }
}
function buildValue(value) {
  switch (value.kind) {
    case "field":
      return loadProp(ITEM, value.key);
    case "binding":
      return irVar(value.name);
    case "param":
      return loadProp(PARAMS, value.name);
    case "literal":
      return literal(expectSafeLiteral(value.value));
  }
}
function expectSafeLiteral(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean" || value === null || value === void 0) {
    return value;
  }
  throw new JITError("INVALID_QUERY", "query literal values must be primitive compiler literals");
}
function buildProjection(select) {
  if (!select) return ITEM;
  return objectLiteral(select.fields.map((field) => ({ key: field, value: loadProp(ITEM, field) })));
}
function shouldProjectAfterOrder(plan) {
  return Boolean(plan.select && plan.orderBy && !plan.select.fields.includes(plan.orderBy.key));
}

// ../../packages/jit/src/compiler/query.ts
function emitQuerySource(schema, program) {
  const target = expectCollectionObjectSchema(schema, "emitQuerySource");
  const plan = optimizeQueryPlan(createQueryPlan(program.nodes));
  validateQueryPlan(target.objectSchema, plan);
  return emitQuery(
    optimizeQueryIR(
      buildQueryIR(target, plan, {
        hasParams: Boolean(program.params?.length)
      })
    )
  );
}
function compileQuery(schema, program, options) {
  const bindingNames = program.bindings.map((_, index) => `__q${index}`);
  const template = getCompileCached(
    schema,
    `query:${serializeQueryNodes2(program.nodes)}`,
    () => {
      const source = emitQuerySource(schema, program);
      return {
        source,
        create: globalThis.Function(...bindingNames, `return ${source};`)
      };
    },
    options
  );
  const compiled = template.create(...program.bindings);
  registerArtifact(compiled, {
    kind: "query",
    source: template.source,
    bindingNames,
    bindingValues: program.bindings
  });
  return compiled;
}
function serializeQueryNodes2(nodes) {
  return nodes.map(serializeQueryNode2).join(";");
}
function serializeQueryNode2(node) {
  switch (node.kind) {
    case "filter":
      return `f(${serializeCondition2(node.condition)})`;
    case "select:fields":
      return `s(${node.fields.join(",")})`;
    case "unique":
      return `u(${node.key})`;
    case "keyed":
      return `k(${node.key})`;
    case "groupBy":
      return `g(${node.key})`;
    case "orderBy":
      return `o(${node.key},${node.direction})`;
    case "aggregate":
      return `a(${node.op},${node.key ?? ""})`;
    case "delete":
      return "d()";
    case "update":
      return `m(${Object.keys(node.patch).map((key) => `${key}=${node.patch[key]?.name}`).join(",")})`;
  }
}
function serializeCondition2(condition) {
  switch (condition.kind) {
    case "compare":
      return `${condition.op}(${serializeValue2(condition.left)},${serializeValue2(condition.right)})`;
    case "logical":
      return `${condition.op}(${serializeCondition2(condition.left)},${serializeCondition2(condition.right)})`;
    case "not":
      return `not(${serializeCondition2(condition.inner)})`;
  }
}
function serializeValue2(value) {
  switch (value.kind) {
    case "field":
      return `.${value.key}`;
    case "binding":
      return `$${value.name}`;
    case "param":
      return `p:${value.name}`;
    case "literal":
      return `#${typeof value.value}:${String(value.value)}`;
  }
}
function createQueryPlan(nodes) {
  const filters = [];
  const selects = [];
  const uniques = [];
  const collectors = [];
  const orderBys = [];
  const aggregates = [];
  const mutations = [];
  for (const node of nodes) {
    switch (node.kind) {
      case "filter":
        filters[filters.length] = node;
        break;
      case "select:fields":
        selects[selects.length] = node;
        break;
      case "unique":
        uniques[uniques.length] = node;
        break;
      case "keyed":
      case "groupBy":
        collectors[collectors.length] = node;
        break;
      case "orderBy":
        orderBys[orderBys.length] = node;
        break;
      case "aggregate":
        aggregates[aggregates.length] = node;
        break;
      case "delete":
      case "update":
        mutations[mutations.length] = node;
        break;
    }
  }
  return {
    filters,
    selects,
    uniques,
    collectors,
    orderBys,
    aggregates,
    mutations
  };
}
function optimizeQueryPlan(plan) {
  return {
    filters: plan.filters,
    select: last(plan.selects),
    unique: last(plan.uniques),
    collector: last(plan.collectors),
    orderBy: last(plan.orderBys),
    aggregate: last(plan.aggregates),
    mutation: last(plan.mutations)
  };
}
function validateQueryPlan(schema, plan) {
  for (const filter of plan.filters) {
    validateCondition2(schema, filter.condition);
  }
  if (plan.select) validateObjectKeys2(schema, plan.select.fields, "query select");
  if (plan.unique) validateObjectKeys2(schema, [plan.unique.key], "query unique");
  if (plan.collector) validateObjectKeys2(schema, [plan.collector.key], `query ${plan.collector.kind}`);
  if (plan.orderBy) validateObjectKeys2(schema, [plan.orderBy.key], "query orderBy");
  if (plan.collector && plan.orderBy) {
    throw new JITError("INVALID_QUERY", "query orderBy cannot be combined with keyed/groupBy in v1");
  }
  if (plan.aggregate) {
    if (plan.select || plan.collector || plan.orderBy || plan.mutation) {
      throw new JITError(
        "INVALID_QUERY",
        "query aggregate cannot be combined with select/keyed/groupBy/orderBy/delete/update in v1"
      );
    }
    if (plan.aggregate.op !== "count") {
      if (plan.aggregate.key === void 0) {
        throw new JITError("INVALID_QUERY", `query ${plan.aggregate.op} requires a field key`);
      }
      validateObjectKeys2(schema, [plan.aggregate.key], `query ${plan.aggregate.op}`);
    }
  }
  if (plan.mutation) {
    if (plan.filters.length === 0) {
      throw new JITError("INVALID_QUERY", "query delete/update requires at least one filter in v1");
    }
    if (plan.select || plan.collector || plan.orderBy) {
      throw new JITError(
        "INVALID_QUERY",
        "query delete/update cannot be combined with select/keyed/groupBy/orderBy in v1"
      );
    }
    if (plan.mutation.kind === "update") {
      validateObjectKeys2(schema, Object.keys(plan.mutation.patch), "query update");
    }
  }
}
function expectCollectionObjectSchema(schema, compilerName) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.array && resolved.type !== TypeName.set && resolved.type !== TypeName.map) {
    throw new JITError("INVALID_QUERY", `${compilerName} expects an array, set, or map schema`);
  }
  const element = resolved.type === TypeName.map ? resolveWrappers(resolved.def.value).base : resolveWrappers(resolved.def.element).base;
  if (element.type !== TypeName.object) {
    throw new JITError("INVALID_QUERY", `${compilerName} expects a collection of object schema`);
  }
  return {
    kind: resolved.type,
    objectSchema: element
  };
}
function validateObjectKeys2(schema, keys, compilerName) {
  const props = schema.def.props;
  for (const key of keys) {
    if (!(key in props)) {
      throw new JITError("INVALID_QUERY", `${compilerName} received unknown key ${JSON.stringify(key)}`, {
        path: [key]
      });
    }
  }
}
function validateCondition2(schema, condition) {
  switch (condition.kind) {
    case "compare":
      validateValue2(schema, condition.left);
      validateValue2(schema, condition.right);
      return;
    case "logical":
      validateCondition2(schema, condition.left);
      validateCondition2(schema, condition.right);
      return;
    case "not":
      validateCondition2(schema, condition.inner);
      return;
  }
}
function validateValue2(schema, value) {
  if (value.kind === "field") {
    validateObjectKeys2(schema, [value.key], "query");
  }
}
function last(values) {
  return values[values.length - 1];
}

// ../../packages/jit/src/factories/query.ts
function param(name) {
  return { __jitQueryValue: "param", name, _type: null };
}
function constant(value) {
  return { __jitQueryValue: "const", value };
}
function query(schema) {
  if (isBinaryArray(schema) || isBinaryRowSet(schema)) {
    return createBinaryQueryBuilder(schema, [], [], []);
  }
  return createQueryBuilder(unwrapSchema(schema), [], [], []);
}
function createBinaryQueryBuilder(target, nodes, bindings, paramNames) {
  return {
    params(shape) {
      return createBinaryQueryBuilder(
        target,
        nodes,
        bindings,
        Object.keys(shape)
      );
    },
    filter(predicate) {
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(state.builder, createParamRefs(paramNames));
      return createBinaryQueryBuilder(
        target,
        [...nodes, { kind: "filter", condition }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },
    select(...fields) {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "select:fields", fields }], bindings, paramNames);
    },
    sum(key) {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "aggregate", op: "sum", key }], bindings, paramNames);
    },
    count() {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "aggregate", op: "count" }], bindings, paramNames);
    },
    avg(key) {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "aggregate", op: "avg", key }], bindings, paramNames);
    },
    min(key) {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "aggregate", op: "min", key }], bindings, paramNames);
    },
    max(key) {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "aggregate", op: "max", key }], bindings, paramNames);
    },
    compile() {
      return compileBinaryQuery(target, {
        nodes,
        bindings,
        params: paramNames
      });
    }
  };
}
function createQueryBuilder(schema, nodes, bindings, paramNames) {
  return {
    params(shape) {
      return createQueryBuilder(
        schema,
        nodes,
        bindings,
        Object.keys(shape)
      );
    },
    filter(predicate) {
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(
        state.builder,
        createParamRefs(paramNames)
      );
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "filter", condition }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },
    select(...fields) {
      return createQueryBuilder(schema, [...nodes, { kind: "select:fields", fields }], bindings, paramNames);
    },
    unique(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "unique", key }], bindings, paramNames);
    },
    keyed(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "keyed", key }], bindings, paramNames);
    },
    groupBy(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "groupBy", key }], bindings, paramNames);
    },
    orderBy(key, direction = "asc") {
      return createQueryBuilder(schema, [...nodes, { kind: "orderBy", key, direction }], bindings, paramNames);
    },
    flatMap(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "flatMap", key }], bindings, paramNames);
    },
    take(count) {
      assertPositiveInteger(count, "query take");
      return createQueryBuilder(schema, [...nodes, { kind: "take", count }], bindings, paramNames);
    },
    drop(count) {
      assertNonNegativeInteger(count, "query drop");
      return createQueryBuilder(schema, [...nodes, { kind: "drop", count }], bindings, paramNames);
    },
    takeWhile(predicate) {
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(
        state.builder,
        createParamRefs(paramNames)
      );
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "takeWhile", condition }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },
    dropWhile(predicate) {
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(
        state.builder,
        createParamRefs(paramNames)
      );
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "dropWhile", condition }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },
    chunk(size) {
      assertPositiveInteger(size, "query chunk");
      return createQueryBuilder(schema, [...nodes, { kind: "chunk", size }], bindings, paramNames);
    },
    window(size) {
      assertPositiveInteger(size, "query window");
      return createQueryBuilder(schema, [...nodes, { kind: "window", size }], bindings, paramNames);
    },
    pairwise() {
      return createQueryBuilder(schema, [...nodes, { kind: "pairwise" }], bindings, paramNames);
    },
    scan(options) {
      const initialBinding = `__q${bindings.length}`;
      const updateBinding = `__q${bindings.length + 1}`;
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "scan", initialBinding, updateBinding }],
        [...bindings, options.initial, options.update],
        paramNames
      );
    },
    groupAdjacentBy(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "groupAdjacentBy", key }], bindings, paramNames);
    },
    delete() {
      return createQueryBuilder(schema, [...nodes, { kind: "delete" }], bindings, paramNames);
    },
    update(patch) {
      const state = createPatchBindings(bindings.length, patch);
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "update", patch: state.patch }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },
    sum(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "sum", key }], bindings, paramNames);
    },
    count() {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "count" }], bindings, paramNames);
    },
    avg(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "avg", key }], bindings, paramNames);
    },
    min(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "min", key }], bindings, paramNames);
    },
    max(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "max", key }], bindings, paramNames);
    },
    compile() {
      if (!hasIncrementalNodes(nodes)) {
        return compileQuery(schema, {
          nodes,
          bindings,
          params: paramNames
        });
      }
      const iterator = compileQueryIterator(schema, {
        nodes,
        bindings,
        params: paramNames
      });
      return ((value, params) => Array.from(
        paramNames.length > 0 ? iterator(
          value,
          params
        ) : iterator(value)
      ));
    },
    compileIterator() {
      return compileQueryIterator(schema, {
        nodes,
        bindings,
        params: paramNames
      });
    },
    compileAsyncIterator() {
      return compileQueryAsyncIterator(schema, {
        nodes,
        bindings,
        params: paramNames
      });
    },
    compileVisitor() {
      return compileQueryVisitor(schema, {
        nodes,
        bindings,
        params: paramNames
      });
    },
    lazy() {
      return createLazyQueryBuilder(schema, nodes, bindings, paramNames);
    },
    explain(outputMode = "eager-array") {
      return explainQueryExecution({ nodes, bindings, params: paramNames }, outputMode);
    }
  };
}
function createLazyQueryBuilder(schema, nodes, bindings, paramNames) {
  const program = { nodes, bindings, params: paramNames };
  return {
    compile: () => compileQueryIterator(schema, program),
    compileIterator: () => compileQueryIterator(schema, program),
    compileAsyncIterator: () => compileQueryAsyncIterator(schema, program),
    compileVisitor: () => compileQueryVisitor(schema, program),
    explain: (outputMode = "generator") => explainQueryExecution(program, outputMode)
  };
}
function hasIncrementalNodes(nodes) {
  return nodes.some(
    (node) => [
      "flatMap",
      "take",
      "drop",
      "takeWhile",
      "dropWhile",
      "chunk",
      "window",
      "pairwise",
      "scan",
      "groupAdjacentBy"
    ].includes(node.kind)
  );
}
function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0)
    throw new JITError("INVALID_QUERY", `${label} expects a positive integer`);
}
function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new JITError("INVALID_QUERY", `${label} expects a non-negative integer`);
  }
}
function createPatchBindings(startIndex, patch) {
  const bindings = [];
  const boundPatch = {};
  for (const key of Object.keys(patch)) {
    const index = startIndex + bindings.length;
    bindings[bindings.length] = patch[key];
    boundPatch[key] = { kind: "binding", name: `__q${index}` };
  }
  return { patch: boundPatch, bindings };
}
function createConditionBuilder(startIndex) {
  const bindings = [];
  const toValueNode = (value) => {
    if (isQueryParamRef(value)) return { kind: "param", name: value.name };
    if (isQueryConstRef(value)) return { kind: "literal", value: value.value };
    const index = startIndex + bindings.length;
    bindings[bindings.length] = value;
    return { kind: "binding", name: `__q${index}` };
  };
  const compare = (op, key, value) => ({
    kind: "compare",
    op,
    left: { kind: "field", key },
    right: toValueNode(value)
  });
  return {
    bindings,
    builder: {
      constant,
      eq: (key, value) => compare("eq", key, value),
      neq: (key, value) => compare("neq", key, value),
      gt: (key, value) => compare("gt", key, value),
      gte: (key, value) => compare("gte", key, value),
      lt: (key, value) => compare("lt", key, value),
      lte: (key, value) => compare("lte", key, value),
      and: (left, right) => ({ kind: "logical", op: "and", left, right }),
      or: (left, right) => ({ kind: "logical", op: "or", left, right }),
      not: (inner) => ({ kind: "not", inner })
    }
  };
}
function createParamRefs(names) {
  const refs = {};
  for (const name of names) refs[name] = param(name);
  return refs;
}
function isQueryParamRef(value) {
  return value !== null && typeof value === "object" && value.__jitQueryValue === "param";
}
function isQueryConstRef(value) {
  return value !== null && typeof value === "object" && value.__jitQueryValue === "const";
}

// ../../packages/jit/src/factories/process.ts
function process(schema) {
  const objectSchema = unwrapSchema(schema);
  if (objectSchema.type !== TypeName.object) {
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.process expects an object schema");
  }
  return {
    binary(options) {
      return createBinaryProcessBuilder(objectSchema, options ?? {}, [], [], []);
    }
  };
}
function createBinaryProcessBuilder(objectSchema, options, nodes, bindings, paramNames) {
  return {
    params(shape) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        nodes,
        bindings,
        Object.keys(shape)
      );
    },
    filter(predicate) {
      const state = createConditionBuilder2(bindings.length);
      const condition = predicate(state.builder, createParamRefs2(paramNames));
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "filter", condition }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },
    select(...fields) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "select:fields", fields }],
        bindings,
        paramNames
      );
    },
    sum(key) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "aggregate", op: "sum", key }],
        bindings,
        paramNames
      );
    },
    count() {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "aggregate", op: "count" }],
        bindings,
        paramNames
      );
    },
    avg(key) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "aggregate", op: "avg", key }],
        bindings,
        paramNames
      );
    },
    min(key) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "aggregate", op: "min", key }],
        bindings,
        paramNames
      );
    },
    max(key) {
      return createBinaryProcessBuilder(
        objectSchema,
        options,
        [...nodes, { kind: "aggregate", op: "max", key }],
        bindings,
        paramNames
      );
    },
    compile() {
      const processSchema = createProcessObjectSchema(objectSchema, nodes);
      const arraySchema = createSchema(TypeName.array, {
        element: processSchema
      });
      const binary2 = compileBinaryArray(arraySchema, options, {
        adaptiveStringFields: collectProjectionOnlyFields(processSchema, nodes)
      });
      const query2 = compileBinaryQuery(binary2, {
        nodes,
        bindings,
        params: paramNames
      });
      const execute = ((values, second, third) => {
        const hasParams = paramNames.length > 0;
        const params = hasParams ? second : void 0;
        const length = hasParams ? third : second;
        const rowset = binary2.load(values, length);
        if (hasParams)
          return query2(rowset, params);
        return query2(rowset);
      });
      return Object.freeze({ binary: binary2, query: query2, execute });
    }
  };
}
function collectProjectionOnlyFields(schema, nodes) {
  const filtered = /* @__PURE__ */ new Set();
  let selected;
  let aggregate = false;
  for (const node of nodes) {
    if (node.kind === "filter") collectConditionKeys(node.condition, filtered);
    else if (node.kind === "select:fields") selected = node.fields;
    else if (node.kind === "aggregate") aggregate = true;
  }
  if (aggregate) return /* @__PURE__ */ new Set();
  const projected = new Set(
    selected ?? (schema.type === TypeName.object ? Object.keys(schema.def.props) : [])
  );
  for (const key of filtered) projected.delete(key);
  return projected;
}
function createProcessObjectSchema(schema, nodes) {
  if (schema.type !== TypeName.object) return schema;
  const props = schema.def.props;
  const keys = collectProcessKeys(nodes, Object.keys(props));
  if (keys === void 0) return schema;
  const picked = {};
  for (const key of keys) picked[key] = props[key];
  return createSchema(TypeName.object, {
    ...schema.def,
    props: picked
  });
}
function collectProcessKeys(nodes, allKeys) {
  const keys = /* @__PURE__ */ new Set();
  let hasProjection = false;
  let hasAggregate = false;
  for (const node of nodes) {
    switch (node.kind) {
      case "filter":
        collectConditionKeys(node.condition, keys);
        break;
      case "select:fields":
        hasProjection = true;
        for (const key of node.fields) keys.add(key);
        break;
      case "aggregate":
        hasAggregate = true;
        if (node.key) keys.add(node.key);
        break;
      default:
        return void 0;
    }
  }
  if (!hasProjection && !hasAggregate) return void 0;
  return allKeys.filter((key) => keys.has(key));
}
function collectConditionKeys(condition, keys) {
  switch (condition.kind) {
    case "compare":
      collectValueKey(condition.left, keys);
      collectValueKey(condition.right, keys);
      return;
    case "logical":
      collectConditionKeys(condition.left, keys);
      collectConditionKeys(condition.right, keys);
      return;
    case "not":
      collectConditionKeys(condition.inner, keys);
      return;
  }
}
function collectValueKey(value, keys) {
  if (value.kind === "field") keys.add(value.key);
}
function createConditionBuilder2(startIndex) {
  const bindings = [];
  const toValueNode = (value) => {
    if (isQueryParamRef2(value)) return { kind: "param", name: value.name };
    if (isQueryConstRef2(value)) return { kind: "literal", value: value.value };
    const index = startIndex + bindings.length;
    bindings[bindings.length] = value;
    return { kind: "binding", name: `__q${index}` };
  };
  const compare = (op, key, value) => ({
    kind: "compare",
    op,
    left: { kind: "field", key },
    right: toValueNode(value)
  });
  return {
    bindings,
    builder: {
      constant,
      eq: (key, value) => compare("eq", key, value),
      neq: (key, value) => compare("neq", key, value),
      gt: (key, value) => compare("gt", key, value),
      gte: (key, value) => compare("gte", key, value),
      lt: (key, value) => compare("lt", key, value),
      lte: (key, value) => compare("lte", key, value),
      and: (left, right) => ({ kind: "logical", op: "and", left, right }),
      or: (left, right) => ({ kind: "logical", op: "or", left, right }),
      not: (inner) => ({ kind: "not", inner })
    }
  };
}
function createParamRefs2(names) {
  const refs = {};
  for (const name of names) refs[name] = param(name);
  return refs;
}
function isQueryParamRef2(value) {
  return value !== null && typeof value === "object" && value.__jitQueryValue === "param";
}
function isQueryConstRef2(value) {
  return value !== null && typeof value === "object" && value.__jitQueryValue === "const";
}

// ../../packages/jit/src/compiler/json-chunks.ts
function emitStringifyChunksSource(schema, options = {}) {
  const array2 = resolveWrappers(schema).base;
  if (array2.type !== TypeName.array) {
    throw new JITError("UNSUPPORTED_SCHEMA", "json.stringifyChunks currently expects an array schema");
  }
  const chunkBytes = options.chunkBytes ?? 16 * 1024;
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
    throw new JITError("INVALID_OPERATION", "json.stringifyChunks chunkBytes must be a positive integer");
  }
  const stringifyElement = emitSerializeSource(array2.def.element);
  return `(function () {
const stringifyElement = ${stringifyElement};
function* stringifyChunks(value) {
  let chunk = "[";
  for (let i = 0, len = value.length; i < len; i++) {
    const part = (i === 0 ? "" : ",") + stringifyElement(value[i]);
    if (chunk.length !== 0 && chunk.length + part.length > ${chunkBytes}) {
      yield chunk;
      chunk = part;
    } else {
      chunk += part;
    }
  }
  chunk += "]";
  yield chunk;
}
return stringifyChunks;
})()`;
}
function compileStringifyChunks(schema, chunks = {}, cache) {
  const chunkBytes = chunks.chunkBytes ?? 16 * 1024;
  return getCompileCached(
    schema,
    `stringifyChunks:${chunkBytes}`,
    () => {
      const source = emitStringifyChunksSource(schema, chunks);
      const compiled = globalThis.Function(`return ${source};`)();
      registerArtifact(compiled, {
        kind: "query",
        source,
        bindingNames: [],
        bindingValues: []
      });
      return compiled;
    },
    cache
  );
}

// ../../packages/jit/src/factories/special/special.ts
function literal2(value) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.literal, {
      value
    })
  );
}
function nativeEnum(values) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.enum, {
      values
    })
  );
}
function lazy(getter) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.lazy, {
      getter: () => unwrapSchema(getter())
    })
  );
}
function instanceOf(ctor) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.instanceof, {
      ctor
    })
  );
}
function json() {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.json, {}));
}
function custom(predicate, message) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.custom, {
      predicate,
      message
    })
  );
}
function templateLiteral(parts) {
  const normalized = parts.map((part) => typeof part === "string" ? part : unwrapSchema(part));
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.templateLiteral, {
      parts: normalized
    })
  );
}
function functionSchema(options) {
  const input = options.input.map((item) => unwrapSchema(item));
  const output = options.output === void 0 ? void 0 : unwrapSchema(options.output);
  const args = createSchema(TypeName.tuple, {
    items: input,
    rest: void 0
  });
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.function, {
      input,
      output,
      args
    })
  );
}
function temporalSchema(kind) {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.temporal, {
      kind
    })
  );
}
var temporal = {
  instant: () => temporalSchema("instant"),
  plainDate: () => temporalSchema("plainDate"),
  plainTime: () => temporalSchema("plainTime"),
  plainDateTime: () => temporalSchema("plainDateTime"),
  zonedDateTime: () => temporalSchema("zonedDateTime"),
  plainYearMonth: () => temporalSchema("plainYearMonth"),
  plainMonthDay: () => temporalSchema("plainMonthDay"),
  duration: () => temporalSchema("duration")
};

// ../../packages/jit/src/factories/runtime-ops.ts
function validate(schema) {
  const unwrapped = unwrapSchema(schema);
  return Object.freeze({
    is: () => validatorStep(unwrapped, "is"),
    parse: () => validatorStep(unwrapped, "parse"),
    safeParse: () => validatorStep(unwrapped, "safeParse"),
    parseAsync: () => validatorStep(unwrapped, "parseAsync"),
    safeParseAsync: () => validatorStep(unwrapped, "safeParseAsync"),
    issues: () => ({
      compile() {
        const safeParse = compileValidatorSelection(unwrapped, ["safeParse"]).safeParse;
        const issues = function* issues2(value) {
          const result = safeParse(value);
          if (!result.success) yield* result.issues;
        };
        return attachRuntimeMetadata(issues, {
          operation: "validate.issues",
          source: () => "function* issues(value) {\n  const result = __safeParse(value);\n  if (!result.success) yield* result.issues;\n}"
        });
      }
    })
  });
}
function equal(schema) {
  const unwrapped = unwrapSchema(schema);
  return attachRuntimeMetadata(compileEqual(unwrapped), {
    operation: "equal",
    source: () => emitEqualSource(unwrapped)
  });
}
function clone(schema) {
  const unwrapped = unwrapSchema(schema);
  return attachRuntimeMetadata(compileClone(unwrapped), {
    operation: "clone",
    source: () => emitCloneSource(unwrapped)
  });
}
function diff(schema) {
  const unwrapped = unwrapSchema(schema);
  return attachRuntimeMetadata(compileDiff(unwrapped), {
    operation: "diff",
    source: () => emitDiffSource(unwrapped)
  });
}
function hash2(schema) {
  const unwrapped = unwrapSchema(schema);
  return attachRuntimeMetadata(compileHash(unwrapped), {
    operation: "hash",
    source: () => emitHashSource(unwrapped)
  });
}
function format(schema) {
  const unwrapped = unwrapSchema(schema);
  return attachRuntimeMetadata(compileFormat(unwrapped), {
    operation: "format",
    source: () => emitFormatSource(unwrapped)
  });
}
function json2(schema) {
  if (schema === void 0) return json();
  const unwrapped = unwrapSchema(schema);
  return Object.freeze({
    stringify() {
      return {
        compile() {
          return attachRuntimeMetadata(compileSerialize(unwrapped), {
            operation: "json.stringify",
            source: () => emitSerializeSource(unwrapped)
          });
        }
      };
    },
    stringifyChunks(options) {
      return {
        compile() {
          return attachRuntimeMetadata(compileStringifyChunks(unwrapped, options), {
            operation: "json.stringifyChunks",
            source: () => emitStringifyChunksSource(unwrapped, options)
          });
        }
      };
    },
    parse() {
      return {
        compile() {
          const parse = compileValidatorSelection(unwrapped, ["parse"]).parse;
          const parseJson = ((value) => parse(JSON.parse(value)));
          registerArtifact(parseJson, {
            kind: "operation",
            schema: unwrapped,
            op: "fromJSON"
          });
          return attachRuntimeMetadata(parseJson, {
            operation: "json.parse",
            source: () => "function parseJson(json) {\n  return __parse(JSON.parse(json));\n}"
          });
        }
      };
    }
  });
}
function validatorStep(schema, op) {
  return {
    compile() {
      const compiled = compileValidatorSelection(schema, [op])[op];
      return attachRuntimeMetadata(compiled, {
        operation: `validate.${op}`,
        source: () => emitValidatorSource(schema, { ops: [op] })
      });
    }
  };
}
function attachRuntimeMetadata(fn, metadata) {
  const target = fn;
  const existing = Object.getOwnPropertyDescriptor(target, "compile");
  if (existing) return target;
  let source;
  let hash4;
  Object.defineProperties(target, {
    compile: {
      enumerable: false,
      value: () => target
    },
    source: {
      enumerable: false,
      get() {
        source = source ?? metadata.source();
        return source;
      }
    },
    hash: {
      enumerable: false,
      get() {
        hash4 = hash4 ?? hashSource(target.source);
        return hash4;
      }
    },
    explain: {
      enumerable: false,
      value: () => ({
        operation: metadata.operation,
        hash: target.hash,
        source: target.source,
        cache: "identity"
      })
    }
  });
  return target;
}
function hashSource(source) {
  let hash4 = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash4 ^= source.charCodeAt(index);
    hash4 = Math.imul(hash4, 16777619);
  }
  return `fnv1a:${(hash4 >>> 0).toString(36)}`;
}

// ../../packages/jit/src/factories/security.ts
function mask(schema, options) {
  return compileMask(unwrapSchema(schema), options);
}
function sanitize(schema, options) {
  return compileSanitize(unwrapSchema(schema), options);
}

// ../../packages/jit/src/factories/serialize.ts
function serializer(schema, options) {
  const unwrapped = unwrapSchema(schema);
  const stringify = compileSerialize(unwrapped, options);
  const validate3 = compileValidator(unwrapped, options);
  return {
    stringify,
    parse: (json4) => validate3.parse(JSON.parse(json4))
  };
}
function codec(schema, outputOrOptions, valueCodecOptions) {
  if (valueCodecOptions !== void 0 && outputOrOptions !== void 0 && isSchemaInput(outputOrOptions)) {
    const input = unwrapSchema(schema);
    const output = unwrapSchema(outputOrOptions);
    return createBuilder(
      createSchema(TypeName.codec, {
        input,
        output,
        decode: valueCodecOptions.decode,
        encode: valueCodecOptions.encode
      })
    );
  }
  return compileCodec(unwrapSchema(schema), outputOrOptions);
}
function isSchemaInput(value) {
  return typeof value === "object" && value !== null && ("schema" in value || "type" in value);
}

// ../../packages/jit/src/runtime/stream/boundary-scanner.ts
var ArrayBoundaryScanner = class {
  constructor(hooks) {
    this.hooks = hooks;
    this.buffer = "";
    this.scanPos = 0;
    this.elementStart = -1;
    this.depth = 0;
    this.inString = false;
    this.escaped = false;
    this.rootStarted = false;
    this.rootClosed = false;
  }
  get done() {
    return this.rootClosed;
  }
  get hasOpenElement() {
    return this.elementStart !== -1 || this.rootStarted && !this.rootClosed;
  }
  push(text) {
    this.buffer += text;
    const buf = this.buffer;
    const len = buf.length;
    let pos = this.scanPos;
    for (; pos < len; pos++) {
      const code = buf.charCodeAt(pos);
      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (code === 92) {
          this.escaped = true;
        } else if (code === 34) {
          this.inString = false;
        }
        continue;
      }
      if (code === 32 || code === 9 || code === 10 || code === 13) continue;
      if (this.rootClosed) {
        this.hooks.fail("unexpected content after the root array closed");
      }
      if (!this.rootStarted) {
        if (code !== 91) this.hooks.fail("expected the stream to start with an array");
        this.rootStarted = true;
        this.depth = 1;
        continue;
      }
      if (this.depth === 1) {
        if (code === 93) {
          if (this.elementStart !== -1) {
            this.hooks.onElement(buf.slice(this.elementStart, pos));
            this.elementStart = -1;
          }
          this.depth = 0;
          this.rootClosed = true;
          continue;
        }
        if (code === 44) {
          if (this.elementStart === -1) this.hooks.fail("unexpected comma in the root array");
          this.hooks.onElement(buf.slice(this.elementStart, pos));
          this.elementStart = -1;
          continue;
        }
        if (this.elementStart === -1) this.elementStart = pos;
        if (code === 123 || code === 91) this.depth++;
        else if (code === 34) this.inString = true;
        else if (code === 125) this.hooks.fail("unbalanced '}' in the root array");
        continue;
      }
      if (code === 34) this.inString = true;
      else if (code === 123 || code === 91) this.depth++;
      else if (code === 125 || code === 93) {
        this.depth--;
        if (this.depth < 1) this.hooks.fail("unbalanced closing bracket");
      }
    }
    if (this.elementStart !== -1) {
      this.buffer = buf.slice(this.elementStart);
      this.scanPos = this.buffer.length;
      this.elementStart = 0;
    } else {
      this.buffer = "";
      this.scanPos = 0;
    }
  }
};
var ValueBoundaryScanner = class {
  constructor(hooks) {
    this.hooks = hooks;
    this.depth = 0;
    this.inString = false;
    this.escaped = false;
    this.started = false;
    this.closed = false;
  }
  /** True once a bracketed root has balanced back to depth zero. */
  get complete() {
    return this.closed;
  }
  push(text) {
    const len = text.length;
    for (let pos = 0; pos < len; pos++) {
      const code = text.charCodeAt(pos);
      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (code === 92) {
          this.escaped = true;
        } else if (code === 34) {
          this.inString = false;
          if (this.depth === 0 && this.started) this.closed = true;
        }
        continue;
      }
      if (code === 32 || code === 9 || code === 10 || code === 13) continue;
      if (this.closed) this.hooks.fail("unexpected content after the root value closed");
      if (code === 34) {
        this.inString = true;
        this.started = true;
      } else if (code === 123 || code === 91) {
        this.depth++;
        this.started = true;
      } else if (code === 125 || code === 93) {
        this.depth--;
        if (this.depth < 0) this.hooks.fail("unbalanced closing bracket");
        if (this.depth === 0) this.closed = true;
      } else {
        this.started = true;
      }
    }
  }
};

// ../../packages/jit/src/compiler/stream.ts
function resolveRoot(schema) {
  let current = schema;
  while (true) {
    switch (current.type) {
      case TypeName.default:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType;
        continue;
      case TypeName.lazy:
        current = current.def.getter();
        continue;
      default:
        return current;
    }
  }
}
function rootGate(schema) {
  switch (schema.type) {
    case TypeName.array:
    case TypeName.tuple:
      return { test: (code) => code === 91, expected: "array" };
    case TypeName.object:
    case TypeName.record:
      return { test: (code) => code === 123, expected: "object" };
    case TypeName.string:
      return { test: (code) => code === 34, expected: "string" };
    case TypeName.number:
    case TypeName.int:
      return {
        test: (code) => code === 45 || code >= 48 && code <= 57,
        expected: "number"
      };
    case TypeName.boolean:
      return {
        test: (code) => code === 116 || code === 102,
        expected: "boolean"
      };
    case TypeName.null:
      return { test: (code) => code === 110, expected: "null" };
    default:
      return void 0;
  }
}
function structuralIssue(message, path = "") {
  return { path, code: "invalid_json", expected: "well-formed JSON", message };
}
function throwStructural(message, path = "") {
  throw new JITValidationError([structuralIssue(message, path)]);
}
function prefixIssues(issues, prefix) {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path === "" ? prefix : `${prefix}${issue.path.startsWith("[") ? "" : "."}${issue.path}`
  }));
}
function compileStream(schema, options = {}) {
  const format3 = options.format ?? "json";
  const root = resolveRoot(schema);
  if (format3 === "ndjson") return createNdjsonStream(schema, options);
  if (root.type === TypeName.array) return createArrayStream(root, options);
  return createValueStream(schema, root, options);
}
function createDecoder() {
  const decoder = new TextDecoder();
  return (chunk, last2) => typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: !last2 });
}
function gateFirstChar(text, gateRef) {
  const gate = gateRef.pending;
  if (!gate) return;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 32 || code === 9 || code === 10 || code === 13) continue;
    gateRef.pending = void 0;
    if (!gate.test(code)) {
      throw new JITValidationError([
        {
          path: "",
          code: "invalid_type",
          expected: gate.expected,
          message: `stream root must be ${gate.expected}`,
          received: JSON.stringify(text[index])
        }
      ]);
    }
    return;
  }
}
function createArrayStream(root, options) {
  const element = root.def.element;
  const checks = (root.def.checks ?? []).filter(
    (check) => check.kind === "min" || check.kind === "max" || check.kind === "length" || check.kind === "nonEmpty"
  );
  const validator2 = compileValidator(element);
  const decode = createDecoder();
  const items = [];
  const gateRef = { pending: rootGate(root) };
  let failed = false;
  let ended = false;
  const scanner = new ArrayBoundaryScanner({
    onElement(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throwStructural(`malformed JSON element at index ${items.length}`, `[${items.length}]`);
      }
      const result = validator2.safeParse(parsed);
      if (!result.success) {
        throw new JITValidationError(prefixIssues(result.issues, `[${items.length}]`));
      }
      const index = items.length;
      items.push(result.data);
      for (const check of checks) {
        if (check.kind === "max" && items.length > check.value) {
          throwStructural(`expected at most ${check.value} items`, "");
        }
      }
      options.onItem?.(result.data, index);
    },
    fail(message) {
      throwStructural(message);
    }
  });
  const guard = () => {
    if (failed) throw new JITError("INVALID_OPERATION", "stream already failed");
    if (ended) throw new JITError("INVALID_OPERATION", "stream already ended");
  };
  return {
    items,
    write(chunk) {
      guard();
      try {
        const text = decode(chunk, false);
        gateFirstChar(text, gateRef);
        scanner.push(text);
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    end() {
      guard();
      ended = true;
      if (!scanner.done) {
        failed = true;
        throwStructural("unexpected end of stream: root array never closed");
      }
      for (const check of checks) {
        if (check.kind === "min" && items.length < check.value) {
          throwStructural(`expected at least ${check.value} items`);
        }
        if (check.kind === "nonEmpty" && items.length === 0) {
          throwStructural("expected a non-empty array");
        }
        if (check.kind === "length" && items.length !== check.value) {
          throwStructural(`expected exactly ${check.value} items`);
        }
        if (check.kind === "max" && items.length > check.value) {
          throwStructural(`expected at most ${check.value} items`);
        }
      }
      return items;
    }
  };
}
function createValueStream(schema, root, options) {
  const validator2 = compileValidator(schema, options);
  const decode = createDecoder();
  const gateRef = { pending: rootGate(root) };
  const scanner = new ValueBoundaryScanner({
    fail(message) {
      throwStructural(message);
    }
  });
  let buffer = "";
  let failed = false;
  let ended = false;
  const guard = () => {
    if (failed) throw new JITError("INVALID_OPERATION", "stream already failed");
    if (ended) throw new JITError("INVALID_OPERATION", "stream already ended");
  };
  return {
    items: [],
    write(chunk) {
      guard();
      try {
        const text = decode(chunk, false);
        gateFirstChar(text, gateRef);
        scanner.push(text);
        buffer += text;
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    end() {
      guard();
      ended = true;
      let parsed;
      try {
        parsed = JSON.parse(buffer);
      } catch {
        failed = true;
        throwStructural("unexpected end of stream: incomplete JSON document");
      }
      return validator2.parse(parsed);
    }
  };
}
function createNdjsonStream(schema, options) {
  const validator2 = compileValidator(schema, options);
  const decode = createDecoder();
  const items = [];
  let buffer = "";
  let line = 0;
  let failed = false;
  let ended = false;
  const consume = (text) => {
    if (text.trim() === "") {
      line++;
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throwStructural(`malformed JSON on line ${line}`, `line ${line}`);
    }
    const result = validator2.safeParse(parsed);
    if (!result.success) {
      throw new JITValidationError(prefixIssues(result.issues, `line ${line}`));
    }
    const index = items.length;
    items.push(result.data);
    line++;
    options.onItem?.(result.data, index);
  };
  const guard = () => {
    if (failed) throw new JITError("INVALID_OPERATION", "stream already failed");
    if (ended) throw new JITError("INVALID_OPERATION", "stream already ended");
  };
  return {
    items,
    write(chunk) {
      guard();
      try {
        buffer += decode(chunk, false);
        let cut = buffer.indexOf("\n");
        while (cut !== -1) {
          consume(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 1);
          cut = buffer.indexOf("\n");
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    end() {
      guard();
      ended = true;
      try {
        if (buffer.trim() !== "") consume(buffer);
      } catch (error) {
        failed = true;
        throw error;
      }
      return items;
    }
  };
}

// ../../packages/jit/src/factories/stream.ts
function stream(schema, options) {
  return compileStream(unwrapSchema(schema), options);
}

// ../../packages/jit/src/factories/transform.ts
function transform2(schema) {
  const unwrapped = unwrapSchema(schema);
  return createTransformBuilder(unwrapped, {
    selected: void 0,
    transforms: {}
  });
}
function createTransformBuilder(schema, state) {
  return {
    select(...keys) {
      return createTransformBuilder(schema, { ...state, selected: keys });
    },
    map(key, mapper2) {
      const result = mapper2(createFieldOps());
      const step = isTransformExpression(result) ? { kind: "inline", emit: result.emit } : {
        kind: "binding",
        fn: result
      };
      const transforms = { ...state.transforms, [key]: step };
      return createTransformBuilder(schema, { ...state, transforms });
    },
    compile() {
      return compileTransformFacade(schema, state);
    }
  };
}
function compileTransformFacade(schema, state) {
  const objectSchema = resolveWrappers(schema).base;
  if (objectSchema.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "JIT.transform expects an object schema");
  }
  const props = objectSchema.def.props;
  const keys = state.selected ?? Object.keys(props);
  for (const key of keys) {
    if (!(key in props))
      throw new JITError("INVALID_OPERATION", `transform selected unknown key ${JSON.stringify(key)}`);
  }
  for (const key of Object.keys(state.transforms)) {
    if (!(key in props)) throw new JITError("INVALID_OPERATION", `transform mapped unknown key ${JSON.stringify(key)}`);
  }
  const transformKeys = Object.keys(state.transforms);
  const bindings = collectBindings(transformKeys, state.transforms);
  const source = emitTransformFacadeSource(keys, state.transforms, bindings.namesByKey);
  const fn = globalThis.Function(...bindings.names, `return ${source};`)(...bindings.values);
  registerArtifact(fn, {
    kind: "mapper",
    source,
    bindingNames: bindings.names,
    bindingValues: bindings.values
  });
  return fn;
}
function emitTransformFacadeSource(keys, transforms, bindingNamesByKey) {
  const entries = keys.map((key) => {
    const source = emitPropertyAccess("value", key);
    const transform3 = transforms[key];
    const bindingName = bindingNamesByKey.get(key);
    const value = transform3?.kind === "inline" ? transform3.emit(source) : bindingName ? `${bindingName}(${source}, value)` : source;
    return `${emitLiteral(key)}: ${value}`;
  });
  return `function transform(value) {
  return { ${entries.join(", ")} };
}`;
}
function createFieldOps() {
  return {
    lowercase: () => transformExpression((valueExpr) => `${valueExpr}.toLowerCase()`),
    uppercase: () => transformExpression((valueExpr) => `${valueExpr}.toUpperCase()`),
    trim: () => transformExpression((valueExpr) => `${valueExpr}.trim()`),
    identity: () => transformExpression((valueExpr) => valueExpr)
  };
}
function transformExpression(emit) {
  return {
    __jitTransformExpression: true,
    emit,
    _input: null,
    _output: null
  };
}
function isTransformExpression(value) {
  return value !== null && typeof value === "object" && value.__jitTransformExpression === true;
}
function collectBindings(keys, transforms) {
  const names = [];
  const values = [];
  const namesByKey = /* @__PURE__ */ new Map();
  for (const key of keys) {
    const transform3 = transforms[key];
    if (transform3?.kind !== "binding") continue;
    const name = `__t${names.length}`;
    names[names.length] = name;
    values[values.length] = transform3.fn;
    namesByKey.set(key, name);
  }
  return { names, values, namesByKey };
}

// ../../packages/jit/src/runtime/update/reactive-update.ts
function createReactiveUpdate(initial, updater, createDiff, options = {}) {
  let value = initial;
  let version = 0;
  let batchDepth = 0;
  let batchPrevious;
  let hasBatchPrevious = false;
  let pendingPrevious;
  let hasPendingPrevious = false;
  let scheduled = false;
  let disposed = false;
  let diff3;
  const listeners = /* @__PURE__ */ new Set();
  const pathBuckets = /* @__PURE__ */ new Map();
  const selections = /* @__PURE__ */ new Set();
  const scheduler = options.schedule ?? "sync";
  const report = (error) => {
    if (options.onError) {
      options.onError(error);
      return;
    }
    throw error;
  };
  const invoke = (listener) => {
    if (!options.onError) {
      listener();
      return;
    }
    try {
      listener();
    } catch (error) {
      report(error);
    }
  };
  const notify = (previous, current) => {
    if (disposed || Object.is(previous, current)) return;
    const eventVersion = version;
    let cachedChanges;
    const event = {
      previous,
      value: current,
      version: eventVersion,
      get changes() {
        if (cachedChanges) return cachedChanges;
        diff3 ??= createDiff();
        cachedChanges = diff3(previous, current).map((change) => ({
          type: change.type,
          path: change.path,
          previous: readPath(previous, change.path),
          value: readPath(current, change.path)
        }));
        return cachedChanges;
      }
    };
    for (const listener of listeners) invoke(() => listener(event));
    for (const bucket of pathBuckets.values()) {
      const before = readPath(previous, bucket.path);
      const after = readPath(current, bucket.path);
      for (const entry of bucket.listeners) {
        if (entry.equals(before, after)) continue;
        const pathEvent = {
          path: bucket.path,
          previous: before,
          value: after,
          rootPrevious: previous,
          root: current,
          version: eventVersion
        };
        invoke(() => entry.listener(pathEvent));
      }
    }
    for (const entry of selections) {
      const before = entry.selector(previous);
      const after = entry.selector(current);
      if (entry.equals(before, after)) continue;
      const selectionEvent = {
        previous: before,
        value: after,
        rootPrevious: previous,
        root: current,
        version: eventVersion
      };
      invoke(() => entry.listener(selectionEvent));
    }
  };
  const flush = () => {
    if (!scheduled || !hasPendingPrevious) return;
    const previous = pendingPrevious;
    scheduled = false;
    pendingPrevious = void 0;
    hasPendingPrevious = false;
    notify(previous, value);
  };
  const enqueue = (previous) => {
    if (batchDepth > 0) {
      if (!hasBatchPrevious) {
        batchPrevious = previous;
        hasBatchPrevious = true;
      }
      return;
    }
    if (scheduler === "sync") {
      notify(previous, value);
      return;
    }
    if (!hasPendingPrevious) {
      pendingPrevious = previous;
      hasPendingPrevious = true;
    }
    if (scheduled) return;
    scheduled = true;
    if (scheduler === "microtask") queueMicrotask(flush);
    else scheduler(flush);
  };
  const set2 = (next) => {
    if (disposed || Object.is(value, next)) return value;
    const previous = value;
    value = next;
    version++;
    enqueue(previous);
    return value;
  };
  const controller = {
    get value() {
      return value;
    },
    get version() {
      return version;
    },
    update(input) {
      return set2(updater(value, input));
    },
    set: set2,
    subscribe(listener, subscribeOptions = {}) {
      if (disposed) return () => void 0;
      listeners.add(listener);
      if (subscribeOptions.immediate) {
        const immediate = {
          previous: value,
          value,
          version,
          changes: []
        };
        invoke(() => listener(immediate));
      }
      return () => listeners.delete(listener);
    },
    watch(path, listener, watchOptions = {}) {
      if (disposed) return () => void 0;
      const normalized = normalizePath(path);
      const key = JSON.stringify(normalized);
      let bucket = pathBuckets.get(key);
      if (!bucket) {
        bucket = { path: normalized, listeners: /* @__PURE__ */ new Set() };
        pathBuckets.set(key, bucket);
      }
      const entry = {
        listener: (event) => listener(
          event
        ),
        equals: watchOptions.equals ?? Object.is
      };
      bucket.listeners.add(entry);
      if (watchOptions.immediate) {
        const selected = readPath(value, normalized);
        invoke(
          () => listener({
            path: normalized,
            previous: selected,
            value: selected,
            rootPrevious: value,
            root: value,
            version
          })
        );
      }
      return () => {
        bucket?.listeners.delete(entry);
        if (bucket?.listeners.size === 0) pathBuckets.delete(key);
      };
    },
    select(selector, listener, selectOptions = {}) {
      if (disposed) return () => void 0;
      const entry = {
        selector,
        listener: (event) => listener(event),
        equals: selectOptions.equals ?? Object.is
      };
      selections.add(entry);
      if (selectOptions.immediate) {
        const selected = selector(value);
        invoke(
          () => listener({
            previous: selected,
            value: selected,
            rootPrevious: value,
            root: value,
            version
          })
        );
      }
      return () => selections.delete(entry);
    },
    batch(run) {
      batchDepth++;
      try {
        run(controller);
      } finally {
        batchDepth--;
        if (batchDepth === 0 && hasBatchPrevious) {
          const previous = batchPrevious;
          batchPrevious = void 0;
          hasBatchPrevious = false;
          enqueue(previous);
        }
      }
      return value;
    },
    flush,
    dispose() {
      disposed = true;
      listeners.clear();
      pathBuckets.clear();
      selections.clear();
      pendingPrevious = void 0;
      hasPendingPrevious = false;
      batchPrevious = void 0;
      hasBatchPrevious = false;
      scheduled = false;
    }
  };
  return controller;
}
function normalizePath(path) {
  if (typeof path !== "string") return Object.freeze([...path]);
  if (path === "") return Object.freeze([]);
  return Object.freeze(
    path.split(".").map((part) => part !== "" && String(Number(part)) === part ? Number(part) : part)
  );
}
function readPath(value, path) {
  let current = value;
  for (let index = 0; index < path.length; index++) {
    if (current === null || current === void 0) return void 0;
    current = current[path[index]];
  }
  return current;
}

// ../../packages/jit/src/factories/update.ts
function update(schema, ...args) {
  const unwrapped = unwrapSchema(schema);
  assertUpdateable2(unwrapped);
  const compiled = compileUpdate(unwrapped);
  const run = ((current, updateInput) => {
    const patch = typeof updateInput === "function" ? captureDraftPatch(updateInput) : updateInput;
    return compiled(current, patch);
  });
  Object.defineProperties(run, {
    compile: {
      enumerable: false,
      value: () => run
    },
    patch: {
      enumerable: false,
      value: (template) => ({
        compile: () => (current, params) => run(current, materializeParamPatch(template, params))
      })
    },
    reactive: {
      enumerable: false,
      value: (initial, options) => createReactiveUpdate(initial, run, () => compileDiff(unwrapped), options)
    }
  });
  if (args.length === 0) return run;
  return run(args[0], args[1]);
}
function materializeParamPatch(template, params) {
  if (isParamRef(template)) return params[template.name];
  if (Array.isArray(template)) return template.map((value) => materializeParamPatch(value, params));
  if (template !== null && typeof template === "object") {
    const out = {};
    for (const key of Object.keys(template)) {
      out[key] = materializeParamPatch(template[key], params);
    }
    return out;
  }
  return template;
}
function isParamRef(value) {
  return value !== null && typeof value === "object" && value.__jitQueryValue === "param";
}
function captureDraftPatch(recipe) {
  const writes = [];
  const proxies = /* @__PURE__ */ new Map();
  const createDraft = (path) => {
    const cacheKey = path.map(String).join("\0");
    const cached = proxies.get(cacheKey);
    if (cached) return cached;
    const draft = new Proxy(
      {},
      {
        get(_target, key) {
          if (typeof key === "symbol") return void 0;
          return createDraft([...path, key]);
        },
        set(_target, key, value) {
          if (typeof key === "symbol") {
            throw new JITError("INVALID_UPDATE", "Draft updates do not support symbol keys");
          }
          writes[writes.length] = { path: [...path, key], value };
          return true;
        }
      }
    );
    proxies.set(cacheKey, draft);
    return draft;
  };
  recipe(createDraft([]));
  return materializePatch(writes);
}
function materializePatch(writes) {
  const root = {};
  for (const write of writes) {
    let current = root;
    for (let index = 0; index < write.path.length; index++) {
      const segment = write.path[index];
      const key = normalizeKey(segment);
      const isLast = index === write.path.length - 1;
      if (isLast) {
        current[key] = write.value;
        continue;
      }
      const nextSegment = write.path[index + 1];
      const existing = current[key];
      if (existing === void 0) {
        const next = isArrayKey(nextSegment) ? [] : {};
        current[key] = next;
        current = next;
      } else {
        current = existing;
      }
    }
  }
  return root;
}
function normalizeKey(key) {
  if (typeof key === "number") return key;
  if (typeof key === "string" && key !== "" && String(Number(key)) === key) return Number(key);
  return String(key);
}
function isArrayKey(key) {
  return typeof key === "number" || typeof key === "string" && key !== "" && String(Number(key)) === key;
}
function assertUpdateable2(schema) {
  if (schema.type === TypeName.readonly) {
    throw new JITError("READONLY_FIELD", "Cannot compile updates for readonly schemas");
  }
  if (schema.type === TypeName.lazy) {
    assertUpdateable2(schema.def.getter());
    return;
  }
  if (hasInnerType3(schema)) {
    assertUpdateable2(schema.def.innerType);
    return;
  }
  if (schema.type === TypeName.object) {
    const objectSchema = schema;
    for (const child of Object.values(objectSchema.def.props)) {
      assertUpdateable2(child);
    }
  }
}
function hasInnerType3(schema) {
  return schema.type === TypeName.optional || schema.type === TypeName.nullable || schema.type === TypeName.nullish || schema.type === TypeName.default || schema.type === TypeName.brand || schema.type === TypeName.transform || schema.type === TypeName.pipe || schema.type === TypeName.refine || schema.type === TypeName.coerce || schema.type === TypeName.promise;
}

// ../../packages/jit/src/factories/validate.ts
var facadeCache = /* @__PURE__ */ new WeakMap();
function validator(schema, options) {
  const unwrapped = unwrapSchema(schema);
  const ops = selectedOpsFromOptions(options);
  if (ops.length > 0) {
    return attachGet(unwrapped, compileValidatorSelection(unwrapped, ops, options), options);
  }
  if (options?.cache === false)
    return createValidatorFacade(unwrapped, options);
  const cached = facadeCache.get(unwrapped);
  if (cached) return cached;
  const facade = createValidatorFacade(unwrapped, options);
  facadeCache.set(unwrapped, facade);
  return facade;
}
function createValidatorFacade(schema, options) {
  const target = {
    get(...ops) {
      return compileValidatorSelection(schema, ops, options);
    }
  };
  for (const op of VALIDATOR_OPS) {
    Object.defineProperty(target, op, {
      configurable: false,
      enumerable: true,
      get() {
        return compileValidatorSelection(schema, [op], options)[op];
      }
    });
  }
  return Object.freeze(target);
}
function attachGet(schema, selection, options) {
  return Object.freeze({
    ...selection,
    get(...ops) {
      return compileValidatorSelection(schema, ops, options);
    }
  });
}
function selectedOpsFromOptions(options) {
  if (!options) return [];
  const ops = [];
  if (options.is) ops.push("is");
  if (options.parse) ops.push("parse");
  if (options.safeParse) ops.push("safeParse");
  if (options.parseAsync || options.asyncParse) ops.push("parseAsync");
  if (options.safeParseAsync || options.asyncSafeParse) ops.push("safeParseAsync");
  return ops;
}

// ../../packages/jit/src/compiler/watch.ts
function compileWatch(schema, options) {
  const program = emitWatchProgram(schema, options);
  const bindingNames = program.bindings.map((_, index) => `__w${index}`);
  const compiled = globalThis.Function(...bindingNames, `return ${program.source};`)(...program.bindings);
  registerArtifact(compiled, {
    kind: "watch",
    source: program.source,
    bindingNames,
    bindingValues: program.bindings
  });
  return compiled;
}
function emitWatchProgram(schema, options) {
  const target = expectWatchTarget(schema, "emitWatchSource");
  const key = options.key;
  validateObjectKeys3(target.objectSchema, [key], "watch");
  const bindings = [];
  const onAdd = addOptionalBinding(bindings, options.onAdd);
  const onRemove = addOptionalBinding(bindings, options.onRemove);
  const onUpdate = addOptionalBinding(bindings, options.onUpdate);
  const keyAccess = emitPropertyAccess("item", key);
  const previousKeyAccess = emitPropertyAccess("previousItem", key);
  const writer = new CodeWriter();
  writer.line("function watch(previous, current) {");
  writer.indent(() => {
    writer.line("const previousIndex = new Map();");
    writer.line("const currentIndex = new Map();");
    writer.line("const initialItems = [];");
    emitCollectionLoop(writer, target, "previous", "previousItem", () => {
      writer.line(`const id = ${previousKeyAccess};`);
      writer.line("previousIndex.set(id, previousItem);");
      writer.line("initialItems[initialItems.length] = previousItem;");
    });
    writer.line("const currentItems = [];");
    writer.line("const newItems = [];");
    writer.line("const removedItems = [];");
    writer.line("const updatedItems = [];");
    emitCollectionLoop(writer, target, "current", "item", () => {
      writer.line(`const id = ${keyAccess};`);
      writer.line("currentIndex.set(id, item);");
      writer.line("currentItems[currentItems.length] = item;");
      writer.line("const previousItem = previousIndex.get(id);");
      writer.line("if (previousItem === undefined) {");
      writer.indent(() => {
        writer.line("newItems[newItems.length] = item;");
        if (onAdd) writer.line(`${onAdd}(item);`);
      });
      writer.line("} else if (previousItem !== item) {");
      writer.indent(() => {
        writer.line("updatedItems[updatedItems.length] = { previous: previousItem, current: item };");
        if (onUpdate) writer.line(`${onUpdate}(previousItem, item);`);
      });
      writer.line("}");
    });
    emitCollectionLoop(writer, target, "previous", "previousItem", () => {
      writer.line(`const id = ${previousKeyAccess};`);
      writer.line("if (!currentIndex.has(id)) {");
      writer.indent(() => {
        writer.line("removedItems[removedItems.length] = previousItem;");
        if (onRemove) writer.line(`${onRemove}(previousItem);`);
      });
      writer.line("}");
    });
    writer.line("const isChanged = newItems.length !== 0 || removedItems.length !== 0 || updatedItems.length !== 0;");
    writer.line("return { currentItems, initialItems, newItems, removedItems, updatedItems, isChanged };");
  });
  writer.line("}");
  return { source: writer.toString(), bindings };
}
function emitCollectionLoop(writer, target, collection, itemName, body) {
  switch (target.kind) {
    case "array":
      writer.line(`for (let i = 0, len = ${collection}.length; i < len; i++) {`);
      writer.indent(() => {
        writer.line(`const ${itemName} = ${collection}[i];`);
        body();
      });
      writer.line("}");
      return;
    case "set":
      writer.line(`for (const ${itemName} of ${collection}) {`);
      writer.indent(body);
      writer.line("}");
      return;
    case "map":
      writer.line(`for (const entry of ${collection}) {`);
      writer.indent(() => {
        writer.line(`const ${itemName} = entry[1];`);
        body();
      });
      writer.line("}");
      return;
  }
}
function addOptionalBinding(bindings, value) {
  if (value === void 0) return void 0;
  const name = `__w${bindings.length}`;
  bindings[bindings.length] = value;
  return name;
}
function expectWatchTarget(schema, compilerName) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.array && resolved.type !== TypeName.set && resolved.type !== TypeName.map) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects an array, set, or map schema`);
  }
  const element = resolved.type === TypeName.map ? resolveWrappers(resolved.def.value).base : resolveWrappers(resolved.def.element).base;
  if (element.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects a collection of object schema`);
  }
  return {
    kind: resolved.type,
    objectSchema: element
  };
}
function validateObjectKeys3(schema, keys, compilerName) {
  const props = schema.def.props;
  for (const key of keys) {
    if (!(key in props)) {
      throw new JITError("INVALID_OPERATION", `${compilerName} received unknown key ${JSON.stringify(key)}`, {
        path: [key]
      });
    }
  }
}

// ../../packages/jit/src/runtime/watch/watched-list.ts
var WatchedList = class {
  /**
   * Creates a watched list from an initial item snapshot.
   *
   * @param initialItems - The initial collection items.
   * @param options - Identity and comparison options.
   */
  constructor(initialItems = [], options = {}) {
    this.currentItems = [...initialItems];
    this.initialItems = [...initialItems];
    this.newItems = [];
    this.removedItems = [];
    this.updatedItems = [];
    this.key = options.key;
    this.compare = options.compare;
  }
  compareItems(left, right) {
    if (this.compare) return this.compare(left, right);
    if (this.key) return Object.is(left[this.key], right[this.key]);
    return Object.is(left, right);
  }
  getItems() {
    return this.currentItems;
  }
  getInitialItems() {
    return this.initialItems;
  }
  getNewItems() {
    return this.newItems;
  }
  getRemovedItems() {
    return this.removedItems;
  }
  getUpdatedItems() {
    return this.updatedItems;
  }
  isChanged() {
    return this.newItems.length !== 0 || this.removedItems.length !== 0 || this.updatedItems.length !== 0;
  }
  exists(item) {
    return this.findIndex(this.currentItems, item) !== -1;
  }
  add(item) {
    const removedIndex = this.findIndex(this.removedItems, item);
    if (removedIndex !== -1) this.removeAt(this.removedItems, removedIndex);
    if (this.findIndex(this.newItems, item) === -1 && this.findIndex(this.initialItems, item) === -1) {
      this.newItems[this.newItems.length] = item;
    }
    if (this.findIndex(this.currentItems, item) === -1) {
      this.currentItems[this.currentItems.length] = item;
    }
  }
  remove(item) {
    const currentIndex = this.findIndex(this.currentItems, item);
    if (currentIndex !== -1) this.removeAt(this.currentItems, currentIndex);
    const newIndex = this.findIndex(this.newItems, item);
    if (newIndex !== -1) {
      this.removeAt(this.newItems, newIndex);
      return;
    }
    if (this.findIndex(this.removedItems, item) === -1) {
      this.removedItems[this.removedItems.length] = item;
    }
  }
  update(items) {
    const previousItems = this.currentItems;
    const previousIndex = this.createIndex(previousItems);
    const nextIndex = this.createIndex(items);
    const newItems = [];
    const removedItems = [];
    const updatedItems = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const previous = this.lookup(previousIndex, previousItems, item);
      if (!previous) {
        newItems[newItems.length] = item;
      } else if (previous.item !== item) {
        updatedItems[updatedItems.length] = { previous: previous.item, current: item };
      }
    }
    for (let index = 0; index < previousItems.length; index++) {
      const item = previousItems[index];
      const next = this.lookup(nextIndex, items, item);
      if (!next) removedItems[removedItems.length] = item;
    }
    this.currentItems = [...items];
    this.newItems = newItems;
    this.removedItems = removedItems;
    this.updatedItems = updatedItems;
  }
  snapshot() {
    return {
      currentItems: this.currentItems,
      initialItems: this.initialItems,
      newItems: this.newItems,
      removedItems: this.removedItems,
      updatedItems: this.updatedItems,
      isChanged: this.isChanged()
    };
  }
  findIndex(items, item) {
    if (this.key || !this.compare) {
      const index = this.createIndex(items);
      const found = this.lookup(index, items, item);
      return found?.index ?? -1;
    }
    for (let index = 0; index < items.length; index++) {
      if (this.compareItems(item, items[index])) return index;
    }
    return -1;
  }
  createIndex(items) {
    if (this.compare && !this.key) return void 0;
    const index = /* @__PURE__ */ new Map();
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      index.set(this.identityOf(item), { item, index: itemIndex });
    }
    return index;
  }
  lookup(index, items, item) {
    if (index) return index.get(this.identityOf(item));
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const current = items[itemIndex];
      if (this.compareItems(item, current)) return { item: current, index: itemIndex };
    }
    return void 0;
  }
  identityOf(item) {
    return this.key ? item[this.key] : item;
  }
  removeAt(items, index) {
    for (let next = index + 1; next < items.length; next++) {
      items[next - 1] = items[next];
    }
    items.length = items.length - 1;
  }
};
var KeyedWatchedList = class extends WatchedList {
  /**
   * Creates an indexed watched list using a required identity key.
   *
   * @param initialItems - The initial collection items.
   * @param options - Identity key and comparison options.
   */
  constructor(initialItems = [], options) {
    super(initialItems, options);
    this.currentIndex = /* @__PURE__ */ new Map();
    this.initialIndex = /* @__PURE__ */ new Map();
    this.newIndex = /* @__PURE__ */ new Map();
    this.removedIndex = /* @__PURE__ */ new Map();
    this.reindex(this.currentIndex, this.currentItems);
    this.reindex(this.initialIndex, this.getInitialItems());
  }
  exists(item) {
    return this.currentIndex.has(this.identityOf(item));
  }
  add(item) {
    const id = this.identityOf(item);
    const removed = this.removedIndex.get(id);
    if (removed) {
      this.removeAt(this.removedItems, removed.index);
      this.reindex(this.removedIndex, this.removedItems);
    }
    if (!this.newIndex.has(id) && !this.initialIndex.has(id)) {
      this.newItems[this.newItems.length] = item;
      this.newIndex.set(id, { item, index: this.newItems.length - 1 });
    }
    if (!this.currentIndex.has(id)) {
      this.currentItems[this.currentItems.length] = item;
      this.currentIndex.set(id, { item, index: this.currentItems.length - 1 });
    }
  }
  remove(item) {
    const id = this.identityOf(item);
    const current = this.currentIndex.get(id);
    if (current) {
      this.removeAt(this.currentItems, current.index);
      this.reindex(this.currentIndex, this.currentItems);
    }
    const created = this.newIndex.get(id);
    if (created) {
      this.removeAt(this.newItems, created.index);
      this.reindex(this.newIndex, this.newItems);
      return;
    }
    if (!this.removedIndex.has(id)) {
      this.removedItems[this.removedItems.length] = item;
      this.removedIndex.set(id, { item, index: this.removedItems.length - 1 });
    }
  }
  update(items) {
    const previousItems = this.currentItems;
    const previousIndex = this.currentIndex;
    const nextIndex = /* @__PURE__ */ new Map();
    const newItems = [];
    const removedItems = [];
    const updatedItems = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const id = this.identityOf(item);
      const previous = previousIndex.get(id);
      nextIndex.set(id, { item, index });
      if (!previous) {
        newItems[newItems.length] = item;
      } else if (previous.item !== item) {
        updatedItems[updatedItems.length] = { previous: previous.item, current: item };
      }
    }
    for (let index = 0; index < previousItems.length; index++) {
      const item = previousItems[index];
      const id = this.identityOf(item);
      if (!nextIndex.has(id)) removedItems[removedItems.length] = item;
    }
    this.currentItems = [...items];
    this.newItems = newItems;
    this.removedItems = removedItems;
    this.updatedItems = updatedItems;
    this.reindex(this.currentIndex, this.currentItems);
    this.reindex(this.newIndex, this.newItems);
    this.reindex(this.removedIndex, this.removedItems);
  }
  reindex(index, items) {
    index.clear();
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      index.set(this.identityOf(item), { item, index: itemIndex });
    }
  }
};

// ../../packages/jit/src/factories/watch.ts
function watch(schema, options) {
  return compileWatch(unwrapSchema(schema), options);
}
function watchedList(_schema, initialItems = [], options = {}) {
  if (options.key) {
    return new KeyedWatchedList(initialItems, {
      ...options,
      key: options.key
    });
  }
  return new WatchedList(initialItems, options);
}

// ../../packages/jit/src/factories/coerce.ts
function flagged(schema) {
  return createBuilder({ ...schema, def: { ...schema.def, coerce: true } });
}
var nativeCoercions = {
  string() {
    return flagged(string().schema);
  },
  number() {
    return flagged(number2().schema);
  },
  boolean() {
    return flagged(boolean2().schema);
  },
  bigint() {
    return flagged(bigint2().schema);
  },
  date() {
    return flagged(date2().schema);
  }
};

// ../../packages/jit/src/factories/wrappers/wrappers.ts
function optional2(schema) {
  return /* @__PURE__ */ createBuilder(optional(unwrapSchema(schema)));
}
function nullable2(schema) {
  return /* @__PURE__ */ createBuilder(nullable(unwrapSchema(schema)));
}
function nullish2(schema) {
  return /* @__PURE__ */ createBuilder(nullish(unwrapSchema(schema)));
}
function readonly2(schema) {
  return /* @__PURE__ */ createBuilder(readonly(unwrapSchema(schema)));
}
function promise2(schema) {
  return /* @__PURE__ */ createBuilder(promise(unwrapSchema(schema)));
}
function defaultTo2(schema, defaultValue) {
  return /* @__PURE__ */ createBuilder(defaultTo(unwrapSchema(schema), defaultValue));
}
function brand2(schema, brandName) {
  return /* @__PURE__ */ createBuilder(brand(unwrapSchema(schema), brandName));
}
function pipe2(schema, transform3) {
  return /* @__PURE__ */ createBuilder(pipe(unwrapSchema(schema), transform3));
}
function refine2(schema, predicate, options) {
  return /* @__PURE__ */ createBuilder(refine(unwrapSchema(schema), predicate, options));
}
function coerceWith(schema, coercer) {
  return /* @__PURE__ */ createBuilder(coerce(unwrapSchema(schema), coercer));
}
var coerce2 = Object.assign(coerceWith, nativeCoercions);

// ../../packages/jit/src/define.ts
var JIT = {
  ...factories_exports,
  validate: validate2,
  equal: equal2,
  clone: clone2,
  diff: diff2,
  format: format2,
  hash: hash3,
  json: json3
};
function validate2(schema) {
  const unwrapped = unwrapSchema(schema);
  return Object.freeze({
    is: () => validatorStep2(unwrapped, "is"),
    parse: () => validatorStep2(unwrapped, "parse"),
    safeParse: () => validatorStep2(unwrapped, "safeParse"),
    parseAsync: () => validatorStep2(unwrapped, "parseAsync"),
    safeParseAsync: () => validatorStep2(unwrapped, "safeParseAsync")
  });
}
function equal2(schema) {
  return operationStub(schema, "equal");
}
function clone2(schema) {
  return operationStub(schema, "clone");
}
function diff2(schema) {
  return operationStub(schema, "diff");
}
function hash3(schema) {
  return operationStub(schema, "hash");
}
function format2(schema) {
  return operationStub(schema, "format");
}
function json3(schema) {
  if (schema === void 0) return json2();
  const unwrapped = unwrapSchema(schema);
  return Object.freeze({
    stringify: () => operationStep(unwrapped, "stringify"),
    parse: () => operationStep(unwrapped, "fromJSON")
  });
}
function validatorStep2(schema, op) {
  return {
    compile() {
      return createAotStub(schema, { kind: "validate", op }, { kind: "validator", schema, op });
    }
  };
}
function operationStep(schema, op) {
  return {
    compile() {
      return operationStub(schema, op);
    }
  };
}
function operationStub(schema, op) {
  const unwrapped = unwrapSchema(schema);
  return createAotStub(unwrapped, { kind: "operation", op }, { kind: "operation", schema: unwrapped, op });
}
function createAotStub(schema, operation, artifact) {
  const descriptor = {
    artifactId: `${operation.kind}:${"op" in operation ? operation.op : "query"}`,
    schemaId: schema.type,
    operation
  };
  const stub = function aotArtifactStub() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated function instead."
    );
  };
  Object.defineProperties(stub, {
    compile: {
      enumerable: false,
      value: () => stub
    },
    [AOT_ARTIFACT]: {
      enumerable: false,
      value: descriptor
    }
  });
  registerArtifact(stub, artifact);
  return stub;
}

// lib/lab/compiler/entry.ts
function compileBindings(bindings, options) {
  resetVirtualFiles();
  const schemas = {};
  const typeSchemas = {};
  const functions = {};
  for (const [name, value] of Object.entries(bindings)) {
    if (isSchema(value)) {
      if (value.__jitAot === "grouped") schemas[name] = value;
      else typeSchemas[name] = value;
    } else if (getArtifact(value) !== void 0) {
      functions[name] = value;
    }
  }
  const result = generate({
    schemas,
    typeSchemas,
    functions,
    outDir: "/jit-lab",
    clean: true,
    format: options.format
  });
  return {
    files: result.files.map((path) => ({
      path: outputName(basename(path), options.fileName),
      source: readVirtualFile(path)
    })),
    skipped: result.skipped
  };
}
function isSchema(value) {
  if (value === null || typeof value !== "object") return false;
  const candidate = value;
  return typeof candidate.schema?.type === "string" || typeof candidate.type === "string";
}
function outputName(generated, requested) {
  const base = requested.replace(/\.(?:d\.)?(?:ts|cts|mts|js|cjs|mjs)$/, "");
  if (generated === "index.d.ts") return `${base}.d.ts`;
  if (generated === "index.d.cts") return `${base}.d.cts`;
  const extension = generated.slice("index".length);
  return `${base}${extension}`;
}
export {
  JIT,
  compileBindings
};
