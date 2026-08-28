var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../packages/jit/src/runtime/artifact-registry.ts
var REGISTRY = /* @__PURE__ */ new WeakMap();
function registerArtifact(value, artifact) {
  REGISTRY.set(value, artifact);
}
function getArtifact(value) {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return void 0;
  return REGISTRY.get(value);
}
function setClassMutationArtifact(value, mutation) {
  const artifact = REGISTRY.get(value);
  if (artifact?.kind !== "class") return;
  REGISTRY.set(value, { ...artifact, mutation });
}

// ../../packages/jit/src/aot/classify.ts
function classifyDeclarations(bindings) {
  const artifacts = {};
  const groups = {};
  const schemas = {};
  for (const name of Object.keys(bindings)) {
    const value = bindings[name];
    const group = readArtifactGroup(value);
    if (group) groups[name] = group;
    else if (getArtifact(value) !== void 0) artifacts[name] = value;
    else if (isSchemaInput(value)) schemas[name] = value;
  }
  return { artifacts, groups, schemas };
}
function isSchemaInput(candidate) {
  if (candidate === null || typeof candidate !== "object") return false;
  const value = candidate;
  if (value.schema && typeof value.schema === "object" && typeof value.schema.type === "string") return true;
  return typeof value.type === "string" && value.def !== void 0;
}
function readArtifactGroup(candidate) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return void 0;
  if (getArtifact(candidate) !== void 0 || isSchemaInput(candidate)) return void 0;
  const prototype = Object.getPrototypeOf(candidate);
  if (prototype !== Object.prototype && prototype !== null) return void 0;
  const group = candidate;
  const keys = Object.keys(group);
  if (keys.length === 0 || !keys.some((key) => getArtifact(group[key]) !== void 0)) return void 0;
  return group;
}

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
function mkdirSync(_path, _options) {
  return void 0;
}
function readdirSync(path) {
  const prefix = `${normalize(path)}/`;
  const names = /* @__PURE__ */ new Set();
  for (const file2 of files.keys()) {
    if (!file2.startsWith(prefix)) continue;
    const rest = file2.slice(prefix.length);
    const slash = rest.indexOf("/");
    names.add(slash === -1 ? rest : rest.slice(0, slash));
  }
  return [...names];
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
function relative(from3, to) {
  const left = resolve(from3).split("/").filter(Boolean);
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
var AccessDeniedError = class extends JITError {
  constructor(action, field, reason, ruleId) {
    super("ACCESS_DENIED", `Access denied for action ${JSON.stringify(action)}`);
    this.name = "AccessDeniedError";
    this.action = action;
    this.field = field;
    this.reason = reason;
    this.ruleId = ruleId;
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
function key_access(key, isOptional) {
  return typeof key !== "string" ? "" : isValidIdentifier(key) ? `${isOptional ? "?." : isQuoted(key) ? "" : "."}${isQuoted(key) ? `[${key.startsWith('"') && key.endsWith('"') ? key : `"${key}"`}]` : key}` : `${isOptional ? "?." : ""}[${parseKey(key)}]`;
}
function index_accessor(index2, isOptional) {
  const safe = isOptional ? "?." : "";
  return typeof index2 !== "number" ? "" : `${safe}[${index2}]`;
}
function join_path(path, isOptional) {
  return path.reduce((xs, k, i) => {
    return i === 0 ? `${k}` : typeof k === "number" ? `${xs}${index_accessor(k, isOptional)}` : `${xs}${key_access(k, isOptional)}`;
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
var email = /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
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
  when: "when",
  runtimeType: "runtimeType"
};
var TypeNames = utils_exports.Object_keys(TypeName);

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

// ../../packages/jit/src/compiler/resolvers/resolve-wrappers.ts
function resolveWrappers(schema) {
  let current = schema;
  let optional3 = false;
  let nullable3 = false;
  let readonly3 = false;
  while (true) {
    if (current.type === TypeName.optional) {
      optional3 = true;
      current = innerType(current);
      continue;
    }
    if (current.type === TypeName.nullable) {
      nullable3 = true;
      current = innerType(current);
      continue;
    }
    if (current.type === TypeName.nullish) {
      optional3 = true;
      nullable3 = true;
      current = innerType(current);
      continue;
    }
    if (current.type === TypeName.readonly) {
      readonly3 = true;
      current = innerType(current);
      continue;
    }
    if (current.type === TypeName.default || current.type === TypeName.brand || current.type === TypeName.transform || current.type === TypeName.pipe || current.type === TypeName.refine || current.type === TypeName.coerce) {
      current = innerType(current);
      continue;
    }
    if (current.type === TypeName.runtimeType) {
      current = innerType(current);
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
    readonly: readonly3
  };
}
function innerType(schema) {
  return schema.def.innerType;
}

// ../../packages/jit/src/compiler/source/access.ts
function emitPropertyAccess(base, key) {
  return `${base}${parse_exports.key_access(key, false)}`;
}
function emitIndexAccess(base, index2) {
  return `${base}[${index2}]`;
}

// ../../packages/jit/src/compiler/projection.ts
function expectProjectionObject(schema, operation) {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object) {
    throw new JITError("UNSUPPORTED_SCHEMA", `${operation} requires an object schema`);
  }
  return base;
}
function buildProjectionTree(schema, paths, operation) {
  const object2 = expectProjectionObject(schema, operation);
  if (paths.length === 0) {
    throw new JITError("UNSUPPORTED_SCHEMA", `${operation} requires at least one field`);
  }
  const groups = /* @__PURE__ */ new Map();
  for (const path of paths) {
    const dot = path.indexOf(".");
    const head = dot === -1 ? path : path.slice(0, dot);
    const rest = dot === -1 ? void 0 : path.slice(dot + 1);
    const group = groups.get(head);
    if (group === void 0) groups.set(head, rest === void 0 ? [] : [rest]);
    else if (rest !== void 0) group.push(rest);
  }
  const nodes = [];
  const canonical2 = [];
  const props = {};
  for (const [key, rest] of groups) {
    const field = object2.def.props[key];
    if (field === void 0) {
      throw new JITError("UNSUPPORTED_SCHEMA", `${operation} selects "${key}", which the schema does not declare`);
    }
    if (rest.length === 0) {
      nodes.push(Object.freeze({ key, schema: field }));
      canonical2.push(key);
      props[key] = field;
      continue;
    }
    const children2 = buildProjectionTree(field, rest, operation);
    nodes.push(Object.freeze({ key, schema: field, children: children2 }));
    for (const path of children2.paths) canonical2.push(`${key}.${path}`);
    props[key] = rewrap(field, children2.schema);
  }
  return Object.freeze({
    paths: Object.freeze(canonical2),
    nodes: Object.freeze(nodes),
    // The selection as a schema of its own, so `equal`, `hash`, `clone` and
    // every other emitter can consume it without learning what a projection is.
    //
    // Unknown keys and a catchall are deliberately dropped: a projection is
    // exactly the fields it names, and inheriting either would let an emitter
    // reach a field the caller excluded. Object-level checks go too — this
    // describes a shape, it does not validate one.
    schema: createSchema(
      TypeName.object,
      { props, unknownKeys: "strip", catchall: void 0, checks: [] },
      object2.annotations
    )
  });
}
function rewrap(field, narrowed) {
  const { optional: optional3, nullable: nullable3, readonly: readonly3 } = resolveWrappers(field);
  let result = narrowed;
  if (nullable3) result = nullable(result);
  if (optional3) result = optional(result);
  if (readonly3) result = readonly(result);
  return result;
}
function emitProjectionLiteral(tree, source) {
  const parts = tree.nodes.map((node) => {
    const access2 = emitPropertyAccess(source, node.key);
    if (node.children === void 0) return `${JSON.stringify(node.key)}: ${access2}`;
    const { optional: optional3, nullable: nullable3 } = resolveWrappers(node.schema);
    const nested = emitProjectionLiteral(node.children, access2);
    if (!optional3 && !nullable3) return `${JSON.stringify(node.key)}: ${nested}`;
    return `${JSON.stringify(node.key)}: ${access2} == null ? ${access2} : ${nested}`;
  });
  return `{ ${parts.join(", ")} }`;
}
function projectionCacheKey(tree) {
  return tree.paths.join(",");
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

// ../../packages/jit/src/compiler/source/query-condition.ts
function emitQueryConditionSource(condition, context) {
  if (condition.kind === "logical") {
    const operator = condition.op === "and" ? "&&" : "||";
    const left = emitQueryConditionSource(condition.left, context);
    const right = emitQueryConditionSource(condition.right, context);
    return `(${left} ${operator} ${right})`;
  }
  if (condition.kind === "not") return `!(${emitQueryConditionSource(condition.inner, context)})`;
  const operators = { eq: "===", neq: "!==", gt: ">", gte: ">=", lt: "<", lte: "<=" };
  return `${emitQueryValueSource(condition.left, context)} ${operators[condition.op]} ${emitQueryValueSource(condition.right, context)}`;
}
function emitQueryValueSource(value, context) {
  if (value.kind === "field") return context.fieldAccess?.(value.key) ?? emitPropertyAccess(context.fieldBase, value.key);
  if (value.kind === "param") return context.paramAccess?.(value.name) ?? emitPropertyAccess(context.paramBase, value.name);
  if (value.kind === "literal") return emitLiteral(value.value);
  return value.name;
}

// ../../packages/jit/src/compiler/access.ts
var ACCESS_ABILITIES = /* @__PURE__ */ new WeakMap();
function registerAccessAbility(ability, descriptor, actor) {
  ACCESS_ABILITIES.set(ability, Object.freeze({ descriptor, actor }));
}
function getAccessAbility(ability) {
  return ACCESS_ABILITIES.get(ability);
}
function resolveAccessContext(value, actor) {
  const ability = getAccessAbility(value);
  if (ability !== void 0) return ability;
  const artifact = getArtifact(value);
  return artifact?.kind === "access-plan" ? Object.freeze({ descriptor: artifact.descriptor, actor }) : void 0;
}
function resolveAccessDescriptor(subject, actor, rules2) {
  const object2 = expectProjectionObject(subject, "JIT.access()");
  const actions = [];
  for (const rule of rules2) {
    if (!actions.includes(rule.action)) actions.push(rule.action);
    for (const field of rule.fields ?? []) {
      if (object2.def.props[field] === void 0) {
        throw new JITError(
          "UNSUPPORTED_SCHEMA",
          `JIT.access() names field "${field}", which the subject does not declare`
        );
      }
    }
  }
  const normalized = rules2.map(
    (rule) => rule.fields === void 0 ? rule : Object.freeze({ ...rule, fields: Object.freeze([...new Set(rule.fields)]) })
  );
  const actionPlans = actions.map((action) => {
    const allow = foldDominatedRules(normalized.filter((rule) => rule.effect === "can" && rule.action === action));
    const deny = foldDominatedRules(normalized.filter((rule) => rule.effect === "cannot" && rule.action === action));
    const subjectPaths = /* @__PURE__ */ new Set();
    const actorPaths = /* @__PURE__ */ new Set();
    for (const rule of [...allow, ...deny]) collectConditionPaths(rule.condition, subjectPaths, actorPaths);
    return Object.freeze({
      action,
      allow: Object.freeze(allow),
      deny: Object.freeze(deny),
      subjectPaths: Object.freeze([...subjectPaths]),
      actorPaths: Object.freeze([...actorPaths])
    });
  });
  return Object.freeze({
    subject,
    actor,
    rules: Object.freeze(normalized),
    actions: Object.freeze(actions),
    actionPlans: Object.freeze(actionPlans)
  });
}
function foldDominatedRules(rules2) {
  const unconditional = rules2.find((rule) => rule.condition === void 0 && rule.fields === void 0);
  return unconditional === void 0 ? [...rules2] : [unconditional];
}
function collectConditionPaths(condition, subject, actor) {
  if (condition === void 0) return;
  if (condition.kind === "logical") {
    collectConditionPaths(condition.left, subject, actor);
    collectConditionPaths(condition.right, subject, actor);
    return;
  }
  if (condition.kind === "not") {
    collectConditionPaths(condition.inner, subject, actor);
    return;
  }
  for (const value of [condition.left, condition.right]) {
    if (value.kind === "field") subject.add(value.key);
    else if (value.kind === "param") actor.add(value.name);
  }
}
function actionPlan(descriptor, action) {
  return descriptor.actionPlans.find((plan) => plan.action === action);
}
function emitAccessSource(descriptor) {
  const writer = new CodeWriter();
  writer.line("function ability(actor) {");
  writer.indent(() => {
    writer.line("function can(action, subject, field) {");
    writer.indent(() => {
      writer.line("switch (action) {");
      writer.indent(() => {
        for (const action of descriptor.actions) {
          writer.line(`case ${JSON.stringify(action)}:`);
          writer.indent(() => writer.line(`return ${emitAction(descriptor, action)};`));
        }
        writer.line("default:");
        writer.indent(() => writer.line("return false;"));
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("function explain(action, subject, field) {");
    writer.indent(() => {
      writer.line("switch (action) {");
      writer.indent(() => {
        for (const action of descriptor.actions) emitExplainCase(writer, descriptor, action);
        writer.line("default:");
        writer.indent(() => writer.line('return { allowed: false, reason: "default-deny" };'));
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("function assert(action, subject, field) {");
    writer.indent(() => {
      writer.line("if (can(action, subject, field)) return subject;");
      writer.line("const detail = explain(action, subject, field);");
      writer.line("throw new __AccessDeniedError(action, field, detail.reason, detail.ruleId);");
    });
    writer.line("}");
    writer.line("function fields(action, subject) {");
    writer.indent(() => {
      writer.line("if (subject === undefined) {");
      writer.indent(() => {
        writer.line("switch (action) {");
        writer.indent(() => {
          const object3 = expectProjectionObject(descriptor.subject, "JIT.access()");
          const allFields = Object.keys(object3.def.props);
          for (const action of descriptor.actions) {
            const fields = unconditionalFields(descriptor, action) ?? allFields;
            writer.line(`case ${JSON.stringify(action)}:`);
            writer.indent(() => writer.line(`return ${JSON.stringify(fields)};`));
          }
          writer.line("default:");
          writer.indent(() => writer.line("return [];"));
        });
        writer.line("}");
      });
      writer.line("}");
      writer.line("const out = [];");
      writer.line("let j = 0;");
      const object2 = expectProjectionObject(descriptor.subject, "JIT.access()");
      for (const field of Object.keys(object2.def.props)) {
        writer.line(`if (can(action, subject, ${JSON.stringify(field)})) out[j++] = ${JSON.stringify(field)};`);
      }
      writer.line("return out;");
    });
    writer.line("}");
    writer.line(
      "return { can: can, cannot: (action, subject, field) => !can(action, subject, field), assert: assert, explain: explain, fields: fields };"
    );
  });
  writer.line("}");
  return writer.toString();
}
function emitExplainCase(writer, descriptor, action) {
  const plan = actionPlan(descriptor, action);
  const cans = plan?.allow ?? [];
  const cannots = plan?.deny ?? [];
  writer.line(`case ${JSON.stringify(action)}:`);
  writer.indent(() => {
    for (const rule of cannots) {
      writer.line(`if (${emitRule(rule, "cannot")}) return ${diagnosticLiteral(rule)};`);
    }
    for (const rule of cans) {
      writer.line(`if (${emitRule(rule, "can")}) return { allowed: true };`);
    }
    writer.line('return { allowed: false, reason: "default-deny" };');
  });
}
function diagnosticLiteral(rule) {
  const entries = ["allowed: false"];
  entries.push(`reason: ${JSON.stringify(rule.metadata?.reason ?? "denied-by-rule")}`);
  if (rule.metadata?.id !== void 0) entries.push(`ruleId: ${JSON.stringify(rule.metadata.id)}`);
  entries.push("matchedProhibition: true");
  return `{ ${entries.join(", ")} }`;
}
function emitAction(descriptor, action) {
  return emitAccessActionExpression(descriptor, action, "subject", "field", "actor");
}
function emitAccessActionExpression(descriptor, action, subject, field, actor) {
  const plan = actionPlan(descriptor, action);
  const cans = plan?.allow ?? [];
  const cannots = plan?.deny ?? [];
  if (cans.length === 0) return "false";
  const allowed = joinOr(cans.map((rule) => emitRuleAt(rule, "can", subject, field, actor)));
  if (cannots.length === 0) return allowed;
  const denied = joinOr(cannots.map((rule) => emitRuleAt(rule, "cannot", subject, field, actor)));
  if (allowed === "true") return `!(${denied})`;
  return `(${allowed}) && !(${denied})`;
}
function joinOr(parts) {
  if (parts.includes("true")) return "true";
  const meaningful = parts.filter((part) => part !== "false");
  if (meaningful.length === 0) return "false";
  return meaningful.length === 1 ? meaningful[0] : meaningful.map((part) => `(${part})`).join(" || ");
}
function emitRule(rule, effect) {
  return emitRuleAt(rule, effect, "subject", "field", "actor");
}
function emitRuleAt(rule, effect, subject, field, actor) {
  const condition = rule.condition === void 0 ? "true" : emitConditionAt(rule.condition, subject, actor);
  if (rule.fields === void 0) return condition;
  const names = rule.fields.map((name) => `${field} === ${JSON.stringify(name)}`).join(" || ");
  const guard = effect === "can" ? `(${field} === undefined || ${names})` : `(${field} !== undefined && (${names}))`;
  return condition === "true" ? guard : `${guard} && (${condition})`;
}
function emitConditionAt(condition, subject, actor) {
  return emitQueryConditionSource(condition, { fieldBase: subject, paramBase: actor });
}
function accessCacheKey(descriptor) {
  return `access:${JSON.stringify(descriptor.rules)}`;
}
function compileAccess(descriptor, options) {
  const template = getCompileCached(
    descriptor.subject,
    accessCacheKey(descriptor),
    () => {
      const source = emitAccessSource(descriptor);
      return { source, create: globalThis.Function("__AccessDeniedError", `return ${source};`) };
    },
    options
  );
  const compiled = template.create(AccessDeniedError);
  registerArtifact(compiled, { kind: "access-plan", schema: descriptor.subject, descriptor });
  return compiled;
}
function lowerAccessToQueryCondition(context, action, bindingOffset) {
  const plan = actionPlan(context.descriptor, action);
  const cans = plan?.allow ?? [];
  const cannots = (plan?.deny ?? []).filter((rule) => rule.fields === void 0);
  if (cans.length === 0 || cannots.some((rule) => rule.condition === void 0)) {
    return Object.freeze({ kind: "deny", bindings: Object.freeze([]) });
  }
  const allowConditions = cans.map((rule) => rule.condition);
  const denyConditions = cannots.map((rule) => rule.condition).filter(isCondition);
  const allowAlways = allowConditions.some((condition2) => condition2 === void 0);
  if (allowAlways && denyConditions.length === 0) {
    return Object.freeze({ kind: "allow", bindings: Object.freeze([]) });
  }
  let semantic = allowAlways ? truth(true) : joinConditions("or", allowConditions.filter(isCondition));
  if (denyConditions.length > 0) {
    semantic = {
      kind: "logical",
      op: "and",
      left: semantic,
      right: { kind: "not", inner: joinConditions("or", denyConditions) }
    };
  }
  const values = [];
  const condition = bindActorRefs(semantic, context.actor, bindingOffset, values);
  return Object.freeze({ kind: "condition", condition, bindings: Object.freeze(values) });
}
function compileAccessMutationGuard(context, action) {
  const source = emitAccessMutationGuardSource(context.descriptor, action);
  return globalThis.Function("actor", "__AccessDeniedError", `return ${source};`)(context.actor, AccessDeniedError);
}
function emitAccessMutationGuardSource(descriptor, action) {
  const object2 = expectProjectionObject(descriptor.subject, "authorized mutation");
  const writer = new CodeWriter();
  writer.line("function authorizeMutation(subject, patch) {");
  writer.indent(() => {
    for (const field of Object.keys(object2.def.props)) {
      const patchValue = emitPropertyAccess("patch", field);
      const check = emitAccessActionExpression(descriptor, action, "subject", JSON.stringify(field), "actor");
      if (check === "true") continue;
      const denied = `throw new __AccessDeniedError(${JSON.stringify(action)}, ${JSON.stringify(field)}, "field-denied")`;
      writer.line(`if (${patchValue} !== undefined${check === "false" ? "" : ` && !(${check})`}) ${denied};`);
    }
  });
  writer.line("}");
  return writer.toString();
}
function isCondition(value) {
  return value !== void 0;
}
function joinConditions(op, values) {
  if (values.length === 0) return truth(op === "and");
  let result = values[0];
  for (let index2 = 1; index2 < values.length; index2++) {
    result = { kind: "logical", op, left: result, right: values[index2] };
  }
  return result;
}
function truth(value) {
  return {
    kind: "compare",
    op: "eq",
    left: { kind: "literal", value: true },
    right: { kind: "literal", value }
  };
}
function bindActorRefs(condition, actor, bindingOffset, bindings) {
  if (condition.kind === "logical") {
    return {
      ...condition,
      left: bindActorRefs(condition.left, actor, bindingOffset, bindings),
      right: bindActorRefs(condition.right, actor, bindingOffset, bindings)
    };
  }
  if (condition.kind === "not") {
    return { ...condition, inner: bindActorRefs(condition.inner, actor, bindingOffset, bindings) };
  }
  return {
    ...condition,
    left: bindActorValue(condition.left, actor, bindingOffset, bindings),
    right: bindActorValue(condition.right, actor, bindingOffset, bindings)
  };
}
function bindActorValue(value, actor, bindingOffset, bindings) {
  if (value.kind !== "param") return value;
  const record2 = actor;
  const name = `__q${bindingOffset + bindings.length}`;
  bindings.push(record2?.[value.name]);
  return { kind: "binding", name };
}
function unconditionalFields(descriptor, action) {
  const cans = descriptor.rules.filter(
    (rule) => rule.effect === "can" && rule.action === action && rule.condition === void 0
  );
  if (cans.length === 0) return [];
  if (cans.some((rule) => rule.fields === void 0)) {
    const denied = descriptor.rules.filter(
      (rule) => rule.effect === "cannot" && rule.action === action && rule.condition === void 0
    );
    if (denied.length === 0) return void 0;
    const object2 = expectProjectionObject(descriptor.subject, "JIT.access()");
    const blocked = new Set(denied.flatMap((rule) => rule.fields ?? Object.keys(object2.def.props)));
    return Object.keys(object2.def.props).filter((field) => !blocked.has(field));
  }
  const allowed = new Set(cans.flatMap((rule) => rule.fields ?? []));
  for (const rule of descriptor.rules) {
    if (rule.effect !== "cannot" || rule.action !== action || rule.condition !== void 0) continue;
    for (const field of rule.fields ?? allowed) allowed.delete(field);
  }
  return [...allowed];
}
function accessProjectionFields(descriptor, action) {
  const plan = actionPlan(descriptor, action);
  if (plan === void 0 || plan.allow.length === 0) return [];
  const object2 = expectProjectionObject(descriptor.subject, "authorized query projection");
  const all = Object.keys(object2.def.props);
  const allowed = new Set(
    all.filter(
      (field) => plan.allow.some(
        (rule) => rule.condition === void 0 && (rule.fields === void 0 || rule.fields.includes(field))
      ) || plan.allow.every((rule) => rule.fields === void 0 || rule.fields.includes(field))
    )
  );
  for (const rule of plan.deny) {
    if (rule.fields === void 0) continue;
    for (const field of rule.fields) allowed.delete(field);
  }
  return allowed.size === all.length ? void 0 : all.filter((field) => allowed.has(field));
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
function loadIndex(base, index2) {
  return { kind: "load_index", base, index: index2 };
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
function forRange(index2, length, body) {
  return { kind: "for_range", index: index2, length, body };
}
function forOf(item, iterable, body) {
  return { kind: "for_of", item, iterable, body };
}
function append(target, cursor, value) {
  return { kind: "append", target, cursor, value };
}
function sortByKey(target, ordering) {
  return { kind: "sort_by_key", target, ordering };
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
      const compute = compileUncachedHash(schema);
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
function compileUncachedHash(schema) {
  return globalThis.Function(
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

// ../../packages/jit/src/compiler/cache-key.ts
var SEPARATOR = "";
function resolveCacheKeyDescriptor(schema, paths, form) {
  const tree = buildProjectionTree(schema, paths, "JIT.cacheKey()");
  const parts = tree.paths.map((path) => {
    const leaf = leafSchema(tree, path);
    const wrappers = resolveWrappers(leaf);
    return Object.freeze({
      path,
      segments: Object.freeze(path.split(".")),
      kind: partKind(wrappers.base),
      schema: leaf,
      nullish: wrappers.optional || wrappers.nullable
    });
  });
  return Object.freeze({ tree, form, parts: Object.freeze(parts) });
}
function partKind(base) {
  switch (base.type) {
    case TypeName.string:
      return "string";
    case TypeName.number:
      return "number";
    case TypeName.bigint:
      return "bigint";
    case TypeName.boolean:
      return "boolean";
    case TypeName.date:
      return "date";
    case TypeName.literal:
    case TypeName.enum:
      return "string";
    default:
      return "structural";
  }
}
function emitCacheKeySource(descriptor) {
  return descriptor.form === "string" ? emitStringKey(descriptor) : emitHashKey(descriptor);
}
function emitStringKey(descriptor) {
  const writer = new CodeWriter();
  writer.line("function cacheKey(value) {");
  writer.indent(() => {
    const parts = descriptor.parts.map((part, index2) => {
      const read = readPath("value", part);
      const text = toText(part, read);
      return index2 === 0 ? text : `${JSON.stringify(SEPARATOR)} + ${text}`;
    });
    writer.line(`return ${parts.join(" + ")};`);
  });
  writer.line("}");
  return writer.toString();
}
function toText(part, read) {
  const body = textExpression(part, read);
  return part.nullish ? `(${read} == null ? "\\u0000" : ${body})` : body;
}
function textExpression(part, read) {
  switch (part.kind) {
    case "string":
      return read;
    case "number":
    case "boolean":
      return `${read}`;
    case "bigint":
      return `${read}`;
    case "date":
      return `${read}.getTime()`;
    default:
      return `__cacheKeyHash(${read})`;
  }
}
function emitHashKey(descriptor) {
  const writer = new CodeWriter();
  writer.line("function cacheKey(value) {");
  writer.indent(() => {
    writer.line("let h = 23;");
    descriptor.parts.forEach((part, index2) => {
      const read = readPath("value", part);
      const term = hashExpression(part, read, index2);
      writer.line(`h = ((h << 5) - h + ${term}) | 0;`);
    });
    writer.line("return h;");
  });
  writer.line("}");
  return writer.toString();
}
function hashExpression(part, read, index2) {
  const body = hashTerm(part, read, index2);
  return part.nullish ? `(${read} == null ? 0 : ${body})` : body;
}
function hashTerm(part, read, index2) {
  switch (part.kind) {
    case "string":
      return `__hashString(${read})`;
    case "number":
      return `(${read} | 0)`;
    case "boolean":
      return `(${read} ? 1 : 0)`;
    case "bigint":
      return `(Number(${read} & 0xffffffffn) | 0)`;
    case "date":
      return `(${read}.getTime() | 0)`;
    default:
      return `__cacheKeyHash${index2}(${read})`;
  }
}
function readPath(source, part) {
  return part.segments.reduce(
    (carrier, segment, index2) => index2 === 0 ? emitPropertyAccess(carrier, segment) : `${carrier}?.${optionalSegment(segment)}`,
    source
  );
}
function optionalSegment(segment) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment) ? segment : `[${JSON.stringify(segment)}]`;
}
function leafSchema(tree, path) {
  const dot = path.indexOf(".");
  const head = dot === -1 ? path : path.slice(0, dot);
  const node = tree.nodes.find((candidate) => candidate.key === head);
  if (dot === -1) return node.schema;
  return leafSchema(node.children, path.slice(dot + 1));
}
function cacheKeyHashBindings(descriptor) {
  const bindings = [];
  descriptor.parts.forEach((part, index2) => {
    if (part.kind !== "structural") return;
    bindings.push({
      name: descriptor.form === "string" ? "__cacheKeyHash" : `__cacheKeyHash${index2}`,
      source: emitHashSource(part.schema)
    });
  });
  return bindings;
}
function cacheKeyCacheKey(descriptor) {
  return `cacheKey:${descriptor.form}:${projectionCacheKey(descriptor.tree)}`;
}
function compileCacheKey(schema, descriptor, hashHelpers, options) {
  const bindings = cacheKeyHashBindings(descriptor);
  const helperNames = Object.keys(hashHelpers);
  if (descriptor.form === "string" && bindings.length > 1) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      "JIT.cacheKey.string() supports at most one structural field; select scalar fields, or use JIT.cacheKey.hash()"
    );
  }
  const template = getCompileCached(
    schema,
    cacheKeyCacheKey(descriptor),
    () => {
      const source = emitCacheKeySource(descriptor);
      return {
        source,
        create: globalThis.Function(...helperNames, ...bindings.map((binding) => binding.name), `return ${source};`)
      };
    },
    options
  );
  const compiled = template.create(
    ...helperNames.map((name) => hashHelpers[name]),
    ...bindings.map(
      (binding) => globalThis.Function(...helperNames, `return ${binding.source};`)(...helperNames.map((name) => hashHelpers[name]))
    )
  );
  registerArtifact(compiled, { kind: "cache-key-plan", schema, descriptor });
  return compiled;
}

// ../../packages/jit/src/compiler/canonical.ts
function emitCanonicalSource(schema, name = "canonical") {
  const object2 = expectProjectionObject(schema, "JIT.canonical()");
  const nested = /* @__PURE__ */ new Map();
  const root = new CodeWriter();
  emitCanonicalFunction(root, object2, name, nested);
  const helpers = [...nested.values()].filter((source) => source !== "");
  return `(function () {
${helpers.join("\n")}
${root.toString()}
return ${name};
})()`;
}
function emitCanonicalFunction(writer, object2, name, nested) {
  const keys = Object.keys(object2.def.props);
  const children2 = /* @__PURE__ */ new Map();
  for (const key of keys) {
    const base = resolveWrappers(object2.def.props[key]).base;
    if (base.type === TypeName.object) {
      children2.set(key, childName(name, key, base, nested));
    }
  }
  writer.line(`function ${name}(value) {`);
  writer.indent(() => {
    writer.line('if (value === null || typeof value !== "object") return value;');
    writer.line("const keys = Object.keys(value);");
    const ordered = keys.map((key, index2) => `keys[${index2}] === ${JSON.stringify(key)}`).join(" && ");
    writer.line(`let canonical = keys.length === ${keys.length}${ordered === "" ? "" : ` && ${ordered}`};`);
    for (const [key, child] of children2) {
      const read = emitPropertyAccess("value", key);
      const local = `next_${key.replace(/[^A-Za-z0-9_$]/g, "_")}`;
      writer.line(`const ${local} = ${child}(${read});`);
      writer.line(`if (${local} !== ${read}) canonical = false;`);
    }
    writer.line("if (canonical) return value;");
    writer.line("return {");
    writer.indent(() => {
      for (const key of keys) {
        const child = children2.get(key);
        const read = emitPropertyAccess("value", key);
        const local = `next_${key.replace(/[^A-Za-z0-9_$]/g, "_")}`;
        writer.line(`${JSON.stringify(key)}: ${child === void 0 ? read : local},`);
      }
    });
    writer.line("};");
  });
  writer.line("}");
}
function childName(parent, key, schema, nested) {
  const name = `${parent}_${key.replace(/[^A-Za-z0-9_$]/g, "_")}`;
  if (!nested.has(name)) {
    const writer = new CodeWriter();
    nested.set(name, "");
    emitCanonicalFunction(writer, schema, name, nested);
    nested.set(name, writer.toString());
  }
  return name;
}
function compileCanonical(schema, options) {
  const template = getCompileCached(
    schema,
    "canonical",
    () => {
      const source = emitCanonicalSource(schema);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create();
  registerArtifact(compiled, { kind: "canonical-plan", schema });
  return compiled;
}

// ../../packages/jit/src/runtime/index/build-index.ts
function buildIndex(items, key) {
  const index2 = /* @__PURE__ */ new Map();
  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i];
    index2.set(item[key], item);
  }
  return index2;
}

// ../../packages/jit/src/runtime/index/index-cache.ts
var INDEX_CACHE = /* @__PURE__ */ new WeakMap();
function indexesOf(items) {
  let entry = INDEX_CACHE.get(items);
  if (entry === void 0) {
    entry = { legacyKey: void 0, legacyMap: void 0, plans: void 0 };
    INDEX_CACHE.set(items, entry);
  }
  return entry;
}
function getIndex(items, key) {
  const entry = indexesOf(items);
  if (entry.legacyMap !== void 0 && entry.legacyKey === key) {
    return entry.legacyMap;
  }
  const map4 = buildIndex(items, key);
  entry.legacyKey = key;
  entry.legacyMap = map4;
  return map4;
}
function getCachedIndex(items, cacheKey3, build) {
  const entry = indexesOf(items);
  const plans = entry.plans ?? (entry.plans = /* @__PURE__ */ new Map());
  const cached = plans.get(cacheKey3);
  if (cached !== void 0) return cached;
  const built = build(items);
  plans.set(cacheKey3, built);
  return built;
}

// ../../packages/jit/src/compiler/row-keys.ts
function resolveRowObjectSchema(schema, operation) {
  let base = resolveWrappers(schema).base;
  if (base.type === TypeName.array || base.type === TypeName.set) {
    base = resolveWrappers(base.def.element).base;
  }
  if (base.type === TypeName.runtimeType) {
    base = resolveWrappers(base.def.innerType).base;
  }
  if (base.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${operation} expects an object or collection-of-objects schema`);
  }
  return base;
}
function resolveRowField(object2, key, operation) {
  if (typeof key !== "string" || key.length === 0) {
    throw new JITError("INVALID_OPERATION", `${operation} keys must be non-empty strings`);
  }
  const field = object2.def.props[key];
  if (!field) {
    throw new JITError("INVALID_OPERATION", `${operation} received unknown key ${JSON.stringify(key)}`, {
      path: [key]
    });
  }
  return field;
}
function resolveScalarKeyKind(schema, key, operation) {
  let base = resolveWrappers(schema).base;
  if (base.type === TypeName.runtimeType) {
    base = resolveWrappers(base.def.innerType).base;
  }
  if (base.type === TypeName.date) return "date";
  if (base.type === TypeName.number || base.type === TypeName.int) return "numeric";
  if (base.type === TypeName.union) {
    const options = base.def.options;
    if (options.length > 0) {
      const kinds = options.map((option) => resolveScalarKeyKind(option, key, operation));
      if (kinds.every((kind) => kind === kinds[0])) return kinds[0];
    }
  }
  if (base.type === TypeName.string || base.type === TypeName.bigint || base.type === TypeName.boolean || base.type === TypeName.literal || base.type === TypeName.enum) {
    return "direct";
  }
  throw new JITError(
    "INVALID_OPERATION",
    `${operation} key ${JSON.stringify(key)} must resolve to a statically comparable scalar`,
    { path: [key] }
  );
}
function resolveScalarKeyDomain(schema, key, operation) {
  let base = resolveWrappers(schema).base;
  if (base.type === TypeName.runtimeType) {
    base = resolveWrappers(base.def.innerType).base;
  }
  if (base.type === TypeName.string) return "string";
  if (base.type === TypeName.number || base.type === TypeName.int || base.type === TypeName.nan) return "number";
  if (base.type === TypeName.bigint) return "bigint";
  if (base.type === TypeName.boolean) return "boolean";
  if (base.type === TypeName.date) return "date";
  if (base.type === TypeName.literal) {
    const value = base.def.value;
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "bigint") return "bigint";
    if (typeof value === "boolean") return "boolean";
  }
  if (base.type === TypeName.enum) {
    const domains = new Set(Object.values(base.def.values).map((value) => typeof value));
    if (domains.size === 1) {
      const domain2 = domains.values().next().value;
      if (domain2 === "string" || domain2 === "number") return domain2;
    }
  }
  if (base.type === TypeName.union) {
    const domains = base.def.options.map(
      (option) => resolveScalarKeyDomain(option, key, operation)
    );
    if (domains.length > 0 && domains.every((domain2) => domain2 === domains[0])) return domains[0];
  }
  throw new JITError("INVALID_OPERATION", `${operation} key ${JSON.stringify(key)} has no scalar equality domain`, {
    path: [key]
  });
}
function isNullishField(schema) {
  const resolved = resolveWrappers(schema);
  return resolved.optional || resolved.nullable;
}

// ../../packages/jit/src/compiler/ordering.ts
function resolveOrderingDescriptor(schema, criteria) {
  const object2 = resolveRowObjectSchema(schema, "ordering");
  if (criteria.length === 0) {
    throw new JITError("INVALID_OPERATION", "ordering requires at least one criterion");
  }
  const seen = /* @__PURE__ */ new Set();
  const resolved = criteria.map((criterion) => {
    if (criterion.direction !== "asc" && criterion.direction !== "desc") {
      throw new JITError("INVALID_OPERATION", "ordering direction must be asc or desc");
    }
    const field = resolveRowField(object2, criterion.key, "ordering");
    if (seen.has(criterion.key)) {
      throw new JITError("INVALID_OPERATION", `ordering repeats key ${JSON.stringify(criterion.key)}`, {
        path: [criterion.key]
      });
    }
    seen.add(criterion.key);
    return Object.freeze({
      key: criterion.key,
      direction: criterion.direction,
      valueKind: resolveScalarKeyKind(field, criterion.key, "ordering"),
      nullish: isNullishField(field)
    });
  });
  return Object.freeze({ criteria: Object.freeze(resolved) });
}
function emitOrderingComparatorBody(writer, descriptor, left = "left", right = "right") {
  const last2 = descriptor.criteria.length - 1;
  let terminated = false;
  descriptor.criteria.forEach((criterion, index2) => {
    const suffix = descriptor.criteria.length === 1 ? "" : String(index2);
    const date3 = criterion.valueKind === "date";
    const leftRaw = `left${date3 ? "Raw" : "Value"}${suffix}`;
    const rightRaw = `right${date3 ? "Raw" : "Value"}${suffix}`;
    const leftValue = `leftValue${suffix}`;
    const rightValue = `rightValue${suffix}`;
    const leftPresentWins = criterion.direction === "desc" ? "-1" : "1";
    const rightPresentWins = criterion.direction === "desc" ? "1" : "-1";
    const subtract = criterion.valueKind === "numeric" && index2 === last2;
    const emitCompare2 = () => {
      if (date3) {
        writer.line(`const ${leftValue} = ${leftRaw}.getTime();`);
        writer.line(`const ${rightValue} = ${rightRaw}.getTime();`);
      }
      if (subtract) {
        writer.line(
          criterion.direction === "desc" ? `return ${rightValue} - ${leftValue};` : `return ${leftValue} - ${rightValue};`
        );
        return;
      }
      writer.line(`if (${leftValue} !== ${rightValue}) {`);
      writer.indent(() => {
        writer.line(
          criterion.direction === "desc" ? `return ${leftValue} < ${rightValue} ? 1 : -1;` : `return ${leftValue} < ${rightValue} ? -1 : 1;`
        );
      });
      writer.line("}");
    };
    writer.line(`const ${leftRaw} = ${emitPropertyAccess(left, criterion.key)};`);
    writer.line(`const ${rightRaw} = ${emitPropertyAccess(right, criterion.key)};`);
    if (!criterion.nullish) {
      emitCompare2();
      terminated = subtract;
      return;
    }
    writer.line(`if (${leftRaw} == null || ${rightRaw} == null) {`);
    writer.indent(() => {
      writer.line(`if (${leftRaw} != null) return ${leftPresentWins};`);
      writer.line(`if (${rightRaw} != null) return ${rightPresentWins};`);
    });
    writer.line("} else {");
    writer.indent(emitCompare2);
    writer.line("}");
  });
  if (!terminated) writer.line("return 0;");
}
function emitOrderingComparatorBodySource(descriptor) {
  const writer = new CodeWriter();
  emitOrderingComparatorBody(writer, descriptor);
  return writer.toString();
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
  const literal4 = schema.def.value;
  if (typeof literal4 === "number") {
    return `${value} === ${emitLiteral(literal4)} || (${value} !== ${value} && ${emitLiteral(literal4)} !== ${emitLiteral(literal4)})`;
  }
  return `${value} === ${emitLiteral(literal4)}`;
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
      const index2 = node.index.name;
      writer.line(`for (let ${index2} = 0; ${index2} < ${emitExpr(node.length)}; ${index2}++) {`);
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
      writer.indent(() => emitOrderingComparatorBody(writer, node.ordering));
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
  emitHelpers(writer, program);
  writer.line(`function equal(${left.name}, ${right.name}) {`);
  writer.indent(() => {
    for (const node of program.body) emitNode(writer, node);
  });
  writer.line("}");
  return writer.toString();
}
function emitEqualBody(program) {
  const writer = new CodeWriter();
  emitHelpers(writer, program);
  for (const node of program.body) emitNode(writer, node);
  return writer.toString();
}
function emitHelpers(writer, program) {
  for (const helper of program.helpers ?? []) {
    const [left, right] = helper.program.params;
    writer.line(`function ${helper.name}(${left.name}, ${right.name}) {`);
    writer.indent(() => {
      for (const node of helper.program.body) emitNode(writer, node);
    });
    writer.line("}");
  }
}

// ../../packages/jit/src/compiler/schema-recursion.ts
function resolveLazySchema(schema) {
  let current = schema;
  let guard = 0;
  while (current.type === TypeName.lazy && guard++ < 100) {
    current = current.def.getter();
  }
  return current;
}
function schemaChildren(schema) {
  const current = schema;
  const def = current.def;
  switch (current.type) {
    case TypeName.object:
      return Object.values(def.props ?? {});
    case TypeName.array:
    case TypeName.set:
      return def.element ? [def.element] : [];
    case TypeName.map:
      return [def.key, def.value].filter(Boolean);
    case TypeName.record:
      return def.value ? [def.value] : [];
    case TypeName.tuple:
      return [
        ...def.items ?? [],
        ...def.rest ? [def.rest] : []
      ];
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion:
    case TypeName.intersection:
      return def.options ?? [];
    case TypeName.when:
      return [def.thenType, def.otherwiseType].filter(Boolean);
    case TypeName.codec:
      return [def.input, def.output].filter(Boolean);
    default:
      return def.innerType ? [def.innerType] : [];
  }
}
var RECURSIVE_CACHE = /* @__PURE__ */ new WeakMap();
function findRecursiveSchemas(schema) {
  const cached = RECURSIVE_CACHE.get(schema);
  if (cached !== void 0) return cached;
  const recursive = /* @__PURE__ */ new Set();
  const stack = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  const walk = (node) => {
    const target = resolveLazySchema(node);
    if (stack.has(target)) {
      recursive.add(target);
      return;
    }
    if (seen.has(target)) return;
    seen.add(target);
    stack.add(target);
    for (const child of schemaChildren(target)) walk(child);
    stack.delete(target);
  };
  walk(schema);
  RECURSIVE_CACHE.set(schema, recursive);
  return recursive;
}

// ../../packages/jit/src/compiler/schema-nodes.ts
function buildSchemaNode(schema, buildNode) {
  switch (schema.type) {
    case TypeName.optional:
      return { kind: "guard", optional: true, nullable: false, inner: buildNode(innerType2(schema)) };
    case TypeName.nullable:
      return { kind: "guard", optional: false, nullable: true, inner: buildNode(innerType2(schema)) };
    case TypeName.nullish:
      return { kind: "guard", optional: true, nullable: true, inner: buildNode(innerType2(schema)) };
    case TypeName.default:
    case TypeName.brand:
    case TypeName.transform:
    case TypeName.pipe:
    case TypeName.readonly:
    case TypeName.refine:
    case TypeName.coerce:
      return buildNode(innerType2(schema));
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
        props: Object.keys(props).map((key) => ({
          key,
          schema: props[key],
          value: buildNode(props[key]),
          readonly: resolveWrappers(props[key]).readonly
        }))
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
function innerType2(schema) {
  return schema.def.innerType;
}
function emitGuardTest(optional3, nullable3, source) {
  if (optional3 && nullable3) return `${source} != null`;
  if (optional3) return `${source} !== undefined`;
  return `${source} !== null`;
}
function buildRecursiveProgram(schema, build, makeRef, recursive) {
  const ids = /* @__PURE__ */ new Map();
  const helpers = [];
  const started = /* @__PURE__ */ new Set();
  const idFor = (target) => {
    const existing = ids.get(target);
    if (existing) return existing;
    const id = `r${ids.size + 1}`;
    ids.set(target, id);
    return id;
  };
  const recurse = (child) => {
    const target = resolveLazySchema(child);
    if (!recursive.has(target)) return build(child, recurse);
    const id = idFor(target);
    if (!started.has(target)) {
      started.add(target);
      helpers.push({ id, node: build(target, recurse) });
    }
    return makeRef(id);
  };
  return { body: recurse(schema), helpers };
}
function flattenObjectIntersection(schema) {
  const cached = FLATTENED_INTERSECTIONS.get(schema);
  if (cached !== void 0) return cached.schema;
  const flattened = buildFlattenedIntersection(schema);
  FLATTENED_INTERSECTIONS.set(schema, { schema: flattened });
  return flattened;
}
var FLATTENED_INTERSECTIONS = /* @__PURE__ */ new WeakMap();
function buildFlattenedIntersection(schema) {
  const options = schema.def.options;
  if (!options || options.length === 0) return void 0;
  const props = {};
  for (const option of options) {
    const resolved = resolveLazySchema(option);
    if (resolved.type !== TypeName.object) return void 0;
    const optionProps = resolved.def.props;
    for (const key of Object.keys(optionProps)) props[key] = optionProps[key];
  }
  return createSchema(TypeName.object, { props, unknownKeys: void 0, catchall: void 0, checks: [] });
}

// ../../packages/jit/src/core/hints/hint-merge.ts
function mergeHints(left, right) {
  if (!left) return right ?? {};
  if (!right) return left;
  const collection = mergeCollection(left.collection, right.collection);
  const entity2 = right.entity ?? left.entity;
  const index2 = right.index ?? left.index;
  const order = right.order ?? left.order;
  const compare3 = mergeOptional(left.compare, right.compare);
  const clone3 = mergeOptional(left.clone, right.clone);
  const hash4 = mergeOptional(left.hash, right.hash);
  const diff3 = mergeOptional(left.diff, right.diff);
  const serialize = mergeOptional(left.serialize, right.serialize);
  return {
    ...entity2 ? { entity: entity2 } : {},
    ...index2 ? { index: index2 } : {},
    ...order ? { order } : {},
    ...collection ? { collection } : {},
    ...compare3 ? { compare: compare3 } : {},
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
function attachMetadata(schema, metadata) {
  const annotations = schema.annotations ?? {};
  return {
    type: schema.type,
    _type: null,
    def: schema.def,
    annotations: { ...annotations, metadata: { ...annotations.metadata, ...metadata } }
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
  const recursion = createRecursionState(schema);
  const program = buildEqualProgram(schema, strategy, recursion);
  const helpers = [];
  while (recursion.pending.length > 0) {
    const target = recursion.pending.shift();
    helpers.push({
      name: recursion.names.get(target),
      program: buildEqualProgram(target, resolveEqualStrategy(target), recursion)
    });
  }
  return helpers.length > 0 ? { ...program, helpers } : program;
}
function createRecursionState(schema) {
  return { recursive: findRecursiveSchemas(schema), names: /* @__PURE__ */ new Map(), pending: [], entry: void 0 };
}
function helperFor(recursion, target) {
  const existing = recursion.names.get(target);
  if (existing) return existing;
  const name = `equal_r${recursion.names.size + 1}`;
  recursion.names.set(target, name);
  recursion.pending.push(target);
  return name;
}
function buildEqualProgram(schema, strategy, recursion) {
  const previousEntry = recursion.entry;
  recursion.entry = schema;
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
  appendSchemaCompare(body, schema, left, right, scope, strategy, recursion);
  body.push({ kind: "return", value: literal(true) });
  recursion.entry = previousEntry;
  return { kind: "program", params: [left, right], body };
}
function appendSchemaCompare(body, schema, left, right, scope, strategy, recursion) {
  const resolved = resolveWrappers(schema);
  if (resolved.optional || resolved.nullable) {
    appendResolvedWrapperCompare(body, resolved, left, right, scope, strategy, recursion);
    return;
  }
  const base = resolved.base;
  if (recursion.recursive.has(base)) {
    if (recursion.entry === base) {
      recursion.entry = void 0;
    } else {
      appendCompareOrFail(body, call(irVar(helperFor(recursion, base)), [left, right]));
      return;
    }
  }
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
      appendArrayCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case TypeName.tuple:
      appendTupleCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case TypeName.object:
      appendObjectCompare(body, base, left, right, scope, recursion);
      return;
    case TypeName.record:
      appendRecordCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case TypeName.set:
      appendSetCompare(body, left, right, scope);
      return;
    case TypeName.map:
      appendMapCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case TypeName.union:
      appendUnionCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case TypeName.intersection: {
      const flattened = flattenObjectIntersection(base);
      if (flattened !== void 0) appendObjectCompare(body, flattened, left, right, scope, recursion);
      else appendIntersectionCompare(body, base, left, right, scope, strategy, recursion);
      return;
    }
    case TypeName.discriminatedUnion:
      appendDiscriminatedUnionCompare(body, base, left, right, scope, strategy, recursion);
      return;
    default:
      throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler equal IR for type: ${base.type}`);
  }
}
function appendCompareOrFail(body, expr) {
  body.push({ kind: "if", test: not(expr), then: [{ kind: "return", value: literal(false) }] });
}
function appendResolvedWrapperCompare(body, resolved, left, right, scope, strategy, recursion) {
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
  appendSchemaCompare(inner, resolved.base, left, right, scope, strategy, recursion);
  body.push({ kind: "if", test: not(sameValue(left, right)), then: inner });
}
function appendArrayCompare(body, schema, left, right, scope, strategy, recursion) {
  const len = scope.createVar("len");
  const ix = scope.createVar("i");
  const leftItem = scope.createVar("li");
  const rightItem = scope.createVar("ri");
  const loopBody = [
    { kind: "assign", target: leftItem, expr: loadIndex(left, ix) },
    { kind: "assign", target: rightItem, expr: loadIndex(right, ix) }
  ];
  appendSchemaCompare(loopBody, schema.def.element, leftItem, rightItem, scope, strategy, recursion);
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
function appendTupleCompare(body, schema, left, right, scope, strategy, recursion) {
  const items = schema.def.items;
  for (let index2 = 0; index2 < items.length; index2++) {
    appendSchemaCompare(
      body,
      items[index2],
      loadIndex(left, literal(index2)),
      loadIndex(right, literal(index2)),
      scope,
      strategy,
      recursion
    );
  }
}
function appendRecordCompare(body, schema, left, right, scope, strategy, recursion) {
  const leftKeys = scope.createVar("lk");
  const rightKeys = scope.createVar("rk");
  const len = scope.createVar("len");
  const ix = scope.createVar("i");
  const key = scope.createVar("k");
  const leftValue = scope.createVar("lv");
  const rightValue = scope.createVar("rv");
  const loopBody = [
    { kind: "assign", target: key, expr: loadIndex(leftKeys, ix) },
    { kind: "if", test: not(ownsKey(right, key)), then: [{ kind: "return", value: literal(false) }] },
    { kind: "assign", target: leftValue, expr: loadIndex(left, key) },
    { kind: "assign", target: rightValue, expr: loadIndex(right, key) }
  ];
  appendSchemaCompare(loopBody, schema.def.value, leftValue, rightValue, scope, strategy, recursion);
  body.push(
    { kind: "assign", target: leftKeys, expr: objectKeys(left) },
    { kind: "assign", target: rightKeys, expr: objectKeys(right) },
    { kind: "assign", target: len, expr: loadProp(leftKeys, "length") },
    {
      kind: "if",
      test: notStrictEqual(len, loadProp(rightKeys, "length")),
      then: [{ kind: "return", value: literal(false) }]
    },
    { kind: "for", index: ix, from: len, body: loopBody }
  );
}
function appendSetCompare(body, left, right, scope) {
  const item = scope.createVar("item");
  body.push(
    {
      kind: "if",
      test: notStrictEqual(loadProp(left, "size"), loadProp(right, "size")),
      then: [{ kind: "return", value: literal(false) }]
    },
    {
      kind: "for_of",
      item,
      iterable: left,
      body: [
        {
          kind: "if",
          test: not(call(loadProp(right, "has"), [item])),
          then: [{ kind: "return", value: literal(false) }]
        }
      ]
    }
  );
}
function appendMapCompare(body, schema, left, right, scope, strategy, recursion) {
  const entry = scope.createVar("entry");
  const key = scope.createVar("mk");
  const leftValue = scope.createVar("mlv");
  const rightValue = scope.createVar("mrv");
  const loopBody = [
    { kind: "assign", target: key, expr: loadIndex(entry, literal(0)) },
    {
      kind: "if",
      test: not(call(loadProp(right, "has"), [key])),
      then: [{ kind: "return", value: literal(false) }]
    },
    { kind: "assign", target: leftValue, expr: loadIndex(entry, literal(1)) },
    { kind: "assign", target: rightValue, expr: call(loadProp(right, "get"), [key]) }
  ];
  appendSchemaCompare(loopBody, schema.def.value, leftValue, rightValue, scope, strategy, recursion);
  body.push(
    {
      kind: "if",
      test: notStrictEqual(loadProp(left, "size"), loadProp(right, "size")),
      then: [{ kind: "return", value: literal(false) }]
    },
    { kind: "for_of", item: entry, iterable: left, body: loopBody }
  );
}
function objectKeys(value) {
  return call(loadProp(irVar("Object"), "keys"), [value]);
}
function ownsKey(target, key) {
  return call(loadProp(loadProp(loadProp(irVar("Object"), "prototype"), "hasOwnProperty"), "call"), [target, key]);
}
function appendObjectCompare(body, schema, left, right, scope, recursion) {
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
    appendSchemaCompare(
      body,
      prop,
      leftValue,
      rightValue,
      scope,
      { type: "equal", array: { type: "loop" }, hash: { type: "none" } },
      recursion
    );
  }
}
function shouldHoistObjectProp(schema) {
  const resolved = resolveWrappers(schema).base;
  return resolved.type === TypeName.object || resolved.type === TypeName.array;
}
function appendUnionCompare(body, schema, left, right, scope, strategy, recursion) {
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
    appendSchemaCompare(then, option, left, right, scope, strategy, recursion);
    then.push({ kind: "return", value: literal(true) });
    branches.push({ kind: "if", test: schemaGuard(option, left), then });
  }
  body.push(...branches, { kind: "return", value: literal(false) });
}
function isAtomicEqualSchema(schema) {
  const base = resolveWrappers(schema).base;
  return isPrimitiveLikeSchema(base) && base.type !== TypeName.regex && base.type !== TypeName.instanceof;
}
function appendIntersectionCompare(body, schema, left, right, scope, strategy, recursion) {
  const options = schema.def.options;
  for (const option of options) {
    appendSchemaCompare(body, option, left, right, scope, strategy, recursion);
  }
}
function appendDiscriminatedUnionCompare(body, schema, left, right, scope, strategy, recursion) {
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
    appendSchemaCompare(then, option, left, right, scope, strategy, recursion);
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
    const key = exprKey(operand);
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
function exprKey(expr) {
  switch (expr.kind) {
    case "var":
      return `v:${expr.name}`;
    case "literal":
      return `l:${typeof expr.value}:${String(expr.value)}`;
    case "not":
      return `!(${exprKey(expr.expr)})`;
    case "binary":
      return `b:${expr.op}(${exprKey(expr.left)},${exprKey(expr.right)})`;
    case "nary":
      return `n:${expr.op}(${expr.operands.map(exprKey).join(",")})`;
    case "sameValue":
      return `sv(${exprKey(expr.left)},${exprKey(expr.right)})`;
    case "sameNumber":
      return `sn(${exprKey(expr.left)},${exprKey(expr.right)})`;
    case "schema_guard":
      return `g${opaqueKey(expr.schema)}(${exprKey(expr.value)})`;
    case "load_prop":
      return `${exprKey(expr.base)}.${expr.key}`;
    case "load_index":
      return `${exprKey(expr.base)}[${exprKey(expr.index)}]`;
    case "call":
      return `c:${exprKey(expr.callee)}(${expr.args.map(exprKey).join(",")})`;
    case "object_literal":
      return `o{${expr.entries.map((entry) => `${entry.key}:${exprKey(entry.value)}`).join(",")}}`;
    case "array_literal":
      return `a[${expr.elements.map(exprKey).join(",")}]`;
    case "construct":
      return `new:${expr.ctor}(${expr.args.map(exprKey).join(",")})`;
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
    if (node.kind === "for" || node.kind === "for_of") {
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
  const ranked = next.operands.map((operand, index2) => ({ operand, index: index2, cost: exprCost3(operand) }));
  ranked.sort((left, right) => left.cost - right.cost || left.index - right.index);
  return { ...next, operands: ranked.map((entry) => entry.operand) };
}

// ../../packages/jit/src/compiler/ir/optimizer/optimize-ir.ts
var optimizeEqualIRPasses = [flattenBlocks, optimizeCost, inlineVars, reorderCompares];
function optimizeIRWith(program, passes) {
  let next = program;
  for (const pass2 of passes) {
    next = pass2(next);
  }
  if (!program.helpers || program.helpers.length === 0) return next;
  return {
    ...next,
    helpers: program.helpers.map((helper) => ({
      name: helper.name,
      program: optimizeIRWith(helper.program, passes)
    }))
  };
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
function emitEqualMethodBody(schema) {
  const strategy = resolveEqualStrategy(schema);
  const program = optimizeIR(buildEqualIR(schema, strategy));
  return `const l = this;
const r = other;
${emitEqualBody(program)}`;
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
function compileEqualMethod(schema, options) {
  return getCompileCached(
    schema,
    "equal:method",
    () => {
      const strategy = resolveEqualStrategy(schema);
      const program = optimizeIR(buildEqualIR(schema, strategy));
      const body = emitEqualBody(program);
      const hash4 = strategy.hash.type === "hash-short-circuit" ? compileHash(schema, options) : void 0;
      return globalThis.Function(
        "__hash",
        "__getIndex",
        `return function equals(other) {
const l = this;
const r = other;
${body}
};`
      )(hash4, getIndex);
    },
    options
  );
}

// ../../packages/jit/src/compiler/changed.ts
var INT32_MASK_LIMIT = 31;
var SCALAR_TYPES = /* @__PURE__ */ new Set([
  TypeName.string,
  TypeName.number,
  TypeName.bigint,
  TypeName.boolean,
  TypeName.literal,
  TypeName.enum,
  TypeName.symbol,
  TypeName.undefined,
  TypeName.null
]);
function allFieldPaths(schema, operation) {
  return Object.keys(expectProjectionObject(schema, operation).def.props);
}
function resolveChangedDescriptor(schema, paths) {
  const tree = buildProjectionTree(schema, paths, "JIT.compare.changed()");
  const fields = tree.paths.map((path) => {
    const leaf = leafSchema2(tree, path);
    return Object.freeze({
      path,
      segments: Object.freeze(path.split(".")),
      structural: !SCALAR_TYPES.has(resolveWrappers(leaf).base.type),
      schema: leaf
    });
  });
  return Object.freeze({
    tree,
    fields: Object.freeze(fields),
    representation: fields.length > INT32_MASK_LIMIT ? "bigint" : "int32"
  });
}
function emitChangedSource(descriptor) {
  const writer = new CodeWriter();
  const zero = descriptor.representation === "bigint" ? "0n" : "0";
  writer.line("function changed(left, right) {");
  writer.indent(() => {
    writer.line(`if (left === right) return ${zero};`);
    writer.line(`let mask = ${zero};`);
    descriptor.fields.forEach((field, index2) => {
      const bit = descriptor.representation === "bigint" ? `(1n << ${index2}n)` : `${1 << index2}`;
      const left = readPath2("left", field);
      const right = readPath2("right", field);
      const differs = field.structural ? `!__changedEqual${index2}(${left}, ${right})` : `${left} !== ${right}`;
      writer.line(`if (${differs}) mask |= ${bit};`);
    });
    writer.line("return mask;");
  });
  writer.line("}");
  return writer.toString();
}
function readPath2(source, field) {
  return field.segments.reduce(
    (carrier, segment, index2) => index2 === 0 ? emitPropertyAccess(carrier, segment) : `${carrier}?.${optionalSegment2(segment)}`,
    source
  );
}
function optionalSegment2(segment) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment) ? segment : `[${JSON.stringify(segment)}]`;
}
function changedEqualBindings(descriptor) {
  const bindings = [];
  descriptor.fields.forEach((field, index2) => {
    if (!field.structural) return;
    bindings.push({ name: `__changedEqual${index2}`, source: emitEqualSource(field.schema) });
  });
  return bindings;
}
function leafSchema2(tree, path) {
  const dot = path.indexOf(".");
  const head = dot === -1 ? path : path.slice(0, dot);
  const node = tree.nodes.find((candidate) => candidate.key === head);
  if (dot === -1) return node.schema;
  return leafSchema2(node.children, path.slice(dot + 1));
}
function changedCacheKey(descriptor) {
  return `changed:${descriptor.representation}:${descriptor.fields.map((field) => field.path).join(",")}`;
}
function compileChanged(schema, descriptor, options) {
  const bindings = changedEqualBindings(descriptor);
  const template = getCompileCached(
    schema,
    changedCacheKey(descriptor),
    () => {
      const source = emitChangedSource(descriptor);
      return {
        source,
        create: globalThis.Function(...bindings.map((binding) => binding.name), `return ${source};`)
      };
    },
    options
  );
  const compiled = template.create(
    ...bindings.map((binding) => globalThis.Function(`return ${binding.source};`)())
  );
  registerArtifact(compiled, { kind: "changed-plan", schema, descriptor });
  return compiled;
}

// ../../packages/jit/src/compiler/clone/build-clone-ir.ts
function buildCloneIR(schema) {
  const { body, helpers } = buildRecursiveProgram(
    schema,
    (current, recurse) => buildCloneNode(current, recurse),
    (id) => ({ kind: "recursive", id }),
    findRecursiveSchemas(schema)
  );
  return { kind: "program", param: "value", body, helpers };
}
function buildCloneNode(schema, recurse) {
  if (schema.type === TypeName.date) return { kind: "date" };
  if (schema.type === TypeName.union) return buildUnionNode(schema, recurse);
  if (schema.type === TypeName.intersection) {
    const flattened = flattenObjectIntersection(schema);
    if (flattened !== void 0) return buildCloneNode(flattened, recurse);
    return buildIntersectionNode(schema, recurse);
  }
  if (schema.type === TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode(schema, recurse);
  const node = buildSchemaNode(schema, recurse);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };
  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler clone IR for type: ${schema.type}`);
}
function buildUnionNode(schema, recurse) {
  if (schema.def.options.every((option) => isPrimitiveLikeSchema(option))) {
    return { kind: "reuse" };
  }
  return {
    kind: "union",
    options: schema.def.options.map((option) => ({
      schema: option,
      node: recurse(option)
    }))
  };
}
function buildIntersectionNode(schema, recurse) {
  return {
    kind: "intersection",
    options: schema.def.options.map(recurse)
  };
}
function buildDiscriminatedUnionNode(schema, recurse) {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: recurse(option)
    }))
  };
}

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

// ../../packages/jit/src/compiler/clone/emit-clone.ts
function emitClone(program) {
  const writer = new CodeWriter();
  emitHelpers2(writer, program);
  writer.line(`function clone(${program.param}) {`);
  writer.indent(() => {
    emitCloneReturn(writer, program.body, program.param);
  });
  writer.line("}");
  return writer.toString();
}
function emitCloneBody(program) {
  const writer = new CodeWriter();
  emitHelpers2(writer, program);
  emitCloneReturn(writer, program.body, program.param);
  return writer.toString();
}
function emitHelpers2(writer, program) {
  for (const helper of program.helpers) {
    writer.line(`function ${helperName(helper.id)}(${program.param}) {`);
    writer.indent(() => {
      emitCloneReturn(writer, helper.node, program.param);
    });
    writer.line("}");
  }
}
function emitCloneReturn(writer, node, source) {
  const inline = emitInlineClone(node, source);
  if (inline) {
    writer.line(`return ${inline};`);
    return;
  }
  emitCloneTo(writer, createEmitState(), node, source, "out");
  writer.line("return out;");
}
function helperName(id) {
  return `clone_${id}`;
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
    case "recursive":
      return;
  }
}
function emitInlineClone(node, source) {
  switch (node.kind) {
    case "reuse":
      return source;
    case "recursive":
      return `${helperName(node.id)}(${source})`;
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
  for (let index2 = 0; index2 < node.items.length; index2++) {
    const cloned = emitInlineClone(node.items[index2], `${source}[${index2}]`);
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
  for (let index2 = 0; index2 < node.items.length; index2++) {
    const itemSource = `${source}[${index2}]`;
    const inline = emitInlineClone(node.items[index2], itemSource);
    if (inline) {
      entries.push(inline);
      continue;
    }
    const itemTarget = state.nextVar(`${target}_${index2}`);
    emitCloneTo(writer, state, node.items[index2], itemSource, itemTarget);
    entries.push(itemTarget);
  }
  writer.line(`const ${target} = [${entries.join(", ")}];`);
}
function emitArrayClone(writer, state, node, source, target) {
  const len = state.nextVar("len");
  const index2 = state.nextVar("i");
  const item = state.nextVar("item");
  writer.line(`const ${len} = ${source}.length;`);
  writer.line(`const ${target} = new Array(${len});`);
  writer.line(`for (let ${index2} = 0; ${index2} < ${len}; ${index2}++) {`);
  writer.indent(() => {
    const itemSource = `${source}[${index2}]`;
    const inline = emitInlineClone(node.element, itemSource);
    if (inline) {
      writer.line(`${target}[${index2}] = ${inline};`);
      return;
    }
    emitCloneTo(writer, state, node.element, itemSource, item);
    writer.line(`${target}[${index2}] = ${item};`);
  });
  writer.line("}");
}
function emitRecordClone(writer, state, node, source, target) {
  const keys = state.nextVar("keys");
  const len = state.nextVar("len");
  const index2 = state.nextVar("i");
  const key = state.nextVar("key");
  const clonedValue = state.nextVar("clonedValue");
  writer.line(`const ${keys} = Object.keys(${source});`);
  writer.line(`const ${target} = {};`);
  writer.line(`for (let ${index2} = 0, ${len} = ${keys}.length; ${index2} < ${len}; ${index2}++) {`);
  writer.indent(() => {
    writer.line(`const ${key} = ${keys}[${index2}];`);
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
  for (let index2 = 0; index2 < node.options.length; index2++) {
    const option = node.options[index2];
    const keyword = index2 === 0 ? "if" : "else if";
    writer.line(`${keyword} (${emitSchemaGuard(option.schema, source)}) {`);
    writer.indent(() => {
      const optionTarget = state.nextVar(`${target}_${index2}`);
      emitCloneTo(writer, state, option.node, source, optionTarget);
      writer.line(`${target} = ${optionTarget};`);
    });
    writer.line("}");
  }
}
function emitIntersectionClone(writer, state, node, source, target) {
  const parts = [];
  for (let index2 = 0; index2 < node.options.length; index2++) {
    const optionTarget = state.nextVar(`${target}_${index2}`);
    emitCloneTo(writer, state, node.options[index2], source, optionTarget);
    parts.push(optionTarget);
  }
  writer.line(`const ${target} = Object.assign({}, ${parts.join(", ")});`);
}
function emitDiscriminatedUnionClone(writer, state, node, source, target) {
  const tag = emitPropertyAccess(source, node.discriminator);
  writer.line(`let ${target};`);
  for (let index2 = 0; index2 < node.options.length; index2++) {
    const option = node.options[index2];
    const value = literalDiscriminatorValue(option.schema, node.discriminator);
    if (value === void 0) continue;
    const keyword = index2 === 0 ? "if" : "else if";
    writer.line(`${keyword} (${tag} === ${emitLiteral(value)}) {`);
    writer.indent(() => {
      const optionTarget = state.nextVar(`${target}_${index2}`);
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
function helperId(context, schema) {
  const recursion = context.recursion;
  if (!recursion.recursive.has(schema)) return void 0;
  const existing = recursion.ids.get(schema);
  if (existing) return existing;
  const id = `r${recursion.ids.size + 1}`;
  recursion.ids.set(schema, id);
  return id;
}
function enqueueHelper(context, schema, pass2) {
  const id = helperId(context, schema);
  if (id === void 0) return void 0;
  const key = `${pass2}:${id}`;
  if (!context.recursion.queued.has(key)) {
    context.recursion.queued.add(key);
    const queue = pass2 === "size" ? context.recursion.pendingSize : pass2 === "write" ? context.recursion.pendingWrite : context.recursion.pendingRead;
    queue.push(schema);
  }
  return id;
}
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
    recursion: {
      recursive: findRecursiveSchemas(schema),
      ids: /* @__PURE__ */ new Map(),
      pendingSize: [],
      pendingWrite: [],
      pendingRead: [],
      queued: /* @__PURE__ */ new Set()
    },
    varCounter: 0
  };
  const cyclic = context.recursion.recursive.size > 0;
  const usesStrings = hasStringLeaf(schema, /* @__PURE__ */ new Set());
  if (usesStrings) {
    bindValue(context, "__enc", textEncoder);
    bindValue(context, "__dec", textDecoder);
  }
  if (cyclic) writer.line("let o = 0;");
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
    writer.line(cyclic ? "o = 1;" : "let o = 1;");
    const result = emitRead(context, schema);
    writer.line(`return ${result};`);
  });
  writer.line("}");
  emitCodecHelpers(context);
  writer.line("return { encode: encode, encodeInto: encodeInto, decode: decode };");
  return {
    source: writer.toString(),
    bindingNames: context.bindingNames,
    bindingValues: context.bindingValues
  };
}
function emitCodecHelpers(context) {
  const writer = context.writer;
  const recursion = context.recursion;
  while (recursion.pendingSize.length > 0 || recursion.pendingWrite.length > 0 || recursion.pendingRead.length > 0) {
    const sizeSchema = recursion.pendingSize.shift();
    if (sizeSchema) {
      writer.line(`function _size_${recursion.ids.get(sizeSchema)}(value) {`);
      writer.indent(() => {
        writer.line("let size = 0;");
        emitBaseSizeInner(context, sizeSchema, "value");
        writer.line("return size;");
      });
      writer.line("}");
      continue;
    }
    const writeSchema = recursion.pendingWrite.shift();
    if (writeSchema) {
      writer.line(`function _write_${recursion.ids.get(writeSchema)}(value, u8, dv, o) {`);
      writer.indent(() => {
        emitBaseWriteInner(context, writeSchema, "value");
        writer.line("return o;");
      });
      writer.line("}");
      continue;
    }
    const readSchema = recursion.pendingRead.shift();
    if (readSchema) {
      writer.line(`function _read_${recursion.ids.get(readSchema)}(u8, dv) {`);
      writer.indent(() => {
        writer.line(`return ${emitBaseReadInner(context, readSchema)};`);
      });
      writer.line("}");
    }
  }
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
      case TypeName.runtimeType:
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
  const id = enqueueHelper(context, schema, "size");
  if (id !== void 0) {
    context.writer.line(`size += _size_${id}(${valueExpr});`);
    return;
  }
  emitBaseSizeInner(context, schema, valueExpr);
}
function emitBaseSizeInner(context, schema, valueExpr) {
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
      const index2 = nextVar(context, "i");
      const item = nextVar(context, "e");
      writer.line("size += 4;");
      writer.line(`for (let ${index2} = 0; ${index2} < ${holder}.length; ${index2}++) {`);
      writer.indent(() => {
        writer.line(`const ${item} = ${holder}[${index2}];`);
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
        const index2 = nextVar(context, "i");
        writer.line("size += 4;");
        writer.line(`for (let ${index2} = ${items.length}; ${index2} < ${holder}.length; ${index2}++) {`);
        writer.indent(() => {
          emitSize(context, rest, `${holder}[${index2}]`);
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
      const index2 = nextVar(context, "i");
      writer.line(`const ${keys} = Object.keys(${holder});`);
      writer.line("size += 4;");
      writer.line(`for (let ${index2} = 0; ${index2} < ${keys}.length; ${index2}++) {`);
      writer.indent(() => {
        writer.line(`size += 4 + ${keys}[${index2}].length * 3;`);
        emitSize(context, valueSchema, `${holder}[${keys}[${index2}]]`);
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
  const id = enqueueHelper(context, schema, "write");
  if (id !== void 0) {
    context.writer.line(`o = _write_${id}(${valueExpr}, u8, dv, o);`);
    return;
  }
  emitBaseWriteInner(context, schema, valueExpr);
}
function emitBaseWriteInner(context, schema, valueExpr) {
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
        const mask3 = nextVar(context, "m");
        maskVars.push(mask3);
        writer.line(`let ${mask3} = 0;`);
      }
      for (const guarded of layout.guarded) {
        const propExpr = emitPropertyAccess(holder, guarded.key);
        const mask3 = maskVars[guarded.bit >> 2];
        const shift = (guarded.bit & 3) * 2;
        writer.line(
          `if (${propExpr} === null) ${mask3} |= ${1 << shift}; else if (${propExpr} !== undefined) ${mask3} |= ${2 << shift};`
        );
      }
      for (const mask3 of maskVars) {
        writer.line(`dv.setUint8(o, ${mask3}); o += 1;`);
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
      const index2 = nextVar(context, "i");
      const item = nextVar(context, "e");
      writer.line(`dv.setUint32(o, ${holder}.length, true); o += 4;`);
      writer.line(`for (let ${index2} = 0; ${index2} < ${holder}.length; ${index2}++) {`);
      writer.indent(() => {
        writer.line(`const ${item} = ${holder}[${index2}];`);
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
        const index2 = nextVar(context, "i");
        writer.line(`dv.setUint32(o, ${holder}.length - ${items.length}, true); o += 4;`);
        writer.line(`for (let ${index2} = ${items.length}; ${index2} < ${holder}.length; ${index2}++) {`);
        writer.indent(() => {
          emitWrite(context, rest, `${holder}[${index2}]`);
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
      const index2 = nextVar(context, "i");
      writer.line(`const ${keys} = Object.keys(${holder});`);
      writer.line(`dv.setUint32(o, ${keys}.length, true); o += 4;`);
      writer.line(`for (let ${index2} = 0; ${index2} < ${keys}.length; ${index2}++) {`);
      writer.indent(() => {
        emitStringWrite(context, `${keys}[${index2}]`);
        emitWrite(context, valueSchema, `${holder}[${keys}[${index2}]]`);
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
    const mask3 = nextVar(context, "m");
    maskVars.push(mask3);
    writer.line(`const ${mask3} = dv.getUint8(o); o += 1;`);
  }
  const entries = [];
  for (const key of Object.keys(props)) {
    const guarded = guardedByKey.get(key);
    if (!guarded) {
      entries.push(`${emitLiteral(key)}: ${emitRead(context, props[key])}`);
      continue;
    }
    const resolved = resolveCodecWrappers(props[key]);
    const mask3 = maskVars[guarded.bit >> 2];
    const shift = (guarded.bit & 3) * 2;
    const state = nextVar(context, "s");
    const holder = nextVar(context, "r");
    writer.line(`const ${state} = (${mask3} >> ${shift}) & 3;`);
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
  const id = enqueueHelper(context, schema, "read");
  if (id !== void 0) return `_read_${id}(u8, dv)`;
  return emitBaseReadInner(context, schema);
}
function emitBaseReadInner(context, schema) {
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
      const index2 = nextVar(context, "i");
      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Array(${length});`);
      writer.line(`for (let ${index2} = 0; ${index2} < ${length}; ${index2}++) {`);
      writer.indent(() => {
        writer.line(`${out}[${index2}] = ${emitRead(context, element)};`);
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
      const index2 = nextVar(context, "i");
      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Array(${items.length} + ${length});`);
      slots.forEach((slot, position) => {
        writer.line(`${out}[${position}] = ${slot};`);
      });
      writer.line(`for (let ${index2} = 0; ${index2} < ${length}; ${index2}++) {`);
      writer.indent(() => {
        writer.line(`${out}[${items.length} + ${index2}] = ${emitRead(context, rest)};`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.set: {
      const element = schema.def.element;
      const length = nextVar(context, "l");
      const out = nextVar(context, "a");
      const index2 = nextVar(context, "i");
      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Set();`);
      writer.line(`for (let ${index2} = 0; ${index2} < ${length}; ${index2}++) {`);
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
      const index2 = nextVar(context, "i");
      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Map();`);
      writer.line(`for (let ${index2} = 0; ${index2} < ${length}; ${index2}++) {`);
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
      const index2 = nextVar(context, "i");
      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = {};`);
      writer.line(`for (let ${index2} = 0; ${index2} < ${length}; ${index2}++) {`);
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

// ../../packages/jit/src/factories/ops.ts
var OPS = "__jitOps";
function isOpChain(value) {
  return typeof value === "object" && value !== null && Array.isArray(value[OPS]);
}
function opSteps(chain2) {
  return chain2[OPS];
}
function emitOpChain(chain2, expr, bind) {
  return opSteps(chain2).reduce((current, step) => step.emit(current, bind), expr);
}
function chain(steps) {
  const step = (kind, emit) => chain([...steps, { kind, emit }]);
  return {
    [OPS]: steps,
    trim: () => step("trim", (expr) => `${expr}.trim()`),
    lowercase: () => step("lowercase", (expr) => `${expr}.toLowerCase()`),
    uppercase: () => step("uppercase", (expr) => `${expr}.toUpperCase()`),
    normalize: (form = "NFC") => step("normalize", (expr) => `${expr}.normalize(${JSON.stringify(form)})`),
    slice: (start, end) => step("slice", (expr) => `${expr}.slice(${start}${end === void 0 ? "" : `, ${end}`})`),
    replace: (pattern, replacement) => step("replace", (expr, bind) => {
      const target = pattern instanceof RegExp ? bind(pattern) : JSON.stringify(pattern);
      return `${expr}.replace(${target}, ${JSON.stringify(replacement)})`;
    }),
    padStart: (length, pad = " ") => step("padStart", (expr) => `${expr}.padStart(${length}, ${JSON.stringify(pad)})`),
    padEnd: (length, pad = " ") => step("padEnd", (expr) => `${expr}.padEnd(${length}, ${JSON.stringify(pad)})`),
    collapseWhitespace: () => step("collapseWhitespace", (expr, bind) => `${expr}.replace(${bind(/\s+/g)}, " ")`),
    toNumber: () => step("toNumber", (expr) => `Number(${expr})`),
    toDate: () => step("toDate", (expr) => `new Date(${expr})`),
    round: () => step("round", (expr) => `Math.round(${expr})`),
    floor: () => step("floor", (expr) => `Math.floor(${expr})`),
    ceil: () => step("ceil", (expr) => `Math.ceil(${expr})`),
    abs: () => step("abs", (expr) => `Math.abs(${expr})`),
    clamp: (min, max) => step("clamp", (expr) => `Math.min(${max}, Math.max(${min}, ${expr}))`),
    toFixed: (digits) => step("toFixed", (expr) => `Number((${expr}).toFixed(${digits}))`),
    toText: () => step("toText", (expr) => `String(${expr})`),
    startOfDay: () => step("startOfDay", (expr) => `new Date(Math.floor((${expr}).getTime() / 86400000) * 86400000)`),
    toISO: () => step("toISO", (expr) => `(${expr}).toISOString()`),
    toEpoch: () => step("toEpoch", (expr) => `(${expr}).getTime()`)
  };
}
var ops = chain([]);

// ../../packages/jit/src/compiler/security/emit-scrub.ts
function emitScrub(schema, selector) {
  const writer = new CodeWriter();
  const context = {
    writer,
    selector,
    varCounter: 0,
    recursive: findRecursiveSchemas(schema),
    helperIds: /* @__PURE__ */ new Map(),
    pending: []
  };
  const rewrites = subtreeMatches(schema, selector, /* @__PURE__ */ new Set());
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
  emitScrubHelpers(context);
  return { source: writer.toString(), rewrites };
}
function emitScrubHelpers(context) {
  while (context.pending.length > 0) {
    const target = context.pending.shift();
    const writer = context.writer;
    const body = new CodeWriter();
    const nested = { ...context, writer: body };
    body.line(`function ${context.helperIds.get(target)}(value) {`);
    body.indent(() => {
      const output = emitScrubBase(nested, target, "value");
      body.line(`return ${output};`);
    });
    body.line("}");
    writer.line(body.toString().trimEnd());
  }
}
function scrubHelper(context, target) {
  const existing = context.helperIds.get(target);
  if (existing) return existing;
  const id = `scrub_r${context.helperIds.size + 1}`;
  context.helperIds.set(target, id);
  context.pending.push(target);
  return id;
}
function nextVar2(context, prefix) {
  return `${prefix}${++context.varCounter}`;
}
function emitScrubExpr(context, schema, valueExpr) {
  const resolved = resolveScrubWrappers(schema);
  const base = resolved.base;
  if (context.recursive.has(base)) {
    const call2 = `${scrubHelper(context, base)}(${valueExpr})`;
    if (!resolved.optional && !resolved.nullable) return call2;
    const holder = hoist2(context, valueExpr);
    return `(${holder} == null ? ${holder} : ${scrubHelper(context, base)}(${holder}))`;
  }
  return emitScrubBase(context, schema, valueExpr);
}
function emitScrubBase(context, schema, valueExpr) {
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
        const index2 = nextVar2(context, "i");
        const item = nextVar2(context, "e");
        writer.line(`const ${out} = new Array(${holder}.length);`);
        writer.line(`for (let ${index2} = 0; ${index2} < ${holder}.length; ${index2}++) {`);
        writer.indent(() => {
          writer.line(`const ${item} = ${holder}[${index2}];`);
          writer.line(`${out}[${index2}] = ${emitScrubExpr(context, element, item)};`);
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
function subtreeMatches(schema, selector, seen = /* @__PURE__ */ new Set()) {
  const base = resolveScrubWrappers(schema).base;
  if (seen.has(base)) return false;
  seen.add(base);
  if (selector(base)) return true;
  switch (base.type) {
    case TypeName.object: {
      const props = base.def.props;
      return Object.keys(props).some((key) => subtreeMatches(props[key], selector, seen));
    }
    case TypeName.array:
      return subtreeMatches(base.def.element, selector, seen);
    default:
      return false;
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
        `return ${emitted.source.replace("function scrub(", "function sanitize(")};`
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
  const index2 = SANITIZE_VALUES.indexOf(pattern);
  return index2 === -1 ? String(pattern) : SANITIZE_BINDINGS[index2];
}

// ../../packages/jit/src/compiler/source/format-mask.ts
function countFormatPlaceholders(pattern) {
  let count = 0;
  for (let index2 = 0; index2 < pattern.length; index2++) {
    if (pattern.charCodeAt(index2) === 35) count++;
  }
  return count;
}
function emitFormatMaskExpression(value, pattern) {
  const parts = [];
  let cursor = 0;
  for (let index2 = 0; index2 < pattern.length; index2++) {
    const character = pattern[index2];
    parts.push(character === "#" ? `${value}[${cursor++}]` : emitLiteral(character));
  }
  return parts.length === 0 ? '""' : parts.join(" + ");
}
function emitStrictFormatCondition(value, pattern) {
  const checks = [`${value}.length !== ${pattern.length}`];
  for (let index2 = 0; index2 < pattern.length; index2++) {
    const code = pattern.charCodeAt(index2);
    checks.push(
      code === 35 ? `(${value}.charCodeAt(${index2}) < 48 || ${value}.charCodeAt(${index2}) > 57)` : `${value}.charCodeAt(${index2}) !== ${code}`
    );
  }
  return checks.join(" || ");
}

// ../../packages/jit/src/compiler/validate/emit-validate.ts
var EMAIL_REGEX = regexes_exports.email;
var UUID_REGEX = /* @__PURE__ */ regexes_exports.uuid();
var ValidatorEmitter = class {
  constructor(mode, awaited = false, resolveDefaults = true, materializeRuntimeTypes = true) {
    this.mode = mode;
    this.awaited = awaited;
    this.resolveDefaults = resolveDefaults;
    this.materializeRuntimeTypes = materializeRuntimeTypes;
    this.writer = new CodeWriter();
    this.bindingNames = [];
    this.bindingValues = [];
    this.bindingIds = /* @__PURE__ */ new Map();
    this.helperSources = [];
    this.predicateNames = /* @__PURE__ */ new Map();
    /** Schemas that close a cycle; each becomes one named recursive helper. */
    this.recursive = /* @__PURE__ */ new Set();
    this.recursiveNames = /* @__PURE__ */ new Map();
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
  /**
   * Declares which schemas take part in a cycle. Those are expanded once into
   * a named function that calls itself, instead of being inlined forever.
   */
  markRecursive(schemas) {
    this.recursive = schemas;
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
    if (this.recursive.size > 0) {
      const target = resolveLazySchema(schema);
      if (this.recursive.has(target)) return this.emitRecursiveCall(target, valueExpr, path);
    }
    return this.emitInline(schema, valueExpr, path, contextExpr);
  }
  /** Expands a schema in place, bypassing the recursion guard for this node. */
  emitInline(schema, valueExpr, path, contextExpr) {
    const current = schema;
    if (current.type === TypeName.when) {
      return this.emitWhen(current, valueExpr, path, contextExpr);
    }
    const unwrapped = unwrapValidation(schema, this);
    const writer = this.writer;
    const holder = this.nextVar("v");
    const output = this.nextVar("o");
    const builds = this.mode === "parse" && needsBuild(schema);
    writer.line(`let ${holder} = ${valueExpr};`);
    if (builds) writer.line(`let ${output} = ${holder};`);
    const finish = () => builds ? output : holder;
    if (unwrapped.emptyAsUndefined) {
      writer.line(`if (${holder} === "") {`);
      writer.indent(() => {
        writer.line(`${holder} = undefined;`);
        if (builds) writer.line(`${output} = ${holder};`);
      });
      writer.line("}");
    }
    const emitValidated = () => {
      if (unwrapped.coerce) {
        writer.line(`${holder} = ${unwrapped.coerce}(${holder});`);
        if (builds) writer.line(`${output} = ${holder};`);
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
      if (builds) {
        writer.line(`${output} = ${innerOut};`);
        for (const pipe3 of unwrapped.pipes) {
          writer.line(
            pipe3.kind === "inline" ? `${output} = ${emitOpChain(pipe3.chain, output, (value) => this.bind(value))};` : `${output} = ${pipe3.binding}(${output});`
          );
        }
        if (unwrapped.materialize) writer.line(`${output} = new ${unwrapped.materialize}(${output}, true);`);
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
  /**
   * Calls the named function for a recursive schema. In `is` mode the helper
   * answers a boolean; in parse mode it takes the issue list and the current
   * path so failures keep reporting the position in the real value.
   */
  emitRecursiveCall(schema, valueExpr, path) {
    const name = this.recursiveHelper(schema);
    const writer = this.writer;
    if (this.mode === "is") {
      const holder = this.nextVar("v");
      writer.line(`const ${holder} = ${valueExpr};`);
      writer.line(`if (!${name}(${holder})) return false;`);
      return holder;
    }
    const output = this.nextVar("o");
    const pathSource = path.kind === "static" ? emitLiteral(path.source) : path.source;
    writer.line(`const ${output} = ${this.awaited ? "await " : ""}${name}(${valueExpr}, issues, ${pathSource});`);
    return output;
  }
  recursiveHelper(schema) {
    const existing = this.recursiveNames.get(schema);
    if (existing) return existing;
    const name = `${this.rootMode === "is" ? "ir" : "pr"}${++this.helperCounter}`;
    this.recursiveNames.set(schema, name);
    const savedWriter = this.writer;
    this.writer = new CodeWriter();
    if (this.mode === "is") {
      this.writer.line(`function ${name}(value) {`);
      this.writer.indent(() => {
        this.emitInline(schema, "value", { kind: "static", source: "" });
        this.writer.line("return true;");
      });
      this.writer.line("}");
    } else {
      this.writer.line(`${this.awaited ? "async " : ""}function ${name}(value, issues, path) {`);
      this.writer.indent(() => {
        const output = this.emitInline(schema, "value", { kind: "dynamic", source: "path" });
        this.writer.line(`return ${output};`);
      });
      this.writer.line("}");
    }
    this.helperSources.push(this.writer.toString());
    this.writer = savedWriter;
    return name;
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
                `(${value} | 0) !== ${value}`,
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
        const index2 = this.nextVar("i");
        if (build) this.writer.line(`${out} = new Array(${value}.length);`);
        this.writer.line(`for (let ${index2} = 0; ${index2} < ${value}.length; ${index2}++) {`);
        this.writer.indent(() => {
          const elementOut = this.emitNode(element, `${value}[${index2}]`, dynamicChild(path, index2));
          if (build) this.writer.line(`${out}[${index2}] = ${elementOut};`);
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
          const index2 = this.nextVar("i");
          this.writer.line(`for (let ${index2} = ${items.length}; ${index2} < ${value}.length; ${index2}++) {`);
          this.writer.indent(() => {
            const restOut = this.emitNode(rest, `${value}[${index2}]`, dynamicChild(path, index2));
            if (build) this.writer.line(`${out}[${index2}] = ${restOut};`);
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
        const index2 = this.nextVar("i");
        if (build) this.writer.line(`${out} = {};`);
        this.writer.line(`const ${keys} = Object.keys(${value});`);
        this.writer.line(`for (let ${index2} = 0; ${index2} < ${keys}.length; ${index2}++) {`);
        this.writer.indent(() => {
          const valueOut = this.emitNode(
            valueSchema,
            `${value}[${keys}[${index2}]]`,
            dynamicKeyChild(path, `${keys}[${index2}]`)
          );
          if (build) this.writer.line(`${out}[${keys}[${index2}]] = ${valueOut};`);
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
          const index2 = this.nextVar("i");
          const keyTest = keys.map((key) => `${known}[${index2}] !== ${emitLiteral(key)}`).join(" && ");
          const unknownTest = keys.length === 0 ? "true" : keyTest;
          this.writer.line(`const ${known} = Object.keys(${value});`);
          this.writer.line(`for (let ${index2} = 0; ${index2} < ${known}.length; ${index2}++) {`);
          this.writer.indent(() => {
            if (unknownKeys === "strict") {
              this.failIf(
                unknownTest,
                dynamicKeyChild(path, `${known}[${index2}]`),
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
                  `${value}[${known}[${index2}]]`,
                  dynamicKeyChild(path, `${known}[${index2}]`)
                );
                if (build && catchallBuild) this.writer.line(`${out}[${known}[${index2}]] = ${catchallOut};`);
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
  if (segment.startsWith("[")) {
    return { kind: "dynamic", source: `${path.source} + ${emitLiteral(segment)}` };
  }
  return {
    kind: "dynamic",
    source: `(${path.source} ? ${path.source} + ${emitLiteral(`.${segment}`)} : ${emitLiteral(segment)})`
  };
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
function unwrapValidation(schema, emitter2) {
  let current = schema;
  let optional3 = false;
  let nullable3 = false;
  let defaultValue;
  let coerce3;
  const refines = [];
  const pipes = [];
  let fieldTransforms;
  let materialize;
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
      if (emitter2.resolveDefaults && !defaultValue) {
        const raw = current.def.defaultValue;
        defaultValue = { binding: emitter2.bind(raw), isFactory: typeof raw === "function" };
      }
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.coerce) {
      coerce3 = coerce3 ?? emitter2.bind(current.def.coercer);
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.refine) {
      refines.unshift({
        binding: emitter2.bind(current.def.predicate),
        ...typeof current.def.message === "string" ? { message: current.def.message } : {},
        ...Array.isArray(current.def.path) ? { path: current.def.path } : {},
        ...typeof current.def.when === "function" ? { when: emitter2.bind(current.def.when) } : {}
      });
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.pipe) {
      const transform3 = current.def.transform;
      pipes.unshift(
        isOpChain(transform3) ? { kind: "inline", chain: transform3 } : { kind: "call", binding: emitter2.bind(transform3) }
      );
      current = current.def.innerType;
      continue;
    }
    if (current.type === TypeName.transform) {
      fieldTransforms = fieldTransforms ?? bindFieldTransforms(current.def.transforms, emitter2);
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
    if (current.type === TypeName.runtimeType) {
      if (emitter2.materializeRuntimeTypes) materialize = emitter2.bind(current.def.materialize);
      current = current.def.innerType;
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
    fieldTransforms,
    materialize
  };
}
function bindFieldTransforms(spec, emitter2) {
  const bindings = {};
  for (const [key, fn] of Object.entries(spec)) {
    if (typeof fn === "function") bindings[key] = emitter2.bind(fn);
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
    case TypeName.runtimeType:
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
function canUseFastParse(schema, seen = /* @__PURE__ */ new Set()) {
  if (seen.has(schema)) return true;
  if (needsBuild(schema) || rootHasReadonly(schema)) return false;
  seen.add(schema);
  const current = schema;
  switch (current.type) {
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
    case TypeName.custom:
    case TypeName.codec:
    case TypeName.instanceof:
      return false;
    case TypeName.lazy:
      return canUseFastParse(current.def.getter(), seen);
    case TypeName.when:
      return typeof current.def.is !== "function" && canUseFastParse(current.def.thenType, seen) && canUseFastParse(current.def.otherwiseType, seen);
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.not:
      return canUseFastParse(current.def.innerType, seen);
    case TypeName.string: {
      const checks = current.def.checks ?? [];
      return !checks.some((check) => check.value instanceof RegExp && (check.value.global || check.value.sticky));
    }
    case TypeName.array:
    case TypeName.set:
      return canUseFastParse(current.def.element, seen);
    case TypeName.map:
      return canUseFastParse(current.def.key, seen) && canUseFastParse(current.def.value, seen);
    case TypeName.record:
      return canUseFastParse(current.def.value, seen);
    case TypeName.tuple: {
      const items = current.def.items ?? [];
      const rest = current.def.rest;
      return items.every((item) => canUseFastParse(item, seen)) && (rest === void 0 || canUseFastParse(rest, seen));
    }
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion:
    case TypeName.intersection:
      return current.def.options.every((option) => canUseFastParse(option, seen));
    case TypeName.object: {
      const props = current.def.props;
      const catchall2 = current.def.catchall;
      return Object.keys(props).every((key) => canUseFastParse(props[key], seen)) && (catchall2 === void 0 || canUseFastParse(catchall2, seen));
    }
    default:
      return true;
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
  const resolveDefaults = options.resolveDefaults ?? true;
  const materializeRuntimeTypes = options.materializeRuntimeTypes ?? true;
  const freezesOutput = rootHasReadonly(schema);
  const recursive = findRecursiveSchemas(schema);
  let parseEmitter;
  if (emitSafeParse) {
    const emitter2 = new ValidatorEmitter("parse", false, resolveDefaults, materializeRuntimeTypes);
    emitter2.markRecursive(recursive);
    parseEmitter = emitter2;
    emitter2.writer.line("function safeParse(value) {");
    emitter2.writer.indent(() => {
      emitter2.writer.line("const issues = [];");
      const output = emitter2.emitNode(schema, "value", { kind: "static", source: "" });
      emitter2.writer.line("if (issues.length !== 0) {");
      emitter2.writer.indent(() => {
        emitter2.writer.line("return { success: false, issues: issues };");
      });
      emitter2.writer.line("}");
      if (freezesOutput) emitFreezeOutput(emitter2.writer, output);
      emitter2.writer.line(`return { success: true, data: ${output} };`);
    });
    emitter2.writer.line("}");
  }
  let asyncEmitter;
  if (emitSafeParseAsync && containsPromise(schema)) {
    const emitter2 = new ValidatorEmitter("parse", true, resolveDefaults, materializeRuntimeTypes);
    emitter2.markRecursive(recursive);
    asyncEmitter = emitter2;
    for (const value of parseEmitter?.bindings().values ?? []) emitter2.bind(value);
    emitter2.writer.line("async function safeParseAsync(value) {");
    emitter2.writer.indent(() => {
      emitter2.writer.line("const issues = [];");
      const output = emitter2.emitNode(schema, "value", { kind: "static", source: "" });
      emitter2.writer.line("if (issues.length !== 0) {");
      emitter2.writer.indent(() => {
        emitter2.writer.line("return { success: false, issues: issues };");
      });
      emitter2.writer.line("}");
      if (freezesOutput) emitFreezeOutput(emitter2.writer, output);
      emitter2.writer.line(`return { success: true, data: ${output} };`);
    });
    emitter2.writer.line("}");
  }
  let isEmitter;
  if (emitIs) {
    const emitter2 = new ValidatorEmitter("is", false, resolveDefaults, materializeRuntimeTypes);
    emitter2.markRecursive(recursive);
    isEmitter = emitter2;
    for (const value of (asyncEmitter ?? parseEmitter)?.bindings().values ?? []) emitter2.bind(value);
    emitter2.writer.line("function is(value) {");
    emitter2.writer.indent(() => {
      emitter2.emitNode(schema, "value", { kind: "static", source: "" });
      emitter2.writer.line("return true;");
    });
    emitter2.writer.line("}");
  }
  const emitters = [isEmitter, parseEmitter, asyncEmitter].filter(
    (emitter2) => Boolean(emitter2)
  );
  const bindings = (isEmitter ?? asyncEmitter ?? parseEmitter)?.bindings() ?? { names: [], values: [] };
  const helperBlocks = emitters.flatMap((emitter2) => emitter2.helpers());
  const helperSource = helperBlocks.length > 0 ? `${helperBlocks.join("\n")}
` : "";
  const functionSource = emitters.map((emitter2) => emitter2.writer.toString()).join("\n");
  const returnedEntries = [
    ...isEmitter ? ["is: is"] : [],
    ...parseEmitter ? ["safeParse: safeParse"] : [],
    ...asyncEmitter ? ["safeParseAsync: safeParseAsync"] : []
  ];
  const returned = `return { ${returnedEntries.join(", ")} };`;
  const source = `${helperSource}${functionSource}${functionSource.length > 0 ? "\n" : ""}${returned}`;
  return { source, bindings };
}

// ../../packages/jit/src/compiler/validate.ts
var VALIDATOR_OPS = ["is", "parse", "safeParse", "parseAsync", "safeParseAsync"];
function compileValidator(schema, options) {
  return compileValidatorSelection(schema, VALIDATOR_OPS, options);
}
function compileHydrator(schema, options) {
  return getCompileCached(
    schema,
    "hydrator",
    () => {
      const emitted = emitValidator(schema, {
        is: false,
        safeParse: true,
        safeParseAsync: false,
        resolveDefaults: false
      });
      const safeParse = globalThis.Function(...emitted.bindings.names, emitted.source)(...emitted.bindings.values).safeParse;
      return (state) => {
        const result = safeParse(state);
        if (result.success) return result.data;
        throw new JITValidationError(result.issues);
      };
    },
    options
  );
}
function compileValidatorSelection(schema, ops2, options) {
  const normalizedOps = normalizeValidatorOps(ops2);
  const fastParse = canUseFastParse(schema) && (normalizedOps.includes("parse") || normalizedOps.includes("safeParse"));
  const cacheKey3 = `validator:${normalizedOps.join(",")}`;
  return getCompileCached(
    schema,
    cacheKey3,
    () => {
      const emitted = emitValidator(schema, emitOptionsForValidatorOps(normalizedOps, fastParse));
      const compiled = globalThis.Function(...emitted.bindings.names, emitted.source)(...emitted.bindings.values);
      const selection = {};
      const is = compiled.is;
      const safeParse = compiled.safeParse;
      const fastSafeParse = fastParse && is && safeParse ? (value) => is(value) ? { success: true, data: value } : safeParse(value) : safeParse;
      const parse3 = (value) => {
        if (fastParse && is?.(value)) return value;
        if (!safeParse) throw new Error("parse requires safeParse generation");
        const result = safeParse(value);
        if (result.success) return result.data;
        throw new JITValidationError(result.issues);
      };
      const safeParseAsync3 = compiled.safeParseAsync ?? (safeParse ? async (value) => safeParse(value) : void 0);
      const parseAsync3 = async (value) => {
        if (!safeParseAsync3) throw new Error("parseAsync requires async validation generation");
        const result = await safeParseAsync3(value);
        if (result.success) return result.data;
        throw new JITValidationError(result.issues);
      };
      if (normalizedOps.includes("is") && compiled.is) {
        selection.is = compiled.is;
        registerValidatorArtifact(compiled.is, schema, "is");
      }
      if (normalizedOps.includes("safeParse") && fastSafeParse) {
        selection.safeParse = fastSafeParse;
        registerValidatorArtifact(fastSafeParse, schema, "safeParse");
      }
      if (normalizedOps.includes("parse")) {
        selection.parse = parse3;
        registerValidatorArtifact(parse3, schema, "parse");
      }
      if (normalizedOps.includes("safeParseAsync") && safeParseAsync3) {
        selection.safeParseAsync = safeParseAsync3;
        registerValidatorArtifact(safeParseAsync3, schema, "safeParseAsync");
      }
      if (normalizedOps.includes("parseAsync")) {
        selection.parseAsync = parseAsync3;
        registerValidatorArtifact(parseAsync3, schema, "parseAsync");
      }
      return selection;
    },
    options
  );
}
function registerValidatorArtifact(fn, schema, op) {
  registerArtifact(fn, { kind: "validator", schema, op });
}
function normalizeValidatorOps(ops2) {
  const normalized = [];
  for (const op of VALIDATOR_OPS) {
    if (ops2.includes(op)) normalized.push(op);
  }
  return normalized;
}
function emitOptionsForValidatorOps(ops2, fastParse = false) {
  return {
    is: ops2.includes("is") || fastParse,
    safeParse: ops2.includes("safeParse") || ops2.includes("parse") || ops2.includes("safeParseAsync") || ops2.includes("parseAsync"),
    safeParseAsync: ops2.includes("safeParseAsync") || ops2.includes("parseAsync")
  };
}

// ../../packages/jit/src/compiler/csv.ts
function resolveCsvDescriptor(schema, operation, sink, options = {}) {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object) {
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.csv requires an object row schema");
  }
  const delimiter = options.delimiter ?? ",";
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    throw new JITError("INVALID_OPERATION", "CSV delimiter must be one character other than quote or newline");
  }
  const object2 = base;
  const columns = options.columns ?? {};
  for (const key of Object.keys(columns)) {
    if (!(key in object2.def.props)) {
      throw new JITError("INVALID_OPERATION", `CSV columns references unknown field ${JSON.stringify(key)}`);
    }
  }
  const fields = Object.keys(object2.def.props).map(
    (key) => resolveCsvField(key, columns[key] ?? key, object2.def.props[key])
  );
  return Object.freeze({
    schema,
    fields: Object.freeze(fields),
    delimiter,
    header: options.header ?? true,
    operation,
    sink
  });
}
function resolveCsvField(key, column, schema) {
  const resolved = resolveWrappers(schema);
  const base = resolved.base;
  let kind;
  switch (base.type) {
    case TypeName.string:
      kind = "string";
      break;
    case TypeName.number:
    case TypeName.int:
    case TypeName.nan:
      kind = "number";
      break;
    case TypeName.boolean:
      kind = "boolean";
      break;
    case TypeName.bigint:
      kind = "bigint";
      break;
    case TypeName.date:
      kind = "date";
      break;
    case TypeName.null:
      kind = "null";
      break;
    case TypeName.literal: {
      const value = base.def.value;
      kind = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
      break;
    }
    case TypeName.enum: {
      const values = Object.values(base.def.values);
      kind = values.length > 0 && values.every((value) => typeof value === "number") ? "number" : "string";
      break;
    }
    default:
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `CSV field ${JSON.stringify(key)} has unsupported ${String(base.type)} values; encode nested values explicitly before CSV`
      );
  }
  return Object.freeze({
    key,
    column,
    kind,
    optional: resolved.optional || hasDefault(schema),
    nullable: resolved.nullable
  });
}
function hasDefault(schema) {
  let current = schema;
  while (true) {
    if (current.type === TypeName.default) return true;
    if (current.type === TypeName.optional || current.type === TypeName.nullable || current.type === TypeName.nullish || current.type === TypeName.readonly || current.type === TypeName.brand || current.type === TypeName.transform || current.type === TypeName.pipe || current.type === TypeName.refine || current.type === TypeName.coerce || current.type === TypeName.runtimeType) {
      current = current.def.innerType;
      continue;
    }
    return false;
  }
}
function emitCsvSource(descriptor, validator = "__csvValidator") {
  const source = descriptor.operation === "parse" ? emitCsvParseSource(descriptor, validator) : emitCsvStringifySource(descriptor);
  const main = descriptor.operation === "parse" ? "csvParse" : "csvStringify";
  return `(() => {
${source.trimEnd().split("\n").map((line) => `  ${line}`).join("\n")}
  return ${main};
})()`;
}
function emitCsvParseSource(descriptor, validator) {
  const writer = new CodeWriter();
  const generator = descriptor.sink === "iterator" ? "function*" : "function";
  const parameters = descriptor.sink === "visitor" ? "input, consume" : "input";
  if (descriptor.header) emitHeaderResolver(writer, descriptor);
  emitCsvRowParser(writer, descriptor, validator);
  writer.line(`${generator} csvParse(${parameters}) {`);
  writer.indent(() => {
    if (descriptor.sink === "result") writer.line("const out = [];");
    writer.line(
      'const single = typeof input === "string" || input instanceof Uint8Array; const iterator = single ? undefined : input[Symbol.iterator]();'
    );
    writer.line("const decoder = new TextDecoder();");
    writer.line(
      'let field = "", record = [], quoted = false, afterQuote = false, skipLf = false, dirty = false, singleDone = false;'
    );
    emitPositionDeclarations(writer, descriptor);
    writer.line("let row = 0;");
    writer.line("while (true) {");
    writer.indent(() => {
      writer.line("let chunk, done;");
      writer.line(
        "if (single) { done = singleDone; chunk = singleDone ? undefined : input; singleDone = true; } else { const next = iterator.next(); done = next.done; chunk = next.value; }"
      );
      writer.line(
        'const text = done ? decoder.decode() : (typeof chunk === "string" ? decoder.decode() + chunk : decoder.decode(chunk, { stream: true }));'
      );
      writer.line("for (let i = 0; i < text.length; i++) {");
      writer.indent(() => emitCsvCharacter(writer, descriptor));
      writer.line("}");
      writer.line("if (!done) continue;");
      writer.line('if (quoted) throw new SyntaxError("unterminated quoted CSV field");');
      writer.line("if (dirty || field.length !== 0 || record.length !== 0) {");
      writer.indent(() => {
        writer.line("record[record.length] = field;");
        emitCsvRecord(writer, descriptor);
      });
      writer.line("}");
      if (descriptor.header) writer.line('if (headerPending) throw new SyntaxError("CSV header is missing");');
      if (descriptor.sink === "result") writer.line("return out;");
      else if (descriptor.sink === "visitor") writer.line("return row;");
      else writer.line("return;");
    });
    writer.line("}");
  });
  writer.line("}");
  return writer.toString();
}
function emitHeaderResolver(writer, descriptor) {
  writer.line("function csvHeader(header) {");
  writer.indent(() => {
    descriptor.fields.forEach((_, index2) => {
      writer.line(`let p${index2} = -1;`);
    });
    writer.line("for (let h = 0; h < header.length; h++) {");
    writer.indent(() => {
      writer.line("switch (header[h]) {");
      writer.indent(() => {
        descriptor.fields.forEach((field, index2) => {
          writer.line(`case ${JSON.stringify(field.column)}:`);
          writer.indent(() => {
            writer.line(
              `if (p${index2} !== -1) throw new SyntaxError(${JSON.stringify(`duplicate CSV column ${field.column}`)});`
            );
            writer.line(`p${index2} = h; break;`);
          });
        });
      });
      writer.line("}");
    });
    writer.line("}");
    descriptor.fields.forEach((field, index2) => {
      writer.line(
        `if (p${index2} === -1) throw new SyntaxError(${JSON.stringify(`missing CSV column ${field.column}`)});`
      );
    });
    writer.line(`return [${descriptor.fields.map((_, index2) => `p${index2}`).join(", ")}];`);
  });
  writer.line("}");
}
function emitPositionDeclarations(writer, descriptor) {
  descriptor.fields.forEach((_, index2) => {
    writer.line(`${descriptor.header ? "let" : "const"} p${index2} = ${descriptor.header ? -1 : index2};`);
  });
  if (descriptor.header) writer.line("let headerPending = true;");
}
function emitCsvCharacter(writer, descriptor) {
  writer.line("const ch = text[i];");
  writer.line('if (skipLf) { skipLf = false; if (ch === "\\n") continue; }');
  writer.line("if (quoted) {");
  writer.indent(() => {
    writer.line(`if (ch === '"') { quoted = false; afterQuote = true; } else { field += ch; dirty = true; }`);
    writer.line("continue;");
  });
  writer.line("}");
  writer.line("if (afterQuote) {");
  writer.indent(() => {
    writer.line(`if (ch === '"') { field += '"'; quoted = true; afterQuote = false; dirty = true; continue; }`);
    writer.line(
      `if (ch === ${JSON.stringify(descriptor.delimiter)}) { record[record.length] = field; field = ""; afterQuote = false; dirty = true; continue; }`
    );
    writer.line('if (ch === "\\r" || ch === "\\n") {');
    writer.indent(() => {
      writer.line("record[record.length] = field;");
      emitCsvRecord(writer, descriptor);
      writer.line('record = []; field = ""; afterQuote = false; dirty = false; skipLf = ch === "\\r"; continue;');
    });
    writer.line("}");
    writer.line('throw new SyntaxError("unexpected character after closing CSV quote");');
  });
  writer.line("}");
  writer.line(
    `if (ch === ${JSON.stringify(descriptor.delimiter)}) { record[record.length] = field; field = ""; dirty = true; continue; }`
  );
  writer.line(
    `if (ch === '"') { if (field.length !== 0) throw new SyntaxError("quote inside unquoted CSV field"); quoted = true; dirty = true; continue; }`
  );
  writer.line('if (ch === "\\r" || ch === "\\n") {');
  writer.indent(() => {
    writer.line("record[record.length] = field;");
    emitCsvRecord(writer, descriptor);
    writer.line('record = []; field = ""; dirty = false; skipLf = ch === "\\r"; continue;');
  });
  writer.line("}");
  writer.line("field += ch; dirty = true;");
}
function emitCsvRecord(writer, descriptor) {
  if (descriptor.header) {
    writer.line("if (headerPending) {");
    writer.indent(() => {
      writer.line("const positions = csvHeader(record);");
      descriptor.fields.forEach((_, index2) => {
        writer.line(`p${index2} = positions[${index2}];`);
      });
      writer.line("headerPending = false;");
    });
    writer.line("} else {");
    writer.indent(() => emitCsvDataRecord(writer, descriptor));
    writer.line("}");
    return;
  }
  emitCsvDataRecord(writer, descriptor);
}
function emitCsvDataRecord(writer, descriptor) {
  const args = descriptor.fields.map((_, index2) => `p${index2}`).join(", ");
  writer.line(`const value = csvRow(record, row${args ? `, ${args}` : ""});`);
  if (descriptor.sink === "result") writer.line("out[row] = value;");
  else if (descriptor.sink === "iterator") writer.line("yield value;");
  else writer.line("consume(value, row);");
  writer.line("row += 1;");
}
function emitCsvRowParser(writer, descriptor, validator) {
  const positions = descriptor.fields.map((_, index2) => `p${index2}`).join(", ");
  writer.line(`function csvRow(record, row${positions ? `, ${positions}` : ""}) {`);
  writer.indent(() => {
    descriptor.fields.forEach((_, index2) => {
      writer.line(`const c${index2} = record[p${index2}];`);
    });
    writer.line("const result = " + validator + ".safeParse({");
    writer.indent(() => {
      descriptor.fields.forEach((field, index2) => {
        writer.line(`${JSON.stringify(field.key)}: ${csvParseExpression(field, `c${index2}`)},`);
      });
    });
    writer.line("});");
    writer.line("if (result.success) return result.data;");
    writer.line(
      'throw new JITValidationError(result.issues.map((issue) => ({ ...issue, path: "[" + row + "]" + (issue.path ? "." + issue.path : "") })));'
    );
  });
  writer.line("}");
}
function csvParseExpression(field, cell) {
  const missing = field.nullable ? "null" : field.optional ? "undefined" : void 0;
  let value;
  switch (field.kind) {
    case "string":
      value = cell;
      break;
    case "number":
      value = `Number(${cell})`;
      break;
    case "boolean":
      value = `${cell} === "true" ? true : ${cell} === "false" ? false : ${cell}`;
      break;
    case "bigint":
      value = `BigInt(${cell})`;
      break;
    case "date":
      value = `new Date(${cell})`;
      break;
    case "null":
      value = "null";
      break;
  }
  if (missing !== void 0) return `${cell} === "" || ${cell} === undefined ? ${missing} : ${value}`;
  if (field.kind === "number") return `${cell} === "" || ${cell} === undefined ? NaN : ${value}`;
  return value;
}
function emitCsvStringifySource(descriptor) {
  const writer = new CodeWriter();
  writer.line("function csvEscape(value) {");
  writer.indent(() => {
    writer.line(
      `return value.indexOf('"') === -1 && value.indexOf(${JSON.stringify(descriptor.delimiter)}) === -1 && value.indexOf("\\r") === -1 && value.indexOf("\\n") === -1 ? value : '"' + value.replace(/"/g, '""') + '"';`
    );
  });
  writer.line("}");
  const iterator = descriptor.sink === "iterator";
  writer.line(`${iterator ? "function*" : "function"} csvStringify(value) {`);
  writer.indent(() => {
    const header = descriptor.fields.map((field) => csvStaticEscape(field.column, descriptor.delimiter)).join(descriptor.delimiter);
    if (iterator) {
      if (descriptor.header) writer.line(`yield ${JSON.stringify(header + "\r\n")};`);
      writer.line("for (let i = 0; i < value.length; i++) {");
      writer.indent(() => writer.line(`yield ${csvRowStringExpression(descriptor, "value[i]")} + "\\r\\n";`));
      writer.line("}");
    } else {
      writer.line(`let out = ${JSON.stringify(descriptor.header ? header : "")};`);
      writer.line("for (let i = 0; i < value.length; i++) {");
      writer.indent(() => {
        writer.line(`if (out.length !== 0) out += "\\r\\n";`);
        writer.line(`out += ${csvRowStringExpression(descriptor, "value[i]")};`);
      });
      writer.line("}");
      writer.line("return out;");
    }
  });
  writer.line("}");
  return writer.toString();
}
function csvRowStringExpression(descriptor, value) {
  return descriptor.fields.map((field) => {
    const access2 = emitPropertyAccess(value, field.key);
    const encoded = field.kind === "date" ? `${access2}.toISOString()` : `String(${access2})`;
    const scalar = field.optional || field.nullable ? `${access2} == null ? "" : ${encoded}` : encoded;
    return `csvEscape(${scalar})`;
  }).join(` + ${JSON.stringify(descriptor.delimiter)} + `);
}
function csvStaticEscape(value, delimiter) {
  return value.includes('"') || value.includes(delimiter) || value.includes("\r") || value.includes("\n") ? `"${value.replace(/"/g, '""')}"` : value;
}
function compileCsvParse(descriptor) {
  const validator = compileValidator(descriptor.schema);
  const source = emitCsvSource(descriptor);
  const compiled = globalThis.Function(
    "__csvValidator",
    "JITValidationError",
    `return ${source};`
  )(validator, JITValidationError);
  registerArtifact(compiled, { kind: "csv-plan", descriptor });
  return compiled;
}
function compileCsvStringify(descriptor) {
  const source = emitCsvSource(descriptor);
  const compiled = globalThis.Function(`return ${source};`)();
  registerArtifact(compiled, { kind: "csv-plan", descriptor });
  return compiled;
}

// ../../packages/jit/src/compiler/diff/build-diff-ir.ts
function buildDiffIR(schema) {
  const { body, helpers } = buildRecursiveProgram(
    schema,
    (current, recurse) => buildDiffNode(current, recurse),
    (id) => ({ kind: "recursive", id }),
    findRecursiveSchemas(schema)
  );
  return { kind: "program", leftParam: "left", rightParam: "right", body, helpers };
}
function buildDiffNode(schema, recurse) {
  if (schema.type === TypeName.date) return { kind: "date" };
  if (schema.type === TypeName.union) return buildUnionNode2(schema, recurse);
  if (schema.type === TypeName.intersection) {
    const flattened = flattenObjectIntersection(schema);
    if (flattened !== void 0) return buildDiffNode(flattened, recurse);
    return buildIntersectionNode2(schema, recurse);
  }
  if (schema.type === TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode2(schema, recurse);
  const node = buildSchemaNode(schema, recurse);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };
  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler diff IR for type: ${schema.type}`);
}
function buildUnionNode2(schema, recurse) {
  if (schema.def.options.every((option) => isPrimitiveLikeSchema(option))) {
    return { kind: "reuse" };
  }
  return {
    kind: "union",
    options: schema.def.options.map((option) => ({
      schema: option,
      node: recurse(option)
    }))
  };
}
function buildIntersectionNode2(schema, recurse) {
  return {
    kind: "intersection",
    options: schema.def.options.map(recurse)
  };
}
function buildDiscriminatedUnionNode2(schema, recurse) {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: recurse(option)
    }))
  };
}

// ../../packages/jit/src/compiler/diff/emit-diff.ts
function emitDiff(program) {
  const writer = new CodeWriter();
  emitDiffHelpers(writer, program);
  writer.line(`function diff(${program.leftParam}, ${program.rightParam}) {`);
  writer.indent(
    () => emitDiffBodyLines(writer, createEmitState(), program.body, program.leftParam, program.rightParam)
  );
  writer.line("}");
  return writer.toString();
}
function emitDiffBody(program) {
  const writer = new CodeWriter();
  emitDiffHelpers(writer, program);
  emitDiffBodyLines(writer, createEmitState(), program.body, program.leftParam, program.rightParam);
  return writer.toString();
}
function emitDiffHelpers(writer, program) {
  for (const helper of program.helpers) {
    writer.line(`function ${helperName2(helper.id)}(${program.leftParam}, ${program.rightParam}, changes, path) {`);
    writer.indent(() => {
      writer.line(`if (Object.is(${program.leftParam}, ${program.rightParam})) {`);
      writer.indent(() => writer.line("return;"));
      writer.line("}");
      emitDiffNode(writer, createEmitState(), helper.node, program.leftParam, program.rightParam, [
        { expr: "...path" }
      ]);
    });
    writer.line("}");
  }
}
function helperName2(id) {
  return `diff_${id}`;
}
function emitDiffBodyLines(writer, state, node, left, right) {
  writer.line("const changes = [];");
  emitDiffNode(writer, state, node, left, right, []);
  writer.line("return changes;");
}
function emitDiffNode(writer, state, node, left, right, path) {
  switch (node.kind) {
    case "recursive":
      writer.line(`${helperName2(node.id)}(${left}, ${right}, changes, ${emitPath(path)});`);
      return;
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
function isBareName(expr) {
  return /^[A-Za-z_$][\w$]*$/.test(expr);
}
function hoistOperand(writer, state, expr, prefix) {
  if (isBareName(expr)) return expr;
  const name = state.nextVar(prefix);
  writer.line(`const ${name} = ${expr};`);
  return name;
}
function emitObjectDiff(writer, state, node, left, right, path) {
  const leftBase = node.props.length > 1 ? hoistOperand(writer, state, left, "lo") : left;
  const rightBase = node.props.length > 1 ? hoistOperand(writer, state, right, "ro") : right;
  writer.line(`if (!Object.is(${leftBase}, ${rightBase})) {`);
  writer.indent(() => {
    for (const prop of node.props) {
      const leftValue = emitDefaultedValue(prop.schema, emitPropertyAccess(leftBase, prop.key));
      const rightValue = emitDefaultedValue(prop.schema, emitPropertyAccess(rightBase, prop.key));
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
  const leftBase = node.items.length > 1 ? hoistOperand(writer, state, left, "lt") : left;
  const rightBase = node.items.length > 1 ? hoistOperand(writer, state, right, "rt") : right;
  writer.line(`if (!Object.is(${leftBase}, ${rightBase})) {`);
  writer.indent(() => {
    for (let index2 = 0; index2 < node.items.length; index2++) {
      emitDiffNode(writer, state, node.items[index2], `${leftBase}[${index2}]`, `${rightBase}[${index2}]`, [
        ...path,
        index2
      ]);
    }
  });
  writer.line("}");
}
function emitArrayDiff(writer, state, node, left, right, path) {
  const leftLen = state.nextVar("leftLen");
  const rightLen = state.nextVar("rightLen");
  const commonLen = state.nextVar("commonLen");
  const index2 = state.nextVar("i");
  const leftBase = hoistOperand(writer, state, left, "la");
  const rightBase = hoistOperand(writer, state, right, "ra");
  writer.line(`if (!Object.is(${leftBase}, ${rightBase})) {`);
  writer.indent(() => {
    writer.line(`const ${leftLen} = ${leftBase}.length;`);
    writer.line(`const ${rightLen} = ${rightBase}.length;`);
    writer.line(`const ${commonLen} = ${leftLen} < ${rightLen} ? ${leftLen} : ${rightLen};`);
    writer.line(`for (let ${index2} = 0; ${index2} < ${commonLen}; ${index2}++) {`);
    writer.indent(() => {
      emitDiffNode(writer, state, node.element, `${leftBase}[${index2}]`, `${rightBase}[${index2}]`, [
        ...path,
        { expr: index2 }
      ]);
    });
    writer.line("}");
    writer.line(`for (let ${index2} = ${commonLen}; ${index2} < ${rightLen}; ${index2}++) {`);
    writer.indent(() => emitChange(writer, "add", [...path, { expr: index2 }], `${rightBase}[${index2}]`));
    writer.line("}");
    writer.line(`for (let ${index2} = ${commonLen}; ${index2} < ${leftLen}; ${index2}++) {`);
    writer.indent(() => emitChange(writer, "remove", [...path, { expr: index2 }]));
    writer.line("}");
  });
  writer.line("}");
}
function emitRecordDiff(writer, state, node, left, right, path) {
  const leftKeys = state.nextVar("leftKeys");
  const rightKeys = state.nextVar("rightKeys");
  const len = state.nextVar("len");
  const index2 = state.nextVar("i");
  const key = state.nextVar("key");
  const leftBase = hoistOperand(writer, state, left, "lr");
  const rightBase = hoistOperand(writer, state, right, "rr");
  writer.line(`if (!Object.is(${leftBase}, ${rightBase})) {`);
  writer.indent(() => {
    writer.line(`const ${leftKeys} = Object.keys(${leftBase});`);
    writer.line(`const ${rightKeys} = Object.keys(${rightBase});`);
    writer.line(`for (let ${index2} = 0, ${len} = ${rightKeys}.length; ${index2} < ${len}; ${index2}++) {`);
    writer.indent(() => {
      writer.line(`const ${key} = ${rightKeys}[${index2}];`);
      writer.line(`if (!Object.prototype.hasOwnProperty.call(${leftBase}, ${key})) {`);
      writer.indent(() => emitChange(writer, "add", [...path, { expr: key }], `${rightBase}[${key}]`));
      writer.line("} else {");
      writer.indent(
        () => emitDiffNode(writer, state, node.value, `${leftBase}[${key}]`, `${rightBase}[${key}]`, [...path, { expr: key }])
      );
      writer.line("}");
    });
    writer.line("}");
    writer.line(`for (let ${index2} = 0, ${len} = ${leftKeys}.length; ${index2} < ${len}; ${index2}++) {`);
    writer.indent(() => {
      writer.line(`const ${key} = ${leftKeys}[${index2}];`);
      writer.line(`if (!Object.prototype.hasOwnProperty.call(${rightBase}, ${key})) {`);
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

// ../../packages/jit/src/compiler/execution-optimize.ts
function pass(name, run = (plan) => plan) {
  return Object.freeze({ name, run });
}
var executionOptimizationPasses = Object.freeze([
  pass("normalize", normalizeExecutionPlan),
  pass("inferFacts"),
  pass("normalizeChecks"),
  pass("propagateFacts"),
  pass("removeRedundantChecks", removeRedundantChecks),
  pass("requiredFields"),
  pass("projectionPushdown"),
  pass("deadFields"),
  pass("barriers"),
  pass("materialization"),
  pass("fusion"),
  pass("physicalSpecialization")
]);
function optimizeExecutionPlan(plan) {
  let current = plan;
  for (const optimization of executionOptimizationPasses) current = optimization.run(current);
  return current;
}
function normalizeExecutionPlan(plan) {
  const stages = plan.stages.filter(
    (stage2, index2, all) => stage2.kind !== "to.array" || all[index2 - 1]?.kind !== "to.array"
  );
  return stages.length === plan.stages.length ? plan : freezePlan(plan, stages);
}
function removeRedundantChecks(plan) {
  const stages = [];
  for (const stage2 of plan.stages) {
    const previous = stages[stages.length - 1];
    const redundant = stage2.kind === "validate" && stage2.operation === "parse" && previous?.kind === "validate" && previous.operation === "parse" && previous.schema === stage2.schema && canUseFastParse(stage2.schema);
    if (!redundant) stages.push(stage2);
  }
  return stages.length === plan.stages.length ? plan : freezePlan(plan, stages);
}
function freezePlan(plan, stages) {
  return Object.freeze({ ...plan, stages: Object.freeze([...stages]) });
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

// ../../packages/jit/src/compiler/indexing.ts
function resolveIndexKeysFromFacts(schema) {
  const hints = resolveHints(schema);
  const key = resolveHintKey(hints.index?.key) ?? resolveHintKey(hints.collection?.identify) ?? resolveHintKey(hints.collection?.uniqueBy) ?? resolveHintKey(hints.entity?.key);
  return key ? [key] : void 0;
}
function resolveIndexDescriptor(schema, keys, shape) {
  const object2 = resolveRowObjectSchema(schema, "index");
  const resolvedKeys = keys ?? resolveIndexKeysFromFacts(schema);
  if (!resolvedKeys || resolvedKeys.length === 0) {
    throw new JITError(
      "INVALID_OPERATION",
      "index requires a key: declare one with .keyed(), .indexBy() or .uniqueBy(), or pass it to .by()"
    );
  }
  const seen = /* @__PURE__ */ new Set();
  const indexKeys = resolvedKeys.map((key) => {
    const field = resolveRowField(object2, key, "index");
    if (seen.has(key)) {
      throw new JITError("INVALID_OPERATION", `index repeats key ${JSON.stringify(key)}`, { path: [key] });
    }
    seen.add(key);
    return Object.freeze({
      key,
      valueKind: resolveIndexKeyKind(field, key),
      nullish: isNullishField(field)
    });
  });
  const hints = resolveHints(schema);
  return Object.freeze({
    keys: Object.freeze(indexKeys),
    shape,
    uniqueByFact: hints.collection?.unique === true || hints.entity?.key !== void 0
  });
}
function emitIndexBuilder(writer, descriptor, open = "(value) => {", close = "}") {
  const depth = descriptor.keys.length;
  writer.line(open);
  writer.indent(() => {
    writer.line("const index = new Map();");
    writer.line("const len = value.length;");
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      writer.line("const row = value[i];");
      descriptor.keys.forEach((key, level) => {
        writer.line(`const key${level} = ${emitIndexKeyRead("row", key)};`);
      });
      for (let level = 0; level < depth - 1; level++) {
        const parent = level === 0 ? "index" : `level${level}`;
        writer.line(`let level${level + 1} = ${parent}.get(key${level});`);
        writer.line(`if (level${level + 1} === undefined) {`);
        writer.indent(() => {
          writer.line(`level${level + 1} = new Map();`);
          writer.line(`${parent}.set(key${level}, level${level + 1});`);
        });
        writer.line("}");
      }
      const bucket = depth === 1 ? "index" : `level${depth - 1}`;
      const lastKey = `key${depth - 1}`;
      if (descriptor.shape === "grouped") {
        writer.line(`const group = ${bucket}.get(${lastKey});`);
        writer.line("if (group === undefined) {");
        writer.indent(() => writer.line(`${bucket}.set(${lastKey}, [row]);`));
        writer.line("} else {");
        writer.indent(() => writer.line("group[group.length] = row;"));
        writer.line("}");
      } else {
        writer.line(`${bucket}.set(${lastKey}, row);`);
      }
    });
    writer.line("}");
    writer.line("return index;");
  });
  writer.line(close);
}
function emitIndexPlanSource(descriptor, cacheKey3) {
  const writer = new CodeWriter();
  writer.line("((__cache) => {");
  writer.indent(() => {
    emitIndexBuilder(writer, descriptor, "const build = (value) => {", "};");
    writer.line(`const cached = (value) => __cache(value, ${JSON.stringify(cacheKey3)}, build);`);
    writer.line('Object.defineProperty(build, "cached", { value: cached });');
    writer.line("return build;");
  });
  writer.line("})");
  return writer.toString();
}
function emitIndexKeyRead(row, key) {
  const access2 = emitPropertyAccess(row, key.key);
  if (key.valueKind !== "date") return access2;
  return key.nullish ? `(${access2} == null ? ${access2} : ${access2}.getTime())` : `${access2}.getTime()`;
}
function indexCacheKey(descriptor) {
  return `index:${descriptor.shape}:${descriptor.keys.map(({ key, valueKind, nullish: nullish3 }) => `${key}:${valueKind}:${nullish3}`).join(",")}`;
}
function compileIndex(schema, descriptor, runtimeIndexCache, options) {
  const cacheKey3 = indexCacheKey(descriptor);
  const template = getCompileCached(
    schema,
    cacheKey3,
    () => {
      const source = emitIndexPlanSource(descriptor, cacheKey3);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create()(runtimeIndexCache);
  registerArtifact(compiled, { kind: "index-plan", schema, descriptor });
  return compiled;
}
function resolveIndexKeyKind(schema, key) {
  const kind = resolveScalarKeyKind(schema, key, "index");
  return kind === "numeric" ? "direct" : kind;
}

// ../../packages/jit/src/compiler/join.ts
function createJoinPlan(leftSchema, rightSchema, leftProgram, kind, leftKey, rightKey) {
  assertJoinPrefix(leftProgram);
  const leftIndex = resolveIndexDescriptor(leftSchema, [leftKey], "unique");
  const hints = resolveHints(rightSchema);
  const leftHints = resolveHints(leftSchema);
  const leftOrdered = leftHints.order ?? leftHints.collection?.ordered;
  const rightOrdered = hints.order ?? hints.collection?.ordered;
  const leftOrderedKey = resolveHintKey(leftOrdered?.key);
  const rightOrderedKey = resolveHintKey(rightOrdered?.key);
  const leftDirection = leftOrdered?.direction === "desc" ? "desc" : "asc";
  const rightDirection = rightOrdered?.direction === "desc" ? "desc" : "asc";
  const keyed = hints.entity?.cacheIndex === true;
  const declaredKey = resolveHintKey(hints.index?.key) ?? resolveHintKey(hints.entity?.key);
  const merge2 = leftOrderedKey === leftKey && rightOrderedKey === rightKey && leftDirection === rightDirection;
  const strategy = merge2 ? "MergeJoin" : keyed && declaredKey === rightKey ? "IndexedJoin" : "HashJoin";
  const rightUnique = hints.collection?.unique === true || hints.entity?.key !== void 0;
  const rightIndex = resolveIndexDescriptor(
    rightSchema,
    [rightKey],
    kind === "semi" || kind === "anti" || rightUnique ? "unique" : "grouped"
  );
  const leftDomain = resolveScalarKeyDomain(
    resolveRowField(resolveRowObjectSchema(leftSchema, "join"), leftKey, "join"),
    leftKey,
    "join"
  );
  const rightDomain = resolveScalarKeyDomain(
    resolveRowField(resolveRowObjectSchema(rightSchema, "join"), rightKey, "join"),
    rightKey,
    "join"
  );
  if (leftDomain !== rightDomain) {
    throw new JITError("INVALID_QUERY", "join keys must have compatible scalar representations", {
      path: [leftKey, rightKey]
    });
  }
  return Object.freeze({
    kind,
    leftSchema,
    rightSchema,
    leftKey,
    rightKey,
    leftIndex,
    rightIndex,
    direction: merge2 ? leftDirection : "asc",
    strategy,
    reason: strategy === "MergeJoin" ? "both collections declare compatible ordering on the join keys" : strategy === "IndexedJoin" ? "the right collection declares a reusable keyed index" : "the right side is hashed once before scanning the left side",
    complexity: strategy === "IndexedJoin" ? "O(n + k) expected after cached build" : "O(n + m + k)",
    leftProgram
  });
}
function explainJoinPlan(plan) {
  return Object.freeze({
    strategy: plan.strategy,
    reason: plan.reason,
    complexity: plan.complexity,
    facts: Object.freeze([
      `join: ${plan.kind}`,
      `keys: ${plan.leftKey} = ${plan.rightKey}`,
      ...plan.strategy === "IndexedJoin" ? ["right index cache: enabled"] : [],
      ...plan.strategy === "MergeJoin" ? [`ordered: ${plan.direction}`] : []
    ])
  });
}
function emitJoinSource(plan) {
  const writer = new CodeWriter();
  const hasParams = Boolean(plan.leftProgram.params?.length);
  const grouped = plan.rightIndex.shape === "grouped";
  writer.line("(() => {");
  writer.indent(() => {
    if (plan.strategy === "IndexedJoin") {
      emitIndexBuilder(writer, plan.rightIndex, "const build = (value) => {", "};");
    }
    writer.line(`function join(left, right${hasParams ? ", params" : ""}) {`);
    writer.indent(() => {
      if (plan.strategy === "MergeJoin") {
        emitMergeJoin(writer, plan);
        return;
      }
      if (plan.strategy === "IndexedJoin") {
        writer.line(`const index = __cachedIndex(right, ${JSON.stringify(indexCacheKey(plan.rightIndex))}, build);`);
      } else {
        emitIndexBuilder(writer, plan.rightIndex, "const index = ((value) => {", "})(right);");
      }
      writer.line("const len = left.length;");
      writer.line("const out = new Array(len);");
      writer.line("let k = 0;");
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        writer.line("const leftRow = left[i];");
        const guard = emitLeftGuard(plan.leftProgram, "leftRow");
        if (guard) {
          writer.line(`if (!(${guard})) continue;`);
        }
        const key = plan.rightIndex.keys[0];
        const leftKey = plan.leftIndex.keys[0];
        if (!key || !leftKey) throw new JITError("INVALID_QUERY", "join requires scalar keys");
        const leftRead = emitPropertyAccess("leftRow", plan.leftKey);
        const probe = leftKey.valueKind === "date" ? leftKey.nullish ? `(${leftRead} == null ? ${leftRead} : ${leftRead}.getTime())` : `${leftRead}.getTime()` : leftRead;
        writer.line(`const match = index.get(${probe});`);
        emitJoinResult(writer, plan.kind, grouped);
      });
      writer.line("}");
      writer.line("out.length = k;");
      writer.line("return out;");
    });
    writer.line("}");
    writer.line("return join;");
  });
  writer.line("})()");
  return writer.toString();
}
function emitMergeJoin(writer, plan) {
  const rightKey = plan.rightIndex.keys[0];
  const leftKeyDescriptor = plan.leftIndex.keys[0];
  if (!rightKey || !leftKeyDescriptor) throw new JITError("INVALID_QUERY", "merge join requires scalar keys");
  const readKey2 = (row, key, descriptor) => {
    const access2 = emitPropertyAccess(row, key);
    if (descriptor.valueKind !== "date") return access2;
    return descriptor.nullish ? `(${access2} == null ? ${access2} : ${access2}.getTime())` : `${access2}.getTime()`;
  };
  const leftBefore = plan.direction === "asc" ? "leftKey < rightKey" : "leftKey > rightKey";
  const leftAfter = plan.direction === "asc" ? "leftKey > rightKey" : "leftKey < rightKey";
  const guard = emitLeftGuard(plan.leftProgram, "leftRow");
  const emitUnmatched = () => {
    if (plan.kind === "left") writer.line("out[k++] = { left: leftRow, right: undefined };");
    else if (plan.kind === "anti") writer.line("out[k++] = leftRow;");
  };
  writer.line("const leftLen = left.length;");
  writer.line("const rightLen = right.length;");
  writer.line("const out = new Array(leftLen);");
  writer.line("let i = 0;");
  writer.line("let j = 0;");
  writer.line("let k = 0;");
  writer.line("while (i < leftLen && j < rightLen) {");
  writer.indent(() => {
    writer.line("const leftRow = left[i];");
    writer.line(`const leftKey = ${readKey2("leftRow", plan.leftKey, leftKeyDescriptor)};`);
    writer.line(`const rightKey = ${readKey2("right[j]", plan.rightKey, rightKey)};`);
    writer.line(`if (${leftBefore}) {`);
    writer.indent(() => {
      if (guard) writer.line(`if (${guard}) {`);
      if (guard) writer.indent(emitUnmatched);
      else emitUnmatched();
      if (guard) writer.line("}");
      writer.line("i++;");
      writer.line("continue;");
    });
    writer.line("}");
    writer.line(`if (${leftAfter}) { j++; continue; }`);
    writer.line("let rightEnd = j + 1;");
    writer.line(
      `while (rightEnd < rightLen && ${readKey2("right[rightEnd]", plan.rightKey, rightKey)} === rightKey) rightEnd++;`
    );
    writer.line("do {");
    writer.indent(() => {
      writer.line("const leftRow = left[i];");
      if (guard) writer.line(`if (${guard}) {`);
      if (guard) writer.indent(() => emitMergeMatch(writer, plan.kind));
      else emitMergeMatch(writer, plan.kind);
      if (guard) writer.line("}");
      writer.line("i++;");
    });
    writer.line(`} while (i < leftLen && ${readKey2("left[i]", plan.leftKey, leftKeyDescriptor)} === leftKey);`);
    writer.line("j = rightEnd;");
  });
  writer.line("}");
  if (plan.kind === "left" || plan.kind === "anti") {
    writer.line("while (i < leftLen) {");
    writer.indent(() => {
      writer.line("const leftRow = left[i++];");
      if (guard) writer.line(`if (!(${guard})) continue;`);
      emitUnmatched();
    });
    writer.line("}");
  }
  writer.line("out.length = k;");
  writer.line("return out;");
}
function emitMergeMatch(writer, kind) {
  if (kind === "semi") {
    writer.line("out[k++] = leftRow;");
    return;
  }
  if (kind === "anti") return;
  writer.line("for (let q = j; q < rightEnd; q++) out[k++] = { left: leftRow, right: right[q] };");
}
function emitJoinResult(writer, kind, grouped) {
  if (kind === "semi") {
    writer.line("if (match !== undefined) out[k++] = leftRow;");
    return;
  }
  if (kind === "anti") {
    writer.line("if (match === undefined) out[k++] = leftRow;");
    return;
  }
  if (!grouped) {
    if (kind === "inner") writer.line("if (match !== undefined) out[k++] = { left: leftRow, right: match };");
    else writer.line("out[k++] = { left: leftRow, right: match };");
    return;
  }
  writer.line("if (match === undefined) {");
  writer.indent(() => {
    if (kind === "left") writer.line("out[k++] = { left: leftRow, right: undefined };");
  });
  writer.line("} else {");
  writer.indent(() => {
    writer.line("const matchLen = match.length;");
    writer.line("for (let j = 0; j < matchLen; j++) out[k++] = { left: leftRow, right: match[j] };");
  });
  writer.line("}");
}
function assertJoinPrefix(program) {
  for (const node of program.nodes) {
    if (node.kind !== "filter") {
      throw new JITError(
        "INVALID_QUERY",
        "join v1 accepts params and where/filter before join; shape, ordering, terminal and mutation stages must follow a future fused plan"
      );
    }
  }
}
function emitLeftGuard(program, row) {
  const filters = program.nodes.filter((node) => node.kind === "filter");
  if (filters.length === 0) return void 0;
  return filters.map((filter) => `(${emitCondition(filter.condition, row)})`).join(" && ");
}
function emitCondition(condition, row) {
  if (condition.kind === "logical") {
    const operator = condition.op === "and" ? "&&" : "||";
    return `(${emitCondition(condition.left, row)} ${operator} ${emitCondition(condition.right, row)})`;
  }
  if (condition.kind === "not") return `!(${emitCondition(condition.inner, row)})`;
  const operators = { eq: "===", neq: "!==", gt: ">", gte: ">=", lt: "<", lte: "<=" };
  return `${emitValue(condition.left, row)} ${operators[condition.op]} ${emitValue(condition.right, row)}`;
}
function emitValue(value, row) {
  if (value.kind === "field") return emitPropertyAccess(row, value.key);
  if (value.kind === "literal") return emitLiteral(value.value);
  if (value.kind === "param") return emitPropertyAccess("params", value.name);
  return value.name;
}
function compileJoin(plan, options) {
  const names = plan.leftProgram.bindings.map((_, index2) => `__q${index2}`);
  const key = `join:${plan.kind}:${plan.leftKey}:${plan.rightKey}:${plan.strategy}:${plan.direction}:${indexCacheKey(plan.leftIndex)}:${indexCacheKey(plan.rightIndex)}:${JSON.stringify(plan.leftProgram.nodes)}:${plan.leftProgram.params?.join(",") ?? ""}`;
  const template = getCompileCached(
    plan.leftSchema,
    key,
    () => {
      const source = emitJoinSource(plan);
      return { source, create: globalThis.Function("__cachedIndex", ...names, `return ${source};`) };
    },
    options
  );
  const compiled = template.create(getCachedIndex, ...plan.leftProgram.bindings);
  registerArtifact(compiled, { kind: "join-plan", plan });
  return compiled;
}

// ../../packages/jit/src/compiler/serialize/emit-serialize.ts
function emitSerialize(schema) {
  const writer = new CodeWriter();
  const context = {
    writer,
    varCounter: 0,
    recursive: findRecursiveSchemas(schema),
    helperIds: /* @__PURE__ */ new Map(),
    emitted: /* @__PURE__ */ new Set(),
    pending: []
  };
  const needsStringHelper = hasStringLeaf2(schema, /* @__PURE__ */ new Set());
  writer.line("(function () {");
  writer.indent(() => {
    if (needsStringHelper) emitStringHelper(writer);
    emitSerializeHelpers(context);
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
function emitSerializeHelpers(context) {
  for (const target of context.recursive) queueHelper(context, target);
  while (context.pending.length > 0) {
    const target = context.pending.shift();
    const writer = context.writer;
    writer.line(`function ${context.helperIds.get(target)}(value) {`);
    writer.indent(() => {
      writer.line('let s = "";');
      emitBaseAppend(context, resolveSerializeWrappers(target).base, "value");
      writer.line("return s;");
    });
    writer.line("}");
  }
}
function queueHelper(context, target) {
  const existing = context.helperIds.get(target);
  if (existing) return existing;
  const id = `stringify_r${context.helperIds.size + 1}`;
  context.helperIds.set(target, id);
  context.emitted.add(target);
  context.pending.push(target);
  return id;
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
    case TypeName.intersection: {
      const options = current.def.options ?? [];
      return options.some((option) => hasStringLeaf2(option, seen));
    }
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
    case TypeName.runtimeType:
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
  if (context.recursive.has(resolved.base)) {
    const call2 = `${queueHelper(context, resolved.base)}(${valueExpr})`;
    if (resolved.nullable || resolved.optional) {
      writer.line(`s += ${valueExpr} == null ? "null" : ${call2};`);
    } else {
      writer.line(`s += ${call2};`);
    }
    return;
  }
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
    case TypeName.intersection: {
      const flattened = flattenObjectIntersection(schema);
      if (flattened === void 0) break;
      emitObjectAppend(context, flattened, valueExpr);
      return;
    }
    case TypeName.array: {
      const element = schema.def.element;
      const holder = hoist3(context, valueExpr);
      const index2 = nextVar3(context, "i");
      const item = nextVar3(context, "e");
      writer.line(`s += "[";`);
      writer.line(`for (let ${index2} = 0; ${index2} < ${holder}.length; ${index2}++) {`);
      writer.indent(() => {
        writer.line(`if (${index2} !== 0) s += ",";`);
        writer.line(`const ${item} = ${holder}[${index2}];`);
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
      const index2 = nextVar3(context, "i");
      const item = nextVar3(context, "e");
      writer.line(`s += "{";`);
      writer.line(`const ${keys} = Object.keys(${holder});`);
      writer.line(`for (let ${index2} = 0; ${index2} < ${keys}.length; ${index2}++) {`);
      writer.indent(() => {
        writer.line(`if (${index2} !== 0) s += ",";`);
        writer.line(`s += str(${keys}[${index2}]) + ":";`);
        writer.line(`const ${item} = ${holder}[${keys}[${index2}]];`);
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
  }
  throw new JITError(
    "UNSUPPORTED_SCHEMA",
    `serialize does not support ${schema.type} schemas (not representable in JSON)`
  );
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
      case TypeName.runtimeType:
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

// ../../packages/jit/src/compiler/json-schema/dialects.ts
var DIALECTS = {
  "draft-2020-12": {
    target: "draft-2020-12",
    uri: "https://json-schema.org/draft/2020-12/schema",
    defs: "$defs",
    refSiblings: true,
    constKeyword: true,
    prefixItems: true,
    exclusiveAsNumber: true,
    nullableKeyword: false,
    examplesKeyword: "examples",
    contentEncoding: true,
    typeUnions: true
  },
  "draft-07": {
    target: "draft-07",
    uri: "http://json-schema.org/draft-07/schema#",
    defs: "definitions",
    // Draft-07 readers ignore keywords beside `$ref`, so siblings must be
    // wrapped in `allOf` to survive.
    refSiblings: false,
    constKeyword: true,
    prefixItems: false,
    exclusiveAsNumber: true,
    nullableKeyword: false,
    examplesKeyword: "examples",
    contentEncoding: true,
    typeUnions: true
  },
  "draft-04": {
    target: "draft-04",
    uri: "http://json-schema.org/draft-04/schema#",
    defs: "definitions",
    refSiblings: false,
    constKeyword: false,
    prefixItems: false,
    exclusiveAsNumber: false,
    nullableKeyword: false,
    examplesKeyword: "examples",
    contentEncoding: false,
    typeUnions: true
  },
  "openapi-3.0": {
    target: "openapi-3.0",
    // OpenAPI Schema Objects are embedded in a document that declares the
    // version itself, so they never carry `$schema`.
    uri: void 0,
    defs: "definitions",
    refSiblings: false,
    constKeyword: false,
    prefixItems: false,
    exclusiveAsNumber: false,
    nullableKeyword: true,
    examplesKeyword: "example",
    contentEncoding: true,
    typeUnions: false
  }
};
var ALIASES = {
  "draft-4": "draft-04",
  "draft-7": "draft-07",
  "2020-12": "draft-2020-12",
  openapi: "openapi-3.0",
  "openapi-3": "openapi-3.0",
  "openapi-3.1": "draft-2020-12"
};
function resolveDialect(target = "draft-2020-12") {
  const canonical2 = ALIASES[target] ?? target;
  const dialect = DIALECTS[canonical2];
  if (!dialect) {
    throw new JITError(
      "INVALID_OPERATION",
      `unknown JSON Schema target "${target}"; expected one of ${Object.keys(DIALECTS).join(", ")}`
    );
  }
  return dialect;
}
var JSON_SCHEMA_TARGETS = Object.keys(DIALECTS);

// ../../packages/jit/src/compiler/json-schema/from-json-schema.ts
var FORMAT_CHECKS = {
  email: "email",
  "idn-email": "email",
  uuid: "uuid",
  uri: "url",
  "uri-reference": "url",
  url: "url",
  "date-time": "datetime",
  date: "plainDate",
  time: "plainTime",
  duration: "duration",
  ipv4: "ipv4",
  ipv6: "ipv6",
  hostname: "hostname",
  regex: "regex"
};
function compileSchemaFromJson(document, options = {}) {
  return new SchemaBuilder(document, options).build(document, []);
}
var KNOWN_KEYWORDS = /* @__PURE__ */ new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "prefixItems",
  "additionalItems",
  "anyOf",
  "oneOf",
  "allOf",
  "nullable",
  "default",
  "title",
  "description",
  "deprecated",
  "examples",
  "example",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "readOnly",
  "contentEncoding",
  "contentMediaType"
]);
var SchemaBuilder = class {
  constructor(root, options) {
    this.root = root;
    this.options = options;
    this.building = /* @__PURE__ */ new Map();
  }
  build(node, path) {
    this.assertKnown(node, path);
    const resolved = this.resolve(node, path);
    const started = this.building.get(resolved);
    if (started !== void 0) return started;
    const placeholder = createSchema(TypeName.lazy, {
      getter: () => this.building.get(resolved) ?? unknownSchema()
    });
    this.building.set(resolved, placeholder);
    const built = this.shape(resolved, path);
    const annotated = annotate(built, resolved);
    const refined = this.options.refine?.({ node: resolved, path, schema: annotated });
    const result = refined ?? annotated;
    this.building.set(resolved, result);
    return result;
  }
  assertKnown(node, path) {
    if (this.options.unknownKeywords !== "throw") return;
    const unknown2 = Object.keys(node).filter((keyword) => !KNOWN_KEYWORDS.has(keyword));
    if (unknown2.length > 0) {
      throw new JITError(
        "INVALID_OPERATION",
        `JSON Schema keyword(s) ${unknown2.join(", ")} at /${path.join("/")} have no compiled equivalent; use refine to express them or unknownKeywords: "ignore"`
      );
    }
  }
  /** Follows a local `$ref` into the document's definitions. */
  resolve(node, path) {
    const reference = node.$ref;
    if (typeof reference !== "string") return node;
    if (reference === "#") return this.root;
    const match2 = /^#\/(\$defs|definitions)\/(.+)$/.exec(reference);
    if (!match2) {
      throw new JITError(
        "INVALID_OPERATION",
        `cannot resolve external $ref "${reference}" at /${path.join("/")}; inline the definition or pass it through refine`
      );
    }
    const defs = this.root[match2[1]];
    const target = defs?.[match2[2]];
    if (!target) {
      throw new JITError(
        "INVALID_OPERATION",
        `$ref "${reference}" at /${path.join("/")} was not found in the document`
      );
    }
    return target;
  }
  shape(node, path) {
    if ("const" in node) return literalSchema(node.const);
    if (Array.isArray(node.enum)) {
      const values = node.enum;
      if (values.length === 1) return literalSchema(values[0]);
      return union(values.map((value) => literalSchema(value)));
    }
    for (const keyword of ["anyOf", "oneOf"]) {
      const options = node[keyword];
      if (Array.isArray(options)) {
        return union(options.map((option, index2) => this.build(option, [...path, keyword, index2])));
      }
    }
    if (Array.isArray(node.allOf)) {
      const options = node.allOf.map(
        (option, index2) => this.build(option, [...path, "allOf", index2])
      );
      return options.length === 1 ? options[0] : createSchema(TypeName.intersection, { options });
    }
    if (node.nullable === true) {
      const inner = this.shape({ ...node, nullable: void 0 }, path);
      return createSchema(TypeName.nullable, { innerType: inner });
    }
    if (Array.isArray(node.type)) {
      const types = node.type;
      const nullable3 = types.includes("null");
      const rest = types.filter((entry) => entry !== "null");
      const inner = rest.length === 1 ? this.primitive(rest[0], node, path) : union(rest.map((entry) => this.primitive(entry, node, path)));
      return nullable3 ? createSchema(TypeName.nullable, { innerType: inner }) : inner;
    }
    if (typeof node.type === "string") return this.primitive(node.type, node, path);
    return unknownSchema();
  }
  primitive(type, node, path) {
    switch (type) {
      case "string":
        return withChecks(createSchema(TypeName.string, {}), stringChecks(node));
      case "integer":
        return withChecks(createSchema(TypeName.int, {}), numberChecks(node));
      case "number":
        return withChecks(createSchema(TypeName.number, {}), numberChecks(node));
      case "boolean":
        return createSchema(TypeName.boolean, {});
      case "null":
        return createSchema(TypeName.null, {});
      case "array":
        return this.arraySchema(node, path);
      case "object":
        return this.objectSchema(node, path);
      default:
        return unknownSchema();
    }
  }
  arraySchema(node, path) {
    const prefix = node.prefixItems ?? (Array.isArray(node.items) ? node.items : void 0);
    if (prefix) {
      const rest = node.additionalItems ?? (Array.isArray(node.items) ? void 0 : node.items);
      return createSchema(TypeName.tuple, {
        items: prefix.map((item, index2) => this.build(item, [...path, index2])),
        ...rest && typeof rest === "object" ? { rest: this.build(rest, [...path, "items"]) } : {}
      });
    }
    const element = node.items && typeof node.items === "object" ? this.build(node.items, [...path, "items"]) : unknownSchema();
    return withChecks(createSchema(TypeName.array, { element }), arrayChecks(node));
  }
  objectSchema(node, path) {
    const properties = node.properties;
    if (!properties) {
      const value = node.additionalProperties && typeof node.additionalProperties === "object" ? this.build(node.additionalProperties, [...path, "additionalProperties"]) : unknownSchema();
      return createSchema(TypeName.record, {
        key: createSchema(TypeName.string, {}),
        value
      });
    }
    const required2 = new Set(node.required ?? []);
    const props = {};
    for (const key of Object.keys(properties)) {
      const built = this.build(properties[key], [...path, "properties", key]);
      props[key] = required2.has(key) ? built : createSchema(TypeName.optional, { innerType: built });
    }
    return createSchema(TypeName.object, { props });
  }
};
function union(options) {
  if (options.length === 0) return unknownSchema();
  if (options.length === 1) return options[0];
  return createSchema(TypeName.union, { options });
}
function literalSchema(value) {
  if (value === null) return createSchema(TypeName.null, {});
  return createSchema(TypeName.literal, { value });
}
function unknownSchema() {
  return createSchema(TypeName.unknown, {});
}
function withChecks(schema, checks) {
  if (checks.length === 0) return schema;
  return { ...schema, def: { ...schema.def, checks } };
}
function annotate(schema, node) {
  const metadata = {
    ...typeof node.title === "string" ? { title: node.title } : {},
    ...typeof node.description === "string" ? { description: node.description } : {},
    ...node.deprecated === true ? { deprecated: true } : {},
    ...Array.isArray(node.examples) ? { examples: [...node.examples] } : {},
    ...node.example !== void 0 ? { examples: [node.example] } : {},
    ...typeof node.$id === "string" ? { id: node.$id } : {}
  };
  const withDefault = node.default === void 0 ? schema : createSchema(TypeName.default, { innerType: schema, defaultValue: node.default });
  if (Object.keys(metadata).length === 0) return withDefault;
  return {
    ...withDefault,
    annotations: { ...withDefault.annotations ?? {}, metadata }
  };
}
function stringChecks(node) {
  const checks = [];
  const format3 = typeof node.format === "string" ? FORMAT_CHECKS[node.format] : void 0;
  if (typeof node.minLength === "number") checks.push({ kind: "min", value: node.minLength });
  if (typeof node.maxLength === "number") checks.push({ kind: "max", value: node.maxLength });
  if (typeof node.pattern === "string") checks.push({ kind: "regex", value: new RegExp(node.pattern) });
  if (format3) checks.push({ kind: format3 });
  return checks;
}
function numberChecks(node) {
  const checks = [];
  if (typeof node.minimum === "number") {
    checks.push(
      node.exclusiveMinimum === true ? { kind: "moreThan", value: node.minimum } : { kind: "min", value: node.minimum }
    );
  }
  if (typeof node.maximum === "number") {
    checks.push(
      node.exclusiveMaximum === true ? { kind: "lessThan", value: node.maximum } : { kind: "max", value: node.maximum }
    );
  }
  if (typeof node.exclusiveMinimum === "number") checks.push({ kind: "moreThan", value: node.exclusiveMinimum });
  if (typeof node.exclusiveMaximum === "number") checks.push({ kind: "lessThan", value: node.exclusiveMaximum });
  if (typeof node.multipleOf === "number") checks.push({ kind: "multipleOf", value: node.multipleOf });
  if (node.format === "int32") checks.push({ kind: "int32" });
  return checks;
}
function arrayChecks(node) {
  const checks = [];
  if (typeof node.minItems === "number") checks.push({ kind: "min", value: node.minItems });
  if (typeof node.maxItems === "number") checks.push({ kind: "max", value: node.maxItems });
  if (node.uniqueItems === true) checks.push({ kind: "unique" });
  return checks;
}

// ../../packages/jit/src/compiler/json-schema/to-json-schema.ts
var DOCUMENTS = /* @__PURE__ */ new WeakMap();
var UNSUPPORTED_TYPES = {
  [TypeName.bigint]: "bigint has no JSON representation",
  [TypeName.symbol]: "symbol has no JSON representation",
  [TypeName.map]: "Map is not JSON data",
  [TypeName.set]: "Set is not JSON data",
  [TypeName.file]: "File is not JSON data",
  [TypeName.promise]: "a promise cannot be described as a JSON value",
  [TypeName.undefined]: "undefined has no JSON representation",
  [TypeName.void]: "void has no JSON representation",
  [TypeName.function]: "a function has no JSON representation",
  [TypeName.instanceof]: "an instanceof check has no JSON representation",
  [TypeName.custom]: "a custom check has no JSON representation",
  [TypeName.never]: "never accepts no value"
};
function compileJsonSchema(schema, options = {}) {
  const cacheable = options.override === void 0 && typeof options.unsupported !== "function";
  const cacheKey3 = cacheable ? describeOptions(options) : void 0;
  const cached = cacheKey3 === void 0 ? void 0 : DOCUMENTS.get(schema)?.get(cacheKey3);
  if (cached) return cached;
  const document = new JsonSchemaEmitter(options).document(schema);
  if (cacheKey3 !== void 0) {
    const documents = DOCUMENTS.get(schema);
    if (documents) documents.set(cacheKey3, document);
    else DOCUMENTS.set(schema, /* @__PURE__ */ new Map([[cacheKey3, document]]));
  }
  registerArtifact(document, { kind: "operation", schema, op: "jsonSchema" });
  return document;
}
function describeOptions(options) {
  return [
    options.target ?? "draft-2020-12",
    options.io ?? "output",
    options.unsupported ?? "throw",
    options.cycles ?? "ref",
    options.reused ?? "inline",
    options.dialect ?? "auto",
    options.additionalProperties ?? "auto",
    options.ref ? "uri" : "id"
  ].join("|");
}
var JsonSchemaEmitter = class {
  constructor(options) {
    this.options = options;
    this.names = /* @__PURE__ */ new Map();
    this.defs = /* @__PURE__ */ new Map();
    this.open = /* @__PURE__ */ new Set();
    this.extracted = /* @__PURE__ */ new Set();
    this.cyclic = /* @__PURE__ */ new Set();
    this.reused = /* @__PURE__ */ new Set();
    this.dialect = resolveDialect(options.target);
    this.input = options.io === "input";
  }
  document(schema) {
    this.survey(schema);
    const body = this.emit(schema, []);
    const includeDialect = this.options.dialect ?? this.dialect.uri !== void 0;
    return Object.freeze({
      ...includeDialect && this.dialect.uri ? { $schema: this.dialect.uri } : {},
      ...body,
      ...this.defs.size > 0 ? { [this.dialect.defs]: Object.freeze(Object.fromEntries(this.defs)) } : {}
    });
  }
  /** One walk that records both cycle participants and repeated schemas. */
  survey(schema, stack = /* @__PURE__ */ new Set(), seen = /* @__PURE__ */ new Set()) {
    if (stack.has(schema)) {
      this.cyclic.add(schema);
      return;
    }
    if (seen.has(schema)) {
      this.reused.add(schema);
      return;
    }
    seen.add(schema);
    stack.add(schema);
    for (const child of children(schema)) this.survey(child, stack, seen);
    stack.delete(schema);
  }
  /** True when this schema must live in the defs rather than be inlined. */
  extractable(schema) {
    if (this.cyclic.has(schema)) return true;
    return this.options.reused === "ref" && this.reused.has(schema);
  }
  emit(schema, path) {
    if (!this.extractable(schema)) return Object.freeze(this.build(schema, path));
    if (this.cyclic.has(schema) && this.options.cycles === "throw") {
      throw new JITError(
        "INVALID_OPERATION",
        `cannot inline a recursive schema at /${path.join("/")}; use cycles: "ref" to break it with $ref`
      );
    }
    const name = this.nameFor(schema);
    if (!this.open.has(schema) && !this.extracted.has(schema)) {
      this.extracted.add(schema);
      this.open.add(schema);
      this.defs.set(name, Object.freeze(this.build(schema, path)));
      this.open.delete(schema);
    }
    return Object.freeze({ $ref: `#/${this.dialect.defs}/${name}` });
  }
  /** `$ref` plus siblings, in whichever form the dialect understands. */
  withRef(reference, siblings) {
    if (Object.keys(siblings).length === 0) return { ...reference };
    if (this.dialect.refSiblings) return { ...reference, ...siblings };
    return { allOf: [reference], ...siblings };
  }
  nameFor(schema) {
    const existing = this.names.get(schema);
    if (existing) return existing;
    const metadata = metadataOf(schema);
    const preferred = metadata?.id && isIdentifier(metadata.id) ? metadata.id : metadata?.title && isIdentifier(metadata.title) ? metadata.title : `schema${this.names.size + 1}`;
    let candidate = preferred;
    let suffix = 1;
    while ([...this.names.values()].includes(candidate)) candidate = `${preferred}${++suffix}`;
    this.names.set(schema, candidate);
    return candidate;
  }
  build(schema, path) {
    const node = { ...this.shape(schema, path), ...this.annotate(schema) };
    this.options.override?.({ schema, path, node, target: this.dialect.target });
    return node;
  }
  /** Applies the `unsupported` policy for a type with no JSON form. */
  unsupported(schema, path, message) {
    const policy = this.options.unsupported ?? "throw";
    const decision = typeof policy === "function" ? policy({ schema, path, message }) ?? "throw" : policy;
    if (decision === "any") return {};
    if (decision === "throw") {
      throw new JITError(
        "INVALID_OPERATION",
        `${message} (at /${path.join("/")}); pass unsupported: "any" to emit {} instead, or a function to substitute a node`
      );
    }
    return { ...decision };
  }
  shape(schema, path) {
    const current = schema;
    const checks = current.def.checks ?? [];
    const reason = UNSUPPORTED_TYPES[current.type];
    if (reason) return this.unsupported(schema, path, reason);
    switch (current.type) {
      case TypeName.string:
      case TypeName.templateLiteral:
        return { type: "string", ...this.stringConstraints(checks) };
      case TypeName.int:
        return { type: "integer", ...this.numberConstraints(checks) };
      case TypeName.number:
        return { type: isInteger(checks) ? "integer" : "number", ...this.numberConstraints(checks) };
      case TypeName.nan:
        return { type: "number" };
      case TypeName.boolean:
        return { type: "boolean" };
      case TypeName.null:
        return { type: "null" };
      // JIT serializes dates and temporals as ISO strings, so the document
      // describes exactly what crosses the wire.
      case TypeName.date:
      case TypeName.temporal:
        return { type: "string", format: "date-time" };
      case TypeName.regex:
        return { type: "string", format: "regex" };
      case TypeName.literal:
        return this.constant(current.def.value);
      case TypeName.enum:
        return { enum: Object.values(current.def.values) };
      case TypeName.object:
        return this.objectShape(current, path);
      case TypeName.array:
        return {
          type: "array",
          items: this.emit(current.def.element, [...path, "items"]),
          ...arrayConstraints(checks)
        };
      case TypeName.record:
        return {
          type: "object",
          additionalProperties: this.emit(current.def.value, [...path, "additionalProperties"])
        };
      case TypeName.tuple:
        return this.tupleShape(current, path);
      case TypeName.union:
      case TypeName.xor:
        return this.unionShape(current.def.options, "anyOf", path);
      case TypeName.discriminatedUnion:
        return this.unionShape(current.def.options, "oneOf", path);
      case TypeName.intersection:
        return {
          allOf: current.def.options.map(
            (option, index2) => this.emit(option, [...path, "allOf", index2])
          )
        };
      case TypeName.nullable:
      case TypeName.nullish:
        return this.nullableShape(current.def.innerType, path);
      case TypeName.optional:
        return this.withRef(this.emit(current.def.innerType, path), {});
      case TypeName.default: {
        const inner = this.emit(current.def.innerType, path);
        const value = readDefault(current);
        return this.withRef(inner, value === void 0 ? {} : { default: value });
      }
      case TypeName.readonly:
        return this.withRef(this.emit(current.def.innerType, path), { readOnly: true });
      case TypeName.brand:
      case TypeName.refine:
      case TypeName.coerce:
        return this.withRef(this.emit(current.def.innerType, path), {});
      case TypeName.transform:
        if (!this.input) {
          return this.unsupported(schema, path, "a transform's output is not described by the schema");
        }
        return this.withRef(this.emit(current.def.innerType, path), {});
      case TypeName.pipe: {
        const output = current.def.output;
        const target = this.input || !output ? current.def.innerType : output;
        return this.withRef(this.emit(target, path), {});
      }
      case TypeName.lazy:
        return this.withRef(this.emit(current.def.getter(), path), {});
      case TypeName.json:
      case TypeName.any:
      case TypeName.unknown:
        return {};
      default:
        return {};
    }
  }
  constant(value) {
    return this.dialect.constKeyword ? { const: value } : { enum: [value] };
  }
  unionShape(options, keyword, path) {
    return { [keyword]: options.map((option, index2) => this.emit(option, [...path, keyword, index2])) };
  }
  nullableShape(inner, path) {
    const node = this.emit(inner, path);
    if (this.dialect.nullableKeyword) return { ...node, nullable: true };
    if (this.dialect.typeUnions && typeof node.type === "string" && Object.keys(node).length === 1) {
      return { type: [node.type, "null"] };
    }
    return { anyOf: [node, { type: "null" }] };
  }
  tupleShape(schema, path) {
    const items = schema.def.items ?? [];
    const rest = schema.def.rest;
    const entries = items.map((item, index2) => this.emit(item, [...path, index2]));
    if (!this.dialect.prefixItems) {
      return {
        type: "array",
        items: entries,
        ...rest ? { additionalItems: this.emit(rest, [...path, "additionalItems"]) } : { minItems: items.length, maxItems: items.length }
      };
    }
    return {
      type: "array",
      prefixItems: entries,
      ...rest ? { items: this.emit(rest, [...path, "items"]) } : { items: false, minItems: items.length, maxItems: items.length }
    };
  }
  objectShape(schema, path) {
    const props = schema.def.props ?? {};
    const properties = {};
    const required2 = [];
    for (const key of Object.keys(props)) {
      const prop = props[key];
      properties[key] = this.emit(prop, [...path, "properties", key]);
      if (this.isRequired(prop)) required2.push(key);
    }
    const checks = schema.def.checks ?? [];
    const passthrough = checks.some((check) => check.kind === "passthrough");
    const closed = this.options.additionalProperties ?? (!passthrough && !this.input);
    return {
      type: "object",
      properties,
      ...required2.length > 0 ? { required: required2 } : {},
      // In input mode the shape stays open: callers may send more, the
      // validator will strip it.
      ...closed === true ? { additionalProperties: false } : {},
      ...this.options.additionalProperties === true ? { additionalProperties: true } : {}
    };
  }
  /** A defaulted field is optional on the way in and always present on the way out. */
  isRequired(schema) {
    if (schema.type === TypeName.optional || schema.type === TypeName.nullish) return false;
    if (schema.type === TypeName.default) return !this.input;
    return true;
  }
  annotate(schema) {
    const metadata = metadataOf(schema);
    if (!metadata) return {};
    const examples = metadata.examples && metadata.examples.length > 0 ? [...metadata.examples] : void 0;
    return {
      ...metadata.title ? { title: metadata.title } : {},
      ...metadata.description ? { description: metadata.description } : {},
      ...metadata.deprecated ? { deprecated: true } : {},
      ...examples ? this.dialect.examplesKeyword === "examples" ? { examples } : { example: examples[0] } : {},
      // Metadata takes precedence: an explicit keyword wins over the
      // generated one, which is what makes `.meta()` an escape hatch.
      ...metadata.custom ?? {},
      ...metadata.id && this.options.ref ? { $id: this.options.ref(metadata.id) } : {}
    };
  }
  stringConstraints(checks) {
    const out = {};
    for (const check of checks) {
      switch (check.kind) {
        case "min":
          out.minLength = check.value;
          break;
        case "max":
          out.maxLength = check.value;
          break;
        case "length":
          out.minLength = check.value;
          out.maxLength = check.value;
          break;
        case "nonEmpty":
          out.minLength = 1;
          break;
        case "regex":
          if (check.value instanceof RegExp) out.pattern = check.value.source;
          break;
        case "startsWith":
          if (typeof check.value === "string") out.pattern = `^${escapePattern(check.value)}`;
          break;
        case "endsWith":
          if (typeof check.value === "string") out.pattern = `${escapePattern(check.value)}$`;
          break;
        case "oneOf":
          if (Array.isArray(check.value)) out.enum = [...check.value];
          break;
        case "base64":
          if (this.dialect.contentEncoding) out.contentEncoding = "base64";
          else if (check.value instanceof RegExp) out.pattern = check.value.source;
          break;
        case "stringFormat": {
          const spec = check.value;
          if (spec?.pattern instanceof RegExp) out.pattern = spec.pattern.source;
          break;
        }
        default: {
          const format3 = STRING_FORMATS[check.kind];
          if (format3) out.format = format3;
          else if (check.value instanceof RegExp) out.pattern = check.value.source;
          break;
        }
      }
    }
    return out;
  }
  numberConstraints(checks) {
    const out = {};
    const exclusive = (keyword, value) => {
      if (this.dialect.exclusiveAsNumber) {
        out[keyword === "minimum" ? "exclusiveMinimum" : "exclusiveMaximum"] = value;
        return;
      }
      out[keyword] = value;
      out[keyword === "minimum" ? "exclusiveMinimum" : "exclusiveMaximum"] = true;
    };
    for (const check of checks) {
      switch (check.kind) {
        case "min":
          out.minimum = check.value;
          break;
        case "max":
          out.maximum = check.value;
          break;
        case "moreThan":
          exclusive("minimum", check.value);
          break;
        case "lessThan":
          exclusive("maximum", check.value);
          break;
        case "positive":
          exclusive("minimum", 0);
          break;
        case "negative":
          exclusive("maximum", 0);
          break;
        case "multipleOf":
          out.multipleOf = check.value;
          break;
        case "int32":
          out.format = "int32";
          break;
        case "float32":
          out.format = "float";
          break;
        case "float64":
          out.format = "double";
          break;
        case "oneOf":
          if (Array.isArray(check.value)) out.enum = [...check.value];
          break;
        case "between":
          if (Array.isArray(check.value)) {
            out.minimum = check.value[0];
            out.maximum = check.value[1];
          }
          break;
        default:
          break;
      }
    }
    return out;
  }
};
var STRING_FORMATS = {
  email: "email",
  uuid: "uuid",
  guid: "uuid",
  url: "uri",
  httpUrl: "uri",
  datetime: "date-time",
  instant: "date-time",
  plainDate: "date",
  plainTime: "time",
  duration: "duration",
  ipv4: "ipv4",
  ipv6: "ipv6",
  hostname: "hostname",
  idnEmail: "idn-email"
};
function children(schema) {
  const current = schema;
  const def = current.def;
  switch (current.type) {
    case TypeName.object:
      return Object.values(def.props ?? {});
    case TypeName.array:
    case TypeName.set:
      return [def.element];
    case TypeName.map:
      return [def.key, def.value];
    case TypeName.record:
      return [def.value];
    case TypeName.tuple:
      return [
        ...def.items ?? [],
        ...def.rest ? [def.rest] : []
      ];
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion:
    case TypeName.intersection:
      return def.options ?? [];
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.default:
    case TypeName.readonly:
    case TypeName.brand:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
    case TypeName.promise:
      return [def.innerType];
    case TypeName.lazy:
      return [def.getter()];
    default:
      return [];
  }
}
function metadataOf(schema) {
  return schema.annotations?.metadata;
}
function readDefault(schema) {
  const value = schema.def.defaultValue ?? schema.def.value;
  return typeof value === "function" ? void 0 : value;
}
function isInteger(checks) {
  return checks.some((check) => check.kind === "int32" || check.kind === "integer" || check.kind === "safe");
}
function arrayConstraints(checks) {
  const out = {};
  for (const check of checks) {
    switch (check.kind) {
      case "min":
        out.minItems = check.value;
        break;
      case "max":
        out.maxItems = check.value;
        break;
      case "length":
        out.minItems = check.value;
        out.maxItems = check.value;
        break;
      case "nonEmpty":
        out.minItems = 1;
        break;
      case "unique":
        out.uniqueItems = true;
        break;
      default:
        break;
    }
  }
  return out;
}
function isIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value);
}
function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ../../packages/jit/src/compiler/distinct.ts
function resolveDistinctDescriptor(schema, node) {
  const object2 = resolveRowObjectSchema(schema, "distinct");
  const fields = node.kind === "unique" ? [node.key] : [...node.fields];
  if (new Set(fields).size !== fields.length) {
    throw new JITError("INVALID_QUERY", "query distinct repeats a field");
  }
  const valueKinds = fields.map(
    (field) => resolveScalarKeyKind(resolveRowField(object2, field, "distinct"), field, "distinct")
  );
  if (fields.length === 0)
    return Object.freeze({
      fields: Object.freeze(fields),
      valueKinds: Object.freeze(valueKinds),
      strategy: "structural-hash"
    });
  const ordered = resolveHints(schema).collection?.ordered;
  const adjacent = fields.length === 1 && ordered !== void 0 && ordered.key === fields[0];
  return Object.freeze({
    fields: Object.freeze(fields),
    valueKinds: Object.freeze(valueKinds),
    strategy: adjacent ? "adjacent" : fields.length === 1 ? "set" : "compound-trie"
  });
}
function emitDistinctAcceptSource(descriptor) {
  if (descriptor.strategy === "structural-hash") {
    return `function __distinctAccept(seen, item) {
  const hash = __distinctHash(item);
  const bucket = seen.get(hash);
  if (bucket === undefined) { seen.set(hash, [item]); return true; }
  for (let i = 0, len = bucket.length; i < len; i++) {
    if (__distinctEqual(bucket[i], item)) return false;
  }
  bucket[bucket.length] = item;
  return true;
}`;
  }
  if (descriptor.strategy === "adjacent") {
    const access2 = emitDistinctKey(descriptor, 0);
    return `function __distinctAccept(state, item) {
  const key = ${access2};
  if (state.has && (state.value === key || (state.value !== state.value && key !== key))) return false;
  state.has = true;
  state.value = key;
  return true;
}`;
  }
  if (descriptor.strategy === "set") {
    const access2 = emitDistinctKey(descriptor, 0);
    return `function __distinctAccept(seen, item) {
  const key = ${access2};
  if (seen.has(key)) return false;
  seen.set(key, true);
  return true;
}`;
  }
  const lines = ["function __distinctAccept(root, item) {", "  let map = root;"];
  descriptor.fields.forEach((_field, index2) => {
    const key = `key${index2}`;
    lines.push(`  const ${key} = ${emitDistinctKey(descriptor, index2)};`);
    if (index2 === descriptor.fields.length - 1) {
      lines.push(`  if (map.has(${key})) return false;`, `  map.set(${key}, true);`);
    } else {
      const next = `next${index2}`;
      lines.push(
        `  let ${next} = map.get(${key});`,
        `  if (${next} === undefined) { ${next} = new Map(); map.set(${key}, ${next}); }`,
        `  map = ${next};`
      );
    }
  });
  lines.push("  return true;", "}");
  return lines.join("\n");
}
function emitDistinctKey(descriptor, index2) {
  const access2 = emitPropertyAccess("item", descriptor.fields[index2]);
  return descriptor.valueKinds[index2] === "date" ? `(${access2} == null ? ${access2} : ${access2}.getTime())` : access2;
}
function wrapDistinctSource(source, descriptor) {
  if (!descriptor) return source;
  return `(function () {
${emitDistinctAcceptSource(descriptor)}
return (${source});
})()`;
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
var LEN = irVar("len");
var OUT = irVar("out");
var CURSOR = irVar("j");
var INDEX = irVar("i");
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
  const body = plan.mutation ? buildMutationQuery(target, plan) : plan.composite ? plan.collector ? buildGroupedAggregateQuery(target, plan, plan.composite, plan.collector.key) : buildCompositeAggregateQuery(target, plan, plan.composite) : plan.terminal ? buildTerminalQuery(target, plan, plan.terminal) : plan.aggregate ? buildAggregateQuery(target, plan, plan.aggregate) : plan.collector ? buildCollectedQuery(target, plan) : buildArrayQuery(target, plan);
  return {
    kind: "program",
    params: options.hasParams ? [VALUE, PARAMS] : [VALUE],
    body
  };
}
function buildArrayQuery(target, plan) {
  if (shouldProjectAfterOrder(plan)) return buildArrayQueryWithPostOrderProjection(target, plan);
  const selected = buildProjection(plan.select);
  const body = [
    ...buildLoopHeader(target, plan, construct("Array", [LEN])),
    letDecl(CURSOR, literal(0)),
    buildInputLoop(target, buildGuardedBody(plan, [append(OUT, CURSOR, selected)])),
    store(loadProp(OUT, "length"), CURSOR)
  ];
  if (plan.orderBy) {
    body.push(
      sortByKey(
        OUT,
        resolveOrderingDescriptor(target.objectSchema, [{ key: plan.orderBy.key, direction: plan.orderBy.direction }])
      )
    );
  }
  body.push({ kind: "return", value: OUT });
  return body;
}
function buildArrayQueryWithPostOrderProjection(target, plan) {
  const orderBy = plan.orderBy;
  const body = [
    ...buildLoopHeader(target, plan, construct("Array", [LEN])),
    letDecl(CURSOR, literal(0)),
    buildInputLoop(target, buildGuardedBody(plan, [append(OUT, CURSOR, ITEM)])),
    store(loadProp(OUT, "length"), CURSOR)
  ];
  if (orderBy) {
    body.push(
      sortByKey(
        OUT,
        resolveOrderingDescriptor(target.objectSchema, [{ key: orderBy.key, direction: orderBy.direction }])
      )
    );
  }
  body.push(
    { kind: "assign", target: PROJECTED, expr: construct("Array", [CURSOR]) },
    forRange(INDEX, CURSOR, [
      { kind: "assign", target: ITEM, expr: loadIndex(OUT, INDEX) },
      store(loadIndex(PROJECTED, INDEX), buildProjection(plan.select))
    ]),
    { kind: "return", value: PROJECTED }
  );
  return body;
}
function buildCollectedQuery(target, plan) {
  const collector = plan.collector;
  if (!collector) return [];
  const selected = buildProjection(plan.select);
  const collect = [
    {
      kind: "assign",
      target: COLLECT_KEY,
      expr: loadProp(ITEM, collector.key)
    }
  ];
  if (collector.kind === "keyed") {
    collect.push(exprStmt(call(loadProp(OUT, "set"), [COLLECT_KEY, selected])));
  } else {
    collect.push(
      letDecl(GROUP, loadIndex(OUT, COLLECT_KEY)),
      {
        kind: "if",
        test: strictEqual(GROUP, literal(void 0)),
        then: [store(GROUP, arrayLiteral()), store(loadIndex(OUT, COLLECT_KEY), GROUP)]
      },
      store(loadIndex(GROUP, loadProp(GROUP, "length")), selected)
    );
  }
  const outInitializer = collector.kind === "keyed" ? construct("Map") : call(loadProp(irVar("Object"), "create"), [literal(null)]);
  return [
    ...buildLoopHeader(target, plan, outInitializer),
    buildInputLoop(target, buildGuardedBody(plan, collect)),
    { kind: "return", value: OUT }
  ];
}
var ACC = irVar("acc");
var ACC_COUNT = irVar("n");
var ACC_MAP = irVar("acc");
var GROUP_KEY = irVar("key");
function buildGroupedAggregateQuery(target, plan, composite, groupKey) {
  const hasAverage = composite.fields.some((field) => field.op === "avg");
  const counter = "__n";
  const body = [];
  if (target.kind === "array") {
    body.push({ kind: "assign", target: LEN, expr: loadProp(VALUE, "length") });
  }
  if (plan.unique || plan.distinct)
    body.push({
      kind: "assign",
      target: SEEN,
      expr: construct(plan.distinct ? "Map" : "Set")
    });
  const emptyRecord = call(loadProp(irVar("Object"), "create"), [literal(null)]);
  const accumulator = hasAverage ? ACC_MAP : OUT;
  body.push({
    kind: "assign",
    target: accumulator,
    expr: hasAverage ? construct("Map") : emptyRecord
  });
  const initial = composite.fields.map((field) => ({
    key: field.name,
    value: field.op === "count" || field.op === "sum" || field.op === "avg" ? literal(0) : literal(void 0)
  }));
  const create = [
    store(GROUP, objectLiteral(hasAverage ? [...initial, { key: counter, value: literal(0) }] : initial)),
    hasAverage ? exprStmt(call(loadProp(ACC_MAP, "set"), [COLLECT_KEY, GROUP])) : store(loadIndex(OUT, COLLECT_KEY), GROUP)
  ];
  const step = [
    { kind: "assign", target: COLLECT_KEY, expr: loadProp(ITEM, groupKey) },
    letDecl(GROUP, hasAverage ? call(loadProp(ACC_MAP, "get"), [COLLECT_KEY]) : loadIndex(OUT, COLLECT_KEY)),
    { kind: "if", test: strictEqual(GROUP, literal(void 0)), then: create }
  ];
  if (hasAverage) step.push(store(loadProp(GROUP, counter), binary("add", loadProp(GROUP, counter), literal(1))));
  for (const field of composite.fields) {
    const slot = loadProp(GROUP, field.name);
    const read = field.key === void 0 ? ITEM : loadProp(ITEM, field.key);
    if (field.op === "count") step.push(store(slot, binary("add", slot, literal(1))));
    else if (field.op === "sum" || field.op === "avg") step.push(store(slot, binary("add", slot, read)));
    else {
      step.push({
        kind: "if",
        test: {
          kind: "nary",
          op: "or",
          operands: [
            strictEqual(slot, literal(void 0)),
            binary(field.op === "min" ? "lessThan" : "greaterThan", read, slot)
          ]
        },
        then: [store(slot, read)]
      });
    }
  }
  body.push(buildInputLoop(target, buildGuardedBody(plan, step)));
  if (!hasAverage) {
    body.push({ kind: "return", value: OUT });
    return body;
  }
  body.push(
    { kind: "assign", target: OUT, expr: emptyRecord },
    forOf(ENTRY, ACC_MAP, [
      { kind: "assign", target: GROUP_KEY, expr: loadIndex(ENTRY, literal(0)) },
      { kind: "assign", target: GROUP, expr: loadIndex(ENTRY, literal(1)) },
      store(
        loadIndex(OUT, GROUP_KEY),
        objectLiteral(
          composite.fields.map((field) => ({
            key: field.name,
            value: field.op === "avg" ? binary("divide", loadProp(GROUP, field.name), loadProp(GROUP, counter)) : loadProp(GROUP, field.name)
          }))
        )
      )
    ]),
    { kind: "return", value: OUT }
  );
  return body;
}
function buildCompositeAggregateQuery(target, plan, composite) {
  const body = [];
  if (target.kind === "array") {
    body.push({ kind: "assign", target: LEN, expr: loadProp(VALUE, "length") });
  }
  if (plan.unique || plan.distinct)
    body.push({
      kind: "assign",
      target: SEEN,
      expr: construct(plan.distinct ? "Map" : "Set")
    });
  const slots = composite.fields.map((field, index2) => ({
    field,
    // `avg` needs its own row count; the others need one accumulator each.
    accumulator: irVar(`a${index2}`),
    counter: irVar(`n${index2}`)
  }));
  const step = [];
  for (const { field, accumulator, counter } of slots) {
    const read = field.key === void 0 ? ITEM : loadProp(ITEM, field.key);
    switch (field.op) {
      case "count":
        body.push(letDecl(accumulator, literal(0)));
        step.push(store(accumulator, binary("add", accumulator, literal(1))));
        break;
      case "sum":
        body.push(letDecl(accumulator, literal(0)));
        step.push(store(accumulator, binary("add", accumulator, read)));
        break;
      case "avg":
        body.push(letDecl(accumulator, literal(0)), letDecl(counter, literal(0)));
        step.push(
          store(accumulator, binary("add", accumulator, read)),
          store(counter, binary("add", counter, literal(1)))
        );
        break;
      case "min":
      case "max":
        body.push(letDecl(accumulator));
        step.push({
          kind: "if",
          test: {
            kind: "nary",
            op: "or",
            operands: [
              strictEqual(accumulator, literal(void 0)),
              binary(field.op === "min" ? "lessThan" : "greaterThan", read, accumulator)
            ]
          },
          then: [store(accumulator, read)]
        });
        break;
    }
  }
  body.push(buildInputLoop(target, buildGuardedBody(plan, step)));
  for (const { field, accumulator, counter } of slots) {
    if (field.op !== "avg") continue;
    body.push({
      kind: "if",
      test: strictEqual(counter, literal(0)),
      then: [store(accumulator, literal(void 0))],
      otherwise: [store(accumulator, binary("divide", accumulator, counter))]
    });
  }
  body.push({
    kind: "return",
    value: objectLiteral(
      slots.map(({ field, accumulator }) => ({
        key: field.name,
        value: accumulator
      }))
    )
  });
  return body;
}
function buildTerminalQuery(target, plan, terminal) {
  const body = [];
  if (target.kind === "array") {
    body.push({ kind: "assign", target: LEN, expr: loadProp(VALUE, "length") });
  }
  if (terminal.op === "every") {
    const condition = buildFilterTest(plan);
    body.push(
      buildInputLoop(
        target,
        condition ? [
          {
            kind: "if",
            test: not(condition),
            then: [{ kind: "return", value: literal(false) }]
          }
        ] : []
      ),
      { kind: "return", value: literal(true) }
    );
    return body;
  }
  const found = terminal.op === "some" ? { kind: "return", value: literal(true) } : terminal.op === "findIndex" ? { kind: "return", value: INDEX } : { kind: "return", value: buildProjection(plan.select) };
  body.push(buildInputLoop(target, buildGuardedBody(plan, [found])), {
    kind: "return",
    value: terminal.op === "some" ? literal(false) : terminal.op === "findIndex" ? literal(-1) : literal(void 0)
  });
  return body;
}
function buildAggregateQuery(target, plan, aggregate) {
  const body = [];
  if (target.kind === "array") {
    body.push({ kind: "assign", target: LEN, expr: loadProp(VALUE, "length") });
  }
  if (plan.unique || plan.distinct)
    body.push({
      kind: "assign",
      target: SEEN,
      expr: construct(plan.distinct ? "Map" : "Set")
    });
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
              test: {
                kind: "nary",
                op: "or",
                operands: [strictEqual(ACC, literal(void 0)), wins]
              },
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
  const outInitializer = target.kind === "array" ? construct("Array", [LEN]) : target.kind === "set" ? construct("Set") : construct("Map");
  const body = [...buildLoopHeader(target, plan, outInitializer)];
  if (target.kind === "array") body.push(letDecl(CURSOR, literal(0)));
  body.push(buildInputLoop(target, loopBody));
  if (target.kind === "array") body.push(store(loadProp(OUT, "length"), CURSOR));
  body.push({ kind: "return", value: OUT });
  return body;
}
function buildMutationKeep(target, value) {
  switch (target.kind) {
    case "array":
      return [append(OUT, CURSOR, value)];
    case "set":
      return [exprStmt(call(loadProp(OUT, "add"), [value]))];
    case "map":
      return [exprStmt(call(loadProp(OUT, "set"), [loadIndex(ENTRY, literal(0)), value]))];
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
    {
      kind: "assign",
      target: LEN,
      expr: loadProp(VALUE, target.kind === "array" ? "length" : "size")
    }
  ];
  if (plan.unique || plan.distinct)
    header.push({
      kind: "assign",
      target: SEEN,
      expr: construct(plan.distinct ? "Map" : "Set")
    });
  header.push({ kind: "assign", target: OUT, expr: outInitializer });
  return header;
}
function buildInputLoop(target, body) {
  switch (target.kind) {
    case "array":
      return forRange(INDEX, LEN, [{ kind: "assign", target: ITEM, expr: loadIndex(VALUE, INDEX) }, ...body]);
    case "set":
      return forOf(ITEM, VALUE, body);
    case "map":
      return forOf(ENTRY, VALUE, [{ kind: "assign", target: ITEM, expr: loadIndex(ENTRY, literal(1)) }, ...body]);
  }
}
function buildGuardedBody(plan, accepted) {
  const unique = plan.unique;
  const inner = plan.distinct ? [
    {
      kind: "if",
      test: call(irVar("__distinctAccept"), [SEEN, ITEM]),
      then: accepted
    }
  ] : unique ? [
    {
      kind: "assign",
      target: UNIQUE_KEY,
      expr: loadProp(ITEM, unique.key)
    },
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
  return objectLiteral(
    select.fields.map((field) => ({
      key: field,
      value: loadProp(ITEM, field)
    }))
  );
}
function shouldProjectAfterOrder(plan) {
  return Boolean(plan.select && plan.orderBy && !plan.select.fields.includes(plan.orderBy.key));
}

// ../../packages/jit/src/compiler/physical-query.ts
function describePhysicalQueryPlan(plan) {
  return Object.freeze({
    strategy: plan.strategy,
    reason: plan.reason,
    complexity: plan.complexity,
    facts: plan.facts
  });
}
function resolvePhysicalQueryPlan(schema, target, plan) {
  const terminal = plan.terminal;
  if (!terminal) {
    return Object.freeze({
      strategy: "Scan",
      reason: "the result is a collection, so every row has to be visited",
      complexity: "O(n)",
      facts: Object.freeze([])
    });
  }
  const scan = Object.freeze({
    strategy: "EarlyExitScan",
    reason: `${terminal.op} returns as soon as the answer is known`,
    complexity: "O(k)",
    facts: Object.freeze([])
  });
  if (terminal.op !== "first" && terminal.op !== "some") return scan;
  if (target.kind !== "array") return scan;
  if (plan.filters.length !== 1) return scan;
  const equality = singleEquality(plan.filters[0]?.condition);
  if (!equality) return scan;
  const choice = resolveKeyedAccessChoice(schema, equality.key);
  if (choice.strategy === "EarlyExitScan") return scan;
  return Object.freeze({
    strategy: choice.strategy,
    reason: choice.reason,
    complexity: choice.complexity,
    facts: choice.facts,
    access: keyedAccess(schema, equality, choice.direction, terminal.op)
  });
}
function resolveKeyedAccessChoice(schema, key) {
  const hints = resolveHints(schema);
  const ordered = hints.order ?? hints.collection?.ordered;
  const orderedKey = resolveHintKey(ordered?.key);
  const cacheIndex = hints.entity?.cacheIndex === true;
  const identityKey = resolveHintKey(hints.index?.key) ?? resolveHintKey(hints.entity?.key);
  const unique = hints.collection?.unique === true || hints.entity?.key !== void 0;
  if (ordered && orderedKey === key && unique) {
    return Object.freeze({
      strategy: "BinarySearch",
      reason: "the collection declares this key ordered and unique",
      complexity: "O(log n)",
      facts: Object.freeze([`ordered: ${orderedKey} ${ordered.direction ?? "asc"}`, `unique key: ${orderedKey}`]),
      direction: ordered.direction === "desc" ? "desc" : "asc"
    });
  }
  if (cacheIndex && identityKey === key) {
    return Object.freeze({
      strategy: "CachedIndexLookup",
      reason: "the collection is keyed, so the index is built once per array and reused",
      complexity: "O(1)",
      facts: Object.freeze([`keyed: ${identityKey}`, "index cache: enabled"]),
      direction: "asc"
    });
  }
  return Object.freeze({
    strategy: "EarlyExitScan",
    reason: "no declared fact reaches this key directly, so rows are scanned until one matches",
    complexity: "O(k)",
    facts: Object.freeze([]),
    direction: "asc"
  });
}
function keyedAccess(schema, equality, direction, terminal) {
  return Object.freeze({
    key: equality.key,
    direction,
    descriptor: resolveIndexDescriptor(schema, [equality.key], "unique"),
    probe: equality.probe,
    terminal
  });
}
function singleEquality(condition) {
  if (condition?.kind !== "compare" || condition.op !== "eq") return void 0;
  const { left, right } = condition;
  if (left.kind === "field" && right.kind !== "field") return { key: left.key, probe: right };
  if (right.kind === "field" && left.kind !== "field") return { key: right.key, probe: left };
  return void 0;
}
function emitPhysicalQuerySource(physical, hasParams) {
  const access2 = physical.access;
  if (!access2) return void 0;
  const shape = {
    signature: hasParams ? "value, params" : "value",
    probe: emitProbe(access2),
    answers: access2.terminal === "some" ? "exists" : "row"
  };
  if (physical.strategy === "CachedIndexLookup") return emitCachedIndexLookup(access2.descriptor, shape);
  if (physical.strategy === "BinarySearch")
    return emitBinarySearch(access2.key, access2.descriptor, access2.direction, shape);
  return void 0;
}
function emitCachedIndexLookup(descriptor, shape) {
  const writer = new CodeWriter();
  writer.line("(() => {");
  writer.indent(() => {
    emitIndexBuilder(writer, descriptor, "const build = (value) => {", "};");
    writer.line(`function query(${shape.signature}) {`);
    writer.indent(() => {
      writer.line(
        `const row = __cachedIndex(value, ${JSON.stringify(indexCacheKey(descriptor))}, build).get(${shape.probe});`
      );
      writer.line(shape.answers === "exists" ? "return row !== undefined;" : "return row;");
    });
    writer.line("}");
    writer.line("return query;");
  });
  writer.line("})()");
  return writer.toString();
}
function emitBinarySearch(key, descriptor, direction, shape) {
  const access2 = { key, descriptor, direction };
  const writer = new CodeWriter();
  const probe = shape.probe;
  const read = (row) => {
    const value = emitPropertyAccess(row, access2.key);
    return access2.descriptor.keys[0]?.valueKind === "date" ? `${value}.getTime()` : value;
  };
  const goRight = access2.direction === "desc" ? "probe > target" : "probe < target";
  writer.line("(() => {");
  writer.indent(() => {
    writer.line(`function query(${shape.signature}) {`);
    writer.indent(() => {
      writer.line(`const target = ${probe};`);
      writer.line("let low = 0;");
      writer.line("let high = value.length - 1;");
      writer.line("while (low <= high) {");
      writer.indent(() => {
        writer.line("const mid = (low + high) >>> 1;");
        writer.line("const row = value[mid];");
        writer.line(`const probe = ${read("row")};`);
        writer.line("if (probe === target) {");
        writer.indent(() => writer.line(shape.answers === "exists" ? "return true;" : "return row;"));
        writer.line("}");
        writer.line(`if (${goRight}) low = mid + 1;`);
        writer.line("else high = mid - 1;");
      });
      writer.line("}");
      writer.line(shape.answers === "exists" ? "return false;" : "return undefined;");
    });
    writer.line("}");
    writer.line("return query;");
  });
  writer.line("})()");
  return writer.toString();
}
function emitProbe(access2) {
  const probe = access2.probe;
  const value = probe.kind === "literal" ? emitLiteral(probe.value) : probe.kind === "param" ? emitPropertyAccess("params", probe.name) : probe.kind === "binding" ? probe.name : emitPropertyAccess("row", probe.key);
  return access2.descriptor.keys[0]?.valueKind === "date" && probe.kind !== "literal" ? `(${value} == null ? ${value} : ${value}.getTime())` : value;
}

// ../../packages/jit/src/compiler/query.ts
var RUNTIME_INDEX_BINDING = "__cachedIndex";
function emitQuerySource(schema, program) {
  const target = expectCollectionObjectSchema(schema, "emitQuerySource");
  const plan = optimizeQueryPlan(createQueryPlan(program.nodes));
  validateQueryPlan(target.objectSchema, plan);
  const hasParams = Boolean(program.params?.length);
  const empty = emitStaticallyEmptyQuery(plan, target, hasParams);
  if (empty !== void 0) return empty;
  const keyed = emitPhysicalQuerySource(resolvePhysicalQueryPlan(schema, target, plan), hasParams);
  if (keyed) return keyed;
  const source = emitQuery(optimizeQueryIR(buildQueryIR(target, plan, { hasParams })));
  return wrapDistinctSource(source, resolvePlanDistinct(schema, plan));
}
function emitStaticallyEmptyQuery(plan, target, hasParams) {
  if (!plan.filters.some((filter) => evaluateConstantCondition(filter.condition) === false)) return void 0;
  const signature = `value${hasParams ? ", params" : ""}`;
  let result;
  if (plan.mutation !== void 0) return void 0;
  if (plan.terminal !== void 0) {
    if (plan.terminal.op === "first") result = "undefined";
    else if (plan.terminal.op === "findIndex") result = "-1";
    else if (plan.terminal.op === "some") result = "false";
    else {
      const size = target.kind === "array" ? "value.length" : "value.size";
      result = `${size} === 0`;
    }
  } else if (plan.aggregate !== void 0) {
    result = plan.aggregate.op === "sum" || plan.aggregate.op === "count" ? "0" : "undefined";
  } else if (plan.composite !== void 0) {
    if (plan.collector?.kind === "groupBy") result = "{}";
    else {
      const fields = plan.composite.fields.map(
        (field) => `${JSON.stringify(field.name)}: ${field.op === "sum" || field.op === "count" ? "0" : "undefined"}`
      );
      result = `{ ${fields.join(", ")} }`;
    }
  } else if (plan.collector?.kind === "keyed") result = "new Map()";
  else if (plan.collector?.kind === "groupBy") result = "{}";
  else result = "[]";
  return `function query(${signature}) {
  return ${result};
}`;
}
function evaluateConstantCondition(condition) {
  if (condition.kind === "logical") {
    const left2 = evaluateConstantCondition(condition.left);
    const right2 = evaluateConstantCondition(condition.right);
    if (condition.op === "and") {
      if (left2 === false || right2 === false) return false;
      return left2 === true && right2 === true ? true : void 0;
    }
    if (left2 === true || right2 === true) return true;
    return left2 === false && right2 === false ? false : void 0;
  }
  if (condition.kind === "not") {
    const inner = evaluateConstantCondition(condition.inner);
    return inner === void 0 ? void 0 : !inner;
  }
  if (condition.left.kind !== "literal" || condition.right.kind !== "literal") return void 0;
  const left = condition.left.value;
  const right = condition.right.value;
  switch (condition.op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
  }
}
function explainPhysicalQuery(schema, program) {
  const target = expectCollectionObjectSchema(schema, "explainPhysicalQuery");
  const plan = optimizeQueryPlan(createQueryPlan(program.nodes));
  validateQueryPlan(target.objectSchema, plan);
  return describePhysicalQueryPlan(resolvePhysicalQueryPlan(schema, target, plan));
}
function compileQuery(schema, program, options) {
  const bindingNames = program.bindings.map((_, index2) => `__q${index2}`);
  const plan = optimizeQueryPlan(createQueryPlan(program.nodes));
  const descriptor = resolvePlanDistinct(schema, plan);
  const structural = descriptor?.strategy === "structural-hash";
  const template = getCompileCached(
    schema,
    `query:${serializeQueryNodes(program.nodes)}`,
    () => {
      const source = emitQuerySource(schema, program);
      return {
        source,
        create: globalThis.Function(
          RUNTIME_INDEX_BINDING,
          ...structural ? ["__distinctHash", "__distinctEqual"] : [],
          ...bindingNames,
          `return ${source};`
        )
      };
    },
    options
  );
  const compiled = template.create(
    getCachedIndex,
    ...structural ? [
      compileUncachedHash(expectCollectionObjectSchema(schema, "query distinct").objectSchema),
      compileEqual(expectCollectionObjectSchema(schema, "query distinct").objectSchema)
    ] : [],
    ...program.bindings
  );
  registerArtifact(compiled, {
    kind: "query",
    source: template.source,
    bindingNames,
    bindingValues: program.bindings
  });
  return compiled;
}
function serializeQueryNodes(nodes) {
  return nodes.map(serializeQueryNode).join(";");
}
function serializeQueryNode(node) {
  switch (node.kind) {
    case "filter":
      return `f(${serializeCondition(node.condition)})`;
    case "select:fields":
      return `s(${node.fields.join(",")})`;
    case "unique":
      return `u(${node.key})`;
    case "distinct":
      return `D(${node.fields.join(",")})`;
    case "keyed":
      return `k(${node.key})`;
    case "groupBy":
      return `g(${node.key})`;
    case "orderBy":
      return `o(${node.key},${node.direction})`;
    case "aggregate":
      return `a(${node.op},${node.key ?? ""})`;
    case "aggregate:composite":
      return `A(${node.fields.map((field) => `${field.name}:${field.op}:${field.key ?? ""}`).join(",")})`;
    case "terminal":
      return `t(${node.op})`;
    case "delete":
      return "d()";
    case "update":
      return `m(${Object.keys(node.patch).map((key) => `${key}=${node.patch[key]?.name}`).join(",")})`;
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
function createQueryPlan(nodes) {
  const filters = [];
  const selects = [];
  const uniques = [];
  const distincts = [];
  const collectors = [];
  const orderBys = [];
  const aggregates = [];
  const composites = [];
  const terminals = [];
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
      case "distinct":
        distincts[distincts.length] = node;
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
      case "aggregate:composite":
        composites[composites.length] = node;
        break;
      case "terminal":
        terminals[terminals.length] = node;
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
    distincts,
    collectors,
    orderBys,
    aggregates,
    composites,
    terminals,
    mutations
  };
}
function optimizeQueryPlan(plan) {
  return {
    filters: plan.filters,
    select: last(plan.selects),
    unique: last(plan.uniques),
    distinct: last(plan.distincts),
    collector: last(plan.collectors),
    orderBy: last(plan.orderBys),
    aggregate: last(plan.aggregates),
    composite: last(plan.composites),
    terminal: last(plan.terminals),
    mutation: last(plan.mutations)
  };
}
function validateQueryPlan(schema, plan) {
  for (const filter of plan.filters) {
    validateCondition(schema, filter.condition);
  }
  if (plan.select) validateObjectKeys(schema, plan.select.fields, "query select");
  if (plan.unique) validateObjectKeys(schema, [plan.unique.key], "query unique");
  if (plan.distinct) validateObjectKeys(schema, plan.distinct.fields, "query distinct");
  if (plan.unique && plan.distinct) {
    throw new JITError("INVALID_QUERY", "query unique and distinct cannot be combined in v1");
  }
  if (plan.collector) validateObjectKeys(schema, [plan.collector.key], `query ${plan.collector.kind}`);
  if (plan.orderBy) validateObjectKeys(schema, [plan.orderBy.key], "query orderBy");
  if (plan.collector && plan.orderBy) {
    throw new JITError("INVALID_QUERY", "query orderBy cannot be combined with keyed/groupBy in v1");
  }
  if (plan.aggregate) {
    if (plan.collector || plan.orderBy || plan.mutation) {
      throw new JITError(
        "INVALID_QUERY",
        "query aggregate cannot be combined with keyed/groupBy/orderBy/delete/update in v1"
      );
    }
    if (plan.aggregate.op !== "count") {
      if (plan.aggregate.key === void 0) {
        throw new JITError("INVALID_QUERY", `query ${plan.aggregate.op} requires a field key`);
      }
      validateObjectKeys(schema, [plan.aggregate.key], `query ${plan.aggregate.op}`);
    }
  }
  if (plan.composite) {
    if (plan.aggregate || plan.terminal || plan.orderBy || plan.mutation || plan.select) {
      throw new JITError(
        "INVALID_QUERY",
        "query aggregate({...}) cannot be combined with select/orderBy/scalar aggregates/terminals/delete/update in v1"
      );
    }
    if (plan.collector && plan.collector.kind !== "groupBy") {
      throw new JITError("INVALID_QUERY", "query aggregate({...}) cannot be combined with keyed in v1");
    }
    if (plan.composite.fields.length === 0) {
      throw new JITError("INVALID_QUERY", "query aggregate({...}) requires at least one field");
    }
    const seen = /* @__PURE__ */ new Set();
    for (const field of plan.composite.fields) {
      if (seen.has(field.name)) {
        throw new JITError("INVALID_QUERY", `query aggregate repeats field ${JSON.stringify(field.name)}`);
      }
      seen.add(field.name);
      if (field.op === "count") continue;
      if (field.key === void 0) {
        throw new JITError("INVALID_QUERY", `query aggregate ${field.op} requires a field key`);
      }
      validateObjectKeys(schema, [field.key], `query aggregate ${field.op}`);
    }
  }
  if (plan.terminal) {
    if (plan.collector || plan.orderBy || plan.aggregate || plan.mutation || plan.unique || plan.distinct) {
      throw new JITError(
        "INVALID_QUERY",
        `query ${plan.terminal.op} cannot be combined with unique/distinct/keyed/groupBy/orderBy/aggregates/delete/update in v1`
      );
    }
    if (plan.select && plan.terminal.op !== "first") {
      throw new JITError("INVALID_QUERY", `query ${plan.terminal.op} does not produce rows, so select has no effect`);
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
      validateObjectKeys(schema, Object.keys(plan.mutation.patch), "query update");
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
    objectSchema: element,
    schema
  };
}
function resolvePlanDistinct(schema, plan) {
  return plan.distinct ? resolveDistinctDescriptor(schema, plan.distinct) : void 0;
}
function validateObjectKeys(schema, keys, compilerName) {
  const props = schema.def.props;
  for (const key of keys) {
    if (!(key in props)) {
      throw new JITError("INVALID_QUERY", `${compilerName} received unknown key ${JSON.stringify(key)}`, {
        path: [key]
      });
    }
  }
}
function validateCondition(schema, condition) {
  switch (condition.kind) {
    case "compare":
      validateValue(schema, condition.left);
      validateValue(schema, condition.right);
      return;
    case "logical":
      validateCondition(schema, condition.left);
      validateCondition(schema, condition.right);
      return;
    case "not":
      validateCondition(schema, condition.inner);
      return;
  }
}
function validateValue(schema, value) {
  if (value.kind === "field") {
    validateObjectKeys(schema, [value.key], "query");
  }
}
function last(values) {
  return values[values.length - 1];
}

// ../../packages/jit/src/compiler/lazy-query.ts
function explainQueryExecution(program, outputMode) {
  const barriers = program.nodes.filter((node) => node.kind === "orderBy").map(() => "orderBy");
  const retainedState = [];
  for (const node of program.nodes) {
    if (node.kind === "unique") retainedState[retainedState.length] = `Set(${node.key})`;
    else if (node.kind === "distinct")
      retainedState[retainedState.length] = node.fields.length === 0 ? "structural-hash" : `distinct(${node.fields.join(",")})`;
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
    // A terminal returns from inside the loop, which is early termination by
    // construction rather than by a count.
    earlyTermination: program.nodes.some(
      (node) => node.kind === "take" || node.kind === "takeWhile" || node.kind === "terminal"
    ),
    retainedState,
    estimatedAllocationsPerResult: (
      // `some`, `every` and `findIndex` answer with a scalar: no row is built,
      // even when the chain named fields earlier.
      program.nodes.some((node) => node.kind === "terminal" && node.op !== "first") ? 0 : program.nodes.some(
        (node) => node.kind === "select:fields" || node.kind === "chunk" || node.kind === "window" || node.kind === "pairwise"
      ) ? 1 : 0
    ),
    barriers
  };
}
function emitQueryIteratorSource(schema, program) {
  return wrapDistinctSource(emitPipelineSource(schema, program, false), resolveLazyDistinct(schema, program));
}
function emitQueryArraySource(schema, program) {
  if (program.nodes.every(isFusibleNode)) {
    return wrapDistinctSource(emitDirectArraySource(schema, program), resolveLazyDistinct(schema, program));
  }
  const iterator = emitQueryIteratorSource(schema, program);
  const hasParams = Boolean(program.params?.length);
  return `(function() {
const iterate = ${iterator};
function query(input${hasParams ? ", params" : ""}) {
  return Array.from(iterate(input${hasParams ? ", params" : ""}));
}
return query;
})()`;
}
function compileQueryArray(schema, program, options) {
  const bindingNames = program.bindings.map((_, index2) => `__q${index2}`);
  const template = getCompileCached(
    schema,
    `query:eager-array:${serializePipeline(program.nodes)}`,
    () => {
      const source = emitQueryArraySource(schema, program);
      const structural = resolveLazyDistinct(schema, program)?.strategy === "structural-hash";
      return {
        source,
        create: globalThis.Function(
          ...structural ? ["__distinctHash", "__distinctEqual"] : [],
          ...bindingNames,
          `return ${source};`
        )
      };
    },
    options
  );
  const compiled = template.create(
    ...distinctRuntimeBindings(schema, program),
    ...program.bindings
  );
  registerArtifact(compiled, {
    kind: "query-plan",
    schema,
    program,
    mode: "array"
  });
  return compiled;
}
function emitQueryAsyncIteratorSource(schema, program) {
  return wrapDistinctSource(emitPipelineSource(schema, program, true), resolveLazyDistinct(schema, program));
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
  const bindingNames = program.bindings.map((_, index2) => `__q${index2}`);
  const template = getCompileCached(
    schema,
    `query:visitor:${serializePipeline(program.nodes)}`,
    () => {
      const source = emitQueryVisitorSource(schema, program);
      const structural = resolveLazyDistinct(schema, program)?.strategy === "structural-hash";
      return {
        source,
        create: globalThis.Function(
          ...structural ? ["__distinctHash", "__distinctEqual"] : [],
          ...bindingNames,
          `return ${source};`
        )
      };
    },
    options
  );
  const visitor = template.create(
    ...distinctRuntimeBindings(schema, program),
    ...program.bindings
  );
  registerArtifact(visitor, {
    kind: "query-plan",
    schema,
    program,
    mode: "visitor"
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
  const terminalTakeIndex = terminalTake(program.nodes);
  program.nodes.forEach((node, index2) => {
    if (node.kind === "take" && index2 !== terminalTakeIndex || node.kind === "drop")
      lines.push(`  let count${index2} = 0;`);
    else if (node.kind === "dropWhile") lines.push(`  let dropping${index2} = true;`);
    else if (node.kind === "unique") lines.push(`  const seen${index2} = new Set();`);
    else if (node.kind === "distinct") lines.push(`  const seen${index2} = new Map();`);
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
  return wrapDistinctSource(lines.join("\n"), resolveLazyDistinct(schema, program));
}
function emitVisitorBody(nodes) {
  const body = ["let output = item;"];
  const terminalTakeIndex = terminalTake(nodes);
  nodes.forEach((node, index2) => {
    switch (node.kind) {
      case "filter":
        body.push(`if (!(${emitCondition2(node.condition)})) continue;`);
        break;
      case "select:fields":
        body.push(`output = ${emitProjection(node.fields)};`);
        break;
      case "take":
        if (index2 !== terminalTakeIndex) body.push(`if (count${index2}++ === ${node.count}) return emitted;`);
        break;
      case "drop":
        body.push(`if (count${index2}++ < ${node.count}) continue;`);
        break;
      case "takeWhile":
        body.push(`if (!(${emitCondition2(node.condition)})) return emitted;`);
        break;
      case "dropWhile":
        body.push(`if (dropping${index2} && (${emitCondition2(node.condition)})) continue;`);
        body.push(`dropping${index2} = false;`);
        break;
      case "unique":
        body.push(`const key${index2} = item${emitPropertyAccess("", node.key)};`);
        body.push(`if (seen${index2}.has(key${index2})) continue;`);
        body.push(`seen${index2}.add(key${index2});`);
        break;
      case "distinct":
        body.push(`if (!__distinctAccept(seen${index2}, item)) continue;`);
        break;
      default:
        break;
    }
  });
  body.push("consume(output);", "emitted++;");
  if (terminalTakeIndex !== -1) {
    const node = nodes[terminalTakeIndex];
    body.push(`if (emitted === ${node.count}) return emitted;`);
  }
  return body;
}
function compileLazy(schema, program, mode, options) {
  const bindingNames = program.bindings.map((_, index2) => `__q${index2}`);
  const key = `query:${mode}:${serializePipeline(program.nodes)}`;
  const template = getCompileCached(
    schema,
    key,
    () => {
      const source = mode === "generator" ? emitQueryIteratorSource(schema, program) : emitQueryAsyncIteratorSource(schema, program);
      const structural = resolveLazyDistinct(schema, program)?.strategy === "structural-hash";
      return {
        source,
        create: globalThis.Function(
          ...structural ? ["__distinctHash", "__distinctEqual"] : [],
          ...bindingNames,
          `return ${source};`
        )
      };
    },
    options
  );
  const compiled = template.create(
    ...distinctRuntimeBindings(schema, program),
    ...program.bindings
  );
  registerArtifact(compiled, {
    kind: "query-plan",
    schema,
    program,
    mode: mode === "generator" ? "iterator" : "async-iterator"
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
  let stage2 = collection.kind === "map" ? "source(input)" : "input";
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
      emitStage(lines, node, "input", async, awaitPrefix, forAwait, collection.objectSchema);
      nodeIndex++;
    }
    lines.push("}");
    stage2 = `${name}(${stage2}, ${hasParams ? "params" : "undefined"})`;
  }
  lines.push(`function query(input${hasParams ? ", params" : ""}) {`);
  lines.push(`  return ${stage2};`);
  lines.push("}");
  lines.push("return query;");
  return `(function() {
${lines.join("\n")}
})()`;
}
function emitDirectArraySource(schema, program) {
  const collection = resolveCollection(schema);
  validatePipeline(program.nodes, collection.props);
  const hasParams = Boolean(program.params?.length);
  const lines = [`function query(input${hasParams ? ", params" : ""}) {`, "  const out = [];", "  let j = 0;"];
  const terminalTakeIndex = terminalTake(program.nodes);
  program.nodes.forEach((node, index2) => {
    if (node.kind === "take" && index2 !== terminalTakeIndex || node.kind === "drop")
      lines.push(`  let count${index2} = 0;`);
    else if (node.kind === "dropWhile") lines.push(`  let dropping${index2} = true;`);
    else if (node.kind === "unique") lines.push(`  const seen${index2} = new Set();`);
    else if (node.kind === "distinct") lines.push(`  const seen${index2} = new Map();`);
  });
  const body = ["let output = item;"];
  program.nodes.forEach((node, index2) => {
    switch (node.kind) {
      case "filter":
        body.push(`if (!(${emitCondition2(node.condition)})) continue;`);
        break;
      case "select:fields":
        body.push(`output = ${emitProjection(node.fields)};`);
        break;
      case "take":
        if (index2 !== terminalTakeIndex) body.push(`if (count${index2}++ === ${node.count}) return out;`);
        break;
      case "drop":
        body.push(`if (count${index2}++ < ${node.count}) continue;`);
        break;
      case "takeWhile":
        body.push(`if (!(${emitCondition2(node.condition)})) return out;`);
        break;
      case "dropWhile":
        body.push(`if (dropping${index2} && (${emitCondition2(node.condition)})) continue;`);
        body.push(`dropping${index2} = false;`);
        break;
      case "unique":
        body.push(`const key${index2} = item${emitPropertyAccess("", node.key)};`);
        body.push(`if (seen${index2}.has(key${index2})) continue;`);
        body.push(`seen${index2}.add(key${index2});`);
        break;
      case "distinct":
        body.push(`if (!__distinctAccept(seen${index2}, item)) continue;`);
        break;
      default:
        break;
    }
  });
  body.push("out[j++] = output;");
  if (terminalTakeIndex !== -1) {
    const node = program.nodes[terminalTakeIndex];
    body.push(`if (j === ${node.count}) return out;`);
  }
  if (collection.kind === "array") {
    lines.push("  for (let i = 0, len = input.length; i < len; i++) {", "    const item = input[i];");
  } else if (collection.kind === "map") {
    lines.push("  for (const entry of input) {", "    const item = entry[1];");
  } else {
    lines.push("  for (const item of input) {");
  }
  for (const line of body) lines.push(`    ${line}`);
  lines.push("  }", "  return out;", "}", "return query;");
  return `(function() {
${lines.join("\n")}
})()`;
}
function isFusibleNode(node) {
  return node.kind === "filter" || node.kind === "select:fields" || node.kind === "take" || node.kind === "drop" || node.kind === "takeWhile" || node.kind === "dropWhile" || node.kind === "unique" || node.kind === "distinct";
}
function emitFusedStage(lines, nodes, forAwait, directArray) {
  const terminalTakeIndex = terminalTake(nodes);
  nodes.forEach((node, index2) => {
    if (node.kind === "take" || node.kind === "drop") lines.push(`  let count${index2} = 0;`);
    else if (node.kind === "dropWhile") lines.push(`  let dropping${index2} = true;`);
    else if (node.kind === "unique") lines.push(`  const seen${index2} = new Set();`);
    else if (node.kind === "distinct") lines.push(`  const seen${index2} = new Map();`);
  });
  const body = ["let output = item;"];
  nodes.forEach((node, index2) => {
    switch (node.kind) {
      case "filter":
        body.push(`if (!(${emitCondition2(node.condition)})) continue;`);
        break;
      case "select:fields":
        body.push(`output = ${emitProjection(node.fields)};`);
        break;
      case "take":
        if (index2 !== terminalTakeIndex) body.push(`if (count${index2}++ === ${node.count}) return;`);
        break;
      case "drop":
        body.push(`if (count${index2}++ < ${node.count}) continue;`);
        break;
      case "takeWhile":
        body.push(`if (!(${emitCondition2(node.condition)})) return;`);
        break;
      case "dropWhile":
        body.push(`if (dropping${index2} && (${emitCondition2(node.condition)})) continue;`);
        body.push(`dropping${index2} = false;`);
        break;
      case "unique":
        body.push(`const key${index2} = item${emitPropertyAccess("", node.key)};`);
        body.push(`if (seen${index2}.has(key${index2})) continue;`);
        body.push(`seen${index2}.add(key${index2});`);
        break;
      case "distinct":
        body.push(`if (!__distinctAccept(seen${index2}, item)) continue;`);
        break;
      default:
        break;
    }
  });
  body.push("yield output;");
  if (terminalTakeIndex !== -1) {
    const node = nodes[terminalTakeIndex];
    body.push(`if (++count${terminalTakeIndex} === ${node.count}) return;`);
  }
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
function terminalTake(nodes) {
  const index2 = nodes.length - 1;
  return index2 >= 0 && nodes[index2]?.kind === "take" ? index2 : -1;
}
function emitStage(lines, node, previous, async, awaitPrefix, forAwait, objectSchema) {
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
    case "distinct":
      lines.push("  const seen = new Map();");
      loop(["if (!__distinctAccept(seen, item)) continue;", "yield item;"]);
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
      lines.push("  values.sort((left, right) => {");
      for (const line of emitOrderingComparatorBodySource(
        resolveOrderingDescriptor(objectSchema, [{ key: node.key, direction: node.direction }])
      ).split("\n")) {
        lines.push(`    ${line}`);
      }
      lines.push("  });");
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
      const operators = {
        eq: "===",
        neq: "!==",
        gt: ">",
        gte: ">=",
        lt: "<",
        lte: "<="
      };
      return `${emitValue2(condition.left)} ${operators[condition.op]} ${emitValue2(condition.right)}`;
    }
    case "logical":
      return `(${emitCondition2(condition.left)} ${condition.op === "and" ? "&&" : "||"} ${emitCondition2(condition.right)})`;
    case "not":
      return `!(${emitCondition2(condition.inner)})`;
  }
}
function emitValue2(value) {
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
  const objectSchema = element;
  return { kind: collection.type, props: objectSchema.def.props, objectSchema };
}
function validatePipeline(nodes, props) {
  for (const node of nodes) {
    if (node.kind === "terminal") {
      throw new JITError(
        "INVALID_QUERY",
        `query ${node.op} produces a single answer and cannot feed an iterator, visitor or lazy pipeline`
      );
    }
    if (node.kind === "filter" || node.kind === "takeWhile" || node.kind === "dropWhile") {
      validateConditionFields(node.condition, props);
    }
    if (node.kind === "select:fields" || node.kind === "flatMap" || node.kind === "unique" || node.kind === "distinct" || node.kind === "orderBy" || node.kind === "groupAdjacentBy") {
      const keys = node.kind === "select:fields" || node.kind === "distinct" ? node.fields : [node.key];
      for (const key of keys)
        if (!(key in props)) throw new JITError("INVALID_QUERY", `lazy query received unknown key ${key}`);
    }
  }
}
function validateConditionFields(condition, props) {
  if (condition.kind === "compare") {
    for (const value of [condition.left, condition.right]) {
      if (value.kind === "field" && !(value.key in props)) {
        throw new JITError("INVALID_QUERY", `lazy query received unknown key ${value.key}`);
      }
    }
  } else if (condition.kind === "logical") {
    validateConditionFields(condition.left, props);
    validateConditionFields(condition.right, props);
  } else {
    validateConditionFields(condition.inner, props);
  }
}
function serializePipeline(nodes) {
  return JSON.stringify(nodes, (_key, value) => typeof value === "bigint" ? `${value}n` : value);
}
function resolveLazyDistinct(schema, program) {
  const nodes = program.nodes.filter((node) => node.kind === "distinct");
  if (nodes.length === 0) return void 0;
  if (nodes.length > 1 || program.nodes.some((node) => node.kind === "unique")) {
    throw new JITError("INVALID_QUERY", "query distinct cannot be repeated or combined with unique in v1");
  }
  return resolveDistinctDescriptor(schema, nodes[0]);
}
function distinctRuntimeBindings(schema, program) {
  if (resolveLazyDistinct(schema, program)?.strategy !== "structural-hash") return [];
  const objectSchema = resolveCollection(schema).objectSchema;
  return [compileUncachedHash(objectSchema), compileEqual(objectSchema)];
}
function hasIncrementalNodes(program) {
  for (let i = 0, len = program.nodes.length; i < len; i++) {
    switch (program.nodes[i]?.kind) {
      case "flatMap":
      case "take":
      case "drop":
      case "takeWhile":
      case "dropWhile":
      case "chunk":
      case "window":
      case "pairwise":
      case "scan":
      case "groupAdjacentBy":
        return true;
    }
  }
  return false;
}
function emitQueryPlanSource(schema, program, mode) {
  switch (mode) {
    case "iterator":
      return emitQueryIteratorSource(schema, program);
    case "async-iterator":
      return emitQueryAsyncIteratorSource(schema, program);
    case "visitor":
      return emitQueryVisitorSource(schema, program);
    default:
      return hasIncrementalNodes(program) ? emitQueryArraySource(schema, program) : emitQuerySource(schema, program);
  }
}

// ../../packages/jit/src/compiler/lookup.ts
function resolveLookupDescriptor(schema, key) {
  const object2 = resolveRowObjectSchema(schema, "lookup");
  const resolved = key ?? resolveIndexKeysFromFacts(schema)?.[0];
  if (!resolved) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      "JIT.lookup() needs a key: declare one with .keyed()/.indexBy()/.uniqueBy(), or name it with .by()"
    );
  }
  const field = resolveRowField(object2, resolved, "lookup");
  return Object.freeze({
    key: resolved,
    descriptor: resolveIndexDescriptor(schema, [resolved], "unique"),
    choice: resolveKeyedAccessChoice(schema, resolved),
    date: resolveScalarKeyKind(field, resolved, "lookup") === "date"
  });
}
function emitLookupSource(lookup2) {
  const shape = {
    signature: "value, key",
    probe: lookup2.date ? "(key == null ? key : key.getTime())" : "key",
    answers: "row"
  };
  if (lookup2.choice.strategy === "CachedIndexLookup") return emitCachedIndexLookup(lookup2.descriptor, shape);
  if (lookup2.choice.strategy === "BinarySearch") {
    return emitBinarySearch(lookup2.key, lookup2.descriptor, lookup2.choice.direction, shape);
  }
  return emitLookupScan(lookup2, shape);
}
function emitLookupScan(lookup2, shape) {
  const writer = new CodeWriter();
  const read = lookup2.date ? `${emitPropertyAccess("row", lookup2.key)}.getTime()` : emitPropertyAccess("row", lookup2.key);
  writer.line("(() => {");
  writer.indent(() => {
    writer.line(`function lookup(${shape.signature}) {`);
    writer.indent(() => {
      writer.line(`const target = ${shape.probe};`);
      writer.line("for (let i = 0, len = value.length; i < len; i++) {");
      writer.indent(() => {
        writer.line("const row = value[i];");
        writer.line(`if (${read} === target) return row;`);
      });
      writer.line("}");
      writer.line("return undefined;");
    });
    writer.line("}");
    writer.line("return lookup;");
  });
  writer.line("})()");
  return writer.toString();
}
function lookupCacheKey(lookup2) {
  return `lookup:${lookup2.choice.strategy}:${lookup2.key}:${lookup2.date}:${lookup2.choice.direction}`;
}
function compileLookup(schema, lookup2, runtimeIndexCache, options) {
  const template = getCompileCached(
    schema,
    lookupCacheKey(lookup2),
    () => {
      const source = emitLookupSource(lookup2);
      return { source, create: globalThis.Function("__cachedIndex", `return ${source};`) };
    },
    options
  );
  const compiled = template.create(runtimeIndexCache);
  Object.defineProperty(compiled, "explain", {
    value: () => Object.freeze({
      strategy: lookup2.choice.strategy,
      reason: lookup2.choice.reason,
      complexity: lookup2.choice.complexity,
      facts: lookup2.choice.facts
    })
  });
  registerArtifact(compiled, { kind: "lookup-plan", schema, lookup: lookup2 });
  return compiled;
}

// ../../packages/jit/src/compiler/mapper/build-mapper-plan.ts
function buildMapperPlan(sourceSchema, targetSchema, overrides = {}) {
  const source = expectObjectSchema(sourceSchema, "mapper source");
  const target = expectObjectSchema(targetSchema, "mapper target");
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
    const from3 = key in source.def.props ? key : void 0;
    return { kind: "default", from: from3, binding: bind(override.default) };
  }
  throw new JITError("INVALID_MAPPER", `mapper override for ${JSON.stringify(key)} must define from, via, or default`, {
    path
  });
}
function planAutoMatch(source, from3, targetProp, bind, path) {
  const sourceProp = source.def.props[from3];
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
      `mapper source field ${JSON.stringify(from3)} is optional but the target field is required; use default or via`,
      { path }
    );
  }
  const sourceBase = sourceResolved.base;
  const targetBase = targetResolved?.base;
  if (sourceBase.type === TypeName.object && (targetBase === void 0 || targetBase.type === TypeName.object)) {
    const nestedTarget = targetBase ?? sourceBase;
    const fields = planObjectFields(sourceBase, nestedTarget, {}, bind, path);
    return { kind: "copy-object", from: from3, fromOptional: sourceResolved.optional, fields };
  }
  if (sourceBase.type === TypeName.array && (targetBase === void 0 || targetBase.type === TypeName.array)) {
    const sourceElement = resolveWrappers(sourceBase.def.element).base;
    const targetElement = targetBase === void 0 ? sourceElement : resolveWrappers(targetBase.def.element).base;
    if (sourceElement.type === TypeName.object && targetElement.type === TypeName.object) {
      const element = planObjectFields(sourceElement, targetElement, {}, bind, path);
      return { kind: "copy-array", from: from3, fromOptional: sourceResolved.optional, element };
    }
    if (isCompatibleBase(sourceElement.type, targetElement.type)) {
      return { kind: "copy-array", from: from3, fromOptional: sourceResolved.optional, element: void 0 };
    }
    if (targetResolved?.optional) return void 0;
    throw new JITError("INVALID_MAPPER", `mapper array field ${JSON.stringify(from3)} has incompatible element types`, {
      path
    });
  }
  if (targetBase === void 0 || isCompatibleBase(sourceBase.type, targetBase.type)) {
    return { kind: "copy", from: from3, fromOptional: sourceResolved.optional };
  }
  if (targetResolved?.optional) return void 0;
  throw new JITError(
    "INVALID_MAPPER",
    `mapper field ${JSON.stringify(from3)} has type ${sourceBase.type} but the target expects ${targetBase.type}`,
    { path }
  );
}
function isCompatibleBase(source, target) {
  if (source === target) return true;
  if (source === TypeName.int && target === TypeName.number) return true;
  return false;
}
function expectSourceField(source, from3, path) {
  if (!(from3 in source.def.props)) {
    throw new JITError("INVALID_MAPPER", `mapper override references unknown source field ${JSON.stringify(from3)}`, {
      path
    });
  }
}
function expectObjectSchema(schema, label) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.object) {
    throw new JITError("INVALID_MAPPER", `${label} must be an object schema`);
  }
  return resolved;
}

// ../../packages/jit/src/compiler/mapper/build-mapper-ir.ts
var SOURCE = irVar("source");
var LIST = irVar("list");
var LEN2 = irVar("len");
var OUT2 = irVar("out");
var INDEX2 = irVar("i");
function buildMapperIR(fields) {
  const prelude = [];
  const output = objectLiteral(buildEntries(fields, SOURCE, "f", prelude));
  const map4 = {
    kind: "program",
    params: [SOURCE],
    body: [...prelude, { kind: "return", value: output }]
  };
  const many = {
    kind: "program",
    params: [LIST],
    body: [
      { kind: "assign", target: LEN2, expr: loadProp(LIST, "length") },
      { kind: "assign", target: OUT2, expr: construct("Array", [LEN2]) },
      forRange(INDEX2, LEN2, [
        { kind: "assign", target: SOURCE, expr: loadIndex(LIST, INDEX2) },
        ...prelude,
        store(loadIndex(OUT2, INDEX2), output)
      ]),
      { kind: "return", value: OUT2 }
    ]
  };
  return { map: map4, many };
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
      const index2 = irVar(`${prefix}_i`);
      const item = irVar(`${prefix}_item`);
      const inner = [];
      const element = source.element === void 0 ? item : objectLiteral(buildEntries(source.element, item, prefix, inner));
      const loop = [
        { kind: "assign", target: len, expr: loadProp(src, "length") },
        { kind: "assign", target: out, expr: construct("Array", [len]) },
        forRange(index2, len, [
          { kind: "assign", target: item, expr: loadIndex(src, index2) },
          ...inner,
          store(loadIndex(out, index2), element)
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

// ../../packages/jit/src/compiler/mapper.ts
var MAPPER_OPERATIONS = ["map", "many"];
function emitMapperSource(sourceSchema, targetSchema, overrides = {}, operations = MAPPER_OPERATIONS) {
  return emitMapper(buildMapperPlan(sourceSchema, targetSchema, overrides), normalizeMapperOps(operations));
}
function emitMapper(plan, operations) {
  const programs = buildMapperIR(plan.fields);
  const writer = new CodeWriter();
  writer.line("{");
  writer.indent(() => {
    operations.forEach((operation, index2) => {
      emitMapperFunctionBody(writer, programs, operation, index2 < operations.length - 1 ? "," : "");
    });
  });
  writer.line("}");
  return writer.toString();
}
function emitMapperPlanFunctionSource(plan, operation = "map", name = operation) {
  const programs = buildMapperIR(plan.fields);
  const writer = new CodeWriter();
  emitMapperFunctionBody(writer, programs, operation, "", false, name);
  return writer.toString();
}
function emitMapperFunctionBody(writer, programs, operation, suffix, property = true, name = operation) {
  const parameter = operation === "map" ? "source" : "list";
  const prefix = property ? `${operation}: ` : "";
  writer.line(`${prefix}function ${name}(${parameter}) {`);
  writer.indent(() => {
    for (const node of programs[operation].body) emitNode(writer, node);
  });
  writer.line(`}${suffix}`);
}
function normalizeMapperOps(operations) {
  for (const operation of operations) {
    if (!MAPPER_OPERATIONS.includes(operation)) {
      throw new JITError("INVALID_OPERATION", `unknown mapper operation: ${String(operation)}`);
    }
  }
  return MAPPER_OPERATIONS.filter((operation) => operations.includes(operation));
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
        `return ${emitted.source.replace("function scrub(", "function mask(")};`
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
        const index2 = nextVar4("i");
        writer.line(`let ${hash4} = 2166136261;`);
        writer.line(`for (let ${index2} = 0; ${index2} < ${value}.length; ${index2}++) {`);
        writer.indent(() => {
          writer.line(`${hash4} = Math.imul(${hash4} ^ ${value}.charCodeAt(${index2}), 16777619);`);
        });
        writer.line("}");
        return `(${hash4} >>> 0).toString(16)`;
      };
  }
}

// ../../packages/jit/src/compiler/match.ts
function resolveMatchDescriptor(schema, handled, hasFallback, exhaustive) {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.discriminatedUnion) {
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.match() requires a discriminated union");
  }
  const union3 = base;
  const discriminator = union3.def.discriminator;
  const tags = union3.def.options.map((option) => tagOf(option, discriminator));
  for (const tag of handled) {
    if (!tags.includes(tag)) {
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `JIT.match() has a case for ${JSON.stringify(tag)}, which the union does not declare`
      );
    }
  }
  if (exhaustive && !hasFallback) {
    const missing = tags.filter((tag) => !handled.includes(tag));
    if (missing.length > 0) {
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `JIT.match().exhaustive() is missing a case for ${missing.map((tag) => JSON.stringify(tag)).join(", ")}`
      );
    }
  }
  return Object.freeze({
    schema: base,
    discriminator,
    tags: Object.freeze(tags),
    handled: Object.freeze([...handled]),
    hasFallback,
    exhaustive
  });
}
function tagOf(option, discriminator) {
  const base = resolveWrappers(option).base;
  const field = base.def?.props?.[discriminator];
  const literal4 = field === void 0 ? void 0 : resolveWrappers(field).base;
  if (literal4?.type !== TypeName.literal) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      `JIT.match() requires every option to declare ${JSON.stringify(discriminator)} as a literal`
    );
  }
  return literal4.def.value;
}
function emitMatchSource(descriptor) {
  const writer = new CodeWriter();
  const read = emitPropertyAccess("value", descriptor.discriminator);
  writer.line("function match(value) {");
  writer.indent(() => {
    writer.line(`switch (${read}) {`);
    writer.indent(() => {
      descriptor.handled.forEach((tag, index2) => {
        writer.line(`case ${emitLiteral(tag)}:`);
        writer.indent(() => writer.line(`return __case${index2}(value);`));
      });
      if (descriptor.hasFallback) {
        writer.line("default:");
        writer.indent(() => writer.line("return __fallback(value);"));
        return;
      }
      writer.line("default:");
      writer.indent(
        () => writer.line(
          `throw new Error("unmatched " + ${JSON.stringify(descriptor.discriminator)} + ": " + String(${read}));`
        )
      );
    });
    writer.line("}");
  });
  writer.line("}");
  return writer.toString();
}
function matchCacheKey(descriptor) {
  return `match:${descriptor.discriminator}:${JSON.stringify(descriptor.handled)}:${descriptor.hasFallback}`;
}
function compileMatch(descriptor, handlers, fallback, options) {
  const names = descriptor.handled.map((_, index2) => `__case${index2}`);
  const template = getCompileCached(
    descriptor.schema,
    matchCacheKey(descriptor),
    () => {
      const source = emitMatchSource(descriptor);
      return {
        source,
        create: globalThis.Function(...names, ...descriptor.hasFallback ? ["__fallback"] : [], `return ${source};`)
      };
    },
    options
  );
  const compiled = template.create(...handlers, ...fallback === void 0 ? [] : [fallback]);
  registerArtifact(compiled, {
    kind: "match-plan",
    schema: descriptor.schema,
    descriptor,
    bindingNames: names.concat(descriptor.hasFallback ? "__fallback" : []),
    bindingValues: handlers.concat(fallback === void 0 ? [] : [fallback])
  });
  return compiled;
}

// ../../packages/jit/src/compiler/migration.ts
function createMigrationDescriptor(schema) {
  const version = resolveMigrationVersion(schema);
  return Object.freeze({
    schemas: Object.freeze([schema]),
    versions: Object.freeze([version]),
    edges: Object.freeze([]),
    bindingNames: Object.freeze([]),
    bindingValues: Object.freeze([])
  });
}
function appendMigrationEdge(descriptor, target, overrides = {}) {
  const source = descriptor.schemas[descriptor.schemas.length - 1];
  const from3 = descriptor.versions[descriptor.versions.length - 1];
  const to = resolveMigrationVersion(target);
  if (descriptor.versions.includes(to)) {
    throw new JITError("INVALID_OPERATION", `JIT.migrate() repeats version ${JSON.stringify(to)}`);
  }
  const edgeIndex = descriptor.edges.length;
  const mapper = prefixMapperBindings(
    forceVersionConstant(buildMapperPlan(source, target, { ...overrides, version: { default: to } })),
    `__migration${edgeIndex}_`
  );
  const edge = Object.freeze({ source, target, from: from3, to, mapper });
  return Object.freeze({
    schemas: Object.freeze([...descriptor.schemas, target]),
    versions: Object.freeze([...descriptor.versions, to]),
    edges: Object.freeze([...descriptor.edges, edge]),
    bindingNames: Object.freeze([...descriptor.bindingNames, ...mapper.bindingNames]),
    bindingValues: Object.freeze([...descriptor.bindingValues, ...mapper.bindings])
  });
}
function emitMigrationSource(descriptor) {
  const writer = new CodeWriter();
  writer.line("(() => {");
  writer.indent(() => {
    descriptor.edges.forEach((edge, index2) => {
      for (const line of emitMapperPlanFunctionSource(edge.mapper, "map", `migrateEdge${index2}`).trimEnd().split("\n")) {
        writer.line(line);
      }
    });
    writer.line("function migrate(value) {");
    writer.indent(() => {
      writer.line(
        'if (value === null || typeof value !== "object") throw new TypeError("migration input must be an object");'
      );
      writer.line("switch (value.version) {");
      writer.indent(() => {
        descriptor.edges.forEach((edge, index2) => {
          writer.line(`case ${emitLiteral(edge.from)}:`);
          writer.indent(() => writer.line(`value = migrateEdge${index2}(value);`));
        });
        const current = descriptor.versions[descriptor.versions.length - 1];
        writer.line(`case ${emitLiteral(current)}:`);
        writer.indent(() => writer.line("return value;"));
        writer.line("default:");
        writer.indent(
          () => writer.line(
            `throw new RangeError("unsupported migration version: " + String(value.version) + "; expected one of ${descriptor.versions.map(String).join(", ")}");`
          )
        );
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("return migrate;");
  });
  writer.line("})()");
  return writer.toString();
}
function compileMigration(descriptor) {
  const source = emitMigrationSource(descriptor);
  const compiled = globalThis.Function(
    ...descriptor.bindingNames,
    `return ${source};`
  )(...descriptor.bindingValues);
  registerArtifact(compiled, { kind: "migration-plan", descriptor });
  return compiled;
}
function resolveMigrationVersion(schema) {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object) {
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.migrate() requires an object schema with a literal version field");
  }
  const versionSchema = base.def.props.version;
  const version = versionSchema === void 0 ? void 0 : resolveWrappers(versionSchema).base;
  if (version?.type !== TypeName.literal) {
    throw new JITError("UNSUPPORTED_SCHEMA", 'JIT.migrate() requires a literal "version" field');
  }
  const value = version.def.value;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new JITError("UNSUPPORTED_SCHEMA", 'JIT.migrate() requires "version" to be a string or number literal');
  }
  return value;
}
function prefixMapperBindings(plan, prefix) {
  const replacements = new Map(plan.bindingNames.map((name, index2) => [name, `${prefix}${index2}`]));
  return Object.freeze({
    fields: rewriteFields(plan.fields, replacements),
    bindingNames: Object.freeze(plan.bindingNames.map((name) => replacements.get(name))),
    bindings: plan.bindings
  });
}
function forceVersionConstant(plan) {
  return {
    ...plan,
    fields: plan.fields.map((field) => {
      if (field.key !== "version" || field.source.kind !== "default") return field;
      return { ...field, source: { ...field.source, from: void 0 } };
    })
  };
}
function rewriteFields(fields, replacements) {
  return Object.freeze(
    fields.map((field) => {
      const source = field.source;
      switch (source.kind) {
        case "copy-object":
          return { ...field, source: { ...source, fields: rewriteFields(source.fields, replacements) } };
        case "copy-array":
          return {
            ...field,
            source: {
              ...source,
              element: source.element === void 0 ? void 0 : rewriteFields(source.element, replacements)
            }
          };
        case "via":
        case "computed":
        case "default":
          return { ...field, source: { ...source, binding: replacements.get(source.binding) } };
        default:
          return field;
      }
    })
  );
}

// ../../packages/jit/src/compiler/mock.ts
var MOCK_HELPERS = `let __seed = 1;
function __srand(seed) { __seed = (seed | 0) || 1; }
function __rand() {
  __seed ^= __seed << 13; __seed ^= __seed >>> 17; __seed ^= __seed << 5;
  return ((__seed >>> 0) % 1000000) / 1000000;
}
function __int(min, max) { return min + Math.floor(__rand() * (max - min + 1)); }
function __pick(items) { return items[__int(0, items.length - 1)]; }
function __chars(alphabet, length) {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[__int(0, alphabet.length - 1)];
  return out;
}
const __ALPHA = "abcdefghijklmnopqrstuvwxyz";
const __ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const __HEX = "0123456789abcdef";
const __CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function __uuid() {
  return __chars(__HEX, 8) + "-" + __chars(__HEX, 4) + "-4" + __chars(__HEX, 3) + "-a" + __chars(__HEX, 3) + "-" + __chars(__HEX, 12);
}
function __email() { return __chars(__ALPHA, __int(3, 10)) + "@" + __chars(__ALPHA, __int(3, 8)) + ".com"; }
function __url() { return "https://" + __chars(__ALPHA, __int(3, 10)) + ".example.com/" + __chars(__ALNUM, __int(0, 8)); }
function __isoDate(min, max) { return new Date(__int(min, max)).toISOString(); }`;
var MOCK_EPOCH_MIN = 16e11;
var MOCK_EPOCH_MAX = 19e11;
function compileMock(schema) {
  const template = getCompileCached(schema, "mock", () => {
    const source = emitMockSource(schema);
    return { source, create: globalThis.Function(`${MOCK_HELPERS}
return ${source};`) };
  });
  const compiled = template.create();
  registerArtifact(compiled, { kind: "operation", schema, op: "mock" });
  return compiled;
}
function emitMockSource(schema) {
  const body = emitValue3(schema, 0);
  return `function mock(options) {
  __srand(options && options.seed !== undefined ? options.seed : (Math.random() * 2147483647) | 0);
  return ${body};
}`;
}
function emitValue3(schema, depth) {
  if (depth > 6) return emitTerminal(schema);
  const current = schema;
  const checks = current.def.checks ?? [];
  switch (current.type) {
    case TypeName.string:
    case TypeName.templateLiteral:
      return emitString(checks);
    case TypeName.int:
      return emitNumber(checks, true);
    case TypeName.number:
      return emitNumber(checks, hasCheck(checks, "int32", "integer", "safe"));
    case TypeName.nan:
      return "Number.NaN";
    case TypeName.bigint:
      return "BigInt(__int(0, 1000))";
    case TypeName.boolean:
      return "__rand() < 0.5";
    case TypeName.null:
      return "null";
    case TypeName.undefined:
    case TypeName.void:
      return "undefined";
    case TypeName.date:
      return `new Date(__int(${MOCK_EPOCH_MIN}, ${MOCK_EPOCH_MAX}))`;
    case TypeName.temporal:
      return `__isoDate(${MOCK_EPOCH_MIN}, ${MOCK_EPOCH_MAX})`;
    case TypeName.literal:
      return literal2(current.def.value);
    case TypeName.enum: {
      const values = Object.values(current.def.values);
      return `__pick([${values.map(literal2).join(", ")}])`;
    }
    case TypeName.object: {
      const props = current.def.props ?? {};
      const entries = Object.keys(props).map((key) => `${propertyKey(key)}: ${emitValue3(props[key], depth + 1)}`);
      return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
    }
    case TypeName.array:
      return emitArray(current.def.element, checks, depth);
    case TypeName.set:
      return `new Set(${emitArray(current.def.element, checks, depth)})`;
    case TypeName.map: {
      const key = emitValue3(current.def.key, depth + 1);
      const value = emitValue3(current.def.value, depth + 1);
      return `new Map([[${key}, ${value}]])`;
    }
    case TypeName.record:
      return `{ [${emitString([])}]: ${emitValue3(current.def.value, depth + 1)} }`;
    case TypeName.tuple: {
      const items = current.def.items ?? [];
      return `[${items.map((item) => emitValue3(item, depth + 1)).join(", ")}]`;
    }
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion: {
      const options = current.def.options ?? [];
      if (options.length === 0) return "undefined";
      if (options.length === 1) return emitValue3(options[0], depth + 1);
      return `(() => { switch (__int(0, ${options.length - 1})) { ${options.map((option, index2) => `case ${index2}: return ${emitValue3(option, depth + 1)};`).join(" ")} } })()`;
    }
    case TypeName.intersection: {
      const options = current.def.options ?? [];
      return `Object.assign({}, ${options.map((option) => emitValue3(option, depth + 1)).join(", ")})`;
    }
    case TypeName.optional:
      return `(__rand() < 0.5 ? undefined : ${emitValue3(current.def.innerType, depth + 1)})`;
    case TypeName.nullable:
      return `(__rand() < 0.25 ? null : ${emitValue3(current.def.innerType, depth + 1)})`;
    case TypeName.nullish:
      return `(__rand() < 0.5 ? null : ${emitValue3(current.def.innerType, depth + 1)})`;
    case TypeName.readonly:
    case TypeName.brand:
    case TypeName.coerce:
    case TypeName.default:
      return emitValue3(current.def.innerType, depth + 1);
    case TypeName.refine:
    case TypeName.pipe:
    case TypeName.transform:
      return emitValue3(current.def.innerType, depth + 1);
    case TypeName.lazy:
      return emitValue3(current.def.getter(), depth + 1);
    case TypeName.promise:
      return `Promise.resolve(${emitValue3(current.def.innerType, depth + 1)})`;
    case TypeName.json:
    case TypeName.any:
    case TypeName.unknown:
      return "null";
    default:
      return "null";
  }
}
function emitTerminal(schema, depth = 0) {
  const current = resolveLazy(schema);
  if (depth > 3) return "null";
  switch (current.type) {
    case TypeName.object: {
      const props = current.def.props ?? {};
      const required2 = Object.keys(props).filter((key) => !isOmittable(props[key]));
      return required2.length === 0 ? "{}" : `{ ${required2.map((key) => `${propertyKey(key)}: ${emitTerminal(props[key], depth + 1)}`).join(", ")} }`;
    }
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion: {
      const options = current.def.options ?? [];
      return options.length > 0 ? emitTerminal(options[0], depth + 1) : "null";
    }
    case TypeName.literal:
      return literal2(current.def.value);
    case TypeName.enum: {
      const values = Object.values(current.def.values);
      return values.length > 0 ? literal2(values[0]) : "null";
    }
    case TypeName.optional:
    case TypeName.nullish:
    case TypeName.undefined:
      return "undefined";
    case TypeName.nullable:
    case TypeName.null:
      return "null";
    case TypeName.array:
    case TypeName.set:
    case TypeName.tuple:
      return "[]";
    case TypeName.record:
      return "{}";
    case TypeName.string:
      return emitString(current.def.checks ?? []);
    case TypeName.number:
    case TypeName.int: {
      const checks = current.def.checks ?? [];
      return emitNumber(checks, current.type === TypeName.int || hasCheck(checks, "int32", "integer", "safe"));
    }
    case TypeName.boolean:
      return "false";
    case TypeName.date:
      return `new Date(${MOCK_EPOCH_MIN})`;
    default:
      return "null";
  }
}
function isOmittable(schema) {
  return schema.type === TypeName.optional || schema.type === TypeName.nullish || schema.type === TypeName.default;
}
function resolveLazy(schema) {
  let current = schema;
  let guard = 0;
  while (current.type === TypeName.lazy && guard++ < 100) {
    current = current.def.getter();
  }
  return current;
}
var STRING_GENERATORS = {
  email: "__email()",
  url: "__url()",
  httpUrl: "__url()",
  uuid: "__uuid()",
  guid: "__uuid()",
  datetime: `__isoDate(${MOCK_EPOCH_MIN}, ${MOCK_EPOCH_MAX})`,
  instant: `__isoDate(${MOCK_EPOCH_MIN}, ${MOCK_EPOCH_MAX})`,
  ulid: "__chars(__CROCKFORD, 26)",
  nanoid: "__chars(__ALNUM, 21)",
  cuid2: "__chars(__ALNUM, 24)",
  base64url: "__chars(__ALNUM, 16)",
  hex: "__chars(__HEX, 16)"
};
function emitString(checks) {
  const oneOf = checks.find((check) => check.kind === "oneOf");
  if (Array.isArray(oneOf?.value)) return `__pick([${oneOf.value.map(literal2).join(", ")}])`;
  for (const check of checks) {
    const generator = STRING_GENERATORS[check.kind];
    if (generator) return generator;
  }
  const length = numeric(checks, "length");
  const min = length ?? numeric(checks, "min") ?? (hasCheck(checks, "nonEmpty") ? 1 : 3);
  const max = length ?? numeric(checks, "max") ?? Math.max(min, 12);
  const prefix = checks.find((check) => check.kind === "startsWith")?.value;
  const suffix = checks.find((check) => check.kind === "endsWith")?.value;
  const body = `__chars(__ALPHA, __int(${min}, ${max}))`;
  if (typeof prefix !== "string" && typeof suffix !== "string") return body;
  return `${typeof prefix === "string" ? `${literal2(prefix)} + ` : ""}${body}${typeof suffix === "string" ? ` + ${literal2(suffix)}` : ""}`;
}
function emitNumber(checks, integer2) {
  const between = checks.find((check) => check.kind === "between")?.value;
  let min = numeric(checks, "min") ?? (Array.isArray(between) ? Number(between[0]) : void 0) ?? 0;
  let max = numeric(checks, "max") ?? (Array.isArray(between) ? Number(between[1]) : void 0) ?? 1e3;
  if (hasCheck(checks, "positive")) min = Math.max(min, 1);
  if (hasCheck(checks, "negative")) max = Math.min(max, -1);
  if (max < min) max = min;
  const multipleOf = numeric(checks, "multipleOf");
  if (multipleOf !== void 0 && multipleOf > 0) {
    const lowest = Math.ceil(min / multipleOf);
    const highest = Math.floor(max / multipleOf);
    return `(__int(${lowest}, ${Math.max(lowest, highest)}) * ${multipleOf})`;
  }
  if (integer2) return `__int(${Math.ceil(min)}, ${Math.floor(max)})`;
  return `(${min} + __rand() * ${max - min})`;
}
function emitArray(element, checks, depth) {
  const length = numeric(checks, "length");
  const min = length ?? numeric(checks, "min") ?? (hasCheck(checks, "nonEmpty") ? 1 : 1);
  const max = depth >= 5 ? min : length ?? numeric(checks, "max") ?? Math.max(min, 3);
  const item = emitValue3(element, depth + 1);
  return `Array.from({ length: __int(${min}, ${Math.max(min, max)}) }, () => (${item}))`;
}
function numeric(checks, kind) {
  const value = checks.find((check) => check.kind === kind)?.value;
  return typeof value === "number" ? value : void 0;
}
function hasCheck(checks, ...kinds) {
  return checks.some((check) => kinds.includes(check.kind));
}
function literal2(value) {
  if (typeof value === "bigint") return `${value}n`;
  if (value === void 0) return "undefined";
  return JSON.stringify(value) ?? "null";
}
function propertyKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

// ../../packages/jit/src/compiler/mutation-plan.ts
function buildMutationPlan(options) {
  const readonlyFields = new Set(options.readonlyFields);
  const mutableFields = [...new Set(options.fields)].filter((field) => !readonlyFields.has(field));
  return Object.freeze({
    mutableFields: Object.freeze(mutableFields),
    ...options.updatedAt === void 0 ? {} : { updatedAt: options.updatedAt },
    ...options.version === void 0 ? {} : { version: options.version }
  });
}
function emitMutationPlanBody(plan, updates) {
  const writer = new CodeWriter();
  writer.line("let changed = false;");
  for (const field of plan.mutableFields) {
    const update2 = updates.get(field);
    if (update2 === void 0) continue;
    const current = `this${emitPropertyAccess("", field)}`;
    const fieldPatch = `patch${emitPropertyAccess("", field)}`;
    writer.line(`if (${fieldPatch} !== undefined) {`);
    writer.indent(() => {
      writer.line(`const next = ${update2 === null ? fieldPatch : `${update2}(${current}, ${fieldPatch})`};`);
      writer.line(`if (next !== ${current}) { ${current} = next; changed = true; }`);
    });
    writer.line("}");
  }
  writer.line("if (!changed) return;");
  if (plan.updatedAt !== void 0) writer.line("const now = new Date();");
  if (plan.updatedAt !== void 0) writer.line(`this${emitPropertyAccess("", plan.updatedAt)} = now;`);
  if (plan.version !== void 0) writer.line(`this${emitPropertyAccess("", plan.version)} += 1;`);
  return writer.toString();
}

// ../../packages/jit/src/compiler/ndjson.ts
function createNdjsonDescriptor(schema, operation) {
  expectNdjsonObject(schema);
  return Object.freeze({
    schema,
    outputSchema: schema,
    filters: Object.freeze([]),
    select: void 0,
    bindingNames: Object.freeze([]),
    bindingValues: Object.freeze([]),
    operation,
    sink: operation === "parse" ? "result" : "ndjson"
  });
}
function appendNdjsonFilter(descriptor, condition, bindings) {
  validateCondition2(expectNdjsonObject(descriptor.schema), condition);
  const start = descriptor.bindingValues.length;
  const names = bindings.map((_, index2) => `__q${start + index2}`);
  return Object.freeze({
    ...descriptor,
    filters: Object.freeze([...descriptor.filters, condition]),
    bindingNames: Object.freeze([...descriptor.bindingNames, ...names]),
    bindingValues: Object.freeze([...descriptor.bindingValues, ...bindings])
  });
}
function selectNdjson(descriptor, fields) {
  const tree = buildProjectionTree(descriptor.schema, fields, "JIT.ndjson.parse().select()");
  return Object.freeze({
    ...descriptor,
    outputSchema: tree.schema,
    select: Object.freeze([...fields])
  });
}
function withNdjsonSink(descriptor, sink) {
  return Object.freeze({ ...descriptor, sink });
}
function expectNdjsonObject(schema) {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object)
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.ndjson requires an object row schema");
  return base;
}
function validateCondition2(schema, condition) {
  if (condition.kind === "logical") {
    validateCondition2(schema, condition.left);
    validateCondition2(schema, condition.right);
    return;
  }
  if (condition.kind === "not") {
    validateCondition2(schema, condition.inner);
    return;
  }
  for (const value of [condition.left, condition.right]) {
    if (value.kind === "field" && !(value.key in schema.def.props)) {
      throw new JITError("INVALID_QUERY", `NDJSON filter references unknown field ${JSON.stringify(value.key)}`);
    }
  }
}
function emitNdjsonSource(descriptor, validator = "__ndjsonValidator") {
  const writer = new CodeWriter();
  writer.line("(() => {");
  writer.indent(() => {
    if (descriptor.operation === "parse") {
      emitRowParser(writer, validator);
    }
    if (descriptor.operation === "stringify" || descriptor.sink === "ndjson") {
      writer.line(`const ndjsonStringifyRow = ${emitSerializeSource(descriptor.outputSchema)};`);
    }
    if (descriptor.operation === "stringify") emitStringify(writer, descriptor);
    else emitParse(writer, descriptor);
    writer.line(`return ${descriptor.operation === "stringify" ? "ndjsonStringify" : "ndjsonParse"};`);
  });
  writer.line("})()");
  return writer.toString();
}
function emitRowParser(writer, validator) {
  writer.line("function ndjsonRow(line, row) {");
  writer.indent(() => {
    writer.line("let parsed;");
    writer.line(
      'try { parsed = JSON.parse(line); } catch { throw new SyntaxError("malformed NDJSON on line " + (row + 1)); }'
    );
    writer.line(`const result = ${validator}.safeParse(parsed);`);
    writer.line("if (result.success) return result.data;");
    writer.line(
      'throw new JITValidationError(result.issues.map((issue) => ({ ...issue, path: "line " + (row + 1) + (issue.path ? "." + issue.path : "") })));'
    );
  });
  writer.line("}");
}
function emitParse(writer, descriptor) {
  const generator = descriptor.sink === "iterator" ? "function*" : "function";
  const params = descriptor.sink === "visitor" ? "input, consume" : "input";
  writer.line(`${generator} ndjsonParse(${params}) {`);
  writer.indent(() => {
    if (descriptor.sink === "result") writer.line("const out = [];");
    else if (descriptor.sink === "ndjson") writer.line('let out = "";');
    writer.line('const single = typeof input === "string" || input instanceof Uint8Array;');
    writer.line("const iterator = single ? undefined : input[Symbol.iterator]();");
    writer.line("const decoder = new TextDecoder();");
    writer.line('let buffer = "", singleDone = false, lineNumber = 0, emitted = 0;');
    writer.line("while (true) {");
    writer.indent(() => {
      writer.line("let chunk, done;");
      writer.line(
        "if (single) { done = singleDone; chunk = singleDone ? undefined : input; singleDone = true; } else { const next = iterator.next(); done = next.done; chunk = next.value; }"
      );
      writer.line(
        'buffer += done ? decoder.decode() : (typeof chunk === "string" ? decoder.decode() + chunk : decoder.decode(chunk, { stream: true }));'
      );
      writer.line('let start = 0, cut = buffer.indexOf("\\n");');
      writer.line("while (cut !== -1) {");
      writer.indent(() => {
        writer.line("let line = buffer.slice(start, cut);");
        writer.line('if (line.endsWith("\\r")) line = line.slice(0, -1);');
        emitNdjsonLine(writer, descriptor);
        writer.line("lineNumber += 1;");
        writer.line("start = cut + 1;");
        writer.line('cut = buffer.indexOf("\\n", start);');
      });
      writer.line("}");
      writer.line("if (start !== 0) buffer = buffer.slice(start);");
      writer.line("if (!done) continue;");
      writer.line('if (buffer.trim() !== "") {');
      writer.indent(() => {
        writer.line("const line = buffer;");
        emitNdjsonLine(writer, descriptor);
      });
      writer.line("}");
      if (descriptor.sink === "result" || descriptor.sink === "ndjson") writer.line("return out;");
      else if (descriptor.sink === "visitor") writer.line("return emitted;");
      else writer.line("return;");
    });
    writer.line("}");
  });
  writer.line("}");
}
function emitNdjsonLine(writer, descriptor) {
  writer.line('if (line.trim() !== "") {');
  writer.indent(() => {
    writer.line("const item = ndjsonRow(line, lineNumber);");
    const filters = descriptor.filters.map((condition) => `(${emitCondition3(condition)})`).join(" && ");
    if (filters.length > 0) {
      writer.line(`if (${filters}) {`);
      writer.indent(() => emitNdjsonSink(writer, descriptor));
      writer.line("}");
    } else {
      emitNdjsonSink(writer, descriptor);
    }
  });
  writer.line("}");
}
function emitNdjsonSink(writer, descriptor) {
  const value = emitProjection2(descriptor.select);
  if (descriptor.sink === "result") writer.line(`out[emitted++] = ${value};`);
  else if (descriptor.sink === "iterator") {
    writer.line(`yield ${value};`);
    writer.line("emitted += 1;");
  } else if (descriptor.sink === "visitor") writer.line(`consume(${value}, emitted++);`);
  else {
    writer.line('if (out.length !== 0) out += "\\n";');
    writer.line("out += ndjsonStringifyRow(item);");
    writer.line("emitted += 1;");
  }
}
function emitStringify(writer, descriptor) {
  const iterator = descriptor.sink === "iterator";
  writer.line(`${iterator ? "function*" : "function"} ndjsonStringify(value) {`);
  writer.indent(() => {
    if (iterator) {
      writer.line('for (let i = 0; i < value.length; i++) yield ndjsonStringifyRow(value[i]) + "\\n";');
    } else {
      writer.line('let out = "";');
      writer.line("for (let i = 0; i < value.length; i++) {");
      writer.indent(() => {
        writer.line('if (i !== 0) out += "\\n";');
        writer.line("out += ndjsonStringifyRow(value[i]);");
      });
      writer.line("}");
      writer.line("return out;");
    }
  });
  writer.line("}");
}
function emitCondition3(condition) {
  if (condition.kind === "logical") {
    return `(${emitCondition3(condition.left)} ${condition.op === "and" ? "&&" : "||"} ${emitCondition3(condition.right)})`;
  }
  if (condition.kind === "not") return `!(${emitCondition3(condition.inner)})`;
  const operators = { eq: "===", neq: "!==", gt: ">", gte: ">=", lt: "<", lte: "<=" };
  return `${emitQueryValue(condition.left)} ${operators[condition.op]} ${emitQueryValue(condition.right)}`;
}
function emitQueryValue(value) {
  if (value.kind === "field") return emitPropertyAccess("item", value.key);
  if (value.kind === "literal") return emitLiteral(value.value);
  if (value.kind === "binding") return value.name;
  throw new JITError("INVALID_QUERY", "NDJSON fused filters do not accept query params");
}
function emitProjection2(fields) {
  if (fields === void 0) return "item";
  return `{ ${fields.map((field) => `${JSON.stringify(field)}: ${emitPropertyAccess("item", field)}`).join(", ")} }`;
}
function compileNdjsonParse(descriptor) {
  const validator = compileValidator(descriptor.schema);
  const source = emitNdjsonSource(descriptor);
  const compiled = globalThis.Function(
    ...descriptor.bindingNames,
    "__ndjsonValidator",
    "JITValidationError",
    `return ${source};`
  )(...descriptor.bindingValues, validator, JITValidationError);
  registerArtifact(compiled, { kind: "ndjson-plan", descriptor });
  return compiled;
}
function compileNdjsonStringify(descriptor) {
  const compiled = globalThis.Function(`return ${emitNdjsonSource(descriptor)};`)();
  registerArtifact(compiled, { kind: "ndjson-plan", descriptor });
  return compiled;
}

// ../../packages/jit/src/compiler/object-ops.ts
function emitTransformSource(schema, transforms) {
  const objectSchema = expectObjectSchema2(schema, "compileTransform");
  const transformKeys = validateObjectKeys2(objectSchema, Object.keys(transforms), "compileTransform");
  const transformNames = new Map(transformKeys.map((key, index2) => [key, `__t${index2}`]));
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
function expectObjectSchema2(schema, compilerName) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects an object schema`);
  }
  return resolved;
}
function validateObjectKeys2(schema, keys, compilerName) {
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

// ../../packages/jit/src/compiler/patch.ts
function emitMergeFunction(writer, object2, name, nested) {
  const props = object2.def.props;
  writer.line(`function ${name}(value, patch) {`);
  writer.indent(() => {
    writer.line('if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;');
    writer.line("let changed = false;");
    writer.line("const out = {};");
    for (const key of Object.keys(props)) {
      const field = props[key];
      const read = emitPropertyAccess("value", key);
      const patched = emitPropertyAccess("patch", key);
      const inPatch = `${JSON.stringify(key)} in patch`;
      const base = resolveWrappers(field).base;
      const child = base.type === TypeName.object ? childName2(name, key, base, nested) : void 0;
      writer.line(`if (${inPatch}) {`);
      writer.indent(() => {
        writer.line(`if (${patched} === null) {`);
        writer.indent(() => writer.line("changed = true;"));
        writer.line("} else {");
        writer.indent(() => {
          if (child === void 0) {
            writer.line(`out[${JSON.stringify(key)}] = ${patched};`);
            writer.line(`if (!Object.is(${read}, ${patched})) changed = true;`);
          } else {
            writer.line(`const merged = ${child}(${read}, ${patched});`);
            writer.line(`out[${JSON.stringify(key)}] = merged;`);
            writer.line(`if (!Object.is(${read}, merged)) changed = true;`);
          }
        });
        writer.line("}");
      });
      writer.line(`} else if (${JSON.stringify(key)} in value) {`);
      writer.indent(() => writer.line(`out[${JSON.stringify(key)}] = ${read};`));
      writer.line("}");
    }
    writer.line("return changed ? out : value;");
  });
  writer.line("}");
}
function childName2(parent, key, schema, nested) {
  const name = `${parent}_${key.replace(/[^A-Za-z0-9_$]/g, "_")}`;
  if (!nested.has(name)) {
    const writer = new CodeWriter();
    nested.set(name, "");
    emitMergeFunction(writer, schema, name, nested);
    nested.set(name, writer.toString());
  }
  return name;
}
function emitMergePatchProgram(schema) {
  const object2 = expectProjectionObject(schema, "JIT.patch.merge()");
  const nested = /* @__PURE__ */ new Map();
  const root = new CodeWriter();
  emitMergeFunction(root, object2, "mergePatch", nested);
  const helpers = [...nested.values()].filter((source) => source !== "");
  return `(function () {
${helpers.join("\n")}
${root.toString()}
return mergePatch;
})()`;
}
function compileMergePatch(schema, options) {
  const template = getCompileCached(
    schema,
    "patch:merge",
    () => {
      const source = emitMergePatchProgram(schema);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create();
  registerArtifact(compiled, { kind: "patch-plan", schema, mode: "merge" });
  return compiled;
}
function emitJsonPatchSource(schema) {
  expectProjectionObject(schema, "JIT.patch.json()");
  const writer = new CodeWriter();
  writer.line("function applyPatch(value, operations) {");
  writer.indent(() => {
    writer.line("let out = value;");
    writer.line("for (let i = 0, len = operations.length; i < len; i++) {");
    writer.indent(() => {
      writer.line("const operation = operations[i];");
      writer.line("const path = __parsePointer(operation.path);");
      writer.line("switch (operation.op) {");
      writer.indent(() => {
        writer.line('case "add": out = __set(out, path, operation.value, true); break;');
        writer.line('case "replace": out = __set(out, path, operation.value, false); break;');
        writer.line('case "remove": out = __remove(out, path); break;');
        writer.line('case "move": {');
        writer.indent(() => {
          writer.line("const from = __parsePointer(operation.from);");
          writer.line("const moved = __get(out, from);");
          writer.line("out = __set(__remove(out, from), path, moved, true);");
          writer.line("break;");
        });
        writer.line("}");
        writer.line('case "copy": {');
        writer.indent(() => {
          writer.line("const from = __parsePointer(operation.from);");
          writer.line("out = __set(out, path, __get(out, from), true);");
          writer.line("break;");
        });
        writer.line("}");
        writer.line('case "test": {');
        writer.indent(() => {
          writer.line("if (!__patchEqual(__get(out, path), operation.value)) {");
          writer.indent(() => writer.line('throw new Error("json patch test failed at " + operation.path);'));
          writer.line("}");
          writer.line("break;");
        });
        writer.line("}");
        writer.line('default: throw new Error("unsupported json patch op: " + operation.op);');
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}
var JSON_PATCH_HELPERS = `function __parsePointer(pointer) {
  if (pointer === "") return [];
  if (pointer.charCodeAt(0) !== 47) throw new Error("json pointer must start with /: " + pointer);
  const raw = pointer.slice(1).split("/");
  const out = new Array(raw.length);
  for (let i = 0, len = raw.length; i < len; i++) {
    const segment = raw[i];
    out[i] = segment.indexOf("~") === -1 ? segment : segment.replace(/~1/g, "/").replace(/~0/g, "~");
  }
  return out;
}
function __get(value, path) {
  let current = value;
  for (let i = 0, len = path.length; i < len; i++) {
    if (current === null || current === undefined) throw new Error("json pointer does not resolve");
    current = current[path[i]];
  }
  return current;
}
function __copy(value, segment) {
  if (Array.isArray(value)) return value.slice();
  return { ...value };
}
function __set(value, path, next, isAdd) {
  if (path.length === 0) return next;
  const key = path[0];
  const out = __copy(value, key);
  if (path.length === 1) {
    if (Array.isArray(out)) {
      const index = key === "-" ? out.length : Number(key);
      if (isAdd) out.splice(index, 0, next);
      else out[index] = next;
    } else {
      out[key] = next;
    }
    return out;
  }
  out[key] = __set(value[key], path.slice(1), next, isAdd);
  return out;
}
function __remove(value, path) {
  if (path.length === 0) return undefined;
  const key = path[0];
  const out = __copy(value, key);
  if (path.length === 1) {
    if (Array.isArray(out)) out.splice(Number(key), 1);
    else delete out[key];
    return out;
  }
  out[key] = __remove(value[key], path.slice(1));
  return out;
}`;
var PATCH_EQUAL_HELPER = `function __patchEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;
  if (leftIsArray) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!__patchEqual(left[i], right[i])) return false;
    return true;
  }
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (let i = 0; i < keys.length; i++) {
    if (!__patchEqual(left[keys[i]], right[keys[i]])) return false;
  }
  return true;
}`;
function compileJsonPatch(schema, options) {
  const template = getCompileCached(
    schema,
    "patch:json",
    () => {
      const source = emitJsonPatchSource(schema);
      return {
        source,
        create: globalThis.Function("__patchEqual", `${JSON_PATCH_HELPERS}
return ${source};`)
      };
    },
    options
  );
  const compiled = template.create(deepEqual);
  registerArtifact(compiled, { kind: "patch-plan", schema, mode: "json" });
  return compiled;
}
function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!deepEqual(left[i], right[i])) return false;
    return true;
  }
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!deepEqual(left[key], right[key])) return false;
  }
  return true;
}

// ../../packages/jit/src/compiler/project.ts
function emitProjectSource(tree) {
  return `function project(value) {
  return ${emitProjectionLiteral(tree, "value")};
}`;
}
function compileProject(schema, paths, options) {
  const tree = buildProjectionTree(schema, paths, "JIT.project()");
  const template = getCompileCached(
    schema,
    `project:${projectionCacheKey(tree)}`,
    () => {
      const source = emitProjectSource(tree);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create();
  registerArtifact(compiled, { kind: "project-plan", schema, tree });
  return compiled;
}
function emitAuthorizedProjectSource(context, action) {
  const object2 = expectProjectionObject(context.descriptor.subject, "JIT.project().authorize()");
  const lines = ["function project(value) {", "  const out = {};"];
  for (const field of Object.keys(object2.def.props)) {
    const check = emitAccessActionExpression(context.descriptor, action, "value", JSON.stringify(field), "__actor");
    if (check === "false") continue;
    const assignment = `out${emitPropertyAccess("", field)} = ${emitPropertyAccess("value", field)};`;
    lines.push(check === "true" ? `  ${assignment}` : `  if (${check}) ${assignment}`);
  }
  lines.push("  return out;", "}");
  return lines.join("\n");
}
function compileAuthorizedProject(context, action) {
  const source = emitAuthorizedProjectSource(context, action);
  const compiled = globalThis.Function("__actor", `return ${source};`)(context.actor);
  registerArtifact(compiled, {
    kind: "authorized-project-plan",
    schema: context.descriptor.subject,
    descriptor: context.descriptor,
    actor: context.actor,
    action
  });
  return compiled;
}

// ../../packages/jit/src/compiler/reconcile.ts
var ALL_CHANNELS = Object.freeze({
  added: true,
  removed: true,
  changed: true,
  unchanged: true
});
function resolveReconcileDescriptor(schema, key, channels, changes, sink) {
  const object2 = resolveRowObjectSchema(schema, "reconcile");
  const resolved = key ?? resolveIndexKeysFromFacts(schema)?.[0];
  if (!resolved) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      "JIT.reconcile() needs an identity: declare one with .keyed()/.indexBy()/.uniqueBy()/.entity(), or name it with .by()"
    );
  }
  const field = resolveRowField(object2, resolved, "reconcile");
  return Object.freeze({
    key: resolved,
    date: resolveScalarKeyKind(field, resolved, "reconcile") === "date",
    channels: Object.freeze({ ...channels }),
    changes,
    sink
  });
}
function emitReconcileSource(descriptor) {
  const writer = new CodeWriter();
  const { channels, sink } = descriptor;
  const previousKey = readKey(descriptor, "previousItem");
  const currentKey = readKey(descriptor, "item");
  const consumes = channels.removed;
  const emit = emitter(sink);
  writer.line(`${sink === "iterator" ? "function*" : "function"} reconcile(previous, current${sinkParam(sink)}) {`);
  writer.indent(() => {
    writer.line("const index = new Map();");
    writer.line("for (let i = 0, len = previous.length; i < len; i++) {");
    writer.indent(() => {
      writer.line("const previousItem = previous[i];");
      writer.line(`index.set(${previousKey}, previousItem);`);
    });
    writer.line("}");
    if (sink === "result") {
      if (channels.added) writer.line("const added = [];");
      if (channels.removed) writer.line("const removed = [];");
      if (channels.changed) writer.line("const changed = [];");
      if (channels.unchanged) writer.line("const unchanged = [];");
    }
    writer.line("for (let i = 0, len = current.length; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = current[i];");
      const comparesRows = channels.changed || channels.unchanged;
      const needsPrevious = channels.added || comparesRows;
      if (!needsPrevious) {
        if (consumes) writer.line(`index.delete(${currentKey});`);
        return;
      }
      writer.line(`const id = ${currentKey};`);
      writer.line("const previousItem = index.get(id);");
      const writeMatched = () => {
        if (consumes) writer.line("index.delete(id);");
        emitMatched(writer, descriptor, emit);
      };
      if (channels.added) {
        writer.line("if (previousItem === undefined) {");
        writer.indent(() => emit(writer, "added", "item"));
        if (consumes || comparesRows) {
          writer.line("} else {");
          writer.indent(writeMatched);
        }
        writer.line("}");
      } else {
        writer.line("if (previousItem !== undefined) {");
        writer.indent(writeMatched);
        writer.line("}");
      }
    });
    writer.line("}");
    if (channels.removed) {
      writer.line("for (const previousItem of index.values()) {");
      writer.indent(() => emit(writer, "removed", "previousItem"));
      writer.line("}");
    }
    if (sink === "result") writer.line(`return ${resultLiteral(channels)};`);
    if (sink === "visitor") writer.line("return undefined;");
  });
  writer.line("}");
  return writer.toString();
}
function emitMatched(writer, descriptor, emit) {
  const { changed: changed3, unchanged } = descriptor.channels;
  if (!changed3 && !unchanged) return;
  if (changed3 && !unchanged) {
    writer.line("if (previousItem !== item && !__reconcileEqual(previousItem, item)) {");
    writer.indent(() => emitChanged(writer, descriptor, emit));
    writer.line("}");
    return;
  }
  if (unchanged && !changed3) {
    writer.line("if (previousItem === item || __reconcileEqual(previousItem, item)) {");
    writer.indent(() => emit(writer, "unchanged", "item"));
    writer.line("}");
    return;
  }
  writer.line("if (previousItem === item || __reconcileEqual(previousItem, item)) {");
  writer.indent(() => emit(writer, "unchanged", "item"));
  writer.line("} else {");
  writer.indent(() => emitChanged(writer, descriptor, emit));
  writer.line("}");
}
function emitChanged(writer, descriptor, emit) {
  if (descriptor.changes === "diff") {
    writer.line("const delta = __reconcileDiff(previousItem, item);");
    emit(writer, "changed", "{ before: previousItem, after: item, diff: delta }", "previousItem, item, delta");
    return;
  }
  emit(writer, "changed", "{ before: previousItem, after: item }", "previousItem, item");
}
function emitter(sink) {
  return (writer, channel, value, visitorArgs = value) => {
    if (sink === "visitor") {
      writer.line(`if (visitor.${channel} !== undefined) visitor.${channel}(${visitorArgs});`);
      return;
    }
    if (sink === "iterator") {
      writer.line(`yield { type: ${JSON.stringify(channel)}, value: ${value} };`);
      return;
    }
    writer.line(`${channel}[${channel}.length] = ${value};`);
  };
}
function sinkParam(sink) {
  return sink === "visitor" ? ", visitor" : "";
}
function resultLiteral(channels) {
  const parts = [];
  if (channels.added) parts.push("added");
  if (channels.removed) parts.push("removed");
  if (channels.changed) parts.push("changed");
  if (channels.unchanged) parts.push("unchanged");
  return `{ ${parts.join(", ")} }`;
}
function readKey(descriptor, row) {
  const access2 = emitPropertyAccess(row, descriptor.key);
  return descriptor.date ? `${access2}.getTime()` : access2;
}
function reconcileCacheKey(descriptor) {
  const { channels } = descriptor;
  const on = [channels.added && "a", channels.removed && "r", channels.changed && "c", channels.unchanged && "u"].filter(Boolean).join("");
  return `reconcile:${descriptor.sink}:${descriptor.key}:${descriptor.date}:${descriptor.changes}:${on}`;
}
function compileReconcile(schema, descriptor, options) {
  const object2 = resolveRowObjectSchema(schema, "reconcile");
  const template = getCompileCached(
    schema,
    reconcileCacheKey(descriptor),
    () => {
      const source = emitReconcileSource(descriptor);
      return {
        source,
        create: globalThis.Function("__reconcileEqual", "__reconcileDiff", `return ${source};`)
      };
    },
    options
  );
  const compiled = template.create(
    compileEqual(object2),
    descriptor.changes === "diff" ? compileDiff(object2) : void 0
  );
  registerArtifact(compiled, { kind: "reconcile-plan", schema, descriptor });
  return compiled;
}

// ../../packages/jit/src/compiler/rules.ts
function resolveRulesDescriptor(subject, inputs, declarations) {
  const subjectObject = expectProjectionObject(subject, "JIT.rules()");
  const inputObject = inputs === void 0 ? void 0 : expectProjectionObject(inputs, "JIT.rules().inputs()");
  const ids = /* @__PURE__ */ new Set();
  const rules2 = [];
  const bindingNames = [];
  const bindings = [];
  for (let order = 0; order < declarations.length; order++) {
    const declaration = declarations[order];
    if (declaration.id.length === 0) throw new JITError("INVALID_OPERATION", "rule id must not be empty");
    if (ids.has(declaration.id)) {
      throw new JITError("INVALID_OPERATION", `rule id ${JSON.stringify(declaration.id)} is duplicated`);
    }
    if (!Number.isSafeInteger(declaration.priority)) {
      throw new JITError("INVALID_OPERATION", `rule ${JSON.stringify(declaration.id)} priority must be a safe integer`);
    }
    const subjectPaths = /* @__PURE__ */ new Set();
    const inputPaths = /* @__PURE__ */ new Set();
    validateCondition3(declaration.condition, subjectObject, inputObject, subjectPaths, inputPaths);
    const folded = foldCondition(declaration.condition);
    const constant2 = typeof folded === "boolean" ? folded : void 0;
    const condition = typeof folded === "boolean" ? TRUE_CONDITION : folded;
    const dependencies = constant2 === void 0 ? { subjectPaths, inputPaths } : collectPaths(condition);
    const outcome = declaration.outcome === void 0 ? void 0 : resolveOutcome(declaration, subjectObject, inputObject, dependencies, (value) => {
      const name = `__ro${bindings.length}`;
      bindings[bindings.length] = value;
      bindingNames[bindingNames.length] = name;
      return name;
    });
    ids.add(declaration.id);
    rules2[rules2.length] = Object.freeze({
      id: declaration.id,
      condition: freezeCondition(condition),
      constant: constant2,
      priority: declaration.priority,
      order,
      subjectPaths: Object.freeze([...dependencies.subjectPaths]),
      inputPaths: Object.freeze([...dependencies.inputPaths]),
      outcome
    });
  }
  return Object.freeze({
    subject,
    inputs,
    rules: Object.freeze(rules2),
    ids: Object.freeze([...ids]),
    outcomes: rules2.some((rule) => rule.outcome !== void 0),
    bindingNames: Object.freeze(bindingNames),
    bindings: Object.freeze(bindings)
  });
}
var TRUE_CONDITION = Object.freeze({
  kind: "compare",
  op: "eq",
  left: Object.freeze({ kind: "literal", value: true }),
  right: Object.freeze({ kind: "literal", value: true })
});
function collectPaths(condition) {
  const subjectPaths = /* @__PURE__ */ new Set();
  const inputPaths = /* @__PURE__ */ new Set();
  const walk = (node) => {
    if (node.kind === "logical") {
      walk(node.left);
      walk(node.right);
      return;
    }
    if (node.kind === "not") {
      walk(node.inner);
      return;
    }
    for (const value of [node.left, node.right]) {
      if (value.kind === "field") subjectPaths.add(value.key);
      else if (value.kind === "param") inputPaths.add(value.name);
    }
  };
  walk(condition);
  return { subjectPaths, inputPaths };
}
function resolveOutcome(declaration, subject, inputs, dependencies, bind) {
  const outcome = declaration.outcome;
  const shape = expectProjectionObject(outcome.target, `rule ${JSON.stringify(declaration.id)} outcome`);
  const explicit = outcome.fields;
  for (const key of Object.keys(explicit)) {
    if (shape.def.props[key] === void 0) {
      throw new JITError(
        "INVALID_OPERATION",
        `rule ${JSON.stringify(declaration.id)} outcome names unknown target field ${JSON.stringify(key)}`
      );
    }
  }
  const fields = [];
  for (const key of Object.keys(shape.def.props)) {
    const target = shape.def.props[key];
    const value = explicit[key] ?? autoMatchOutcomeValue(key, target, subject, inputs);
    if (value === void 0) {
      if (resolveWrappers(target).optional) continue;
      throw new JITError(
        "INVALID_OPERATION",
        `rule ${JSON.stringify(declaration.id)} outcome cannot fill required target field ${JSON.stringify(key)}`
      );
    }
    if (value.kind === "field") {
      if (subject.def.props[value.key] === void 0) {
        throw new JITError(
          "INVALID_OPERATION",
          `rule ${JSON.stringify(declaration.id)} outcome names unknown subject field ${JSON.stringify(value.key)}`
        );
      }
      dependencies.subjectPaths.add(value.key);
    } else if (value.kind === "param") {
      if (inputs?.def.props[value.name] === void 0) {
        throw new JITError(
          "INVALID_OPERATION",
          `rule ${JSON.stringify(declaration.id)} outcome names unknown input ${JSON.stringify(value.name)}`
        );
      }
      dependencies.inputPaths.add(value.name);
    } else if (value.kind === "binding") {
      throw new JITError("INVALID_OPERATION", "rule outcomes carry compiler literals, subject fields or inputs");
    }
    fields[fields.length] = Object.freeze({ key, value: Object.freeze({ ...value }) });
  }
  return Object.freeze({
    kind: outcome.kind,
    target: outcome.target,
    type: outcome.type,
    fields: Object.freeze(fields),
    binding: outcome.kind === "event" ? bind(outcome.factory) : void 0
  });
}
function autoMatchOutcomeValue(key, target, subject, inputs) {
  if (subject.def.props[key] !== void 0) return { kind: "field", key };
  if (inputs?.def.props[key] !== void 0) return { kind: "param", name: key };
  const base = resolveWrappers(target).base;
  if (base.type === TypeName.literal) return { kind: "literal", value: base.def.value };
  return void 0;
}
function validateCondition3(condition, subject, inputs, subjectPaths, inputPaths) {
  if (condition.kind === "logical") {
    validateCondition3(condition.left, subject, inputs, subjectPaths, inputPaths);
    validateCondition3(condition.right, subject, inputs, subjectPaths, inputPaths);
    return;
  }
  if (condition.kind === "not") {
    validateCondition3(condition.inner, subject, inputs, subjectPaths, inputPaths);
    return;
  }
  validateValue2(condition.left, subject, inputs, subjectPaths, inputPaths);
  validateValue2(condition.right, subject, inputs, subjectPaths, inputPaths);
}
function validateValue2(value, subject, inputs, subjectPaths, inputPaths) {
  if (value.kind === "field") {
    if (subject.def.props[value.key] === void 0) {
      throw new JITError("INVALID_OPERATION", `rule condition names unknown subject field ${JSON.stringify(value.key)}`);
    }
    subjectPaths.add(value.key);
    return;
  }
  if (value.kind === "param") {
    if (inputs?.def.props[value.name] === void 0) {
      throw new JITError("INVALID_OPERATION", `rule condition names unknown input ${JSON.stringify(value.name)}`);
    }
    inputPaths.add(value.name);
    return;
  }
  if (value.kind === "binding") {
    throw new JITError("INVALID_OPERATION", "rules require compiler literals or declared inputs, not runtime bindings");
  }
  const literal4 = value.value;
  if (literal4 !== null && literal4 !== void 0 && typeof literal4 !== "string" && typeof literal4 !== "number" && typeof literal4 !== "bigint" && typeof literal4 !== "boolean") {
    throw new JITError("INVALID_OPERATION", "rule literals must be primitive compiler literals");
  }
}
var COMPARATORS = Object.freeze({
  eq: (left, right) => left === right,
  neq: (left, right) => left !== right,
  gt: (left, right) => left > right,
  gte: (left, right) => left >= right,
  lt: (left, right) => left < right,
  lte: (left, right) => left <= right
});
function foldCondition(condition) {
  if (condition.kind === "logical") {
    const left = foldCondition(condition.left);
    const right = foldCondition(condition.right);
    if (condition.op === "and") {
      if (left === false || right === false) return false;
      if (left === true) return right;
      if (right === true) return left;
    } else {
      if (left === true || right === true) return true;
      if (left === false) return right;
      if (right === false) return left;
    }
    return { kind: "logical", op: condition.op, left, right };
  }
  if (condition.kind === "not") {
    const inner = foldCondition(condition.inner);
    if (typeof inner === "boolean") return !inner;
    if (inner.kind === "not") return inner.inner;
    return { kind: "not", inner };
  }
  if (condition.left.kind === "literal" && condition.right.kind === "literal") {
    return COMPARATORS[condition.op](condition.left.value, condition.right.value);
  }
  return condition;
}
function freezeCondition(condition) {
  if (condition.kind === "logical") {
    return Object.freeze({
      ...condition,
      left: freezeCondition(condition.left),
      right: freezeCondition(condition.right)
    });
  }
  if (condition.kind === "not") return Object.freeze({ ...condition, inner: freezeCondition(condition.inner) });
  return Object.freeze({
    ...condition,
    left: Object.freeze({ ...condition.left }),
    right: Object.freeze({ ...condition.right })
  });
}
var SUBJECT = "subject";
var INPUTS = "inputs";
function paramList(descriptor, head, tail) {
  const parts = [head];
  if (descriptor.inputs !== void 0) parts[parts.length] = INPUTS;
  if (tail !== void 0) parts[parts.length] = tail;
  return parts.join(", ");
}
function orderedRules(descriptor) {
  const live = descriptor.rules.filter((rule) => rule.constant !== false);
  return [...live].sort((left, right) => right.priority - left.priority || left.order - right.order);
}
var EMPTY_PLAN = Object.freeze({
  reads: /* @__PURE__ */ new Map(),
  predicates: /* @__PURE__ */ new Map(),
  invariant: Object.freeze([]),
  variant: Object.freeze([])
});
function planShared(rules2, loop = false) {
  const leaves = [];
  const collect = (node) => {
    if (node.kind === "logical") {
      collect(node.left);
      collect(node.right);
      return;
    }
    if (node.kind === "not") {
      collect(node.inner);
      return;
    }
    leaves[leaves.length] = node;
  };
  for (const rule of rules2) if (rule.constant === void 0) collect(rule.condition);
  const plain = { fieldBase: SUBJECT, paramBase: INPUTS };
  const counts = /* @__PURE__ */ new Map();
  const nodes = /* @__PURE__ */ new Map();
  for (const leaf of leaves) {
    const key = emitQueryConditionSource(leaf, plain);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!nodes.has(key)) nodes.set(key, leaf);
  }
  const predicates = /* @__PURE__ */ new Map();
  for (const [key, count] of counts) {
    if (count > 1 || loop && !readsSubject(nodes.get(key))) {
      predicates.set(key, `c${predicates.size}`);
    }
  }
  const readCounts = /* @__PURE__ */ new Map();
  const countValue = (value) => {
    const key = value.kind === "field" ? `f:${value.key}` : value.kind === "param" ? `p:${value.name}` : void 0;
    if (key !== void 0) readCounts.set(key, (readCounts.get(key) ?? 0) + 1);
  };
  const countLeaf = (leaf) => {
    if (leaf.kind !== "compare") return;
    countValue(leaf.left);
    countValue(leaf.right);
  };
  for (const leaf of leaves) {
    if (leaf.kind !== "compare") continue;
    if (predicates.has(emitQueryConditionSource(leaf, plain))) continue;
    countLeaf(leaf);
  }
  for (const key of predicates.keys()) countLeaf(nodes.get(key));
  for (const rule of rules2) {
    for (const field of rule.outcome?.fields ?? []) countValue(field.value);
  }
  const reads = /* @__PURE__ */ new Map();
  const invariant = [];
  const variant = [];
  for (const [key, count] of readCounts) {
    const invariantRead = loop && key.startsWith("p:");
    if (count < 2 && !invariantRead) continue;
    const path = key.slice(2);
    if (key.startsWith("f:")) {
      const local = `s${variant.length}`;
      reads.set(key, local);
      variant[variant.length] = { local, source: emitPropertyAccess(SUBJECT, path) };
    } else {
      const local = `p${invariant.length}`;
      reads.set(key, local);
      invariant[invariant.length] = { local, source: emitPropertyAccess(INPUTS, path) };
    }
  }
  const withReads = readContext(reads);
  for (const [key, local] of predicates) {
    const node = nodes.get(key);
    const binding = { local, source: emitQueryConditionSource(node, withReads) };
    if (readsSubject(node)) variant[variant.length] = binding;
    else invariant[invariant.length] = binding;
  }
  return {
    reads,
    predicates,
    invariant: Object.freeze(invariant),
    variant: Object.freeze(variant)
  };
}
function readsSubject(node) {
  if (node.kind === "logical") return readsSubject(node.left) || readsSubject(node.right);
  if (node.kind === "not") return readsSubject(node.inner);
  return node.left.kind === "field" || node.right.kind === "field";
}
function readContext(reads) {
  if (reads.size === 0) return { fieldBase: SUBJECT, paramBase: INPUTS };
  return {
    fieldBase: SUBJECT,
    paramBase: INPUTS,
    fieldAccess: (key) => reads.get(`f:${key}`) ?? emitPropertyAccess(SUBJECT, key),
    paramAccess: (name) => reads.get(`p:${name}`) ?? emitPropertyAccess(INPUTS, name)
  };
}
function emitCondition4(rule, plan) {
  if (rule.constant !== void 0) return String(rule.constant);
  return emitNode2(rule.condition, plan);
}
function emitNode2(node, plan) {
  if (node.kind === "logical") {
    const operator = node.op === "and" ? "&&" : "||";
    return `(${emitNode2(node.left, plan)} ${operator} ${emitNode2(node.right, plan)})`;
  }
  if (node.kind === "not") return `!(${emitNode2(node.inner, plan)})`;
  const shared = plan.predicates.get(emitQueryConditionSource(node, { fieldBase: SUBJECT, paramBase: INPUTS }));
  return shared ?? emitQueryConditionSource(node, readContext(plan.reads));
}
function emitOutcome(rule, plan, options) {
  const outcome = rule.outcome;
  if (outcome === void 0) return "undefined";
  const context = readContext(plan.reads);
  const fields = outcome.fields.map((field) => `${emitObjectKey(field.key)}: ${emitQueryValueSource(field.value, context)}`).join(", ");
  const value = `{ ${fields} }`;
  if (outcome.kind === "object") return value;
  const binding = outcome.binding;
  return `${options.bindingNames?.get(binding) ?? binding}.create(${value})`;
}
function emitBindings(writer, bindings) {
  for (const binding of bindings) writer.line(`const ${binding.local} = ${binding.source};`);
}
function emitRulesTestSource(descriptor) {
  const writer = new CodeWriter();
  writer.line(`function rulesTest(${paramList(descriptor, "rule, subject")}) {`);
  writer.indent(() => {
    writer.line("switch (rule) {");
    writer.indent(() => {
      for (const rule of descriptor.rules) {
        writer.line(`case ${JSON.stringify(rule.id)}:`);
        writer.indent(() => writer.line(`return ${emitCondition4(rule, EMPTY_PLAN)};`));
      }
      writer.line("default:");
      writer.indent(() => writer.line("return false;"));
    });
    writer.line("}");
  });
  writer.line("}");
  return writer.toString();
}
function emitRulesPredicateSource(descriptor, ruleId) {
  const rule = descriptor.rules.find((candidate) => candidate.id === ruleId);
  if (rule === void 0) {
    throw new JITError("INVALID_OPERATION", `unknown rule ${JSON.stringify(ruleId)}`);
  }
  return `function rulesPredicate(${paramList(descriptor, SUBJECT)}) {
  return ${emitCondition4(rule, EMPTY_PLAN)};
}
`;
}
function emitRulesSomeSource(descriptor) {
  const rules2 = descriptor.rules.filter((rule) => rule.constant !== false);
  const always = rules2.some((rule) => rule.constant === true);
  const expression = always ? "true" : rules2.length === 0 ? "false" : rules2.map((rule) => `(${emitCondition4(rule, EMPTY_PLAN)})`).join(" || ");
  return `function rulesSome(${paramList(descriptor, SUBJECT)}) {
  return ${expression};
}
`;
}
function emitRulesFirstSource(descriptor) {
  const writer = new CodeWriter();
  writer.line(`function rulesFirst(${paramList(descriptor, SUBJECT)}) {`);
  writer.indent(() => {
    for (const rule of orderedRules(descriptor)) {
      if (rule.constant === true) {
        writer.line(`return ${JSON.stringify(rule.id)};`);
        writer.line("}");
        return;
      }
      writer.line(`if (${emitCondition4(rule, EMPTY_PLAN)}) return ${JSON.stringify(rule.id)};`);
    }
    writer.line("return undefined;");
  });
  writer.line("}");
  return writer.toString();
}
function emitRulesMatchSource(descriptor) {
  const rules2 = orderedRules(descriptor);
  const plan = planShared(rules2);
  const writer = new CodeWriter();
  writer.line(`function rulesMatch(${paramList(descriptor, SUBJECT)}) {`);
  writer.indent(() => {
    emitBindings(writer, plan.invariant);
    emitBindings(writer, plan.variant);
    writer.line("const out = [];");
    writer.line("let j = 0;");
    for (const rule of rules2) {
      const id = JSON.stringify(rule.id);
      if (rule.constant === true) writer.line(`out[j++] = ${id};`);
      else writer.line(`if (${emitCondition4(rule, plan)}) out[j++] = ${id};`);
    }
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}
function outcomeRules(descriptor) {
  return orderedRules(descriptor).filter((rule) => rule.outcome !== void 0);
}
function emitRulesRunSource(descriptor, options = {}) {
  const rules2 = outcomeRules(descriptor);
  const plan = planShared(rules2);
  const writer = new CodeWriter();
  writer.line(`function rulesRun(${paramList(descriptor, SUBJECT)}) {`);
  writer.indent(() => {
    emitBindings(writer, plan.invariant);
    emitBindings(writer, plan.variant);
    writer.line("const out = [];");
    writer.line("let j = 0;");
    for (const rule of rules2) {
      const outcome = emitOutcome(rule, plan, options);
      if (rule.constant === true) writer.line(`out[j++] = ${outcome};`);
      else writer.line(`if (${emitCondition4(rule, plan)}) out[j++] = ${outcome};`);
    }
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}
function emitRulesVisitorSource(descriptor, options = {}) {
  const rules2 = orderedRules(descriptor);
  const plan = planShared(rules2);
  const writer = new CodeWriter();
  writer.line(`function rulesVisit(${paramList(descriptor, SUBJECT, "consume")}) {`);
  writer.indent(() => {
    emitBindings(writer, plan.invariant);
    emitBindings(writer, plan.variant);
    writer.line("let n = 0;");
    for (const rule of rules2) {
      const call2 = `n++, consume(${JSON.stringify(rule.id)}, ${emitOutcome(rule, plan, options)});`;
      if (rule.constant === true) writer.line(call2);
      else writer.line(`if (${emitCondition4(rule, plan)}) ${call2}`);
    }
    writer.line("return n;");
  });
  writer.line("}");
  return writer.toString();
}
function emitRulesIteratorSource(descriptor, options = {}) {
  const rules2 = outcomeRules(descriptor);
  const plan = planShared(rules2);
  const writer = new CodeWriter();
  writer.line(`function* rulesIterate(${paramList(descriptor, SUBJECT)}) {`);
  writer.indent(() => {
    emitBindings(writer, plan.invariant);
    emitBindings(writer, plan.variant);
    for (const rule of rules2) {
      const outcome = `yield ${emitOutcome(rule, plan, options)};`;
      if (rule.constant === true) writer.line(outcome);
      else writer.line(`if (${emitCondition4(rule, plan)}) ${outcome}`);
    }
  });
  writer.line("}");
  return writer.toString();
}
function emitManyBody(writer, rules2, plan, options, statement) {
  emitBindings(writer, plan.invariant);
  writer.line("const size = list.length;");
  writer.line("for (let i = 0; i < size; i++) {");
  writer.indent(() => {
    writer.line("const subject = list[i];");
    emitBindings(writer, plan.variant);
    for (const rule of rules2) {
      const line = statement(rule, emitOutcome(rule, plan, options));
      if (rule.constant === true) writer.line(line);
      else writer.line(`if (${emitCondition4(rule, plan)}) ${line}`);
    }
  });
  writer.line("}");
}
function emitRulesManySource(descriptor, options = {}) {
  const rules2 = outcomeRules(descriptor);
  const plan = planShared(rules2, true);
  const writer = new CodeWriter();
  writer.line(`function rulesMany(${paramList(descriptor, "list")}) {`);
  writer.indent(() => {
    writer.line("const out = [];");
    writer.line("let j = 0;");
    emitManyBody(writer, rules2, plan, options, (_rule, outcome) => `out[j++] = ${outcome};`);
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}
function emitRulesManyVisitorSource(descriptor, options = {}) {
  const rules2 = orderedRules(descriptor);
  const plan = planShared(rules2, true);
  const writer = new CodeWriter();
  writer.line(`function rulesManyVisit(${paramList(descriptor, "list", "consume")}) {`);
  writer.indent(() => {
    writer.line("let n = 0;");
    emitManyBody(
      writer,
      rules2,
      plan,
      options,
      (rule, outcome) => `n++, consume(${JSON.stringify(rule.id)}, ${outcome}, i);`
    );
    writer.line("return n;");
  });
  writer.line("}");
  return writer.toString();
}
function emitRulesManyIteratorSource(descriptor, options = {}) {
  const rules2 = outcomeRules(descriptor);
  const plan = planShared(rules2, true);
  const writer = new CodeWriter();
  writer.line(`function* rulesManyIterate(${paramList(descriptor, "list")}) {`);
  writer.indent(() => {
    emitManyBody(writer, rules2, plan, options, (_rule, outcome) => `yield ${outcome};`);
  });
  writer.line("}");
  return writer.toString();
}
function emitRulesExplainSource(descriptor) {
  const rules2 = orderedRules(descriptor);
  const plan = planShared(rules2);
  const writer = new CodeWriter();
  writer.line(`function rulesExplain(${paramList(descriptor, SUBJECT)}) {`);
  writer.indent(() => {
    emitBindings(writer, plan.invariant);
    emitBindings(writer, plan.variant);
    writer.line("const matched = [];");
    writer.line("let j = 0;");
    for (const rule of rules2) {
      const id = JSON.stringify(rule.id);
      if (rule.constant === true) writer.line(`matched[j++] = ${id};`);
      else writer.line(`if (${emitCondition4(rule, plan)}) matched[j++] = ${id};`);
    }
    writer.line(`return { matched, evaluated: ${JSON.stringify(rules2.map((rule) => rule.id))} };`);
  });
  writer.line("}");
  return writer.toString();
}
function emitRulesPlanSource(descriptor, options) {
  const writer = new CodeWriter();
  writer.line("(() => {");
  writer.indent(() => {
    for (const source of [
      emitRulesTestSource(descriptor),
      emitRulesSomeSource(descriptor),
      emitRulesFirstSource(descriptor),
      emitRulesMatchSource(descriptor),
      emitRulesRunSource(descriptor, options),
      emitRulesVisitorSource(descriptor, options),
      emitRulesIteratorSource(descriptor, options),
      emitRulesManySource(descriptor, options),
      emitRulesManyVisitorSource(descriptor, options),
      emitRulesManyIteratorSource(descriptor, options),
      emitRulesExplainSource(descriptor)
    ]) {
      for (const line of source.split("\n")) writer.line(line);
    }
    writer.line("const many = Object.assign(rulesMany, {");
    writer.indent(() => {
      writer.line("to: Object.freeze({ visitor: () => rulesManyVisit, iterator: () => rulesManyIterate }),");
    });
    writer.line("});");
    writer.line("const predicates = Object.freeze({");
    writer.indent(() => {
      for (const rule of descriptor.rules) {
        writer.line(`${emitObjectKey(rule.id)}: ${emitRulesPredicateSource(descriptor, rule.id).trim()},`);
      }
    });
    writer.line("});");
    writer.line("return Object.freeze({");
    writer.indent(() => {
      writer.line("test: rulesTest,");
      writer.line("some: rulesSome,");
      writer.line("first: rulesFirst,");
      writer.line("match: rulesMatch,");
      writer.line("run: rulesRun,");
      writer.line("explain: rulesExplain,");
      writer.line("predicate: (rule) => predicates[rule],");
      writer.line("many: () => many,");
      writer.line("to: Object.freeze({ visitor: () => rulesVisit, iterator: () => rulesIterate }),");
      writer.line(`ids: Object.freeze(${JSON.stringify(descriptor.ids)}),`);
    });
    writer.line("});");
  });
  writer.line("})()");
  return writer.toString();
}
function emitRulesSinkSource(descriptor, sink, options = {}) {
  switch (sink) {
    case "test":
      return emitRulesTestSource(descriptor);
    case "some":
      return emitRulesSomeSource(descriptor);
    case "first":
      return emitRulesFirstSource(descriptor);
    case "match":
      return emitRulesMatchSource(descriptor);
    case "run":
      return emitRulesRunSource(descriptor, options);
    case "visitor":
      return emitRulesVisitorSource(descriptor, options);
    case "iterator":
      return emitRulesIteratorSource(descriptor, options);
    case "many":
      return emitRulesManySource(descriptor, options);
    case "many-visitor":
      return emitRulesManyVisitorSource(descriptor, options);
    case "many-iterator":
      return emitRulesManyIteratorSource(descriptor, options);
    case "explain":
      return emitRulesExplainSource(descriptor);
    case "predicate":
      return emitRulesPredicateSource(descriptor, options.ruleId);
    default:
      return emitRulesPlanSource(descriptor, options);
  }
}
function compileRulesSink(descriptor, sink, options) {
  const source = emitRulesSinkSource(descriptor, sink, { ruleId: options?.ruleId });
  const template = getCompileCached(
    descriptor.subject,
    `rules:${sink}:${source}`,
    () => ({ source, create: globalThis.Function(...descriptor.bindingNames, `return ${source};`) }),
    options
  );
  return template.create(...descriptor.bindings);
}
function inspectRules(descriptor) {
  const live = orderedRules(descriptor);
  const plan = planShared(live);
  const subjectPaths = /* @__PURE__ */ new Set();
  const inputPaths = /* @__PURE__ */ new Set();
  for (const rule of live) {
    for (const path of rule.subjectPaths) subjectPaths.add(path);
    for (const path of rule.inputPaths) inputPaths.add(path);
  }
  const declared = descriptor.inputs === void 0 ? [] : Object.keys(expectProjectionObject(descriptor.inputs, "JIT.rules().inputs()").def.props);
  return Object.freeze({
    rules: descriptor.rules.length,
    liveRules: live.length,
    deadRules: Object.freeze(descriptor.rules.filter((rule) => rule.constant === false).map((rule) => rule.id)),
    subjectPaths: Object.freeze([...subjectPaths]),
    inputPaths: Object.freeze([...inputPaths]),
    deadInputs: Object.freeze(declared.filter((name) => !inputPaths.has(name))),
    sharedReads: plan.reads.size,
    sharedPredicates: plan.predicates.size,
    priorityGroups: new Set(live.map((rule) => rule.priority)).size,
    outcomes: descriptor.rules.filter((rule) => rule.outcome !== void 0).length,
    strategy: "inline"
  });
}
function lowerRuleToQueryCondition(descriptor, ruleId, inputs, bindingOffset) {
  const rule = descriptor.rules.find((candidate) => candidate.id === ruleId);
  if (rule === void 0) throw new JITError("INVALID_OPERATION", `unknown rule ${JSON.stringify(ruleId)}`);
  if (rule.constant !== void 0) {
    return Object.freeze({ kind: rule.constant ? "always" : "never", bindings: Object.freeze([]) });
  }
  const values = [];
  const condition = bindInputs(
    rule.condition,
    inputs,
    bindingOffset,
    values
  );
  return Object.freeze({ kind: "condition", condition, bindings: Object.freeze(values) });
}
function bindInputs(condition, inputs, offset, bindings) {
  if (condition.kind === "logical") {
    return {
      ...condition,
      left: bindInputs(condition.left, inputs, offset, bindings),
      right: bindInputs(condition.right, inputs, offset, bindings)
    };
  }
  if (condition.kind === "not") return { ...condition, inner: bindInputs(condition.inner, inputs, offset, bindings) };
  return {
    ...condition,
    left: bindInputValue(condition.left, inputs, offset, bindings),
    right: bindInputValue(condition.right, inputs, offset, bindings)
  };
}
function bindInputValue(value, inputs, offset, bindings) {
  if (value.kind !== "param") return value;
  const name = `__q${offset + bindings.length}`;
  bindings[bindings.length] = inputs?.[value.name];
  return { kind: "binding", name };
}

// ../../packages/jit/src/compiler/sort.ts
function emitSortSource(descriptor) {
  const writer = new CodeWriter();
  writer.line("(() => {");
  writer.indent(() => {
    writer.line("const compare = (left, right) => {");
    writer.indent(() => emitOrderingComparatorBody(writer, descriptor));
    writer.line("};");
    writer.line("const sort = (value) => {");
    writer.indent(() => {
      writer.line("const out = value.slice();");
      writer.line("out.sort(compare);");
      writer.line("return out;");
    });
    writer.line("};");
    writer.line("Object.defineProperties(sort, {");
    writer.indent(() => {
      writer.line("compare: { value: compare },");
      writer.line("inPlace: { value: (value) => value.sort(compare) },");
    });
    writer.line("});");
    writer.line("return sort;");
  });
  writer.line("})()");
  return writer.toString();
}
function compileSort(schema, descriptor, options) {
  const ordering = resolveOrderingDescriptor(schema, descriptor.criteria);
  const cacheKey3 = `sort:${ordering.criteria.map(({ key, direction, valueKind, nullish: nullish3 }) => `${key}:${direction}:${valueKind}:${nullish3}`).join(",")}`;
  const template = getCompileCached(
    schema,
    cacheKey3,
    () => {
      const source = emitSortSource(ordering);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create();
  registerArtifact(compiled, { kind: "sort-plan", schema, descriptor: ordering });
  return compiled;
}

// ../../packages/jit/src/compiler/update/build-update-ir.ts
function buildUpdateIR(schema) {
  const { body, helpers } = buildRecursiveProgram(
    schema,
    (current, recurse) => buildUpdateNode(current, recurse),
    (id) => ({ kind: "recursive", id }),
    findRecursiveSchemas(schema)
  );
  return { kind: "program", valueParam: "value", patchParam: "patch", body, helpers };
}
function buildUpdateNode(schema, recurse) {
  if (schema.type === TypeName.runtimeType) return { kind: "reuse" };
  if (schema.type === TypeName.date) return { kind: "date" };
  if (schema.type === TypeName.union) return buildUnionNode3(schema, recurse);
  if (schema.type === TypeName.discriminatedUnion)
    return buildDiscriminatedUnionNode3(schema, recurse);
  if (schema.type === TypeName.intersection) {
    const flattened = flattenObjectIntersection(schema);
    if (flattened !== void 0) return buildUpdateNode(flattened, recurse);
  }
  const node = buildSchemaNode(schema, recurse);
  if (node) return node;
  if (isPrimitiveLikeSchema(schema)) return { kind: "reuse" };
  throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler update IR for type: ${schema.type}`);
}
function buildUnionNode3(schema, recurse) {
  if (schema.def.options.every((option) => isPrimitiveLikeSchema(option))) {
    return { kind: "reuse" };
  }
  return {
    kind: "union",
    options: schema.def.options.map((option) => ({
      schema: option,
      node: recurse(option)
    }))
  };
}
function buildDiscriminatedUnionNode3(schema, recurse) {
  return {
    kind: "discriminatedUnion",
    discriminator: schema.def.discriminator,
    options: schema.def.options.map((option) => ({
      schema: option,
      node: recurse(option)
    }))
  };
}

// ../../packages/jit/src/compiler/update/emit-update.ts
function emitUpdate(program) {
  const writer = new CodeWriter();
  emitHelpers3(writer, program);
  writer.line(`function update(${program.valueParam}, ${program.patchParam}) {`);
  writer.indent(() => {
    emitUpdateBodyLines(writer, createEmitState(), program.body, program.valueParam, program.patchParam);
  });
  writer.line("}");
  return writer.toString();
}
function emitUpdateBody(program) {
  const writer = new CodeWriter();
  emitHelpers3(writer, program);
  emitUpdateBodyLines(writer, createEmitState(), program.body, program.valueParam, program.patchParam);
  return writer.toString();
}
function emitHelpers3(writer, program) {
  for (const helper of program.helpers) {
    writer.line(`function ${helperName3(helper.id)}(${program.valueParam}, ${program.patchParam}) {`);
    writer.indent(() => {
      emitUpdateBodyLines(writer, createEmitState(), helper.node, program.valueParam, program.patchParam);
    });
    writer.line("}");
  }
}
function helperName3(id) {
  return `update_${id}`;
}
function emitUpdateBodyLines(writer, state, node, value, patch3) {
  emitUpdateTo(writer, state, node, value, patch3, "out");
  writer.line("return out;");
}
function emitUpdateTo(writer, state, node, value, patch3, target) {
  switch (node.kind) {
    case "recursive":
      writer.line(`const ${target} = ${helperName3(node.id)}(${value}, ${patch3});`);
      return;
    case "reuse":
      writer.line(`let ${target} = ${value};`);
      writer.line(`if (${patch3} !== undefined && !Object.is(${value}, ${patch3})) {`);
      writer.indent(() => writer.line(`${target} = ${patch3};`));
      writer.line("}");
      return;
    case "date":
      writer.line(`let ${target} = ${value};`);
      writer.line(
        `if (${patch3} !== undefined && !Object.is(${value}, ${patch3}) && ${value}.getTime() !== ${patch3}.getTime()) {`
      );
      writer.indent(() => writer.line(`${target} = new Date(${patch3}.getTime());`));
      writer.line("}");
      return;
    case "union":
      emitUnionUpdateTo(writer, state, node, value, patch3, target);
      return;
    case "discriminatedUnion":
      emitDiscriminatedUnionUpdateTo(writer, state, node, value, patch3, target);
      return;
    case "guard":
      emitGuardUpdateTo(writer, state, node, value, patch3, target);
      return;
    case "object":
      emitObjectUpdateTo(writer, state, node, value, patch3, target);
      return;
    case "array":
      emitArrayUpdateTo(writer, state, node, value, patch3, target);
      return;
    case "tuple":
      emitTupleUpdateTo(writer, state, node, value, patch3, target);
      return;
    case "record":
      emitRecordUpdateTo(writer, state, node, value, patch3, target);
      return;
    case "set":
      emitSetUpdateTo(writer, value, patch3, target);
      return;
    case "map":
      emitMapUpdateTo(writer, value, patch3, target);
      return;
  }
}
function emitGuardUpdateTo(writer, state, node, value, patch3, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch3} !== undefined && !Object.is(${value}, ${patch3})) {`);
  writer.indent(() => {
    writer.line(`if (!(${emitGuardTest(node.optional, node.nullable, patch3)})) {`);
    writer.indent(() => writer.line(`${target} = ${patch3};`));
    writer.line(`} else if (!(${emitGuardTest(node.optional, node.nullable, value)})) {`);
    writer.indent(() => writer.line(`${target} = ${patch3};`));
    writer.line("} else {");
    writer.indent(() => {
      const inner = state.nextVar(`${target}_inner`);
      emitUpdateTo(writer, state, node.inner, value, patch3, inner);
      writer.line(`${target} = ${inner};`);
    });
    writer.line("}");
  });
  writer.line("}");
}
function emitObjectUpdateTo(writer, state, node, value, patch3, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch3} !== undefined) {`);
  writer.indent(() => {
    const entries = [];
    const changedVars = [];
    for (const prop of node.props) {
      const rawPropValue = emitPropertyAccess(value, prop.key);
      const defaultedPropValue = emitDefaultedValue(prop.schema, rawPropValue);
      const propValue = defaultedPropValue === rawPropValue ? rawPropValue : state.nextVar(`value_${prop.key}`);
      const propPatch = emitPropertyAccess(patch3, prop.key);
      const propNext = state.nextVar(`next_${prop.key}`);
      if (propValue !== rawPropValue) {
        writer.line(`const ${propValue} = ${defaultedPropValue};`);
      }
      if (prop.readonly) {
        entries.push(`${emitLiteral(prop.key)}: ${propValue}`);
        continue;
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
function emitUnionUpdateTo(writer, state, node, value, patch3, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch3} !== undefined && !Object.is(${value}, ${patch3})) {`);
  writer.indent(() => {
    if (node.options.length === 0) {
      writer.line(`${target} = ${patch3};`);
      return;
    }
    let prefix = "if";
    for (const option of node.options) {
      writer.line(`${prefix} (${emitSchemaGuard(option.schema, value)}) {`);
      writer.indent(() => {
        const next = state.nextVar(`${target}_branch`);
        emitUpdateTo(writer, state, option.node, value, patch3, next);
        writer.line(`${target} = ${next};`);
      });
      prefix = "} else if";
    }
    writer.line("} else {");
    writer.indent(() => writer.line(`${target} = ${patch3};`));
    writer.line("}");
  });
  writer.line("}");
}
function emitDiscriminatedUnionUpdateTo(writer, state, node, value, patch3, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch3} !== undefined && !Object.is(${value}, ${patch3})) {`);
  writer.indent(() => {
    if (node.options.length === 0) {
      writer.line(`${target} = ${patch3};`);
      return;
    }
    let prefix = "if";
    for (const option of node.options) {
      writer.line(`${prefix} (${emitSchemaGuard(option.schema, value)}) {`);
      writer.indent(() => {
        const tag = literalDiscriminatorValue(option.schema, node.discriminator);
        const next = state.nextVar(`${target}_branch`);
        if (tag !== void 0) {
          const patchTag = emitPropertyAccess(patch3, node.discriminator);
          writer.line(`if (${patchTag} !== undefined && ${patchTag} !== ${emitLiteral(tag)}) {`);
          writer.indent(() => writer.line(`${target} = ${patch3};`));
          writer.line("} else {");
          writer.indent(() => {
            emitUpdateTo(writer, state, option.node, value, patch3, next);
            writer.line(`${target} = ${next};`);
          });
          writer.line("}");
          return;
        }
        emitUpdateTo(writer, state, option.node, value, patch3, next);
        writer.line(`${target} = ${next};`);
      });
      prefix = "} else if";
    }
    writer.line("} else {");
    writer.indent(() => writer.line(`${target} = ${patch3};`));
    writer.line("}");
  });
  writer.line("}");
}
function emitTupleUpdateTo(writer, state, node, value, patch3, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch3} !== undefined) {`);
  writer.indent(() => {
    const entries = [];
    const changedVars = [];
    for (let index2 = 0; index2 < node.items.length; index2++) {
      const itemNext = state.nextVar(`next_${index2}`);
      emitUpdateTo(writer, state, node.items[index2], `${value}[${index2}]`, `${patch3}[${index2}]`, itemNext);
      changedVars.push(`${itemNext} !== ${value}[${index2}]`);
      entries.push(itemNext);
    }
    writer.line(`if (${changedVars.join(" || ")}) {`);
    writer.indent(() => writer.line(`${target} = [${entries.join(", ")}];`));
    writer.line("}");
  });
  writer.line("}");
}
function emitArrayUpdateTo(writer, state, node, value, patch3, target) {
  const len = state.nextVar("len");
  const patchLen = state.nextVar("patchLen");
  const index2 = state.nextVar("i");
  const item = state.nextVar("item");
  const patchItem = state.nextVar("patchItem");
  const next = state.nextVar("next");
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch3} !== undefined) {`);
  writer.indent(() => {
    writer.line(`const ${len} = ${value}.length;`);
    writer.line(`const ${patchLen} = ${patch3}.length;`);
    writer.line(`for (let ${index2} = 0; ${index2} < ${patchLen}; ${index2}++) {`);
    writer.indent(() => {
      writer.line(`const ${patchItem} = ${patch3}[${index2}];`);
      writer.line(`if (${patchItem} !== undefined) {`);
      writer.indent(() => {
        writer.line(`if (${index2} >= ${len}) {`);
        writer.indent(() => {
          writer.line(`if (${target} === ${value}) {`);
          writer.indent(() => writer.line(`${target} = ${value}.slice();`));
          writer.line("}");
          writer.line(`${target}[${index2}] = ${patchItem};`);
        });
        writer.line("} else {");
        writer.indent(() => {
          writer.line(`const ${item} = ${value}[${index2}];`);
          emitUpdateTo(writer, state, node.element, item, patchItem, next);
          writer.line(`if (${next} !== ${item}) {`);
          writer.indent(() => {
            writer.line(`if (${target} === ${value}) {`);
            writer.indent(() => writer.line(`${target} = ${value}.slice();`));
            writer.line("}");
            writer.line(`${target}[${index2}] = ${next};`);
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
function emitRecordUpdateTo(writer, state, node, value, patch3, target) {
  const keys = state.nextVar("keys");
  const patchKeys = state.nextVar("patchKeys");
  const len = state.nextVar("len");
  const index2 = state.nextVar("i");
  const key = state.nextVar("key");
  const next = state.nextVar("next");
  const recordOut = state.nextVar("recordOut");
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch3} !== undefined && !Object.is(${value}, ${patch3})) {`);
  writer.indent(() => {
    writer.line(`let changed = false;`);
    writer.line(`const ${keys} = Object.keys(${value});`);
    writer.line(`const ${patchKeys} = Object.keys(${patch3});`);
    writer.line(`if (${keys}.length !== ${patchKeys}.length) {`);
    writer.indent(() => writer.line("changed = true;"));
    writer.line("}");
    writer.line(`for (let ${index2} = 0, ${len} = ${patchKeys}.length; ${index2} < ${len}; ${index2}++) {`);
    writer.indent(() => {
      writer.line(`const ${key} = ${patchKeys}[${index2}];`);
      emitUpdateTo(writer, state, node.value, `${value}[${key}]`, `${patch3}[${key}]`, next);
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
      writer.line(`for (let ${index2} = 0, ${len} = ${patchKeys}.length; ${index2} < ${len}; ${index2}++) {`);
      writer.indent(() => {
        writer.line(`const ${key} = ${patchKeys}[${index2}];`);
        emitUpdateTo(writer, state, node.value, `${value}[${key}]`, `${patch3}[${key}]`, next);
        writer.line(`${recordOut}[${key}] = ${next};`);
      });
      writer.line("}");
      writer.line(`${target} = ${recordOut};`);
    });
    writer.line("}");
  });
  writer.line("}");
}
function emitSetUpdateTo(writer, value, patch3, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch3} !== undefined && !Object.is(${value}, ${patch3})) {`);
  writer.indent(() => {
    writer.line(`if (${value}.size !== ${patch3}.size) {`);
    writer.indent(() => writer.line(`${target} = ${patch3};`));
    writer.line("} else {");
    writer.indent(() => {
      writer.line(`const iter = ${patch3}.values();`);
      writer.line("let step = iter.next();");
      writer.line("while (!step.done) {");
      writer.indent(() => {
        writer.line("const item = step.value;");
        writer.line(`if (!${value}.has(item)) {`);
        writer.indent(() => {
          writer.line(`${target} = ${patch3};`);
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
function emitMapUpdateTo(writer, value, patch3, target) {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch3} !== undefined && !Object.is(${value}, ${patch3})) {`);
  writer.indent(() => {
    writer.line(`if (${value}.size !== ${patch3}.size) {`);
    writer.indent(() => writer.line(`${target} = ${patch3};`));
    writer.line("} else {");
    writer.indent(() => {
      writer.line(`const iter = ${patch3}.entries();`);
      writer.line("let step = iter.next();");
      writer.line("while (!step.done) {");
      writer.indent(() => {
        writer.line("const entry = step.value;");
        writer.line("const key = entry[0];");
        writer.line("const nextValue = entry[1];");
        writer.line(`if (!${value}.has(key) || !Object.is(${value}.get(key), nextValue)) {`);
        writer.indent(() => {
          writer.line(`${target} = ${patch3};`);
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
function emitUpdateSource(schema) {
  assertUpdateable(schema);
  return emitUpdate(buildUpdateIR(schema));
}
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
  if (hasInnerType(schema)) {
    assertUpdateable(schema.def.innerType);
    return;
  }
  if (schema.type === TypeName.object) {
    const objectSchema = schema;
    for (const child of Object.values(objectSchema.def.props)) {
      if (resolveWrappers(child).readonly) continue;
      assertUpdateable(child);
    }
  }
}
function hasInnerType(schema) {
  return schema.type === TypeName.optional || schema.type === TypeName.nullable || schema.type === TypeName.nullish || schema.type === TypeName.default || schema.type === TypeName.brand || schema.type === TypeName.transform || schema.type === TypeName.pipe || schema.type === TypeName.refine || schema.type === TypeName.coerce || schema.type === TypeName.promise;
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
  const arraySchema2 = schema;
  const element = resolveBinaryElement(arraySchema2.def.element, "binary rowset");
  const objectSchema = element.schema;
  const layout = createBinaryRowLayout(objectSchema, options.memoryLayout, hints.adaptiveStringFields, element.union);
  const strategy = options.strategy ?? "dynamic";
  const state = createBinaryArrayState(layout, strategy, options);
  const writer = compileRowWriter(layout);
  const hydrate = compileRowHydrator(layout);
  const api = {
    __jitBinaryArray: true,
    schema: arraySchema2,
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
      for (let mask3 = 0; mask3 < layout.maskBytes; mask3++) writer.line(`let m${mask3} = 0;`);
      emitGuardMasks(writer, layout);
      for (let mask3 = 0; mask3 < layout.maskBytes; mask3++) {
        writer.line(`u8[${emitMaskIndex(layout, mask3)}] = m${mask3};`);
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
  const lookup2 = createFieldLookup(layout);
  validateBinaryQueryPlan(lookup2, plan);
  const accessedFields = collectQueryAccessFields(layout, lookup2, plan);
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
    const condition = emitBinaryFilter(plan, lookup2, prepared, comparableOverrides);
    if (plan.aggregate) {
      emitBinaryAggregateQuery(writer, layout, lookup2, plan, condition, accessedFields, cacheAggregateValue);
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
  const bindingNames = program.bindings.map((_, index2) => `__q${index2}`);
  const cacheKey3 = `binary-query:${serializeBinaryLayout(layout)}:${serializeQueryNodes2(program.nodes)}`;
  const template = getCompileCached(
    schema,
    cacheKey3,
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
    for (let index2 = 0; index2 < sampleSize; index2++) {
      const value = input[index2][field.key];
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
      schema: flattenObjectIntersection2(resolved, feature),
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
function flattenObjectIntersection2(schema, feature) {
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
  if (resolved.type === TypeName.intersection) return flattenObjectIntersection2(resolved, feature);
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
function createBinaryRowLayout(schema, requestedLayout = "auto", adaptiveStringFields, union3 = void 0) {
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
    union: union3
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
    const mask3 = `m${field.guard.maskOffset}`;
    writer.line(
      `if (${prop} === null) ${mask3} |= ${1 << field.guard.shift}; else if (${prop} !== undefined) ${mask3} |= ${2 << field.guard.shift};`
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
  const union3 = layout.union;
  if (!union3) {
    writer.line(`${target} = ${emitObjectExpression(layout.fields)};`);
    return;
  }
  const discriminator = layout.fields.find((field) => field.key === union3.discriminator);
  if (!discriminator) {
    throw new JITError("INVALID_OPERATION", `binary union discriminator ${union3.discriminator} is missing`);
  }
  writer.line(`switch (${emitFieldComparable(discriminator)}) {`);
  writer.indent(() => {
    for (const variant of union3.variants) {
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
function validateBinaryQueryPlan(lookup2, plan) {
  for (const filter of plan.filters) validateCondition4(lookup2, filter.condition);
  if (plan.select) validateKeys(lookup2, plan.select.fields, "binary query select");
  if (plan.aggregate?.key) validateKeys(lookup2, [plan.aggregate.key], `binary query ${plan.aggregate.op}`);
}
function validateCondition4(lookup2, condition) {
  switch (condition.kind) {
    case "compare":
      validateValue3(lookup2, condition.left);
      validateValue3(lookup2, condition.right);
      return;
    case "logical":
      validateCondition4(lookup2, condition.left);
      validateCondition4(lookup2, condition.right);
      return;
    case "not":
      validateCondition4(lookup2, condition.inner);
      return;
  }
}
function validateValue3(lookup2, value) {
  if (value.kind === "field") validateKeys(lookup2, [value.key], "binary query filter");
}
function validateKeys(lookup2, keys, label) {
  for (const key of keys) {
    if (!lookup2.fields.has(key)) throw new JITError("INVALID_QUERY", `${label} received unknown key ${key}`);
  }
}
function collectQueryAccessFields(layout, lookup2, plan) {
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
  return layout.fields.filter((field) => keys.has(field.key) && lookup2.fields.has(field.key));
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
function emitBinaryFilter(plan, lookup2, prepared, comparableOverrides) {
  if (plan.filters.length === 0) return void 0;
  return plan.filters.map((filter) => emitCondition5(filter.condition, lookup2, prepared, comparableOverrides)).join(" && ");
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
function emitBinaryAggregateQuery(writer, layout, lookup2, plan, condition, accessedFields, cacheAggregateValue) {
  const aggregate = plan.aggregate;
  if (!aggregate) return;
  const field = aggregate.key ? lookup2.fields.get(aggregate.key) : void 0;
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
function emitCondition5(condition, lookup2, prepared, comparableOverrides) {
  switch (condition.kind) {
    case "compare":
      return emitCompare(condition.left, condition.op, condition.right, lookup2, prepared, comparableOverrides);
    case "logical":
      return `(${emitCondition5(condition.left, lookup2, prepared, comparableOverrides)} ${condition.op === "and" ? "&&" : "||"} ${emitCondition5(
        condition.right,
        lookup2,
        prepared,
        comparableOverrides
      )})`;
    case "not":
      return `!(${emitCondition5(condition.inner, lookup2, prepared, comparableOverrides)})`;
  }
}
function emitCompare(left, op, right, lookup2, prepared, comparableOverrides) {
  if (left.kind === "field") {
    const field = expectField(lookup2, left.key);
    return emitFieldCompare(field, op, right, prepared, comparableOverrides?.get(left.key));
  }
  if (right.kind === "field") {
    const field = expectField(lookup2, right.key);
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
function expectField(lookup2, key) {
  const field = lookup2.fields.get(key);
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
function serializeQueryNodes2(nodes) {
  return nodes.map(serializeQueryNode2).join(";");
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
function serializeQueryNode2(node) {
  switch (node.kind) {
    case "filter":
      return `f(${serializeCondition2(node.condition)})`;
    case "select:fields":
      return `s(${node.fields.join(",")})`;
    case "aggregate":
      return `a(${node.op},${node.key ?? ""})`;
    case "terminal":
      return `t(${node.op})`;
    case "aggregate:composite":
      return `A(${node.fields.map((field) => `${field.name}:${field.op}:${field.key ?? ""}`).join(",")})`;
    case "unique":
      return `u(${node.key})`;
    case "distinct":
      return `D(${node.fields.join(",")})`;
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
  meta(metadata) {
    return createBuilder(attachMetadata(this.schema, metadata));
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
  let match2;
  while ((match2 = regex2.exec(path)) !== null) {
    if (match2[1] !== void 0) {
      segments.push(match2[1]);
    } else if (match2[2] !== void 0) {
      segments.push(Number(match2[2]));
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
  const builder2 = Object.create(prototype);
  builder2.schema = schema;
  return builder2;
}

// ../../packages/jit/src/aot/emit-type.ts
function emitTypeScriptType(schema, names) {
  const expanding = /* @__PURE__ */ new Set();
  const emit = (child) => {
    const named = names?.get(child);
    if (named !== void 0) return named;
    if (expanding.has(child)) return "unknown";
    expanding.add(child);
    const emitted2 = emitStructural(child, emit);
    expanding.delete(child);
    return emitted2;
  };
  expanding.add(schema);
  const emitted = emitStructural(schema, emit);
  expanding.delete(schema);
  return emitted;
}
function emitStructural(schema, emit) {
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
        const safeKey = parse_exports.isValidIdentifier(key) ? key : JSON.stringify(key);
        return `${safeKey}: ${emit(prop)}`;
      });
      return entries.length === 0 ? "{}" : `{ ${entries.join("; ")} }`;
    }
    case TypeName.array:
      return `${wrapForSuffix(emit(current.def.element))}[]`;
    case TypeName.set:
      return `Set<${emit(current.def.element)}>`;
    case TypeName.map:
      return `Map<${emit(current.def.key)}, ${emit(current.def.value)}>`;
    case TypeName.record:
      return `Record<string, ${emit(current.def.value)}>`;
    case TypeName.tuple: {
      const items = current.def.items ?? [];
      return `[${items.map(emit).join(", ")}]`;
    }
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion: {
      const options = current.def.options;
      return options.map(emit).join(" | ");
    }
    case TypeName.not:
      return "unknown";
    case TypeName.when:
      return `${emit(current.def.thenType)} | ${emit(current.def.otherwiseType)}`;
    case TypeName.intersection: {
      const options = current.def.options;
      return options.map(emit).join(" & ");
    }
    case TypeName.optional:
      return `${emit(current.def.innerType)} | undefined`;
    case TypeName.nullable:
      return `${emit(current.def.innerType)} | null`;
    case TypeName.nullish:
      return `${emit(current.def.innerType)} | null | undefined`;
    case TypeName.default:
    case TypeName.brand:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return emit(current.def.innerType);
    case TypeName.readonly:
      return emitReadonlyType(current.def.innerType, emit);
    case TypeName.lazy:
      return emit(current.def.getter());
    case TypeName.promise:
      return `Promise<${emit(current.def.innerType)}>`;
    default:
      return "unknown";
  }
}
function emitReadonlyType(schema, emit) {
  const current = schema;
  switch (current.type) {
    case TypeName.array:
      return `readonly ${wrapForSuffix(emit(current.def.element))}[]`;
    case TypeName.tuple: {
      const items = current.def.items ?? [];
      return `readonly [${items.map(emit).join(", ")}]`;
    }
    case TypeName.set:
      return `ReadonlySet<${emit(current.def.element)}>`;
    case TypeName.map:
      return `ReadonlyMap<${emit(current.def.key)}, ${emit(current.def.value)}>`;
    default:
      return `Readonly<${emit(schema)}>`;
  }
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

// ../../packages/jit/src/aot/artifact-types.ts
function declarationImportType(outDir, sourceFile, name, artifact) {
  const reference = readBackType(outDir, sourceFile, artifact);
  return reference?.(name);
}
function memberImportType(outDir, sourceFile, group, prop, artifact) {
  const reference = readBackType(outDir, sourceFile, artifact);
  return reference?.(`${group}[${JSON.stringify(prop)}]`);
}
function readBackType(outDir, sourceFile, artifact) {
  if (artifact.kind !== "query-plan" && artifact.kind !== "join-plan" && artifact.kind !== "query" && artifact.kind !== "mapper" && artifact.kind !== "watch") {
    return void 0;
  }
  const specifier = JSON.stringify(typeImportSpecifier(outDir, sourceFile));
  return (path) => artifact.kind === "query-plan" || artifact.kind === "join-plan" ? `__JitCall<typeof import(${specifier}).${path}>` : `typeof import(${specifier}).${path}`;
}
function joinPlanType(artifact, typeNames) {
  const left = namedType(artifact.plan.leftSchema, typeNames);
  const right = namedType(artifact.plan.rightSchema, typeNames);
  const leftRow = queryArtifactRowType(artifact.plan.leftSchema, typeNames);
  const rightRow = queryArtifactRowType(artifact.plan.rightSchema, typeNames);
  const result = artifact.plan.kind === "semi" || artifact.plan.kind === "anti" ? `${leftRow}[]` : artifact.plan.kind === "left" ? `{ readonly left: ${leftRow}; readonly right: ${rightRow} | undefined }[]` : `{ readonly left: ${leftRow}; readonly right: ${rightRow} }[]`;
  return `(left: ${left}, right: ${right}) => ${result}`;
}
function queryArtifactRowType(schema, typeNames) {
  const base = resolveWrappers(schema).base;
  const row = base.type === TypeName.array ? base.def.element : base;
  return namedType(row, typeNames);
}
function queryPlanType(artifact, typeNames) {
  const input = namedType(artifact.schema, typeNames);
  switch (artifact.mode) {
    case "iterator":
      return `(value: ${input}) => IterableIterator<unknown>`;
    case "async-iterator":
      return `(value: ${input}) => AsyncIterableIterator<unknown>`;
    case "visitor":
      return `(value: ${input}, consume: (item: unknown) => void) => number`;
    default:
      return `(value: ${input}) => ${eagerQueryResultType(artifact, typeNames)}`;
  }
}
function eagerQueryResultType(artifact, typeNames) {
  let terminal;
  let aggregate;
  let composite;
  let select;
  for (const node of artifact.program.nodes) {
    if (node.kind === "terminal") terminal = node;
    else if (node.kind === "aggregate") aggregate = node;
    else if (node.kind === "aggregate:composite") composite = node;
    else if (node.kind === "select:fields") select = node.fields;
  }
  if (composite) {
    const fields = composite.fields.map(
      (field) => `readonly ${JSON.stringify(field.name)}: ${field.op === "sum" || field.op === "count" ? "number" : "number | undefined"}`
    );
    const aggregates = `{ ${fields.join("; ")} }`;
    const grouped = artifact.program.nodes.some((node) => node.kind === "groupBy");
    return grouped ? `Record<PropertyKey, ${aggregates}>` : aggregates;
  }
  if (terminal) {
    if (terminal.op === "some" || terminal.op === "every") return "boolean";
    if (terminal.op === "findIndex") return "number";
    const row = queryRowType(artifact, typeNames);
    const projected = select ? `Pick<${row}, ${select.map((field) => JSON.stringify(field)).join(" | ")}>` : row;
    return `${projected} | undefined`;
  }
  if (aggregate) return aggregate.op === "sum" || aggregate.op === "count" ? "number" : "number | undefined";
  return "unknown[]";
}
function queryRowType(artifact, typeNames) {
  const schema = resolveWrappers(artifact.schema).base;
  const row = schema.type === TypeName.array ? schema.def.element : schema.type === TypeName.runtimeType ? schema.def.innerType : schema;
  return namedType(row, typeNames);
}
function sortPlanType(artifact, typeNames) {
  const schema = resolveWrappers(artifact.schema).base;
  const row = schema.type === TypeName.array ? schema.def.element : schema.type === TypeName.runtimeType ? schema.def.innerType : schema;
  const value = namedType(row, typeNames);
  return `((value: readonly ${value}[]) => ${value}[]) & { readonly compare: (left: ${value}, right: ${value}) => number; readonly inPlace: (value: ${value}[]) => ${value}[] }`;
}
function indexPlanType(artifact, typeNames) {
  const schema = resolveWrappers(artifact.schema).base;
  const row = schema.type === TypeName.array ? schema.def.element : schema.type === TypeName.runtimeType ? schema.def.innerType : schema;
  const value = namedType(row, typeNames);
  const leaf = artifact.descriptor.shape === "grouped" ? `${value}[]` : value;
  let index2 = `Map<unknown, ${leaf}>`;
  for (let level = artifact.descriptor.keys.length - 1; level > 0; level--) {
    index2 = `Map<unknown, ${index2}>`;
  }
  return `((value: readonly ${value}[]) => ${index2}) & { readonly cached: (value: readonly ${value}[]) => ${index2} }`;
}
function lookupPlanType(artifact, typeNames) {
  const schema = resolveWrappers(artifact.schema).base;
  const row = schema.type === TypeName.array ? schema.def.element : schema.type === TypeName.runtimeType ? schema.def.innerType : schema;
  const value = namedType(row, typeNames);
  const key = `${value}[${JSON.stringify(artifact.lookup.key)}]`;
  return `(value: readonly ${value}[], key: ${key}) => ${value} | undefined`;
}
function migrationPlanType(artifact, typeNames) {
  const inputs = artifact.descriptor.schemas.map((schema) => namedType(schema, typeNames));
  const output = inputs[inputs.length - 1] ?? "unknown";
  return `(value: ${inputs.join(" | ") || "unknown"}) => ${output}`;
}
function csvPlanType(artifact, typeNames) {
  const row = namedType(artifact.descriptor.schema, typeNames);
  if (artifact.descriptor.operation === "stringify") {
    return artifact.descriptor.sink === "iterator" ? `(value: readonly ${row}[]) => IterableIterator<string>` : `(value: readonly ${row}[]) => string`;
  }
  if (artifact.descriptor.sink === "iterator")
    return `(input: string | Uint8Array | Iterable<string | Uint8Array>) => IterableIterator<${row}>`;
  if (artifact.descriptor.sink === "visitor")
    return `(input: string | Uint8Array | Iterable<string | Uint8Array>, consume: (row: ${row}, index: number) => void) => number`;
  return `(input: string | Uint8Array | Iterable<string | Uint8Array>) => ${row}[]`;
}
function ndjsonPlanType(artifact, typeNames) {
  const row = namedType(artifact.descriptor.outputSchema, typeNames);
  if (artifact.descriptor.operation === "stringify") {
    return artifact.descriptor.sink === "iterator" ? `(value: readonly ${row}[]) => IterableIterator<string>` : `(value: readonly ${row}[]) => string`;
  }
  const input = "string | Uint8Array | Iterable<string | Uint8Array>";
  if (artifact.descriptor.sink === "iterator") return `(input: ${input}) => IterableIterator<${row}>`;
  if (artifact.descriptor.sink === "visitor")
    return `(input: ${input}, consume: (row: ${row}, index: number) => void) => number`;
  if (artifact.descriptor.sink === "ndjson") return `(input: ${input}) => string`;
  return `(input: ${input}) => ${row}[]`;
}
function projectPlanType(artifact, typeNames) {
  return `(value: ${namedType(artifact.schema, typeNames)}) => ${emitTypeScriptType(artifact.tree.schema, typeNames)}`;
}
function changedPlanType(artifact, typeNames) {
  const value = namedType(artifact.schema, typeNames);
  const mask3 = artifact.descriptor.representation === "bigint" ? "bigint" : "number";
  const paths = artifact.descriptor.fields.map((field) => JSON.stringify(field.path)).join(" | ");
  return `((left: ${value}, right: ${value}) => ${mask3}) & { has(mask: ${mask3}, path: ${paths}): boolean; readonly fields: readonly (${paths})[] }`;
}
function patchPlanType(artifact, typeNames) {
  const value = namedType(artifact.schema, typeNames);
  return artifact.mode === "merge" ? `(value: ${value}, patch: unknown) => ${value}` : `(value: ${value}, operations: readonly { readonly op: string; readonly path: string; readonly value?: unknown; readonly from?: string }[]) => ${value}`;
}
function accessPlanType(artifact, typeNames) {
  const subject = namedType(artifact.schema, typeNames);
  const actor = artifact.descriptor.actor === void 0 ? "unknown" : namedType(artifact.descriptor.actor, typeNames);
  const actions = artifact.descriptor.actions.map((action) => JSON.stringify(action)).join(" | ") || "never";
  const check = `(action: ${actions}, subject?: ${subject}, field?: keyof ${subject} & string) => boolean`;
  const fields = `(action: ${actions}, subject?: ${subject}) => readonly (keyof ${subject} & string)[]`;
  const explain = `(action: ${actions}, subject?: ${subject}, field?: keyof ${subject} & string) => { readonly allowed: boolean; readonly reason?: string; readonly ruleId?: string; readonly matchedProhibition?: boolean }`;
  return `(actor: ${actor}) => { can: ${check}; cannot: ${check}; assert(action: ${actions}, subject: ${subject}, field?: keyof ${subject} & string): ${subject}; explain: ${explain}; fields: ${fields} }`;
}
function rulesPlanType(artifact, typeNames) {
  const descriptor = artifact.descriptor;
  const subject = namedType(artifact.schema, typeNames);
  const ids = descriptor.ids.map((id) => JSON.stringify(id)).join(" | ") || "never";
  const outcomes = descriptor.rules.map((rule) => rule.outcome).filter((outcome2) => outcome2 !== void 0).map((outcome2) => namedType(outcome2.type, typeNames));
  const outcome = outcomes.length === 0 ? "never" : [...new Set(outcomes)].join(" | ");
  const inputs = descriptor.inputs;
  const input = inputs === void 0 ? "" : `, inputs: ${namedType(inputs, typeNames)}`;
  const list = `subjects: readonly ${subject}[]`;
  const consume = `consume: (rule: ${ids}, outcome: (${outcome}) | undefined) => void`;
  const manyConsume = `consume: (rule: ${ids}, outcome: (${outcome}) | undefined, index: number) => void`;
  const signatures = {
    test: `(rule: ${ids}, subject: ${subject}${input}) => boolean`,
    some: `(subject: ${subject}${input}) => boolean`,
    first: `(subject: ${subject}${input}) => ${ids} | undefined`,
    match: `(subject: ${subject}${input}) => (${ids})[]`,
    run: `(subject: ${subject}${input}) => (${outcome})[]`,
    explain: `(subject: ${subject}${input}) => { readonly matched: readonly (${ids})[]; readonly evaluated: readonly (${ids})[] }`,
    predicate: `(subject: ${subject}${input}) => boolean`,
    visitor: `(subject: ${subject}${input}, ${consume}) => number`,
    iterator: `(subject: ${subject}${input}) => IterableIterator<${outcome}>`,
    many: `(${list}${input}) => (${outcome})[]`,
    "many-visitor": `(${list}${input}, ${manyConsume}) => number`,
    "many-iterator": `(${list}${input}) => IterableIterator<${outcome}>`
  };
  if (artifact.sink !== "plan") return signatures[artifact.sink];
  const manyPlan = `${signatures.many} & { readonly to: { visitor(): ${signatures["many-visitor"]}; iterator(): ${signatures["many-iterator"]} } }`;
  return [
    "{",
    `readonly test: ${signatures.test};`,
    `readonly some: ${signatures.some};`,
    `readonly first: ${signatures.first};`,
    `readonly match: ${signatures.match};`,
    `readonly run: ${signatures.run};`,
    `readonly explain: ${signatures.explain};`,
    `readonly predicate: (rule: ${ids}) => ${signatures.predicate};`,
    `readonly many: () => ${manyPlan};`,
    `readonly to: { visitor(): ${signatures.visitor}; iterator(): ${signatures.iterator} };`,
    `readonly ids: readonly (${ids})[];`,
    "}"
  ].join(" ");
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
function namedType(schema, typeNames, fallback = "unknown") {
  if (!schema) return fallback;
  return typeNames?.get(schema) ?? emitTypeScriptType(schema, typeNames);
}
function standaloneType(artifact, typeNames) {
  return validatorType(artifact.op, namedType(artifact.schema, typeNames));
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
function operationType(artifact, typeNames) {
  return operationSignature(artifact.op, namedType(artifact.schema, typeNames));
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
    case "jsonSchema":
      return "{ readonly [key: string]: unknown }";
    case "mock":
      return `(options?: { readonly seed?: number }) => ${valueType}`;
    case "update":
      return `(value: ${valueType}, patch: unknown) => ${valueType}`;
  }
}
function executionPlanType(plan, typeNames) {
  const valueType = namedType(plan.schema, typeNames);
  const last2 = plan.stages[plan.stages.length - 1];
  const operation = plan.stages.find((stage2) => stage2.kind === "operation");
  const map4 = plan.stages.find((stage2) => stage2.kind === "map");
  const query2 = plan.stages.find((stage2) => stage2.kind === "query");
  const aggregate = plan.stages.find((stage2) => stage2.kind === "aggregate");
  const hasJsonDecode = plan.stages.some((stage2) => stage2.kind === "json.decode");
  const hasBinaryDecode = plan.stages.some((stage2) => stage2.kind === "binary.decode");
  const valueSource = plan.stages.find((stage2) => stage2.kind === "value");
  if (operation?.kind === "operation") return operationSignature(operation.operation, valueType);
  if (last2?.kind === "validate") {
    if (last2.operation === "parse" && hasJsonDecode) return `(json: string) => ${valueType}`;
    if (last2.operation === "parse" && hasBinaryDecode) return `(bytes: Uint8Array | ArrayBuffer) => ${valueType}`;
    return validatorType(last2.operation === "issues" ? "safeParse" : last2.operation, valueType);
  }
  const inputType = hasJsonDecode ? "string" : hasBinaryDecode ? "Uint8Array | ArrayBuffer" : valueSource?.kind === "value" && valueSource.schema ? namedType(valueSource.schema, typeNames) : map4?.kind === "map" ? map4.many ? `readonly ${namedType(map4.source, typeNames)}[]` : namedType(map4.source, typeNames) : query2?.kind === "query" ? namedType(query2.source, typeNames) : valueType;
  if (last2?.kind === "json.encode") {
    return last2.mode === "chunks" ? `(value: ${inputType}) => IterableIterator<string>` : `(value: ${inputType}) => string`;
  }
  if (last2?.kind === "binary.encode") return `(value: ${inputType}) => Uint8Array`;
  if (aggregate?.kind === "aggregate") {
    const output = aggregate.operation === "count" || aggregate.operation === "sum" ? "number" : "number | undefined";
    return `(value: ${inputType}) => ${output}`;
  }
  if (hasJsonDecode) return `(json: string) => ${valueType}`;
  if (hasBinaryDecode) return `(bytes: Uint8Array | ArrayBuffer) => ${valueType}`;
  if (map4?.kind === "map") return `(value: ${inputType}) => ${valueType}`;
  if (query2?.kind === "query") return `(value: ${inputType}) => ${valueType}`;
  if (plan.stages.some((stage2) => stage2.kind === "transform" || stage2.kind === "update" || stage2.kind === "security")) {
    return `(value: ${inputType}) => ${valueType}`;
  }
  return "unknown";
}

// ../../packages/jit/src/aot/serialize-callback.ts
var CALLBACK_KEYWORDS = /* @__PURE__ */ new Set([
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
  "yield"
]);
var CALLBACK_GLOBALS = /* @__PURE__ */ new Set([
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
  "WeakSet"
]);
function serializeCallback(value) {
  let source = Function.prototype.toString.call(value).trim();
  if (source.includes("[native code]") || source.startsWith("function bound ")) return void 0;
  if (!isFunctionExpressionSource(source) && !isArrowFunctionSource(source)) {
    source = normalizeMethodSource(source);
  }
  if (source === "") return void 0;
  try {
    Function(`return (${source});`);
  } catch {
    return void 0;
  }
  if (hasUnsupportedClosureReferences(source)) return void 0;
  return `(${source})`;
}
function hasUnsupportedClosureReferences(source) {
  if (/\b(?:this|super)\b/.test(source)) return true;
  const code = maskCallbackLiterals(source);
  const locals = /* @__PURE__ */ new Set(["arguments"]);
  for (const match2 of code.matchAll(/\bfunction(?:\s*\*)?\s*([A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^()]*)\)/g)) {
    if ((match2[2] ?? "").includes("=")) return true;
    if (match2[1]) locals.add(match2[1]);
    collectBindingIdentifiers(match2[2] ?? "", locals);
  }
  for (const match2 of code.matchAll(/(?:\(([^()]*)\)|([A-Za-z_$][A-Za-z0-9_$]*))\s*=>/g)) {
    if ((match2[1] ?? "").includes("=")) return true;
    collectBindingIdentifiers(match2[1] ?? match2[2] ?? "", locals);
  }
  for (const match2 of code.matchAll(/\b(?:const|let|var|class|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    locals.add(match2[1]);
  }
  for (const match2 of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    locals.add(match2[1]);
  }
  for (const match2 of code.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const identifier2 = match2[0];
    const start = match2.index;
    const previous = previousNonWhitespace(code, start - 1);
    const next = nextNonWhitespace(code, start + identifier2.length);
    if (previous === "." || next === ":") continue;
    if (CALLBACK_KEYWORDS.has(identifier2) || CALLBACK_GLOBALS.has(identifier2) || locals.has(identifier2)) continue;
    return true;
  }
  return false;
}
function collectBindingIdentifiers(source, target) {
  for (const match2 of source.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) target.add(match2[0]);
}
function previousNonWhitespace(source, index2) {
  while (index2 >= 0 && /\s/.test(source[index2] ?? "")) index2--;
  return source[index2];
}
function nextNonWhitespace(source, index2) {
  while (index2 < source.length && /\s/.test(source[index2] ?? "")) index2++;
  return source[index2];
}
function maskCallbackLiterals(source) {
  const output = source.split("");
  const templateOuterDepths = [];
  let state = "code";
  let expressionDepth;
  let escaped = false;
  let regexClass = false;
  for (let index2 = 0; index2 < source.length; index2++) {
    const char = source[index2] ?? "";
    const next = source[index2 + 1] ?? "";
    if (state === "line") {
      if (char === "\n") state = "code";
      else output[index2] = " ";
      continue;
    }
    if (state === "block") {
      output[index2] = " ";
      if (char === "*" && next === "/") {
        output[++index2] = " ";
        state = "code";
      }
      continue;
    }
    if (state === "single" || state === "double") {
      output[index2] = " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (state === "single" && char === "'" || state === "double" && char === '"') state = "code";
      continue;
    }
    if (state === "regex") {
      output[index2] = " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "[") regexClass = true;
      else if (char === "]") regexClass = false;
      else if (char === "/" && !regexClass) {
        while (/[A-Za-z]/.test(source[index2 + 1] ?? "")) output[++index2] = " ";
        state = "code";
      }
      continue;
    }
    if (state === "template") {
      output[index2] = " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "`") {
        expressionDepth = templateOuterDepths.pop();
        state = "code";
      } else if (char === "$" && next === "{") {
        output[++index2] = "{";
        expressionDepth = 1;
        state = "code";
      }
      continue;
    }
    if (expressionDepth !== void 0) {
      if (char === "{") expressionDepth++;
      else if (char === "}" && --expressionDepth === 0) {
        output[index2] = " ";
        expressionDepth = void 0;
        state = "template";
        continue;
      }
    }
    if (char === "/" && next === "/") {
      output[index2] = output[++index2] = " ";
      state = "line";
    } else if (char === "/" && next === "*") {
      output[index2] = output[++index2] = " ";
      state = "block";
    } else if (char === "'") {
      output[index2] = " ";
      state = "single";
    } else if (char === '"') {
      output[index2] = " ";
      state = "double";
    } else if (char === "`") {
      output[index2] = " ";
      templateOuterDepths.push(expressionDepth);
      expressionDepth = void 0;
      state = "template";
    } else if (char === "/" && startsRegexLiteral(output, index2)) {
      output[index2] = " ";
      regexClass = false;
      state = "regex";
    }
  }
  return output.join("");
}
function startsRegexLiteral(masked, index2) {
  let cursor = index2 - 1;
  while (cursor >= 0 && /\s/.test(masked[cursor] ?? "")) cursor--;
  if (cursor < 0) return true;
  const previous = masked[cursor] ?? "";
  if ("([{:;,=!?&|+-*%^~<>".includes(previous)) return true;
  const prefix = masked.slice(0, cursor + 1).join("");
  return /\b(?:case|delete|in|instanceof|new|return|throw|typeof|void|yield)\s*$/.test(prefix);
}
function isFunctionExpressionSource(source) {
  return /^(?:async\s+)?function(?:\s*\*)?\b/.test(source);
}
function isArrowFunctionSource(source) {
  return /^(?:async\s+)?(?:[A-Za-z_$][A-Za-z0-9_$]*|\([^)]*\))\s*=>/.test(source);
}
function normalizeMethodSource(source) {
  const match2 = /^(async\s+)?(\*)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(\([\s\S]*)$/.exec(source);
  if (!match2) return "";
  const asyncPrefix = match2[1] ?? "";
  const generator = match2[2] ? "*" : "";
  return `${asyncPrefix}function${generator} ${match2[3]}${match2[4]}`;
}

// ../../packages/jit/src/aot/generate.ts
var GENERATED_BANNER = "// Generated by jit \u2014 do not edit.";
var CALL_HELPER = "type __JitCall<TFunction> = TFunction extends (...args: infer A) => infer R ? (...args: A) => R : never;";
function resolveObjectSchema(schema) {
  const base = resolveWrappers(schema).base;
  return base.type === TypeName.object ? base : void 0;
}
function generate(options) {
  const layout = resolveOutputLayout(assertOutputFormat(options.format ?? "js"));
  const skipped = [];
  const modules = [];
  for (const plan of planModules(options)) {
    const emitted = emitModule(plan, options, layout);
    skipped.push(...emitted.skipped);
    if (emitted.exports.length > 0 || emitted.types.length > 0) modules.push(emitted);
  }
  if (modules.length === 0) return { files: [], skipped };
  cleanGeneratedFiles(options.outDir);
  mkdirSync(options.outDir, { recursive: true });
  const files2 = modules.map((module) => writeFile(options.outDir, `${module.name}${layout.extension}`, module.source));
  if (options.perFile === true) {
    files2.push(writeFile(options.outDir, `index${layout.extension}`, emitBarrel(modules, layout)));
  }
  return { files: files2, skipped };
}
function planModules(options) {
  const artifacts = options.artifacts ?? {};
  const groups = options.groups ?? {};
  const schemas = options.schemas ?? {};
  const sources = options.sources;
  if (options.perFile !== true || !sources) return [{ name: "index", artifacts, groups, schemas }];
  const names = [...Object.keys(artifacts), ...Object.keys(groups), ...Object.keys(schemas)];
  const byFile = /* @__PURE__ */ new Map();
  for (const name of names) {
    const file2 = sources.get(name);
    if (!file2) continue;
    const bucket = byFile.get(file2);
    if (bucket) bucket.push(name);
    else byFile.set(file2, [name]);
  }
  const used = /* @__PURE__ */ new Set();
  return [...byFile].map(([file2, declared]) => {
    const selected = new Set(declared);
    return {
      name: uniqueModuleName(moduleNameFromSource(file2), used),
      artifacts: pick2(artifacts, selected),
      groups: pick2(groups, selected),
      schemas: pick2(schemas, selected)
    };
  });
}
function pick2(record2, selected) {
  return Object.fromEntries(Object.entries(record2).filter(([name]) => selected.has(name)));
}
function emitBarrel(modules, layout) {
  const lines = [GENERATED_BANNER];
  for (const module of modules) {
    if (layout.format === "ts" && module.types.length > 0) {
      lines.push(`export type { ${module.types.join(", ")} } from "./${module.name}.js";`);
    }
    if (module.exports.length > 0) {
      lines.push(`export { ${module.exports.join(", ")} } from "./${module.name}.js";`);
    }
  }
  return `${lines.join("\n")}
`;
}
var RULES_OUTCOME_SINKS = /* @__PURE__ */ new Set([
  "plan",
  "run",
  "visitor",
  "iterator",
  "many",
  "many-visitor",
  "many-iterator"
]);
function emitModule(plan, options, layout) {
  const ts = layout.format === "ts";
  const skipped = [];
  const js = [];
  const tsTypes = [];
  const exportNames = [];
  const typeNames = /* @__PURE__ */ new Map();
  const classBindings = /* @__PURE__ */ new Map();
  const classArtifacts = /* @__PURE__ */ new Map();
  const publicNames = /* @__PURE__ */ new Set([...Object.keys(plan.artifacts), ...Object.keys(plan.groups)]);
  const internalNames = /* @__PURE__ */ new Set();
  const exported = options.exported ?? /* @__PURE__ */ new Set();
  let needsRuntimeGetIndex = false;
  let needsRuntimeCachedIndex = false;
  let needsValidationError = false;
  let needsHashHelpers = false;
  let needsHashCache = false;
  let needsJsonPatchHelpers = false;
  let needsMockHelpers = false;
  let needsCallHelper = false;
  let needsAggregateType = false;
  for (const [name, value] of Object.entries(plan.artifacts)) {
    const artifact = getArtifact(value);
    if (isValidIdentifier(name) && artifact?.kind === "class") {
      classBindings.set(value, name);
      classArtifacts.set(value, artifact);
    }
  }
  for (const name of Object.keys(plan.schemas)) {
    if (!isValidIdentifier(name)) continue;
    typeNames.set(unwrapSchema(plan.schemas[name]), name);
  }
  const typeExports = [...typeNames].map(([schema, name]) => {
    tsTypes.push(`export type ${name} = ${emitTypeScriptType(schema, typeNames)};`);
    return name;
  });
  js.push(GENERATED_BANNER);
  if (ts) js.push("// @ts-nocheck -- generated internals are typed at the public export boundary.");
  for (const [name, members] of Object.entries(plan.groups)) {
    if (!isValidIdentifier(name)) {
      skipped.push({
        schema: name,
        operation: "group",
        reason: "declaration names must be valid JavaScript identifiers"
      });
      continue;
    }
    const sourceFile = options.sources?.get(name);
    const operations = [];
    for (const prop of Object.keys(members)) {
      const artifact = getArtifact(members[prop]);
      if (!artifact) {
        skipped.push({
          schema: name,
          operation: prop,
          reason: "member is not a compiled JIT artifact"
        });
        continue;
      }
      const memberType = exported.has(name) && sourceFile ? memberImportType(options.outDir, sourceFile, name, prop, artifact) : void 0;
      const emitted = emitArtifact(
        internalIdentifier(`${name}_${prop}`),
        artifact,
        `${name}.${prop}`,
        memberType,
        false
      );
      if (emitted) operations.push({ prop, ...emitted });
    }
    if (operations.length === 0) {
      skipped.push({
        schema: name,
        operation: "group",
        reason: "no member of this object could be generated"
      });
      continue;
    }
    if (ts) {
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
  }
  for (const [name, value] of Object.entries(plan.artifacts)) {
    if (!isValidIdentifier(name)) {
      skipped.push({
        schema: name,
        operation: "export",
        reason: "declaration names must be valid JavaScript identifiers"
      });
      continue;
    }
    const artifact = getArtifact(value);
    if (!artifact) {
      skipped.push({
        schema: name,
        operation: "export",
        reason: "declaration is not a compiled JIT artifact"
      });
      continue;
    }
    const sourceFile = options.sources?.get(name);
    const declaredType = exported.has(name) && sourceFile ? declarationImportType(options.outDir, sourceFile, name, artifact) : void 0;
    if (emitArtifact(name, artifact, name, declaredType, ts)) exportNames.push(name);
  }
  function emitArtifact(binding, artifact, reportName, importedType, annotate2) {
    const type = importedType ?? artifactType(artifact);
    const assertedClassType = artifact.kind === "class" && artifact.aggregate && annotate2 && ts ? type : void 0;
    const declaration = `const ${binding}${annotate2 && ts && assertedClassType === void 0 ? `: ${type}` : ""} =`;
    if (importedType !== void 0) needsCallHelper = needsCallHelper || importedType.startsWith("__JitCall<");
    if (artifact.kind === "validator") return emitValidatorArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "operation") return emitOperationArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "execution")
      return emitExecutionArtifact(binding, declaration, artifact.plan, reportName, type);
    if (artifact.kind === "query-plan") return emitQueryPlanArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "join-plan") return emitJoinPlanArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "cqrs-input") return emitCqrsInputArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "cqrs-parser")
      return emitCqrsParserArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "sort-plan") return emitSortPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "index-plan") return emitIndexPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "lookup-plan") return emitLookupPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "project-plan") return emitProjectPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "authorized-project-plan") {
      const actor = serializeStaticData(artifact.actor);
      if (actor === void 0) {
        skipped.push({
          schema: reportName,
          operation: "project.authorize",
          reason: "the bound actor cannot be serialized ahead of time"
        });
        return void 0;
      }
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(`  const __actor = ${actor};`);
      js.push(`  return ${asExpression(emitAuthorizedProjectSource(artifact, artifact.action), "project")};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "authorized-update-plan") {
      const actor = serializeStaticData(artifact.actor);
      if (actor === void 0) {
        skipped.push({
          schema: reportName,
          operation: "update.authorize",
          reason: "the bound actor cannot be serialized ahead of time"
        });
        return void 0;
      }
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(`  const actor = ${actor};`);
      js.push("  class __AccessDeniedError extends Error {");
      js.push("    constructor(action, field, reason) {");
      js.push('      super("Access denied for action " + JSON.stringify(action));');
      js.push('      this.name = "AccessDeniedError";');
      js.push('      this.code = "ACCESS_DENIED";');
      js.push("      this.action = action;");
      js.push("      this.field = field;");
      js.push("      this.reason = reason;");
      js.push("    }");
      js.push("  }");
      js.push(`  const update = ${asExpression(emitUpdateSource(artifact.schema), "update")};`);
      js.push(...indentBlock(emitAccessMutationGuardSource(artifact.descriptor, artifact.action)));
      js.push("  return function authorizedUpdate(value, patch) {");
      js.push("    authorizeMutation(value, patch);");
      js.push("    return update(value, patch);");
      js.push("  };");
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "changed-plan") return emitChangedPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "patch-plan") return emitPatchPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "cache-key-plan") return emitCacheKeyPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "match-plan") {
      const inlined2 = inlineBindings(artifact.bindingNames, artifact.bindingValues);
      if (inlined2 === void 0) {
        skipped.push({
          schema: reportName,
          operation: "match",
          reason: "match handlers contain native, bound, or closure-dependent callbacks"
        });
        return void 0;
      }
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(...inlined2.map((line) => `  ${line}`));
      js.push(`  return ${asExpression(emitMatchSource(artifact.descriptor), "match")};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "migration-plan") {
      const inlined2 = inlineBindings(artifact.descriptor.bindingNames, artifact.descriptor.bindingValues);
      if (inlined2 === void 0) {
        skipped.push({
          schema: reportName,
          operation: "migrate",
          reason: "migration mappings contain native, bound, or closure-dependent callbacks"
        });
        return void 0;
      }
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(...inlined2.map((line) => `  ${line}`));
      js.push(`  return ${emitMigrationSource(artifact.descriptor)};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "csv-plan") {
      if (artifact.descriptor.operation === "stringify") {
        js.push(`${declaration} /*#__PURE__*/ ${asExpression(emitCsvSource(artifact.descriptor), "csvStringify")};`);
        return { binding, type };
      }
      const validator = emitValidatorBinding(binding, artifact.descriptor.schema, reportName, "csv.parse", {
        is: false,
        safeParse: true,
        resolveDefaults: true,
        materializeRuntimeTypes: true
      });
      if (!validator) return void 0;
      needsValidationError = true;
      js.push(
        `${declaration} /*#__PURE__*/ ${asExpression(emitCsvSource(artifact.descriptor, validator), "csvParse")};`
      );
      return { binding, type };
    }
    if (artifact.kind === "ndjson-plan") {
      if (artifact.descriptor.operation === "stringify") {
        js.push(`${declaration} /*#__PURE__*/ ${emitNdjsonSource(artifact.descriptor)};`);
        return { binding, type };
      }
      const inlined2 = inlineBindings(artifact.descriptor.bindingNames, artifact.descriptor.bindingValues);
      if (inlined2 === void 0) {
        skipped.push({
          schema: reportName,
          operation: "ndjson.parse",
          reason: "NDJSON filters contain native, bound, or closure-dependent values"
        });
        return void 0;
      }
      const validator = emitValidatorBinding(binding, artifact.descriptor.schema, reportName, "ndjson.parse", {
        is: false,
        safeParse: true,
        resolveDefaults: true,
        materializeRuntimeTypes: true
      });
      if (!validator) return void 0;
      needsValidationError = true;
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(...inlined2.map((line) => `  ${line}`));
      js.push(`  return ${emitNdjsonSource(artifact.descriptor, validator)};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "access-plan") {
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push("  class __AccessDeniedError extends Error {");
      js.push("    constructor(action, field, reason, ruleId) {");
      js.push('      super("Access denied for action " + JSON.stringify(action));');
      js.push('      this.name = "AccessDeniedError";');
      js.push('      this.code = "ACCESS_DENIED";');
      js.push("      this.action = action;");
      js.push("      this.field = field;");
      js.push("      this.reason = reason;");
      js.push("      this.ruleId = ruleId;");
      js.push("    }");
      js.push("  }");
      js.push(`  return ${asExpression(emitAccessSource(artifact.descriptor), "access")};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "rules-plan") {
      const bindingNames = /* @__PURE__ */ new Map();
      for (let index2 = 0; index2 < artifact.descriptor.bindingNames.length; index2++) {
        const name = artifact.descriptor.bindingNames[index2];
        const emitted = classBindings.get(artifact.descriptor.bindings[index2]);
        if (emitted === void 0) {
          if (RULES_OUTCOME_SINKS.has(artifact.sink)) {
            skipped.push({
              schema: reportName,
              operation: `rules.${artifact.sink}`,
              reason: "AOT rule outcomes require exporting the domain event Runtime Class artifact alongside the rules plan"
            });
            return void 0;
          }
          continue;
        }
        bindingNames.set(name, emitted);
      }
      const source2 = tryEmit(
        reportName,
        `rules.${artifact.sink}`,
        skipped,
        () => emitRulesSinkSource(artifact.descriptor, artifact.sink, {
          bindingNames,
          ...artifact.ruleId === void 0 ? {} : { ruleId: artifact.ruleId }
        })
      );
      if (!source2) return void 0;
      js.push(`${declaration} /*#__PURE__*/ ${source2};`);
      return { binding, type };
    }
    if (artifact.kind === "canonical-plan") {
      js.push(`${declaration} /*#__PURE__*/ ${emitCanonicalSource(artifact.schema)};`);
      return { binding, type };
    }
    if (artifact.kind === "reconcile-plan")
      return emitReconcilePlanArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "class")
      return emitClassArtifact(binding, declaration, artifact, reportName, type, assertedClassType);
    const inlined = inlineBindings(artifact.bindingNames, artifact.bindingValues);
    if (inlined === void 0) {
      skipped.push({
        schema: reportName,
        operation: artifact.kind,
        reason: `${artifact.kind} bindings hold callbacks that cannot be serialized ahead of time`
      });
      return void 0;
    }
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    js.push(`  return (${artifact.source});`);
    js.push("})();");
    return { binding, type };
  }
  function artifactType(artifact) {
    if (artifact.kind === "validator") return standaloneType(artifact, typeNames);
    if (artifact.kind === "operation") return operationType(artifact, typeNames);
    if (artifact.kind === "execution") return executionPlanType(artifact.plan, typeNames);
    if (artifact.kind === "query-plan") return queryPlanType(artifact, typeNames);
    if (artifact.kind === "join-plan") return joinPlanType(artifact, typeNames);
    if (artifact.kind === "cqrs-input")
      return '{ readonly "~query": unknown; readonly parse: (input: unknown) => unknown }';
    if (artifact.kind === "cqrs-parser") return "(input: unknown) => unknown";
    if (artifact.kind === "sort-plan") return sortPlanType(artifact, typeNames);
    if (artifact.kind === "index-plan") return indexPlanType(artifact, typeNames);
    if (artifact.kind === "lookup-plan") return lookupPlanType(artifact, typeNames);
    if (artifact.kind === "project-plan") return projectPlanType(artifact, typeNames);
    if (artifact.kind === "authorized-project-plan")
      return `(value: ${namedType(artifact.schema, typeNames)}) => Partial<${namedType(artifact.schema, typeNames)}>`;
    if (artifact.kind === "authorized-update-plan")
      return `(value: ${namedType(artifact.schema, typeNames)}, patch: unknown) => ${namedType(artifact.schema, typeNames)}`;
    if (artifact.kind === "changed-plan") return changedPlanType(artifact, typeNames);
    if (artifact.kind === "patch-plan") return patchPlanType(artifact, typeNames);
    if (artifact.kind === "cache-key-plan")
      return `(value: ${namedType(artifact.schema, typeNames)}) => ${artifact.descriptor.form === "hash" ? "number" : "string"}`;
    if (artifact.kind === "match-plan") return `(value: ${namedType(artifact.schema, typeNames)}) => unknown`;
    if (artifact.kind === "migration-plan") return migrationPlanType(artifact, typeNames);
    if (artifact.kind === "csv-plan") return csvPlanType(artifact, typeNames);
    if (artifact.kind === "ndjson-plan") return ndjsonPlanType(artifact, typeNames);
    if (artifact.kind === "access-plan") return accessPlanType(artifact, typeNames);
    if (artifact.kind === "rules-plan") return rulesPlanType(artifact, typeNames);
    if (artifact.kind === "canonical-plan") {
      const canonicalValue = namedType(artifact.schema, typeNames);
      return `(value: ${canonicalValue}) => ${canonicalValue}`;
    }
    if (artifact.kind === "class") {
      const value = emitTypeScriptType(artifact.schema, typeNames);
      if (artifact.domainEvent) {
        const object2 = resolveObjectSchema(artifact.schema);
        const payload = object2 ? emitTypeScriptType(object2.def.props.payload, typeNames) : "unknown";
        const event = `${value} & { readonly "~event": { readonly version: 1; readonly type: ${JSON.stringify(artifact.domainEvent.type)}; readonly schemaVersion: ${artifact.domainEvent.version} } }`;
        return `{ new (state: ${value}): ${event}; create(input: ${payload}): ${event}; hydrate(state: ${value}): ${event}; readonly type: ${JSON.stringify(artifact.domainEvent.type)}; readonly version: ${artifact.domainEvent.version} }`;
      }
      const methods = [];
      const capabilities = new Set(artifact.capabilities);
      if (capabilities.has("equals")) methods.push("equals(other: unknown): boolean;");
      if (capabilities.has("hashCode")) methods.push("hashCode(): number;");
      if (capabilities.has("diff"))
        methods.push(
          'diff(other: unknown): ({ readonly type: "add" | "update"; readonly path: readonly PropertyKey[]; readonly value: unknown } | { readonly type: "remove"; readonly path: readonly PropertyKey[] })[];'
        );
      if (capabilities.has("with")) {
        methods.push(`with(patch: ${classUpdateType(artifact.schema)}): this;`);
      }
      if (artifact.capabilities.some((capability2) => capability2.startsWith("identity:"))) {
        methods.push("identity(): unknown;", "sameIdentity(other: unknown): boolean;");
      }
      const mixins = [];
      if (methods.length > 0) mixins.push(`{ ${methods.join(" ")} }`);
      if (artifact.aggregate) {
        needsAggregateType = true;
        mixins.push(`__JitAggregate<${classUpdateType(artifact.schema)}>`);
        if (artifact.mutation?.deletedAt !== void 0)
          mixins.push("{ softDelete(): void; restore(): void; readonly isDeleted: boolean }");
      }
      const instance = mixins.length === 0 ? value : `${value} & ${mixins.join(" & ")}`;
      const factories = [
        artifact.factories.create === false ? "" : `${JSON.stringify(artifact.factories.create)}<TThis extends abstract new (...args: never[]) => unknown>(this: TThis, input: unknown): InstanceType<TThis>;`,
        artifact.factories.hydrate === false ? "" : `${JSON.stringify(artifact.factories.hydrate)}<TThis extends abstract new (...args: never[]) => unknown>(this: TThis, state: ${value}): InstanceType<TThis>;`
      ].filter(Boolean);
      return `{ new (state: ${value}): ${instance}; ${factories.join(" ")} }`;
    }
    return "unknown";
  }
  function emitSortPlanArtifact(binding, declaration, artifact, type) {
    js.push(`${declaration} /*#__PURE__*/ ${emitSortSource(artifact.descriptor)};`);
    return { binding, type };
  }
  function emitIndexPlanArtifact(binding, declaration, artifact, type) {
    needsRuntimeCachedIndex = true;
    js.push(
      `${declaration} /*#__PURE__*/ ${emitIndexPlanSource(artifact.descriptor, indexCacheKey(artifact.descriptor))}(__cachedIndex);`
    );
    return { binding, type };
  }
  function emitLookupPlanArtifact(binding, declaration, artifact, type) {
    if (artifact.lookup.choice.strategy === "CachedIndexLookup") needsRuntimeCachedIndex = true;
    js.push(`${declaration} /*#__PURE__*/ ${emitLookupSource(artifact.lookup)};`);
    return { binding, type };
  }
  function emitProjectPlanArtifact(binding, declaration, artifact, type) {
    js.push(`${declaration} /*#__PURE__*/ ${asExpression(emitProjectSource(artifact.tree), "project")};`);
    return { binding, type };
  }
  function emitChangedPlanArtifact(binding, declaration, artifact, type) {
    const paths = artifact.descriptor.fields.map((field) => field.path);
    const bigint3 = artifact.descriptor.representation === "bigint";
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    for (const equal3 of changedEqualBindings(artifact.descriptor)) {
      js.push(`  const ${equal3.name} = ${asExpression(equal3.source, "equal")};`);
    }
    js.push(...indentBlock(emitChangedSource(artifact.descriptor)));
    js.push(`  const __bits = new Map(${JSON.stringify(paths)}.map((path, index) => [path, index]));`);
    js.push('  Object.defineProperty(changed, "fields", { value: Object.freeze(' + JSON.stringify(paths) + ") });");
    js.push('  Object.defineProperty(changed, "has", {');
    js.push("    value: (mask, path) => {");
    js.push("      const bit = __bits.get(path);");
    js.push("      if (bit === undefined) return false;");
    js.push(bigint3 ? "      return (mask & (1n << BigInt(bit))) !== 0n;" : "      return (mask & (1 << bit)) !== 0;");
    js.push("    },");
    js.push("  });");
    js.push("  return changed;");
    js.push("})();");
    return { binding, type };
  }
  function emitPatchPlanArtifact(binding, declaration, artifact, type) {
    if (artifact.mode === "merge") {
      js.push(`${declaration} /*#__PURE__*/ ${emitMergePatchProgram(artifact.schema)};`);
      return { binding, type };
    }
    needsJsonPatchHelpers = true;
    js.push(`${declaration} /*#__PURE__*/ ${asExpression(emitJsonPatchSource(artifact.schema), "patch")};`);
    return { binding, type };
  }
  function emitCacheKeyPlanArtifact(binding, declaration, artifact, type) {
    const hashes = cacheKeyHashBindings(artifact.descriptor);
    if (hashes.length > 0 || artifact.descriptor.form === "hash") needsHashHelpers = true;
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    for (const hash4 of hashes) js.push(`  const ${hash4.name} = ${asExpression(hash4.source, "hash")};`);
    js.push(...indentBlock(emitCacheKeySource(artifact.descriptor)));
    js.push("  return cacheKey;");
    js.push("})();");
    return { binding, type };
  }
  function emitClassArtifact(binding, declaration, artifact, reportName, type, assertedType) {
    const base = resolveObjectSchema(artifact.schema);
    if (!base) {
      skipped.push({
        schema: reportName,
        operation: "class",
        reason: "JIT classes require an object schema"
      });
      return void 0;
    }
    const validator = emitValidatorBinding(
      binding,
      artifact.domainEvent ? base.def.props.payload : artifact.schema,
      reportName,
      "class",
      {
        is: false,
        safeParse: true
      }
    );
    if (!validator) return void 0;
    const hydrateValidator = artifact.domainEvent ? validator : emitValidatorBinding(binding, artifact.schema, reportName, "class.hydrate", {
      is: false,
      safeParse: true,
      resolveDefaults: false
    });
    if (!hydrateValidator) return void 0;
    needsValidationError = true;
    const helpers2 = [];
    const methods = [];
    const capabilities = new Set(artifact.capabilities);
    const fields = Object.keys(base.def.props);
    const accessorByKey = new Map(artifact.accessors?.map((accessor) => [accessor.key, accessor]));
    const slots = /* @__PURE__ */ new Map();
    let slotIndex = 0;
    for (const field of fields) {
      if (accessorByKey.get(field)?.field === "private") slots.set(field, `#p${slotIndex++}`);
    }
    const readField = (field) => {
      const slot = slots.get(field);
      return slot ? `this.${slot}` : `this[${JSON.stringify(field)}]`;
    };
    const writeField = (field, value) => `${readField(field)} = ${value};`;
    const accessorDefinitions = (artifact.accessors ?? []).filter((accessor) => accessor.field === "private").flatMap((accessor) => {
      const slot = slots.get(accessor.key);
      const definitions = [];
      if (accessor.get !== false)
        definitions.push(`get [${JSON.stringify(accessor.get)}]() { return this.${slot}; }`);
      if (accessor.set !== false)
        definitions.push(`set [${JSON.stringify(accessor.set)}](value) { this.${slot} = value; }`);
      return definitions;
    });
    if (capabilities.has("equals")) {
      const body = tryEmit(reportName, "class.equals", skipped, () => emitEqualMethodBody(artifact.schema));
      if (!body) return void 0;
      if (body.includes("__getIndex")) needsRuntimeGetIndex = true;
      if (body.includes("__hash")) {
        const hash4 = internalIdentifier(`${binding}_equal_hash`);
        if (!emitHashBinding(hash4, artifact.schema, reportName)) return void 0;
        helpers2.push(`const __hash = ${hash4};`);
      }
      methods.push(`equals(other) { ${body} }`);
    }
    if (capabilities.has("hashCode")) {
      const hash4 = internalIdentifier(`${binding}_hash`);
      if (!emitHashBinding(hash4, artifact.schema, reportName)) return void 0;
      methods.push(`hashCode() { return ${hash4}(this); }`);
    }
    if (capabilities.has("diff")) {
      const source2 = tryEmit(reportName, "class.diff", skipped, () => emitDiffSource(artifact.schema));
      if (!source2) return void 0;
      const diff3 = internalIdentifier(`${binding}_diff`);
      helpers2.push(`const ${diff3} = ${asExpression(source2, "diff")};`);
      methods.push(`diff(other) { return ${diff3}(this, other); }`);
    }
    const needsUpdate = artifact.aggregate || capabilities.has("with");
    let update2;
    let aggregateUpdateBody;
    if (needsUpdate) {
      if (artifact.aggregate) {
        const readonlyFields = fields.filter((field) => resolveWrappers(base.def.props[field]).readonly);
        const mutation = buildMutationPlan({
          fields,
          readonlyFields,
          ...artifact.mutation?.updatedAt === void 0 ? {} : { updatedAt: artifact.mutation.updatedAt },
          ...artifact.mutation?.version === void 0 ? {} : { version: artifact.mutation.version }
        });
        const updates = /* @__PURE__ */ new Map();
        for (let index2 = 0; index2 < mutation.mutableFields.length; index2++) {
          const field = mutation.mutableFields[index2];
          if (isPrimitiveLikeSchema(resolveWrappers(base.def.props[field]).base)) {
            updates.set(field, null);
            continue;
          }
          const fieldUpdate = internalIdentifier(`${binding}_update_${index2}`);
          const source2 = tryEmit(reportName, "class.update", skipped, () => emitUpdateSource(base.def.props[field]));
          if (!source2) return void 0;
          helpers2.push(`const ${fieldUpdate} = ${asExpression(source2, "update")};`);
          updates.set(field, fieldUpdate);
        }
        aggregateUpdateBody = emitMutationPlanBody(mutation, updates);
      } else {
        const source2 = tryEmit(reportName, "class.update", skipped, () => emitUpdateSource(artifact.schema));
        if (!source2) return void 0;
        update2 = internalIdentifier(`${binding}_update`);
        helpers2.push(`const ${update2} = ${asExpression(source2, "update")};`);
      }
    }
    if (capabilities.has("with") && update2)
      methods.push(`with(patch) { return new this.constructor(${update2}(this, patch)); }`);
    const identity = artifact.capabilities.find((capability2) => capability2.startsWith("identity:"));
    if (identity) {
      const key = JSON.stringify(identity.slice("identity:".length));
      methods.push(
        `identity() { return this[${key}]; }`,
        `sameIdentity(other) { return typeof other === "object" && other !== null && Object.is(this[${key}], other[${key}]); }`
      );
    }
    if (artifact.aggregate && aggregateUpdateBody) {
      methods.push(
        `update(patch) { ${aggregateUpdateBody} }`,
        "raise(event) { this.__jitEvents.push(event); }",
        "peekEvents() { return this.__jitEvents.slice(); }",
        "pullEvents() { const events = this.__jitEvents; this.__jitEvents = []; return events; }",
        "async commit(publisher) { const pending = this.__jitEvents; for (let index = 0; index < pending.length; index++) await publisher.publish(pending[index]); this.__jitEvents.splice(0, pending.length); }"
      );
    }
    if (artifact.aggregate && artifact.mutation?.deletedAt !== void 0) {
      const deletedAt = artifact.mutation.deletedAt;
      const updatedAt = artifact.mutation.updatedAt;
      methods.push(
        `softDelete() { const now = new Date(); ${writeField(deletedAt, "now")}${updatedAt === void 0 ? "" : ` ${writeField(updatedAt, "now")}`} }`,
        `restore() { ${writeField(deletedAt, "null")}${updatedAt === void 0 ? "" : ` ${writeField(updatedAt, "new Date()")}`} }`,
        `get isDeleted() { return ${readField(deletedAt)} !== null; }`
      );
    }
    const assignments = fields.map((field) => writeField(field, `state[${JSON.stringify(field)}]`)).join(" ");
    const events = artifact.aggregate ? ' Object.defineProperty(this, "__jitEvents", { value: [], writable: true });' : "";
    const freeze = artifact.frozen ? " Object.freeze(this);" : "";
    const abstractGuard = artifact.abstract ? `if (this === ${binding}) throw new Error("Cannot create an instance of an abstract JIT class"); ` : "";
    const create = artifact.domainEvent ? `const result = ${validator}.safeParse(input); if (!result.success) throw new JITValidationError(result.issues); return new this({ id: globalThis.crypto?.randomUUID?.() ?? \`evt_\${Date.now().toString(36)}_\${Math.random().toString(36).slice(2)}\`, type: ${JSON.stringify(artifact.domainEvent.type)}, version: ${artifact.domainEvent.version}, occurredAt: new Date(), payload: result.data });` : "return new this(input);";
    const hydrate = artifact.domainEvent ? `if (state === null || typeof state !== "object" || state.type !== ${JSON.stringify(artifact.domainEvent.type)} || state.version !== ${artifact.domainEvent.version} || typeof state.id !== "string") throw new JITValidationError([]); const occurredAt = state.occurredAt instanceof Date ? state.occurredAt : new Date(state.occurredAt); if (Number.isNaN(occurredAt.getTime())) throw new JITValidationError([]); const result = ${validator}.safeParse(state.payload); if (!result.success) throw new JITValidationError(result.issues); return new this({ ...state, occurredAt, payload: result.data });` : `const result = ${hydrateValidator}.safeParse(state); if (!result.success) throw new JITValidationError(result.issues); return new this(result.data);`;
    const constructorSource = artifact.domainEvent ? `constructor(state) { ${assignments}${events}${freeze} }` : `constructor(input, validated) { const state = validated === true ? input : (() => { const result = ${validator}.safeParse(input); if (!result.success) throw new JITValidationError(result.issues); return result.data; })(); ${assignments}${events}${freeze} }`;
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    if (helpers2.length > 0) js.push(`  ${helpers2.join("\n  ")}`);
    js.push(`  return class ${binding} {`);
    js.push(...[...slots.values()].map((slot) => `    ${slot};`));
    js.push(`    ${constructorSource}`);
    if (artifact.factories.create !== false)
      js.push(`    static ${classMemberName(artifact.factories.create)}(input) { ${abstractGuard}${create} }`);
    if (artifact.factories.hydrate !== false)
      js.push(`    static ${classMemberName(artifact.factories.hydrate)}(state) { ${abstractGuard}${hydrate} }`);
    if (artifact.domainEvent)
      js.push(
        `    static type = ${JSON.stringify(artifact.domainEvent.type)};`,
        `    static version = ${artifact.domainEvent.version};`,
        `    static ["~event"] = /*#__PURE__*/ Object.freeze({ version: 1, type: ${JSON.stringify(artifact.domainEvent.type)}, schemaVersion: ${artifact.domainEvent.version} });`,
        `    get ["~event"]() { return ${binding}["~event"]; }`
      );
    js.push(...accessorDefinitions.map((definition) => `    ${definition}`));
    js.push(...methods.map((method) => `    ${method}`));
    js.push("  };");
    js.push(`})()${assertedType === void 0 ? "" : ` as unknown as ${assertedType}`};`);
    return { binding, type };
  }
  function emitValidatorArtifact(binding, declaration, artifact, reportName, type) {
    if (artifact.op === "parseAsync" || artifact.op === "safeParseAsync") {
      skipped.push({
        schema: reportName,
        operation: artifact.op,
        reason: "async validators are runtime-only in AOT output"
      });
      return void 0;
    }
    const fastParse = (artifact.op === "parse" || artifact.op === "safeParse") && canUseFastParse(artifact.schema);
    const validatorName = emitValidatorBinding(binding, artifact.schema, reportName, artifact.op, {
      is: artifact.op === "is" || fastParse,
      safeParse: artifact.op === "safeParse" || artifact.op === "parse"
    });
    if (!validatorName) return void 0;
    if (artifact.op === "is") {
      js.push(`${declaration} /*#__PURE__*/ ((v) => v.is)(${validatorName});`);
    } else if (artifact.op === "safeParse") {
      js.push(
        fastParse ? `${declaration} (value) => ${validatorName}.is(value) ? { success: true, data: value } : ${validatorName}.safeParse(value);` : `${declaration} /*#__PURE__*/ ((v) => v.safeParse)(${validatorName});`
      );
    } else {
      needsValidationError = true;
      js.push(
        fastParse ? `${declaration} (value) => { if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };` : `${declaration} (value) => { const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
      );
    }
    return { binding, type };
  }
  function emitValidatorBinding(binding, schema, reportName, operation, selection) {
    const validator = tryEmit(
      reportName,
      operation,
      skipped,
      () => emitValidator(schema, {
        is: selection.is,
        safeParse: selection.safeParse,
        safeParseAsync: false,
        ...selection.resolveDefaults === void 0 ? {} : { resolveDefaults: selection.resolveDefaults },
        ...selection.materializeRuntimeTypes === void 0 ? {} : { materializeRuntimeTypes: selection.materializeRuntimeTypes }
      })
    );
    if (!validator) return void 0;
    const inlined = inlineBindings(validator.bindings.names, validator.bindings.values);
    if (inlined === void 0) {
      skipped.push({
        schema: reportName,
        operation,
        reason: "refine/transform/default callbacks cannot be serialized ahead of time"
      });
      return void 0;
    }
    const validatorName = internalIdentifier(`${binding}_validator`);
    js.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    js.push(...indentBlock(validator.source));
    js.push("})();");
    return validatorName;
  }
  function emitHashBinding(binding, schema, reportName, cache = true) {
    const source2 = tryEmit(reportName, "hash", skipped, () => emitHashSource(schema));
    if (!source2) return void 0;
    needsHashHelpers = true;
    if (!cache) {
      js.push(`const ${binding} = ${asExpression(source2, "hash")};`);
      return binding;
    }
    needsHashCache = true;
    js.push(`const ${binding} = /*#__PURE__*/ (() => {`);
    js.push(...indentBlock(`const compute = (${source2});`));
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
    return binding;
  }
  function emitEqualBinding(binding, schema, reportName) {
    const source2 = tryEmit(reportName, "equal", skipped, () => emitEqualSource(schema));
    if (!source2) return void 0;
    if (source2.includes("__getIndex")) needsRuntimeGetIndex = true;
    if (source2.includes("__hash")) {
      const hashBinding = internalIdentifier(`${binding}_hash`);
      if (!emitHashBinding(hashBinding, schema, reportName)) return void 0;
      js.push(`const ${binding} = /*#__PURE__*/ ((__hash) => ${asExpression(source2, "equal")})(${hashBinding});`);
    } else {
      js.push(`const ${binding} = ${asExpression(source2, "equal")};`);
    }
    return binding;
  }
  function emitReconcilePlanArtifact(binding, declaration, artifact, reportName, type) {
    const object2 = resolveRowObjectSchema(artifact.schema, "reconcile");
    const source2 = tryEmit(reportName, "reconcile", skipped, () => emitReconcileSource(artifact.descriptor));
    if (!source2) return void 0;
    const prelude = [];
    if (source2.includes("__reconcileEqual")) {
      const equalBinding = internalIdentifier(`${binding}_equal`);
      if (!emitEqualBinding(equalBinding, object2, reportName)) return void 0;
      prelude.push(`  const __reconcileEqual = ${equalBinding};`);
    }
    if (source2.includes("__reconcileDiff")) {
      const diffSource = tryEmit(reportName, "reconcile.diff", skipped, () => emitDiffSource(object2));
      if (!diffSource) return void 0;
      const diffBinding = internalIdentifier(`${binding}_diff`);
      js.push(`const ${diffBinding} = ${asExpression(diffSource, "diff")};`);
      prelude.push(`  const __reconcileDiff = ${diffBinding};`);
    }
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...prelude);
    js.push(...indentBlock(source2));
    js.push("  return reconcile;");
    js.push("})();");
    return { binding, type };
  }
  function emitOperationArtifact(binding, declaration, artifact, reportName, type) {
    const schema = artifact.schema;
    const emitted = { binding, type };
    switch (artifact.op) {
      case "hash": {
        const hashBinding = internalIdentifier(`${binding}_hash`);
        if (!emitHashBinding(hashBinding, schema, reportName)) return void 0;
        js.push(`${declaration} ${hashBinding};`);
        return emitted;
      }
      case "equal": {
        const source2 = tryEmit(reportName, "equal", skipped, () => emitEqualSource(schema));
        if (!source2) return void 0;
        if (source2.includes("__getIndex")) needsRuntimeGetIndex = true;
        if (source2.includes("__hash")) {
          const hashBinding = internalIdentifier(`${binding}_hash`);
          if (!emitHashBinding(hashBinding, schema, reportName)) return void 0;
          js.push(`${declaration} /*#__PURE__*/ ((__hash) => ${asExpression(source2, "equal")})(${hashBinding});`);
        } else {
          js.push(`${declaration} ${asExpression(source2, "equal")};`);
        }
        return emitted;
      }
      case "clone":
      case "diff":
      case "stringify":
      case "format":
      case "mask": {
        const source2 = emitOperationSource(artifact.op, schema, reportName);
        if (!source2) return void 0;
        js.push(`${declaration} ${asExpression(source2, OPERATION_ENTRY[artifact.op])};`);
        return emitted;
      }
      case "sanitize": {
        const source2 = tryEmit(reportName, "sanitize", skipped, () => emitSanitizeSource(schema));
        if (!source2) return void 0;
        js.push(`${declaration} /*#__PURE__*/ (() => {`);
        js.push(
          ...sanitizeChainBindings.names.map(
            (name, position) => `  const ${name} = ${String(sanitizeChainBindings.values[position])};`
          )
        );
        js.push(...indentBlock(`return ${asExpression(source2, "scrub")};`));
        js.push("})();");
        return emitted;
      }
      case "fromJSON": {
        const fastParse = canUseFastParse(schema);
        const validatorName = emitValidatorBinding(binding, schema, reportName, "fromJSON", {
          is: fastParse,
          safeParse: true
        });
        if (!validatorName) return void 0;
        needsValidationError = true;
        js.push(
          fastParse ? `${declaration} (json) => { const value = JSON.parse(json); if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };` : `${declaration} (json) => { const r = ${validatorName}.safeParse(JSON.parse(json)); if (r.success) return r.data; throw new JITValidationError(r.issues); };`
        );
        return emitted;
      }
      case "codec": {
        if (!emitCodecBinding(binding, declaration, schema, reportName, "codec")) return void 0;
        return emitted;
      }
      case "jsonSchema": {
        const document = tryEmit(reportName, "jsonSchema", skipped, () => compileJsonSchema(schema));
        if (!document) return void 0;
        js.push(`${declaration} /*#__PURE__*/ Object.freeze(${JSON.stringify(document)});`);
        return emitted;
      }
      case "mock": {
        const source2 = tryEmit(reportName, "mock", skipped, () => emitMockSource(schema));
        if (!source2) return void 0;
        needsMockHelpers = true;
        js.push(`${declaration} (${source2});`);
        return emitted;
      }
      case "update": {
        const source2 = tryEmit(reportName, "update", skipped, () => emitUpdateSource(schema));
        if (!source2) return void 0;
        js.push(`${declaration} ${asExpression(source2, "update")};`);
        return emitted;
      }
    }
  }
  function emitOperationSource(operation, schema, reportName) {
    if (operation === "clone") return tryEmit(reportName, operation, skipped, () => emitCloneSource(schema));
    if (operation === "diff") return tryEmit(reportName, operation, skipped, () => emitDiffSource(schema));
    if (operation === "stringify") return tryEmit(reportName, operation, skipped, () => emitSerialize(schema));
    if (operation === "format") return tryEmit(reportName, operation, skipped, () => emitFormatSource(schema));
    return tryEmit(reportName, operation, skipped, () => emitMaskSource(schema));
  }
  function emitCodecBinding(binding, declaration, schema, reportName, operation) {
    const codec2 = tryEmit(reportName, operation, skipped, () => emitCodec(schema));
    if (!codec2) return false;
    const inlined = inlineCodecBindings(codec2.bindingNames, codec2.bindingValues);
    if (inlined === void 0) {
      skipped.push({
        schema: reportName,
        operation,
        reason: "codec bindings cannot be serialized"
      });
      return false;
    }
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    js.push(...indentBlock(codec2.source));
    js.push("})();");
    void binding;
    return true;
  }
  function emitQueryPlanArtifact(binding, declaration, artifact, reportName, type) {
    const program = artifact.program;
    const source2 = tryEmit(
      reportName,
      "query",
      skipped,
      () => emitQueryPlanSource(artifact.schema, program, artifact.mode)
    );
    if (!source2) return void 0;
    if (source2.includes("__cachedIndex")) needsRuntimeCachedIndex = true;
    const inlined = inlineBindings(
      program.bindings.map((_, index2) => `__q${index2}`),
      program.bindings
    );
    if (inlined === void 0) {
      skipped.push({
        schema: reportName,
        operation: "query",
        reason: "query bindings hold callbacks that cannot be serialized ahead of time"
      });
      return void 0;
    }
    let distinctHash;
    let distinctEqual;
    if (source2.includes("__distinctHash")) {
      const objectSchema = expectCollectionObjectSchema(artifact.schema, "AOT distinct").objectSchema;
      distinctHash = internalIdentifier(`${binding}_distinct_hash`);
      distinctEqual = internalIdentifier(`${binding}_distinct_equal`);
      if (!emitHashBinding(distinctHash, objectSchema, reportName, false)) return void 0;
      if (!emitEqualBinding(distinctEqual, objectSchema, reportName)) return void 0;
    }
    const standard = artifact.standard === void 0 ? void 0 : JSON.stringify(artifact.standard);
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    if (distinctHash && distinctEqual) {
      js.push(`  const __distinctHash = ${distinctHash};`);
      js.push(`  const __distinctEqual = ${distinctEqual};`);
    }
    js.push(
      ...indentBlock(
        standard === void 0 ? `return (${source2});` : `const query = (${source2}); Object.defineProperty(query, "~query", { value: ${standard} }); return query;`
      )
    );
    js.push("})();");
    return { binding, type };
  }
  function emitJoinPlanArtifact(binding, declaration, artifact, reportName, type) {
    const source2 = tryEmit(reportName, "join", skipped, () => emitJoinSource(artifact.plan));
    if (!source2) return void 0;
    if (source2.includes("__cachedIndex")) needsRuntimeCachedIndex = true;
    const bindings = artifact.plan.leftProgram.bindings;
    const inlined = inlineBindings(
      bindings.map((_, index2) => `__q${index2}`),
      bindings
    );
    if (inlined === void 0) {
      skipped.push({
        schema: reportName,
        operation: "join",
        reason: "join bindings hold callbacks that cannot be serialized ahead of time"
      });
      return void 0;
    }
    const standard = artifact.standard === void 0 ? void 0 : JSON.stringify(artifact.standard);
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    js.push(
      ...indentBlock(
        standard === void 0 ? `return (${source2});` : `const join = (${source2}); Object.defineProperty(join, "~query", { value: ${standard} }); return join;`
      )
    );
    js.push("})();");
    return { binding, type };
  }
  function emitCqrsInputArtifact(binding, declaration, artifact, reportName, type) {
    const definition = JSON.stringify(artifact.definition);
    if (definition === void 0) {
      skipped.push({
        schema: reportName,
        operation: "cqrs-input",
        reason: "CQRS definition cannot be serialized"
      });
      return void 0;
    }
    const parserSource = artifact.source.replace("return function parse", "const parse = function parse");
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...indentBlock(parserSource));
    js.push(`  return Object.freeze({ "~query": Object.freeze({ version: 1, definition: ${definition} }), parse });`);
    js.push("})();");
    return { binding, type };
  }
  function emitCqrsParserArtifact(binding, declaration, artifact, reportName, type) {
    if (JSON.stringify(artifact.definition) === void 0) {
      skipped.push({
        schema: reportName,
        operation: "cqrs-parser",
        reason: "CQRS definition cannot be serialized"
      });
      return void 0;
    }
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...indentBlock(artifact.source));
    js.push("})();");
    return { binding, type };
  }
  function emitExecutionArtifact(binding, declaration, plan2, reportName, type) {
    const stages = optimizeExecutionPlan(plan2).stages;
    const emitted = { binding, type };
    const validateStage = stages.find((stage2) => stage2.kind === "validate");
    const hasJsonDecode = stages.some((stage2) => stage2.kind === "json.decode");
    const hasBinaryDecode = stages.some((stage2) => stage2.kind === "binary.decode");
    const hasJsonEncode = stages.some((stage2) => stage2.kind === "json.encode");
    const hasBinaryEncode = stages.some((stage2) => stage2.kind === "binary.encode");
    const operationStage = stages.find((stage2) => stage2.kind === "operation");
    const mapStage3 = stages.find((stage2) => stage2.kind === "map");
    const constructStage = stages.find((stage2) => stage2.kind === "construct");
    const chunksStage = stages.find((stage2) => stage2.kind === "json.encode" && stage2.mode === "chunks");
    const constructBinding = constructStage ? classBindings.get(constructStage.target) : void 0;
    const constructArtifact = constructStage ? classArtifacts.get(constructStage.target) : void 0;
    if (constructStage && !constructBinding) {
      skipped.push({
        schema: reportName,
        operation: "construct",
        reason: "AOT class construction requires exporting the Runtime Class artifact alongside the execution pipeline"
      });
      return void 0;
    }
    if (chunksStage?.kind === "json.encode") {
      const source2 = tryEmit(
        reportName,
        "json.stringifyChunks",
        skipped,
        () => emitStringifyChunksSource(chunksStage.schema ?? plan2.schema, {
          ...chunksStage.chunkBytes === void 0 ? {} : { chunkBytes: chunksStage.chunkBytes }
        })
      );
      if (!source2) return void 0;
      js.push(`${declaration} /*#__PURE__*/ (${source2});`);
      return emitted;
    }
    if (stages.some((stage2) => isComposedExecutionStage(stage2))) {
      return emitComposedExecutionArtifact(binding, declaration, plan2, reportName, type);
    }
    if (mapStage3?.kind === "map") {
      const mapping = mapStage3.bindings[0];
      if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
        skipped.push({
          schema: reportName,
          operation: "map",
          reason: "mapping descriptor is malformed"
        });
        return void 0;
      }
      const mapperPlan = tryEmit(
        reportName,
        "map",
        skipped,
        () => buildMapperPlan(mapStage3.source, mapStage3.target, mapping)
      );
      if (!mapperPlan) return void 0;
      const inlined = inlineBindings(mapperPlan.bindingNames, mapperPlan.bindings);
      if (inlined === void 0) {
        skipped.push({
          schema: reportName,
          operation: "map",
          reason: "mapping callbacks cannot be serialized ahead of time"
        });
        return void 0;
      }
      const mapperSource = tryEmit(
        reportName,
        "map",
        skipped,
        () => emitMapperSource(mapStage3.source, mapStage3.target, mapping, [
          mapStage3.many ? "many" : "map"
        ])
      );
      if (!mapperSource) return void 0;
      const method = mapStage3.many ? "many" : "map";
      if (hasJsonEncode) {
        const serializeSource = tryEmit(reportName, "json.encode", skipped, () => emitSerialize(plan2.schema));
        if (!serializeSource) return void 0;
        js.push(
          `${declaration} /*#__PURE__*/ ((mapper, stringify) => (value) => stringify(mapper.${method}(value)))((() => {`
        );
        js.push(...inlined.map((line) => `  ${line}`));
        js.push(...indentBlock(`return (${mapperSource});`));
        js.push(`})()), (${serializeSource}));`);
      } else {
        js.push(`${declaration} /*#__PURE__*/ ((mapper) => mapper.${method})((() => {`);
        js.push(...inlined.map((line) => `  ${line}`));
        js.push(...indentBlock(`return (${mapperSource});`));
        js.push("})());");
      }
      return emitted;
    }
    if (validateStage?.kind === "validate") {
      if (validateStage.operation === "issues" || validateStage.operation === "parseAsync" || validateStage.operation === "safeParseAsync") {
        skipped.push({
          schema: reportName,
          operation: validateStage.operation,
          reason: "this validation sink is runtime-only in AOT output"
        });
        return void 0;
      }
      const fastParse = (validateStage.operation === "parse" || validateStage.operation === "safeParse") && !constructBinding && canUseFastParse(plan2.schema);
      const validatorName = emitValidatorBinding(binding, plan2.schema, reportName, validateStage.operation, {
        is: validateStage.operation === "is" || fastParse,
        safeParse: validateStage.operation !== "is",
        ...constructBinding ? { materializeRuntimeTypes: false } : {},
        ...constructArtifact?.domainEvent ? { resolveDefaults: false } : {}
      });
      if (!validatorName) return void 0;
      if (validateStage.operation === "is") {
        if (hasJsonDecode || hasBinaryDecode) {
          skipped.push({
            schema: reportName,
            operation: "is",
            reason: "is must receive a value source in AOT output"
          });
          return void 0;
        }
        js.push(`${declaration} /*#__PURE__*/ ((v) => v.is)(${validatorName});`);
      } else if (validateStage.operation === "safeParse") {
        if (hasJsonDecode || hasBinaryDecode) {
          skipped.push({
            schema: reportName,
            operation: "safeParse",
            reason: "safeParse source composition is not an AOT sink"
          });
          return void 0;
        }
        js.push(
          fastParse ? `${declaration} (value) => ${validatorName}.is(value) ? { success: true, data: value } : ${validatorName}.safeParse(value);` : `${declaration} /*#__PURE__*/ ((v) => v.safeParse)(${validatorName});`
        );
      } else if (hasJsonDecode) {
        needsValidationError = true;
        js.push(
          fastParse ? `${declaration} (json) => { const value = JSON.parse(json); if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };` : `${declaration} (json) => { const r = ${validatorName}.safeParse(JSON.parse(json)); if (r.success) return ${constructBinding ? `new ${constructBinding}(r.data, true)` : "r.data"}; throw new JITValidationError(r.issues); };`
        );
      } else if (hasBinaryDecode) {
        const codec2 = tryEmit(reportName, "binary.decode", skipped, () => emitCodec(plan2.schema));
        if (!codec2) return void 0;
        const codecBindings = inlineCodecBindings(codec2.bindingNames, codec2.bindingValues);
        if (codecBindings === void 0) {
          skipped.push({
            schema: reportName,
            operation: "binary.decode",
            reason: "codec bindings cannot be serialized"
          });
          return void 0;
        }
        needsValidationError = true;
        js.push(
          fastParse ? `${declaration} /*#__PURE__*/ ((codec, is, safeParse) => (bytes) => { const value = codec.decode(bytes); if (is(value)) return value; const r = safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); })((() => {` : `${declaration} /*#__PURE__*/ ((codec, safeParse) => (bytes) => { const r = safeParse(codec.decode(bytes)); if (r.success) return ${constructBinding ? `new ${constructBinding}(r.data, true)` : "r.data"}; throw new JITValidationError(r.issues); })((() => {`
        );
        js.push(...codecBindings.map((line) => `  ${line}`));
        js.push(...indentBlock(codec2.source));
        js.push(
          fastParse ? `})()), ${validatorName}.is, ${validatorName}.safeParse);` : `})()), ${validatorName}.safeParse);`
        );
      } else {
        needsValidationError = true;
        js.push(
          fastParse ? `${declaration} (value) => { if (${validatorName}.is(value)) return value; const r = ${validatorName}.safeParse(value); if (r.success) return r.data; throw new JITValidationError(r.issues); };` : `${declaration} (value) => { const r = ${validatorName}.safeParse(value); if (r.success) return ${constructBinding ? `new ${constructBinding}(r.data, true)` : "r.data"}; throw new JITValidationError(r.issues); };`
        );
      }
      return emitted;
    }
    if (hasJsonDecode) {
      js.push(`${declaration} JSON.parse;`);
      return emitted;
    }
    if (hasJsonEncode) {
      const source2 = tryEmit(reportName, "json.encode", skipped, () => emitSerialize(plan2.schema));
      if (!source2) return void 0;
      js.push(`${declaration} ${asExpression(source2, "stringify")};`);
      return emitted;
    }
    if (hasBinaryDecode || hasBinaryEncode) {
      const codec2 = tryEmit(
        reportName,
        hasBinaryDecode ? "binary.decode" : "binary.encode",
        skipped,
        () => emitCodec(plan2.schema)
      );
      if (!codec2) return void 0;
      const inlined = inlineCodecBindings(codec2.bindingNames, codec2.bindingValues);
      if (inlined === void 0) {
        skipped.push({
          schema: reportName,
          operation: "binary",
          reason: "codec bindings cannot be serialized"
        });
        return void 0;
      }
      js.push(`${declaration} /*#__PURE__*/ ((codec) => codec.${hasBinaryDecode ? "decode" : "encode"})((() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      js.push(...indentBlock(codec2.source));
      js.push("})());");
      return emitted;
    }
    if (operationStage?.kind === "operation") {
      return emitOperationArtifact(
        binding,
        declaration,
        {
          kind: "operation",
          schema: plan2.schema,
          op: operationStage.operation
        },
        reportName,
        type
      );
    }
    skipped.push({
      schema: reportName,
      operation: "execution",
      reason: "no AOT backend matches this execution plan"
    });
    return void 0;
  }
  function emitComposedExecutionArtifact(binding, declaration, plan2, name, type) {
    const setup = [];
    const body = ["let value = input;"];
    const stages = optimizeExecutionPlan(plan2).stages;
    const emitComposedValidator = (schema, materializeRuntimeTypes = true) => {
      const fastParse = canUseFastParse(schema);
      const validator = tryEmit(
        name,
        "validate",
        skipped,
        () => emitValidator(schema, {
          is: fastParse,
          safeParse: true,
          safeParseAsync: false,
          materializeRuntimeTypes
        })
      );
      if (!validator) return void 0;
      const inlined = inlineBindings(validator.bindings.names, validator.bindings.values);
      if (inlined === void 0) {
        skipped.push({
          schema: name,
          operation: "validate",
          reason: "refine/transform/default callbacks cannot be serialized ahead of time"
        });
        return void 0;
      }
      const validatorName = internalIdentifier(`${binding}_validator`);
      setup.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
      setup.push(...inlined.map((line) => `  ${line}`));
      setup.push(...indentBlock(validator.source));
      setup.push("})();");
      return validatorName;
    };
    const emitComposedCodec = (schema, operation) => {
      const codec2 = tryEmit(name, operation, skipped, () => emitCodec(schema));
      if (!codec2) return void 0;
      const inlined = inlineCodecBindings(codec2.bindingNames, codec2.bindingValues);
      if (inlined === void 0) {
        skipped.push({
          schema: name,
          operation,
          reason: "codec bindings cannot be serialized"
        });
        return void 0;
      }
      const codecName = internalIdentifier(`${binding}_codec`);
      setup.push(`const ${codecName} = /*#__PURE__*/ (() => {`);
      setup.push(...inlined.map((line) => `  ${line}`));
      setup.push(...indentBlock(codec2.source));
      setup.push("})();");
      return codecName;
    };
    const emitComposedQuery = (stage2) => {
      const source2 = tryEmit(name, "query", skipped, () => emitQuerySource(stage2.source, stage2.program));
      if (!source2) return void 0;
      const bindings = inlineBindings(
        stage2.program.bindings.map((_, index2) => `__q${index2}`),
        stage2.program.bindings
      );
      if (bindings === void 0) {
        skipped.push({
          schema: name,
          operation: "query",
          reason: "query bindings cannot be serialized ahead of time"
        });
        return void 0;
      }
      const queryName = internalIdentifier(`${binding}_query`);
      setup.push(`const ${queryName} = /*#__PURE__*/ (() => {`);
      setup.push(...bindings.map((line) => `  ${line}`));
      setup.push(...indentBlock(`return (${source2});`));
      setup.push("})();");
      return queryName;
    };
    const emitComposedMapper = (stage2, operation = stage2.many ? "many" : "map") => {
      const mapping = stage2.bindings[0];
      if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
        skipped.push({
          schema: name,
          operation: "map",
          reason: "mapping descriptor is malformed"
        });
        return void 0;
      }
      const mapperPlan = tryEmit(
        name,
        "map",
        skipped,
        () => buildMapperPlan(stage2.source, stage2.target, mapping)
      );
      if (!mapperPlan) return void 0;
      const inlined = inlineBindings(mapperPlan.bindingNames, mapperPlan.bindings);
      if (inlined === void 0) {
        skipped.push({
          schema: name,
          operation: "map",
          reason: "mapping callbacks cannot be serialized ahead of time"
        });
        return void 0;
      }
      const source2 = tryEmit(
        name,
        "map",
        skipped,
        () => emitMapperSource(stage2.source, stage2.target, mapping, [operation])
      );
      if (!source2) return void 0;
      const mapperName = internalIdentifier(`${binding}_mapper`);
      setup.push(`const ${mapperName} = /*#__PURE__*/ (() => {`);
      setup.push(...inlined.map((line) => `  ${line}`));
      setup.push(...indentBlock(`return (${source2});`));
      setup.push("})();");
      return mapperName;
    };
    const emitComposedTransform = (stage2) => {
      const keys = Object.keys(stage2.transforms);
      const bindings = inlineBindings(
        keys.map((_, index2) => `__t${index2}`),
        keys.map((key) => stage2.transforms[key])
      );
      if (bindings === void 0) {
        skipped.push({
          schema: name,
          operation: "transform",
          reason: "transform callbacks cannot be serialized ahead of time"
        });
        return void 0;
      }
      const source2 = tryEmit(
        name,
        "transform",
        skipped,
        () => emitTransformSource(stage2.source, stage2.transforms)
      );
      if (!source2) return void 0;
      const transformName = internalIdentifier(`${binding}_transform`);
      setup.push(`const ${transformName} = /*#__PURE__*/ (() => {`);
      setup.push(...bindings.map((line) => `  ${line}`));
      setup.push(...indentBlock(`return (${source2});`));
      setup.push("})();");
      return transformName;
    };
    const emitComposedUpdate = (stage2) => {
      const patch3 = serializeStaticData(stage2.patch);
      if (patch3 === void 0) {
        skipped.push({
          schema: name,
          operation: "update",
          reason: "update patches must be serializable static data for AOT output"
        });
        return void 0;
      }
      const source2 = tryEmit(name, "update", skipped, () => emitUpdateSource(stage2.schema));
      if (!source2) return void 0;
      const update2 = internalIdentifier(`${binding}_update`);
      const patchName = internalIdentifier(`${binding}_patch`);
      setup.push(`const ${update2} = ${asExpression(source2, "update")};`);
      setup.push(`const ${patchName} = ${patch3};`);
      return { update: update2, patch: patchName };
    };
    const emitComposedSecurity = (stage2) => {
      const source2 = tryEmit(
        name,
        stage2.operation,
        skipped,
        () => stage2.operation === "mask" ? emitMaskSource(stage2.schema) : emitSanitizeSource(stage2.schema)
      );
      if (!source2) return void 0;
      const securityName = internalIdentifier(`${binding}_${stage2.operation}`);
      if (stage2.operation === "sanitize") {
        setup.push(`const ${securityName} = /*#__PURE__*/ (() => {`);
        setup.push(
          ...sanitizeChainBindings.names.map(
            (bindingName, position) => `  const ${bindingName} = ${String(sanitizeChainBindings.values[position])};`
          )
        );
        setup.push(...indentBlock(`return ${asExpression(source2, "scrub")};`));
        setup.push("})();");
      } else {
        setup.push(`const ${securityName} = ${asExpression(source2, "scrub")};`);
      }
      return securityName;
    };
    let manyIndex = 0;
    const emitManyApplication = (applied, patch3) => {
      const list = `list${manyIndex}`;
      const length = `len${manyIndex}`;
      const out = `out${manyIndex}`;
      const index2 = `i${manyIndex++}`;
      body.push(`const ${list} = value;`);
      body.push(`const ${length} = ${list}.length;`);
      body.push(`const ${out} = new Array(${length});`);
      body.push(`for (let ${index2} = 0; ${index2} < ${length}; ${index2}++) {`);
      body.push(`  ${out}[${index2}] = ${applied}(${list}[${index2}]${patch3 ? `, ${patch3}` : ""});`);
      body.push("}");
      body.push(`value = ${out};`);
    };
    const emitMappedJsonArray2 = (mapper, stringify3) => {
      const list = `mappedList${manyIndex}`;
      const length = `mappedLen${manyIndex}`;
      const item = `mappedItem${manyIndex}`;
      const index2 = `mappedIndex${manyIndex++}`;
      const json3 = `mappedJson${manyIndex}`;
      body.push(`const ${list} = value;`);
      body.push(`const ${length} = ${list}.length;`);
      body.push(`let ${json3} = "[";`);
      body.push(`for (let ${index2} = 0; ${index2} < ${length}; ${index2}++) {`);
      body.push(`  if (${index2} !== 0) ${json3} += ",";`);
      body.push(`  const ${item} = ${mapper}.map(${list}[${index2}]);`);
      body.push(`  ${json3} += ${stringify3}(${item});`);
      body.push("}");
      body.push(`${json3} += "]";`);
      body.push(`value = ${json3};`);
    };
    for (let index2 = 0; index2 < stages.length; index2++) {
      const stage2 = stages[index2];
      switch (stage2.kind) {
        case "value":
        case "to.array":
          break;
        case "json.decode":
          body.push("value = JSON.parse(value);");
          break;
        case "binary.decode": {
          const codec2 = emitComposedCodec(stage2.schema, "binary.decode");
          if (!codec2) return void 0;
          body.push(`value = ${codec2}.decode(value);`);
          break;
        }
        case "validate": {
          if (stage2.operation !== "parse") {
            skipped.push({
              schema: name,
              operation: stage2.operation,
              reason: "only parse validation can continue into a collection execution pipeline"
            });
            return void 0;
          }
          const construct2 = stages[index2 + 1];
          const constructBinding = construct2?.kind === "construct" ? classBindings.get(construct2.target) : void 0;
          if (construct2?.kind === "construct" && !constructBinding) {
            skipped.push({
              schema: name,
              operation: "construct",
              reason: "AOT class construction requires exporting the Runtime Class artifact alongside the execution pipeline"
            });
            return void 0;
          }
          const validator = emitComposedValidator(stage2.schema, constructBinding === void 0);
          if (!validator) return void 0;
          needsValidationError = true;
          if (canUseFastParse(stage2.schema)) {
            body.push(`if (!${validator}.is(value)) {`);
            body.push(`  const result = ${validator}.safeParse(value);`);
            body.push("  if (!result.success) throw new JITValidationError(result.issues);");
            body.push("  value = result.data;");
            body.push("}");
          } else {
            body.push(`const result = ${validator}.safeParse(value);`);
            body.push("if (!result.success) throw new JITValidationError(result.issues);");
            body.push("value = result.data;");
          }
          break;
        }
        case "construct": {
          const classBinding = classBindings.get(stage2.target);
          if (!classBinding) {
            skipped.push({
              schema: name,
              operation: "construct",
              reason: "AOT class construction requires exporting the Runtime Class artifact alongside the execution pipeline"
            });
            return void 0;
          }
          body.push(`value = new ${classBinding}(value, true);`);
          break;
        }
        case "query": {
          let finalStage = stage2;
          while (index2 + 1 < stages.length && stages[index2 + 1]?.kind === "query") {
            index2++;
            finalStage = stages[index2];
          }
          const aggregate = stages[index2 + 1];
          if (aggregate?.kind === "aggregate") {
            index2++;
            finalStage = aggregate;
          }
          const query2 = emitComposedQuery(finalStage);
          if (!query2) return void 0;
          body.push(`value = ${query2}(value);`);
          break;
        }
        case "aggregate": {
          const query2 = emitComposedQuery(stage2);
          if (!query2) return void 0;
          body.push(`value = ${query2}(value);`);
          break;
        }
        case "map": {
          const nextStage = stages[index2 + 1];
          const fuseJsonEncode = nextStage?.kind === "json.encode";
          const mapper = emitComposedMapper(stage2, fuseJsonEncode || !stage2.many ? "map" : "many");
          if (!mapper) return void 0;
          if (fuseJsonEncode) {
            const stringify3 = tryEmit(name, "json.encode", skipped, () => emitSerialize(stage2.target));
            if (!stringify3) return void 0;
            const stringifyName = internalIdentifier(`${binding}_stringify`);
            setup.push(`const ${stringifyName} = ${asExpression(stringify3, "stringify")};`);
            if (stage2.many) emitMappedJsonArray2(mapper, stringifyName);
            else body.push(`value = ${stringifyName}(${mapper}.map(value));`);
            index2++;
          } else {
            body.push(`value = ${mapper}.${stage2.many ? "many" : "map"}(value);`);
          }
          break;
        }
        case "transform": {
          const transform3 = emitComposedTransform(stage2);
          if (!transform3) return void 0;
          if (stage2.many) emitManyApplication(transform3);
          else body.push(`value = ${transform3}(value);`);
          break;
        }
        case "update": {
          const update2 = emitComposedUpdate(stage2);
          if (!update2) return void 0;
          if (stage2.many) emitManyApplication(update2.update, update2.patch);
          else body.push(`value = ${update2.update}(value, ${update2.patch});`);
          break;
        }
        case "security": {
          const security2 = emitComposedSecurity(stage2);
          if (!security2) return void 0;
          if (stage2.many) emitManyApplication(security2);
          else body.push(`value = ${security2}(value);`);
          break;
        }
        case "json.encode": {
          const stringify3 = tryEmit(name, "json.encode", skipped, () => emitSerialize(stage2.schema ?? plan2.schema));
          if (!stringify3) return void 0;
          const stringifyName = internalIdentifier(`${binding}_stringify`);
          setup.push(`const ${stringifyName} = ${asExpression(stringify3, "stringify")};`);
          body.push(`value = ${stringifyName}(value);`);
          break;
        }
        case "binary.encode": {
          const codec2 = emitComposedCodec(stage2.schema, "binary.encode");
          if (!codec2) return void 0;
          body.push(`value = ${codec2}.encode(value);`);
          break;
        }
        case "operation":
          skipped.push({
            schema: name,
            operation: stage2.operation,
            reason: "operation stages cannot follow a collection query"
          });
          return void 0;
      }
    }
    body.push("return value;");
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...setup.map((line) => `  ${line}`));
    js.push("  return (input) => {");
    js.push(...body.map((line) => `    ${line}`));
    js.push("  };");
    js.push("})();");
    return { binding, type };
  }
  function internalIdentifier(preferred) {
    let candidate = preferred;
    let suffix = 1;
    while (publicNames.has(candidate) || internalNames.has(candidate)) candidate = `${preferred}_${suffix++}`;
    internalNames.add(candidate);
    return candidate;
  }
  function classMemberName(name) {
    return isValidIdentifier(name) ? name : `[${JSON.stringify(name)}]`;
  }
  function classUpdateType(schema, seen = /* @__PURE__ */ new Set()) {
    if (seen.has(schema)) return emitTypeScriptType(schema, typeNames);
    const resolved = resolveWrappers(schema);
    const base = resolved.base;
    if (base.type === TypeName.object) {
      seen.add(schema);
      const fields = Object.entries(base.def.props).filter(([, child]) => !resolveWrappers(child).readonly).map(([key, child]) => `${JSON.stringify(key)}?: ${classUpdateType(child, seen)}`);
      seen.delete(schema);
      return fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`;
    }
    if (base.type === TypeName.array) {
      const element = base.def.element;
      return `(${classUpdateType(element, seen)} | undefined)[]`;
    }
    return emitTypeScriptType(schema, typeNames);
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
    if (needsHashCache) helpers.unshift("const __hashCache = new WeakMap();");
  }
  if (needsJsonPatchHelpers) helpers.push(...JSON_PATCH_HELPERS.split("\n"), ...PATCH_EQUAL_HELPER.split("\n"));
  if (needsMockHelpers) helpers.push(...MOCK_HELPERS.split("\n"));
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
  if (needsRuntimeCachedIndex) {
    helpers.push(
      "const __planCache = new WeakMap();",
      "function __cachedIndex(items, cacheKey, build) {",
      "  let plans = __planCache.get(items);",
      "  if (plans === undefined) { plans = new Map(); __planCache.set(items, plans); }",
      "  const cached = plans.get(cacheKey);",
      "  if (cached !== undefined) return cached;",
      "  const built = build(items);",
      "  plans.set(cacheKey, built);",
      "  return built;",
      "}"
    );
  }
  const preludeIndex = ts ? 2 : 1;
  if (helpers.length > 0) js.splice(preludeIndex, 0, ...helpers);
  if (ts && tsTypes.length > 0) js.splice(preludeIndex, 0, ...tsTypes, "");
  if (ts && needsAggregateType) {
    js.splice(
      preludeIndex,
      0,
      "declare class __JitAggregate<TPatch> {",
      "  protected raise(event: unknown): void;",
      "  protected update(patch: TPatch): void;",
      "  peekEvents(): readonly unknown[];",
      "  pullEvents(): unknown[];",
      "  commit(publisher: { publish(event: unknown): void | Promise<void> }): Promise<void>;",
      "}"
    );
  }
  if (ts && needsCallHelper) js.splice(preludeIndex, 0, CALL_HELPER);
  const source = exportNames.length > 0 ? `${js.join("\n")}
export { ${exportNames.join(", ")} };
` : `${js.join("\n")}
export {};
`;
  return {
    name: plan.name,
    source,
    exports: exportNames,
    types: ts ? typeExports : [],
    skipped
  };
}
function moduleNameFromSource(sourceFile) {
  const rawName = basename(sourceFile).replace(/\.jit\.(ts|mts|cts|js|mjs|cjs)$/, "").replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "");
  const normalized = rawName.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "schema";
}
function uniqueModuleName(preferred, used) {
  let candidate = preferred;
  let suffix = 1;
  while (used.has(candidate) || candidate === "index") candidate = `${preferred}-${++suffix}`;
  used.add(candidate);
  return candidate;
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
function inlineBindings(names, values) {
  const lines = [];
  for (let index2 = 0; index2 < names.length; index2++) {
    const value = values[index2];
    const literal4 = serializeBindingValue(value);
    if (literal4 === void 0) return void 0;
    lines.push(`const ${names[index2]} = ${literal4};`);
  }
  return lines;
}
function inlineCodecBindings(names, values) {
  const lines = [];
  for (let index2 = 0; index2 < names.length; index2++) {
    const name = names[index2];
    const value = values[index2];
    if (name === "__enc") {
      lines.push("const __enc = new TextEncoder();");
      continue;
    }
    if (name === "__dec") {
      lines.push("const __dec = new TextDecoder();");
      continue;
    }
    const literal4 = serializeBindingValue(value);
    if (literal4 === void 0) return void 0;
    lines.push(`const ${name} = ${literal4};`);
  }
  return lines;
}
function serializeBindingValue(value) {
  if (value instanceof RegExp) return String(value);
  if (typeof value === "function") return serializeCallback(value);
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
function serializeStaticData(value, seen = /* @__PURE__ */ new Set()) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "undefined":
      return "undefined";
    case "bigint":
      return `${value}n`;
    case "number":
      if (Number.isNaN(value)) return "NaN";
      if (value === Infinity) return "Infinity";
      if (value === -Infinity) return "-Infinity";
      if (Object.is(value, -0)) return "-0";
      return String(value);
    case "object":
      break;
    default:
      return void 0;
  }
  if (seen.has(value)) return void 0;
  seen.add(value);
  try {
    if (value instanceof Date) {
      const time2 = value.getTime();
      return Number.isNaN(time2) ? "new Date(NaN)" : `new Date(${time2})`;
    }
    if (Array.isArray(value)) {
      const items = value.map((item) => serializeStaticData(item, seen));
      if (items.some((item) => item === void 0)) return void 0;
      return `[${items.join(", ")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return void 0;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = [];
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (descriptor === void 0 || !("value" in descriptor)) return void 0;
      const entry = serializeStaticData(descriptor.value, seen);
      if (entry === void 0) return void 0;
      entries.push(`${JSON.stringify(key)}: ${entry}`);
    }
    return `{ ${entries.join(", ")} }`;
  } finally {
    seen.delete(value);
  }
}
function isComposedExecutionStage(stage2) {
  return stage2.kind === "query" || stage2.kind === "aggregate" || stage2.kind === "map" || stage2.kind === "transform" || stage2.kind === "update" || stage2.kind === "security";
}
var OPERATION_ENTRY = {
  clone: "clone",
  diff: "diff",
  stringify: "stringify",
  format: "format",
  // mask and sanitize share one emitter, whose entry point is `scrub`.
  mask: "scrub"
};
function asExpression(source, entry) {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith("function ")) return `(${source})`;
  const declarations = trimmed.match(/^function /gm)?.length ?? 0;
  if (declarations <= 1) return `(${source})`;
  return `/*#__PURE__*/ (() => {
${source}
return ${entry};
})()`;
}
function resolveOutputLayout(format3) {
  return { format: format3, extension: format3 === "ts" ? ".ts" : ".js" };
}
function assertOutputFormat(value) {
  if (value === "ts" || value === "js") return value;
  throw new Error(`unknown AOT output format ${JSON.stringify(value)}; expected "ts" or "js"`);
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
  let entries;
  try {
    entries = readdirSync(
      /* turbopackIgnore: true */
      dir
    );
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(
      /* turbopackIgnore: true */
      dir,
      entry
    );
    if (entry === "plans") {
      rmSync(path, { recursive: true, force: true });
      continue;
    }
    if (entry === "manifest.json" || entry === "package.json") {
      if (isGeneratedJson(path)) rmSync(path, { force: true });
      continue;
    }
    if (!/\.(?:m|c)?[jt]s$/.test(entry)) continue;
    if (isGeneratedSource(path)) rmSync(path, { force: true });
  }
}
function isGeneratedSource(path) {
  try {
    return readFileSync(path, "utf8").startsWith(GENERATED_BANNER);
  } catch {
    return false;
  }
}
function isGeneratedJson(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed.version === 2 || parsed.version === "0.0.0" || parsed.sideEffects === false;
  } catch {
    return false;
  }
}

// ../../packages/jit/src/core/host.ts
var AOT_ARTIFACT = /* @__PURE__ */ Symbol.for("@jit/aot-artifact");

// ../../packages/jit/src/factories/index.ts
var factories_exports = {};
__export(factories_exports, {
  KeyedWatchedList: () => KeyedWatchedList,
  WatchedList: () => WatchedList,
  access: () => access,
  any: () => any,
  array: () => array,
  bigint: () => bigint2,
  binary: () => binary2,
  boolean: () => boolean2,
  brand: () => brand2,
  cacheKey: () => cacheKey,
  canonical: () => canonical,
  class: () => classType,
  clone: () => clone,
  codec: () => codec,
  coerce: () => coerce2,
  compare: () => compare2,
  cqrs: () => cqrs,
  csv: () => csv,
  custom: () => custom,
  date: () => date2,
  ddd: () => ddd,
  default: () => defaultTo2,
  discriminatedUnion: () => discriminatedUnion,
  dto: () => dto,
  enum: () => nativeEnum,
  file: () => file,
  format: () => format,
  from: () => from,
  function: () => functionSchema,
  index: () => index,
  instanceOf: () => instanceOf,
  int: () => int,
  intersection: () => intersection,
  iso: () => iso,
  json: () => json,
  jsonSchema: () => jsonSchema,
  lazy: () => lazy,
  literal: () => literal3,
  lookup: () => lookup,
  map: () => map2,
  mapSchema: () => map,
  match: () => match,
  migrate: () => migrate,
  mock: () => mock,
  nan: () => nan,
  ndjson: () => ndjson,
  never: () => never,
  not: () => not2,
  null: () => nullType,
  nullable: () => nullable2,
  nullish: () => nullish2,
  number: () => number2,
  object: () => object,
  ops: () => ops,
  optional: () => optional2,
  patch: () => patch,
  pipe: () => pipe2,
  process: () => process,
  project: () => project,
  promise: () => promise2,
  readonly: () => readonly2,
  reconcile: () => reconcile,
  record: () => record,
  refine: () => refine2,
  regex: () => regex,
  regexes: () => regexes_exports,
  rules: () => rules,
  security: () => security,
  set: () => set,
  sort: () => sort,
  stream: () => stream,
  string: () => string,
  symbol: () => symbol,
  templateLiteral: () => templateLiteral,
  templateLiterals: () => templateLiteral,
  temporal: () => temporal,
  transform: () => transform2,
  tuple: () => tuple,
  undefined: () => undefinedType,
  union: () => union2,
  unknown: () => unknown,
  update: () => update,
  validate: () => validate,
  void: () => voidType,
  watch: () => watch,
  watchedList: () => watchedList,
  xor: () => xor
});

// ../../packages/jit/src/factories/json-schema.ts
var jsonSchema = Object.freeze({
  to(schema, options) {
    return compileJsonSchema(unwrapSchema(schema), options);
  },
  from(document, options) {
    return createBuilder(compileSchemaFromJson(document, options));
  }
});

// ../../packages/jit/src/factories/access.ts
function access(schema) {
  return createPlan(unwrapSchema(schema), void 0, []);
}
function createPlan(subject, actor, rules2) {
  const descriptor = resolveAccessDescriptor(subject, actor, rules2);
  const compiled = compileAccess(descriptor);
  const plan = ((actorValue) => {
    const ability = compiled(actorValue);
    registerAccessAbility(ability, descriptor, actorValue);
    return ability;
  });
  const add = (effect) => (action, rule) => createPlan(subject, actor, [...rules2, toRule(effect, action, rule)]);
  Object.defineProperties(plan, {
    actor: { value: (next) => createPlan(subject, unwrapSchema(next), rules2) },
    can: { value: add("can") },
    cannot: { value: add("cannot") },
    actions: { value: descriptor.actions },
    fields: { value: (action) => unconditionalFields(descriptor, action) }
  });
  registerArtifact(plan, { kind: "access-plan", schema: subject, descriptor });
  return plan;
}
function toRule(effect, action, rule) {
  if (rule === void 0) return { effect, action };
  if (typeof rule === "function") {
    return {
      effect,
      action,
      condition: rule(CONDITION, ACTOR)
    };
  }
  const options = rule;
  return {
    effect,
    action,
    fields: options.fields,
    metadata: options.id === void 0 && options.reason === void 0 ? void 0 : Object.freeze({
      ...options.id === void 0 ? {} : { id: options.id },
      ...options.reason === void 0 ? {} : { reason: options.reason }
    }),
    condition: options.when === void 0 ? void 0 : options.when(CONDITION, ACTOR)
  };
}
var CONDITION = Object.freeze({
  ...Object.fromEntries(
    ["eq", "neq", "gt", "gte", "lt", "lte"].map((op) => [
      op,
      (key, value) => ({
        kind: "compare",
        op,
        left: { kind: "field", key },
        right: isActorRef(value) ? value : { kind: "literal", value }
      })
    ])
  ),
  and: (...nodes) => fold("and", nodes),
  or: (...nodes) => fold("or", nodes),
  not: (inner) => ({ kind: "not", inner })
});
var ACTOR = Object.freeze({
  field: (key) => ({ kind: "param", name: key })
});
function isActorRef(value) {
  return typeof value === "object" && value !== null && value.kind === "param";
}
function fold(op, nodes) {
  return nodes.reduce((left, right) => ({ kind: "logical", op, left, right }));
}

// ../../packages/jit/src/factories/cache-key.ts
var HASH_HELPERS = Object.freeze({
  __combineHash: combineHash,
  __hashNumber: hashNumber,
  __hashString: hashString,
  __hashBoolean: hashBoolean,
  __hashBigInt: hashBigInt,
  __hashUnknown: hashUnknown
});
var cacheKey = Object.assign(
  (schema) => builder(schema, "string"),
  {
    string: (schema) => builder(schema, "string"),
    hash: (schema) => builder(schema, "hash")
  }
);
function builder(schema, form) {
  const unwrapped = unwrapSchema(schema);
  return Object.freeze({
    select: (...paths) => compileCacheKey(unwrapped, resolveCacheKeyDescriptor(unwrapped, paths, form), HASH_HELPERS)
  });
}

// ../../packages/jit/src/factories/canonical.ts
function canonical(schema) {
  return compileCanonical(unwrapSchema(schema));
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

// ../../packages/jit/src/compiler/json-parse.ts
function compileJsonParse(schema) {
  warmJsonParseShape(schema);
  return JSON.parse;
}
function warmJsonParseShape(schema) {
  const sample = jsonWarmupSample(schema);
  if (sample === void 0) return false;
  JSON.parse(sample);
  JSON.parse(sample);
  return true;
}
function jsonWarmupSample(schema) {
  const value = emitWarmupValue(schema, /* @__PURE__ */ new Set(), 0);
  if (value === void 0) return void 0;
  if (rootIsArray(schema)) {
    const element = rootArrayElement(schema);
    const item = element ? emitWarmupValue(element, /* @__PURE__ */ new Set(), 1) : void 0;
    if (item !== void 0) return `[${item},${item}]`;
  }
  return value;
}
function emitWarmupValue(schema, seen, depth) {
  if (depth > 12 || seen.has(schema)) return "null";
  seen.add(schema);
  const current = schema;
  let output;
  switch (current.type) {
    case TypeName.string:
      output = '""';
      break;
    case TypeName.number:
    case TypeName.int:
    case TypeName.bigint:
    case TypeName.nan:
      output = "0";
      break;
    case TypeName.boolean:
      output = "false";
      break;
    case TypeName.null:
    case TypeName.undefined:
    case TypeName.void:
    case TypeName.never:
    case TypeName.unknown:
    case TypeName.any:
    case TypeName.json:
      output = "null";
      break;
    case TypeName.literal:
      output = jsonPrimitive(current.def.value);
      break;
    case TypeName.enum: {
      const values = Object.values(current.def.values);
      output = values.map(jsonPrimitive).find((value) => value !== void 0) ?? "null";
      break;
    }
    case TypeName.array: {
      const item = emitWarmupValue(current.def.element, seen, depth + 1);
      output = item === void 0 ? "[]" : `[${item},${item}]`;
      break;
    }
    case TypeName.tuple: {
      const items = current.def.items ?? [];
      output = `[${items.map((item) => emitWarmupValue(item, seen, depth + 1) ?? "null").join(",")}]`;
      break;
    }
    case TypeName.object: {
      const props = current.def.props;
      const entries = Object.keys(props).map((key) => {
        const value = emitWarmupValue(props[key], seen, depth + 1) ?? "null";
        return `${JSON.stringify(key)}:${value}`;
      });
      output = `{${entries.join(",")}}`;
      break;
    }
    case TypeName.record:
    case TypeName.map:
      output = "{}";
      break;
    case TypeName.set:
      output = "[]";
      break;
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion:
    case TypeName.intersection: {
      const options = current.def.options ?? [];
      output = options.length === 0 ? "null" : emitWarmupValue(options[0], seen, depth + 1);
      break;
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
    case TypeName.not:
      output = emitWarmupValue(current.def.innerType, seen, depth + 1);
      break;
    case TypeName.lazy:
      output = emitWarmupValue(current.def.getter(), seen, depth + 1);
      break;
    case TypeName.when:
      output = emitWarmupValue(current.def.thenType, seen, depth + 1);
      break;
    case TypeName.codec:
      output = emitWarmupValue(current.def.input, seen, depth + 1);
      break;
    default:
      output = "null";
  }
  seen.delete(schema);
  return output;
}
function jsonPrimitive(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return void 0;
}
function rootIsArray(schema, seen = /* @__PURE__ */ new Set()) {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const current = schema;
  if (current.type === TypeName.array) return true;
  const inner = wrapperInner(current);
  return inner === void 0 ? false : rootIsArray(inner, seen);
}
function rootArrayElement(schema, seen = /* @__PURE__ */ new Set()) {
  if (seen.has(schema)) return void 0;
  seen.add(schema);
  const current = schema;
  if (current.type === TypeName.array) return current.def.element;
  const inner = wrapperInner(current);
  return inner === void 0 ? void 0 : rootArrayElement(inner, seen);
}
function wrapperInner(schema) {
  switch (schema.type) {
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
    case TypeName.not:
      return schema.def.innerType;
    case TypeName.lazy:
      return schema.def.getter();
    default:
      return void 0;
  }
}

// ../../packages/jit/src/compiler/execution-lower.ts
function emitExecutionPlan(plan) {
  const optimized = optimizeExecutionPlan(plan);
  const setup = [];
  const body = ["let value = input;"];
  const bindingNames = [];
  const bindingValues = [];
  let helperIndex = 0;
  let valueIndex = 0;
  const bind = (value) => {
    const name = `__e${bindingNames.length}`;
    bindingNames.push(name);
    bindingValues.push(value);
    return name;
  };
  const helper = (prefix) => `__${prefix}${helperIndex++}`;
  const emitBoundBlock = (prefix, localNames, values, source, expression = false) => {
    const name = helper(prefix);
    const args = values.map(bind);
    setup.push(`const ${name} = ((${localNames.join(", ")}) => {`);
    if (expression) setup.push(...indent(`return (${source});`));
    else setup.push(...indent(source));
    setup.push(`})(${args.join(", ")});`);
    return name;
  };
  const emitMany = (helperName4, patchName) => {
    const list = `__list${valueIndex}`;
    const length = `__len${valueIndex}`;
    const out = `__out${valueIndex}`;
    const index2 = `__i${valueIndex++}`;
    body.push(`const ${list} = value;`);
    body.push(`const ${length} = ${list}.length;`);
    body.push(`const ${out} = new Array(${length});`);
    body.push(`for (let ${index2} = 0; ${index2} < ${length}; ${index2}++) {`);
    body.push(`  ${out}[${index2}] = ${helperName4}(${list}[${index2}]${patchName ? `, ${patchName}` : ""});`);
    body.push("}");
    body.push(`value = ${out};`);
  };
  const stages = optimized.stages;
  for (let index2 = 0; index2 < stages.length; index2++) {
    const stage2 = stages[index2];
    switch (stage2.kind) {
      case "value":
      case "to.array":
        break;
      case "json.decode":
        body.push("value = JSON.parse(value);");
        break;
      case "binary.decode": {
        const codec2 = emitCodec(stage2.schema);
        const codecName = emitBoundBlock("codec", codec2.bindingNames, codec2.bindingValues, codec2.source);
        body.push(`value = ${codecName}.decode(value);`);
        break;
      }
      case "validate": {
        const nextStage = stages[index2 + 1];
        const constructNext = nextStage?.kind === "construct";
        const constructArtifact = constructNext ? getArtifact(nextStage.target) : void 0;
        const strictDomainEvent = constructArtifact?.kind === "class" && constructArtifact.domainEvent !== void 0;
        const fastParse = stage2.operation === "parse" && canUseFastParse(stage2.schema);
        const validator = emitValidator(stage2.schema, {
          is: stage2.operation === "is" || fastParse,
          safeParse: stage2.operation === "parse" || stage2.operation === "safeParse" || stage2.operation === "parseAsync" || stage2.operation === "safeParseAsync" || stage2.operation === "issues",
          safeParseAsync: stage2.operation === "parseAsync" || stage2.operation === "safeParseAsync",
          materializeRuntimeTypes: !constructNext,
          resolveDefaults: !strictDomainEvent
        });
        const validatorName = emitBoundBlock(
          "validator",
          validator.bindings.names,
          validator.bindings.values,
          validator.source
        );
        switch (stage2.operation) {
          case "is":
            body.push(`value = ${validatorName}.is(value);`);
            break;
          case "parse": {
            const error = bind(JITValidationError);
            if (fastParse) {
              const result = `__result${valueIndex++}`;
              body.push(`if (!${validatorName}.is(value)) {`);
              body.push(`  const ${result} = ${validatorName}.safeParse(value);`);
              body.push(`  if (!${result}.success) throw new ${error}(${result}.issues);`);
              body.push(`  value = ${result}.data;`);
              body.push("}");
            } else {
              const result = `__result${valueIndex++}`;
              body.push(`const ${result} = ${validatorName}.safeParse(value);`);
              body.push(`if (!${result}.success) throw new ${error}(${result}.issues);`);
              body.push(`value = ${result}.data;`);
            }
            break;
          }
          case "safeParse":
            body.push(`value = ${validatorName}.safeParse(value);`);
            break;
          case "parseAsync": {
            const error = bind(JITValidationError);
            body.push(
              `return ${validatorName}.safeParseAsync(value).then((result) => { if (!result.success) throw new ${error}(result.issues); return result.data; });`
            );
            break;
          }
          case "safeParseAsync":
            body.push(`return ${validatorName}.safeParseAsync(value);`);
            break;
          case "issues": {
            const result = `__result${valueIndex++}`;
            body.push(`const ${result} = ${validatorName}.safeParse(value);`);
            body.push(`return (function* issues() { if (!${result}.success) yield* ${result}.issues; })();`);
            break;
          }
        }
        break;
      }
      case "construct": {
        const target = bind(stage2.target);
        body.push(`value = new ${target}(value, true);`);
        break;
      }
      case "query": {
        let finalStage = stage2;
        while (index2 + 1 < stages.length && stages[index2 + 1]?.kind === "query") {
          index2++;
          finalStage = stages[index2];
        }
        const aggregate = stages[index2 + 1];
        if (aggregate?.kind === "aggregate") {
          index2++;
          finalStage = aggregate;
        }
        const queryName = emitBoundBlock(
          "query",
          finalStage.program.bindings.map((_, bindingIndex) => `__q${bindingIndex}`),
          finalStage.program.bindings,
          emitQuerySource(finalStage.source, finalStage.program),
          true
        );
        body.push(`value = ${queryName}(value);`);
        break;
      }
      case "aggregate": {
        const queryName = emitBoundBlock(
          "query",
          stage2.program.bindings.map((_, bindingIndex) => `__q${bindingIndex}`),
          stage2.program.bindings,
          emitQuerySource(stage2.source, stage2.program),
          true
        );
        body.push(`value = ${queryName}(value);`);
        break;
      }
      case "map": {
        const mapping = stage2.bindings[0];
        const nextStage = stages[index2 + 1];
        const fuseJsonEncode = nextStage?.kind === "json.encode";
        if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
          throw new JITError("INVALID_OPERATION", "mapping descriptor is malformed");
        }
        const mapperPlan = buildMapperPlan(stage2.source, stage2.target, mapping);
        const mapperName = emitBoundBlock(
          "mapper",
          mapperPlan.bindingNames,
          mapperPlan.bindings,
          emitMapperSource(stage2.source, stage2.target, mapping, [
            fuseJsonEncode || !stage2.many ? "map" : "many"
          ]),
          true
        );
        if (fuseJsonEncode) {
          const stringifyName = helper("stringify");
          setup.push(`const ${stringifyName} = ${emitSerialize(stage2.target)};`);
          if (stage2.many) emitMappedJsonArray(mapperName, stringifyName, body, valueIndex++);
          else body.push(`value = ${stringifyName}(${mapperName}.map(value));`);
          index2++;
        } else {
          body.push(`value = ${mapperName}.${stage2.many ? "many" : "map"}(value);`);
        }
        break;
      }
      case "transform": {
        const keys = Object.keys(stage2.transforms);
        const callbacks = keys.map((key) => stage2.transforms[key]);
        const transformName = emitBoundBlock(
          "transform",
          keys.map((_, transformIndex) => `__t${transformIndex}`),
          callbacks,
          emitTransformSource(stage2.source, stage2.transforms),
          true
        );
        if (stage2.many) emitMany(transformName);
        else body.push(`value = ${transformName}(value);`);
        break;
      }
      case "update": {
        const updateName = helper("update");
        const patchName = bind(stage2.patch);
        setup.push(`const ${updateName} = (${emitUpdateSource(stage2.schema)});`);
        if (stage2.many) emitMany(updateName, patchName);
        else body.push(`value = ${updateName}(value, ${patchName});`);
        break;
      }
      case "security": {
        const source = stage2.operation === "mask" ? emitMaskSource(stage2.schema).replace("function scrub", "function mask") : emitSanitizeSource(stage2.schema).replace("function scrub", "function sanitize");
        const securityName = stage2.operation === "sanitize" ? emitBoundBlock("sanitize", sanitizeChainBindings.names, sanitizeChainBindings.values, source, true) : (() => {
          const name = helper("mask");
          setup.push(`const ${name} = (${source});`);
          return name;
        })();
        if (stage2.many) emitMany(securityName);
        else body.push(`value = ${securityName}(value);`);
        break;
      }
      case "json.encode": {
        if (stage2.mode === "chunks") {
          const chunksName = helper("stringifyChunks");
          setup.push(
            `const ${chunksName} = ${emitStringifyChunksSource(stage2.schema ?? optimized.schema, {
              ...stage2.chunkBytes === void 0 ? {} : { chunkBytes: stage2.chunkBytes }
            })};`
          );
          body.push(`value = ${chunksName}(value);`);
          break;
        }
        const stringifyName = helper("stringify");
        setup.push(`const ${stringifyName} = ${emitSerialize(stage2.schema ?? optimized.schema)};`);
        body.push(`value = ${stringifyName}(value);`);
        break;
      }
      case "binary.encode": {
        const codec2 = emitCodec(stage2.schema);
        const codecName = emitBoundBlock("codec", codec2.bindingNames, codec2.bindingValues, codec2.source);
        body.push(`value = ${codecName}.encode(value);`);
        break;
      }
      case "operation":
        throw new JITError("INVALID_OPERATION", `operation ${stage2.operation} requires its dedicated runtime lowering`);
    }
  }
  body.push("return value;");
  return {
    source: ['"use strict";', ...setup, "return function execution(input) {", ...indent(body.join("\n")), "}"].join(
      "\n"
    ),
    bindingNames,
    bindingValues
  };
}
function lowerExecutionPlan(plan) {
  const emitted = emitExecutionPlan(plan);
  const compiled = globalThis.Function(
    ...emitted.bindingNames,
    emitted.source
  )(...emitted.bindingValues);
  const json3 = plan.stages.find((stage2) => stage2.kind === "json.decode");
  if (json3?.schema) warmJsonParseShape(json3.schema);
  return compiled;
}
function indent(source) {
  return source.split("\n").map((line) => `  ${line}`);
}
function emitMappedJsonArray(mapper, stringify3, body, index2) {
  const list = `__list${index2}`;
  const length = `__len${index2}`;
  const item = `__item${index2}`;
  const cursor = `__i${index2}`;
  const json3 = `__json${index2}`;
  body.push(`const ${list} = value;`);
  body.push(`const ${length} = ${list}.length;`);
  body.push(`let ${json3} = "[";`);
  body.push(`for (let ${cursor} = 0; ${cursor} < ${length}; ${cursor}++) {`);
  body.push(`  if (${cursor} !== 0) ${json3} += ",";`);
  body.push(`  const ${item} = ${mapper}.map(${list}[${cursor}]);`);
  body.push(`  ${json3} += ${stringify3}(${item});`);
  body.push("}");
  body.push(`${json3} += "]";`);
  body.push(`value = ${json3};`);
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
  for (let index2 = 0; index2 < text.length; index2++) {
    const code = text.charCodeAt(index2);
    if (code === 32 || code === 9 || code === 10 || code === 13) continue;
    gateRef.pending = void 0;
    if (!gate.test(code)) {
      throw new JITValidationError([
        {
          path: "",
          code: "invalid_type",
          expected: gate.expected,
          message: `stream root must be ${gate.expected}`,
          received: JSON.stringify(text[index2])
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
  const validator = compileValidator(element);
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
      const result = validator.safeParse(parsed);
      if (!result.success) {
        throw new JITValidationError(prefixIssues(result.issues, `[${items.length}]`));
      }
      const index2 = items.length;
      items.push(result.data);
      for (const check of checks) {
        if (check.kind === "max" && items.length > check.value) {
          throwStructural(`expected at most ${check.value} items`, "");
        }
      }
      options.onItem?.(result.data, index2);
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
  const validator = compileValidator(schema, options);
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
      return validator.parse(parsed);
    }
  };
}
function createNdjsonStream(schema, options) {
  const validator = compileValidator(schema, options);
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
    const result = validator.safeParse(parsed);
    if (!result.success) {
      throw new JITValidationError(prefixIssues(result.issues, `line ${line}`));
    }
    const index2 = items.length;
    items.push(result.data);
    line++;
    options.onItem?.(result.data, index2);
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

// ../../packages/jit/src/compiler/watch.ts
function compileWatch(schema, options) {
  const program = emitWatchProgram(schema, options);
  const bindingNames = program.bindings.map((_, index2) => `__w${index2}`);
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
  const changedBy = options.fields === void 0 || options.fields.length === 0 ? void 0 : addOptionalBinding(
    bindings,
    compileEqual(buildProjectionTree(target.objectSchema, options.fields, "watch").schema)
  );
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
      writer.line(
        changedBy === void 0 ? "} else if (previousItem !== item) {" : `} else if (previousItem !== item && !${changedBy}(previousItem, item)) {`
      );
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

// ../../packages/jit/src/factories/class.ts
var CLASS_TARGET = /* @__PURE__ */ Symbol("jit.class.target");
function classFactory(schema) {
  return createRuntimeClass(unwrapSchema(schema), false, false, false);
}
function abstractClass(schema) {
  return createRuntimeClass(unwrapSchema(schema), true, false, false);
}
function createRuntimeClass(schema, isAbstract, freezeInstances, aggregate, accessors) {
  const resolved = resolveWrappers(schema).base;
  if (resolved.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "JIT.class() requires an object schema");
  }
  const objectSchema = resolved;
  const properties = Object.keys(objectSchema.def.props);
  const parse3 = compileValidator(schema).parse;
  const hydrateState = compileHydrator(schema);
  const classTarget = emitConstructor(
    properties,
    freezeInstances,
    aggregate,
    parse3,
    accessors
  );
  const installedCapabilities = [];
  const installedCapabilityValues = [];
  let factoryNames = { create: "create", hydrate: "hydrate" };
  function create(input) {
    if (isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot create an instance of an abstract JIT class");
    }
    return new this(input);
  }
  function hydrate(state) {
    if (isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot hydrate an instance of an abstract JIT class");
    }
    return new this(
      hydrateState(state),
      true
    );
  }
  Object.defineProperties(classTarget, {
    [CLASS_TARGET]: { enumerable: false, value: true },
    schema: {
      enumerable: true,
      value: createSchema(TypeName.runtimeType, {
        innerType: schema,
        materialize: classTarget
      })
    },
    create: { configurable: true, enumerable: false, value: create },
    hydrate: { configurable: true, enumerable: false, value: hydrate },
    use: {
      enumerable: false,
      value: (...capabilities) => {
        for (const capability2 of capabilities) {
          capability2.install(classTarget, schema);
          installedCapabilities.push(capability2.kind);
          installedCapabilityValues.push(capability2);
        }
        return classTarget;
      }
    },
    factories: {
      configurable: true,
      enumerable: false,
      value: (options) => {
        const next = {
          create: options.create === void 0 ? factoryNames.create : options.create,
          hydrate: options.hydrate === void 0 ? factoryNames.hydrate : options.hydrate
        };
        installFactory(classTarget, factoryNames.create, next.create, create);
        installFactory(classTarget, factoryNames.hydrate, next.hydrate, hydrate);
        factoryNames = next;
        registerArtifact(classTarget, {
          kind: "class",
          schema,
          abstract: isAbstract,
          frozen: freezeInstances,
          aggregate,
          capabilities: installedCapabilities,
          factories: factoryNames,
          accessors
        });
        return classTarget;
      }
    },
    accessors: {
      enumerable: false,
      value: (options) => {
        const next = createRuntimeClass(
          schema,
          isAbstract,
          freezeInstances,
          aggregate,
          resolveAccessors(properties, options)
        );
        next.use(...installedCapabilityValues);
        return next.factories(factoryNames);
      }
    },
    identity: {
      enumerable: false,
      value: (key) => {
        const identity = classType.identity(key);
        identity.install(classTarget, schema);
        installedCapabilities.push(identity.kind);
        installedCapabilityValues.push(identity);
        registerArtifact(classTarget, {
          kind: "class",
          schema,
          abstract: isAbstract,
          frozen: freezeInstances,
          aggregate,
          capabilities: installedCapabilities,
          factories: factoryNames,
          accessors
        });
        return classTarget;
      }
    }
  });
  registerArtifact(classTarget, {
    kind: "class",
    schema,
    abstract: isAbstract,
    frozen: freezeInstances,
    aggregate,
    capabilities: installedCapabilities,
    factories: factoryNames,
    accessors
  });
  return classTarget;
}
function installFactory(classTarget, previous, next, factory) {
  if (previous !== false && previous !== next) Reflect.deleteProperty(classTarget, previous);
  if (next === false) return;
  if (next === "schema" || next === "use" || next === "factories" || next === "accessors" || next === "identity") {
    throw new JITError("INVALID_OPERATION", `Factory name ${JSON.stringify(next)} is reserved`);
  }
  Object.defineProperty(classTarget, next, { configurable: true, enumerable: false, value: factory });
}
function emitConstructor(properties, freezeInstances, aggregate, parse3, accessors) {
  const accessorByKey = new Map(accessors?.map((accessor) => [accessor.key, accessor]));
  const slots = [];
  const definitions = [];
  let slotIndex = 0;
  const assignments = properties.map((property) => {
    const accessor = accessorByKey.get(property);
    if (accessor?.field !== "private") {
      return `this${emitPropertyAccess("", property)} = state${emitPropertyAccess("", property)};`;
    }
    const slot = `#p${slotIndex++}`;
    slots.push(slot);
    if (accessor.get !== false) definitions.push(`get [${JSON.stringify(accessor.get)}]() { return this.${slot}; }`);
    if (accessor.set !== false)
      definitions.push(`set [${JSON.stringify(accessor.set)}](value) { this.${slot} = value; }`);
    return `this.${slot} = state${emitPropertyAccess("", property)};`;
  });
  const events = aggregate ? ' Object.defineProperty(this, "__jitEvents", { value: [], writable: true });' : "";
  const source = `return class JITRuntimeClass { ${slots.map((slot) => `${slot};`).join(" ")} constructor(input, validated) { const state = validated === true ? input : __parse(input); ${assignments.join(" ")}${events}${freezeInstances ? " Object.freeze(this);" : ""} } ${definitions.join(" ")} };`;
  return globalThis.Function("__parse", source)(parse3);
}
function resolveAccessors(properties, options) {
  return properties.map((key) => {
    const configured = {
      ...options.default,
      ...options.fields?.[key]
    };
    const get = resolveAccessorMember(key, configured.get);
    const set2 = resolveAccessorMember(key, configured.set);
    if (configured.field === "private" && get === false && set2 === false) {
      throw new JITError("INVALID_OPERATION", `Private field ${JSON.stringify(key)} must expose a getter or setter`);
    }
    return { key, field: configured.field ?? "public", get, set: set2 };
  });
}
function resolveAccessorMember(key, member) {
  if (member === void 0) return key;
  if (member === false) return false;
  return typeof member === "string" ? key : member.name ?? key;
}
var classType = Object.assign(classFactory, {
  abstract: abstractClass,
  equals: capability("equals", (prototype, schema) => {
    definePrototype(prototype, "equals", compileEqualMethod(schema));
  }),
  hashCode: capability("hashCode", (prototype, schema) => {
    const hash4 = compileHash(schema);
    definePrototype(prototype, "hashCode", function hashCode() {
      return hash4(this);
    });
  }),
  with: (() => {
    const base = capability("with", (prototype, schema) => {
      const update2 = compileUpdate(schema);
      definePrototype(prototype, "with", function withPatch(patch3) {
        const next = update2(this, patch3);
        return new this.constructor(next);
      });
    });
    return Object.freeze({ ...base, __with: true });
  })(),
  diff: capability("diff", (prototype, schema) => {
    const diff3 = compileDiff(schema);
    definePrototype(prototype, "diff", function diffInstance(other) {
      return diff3(this, other);
    });
  }),
  identity(key) {
    return capability(`identity:${key}`, (prototype, schema) => {
      const base = resolveWrappers(schema).base;
      const props = base.type === TypeName.object ? base.def.props : void 0;
      if (!props || !(key in props)) {
        throw new JITError("INVALID_OPERATION", `Identity key ${JSON.stringify(key)} is not a schema field`);
      }
      definePrototype(prototype, "identity", function identity() {
        return this[key];
      });
      definePrototype(prototype, "sameIdentity", function sameIdentity(other) {
        return typeof other === "object" && other !== null && Object.is(this[key], other[key]);
      });
    });
  }
});
function valueObject(schema) {
  return createRuntimeClass(unwrapSchema(schema), false, true, false).use(classType.equals, classType.hashCode);
}
valueObject.abstract = function abstractValueObject(schema) {
  return createRuntimeClass(unwrapSchema(schema), true, true, false).use(classType.equals, classType.hashCode);
};
function entity(schema, options) {
  return createRuntimeClass(unwrapSchema(schema), true, false, false).use(classType.identity(options.id));
}
function aggregateRoot(schema, options) {
  const unwrapped = unwrapSchema(schema);
  const aggregate = createRuntimeClass(unwrapped, true, false, true).use(
    classType.identity(options.id)
  );
  const base = resolveWrappers(unwrapped).base;
  const fields = Object.keys(base.def.props);
  const readonlyFields = fields.filter((field) => resolveWrappers(base.def.props[field]).readonly);
  const updateBindings = /* @__PURE__ */ new Map();
  const updateNames = [];
  const updateValues = [];
  for (let index2 = 0; index2 < fields.length; index2++) {
    const field = fields[index2];
    if (readonlyFields.includes(field)) continue;
    if (isPrimitiveLikeSchema(resolveWrappers(base.def.props[field]).base)) {
      updateBindings.set(field, null);
      continue;
    }
    const name = `__update${index2}`;
    updateBindings.set(field, name);
    updateNames.push(name);
    updateValues.push(compileUpdate(base.def.props[field]));
  }
  let updatedAt;
  let deletedAt;
  let version;
  const installMutation = () => {
    const mutation = buildMutationPlan({
      fields,
      readonlyFields,
      ...updatedAt === void 0 ? {} : { updatedAt },
      ...version === void 0 ? {} : { version }
    });
    const assign = globalThis.Function(
      ...updateNames,
      `return function update(patch) { ${emitMutationPlanBody(mutation, updateBindings)} };`
    )(...updateValues);
    Object.defineProperty(aggregate.prototype, "update", {
      configurable: true,
      enumerable: false,
      value: assign
    });
  };
  installMutation();
  Object.defineProperty(aggregate, "timestamps", {
    configurable: false,
    enumerable: false,
    value: (timestamp) => {
      const field = timestamp.updatedAt;
      const schemaForField = base.def.props[field];
      if (!schemaForField || resolveWrappers(schemaForField).base.type !== TypeName.date) {
        throw new JITError("INVALID_OPERATION", `Timestamp field ${JSON.stringify(field)} must be a Date schema`);
      }
      if (timestamp.touch !== void 0 && timestamp.touch !== "mutation" && timestamp.touch !== "manual") {
        throw new JITError("INVALID_OPERATION", "Timestamp touch must be mutation or manual");
      }
      updatedAt = timestamp.touch === "manual" ? void 0 : field;
      installMutation();
      setClassMutationArtifact(aggregate, {
        ...updatedAt === void 0 ? {} : { updatedAt },
        ...deletedAt === void 0 ? {} : { deletedAt },
        ...version === void 0 ? {} : { version }
      });
      return aggregate;
    }
  });
  Object.defineProperty(aggregate, "softDelete", {
    configurable: false,
    enumerable: false,
    value: (options2) => {
      const field = options2.field;
      const schemaForField = base.def.props[field];
      const resolved = schemaForField && resolveWrappers(schemaForField);
      if (!resolved || resolved.base.type !== TypeName.date || !resolved.nullable) {
        throw new JITError(
          "INVALID_OPERATION",
          `Soft-delete field ${JSON.stringify(field)} must be a nullable Date schema`
        );
      }
      deletedAt = field;
      definePrototype(aggregate.prototype, "softDelete", function softDelete() {
        const now = /* @__PURE__ */ new Date();
        this[field] = now;
        if (updatedAt !== void 0) this[updatedAt] = now;
      });
      definePrototype(aggregate.prototype, "restore", function restore() {
        this[field] = null;
        if (updatedAt !== void 0) this[updatedAt] = /* @__PURE__ */ new Date();
      });
      Object.defineProperty(aggregate.prototype, "isDeleted", {
        configurable: false,
        enumerable: false,
        get() {
          return this[field] !== null;
        }
      });
      setClassMutationArtifact(aggregate, {
        ...updatedAt === void 0 ? {} : { updatedAt },
        deletedAt,
        ...version === void 0 ? {} : { version }
      });
      return aggregate;
    }
  });
  Object.defineProperty(aggregate, "versioned", {
    configurable: false,
    enumerable: false,
    value: (options2) => {
      const field = options2.field;
      const schemaForField = base.def.props[field];
      const type = schemaForField && resolveWrappers(schemaForField).base.type;
      if (type !== TypeName.int && type !== TypeName.number) {
        throw new JITError(
          "INVALID_OPERATION",
          `Version field ${JSON.stringify(field)} must be a number or int schema`
        );
      }
      version = field;
      installMutation();
      setClassMutationArtifact(aggregate, {
        ...updatedAt === void 0 ? {} : { updatedAt },
        ...deletedAt === void 0 ? {} : { deletedAt },
        version
      });
      return aggregate;
    }
  });
  definePrototype(aggregate.prototype, "raise", function raise(event) {
    this.__jitEvents[this.__jitEvents.length] = event;
  });
  definePrototype(aggregate.prototype, "peekEvents", function peekEvents() {
    return this.__jitEvents.slice();
  });
  definePrototype(aggregate.prototype, "pullEvents", function pullEvents() {
    const events = this.__jitEvents;
    this.__jitEvents = [];
    return events;
  });
  definePrototype(
    aggregate.prototype,
    "commit",
    async function commit(publisher) {
      const pending = this.__jitEvents;
      for (let index2 = 0; index2 < pending.length; index2++) await publisher.publish(pending[index2]);
      this.__jitEvents.splice(0, pending.length);
    }
  );
  return aggregate;
}
function domainEvent(type, options) {
  const payload = unwrapSchema(options.payload);
  const schema = createDomainEventSchema(payload, type, options.version);
  const event = createRuntimeClass(schema, false, true, false);
  const createState = event.create.bind(event);
  Object.defineProperties(event, {
    create: {
      configurable: false,
      enumerable: false,
      value: (input) => createState({ type, version: options.version, payload: input })
    },
    type: { enumerable: true, value: type },
    version: { enumerable: true, value: options.version }
  });
  Object.defineProperty(event.prototype, "~event", {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ version: 1, type, schemaVersion: options.version }),
    writable: false
  });
  registerArtifact(event, {
    kind: "class",
    schema,
    abstract: false,
    frozen: true,
    aggregate: false,
    capabilities: [],
    factories: { create: "create", hydrate: "hydrate" },
    domainEvent: { type, version: options.version }
  });
  return event;
}
function createDomainEventSchema(payload, type, version) {
  const id = defaultTo(createSchema(TypeName.string, {}), createEventId);
  const occurredAt = defaultTo(createSchema(TypeName.date, { coerce: true }), () => /* @__PURE__ */ new Date());
  return createSchema(TypeName.object, {
    props: {
      id,
      type: createSchema(TypeName.literal, { value: type }),
      version: createSchema(TypeName.literal, { value: version }),
      occurredAt,
      payload
    },
    unknownKeys: void 0,
    catchall: void 0,
    checks: []
  });
}
function createEventId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
function capability(kind, install) {
  return Object.freeze({
    kind,
    install(classTarget, schema) {
      install(classTarget.prototype, schema);
    }
  });
}
function definePrototype(prototype, key, value) {
  Object.defineProperty(prototype, key, { configurable: false, enumerable: false, value, writable: false });
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

// ../../packages/jit/src/factories/composition/composition.ts
function union2(...options) {
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

// ../../packages/jit/src/factories/query.ts
var QUERY_PROGRAMS = /* @__PURE__ */ new WeakMap();
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
  const unwrapped = unwrapSchema(schema);
  expectCollectionObjectSchema(unwrapped, "query");
  return createQueryBuilder(unwrapped, [], [], []);
}
function getQueryProgram(builder2) {
  return QUERY_PROGRAMS.get(builder2);
}
function createBinaryQueryBuilder(target, nodes, bindings, paramNames) {
  let compiled;
  const callable = function binaryQuery(value, params) {
    compiled ??= compileBinaryQuery(target, {
      nodes,
      bindings,
      params: paramNames
    });
    return compiled(value, params);
  };
  const builder2 = Object.assign(callable, {
    params(shape) {
      return createBinaryQueryBuilder(
        target,
        nodes,
        bindings,
        mergeParamNames(paramNames, shape)
      );
    },
    filter(predicate, ruleInputs) {
      const lowered = lowerRulePredicate(predicate, ruleInputs, bindings.length);
      if (lowered !== void 0) {
        return createBinaryQueryBuilder(
          target,
          lowered.condition === void 0 ? nodes : [...nodes, { kind: "filter", condition: lowered.condition }],
          [...bindings, ...lowered.bindings],
          paramNames
        );
      }
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(
        state.builder,
        createParamRefs(paramNames)
      );
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
    }
  });
  registerArtifact(builder2, {
    kind: "query",
    get source() {
      return emitBinaryQuerySource(target.layout, {
        nodes,
        bindings,
        params: paramNames
      });
    },
    get bindingNames() {
      return bindings.map((_, index2) => `__q${index2}`);
    },
    bindingValues: bindings
  });
  return builder2;
}
function createQueryBuilder(schema, nodes, bindings, paramNames) {
  let compiled;
  const lowerEager = () => {
    if (!hasIncrementalNodes2(nodes)) {
      return compileQuery(schema, {
        nodes,
        bindings,
        params: paramNames
      });
    }
    return compileQueryArray(schema, {
      nodes,
      bindings,
      params: paramNames
    });
  };
  const callable = function query2(value, params) {
    compiled ??= lowerEager();
    return compiled(value, params);
  };
  const builder2 = Object.assign(callable, {
    authorize(ability, action, actor) {
      const context = resolveAccessContext(ability, actor);
      if (context === void 0) {
        throw new JITError("INVALID_OPERATION", "query.authorize() requires an ability created by JIT.access()");
      }
      const lowered = lowerAccessToQueryCondition(context, action, bindings.length);
      const safeFields = accessProjectionFields(context.descriptor, action);
      const projection = safeFields === void 0 ? [] : [{ kind: "select:fields", fields: safeFields }];
      if (lowered.kind === "allow") {
        return createQueryBuilder(schema, [...nodes, ...projection], bindings, paramNames);
      }
      const condition = lowered.kind === "deny" ? {
        kind: "compare",
        op: "eq",
        left: { kind: "literal", value: true },
        right: { kind: "literal", value: false }
      } : lowered.condition;
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "filter", condition }, ...projection],
        [...bindings, ...lowered.bindings],
        paramNames
      );
    },
    params(shape) {
      return createQueryBuilder(
        schema,
        nodes,
        bindings,
        mergeParamNames(paramNames, shape)
      );
    },
    filter(predicate, ruleInputs) {
      const lowered = lowerRulePredicate(predicate, ruleInputs, bindings.length);
      if (lowered !== void 0) {
        return createQueryBuilder(
          schema,
          lowered.condition === void 0 ? nodes : [...nodes, { kind: "filter", condition: lowered.condition }],
          [...bindings, ...lowered.bindings],
          paramNames
        );
      }
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
      const prior = nodes.filter((node) => node.kind === "select:fields");
      const selected = prior.length === 0 ? fields : fields.filter((field) => prior.every((node) => node.fields.includes(field)));
      return createQueryBuilder(schema, [...nodes, { kind: "select:fields", fields: selected }], bindings, paramNames);
    },
    unique(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "unique", key }], bindings, paramNames);
    },
    distinct(...fields) {
      return createQueryBuilder(schema, [...nodes, { kind: "distinct", fields }], bindings, paramNames);
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
    update(patch3) {
      const state = createPatchBindings(bindings.length, patch3);
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
    aggregate(spec) {
      const fields = Object.entries(spec).map(([name, field]) => ({
        name,
        op: field.op,
        ...field.key === void 0 ? {} : { key: field.key }
      }));
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "aggregate:composite", fields }],
        bindings,
        paramNames
      );
    },
    first() {
      return createQueryBuilder(schema, [...nodes, { kind: "terminal", op: "first" }], bindings, paramNames);
    },
    findIndex() {
      return createQueryBuilder(schema, [...nodes, { kind: "terminal", op: "findIndex" }], bindings, paramNames);
    },
    some() {
      return createQueryBuilder(schema, [...nodes, { kind: "terminal", op: "some" }], bindings, paramNames);
    },
    every() {
      return createQueryBuilder(schema, [...nodes, { kind: "terminal", op: "every" }], bindings, paramNames);
    },
    to: Object.freeze({
      iterator: () => compileQueryIterator(schema, {
        nodes,
        bindings,
        params: paramNames
      }),
      asyncIterator: () => compileQueryAsyncIterator(schema, {
        nodes,
        bindings,
        params: paramNames
      }),
      visitor: () => compileQueryVisitor(schema, {
        nodes,
        bindings,
        params: paramNames
      })
    }),
    lazy() {
      return createLazyQueryBuilder(schema, nodes, bindings, paramNames);
    },
    explain(outputMode = "eager-array") {
      const plan = explainQueryExecution({ nodes, bindings, params: paramNames }, outputMode);
      if (outputMode !== "eager-array") return plan;
      return Object.freeze({
        ...plan,
        physical: explainPhysicalQuery(schema, {
          nodes,
          bindings,
          params: paramNames
        })
      });
    }
  });
  const program = {
    nodes,
    bindings,
    params: paramNames
  };
  QUERY_PROGRAMS.set(builder2, program);
  registerArtifact(builder2, {
    kind: "query-plan",
    schema,
    program,
    mode: "array"
  });
  return builder2;
}
function createLazyQueryBuilder(schema, nodes, bindings, paramNames) {
  const program = { nodes, bindings, params: paramNames };
  let compiled;
  const callable = function lazyQuery(input, params) {
    compiled ??= compileQueryIterator(schema, program);
    return compiled(input, params);
  };
  const builder2 = Object.assign(callable, {
    to: Object.freeze({
      asyncIterator: () => compileQueryAsyncIterator(schema, program),
      visitor: () => compileQueryVisitor(schema, program)
    }),
    explain: (outputMode = "generator") => explainQueryExecution(program, outputMode)
  });
  registerArtifact(builder2, {
    kind: "query-plan",
    schema,
    program,
    mode: "iterator"
  });
  return builder2;
}
function hasIncrementalNodes2(nodes) {
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
function createPatchBindings(startIndex, patch3) {
  const bindings = [];
  const boundPatch = {};
  for (const key of Object.keys(patch3)) {
    const index2 = startIndex + bindings.length;
    bindings[bindings.length] = patch3[key];
    boundPatch[key] = { kind: "binding", name: `__q${index2}` };
  }
  return { patch: boundPatch, bindings };
}
function createConditionBuilder(startIndex) {
  const bindings = [];
  const toValueNode = (value) => {
    if (isQueryParamRef(value)) return { kind: "param", name: value.name };
    if (isQueryConstRef(value)) return { kind: "literal", value: value.value };
    const index2 = startIndex + bindings.length;
    bindings[bindings.length] = value;
    return { kind: "binding", name: `__q${index2}` };
  };
  const compare3 = (op, key, value) => ({
    kind: "compare",
    op,
    left: { kind: "field", key },
    right: toValueNode(value)
  });
  return {
    bindings,
    builder: {
      constant,
      eq: (key, value) => compare3("eq", key, value),
      neq: (key, value) => compare3("neq", key, value),
      gt: (key, value) => compare3("gt", key, value),
      gte: (key, value) => compare3("gte", key, value),
      lt: (key, value) => compare3("lt", key, value),
      lte: (key, value) => compare3("lte", key, value),
      and: (left, right, ...rest) => fold2("and", left, right, rest),
      or: (left, right, ...rest) => fold2("or", left, right, rest),
      not: (inner) => ({ kind: "not", inner })
    }
  };
}
function fold2(op, left, right, rest) {
  const tail = rest.length === 0 ? right : fold2(op, right, rest[0], rest.slice(1));
  return { kind: "logical", op, left, right: tail };
}
function mergeParamNames(current, shape) {
  const next = [...current];
  const seen = new Set(current);
  for (const name of Object.keys(shape)) {
    if (seen.has(name)) throw new JITError("INVALID_QUERY", `query parameter ${JSON.stringify(name)} is duplicated`);
    seen.add(name);
    next.push(name);
  }
  return next;
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
var IMPOSSIBLE = {
  kind: "compare",
  op: "eq",
  left: { kind: "literal", value: true },
  right: { kind: "literal", value: false }
};
function lowerRulePredicate(predicate, inputs, bindingOffset) {
  if (typeof predicate !== "function") return void 0;
  const artifact = getArtifact(predicate);
  if (artifact?.kind !== "rules-plan" || artifact.sink !== "predicate" || artifact.ruleId === void 0) {
    return void 0;
  }
  const lowered = lowerRuleToQueryCondition(artifact.descriptor, artifact.ruleId, inputs, bindingOffset);
  if (lowered.kind === "always") return { condition: void 0, bindings: lowered.bindings };
  if (lowered.kind === "never") return { condition: IMPOSSIBLE, bindings: lowered.bindings };
  return { condition: lowered.condition, bindings: lowered.bindings };
}

// ../../packages/jit/src/factories/cqrs.ts
function cqrsQuery(schema) {
  if (isBinaryArray(schema) || isBinaryRowSet(schema)) return query(schema);
  const target = unwrapSchema(schema);
  if (target.type === "set" || target.type === "map") {
    return query(target);
  }
  if (target.type !== "array" && target.type !== "object" && target.type !== "runtimeType") {
    throw new JITError(
      "INVALID_QUERY",
      "JIT.cqrs.query() requires an object or Runtime Type, or a collection of either"
    );
  }
  const row = target.type === "array" ? target.def.element : target;
  if (row.type !== "object" && row.type !== "runtimeType") return query(target);
  const collection = target.type === "array" ? target : array(row).schema;
  return wrap(
    row,
    collection,
    query(collection)
  );
}
function wrap(schema, collection, builder2) {
  const program = getQueryProgram(builder2);
  const record2 = builder2;
  const filterMethod = record2.filter;
  const takeMethod = record2.take;
  const chainMethods = [
    "params",
    "authorize",
    "filter",
    "select",
    "unique",
    "distinct",
    "keyed",
    "groupBy",
    "orderBy",
    "flatMap",
    "take",
    "drop",
    "takeWhile",
    "dropWhile",
    "chunk",
    "window",
    "pairwise",
    "scan",
    "groupAdjacentBy",
    "delete",
    "update",
    "sum",
    "count",
    "avg",
    "min",
    "max",
    "aggregate",
    "first",
    "findIndex",
    "some",
    "every"
  ];
  for (const key of chainMethods) {
    const method = record2[key];
    Object.defineProperty(builder2, key, {
      value: (...args) => wrap(schema, collection, method(...args))
    });
  }
  Object.defineProperties(builder2, {
    join: {
      value: (right, kind = "inner") => createJoinOnBuilder(schema, collection, program, right, kind)
    },
    where: {
      value: (...args) => wrap(schema, collection, filterMethod(...args))
    },
    limit: {
      value: (count) => wrap(schema, collection, takeMethod(count))
    },
    "~query": {
      get: () => Object.freeze({
        version: 1,
        definition: toStandardQuery(schema, program)
      })
    }
  });
  if (program)
    registerArtifact(builder2, {
      kind: "query-plan",
      schema: collection,
      program,
      mode: "array",
      standard: builder2["~query"]
    });
  return builder2;
}
function createJoinOnBuilder(leftSchema, leftCollection, program, rightInput, kind) {
  if (!program) throw new JITError("INVALID_QUERY", "join requires a reconstructive query program");
  if (kind !== "inner" && kind !== "left" && kind !== "semi" && kind !== "anti") {
    throw new JITError("INVALID_QUERY", `unsupported join kind ${JSON.stringify(kind)}`);
  }
  const target = unwrapSchema(rightInput);
  const rightSchema = target.type === "array" ? target.def.element : target;
  const rightCollection = target.type === "array" ? target : array(rightSchema).schema;
  return Object.freeze({
    on(leftKey, rightKey) {
      const plan = createJoinPlan(leftCollection, rightCollection, program, kind, leftKey, rightKey);
      let compiled;
      const callable = function join2(left, right, params) {
        compiled ??= compileJoin(plan);
        return compiled(left, right, params);
      };
      const standard = Object.freeze({
        version: 1,
        definition: Object.freeze({
          ...toStandardQuery(leftSchema, program),
          pipeline: Object.freeze([
            ...toStandardQuery(leftSchema, program).pipeline,
            Object.freeze({
              kind: "join",
              join: kind,
              source: Object.freeze({
                kind: "object",
                fields: Object.freeze(objectFields(rightSchema))
              }),
              leftKey,
              rightKey
            })
          ])
        })
      });
      Object.defineProperties(callable, {
        explain: { value: () => explainJoinPlan(plan) },
        "~query": { value: standard }
      });
      registerArtifact(callable, { kind: "join-plan", plan, standard });
      return callable;
    }
  });
}
function toStandardQuery(schema, program) {
  const nodes = program?.nodes ?? [];
  let filter;
  let projection;
  let order;
  let limit;
  for (const node of nodes) {
    if (node.kind === "filter") {
      const condition = toStandardCondition(node.condition, program?.bindings ?? []);
      filter = filter ? Object.freeze({
        kind: "logical",
        operator: "and",
        left: filter,
        right: condition
      }) : condition;
    } else if (node.kind === "select:fields") projection = Object.freeze([...node.fields]);
    else if (node.kind === "orderBy") {
      order = Object.freeze([
        Object.freeze({
          path: Object.freeze([node.key]),
          direction: node.direction
        })
      ]);
    } else if (node.kind === "take") limit = limit === void 0 ? node.count : Math.min(limit, node.count);
  }
  return Object.freeze({
    source: Object.freeze({
      kind: "object",
      fields: Object.freeze(objectFields(schema))
    }),
    pipeline: Object.freeze(nodes.map((node) => toStandardStep(node, program?.bindings ?? []))),
    ...filter ? { filter } : {},
    ...projection ? { projection } : {},
    ...order ? { order } : {},
    ...limit === void 0 ? {} : { limit },
    params: Object.freeze([...program?.params ?? []])
  });
}
function toStandardStep(node, bindings) {
  switch (node.kind) {
    case "filter":
      return Object.freeze({
        kind: "where",
        condition: toStandardCondition(node.condition, bindings)
      });
    case "select:fields":
      return Object.freeze({
        kind: "select",
        fields: Object.freeze([...node.fields])
      });
    case "distinct":
      return Object.freeze({
        kind: "distinct",
        fields: Object.freeze([...node.fields])
      });
    case "orderBy":
      return Object.freeze({
        kind: "orderBy",
        key: node.key,
        direction: node.direction
      });
    case "unique":
    case "keyed":
    case "groupBy":
    case "flatMap":
    case "groupAdjacentBy":
      return Object.freeze({ kind: node.kind, key: node.key });
    case "take":
    case "drop":
      return Object.freeze({ kind: node.kind, count: node.count });
    case "takeWhile":
    case "dropWhile":
      return Object.freeze({
        kind: node.kind,
        condition: toStandardCondition(node.condition, bindings)
      });
    case "chunk":
    case "window":
      return Object.freeze({ kind: node.kind, size: node.size });
    case "pairwise":
    case "delete":
      return Object.freeze({ kind: node.kind });
    case "scan":
      return Object.freeze({
        kind: "scan",
        initial: toStandardValue({ kind: "binding", name: node.initialBinding }, bindings),
        update: Object.freeze({
          kind: "binding",
          name: node.updateBinding
        })
      });
    case "update":
      return Object.freeze({
        kind: "update",
        patch: Object.freeze(
          Object.fromEntries(Object.entries(node.patch).map(([key, value]) => [key, toStandardValue(value, bindings)]))
        )
      });
    case "aggregate":
      return Object.freeze({
        kind: "aggregate",
        operation: node.op,
        ...node.key === void 0 ? {} : { key: node.key }
      });
    case "terminal":
      return Object.freeze({ kind: "terminal", operation: node.op });
    case "aggregate:composite":
      return Object.freeze({
        kind: "aggregate:composite",
        fields: Object.freeze(
          node.fields.map(
            (field) => Object.freeze({
              name: field.name,
              operation: field.op,
              ...field.key === void 0 ? {} : { key: field.key }
            })
          )
        )
      });
  }
}
function objectFields(schema) {
  const object2 = schema.type === "runtimeType" ? schema.def.innerType : schema;
  return object2.type === "object" ? Object.keys(object2.def.props) : [];
}
function isSchemaPath(schema, path) {
  let current = schema;
  for (const key of path.split(".")) {
    if (current.type === "runtimeType") current = current.def.innerType;
    if (current.type !== "object") return false;
    const next = current.def.props[key];
    if (!next) return false;
    current = next;
  }
  return true;
}
function toStandardCondition(condition, bindings) {
  if (condition.kind === "compare") {
    return Object.freeze({
      kind: "compare",
      operator: condition.op,
      left: toStandardValue(condition.left, bindings),
      right: toStandardValue(condition.right, bindings)
    });
  }
  if (condition.kind === "logical") {
    return Object.freeze({
      kind: "logical",
      operator: condition.op,
      left: toStandardCondition(condition.left, bindings),
      right: toStandardCondition(condition.right, bindings)
    });
  }
  return Object.freeze({
    kind: "not",
    inner: toStandardCondition(condition.inner, bindings)
  });
}
function toStandardValue(value, bindings) {
  if (value.kind === "field")
    return Object.freeze({
      kind: "field",
      path: Object.freeze([value.key])
    });
  if (value.kind === "literal") return Object.freeze({ kind: "literal", value: value.value });
  if (value.kind === "binding") {
    const index2 = Number.parseInt(value.name.slice(3), 10);
    if (Number.isSafeInteger(index2) && index2 >= 0 && index2 < bindings.length && isStandardData(bindings[index2])) {
      return Object.freeze({
        kind: "literal",
        value: bindings[index2]
      });
    }
    return Object.freeze({ kind: "binding", name: value.name });
  }
  return Object.freeze({ kind: "param", name: value.name });
}
function isStandardData(value, seen = /* @__PURE__ */ new Set()) {
  if (value === null) return true;
  if (["string", "number", "bigint", "boolean", "undefined"].includes(typeof value)) return true;
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isStandardData(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  return Object.values(value).every((item) => isStandardData(item, seen));
}
function cqrsInput(schema, options) {
  const unwrapped = unwrapSchema(schema);
  if (unwrapped.type !== "object" && unwrapped.type !== "runtimeType") {
    throw new JITError("INVALID_QUERY", "JIT.cqrs.input() requires an object or Runtime Type schema");
  }
  if (options.filter !== void 0 && (options.filter === null || typeof options.filter !== "object" || Array.isArray(options.filter))) {
    throw new JITError("INVALID_QUERY", "CQRS filter configuration must be an object");
  }
  if (options.sort !== void 0 && !Array.isArray(options.sort)) {
    throw new JITError("INVALID_QUERY", "CQRS sort configuration must be an array");
  }
  if (options.select !== void 0 && typeof options.select !== "boolean") {
    throw new JITError("INVALID_QUERY", "CQRS select configuration must be boolean");
  }
  const maxFilters = options.maxFilters ?? 32;
  const fields = new Set(objectFields(unwrapped));
  for (const [field, operators] of Object.entries(options.filter ?? {})) {
    if (!isSchemaPath(unwrapped, field))
      throw new JITError("INVALID_QUERY", `CQRS filter field ${JSON.stringify(field)} is not declared by the model`);
    if (operators !== true && !Array.isArray(operators)) {
      throw new JITError("INVALID_QUERY", `CQRS filter field ${JSON.stringify(field)} has an invalid operator list`);
    }
    if (operators !== true) {
      if (operators.length === 0) {
        throw new JITError("INVALID_QUERY", `CQRS filter field ${JSON.stringify(field)} has an empty operator list`);
      }
      const seen = /* @__PURE__ */ new Set();
      for (const operator of operators) {
        if (typeof operator !== "string" || operator.length === 0 || operator.startsWith("$")) {
          throw new JITError("INVALID_QUERY", `CQRS filter field ${JSON.stringify(field)} has an invalid operator`);
        }
        if (seen.has(operator)) {
          throw new JITError(
            "INVALID_QUERY",
            `CQRS filter field ${JSON.stringify(field)} repeats operator ${JSON.stringify(operator)}`
          );
        }
        seen.add(operator);
      }
    }
  }
  const seenSort = /* @__PURE__ */ new Set();
  for (const field of options.sort ?? []) {
    if (!fields.has(field))
      throw new JITError("INVALID_QUERY", `CQRS sort field ${JSON.stringify(field)} is not declared by the model`);
    if (seenSort.has(field))
      throw new JITError("INVALID_QUERY", `CQRS sort configuration repeats ${JSON.stringify(field)}`);
    seenSort.add(field);
  }
  if (!Number.isSafeInteger(maxFilters) || maxFilters < 0) {
    throw new JITError("INVALID_QUERY", "CQRS maxFilters must be a non-negative safe integer");
  }
  for (const value of [options.limits?.maxConditions, options.limits?.maxSortFields, options.limits?.maxSelectFields]) {
    if (value !== void 0 && (!Number.isSafeInteger(value) || value < 0)) {
      throw new JITError("INVALID_QUERY", "CQRS structural limits must be non-negative safe integers");
    }
  }
  if (options.pagination) {
    const { defaultLimit, maxLimit } = options.pagination;
    if (!Number.isSafeInteger(defaultLimit) || !Number.isSafeInteger(maxLimit) || defaultLimit < 1 || maxLimit < defaultLimit) {
      throw new JITError("INVALID_QUERY", "CQRS pagination requires positive bounded limits");
    }
    if (options.pagination.type === "cursor" && options.pagination.by.length === 0) {
      throw new JITError("INVALID_QUERY", "CQRS cursor pagination requires at least one stable ordering field");
    }
    if (options.pagination.type === "cursor") {
      const seen = /* @__PURE__ */ new Set();
      for (const field of options.pagination.by) {
        if (!fields.has(field))
          throw new JITError(
            "INVALID_QUERY",
            `CQRS cursor field ${JSON.stringify(field)} is not declared by the model`
          );
        if (seen.has(field))
          throw new JITError("INVALID_QUERY", `CQRS cursor ordering repeats ${JSON.stringify(field)}`);
        seen.add(field);
      }
    }
  }
  const frozenFilter = Object.freeze(
    Object.fromEntries(
      Object.entries(options.filter ?? {}).map(([field, allowed]) => [
        field,
        allowed === true ? true : Object.freeze([...allowed])
      ])
    )
  );
  const frozenSort = Object.freeze([...options.sort ?? []]);
  const frozenPagination = options.pagination ? Object.freeze(
    options.pagination.type === "cursor" ? {
      ...options.pagination,
      by: Object.freeze([...options.pagination.by])
    } : { ...options.pagination }
  ) : void 0;
  const frozenLimits = options.limits ? Object.freeze({ ...options.limits }) : void 0;
  const frozenOptions = Object.freeze({
    ...options,
    ...frozenFilter === void 0 ? {} : { filter: frozenFilter },
    ...frozenSort === void 0 ? {} : { sort: frozenSort },
    ...frozenPagination === void 0 ? {} : { pagination: frozenPagination },
    ...frozenLimits === void 0 ? {} : { limits: frozenLimits }
  });
  const definition = Object.freeze({
    source: Object.freeze({
      kind: "object",
      fields: Object.freeze(objectFields(unwrapped))
    }),
    filters: frozenFilter,
    projection: frozenOptions.select === true,
    sorting: frozenSort,
    ...frozenPagination ? {
      pagination: Object.freeze({
        ...frozenPagination,
        ...frozenPagination.type === "cursor" ? { by: Object.freeze([...frozenPagination.by]) } : {}
      })
    } : {},
    limits: Object.freeze({
      maxConditions: frozenOptions.limits?.maxConditions ?? maxFilters,
      maxSortFields: frozenOptions.limits?.maxSortFields ?? 3,
      maxSelectFields: frozenOptions.limits?.maxSelectFields ?? 30
    })
  });
  const input = Object.freeze({
    schema: unwrapped,
    options: frozenOptions,
    "~query": Object.freeze({ version: 1, definition })
  });
  registerArtifact(input, {
    kind: "cqrs-input",
    definition,
    source: emitCqrsAotParserSource(
      Object.entries(frozenOptions.filter ?? {}),
      frozenOptions.maxFilters ?? 32,
      frozenOptions.sort ?? [],
      frozenOptions.pagination,
      frozenOptions.limits?.maxConditions ?? frozenOptions.maxFilters ?? 32,
      frozenOptions.limits?.maxSortFields ?? 3,
      frozenOptions.select ? objectFields(unwrapped) : [],
      frozenOptions.limits?.maxSelectFields ?? 30
    )
  });
  return input;
}
function cqrsParse(definition) {
  const reference = cqrsParseReference(definition);
  const fields = Object.entries(definition.options.filter ?? {});
  const source = emitCqrsInputParser(
    fields,
    definition.options.maxFilters ?? 32,
    definition.options.sort ?? [],
    definition.options.pagination,
    definition.options.limits?.maxConditions ?? definition.options.maxFilters ?? 32,
    definition.options.limits?.maxSortFields ?? 3,
    definition.options.select ? objectFields(definition.schema) : [],
    definition.options.limits?.maxSelectFields ?? 30
  );
  const parser = globalThis.Function("__reference", "__decodeCursor", source)(reference, decodeCqrsCursor);
  const artifact = getArtifact(definition);
  if (artifact?.kind === "cqrs-input") {
    registerArtifact(parser, {
      kind: "cqrs-parser",
      definition: artifact.definition,
      source: artifact.source
    });
  }
  return parser;
}
function cqrsParseReference(definition) {
  return (input) => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new JITError("INVALID_QUERY", "CQRS input must be an object");
    }
    const source = input;
    const allowedInputKeys = /* @__PURE__ */ new Set([
      "filter",
      "fields",
      "sort",
      ...definition.options.pagination?.type === "offset" ? ["page", "limit"] : [],
      ...definition.options.pagination?.type === "cursor" ? ["after", "before", "limit"] : []
    ]);
    for (const key of Object.keys(source)) {
      if (!allowedInputKeys.has(key)) {
        throw new JITError("INVALID_QUERY", `CQRS input field ${JSON.stringify(key)} is not allowed`);
      }
    }
    const filter = source.filter;
    if (filter === void 0) return normalizeCqrsTail(source, definition, []);
    if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
      throw new JITError("INVALID_QUERY", "CQRS filter must be an object");
    }
    const allowed = definition.options.filter ?? {};
    const entries = Object.entries(filter);
    if (entries.length > (definition.options.maxFilters ?? 32)) {
      throw new JITError("INVALID_QUERY", "CQRS filter exceeds the configured structural limit");
    }
    const conditions = [];
    for (const [field, raw] of entries) {
      const configured = allowed[field];
      if (configured === void 0)
        throw new JITError("INVALID_QUERY", `Filter field ${JSON.stringify(field)} is not allowed`);
      if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
        if (configured === true) {
          throw new JITError("INVALID_QUERY", `Filter field ${JSON.stringify(field)} only allows equality`);
        }
        for (const [operator, value] of Object.entries(raw)) {
          const kind = operator.startsWith("$") ? operator.slice(1) : operator;
          if (!configured.includes(kind)) {
            throw new JITError(
              "INVALID_QUERY",
              `Filter operator ${JSON.stringify(kind)} is not allowed for ${JSON.stringify(field)}`
            );
          }
          conditions.push({ kind, path: field.split("."), value });
        }
      } else conditions.push({ kind: "eq", path: field.split("."), value: raw });
    }
    if (conditions.length > (definition.options.limits?.maxConditions ?? definition.options.maxFilters ?? 32)) {
      throw new JITError("INVALID_QUERY", "CQRS filter exceeds the configured condition limit");
    }
    return normalizeCqrsTail(source, definition, conditions);
  };
}
function normalizeCqrsTail(source, definition, filter) {
  const select = normalizeCqrsSelect(source, definition);
  const pagination = definition.options.pagination;
  const allowedSort = new Set(pagination?.type === "cursor" ? pagination.by : definition.options.sort ?? []);
  if (source.sort !== void 0 && (typeof source.sort !== "string" || source.sort.length === 0)) {
    throw new JITError("INVALID_QUERY", "CQRS sort must be a non-empty string");
  }
  const sort2 = typeof source.sort === "string" ? source.sort.split(",").map((token) => {
    const descending = token.startsWith("-");
    const field = descending ? token.slice(1) : token;
    if (!allowedSort.has(field))
      throw new JITError("INVALID_QUERY", `Sort field ${JSON.stringify(field)} is not allowed`);
    return {
      path: [field],
      direction: descending ? "desc" : "asc"
    };
  }) : [];
  const sortFields = /* @__PURE__ */ new Set();
  for (const entry of sort2) {
    const field = entry.path[0];
    if (field.length === 0) throw new JITError("INVALID_QUERY", "CQRS sort field cannot be empty");
    if (sortFields.has(field)) throw new JITError("INVALID_QUERY", `CQRS sort repeats ${JSON.stringify(field)}`);
    sortFields.add(field);
  }
  if (sort2.length > (definition.options.limits?.maxSortFields ?? 3)) {
    throw new JITError("INVALID_QUERY", "CQRS sort exceeds the configured structural limit");
  }
  if (!pagination) return { filter, sort: sort2, ...select === void 0 ? {} : { select } };
  if (pagination.type === "cursor") {
    if (sort2.length > 0 && !sameCursorOrdering(sort2, pagination.by)) {
      throw new JITError("INVALID_QUERY", "Cursor pagination requires its configured stable ordering");
    }
    const after = source.after === void 0 ? void 0 : decodeCqrsCursor(source.after, pagination.by.length);
    const before = source.before === void 0 ? void 0 : decodeCqrsCursor(source.before, pagination.by.length);
    if (after !== void 0 && before !== void 0) {
      throw new JITError("INVALID_QUERY", "Cursor pagination accepts either after or before, not both");
    }
    const limit2 = typeof source.limit === "number" ? source.limit : pagination.defaultLimit;
    if (!Number.isInteger(limit2) || limit2 < 1 || limit2 > pagination.maxLimit) {
      throw new JITError("INVALID_QUERY", "Invalid cursor pagination");
    }
    return {
      filter,
      sort: pagination.by.map((field) => ({
        path: [field],
        direction: "asc"
      })),
      ...select === void 0 ? {} : { select },
      pagination: {
        kind: "cursor",
        limit: limit2,
        ...after === void 0 ? {} : { after },
        ...before === void 0 ? {} : { before }
      }
    };
  }
  const page = typeof source.page === "number" ? source.page : 1;
  const limit = typeof source.limit === "number" ? source.limit : pagination.defaultLimit;
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > pagination.maxLimit || !Number.isSafeInteger(offset)) {
    throw new JITError("INVALID_QUERY", "Invalid offset pagination");
  }
  return {
    filter,
    sort: sort2,
    ...select === void 0 ? {} : { select },
    pagination: { kind: "offset", offset, limit }
  };
}
function normalizeCqrsSelect(source, definition) {
  if (source.fields === void 0) return void 0;
  if (!definition.options.select || typeof source.fields !== "string") {
    throw new JITError("INVALID_QUERY", "CQRS sparse fields are not allowed");
  }
  if (source.fields.length === 0) throw new JITError("INVALID_QUERY", "CQRS select field cannot be empty");
  const fields = source.fields.split(",");
  if (fields.length > (definition.options.limits?.maxSelectFields ?? 30)) {
    throw new JITError("INVALID_QUERY", "CQRS select exceeds the configured structural limit");
  }
  const allowed = new Set(objectFields(definition.schema));
  const selected = /* @__PURE__ */ new Set();
  for (const field of fields) {
    if (field.length === 0) throw new JITError("INVALID_QUERY", "CQRS select field cannot be empty");
    if (!allowed.has(field))
      throw new JITError("INVALID_QUERY", `Select field ${JSON.stringify(field)} is not allowed`);
    if (selected.has(field)) throw new JITError("INVALID_QUERY", `CQRS select repeats ${JSON.stringify(field)}`);
    selected.add(field);
  }
  return fields;
}
function sameCursorOrdering(sort2, fields) {
  return sort2.length === fields.length && sort2.every((entry, index2) => entry.direction === "asc" && entry.path[0] === fields[index2]);
}
function decodeCqrsCursor(value, size) {
  if (typeof value !== "string") throw new JITError("INVALID_QUERY", "Cursor must be an opaque string");
  try {
    const bytes = globalThis.atob(value);
    let escaped = "";
    for (let index2 = 0; index2 < bytes.length; index2++)
      escaped += `%${bytes.charCodeAt(index2).toString(16).padStart(2, "0")}`;
    const decoded = JSON.parse(decodeURIComponent(escaped));
    if (!Array.isArray(decoded) || decoded.length !== size) throw new Error("Invalid cursor tuple");
    return decoded;
  } catch {
    throw new JITError("INVALID_QUERY", "Malformed cursor");
  }
}
function emitCqrsInputParser(fields, maxFilters, sortFields = [], pagination, maxConditions = maxFilters, maxSortFields = 3, selectFields = [], maxSelectFields = 30) {
  const allowedFields = fields.map(([field]) => JSON.stringify(field));
  const inputFields = [
    "filter",
    "fields",
    "sort",
    ...pagination?.type === "offset" ? ["page", "limit"] : [],
    ...pagination?.type === "cursor" ? ["after", "before", "limit"] : []
  ].map((field) => JSON.stringify(field));
  const conditionCapacity = Math.max(
    1,
    ...fields.map(([, configured]) => configured === true ? 1 : configured.length * 2)
  );
  const fieldBodies = fields.map(([field, configured]) => {
    const access2 = `[${JSON.stringify(field)}]`;
    const operators = configured === true ? [] : configured;
    const operatorBodies = operators.flatMap((operator) => {
      const kind = JSON.stringify(operator);
      const path = JSON.stringify(field.split("."));
      return [
        `if (raw[${JSON.stringify(`$${operator}`)}] !== undefined) { matched += 1; out[j++] = { kind: ${kind}, path: ${path}, value: raw[${JSON.stringify(`$${operator}`)}] }; }`,
        `if (raw[${JSON.stringify(operator)}] !== undefined) { matched += 1; out[j++] = { kind: ${kind}, path: ${path}, value: raw[${JSON.stringify(operator)}] }; }`
      ];
    }).join(" ");
    return `if (filter${access2} !== undefined) { const raw = filter${access2}; if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) { ${operatorBodies ? `let matched = 0; ${operatorBodies} if (Object.keys(raw).length !== matched) return __reference(input);` : "return __reference(input);"} } else out[j++] = { kind: "eq", path: ${JSON.stringify(field.split("."))}, value: raw }; }`;
  });
  const allowedSort = sortFields.map((field) => JSON.stringify(field));
  const allowedSelect = selectFields.map((field) => JSON.stringify(field));
  const selectSource = `const selectText = input.fields; let select; if (selectText !== undefined) { if (typeof selectText !== "string" || selectText.length === 0) return __reference(input); const selected = selectText.split(","); if (selected.length > ${maxSelectFields}) return __reference(input); const seen = new Set(); for (let i = 0; i < selected.length; i++) { const field = selected[i]; if (field.length === 0 || seen.has(field) || (${allowedSelect.map((field) => `field !== ${field}`).join(" && ") || "true"})) return __reference(input); seen.add(field); } select = selected; }`;
  const sortSource = `const sortText = input.sort; let sort = []; if (sortText !== undefined) { if (typeof sortText !== "string" || sortText.length === 0) return __reference(input); const tokens = sortText.split(","); if (tokens.length > ${maxSortFields}) return __reference(input); const seen = new Set(); sort = new Array(tokens.length); for (let i = 0; i < tokens.length; i++) { const token = tokens[i]; const descending = token.charCodeAt(0) === 45; const field = descending ? token.slice(1) : token; if (field.length === 0 || seen.has(field) || (${allowedSort.map((field) => `field !== ${field}`).join(" && ") || "true"})) return __reference(input); seen.add(field); sort[i] = { path: [field], direction: descending ? "desc" : "asc" }; } }`;
  const paginationSource = !pagination ? "return select === undefined ? { filter: out, sort } : { filter: out, sort, select };" : pagination.type === "offset" ? `const page = typeof input.page === "number" ? input.page : 1; const limit = typeof input.limit === "number" ? input.limit : ${pagination.defaultLimit}; const offset = (page - 1) * limit; if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > ${pagination.maxLimit} || !Number.isSafeInteger(offset)) return __reference(input); return select === undefined ? { filter: out, sort, pagination: { kind: "offset", offset, limit } } : { filter: out, sort, select, pagination: { kind: "offset", offset, limit } };` : `if (typeof sortText === "string" && sortText.length > 0 && sortText !== ${JSON.stringify(pagination.by.join(","))}) return __reference(input); sort = ${JSON.stringify(pagination.by.map((field) => ({ path: [field], direction: "asc" })))}; const afterText = input.after; const beforeText = input.before; if (afterText !== undefined && beforeText !== undefined) return __reference(input); const after = afterText === undefined ? undefined : __decodeCursor(afterText, ${pagination.by.length}); const before = beforeText === undefined ? undefined : __decodeCursor(beforeText, ${pagination.by.length}); const limit = typeof input.limit === "number" ? input.limit : ${pagination.defaultLimit}; if (!Number.isInteger(limit) || limit < 1 || limit > ${pagination.maxLimit}) return __reference(input); return select === undefined ? { filter: out, sort, pagination: { kind: "cursor", limit, ...(after === undefined ? {} : { after }), ...(before === undefined ? {} : { before }) } } : { filter: out, sort, select, pagination: { kind: "cursor", limit, ...(after === undefined ? {} : { after }), ...(before === undefined ? {} : { before }) } };`;
  return `return function parse(input) { if (input === null || typeof input !== "object" || Array.isArray(input)) return __reference(input); const inputKeys = Object.keys(input); for (let i = 0; i < inputKeys.length; i++) { if (${inputFields.map((field) => `inputKeys[i] !== ${field}`).join(" && ") || "true"}) return __reference(input); } let out; if (input.filter === undefined) out = []; else { const filter = input.filter; if (filter === null || typeof filter !== "object" || Array.isArray(filter)) return __reference(input); const keys = Object.keys(filter); if (keys.length > ${maxFilters}) return __reference(input); for (let i = 0; i < keys.length; i++) { if (${allowedFields.map((field) => `keys[i] !== ${field}`).join(" && ") || "true"}) return __reference(input); } out = new Array(keys.length * ${conditionCapacity}); let j = 0; ${fieldBodies.join(" ")} if (j > ${maxConditions}) return __reference(input); if (j !== out.length) out.length = j; } ${selectSource} ${sortSource} ${paginationSource} };`;
}
function emitCqrsAotParserSource(...args) {
  const parser = emitCqrsInputParser(...args).split("return __reference(input);").join('throw new Error("Invalid CQRS input");').split("__decodeCursor").join("decodeCursor");
  return `function decodeCursor(value, size) { if (typeof value !== "string") throw new Error("Malformed cursor"); try { const bytes = atob(value); let escaped = ""; for (let i = 0; i < bytes.length; i++) escaped += "%" + bytes.charCodeAt(i).toString(16).padStart(2, "0"); const decoded = JSON.parse(decodeURIComponent(escaped)); if (!Array.isArray(decoded) || decoded.length !== size) throw new Error("Malformed cursor"); return decoded; } catch { throw new Error("Malformed cursor"); } } ${parser}`;
}
function aggregateSpec(op, key) {
  return Object.freeze({
    op,
    ...key === void 0 ? {} : { key },
    _result: null
  });
}
var cqrs = Object.freeze({
  input: cqrsInput,
  parse: cqrsParse,
  query: cqrsQuery,
  param,
  const: constant,
  /** Counts the rows that reach the aggregate; `0` when none do. */
  count: () => aggregateSpec("count"),
  /** Sums a numeric field; `0` when no row reaches the aggregate. */
  sum: (key) => aggregateSpec("sum", key),
  /** Averages a numeric field; `undefined` when no row reaches the aggregate. */
  avg: (key) => aggregateSpec("avg", key),
  min: (key) => aggregateSpec("min", key),
  max: (key) => aggregateSpec("max", key)
});

// ../../packages/jit/src/factories/csv.ts
function parse(schema, options) {
  const unwrapped = unwrapSchema(schema);
  const result = compileCsvParse(
    resolveCsvDescriptor(unwrapped, "parse", "result", options)
  );
  Object.defineProperty(result, "to", {
    value: Object.freeze({
      iterator: () => compileCsvParse(
        resolveCsvDescriptor(unwrapped, "parse", "iterator", options)
      ),
      visitor: () => compileCsvParse(
        resolveCsvDescriptor(unwrapped, "parse", "visitor", options)
      )
    })
  });
  return result;
}
function stringify(schema, options) {
  const unwrapped = unwrapSchema(schema);
  const result = compileCsvStringify(
    resolveCsvDescriptor(unwrapped, "stringify", "string", options)
  );
  Object.defineProperty(result, "to", {
    value: Object.freeze({
      iterator: () => compileCsvStringify(
        resolveCsvDescriptor(unwrapped, "stringify", "iterator", options)
      )
    })
  });
  return result;
}
var csv = Object.freeze({ parse, stringify });

// ../../packages/jit/src/factories/ddd.ts
var ddd = Object.freeze({
  /** Structural equality, hashing and immutability. `.abstract` for a base. */
  valueObject,
  /** Identity semantics; abstract, and meant to be subclassed. */
  entity,
  /** Abstract entity with controlled mutation and an ordered event buffer. */
  aggregateRoot,
  /** Immutable, versioned event; `create()` takes the payload. */
  domainEvent
});

// ../../packages/jit/src/factories/dto.ts
function dto(schema) {
  const unwrapped = unwrapSchema(schema);
  const annotations = unwrapped.annotations;
  return createBuilder(
    createSchema(unwrapped.type, unwrapped.def, {
      ...annotations,
      metadata: {
        ...annotations?.metadata,
        custom: { ...annotations?.metadata?.custom, dto: true }
      }
    })
  );
}

// ../../packages/jit/src/factories/indexing.ts
function index(schema) {
  const unwrapped = unwrapSchema(schema);
  const inferred = resolveIndexKeysFromFacts(unwrapped);
  const plan = createIndexPlan(unwrapped, inferred, "unique");
  Object.defineProperty(plan, "by", {
    value: (...keys) => createIndexPlan(unwrapped, keys, "unique")
  });
  return plan;
}
function createIndexPlan(schema, keys, shape) {
  const plan = keys || resolveIndexKeysFromFacts(schema) ? compileIndex(schema, resolveIndexDescriptor(schema, keys, shape), getCachedIndex) : unresolvedIndexPlan(schema, shape);
  Object.defineProperty(plan, "grouped", {
    value: () => createIndexPlan(schema, keys, "grouped")
  });
  return plan;
}
function unresolvedIndexPlan(schema, shape) {
  const fail = () => resolveIndexDescriptor(schema, void 0, shape);
  const plan = ((_value) => fail());
  Object.defineProperty(plan, "cached", { value: fail });
  return plan;
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

// ../../packages/jit/src/factories/lookup.ts
function lookup(schema) {
  const unwrapped = unwrapSchema(schema);
  const plan = createLookupPlan(unwrapped, void 0);
  Object.defineProperty(plan, "by", { value: (key) => createLookupPlan(unwrapped, key) });
  return plan;
}
function createLookupPlan(schema, key) {
  if (key === void 0 && !canResolve(schema)) return unresolvedLookupPlan(schema);
  return compileLookup(schema, resolveLookupDescriptor(schema, key), getCachedIndex);
}
function canResolve(schema) {
  try {
    resolveLookupDescriptor(schema, void 0);
    return true;
  } catch {
    return false;
  }
}
function unresolvedLookupPlan(schema) {
  const fail = () => resolveLookupDescriptor(schema, void 0);
  const plan = (() => fail());
  Object.defineProperty(plan, "explain", { value: fail });
  return plan;
}

// ../../packages/jit/src/factories/match.ts
function match(schema) {
  return createMatch(unwrapSchema(schema), [], []);
}
function createMatch(schema, tags, handlers) {
  return Object.freeze({
    case: (tag, handler) => createMatch(schema, [...tags, tag], [...handlers, handler]),
    otherwise: (handler) => compileMatch(resolveMatchDescriptor(schema, tags, true, false), handlers, handler),
    exhaustive: () => compileMatch(resolveMatchDescriptor(schema, tags, false, true), handlers, void 0)
  });
}

// ../../packages/jit/src/factories/migration.ts
function migrate(schema) {
  return createMigrationPlan(createMigrationDescriptor(unwrapSchema(schema)), schema);
}
function createMigrationPlan(descriptor, current) {
  const compiled = compileMigration(descriptor);
  Object.defineProperties(compiled, {
    to: {
      value: (target, overrides) => createMigrationPlan(appendMigrationEdge(descriptor, unwrapSchema(target), overrides), target)
    },
    versions: { value: descriptor.versions },
    current: { value: current },
    explain: {
      value: () => Object.freeze({
        strategy: "VersionSwitch",
        versions: descriptor.versions,
        passes: descriptor.edges.length,
        complexity: "O(remaining edges)"
      })
    }
  });
  return compiled;
}

// ../../packages/jit/src/factories/ndjson.ts
function parse2(schema) {
  return createParsePlan(createNdjsonDescriptor(unwrapSchema(schema), "parse"));
}
function createParsePlan(descriptor) {
  const result = compileNdjsonParse(descriptor);
  Object.defineProperties(result, {
    validate: { value: () => result },
    where: {
      value: (predicate) => {
        const state = createConditionBuilder(descriptor.bindingValues.length);
        const condition = predicate(state.builder);
        return createParsePlan(appendNdjsonFilter(descriptor, condition, state.bindings));
      }
    },
    select: { value: (...fields) => createParsePlan(selectNdjson(descriptor, fields)) },
    to: {
      value: Object.freeze({
        iterator: () => compileNdjsonParse(withNdjsonSink(descriptor, "iterator")),
        visitor: () => compileNdjsonParse(withNdjsonSink(descriptor, "visitor")),
        ndjson: () => compileNdjsonParse(withNdjsonSink(descriptor, "ndjson"))
      })
    }
  });
  return result;
}
function stringify2(schema) {
  const descriptor = createNdjsonDescriptor(unwrapSchema(schema), "stringify");
  const result = compileNdjsonStringify(descriptor);
  Object.defineProperty(result, "to", {
    value: Object.freeze({
      iterator: () => compileNdjsonStringify(withNdjsonSink(descriptor, "iterator"))
    })
  });
  return result;
}
var ndjson = Object.freeze({ parse: parse2, stringify: stringify2 });

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
          previous: readPath3(previous, change.path),
          value: readPath3(current, change.path)
        }));
        return cachedChanges;
      }
    };
    for (const listener of listeners) invoke(() => listener(event));
    for (const bucket of pathBuckets.values()) {
      const before = readPath3(previous, bucket.path);
      const after = readPath3(current, bucket.path);
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
        const selected = readPath3(value, normalized);
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
function readPath3(value, path) {
  let current = value;
  for (let index2 = 0; index2 < path.length; index2++) {
    if (current === null || current === void 0) return void 0;
    current = current[path[index2]];
  }
  return current;
}

// ../../packages/jit/src/factories/update.ts
function update(schema, ...args) {
  const unwrapped = unwrapSchema(schema);
  assertUpdateable2(unwrapped);
  const compiled = compileUpdate(unwrapped);
  const run = ((current, updateInput) => {
    const patch3 = typeof updateInput === "function" ? captureDraftPatch(updateInput) : updateInput;
    return compiled(current, patch3);
  });
  installUpdateMethods(run, unwrapped);
  if (args.length === 0) {
    registerArtifact(run, { kind: "operation", schema: unwrapped, op: "update" });
    return run;
  }
  return run(args[0], args[1]);
}
function installUpdateMethods(run, schema) {
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
      value: (initial, options) => createReactiveUpdate(initial, run, () => compileDiff(schema), options)
    },
    authorize: {
      enumerable: false,
      value: (ability, action, actor) => {
        const context = resolveAccessContext(ability, actor);
        if (context === void 0) {
          throw new JITError("INVALID_OPERATION", "update.authorize() requires an ability created by JIT.access()");
        }
        const guard = compileAccessMutationGuard(context, action);
        const authorized = ((current, input) => {
          const patch3 = typeof input === "function" ? captureDraftPatch(input) : input;
          guard(current, patch3);
          return run(current, patch3);
        });
        installUpdateMethods(authorized, schema);
        registerArtifact(authorized, {
          kind: "authorized-update-plan",
          schema,
          descriptor: context.descriptor,
          actor: context.actor,
          action
        });
        return authorized;
      }
    }
  });
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
    const cacheKey3 = path.map(String).join("\0");
    const cached = proxies.get(cacheKey3);
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
    proxies.set(cacheKey3, draft);
    return draft;
  };
  recipe(createDraft([]));
  return materializePatch(writes);
}
function materializePatch(writes) {
  const root = {};
  for (const write of writes) {
    let current = root;
    for (let index2 = 0; index2 < write.path.length; index2++) {
      const segment = write.path[index2];
      const key = normalizeKey(segment);
      const isLast = index2 === write.path.length - 1;
      if (isLast) {
        current[key] = write.value;
        continue;
      }
      const nextSegment = write.path[index2 + 1];
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
  if (hasInnerType2(schema)) {
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
function hasInnerType2(schema) {
  return schema.type === TypeName.optional || schema.type === TypeName.nullable || schema.type === TypeName.nullish || schema.type === TypeName.default || schema.type === TypeName.brand || schema.type === TypeName.transform || schema.type === TypeName.pipe || schema.type === TypeName.refine || schema.type === TypeName.coerce || schema.type === TypeName.promise;
}

// ../../packages/jit/src/factories/patch.ts
var patch = Object.freeze({
  /**
   * A deep partial patch, applied immutably. This is `JIT.update` under the
   * patch namespace — the same plan, not a second engine.
   */
  apply(schema) {
    return update(schema);
  },
  /** RFC 7396 JSON Merge Patch: `null` removes, objects merge, everything else replaces. */
  merge(schema) {
    return compileMergePatch(unwrapSchema(schema));
  },
  /** RFC 6902 JSON Patch: a list of operations applied in order, immutably. */
  json(schema) {
    return compileJsonPatch(unwrapSchema(schema));
  }
});

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
      const arraySchema2 = createSchema(TypeName.array, {
        element: processSchema
      });
      const binary4 = compileBinaryArray(arraySchema2, options, {
        adaptiveStringFields: collectProjectionOnlyFields(processSchema, nodes)
      });
      const query2 = compileBinaryQuery(binary4, {
        nodes,
        bindings,
        params: paramNames
      });
      const execute = ((values, second, third) => {
        const hasParams = paramNames.length > 0;
        const params = hasParams ? second : void 0;
        const length = hasParams ? third : second;
        const rowset = binary4.load(values, length);
        if (hasParams)
          return query2(rowset, params);
        return query2(rowset);
      });
      return Object.freeze({ binary: binary4, query: query2, execute });
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
    const index2 = startIndex + bindings.length;
    bindings[bindings.length] = value;
    return { kind: "binding", name: `__q${index2}` };
  };
  const compare3 = (op, key, value) => ({
    kind: "compare",
    op,
    left: { kind: "field", key },
    right: toValueNode(value)
  });
  return {
    bindings,
    builder: {
      constant,
      eq: (key, value) => compare3("eq", key, value),
      neq: (key, value) => compare3("neq", key, value),
      gt: (key, value) => compare3("gt", key, value),
      gte: (key, value) => compare3("gte", key, value),
      lt: (key, value) => compare3("lt", key, value),
      lte: (key, value) => compare3("lte", key, value),
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

// ../../packages/jit/src/factories/project.ts
function project(schema) {
  const unwrapped = unwrapSchema(schema);
  return Object.freeze({
    authorize: (ability, action, actor) => {
      const context = resolveAccessContext(ability, actor);
      if (context === void 0) {
        throw new JITError("INVALID_OPERATION", "project.authorize() requires an ability created by JIT.access()");
      }
      return compileAuthorizedProject(context, action);
    },
    select: (...paths) => compileProject(unwrapped, paths)
  });
}

// ../../packages/jit/src/factories/reconcile.ts
function reconcile(schema, channels) {
  return createReconcilePlan(unwrapSchema(schema), void 0, { ...ALL_CHANNELS, ...channels }, "value");
}
function createReconcilePlan(schema, key, channels, changes) {
  const compile = (sink) => compileReconcile(schema, resolveReconcileDescriptor(schema, key, channels, changes, sink));
  const plan = key === void 0 && !canResolve2(schema) ? unresolved(schema) : compile("result");
  Object.defineProperties(plan, {
    by: { value: (next) => createReconcilePlan(schema, next, channels, changes) },
    changes: { value: (mode) => createReconcilePlan(schema, key, channels, mode) },
    to: {
      value: Object.freeze({
        iterator: () => compile("iterator"),
        visitor: () => compile("visitor")
      })
    }
  });
  return plan;
}
function canResolve2(schema) {
  try {
    resolveReconcileDescriptor(schema, void 0, ALL_CHANNELS, "value", "result");
    return true;
  } catch {
    return false;
  }
}
function unresolved(schema) {
  return (() => resolveReconcileDescriptor(schema, void 0, ALL_CHANNELS, "value", "result"));
}

// ../../packages/jit/src/factories/rules.ts
function rules(schema) {
  return createRulesPlan(unwrapSchema(schema), void 0, []);
}
function createRulesPlan(subject, inputs, declarations) {
  const descriptor = resolveRulesDescriptor(subject, inputs, declarations);
  const lazy2 = (sink, ruleId) => {
    let compiled;
    return ((...args) => {
      compiled ??= compileRulesSink(descriptor, sink, ruleId === void 0 ? void 0 : { ruleId });
      return compiled(...args);
    });
  };
  const test = lazy2("test");
  const some = lazy2("some");
  const first = lazy2("first");
  const match2 = lazy2("match");
  const run = lazy2("run");
  const explain = lazy2("explain");
  const predicates = /* @__PURE__ */ new Map();
  const visitor = memoize(() => compileSink(descriptor, "visitor"));
  const iterator = memoize(() => compileSink(descriptor, "iterator"));
  const many = memoize(() => createManyPlan(descriptor));
  const plan = {};
  Object.defineProperties(plan, {
    inputs: {
      value: (shape) => {
        if (inputs !== void 0) {
          throw new JITError("INVALID_OPERATION", "JIT.rules().inputs() may only be declared once");
        }
        return createRulesPlan(subject, unwrapSchema(object(shape)), declarations);
      }
    },
    rule: {
      value: (id, options) => createRulesPlan(subject, inputs, [...declarations, toDeclaration(id, options)])
    },
    test: { value: test },
    some: { value: some },
    first: { value: first },
    match: { value: match2 },
    run: { value: run },
    explain: { value: explain },
    predicate: {
      value: (rule) => {
        let compiled = predicates.get(rule);
        if (compiled === void 0) {
          compiled = lazy2("predicate", rule);
          registerArtifact(compiled, { kind: "rules-plan", schema: subject, descriptor, sink: "predicate", ruleId: rule });
          predicates.set(rule, compiled);
        }
        return compiled;
      }
    },
    many: { value: many },
    to: { value: Object.freeze({ visitor, iterator }) },
    ids: { value: descriptor.ids, enumerable: true },
    inspect: { value: () => inspectRules(descriptor) }
  });
  Object.freeze(plan);
  registerArtifact(plan, { kind: "rules-plan", schema: subject, descriptor, sink: "plan" });
  registerArtifact(test, { kind: "rules-plan", schema: subject, descriptor, sink: "test" });
  registerArtifact(some, { kind: "rules-plan", schema: subject, descriptor, sink: "some" });
  registerArtifact(first, { kind: "rules-plan", schema: subject, descriptor, sink: "first" });
  registerArtifact(match2, { kind: "rules-plan", schema: subject, descriptor, sink: "match" });
  registerArtifact(run, { kind: "rules-plan", schema: subject, descriptor, sink: "run" });
  registerArtifact(explain, { kind: "rules-plan", schema: subject, descriptor, sink: "explain" });
  return plan;
}
function compileSink(descriptor, sink, ruleId) {
  const compiled = compileRulesSink(descriptor, sink, ruleId === void 0 ? void 0 : { ruleId });
  registerArtifact(compiled, {
    kind: "rules-plan",
    schema: descriptor.subject,
    descriptor,
    sink,
    ...ruleId === void 0 ? {} : { ruleId }
  });
  return compiled;
}
function createManyPlan(descriptor) {
  let compiled;
  const callable = ((...args) => {
    compiled ??= compileRulesSink(descriptor, "many");
    return compiled(...args);
  });
  const visitor = memoize(() => compileSink(descriptor, "many-visitor"));
  const iterator = memoize(() => compileSink(descriptor, "many-iterator"));
  Object.defineProperty(callable, "to", { value: Object.freeze({ visitor, iterator }) });
  registerArtifact(callable, { kind: "rules-plan", schema: descriptor.subject, descriptor, sink: "many" });
  return callable;
}
function memoize(build) {
  let value;
  return () => value ??= build();
}
function toDeclaration(id, options) {
  const condition = options.when(CONDITION2, INPUTS2);
  const priority = options.priority ?? 0;
  if (options.emit === void 0) {
    if (options.values !== void 0) {
      throw new JITError("INVALID_OPERATION", `rule ${JSON.stringify(id)} declares values without emit`);
    }
    return { id, condition, priority };
  }
  const values = options.values?.(SUBJECT_REF, INPUTS2) ?? {};
  const fields = {};
  for (const key of Object.keys(values)) fields[key] = toOutcomeValue(values[key]);
  const event = resolveEventTarget(options.emit);
  if (event !== void 0) {
    return { id, condition, priority, outcome: { ...event, fields, factory: options.emit } };
  }
  const target = unwrapSchema(options.emit);
  return { id, condition, priority, outcome: { kind: "object", target, type: target, fields } };
}
function resolveEventTarget(emit) {
  if (typeof emit !== "function") return void 0;
  const artifact = getArtifact(emit);
  if (artifact?.kind !== "class" || artifact.domainEvent === void 0) return void 0;
  const schema = artifact.schema;
  const payload = schema.def.props.payload;
  if (payload === void 0) {
    throw new JITError("INVALID_OPERATION", "domain event outcome requires a payload schema");
  }
  return { kind: "event", target: payload, type: schema };
}
function toOutcomeValue(value) {
  if (isInputValue(value)) return { kind: "param", name: value.name };
  if (isFieldValue(value)) return { kind: "field", key: value.key };
  return { kind: "literal", value };
}
function toValue(value, subjectField) {
  if (isInputValue(value)) return { kind: "param", name: value.name };
  if (subjectField) return { kind: "field", key: value };
  return { kind: "literal", value };
}
function compare(op, left, right) {
  return {
    kind: "compare",
    op,
    left: toValue(left, !isInputValue(left)),
    right: toValue(right, false)
  };
}
function fold3(op, left, right, rest) {
  const tail = rest.length === 0 ? right : fold3(op, right, rest[0], rest.slice(1));
  return { kind: "logical", op, left, right: tail };
}
var CONDITION2 = Object.freeze({
  eq: (left, right) => compare("eq", left, right),
  neq: (left, right) => compare("neq", left, right),
  gt: (left, right) => compare("gt", left, right),
  gte: (left, right) => compare("gte", left, right),
  lt: (left, right) => compare("lt", left, right),
  lte: (left, right) => compare("lte", left, right),
  and: (left, right, ...rest) => fold3("and", left, right, rest),
  or: (left, right, ...rest) => fold3("or", left, right, rest),
  not: (inner) => ({ kind: "not", inner })
});
var INPUTS2 = Object.freeze({
  field: (key) => ({ kind: "param", name: key })
});
var SUBJECT_REF = Object.freeze({
  field: (key) => ({ kind: "field", key })
});
function isInputValue(value) {
  return typeof value === "object" && value !== null && value.kind === "param";
}
function isFieldValue(value) {
  return typeof value === "object" && value !== null && value.kind === "field";
}

// ../../packages/jit/src/compiler/execution-plan.ts
var NO_EFFECTS = Object.freeze({
  mayThrow: false,
  mayAllocate: false,
  usesExternalBindings: false
});
var THROWING_EFFECTS = Object.freeze({
  mayThrow: true,
  mayAllocate: false,
  usesExternalBindings: false
});

// ../../packages/jit/src/factories/execution.ts
var OPERATION_ARTIFACTS = /* @__PURE__ */ new WeakMap();
function freezePlan2(schema, stages) {
  return Object.freeze({
    version: 1,
    schema,
    stages: Object.freeze(stages.map((stage2) => Object.freeze(stage2)))
  });
}
function createExecutionArtifact(plan, lower, arity = 1) {
  let compiled;
  const artifact = arity === 1 ? function executionArtifact(input) {
    compiled ??= lower();
    return compiled(input);
  } : function executionArtifact(left, right) {
    compiled ??= lower();
    return compiled(left, right);
  };
  Object.defineProperties(artifact, {
    plan: { enumerable: true, value: plan },
    compile: {
      enumerable: false,
      value: () => {
        compiled ??= lower();
        return artifact;
      }
    },
    explain: { enumerable: false, value: () => plan }
  });
  registerArtifact(artifact, { kind: "execution", plan });
  return artifact;
}
function from(schema) {
  const unwrapped = unwrapSchema(schema);
  const plan = freezePlan2(unwrapped, [
    {
      kind: "value",
      input: "value",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: [],
      effects: NO_EFFECTS
    }
  ]);
  const source = createExecutionArtifact(
    plan,
    () => (value) => value
  );
  return artifactForSchema(source, unwrapped);
}
function jsonParse(schema) {
  const unwrapped = unwrapSchema(schema);
  const plan = freezePlan2(unwrapped, [
    {
      kind: "json.decode",
      input: "json-text",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: ["json-syntax-valid"],
      effects: THROWING_EFFECTS
    }
  ]);
  const source = createExecutionArtifact(
    plan,
    () => compileJsonParse(unwrapped)
  );
  return artifactForSchema(source, unwrapped);
}
function binaryDecode(schema) {
  const unwrapped = unwrapSchema(schema);
  const plan = freezePlan2(unwrapped, [
    {
      kind: "binary.decode",
      input: "binary",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: ["binary-layout-valid"],
      effects: THROWING_EFFECTS
    }
  ]);
  const source = createExecutionArtifact(
    plan,
    () => compileCodec(unwrapped).decode
  );
  return artifactForSchema(source, unwrapped);
}
function validationArtifact(schema, operation) {
  const unwrapped = unwrapSchema(schema);
  const output = operation === "is" ? "boolean" : operation === "issues" ? "issues" : "value";
  const plan = freezePlan2(unwrapped, [
    {
      kind: "value",
      input: "value",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: [],
      effects: NO_EFFECTS
    },
    {
      kind: "validate",
      input: "value",
      output,
      schema: unwrapped,
      operation,
      requires: [],
      provides: operation === "is" ? [] : ["schema-validated"],
      effects: THROWING_EFFECTS
    }
  ]);
  const artifact = createExecutionArtifact(plan, () => {
    switch (operation) {
      case "is":
        return compileValidatorSelection(unwrapped, ["is"]).is;
      case "parse":
        return compileValidatorSelection(unwrapped, ["parse"]).parse;
      case "safeParse":
        return compileValidatorSelection(unwrapped, ["safeParse"]).safeParse;
      case "parseAsync":
        return compileValidatorSelection(unwrapped, ["parseAsync"]).parseAsync;
      case "safeParseAsync":
        return compileValidatorSelection(unwrapped, ["safeParseAsync"]).safeParseAsync;
      case "issues": {
        const safeParse = compileValidatorSelection(unwrapped, ["safeParse"]).safeParse;
        return function* issues(value) {
          const result = safeParse(value);
          if (!result.success) yield* result.issues;
        };
      }
    }
  });
  attachStandardSchema(artifact, unwrapped, plan);
  if (operation === "parse") {
    return artifactForSchema(
      artifact,
      unwrapped
    );
  }
  return artifact;
}
function attachStandardSchema(target, schema, plan) {
  const composed = plan !== void 0 && !isPlainValidation(plan);
  Object.defineProperty(target, "~standard", {
    enumerable: false,
    configurable: false,
    get: () => composed ? pipelineStandardSchema(target) : getStandardSchema(schema)
  });
}
function isPlainValidation(plan) {
  return plan.stages.length === 2 && plan.stages[0]?.kind === "value" && plan.stages[1]?.kind === "validate";
}
var PIPELINE_ADAPTERS = /* @__PURE__ */ new WeakMap();
function pipelineStandardSchema(artifact) {
  const cached = PIPELINE_ADAPTERS.get(artifact);
  if (cached) return cached;
  const adapter = {
    version: 1,
    vendor: "jit",
    validate(value) {
      try {
        return { value: artifact(value) };
      } catch (error) {
        const issues = error.issues;
        if (!issues) throw error;
        return {
          issues: issues.map((issue) => ({
            message: issue.message,
            ...issue.path ? { path: issue.path.split(".").filter(Boolean) } : {}
          }))
        };
      }
    }
  };
  PIPELINE_ADAPTERS.set(artifact, adapter);
  return adapter;
}
function appendValidation(artifact, schema) {
  const construct2 = runtimeConstructStage(schema);
  const plan = freezePlan2(schema, [
    ...artifact.plan.stages,
    {
      kind: "validate",
      input: "value",
      output: "value",
      schema,
      operation: "parse",
      requires: [],
      provides: ["schema-validated"],
      effects: THROWING_EFFECTS
    },
    ...construct2
  ]);
  const next = createExecutionArtifact(
    plan,
    () => lowerExecutionPlan(plan)
  );
  attachStandardSchema(next, schema, plan);
  return artifactForSchema(next, schema);
}
function runtimeConstructStage(schema) {
  if (schema.type !== TypeName.runtimeType) return [];
  const runtimeType = schema;
  return [
    {
      kind: "construct",
      input: "value",
      output: "value",
      schema: runtimeType,
      target: runtimeType.def.materialize,
      requires: ["schema-validated"],
      provides: ["materialized"],
      effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: true }
    }
  ];
}
function jsonStringify(schema) {
  const unwrapped = unwrapSchema(schema);
  const plan = freezePlan2(unwrapped, [
    {
      kind: "value",
      input: "value",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: [],
      effects: NO_EFFECTS
    },
    {
      kind: "json.encode",
      input: "value",
      output: "json-text",
      schema: unwrapped,
      requires: [],
      provides: ["materialized"],
      effects: { ...THROWING_EFFECTS, mayAllocate: true }
    }
  ]);
  return createExecutionArtifact(plan, () => compileSerialize(unwrapped));
}
function binaryEncode(schema) {
  const unwrapped = unwrapSchema(schema);
  const plan = freezePlan2(unwrapped, [
    {
      kind: "value",
      input: "value",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: [],
      effects: NO_EFFECTS
    },
    {
      kind: "binary.encode",
      input: "value",
      output: "binary",
      schema: unwrapped,
      requires: [],
      provides: ["materialized"],
      effects: { ...THROWING_EFFECTS, mayAllocate: true }
    }
  ]);
  return createExecutionArtifact(plan, () => compileCodec(unwrapped).encode);
}
function operationArtifact(schema, operation, input, output, lower) {
  const unwrapped = unwrapSchema(schema);
  const cached = OPERATION_ARTIFACTS.get(unwrapped)?.get(operation);
  if (cached) return cached;
  const plan = freezePlan2(unwrapped, [
    {
      kind: "value",
      input: "value",
      output: "value",
      schema: unwrapped,
      requires: [],
      provides: [],
      effects: NO_EFFECTS
    },
    {
      kind: "operation",
      input,
      output,
      schema: unwrapped,
      operation,
      requires: [],
      provides: [],
      effects: THROWING_EFFECTS
    }
  ]);
  const artifact = createExecutionArtifact(
    plan,
    () => lower(unwrapped),
    operation === "equal" || operation === "diff" ? 2 : 1
  );
  const operations = OPERATION_ARTIFACTS.get(unwrapped);
  if (operations) operations.set(operation, artifact);
  else OPERATION_ARTIFACTS.set(unwrapped, /* @__PURE__ */ new Map([[operation, artifact]]));
  return artifact;
}
function mappedValue(source, sourceSchema, target, mapping = {}) {
  const targetSchema = unwrapSchema(target);
  const plan = freezePlan2(targetSchema, [...source.plan.stages, mapStage(sourceSchema, targetSchema, false, mapping)]);
  const artifact = createExecutionArtifact(
    plan,
    () => lowerExecutionPlan(plan)
  );
  return artifactForSchema(artifact, targetSchema);
}
function mappedCollection(state, target, mapping = {}) {
  const targetSchema = unwrapSchema(target);
  const resultSchema = arraySchema(targetSchema);
  const plan = freezePlan2(resultSchema, [
    ...state.plan.stages,
    mapStage(state.schema.def.element, targetSchema, true, mapping)
  ]);
  const source = createExecutionArtifact(
    plan,
    () => lowerExecutionPlan(plan)
  );
  return createCollectionArtifact({
    source,
    schema: resultSchema,
    querySource: resultSchema,
    builder: query(resultSchema),
    plan
  });
}
function transformedValue(source, sourceSchema, target, transforms) {
  const targetSchema = unwrapSchema(target);
  const plan = freezePlan2(targetSchema, [
    ...source.plan.stages,
    transformStage(sourceSchema, targetSchema, false, transforms)
  ]);
  const artifact = createExecutionArtifact(
    plan,
    () => lowerExecutionPlan(plan)
  );
  return artifactForSchema(artifact, targetSchema);
}
function transformedCollection(state, target, transforms) {
  const targetSchema = unwrapSchema(target);
  const resultSchema = arraySchema(targetSchema);
  const plan = freezePlan2(resultSchema, [
    ...state.plan.stages,
    transformStage(state.schema.def.element, targetSchema, true, transforms)
  ]);
  const source = createExecutionArtifact(
    plan,
    () => lowerExecutionPlan(plan)
  );
  return createCollectionArtifact({
    source,
    schema: resultSchema,
    querySource: resultSchema,
    builder: query(resultSchema),
    plan
  });
}
function updatedValue(source, schema, patch3) {
  const plan = freezePlan2(schema, [...source.plan.stages, updateStage(schema, false, patch3)]);
  const artifact = createExecutionArtifact(
    plan,
    () => lowerExecutionPlan(plan)
  );
  return artifactForSchema(artifact, schema);
}
function updatedCollection(state, patch3) {
  const plan = freezePlan2(state.schema, [...state.plan.stages, updateStage(state.schema.def.element, true, patch3)]);
  const source = createExecutionArtifact(
    plan,
    () => lowerExecutionPlan(plan)
  );
  return createCollectionArtifact({ ...state, source, plan });
}
function securedValue(source, schema, operation) {
  const plan = freezePlan2(schema, [...source.plan.stages, securityStage(schema, operation, false)]);
  const artifact = createExecutionArtifact(
    plan,
    () => lowerExecutionPlan(plan)
  );
  return artifactForSchema(artifact, schema);
}
function securedCollection(state, operation) {
  const plan = freezePlan2(state.schema, [
    ...state.plan.stages,
    securityStage(state.schema.def.element, operation, true)
  ]);
  const source = createExecutionArtifact(
    plan,
    () => lowerExecutionPlan(plan)
  );
  return createCollectionArtifact({ ...state, source, plan });
}
function artifactForSchema(artifact, schema) {
  if (schema.type === TypeName.array) {
    return createCollectionArtifact({
      source: artifact,
      schema,
      querySource: schema,
      builder: query(schema),
      plan: artifact.plan
    });
  }
  return createValueArtifact(artifact, schema);
}
function createValueArtifact(artifact, schema) {
  const target = artifact;
  const to = valueSinks(artifact, schema);
  Object.defineProperties(target, {
    schema: { enumerable: true, value: schema },
    validate: { enumerable: false, value: () => appendValidation(artifact, schema) },
    map: {
      enumerable: false,
      value: (targetSchema, mapping) => mappedValue(artifact, schema, targetSchema, mapping)
    },
    transform: {
      enumerable: false,
      value: (targetSchema, transforms) => transformedValue(
        artifact,
        schema,
        targetSchema,
        transforms
      )
    },
    update: {
      enumerable: false,
      value: (patch3) => updatedValue(
        artifact,
        schema,
        patch3
      )
    },
    mask: {
      enumerable: false,
      value: () => securedValue(artifact, schema, "mask")
    },
    sanitize: {
      enumerable: false,
      value: () => securedValue(artifact, schema, "sanitize")
    },
    to: { enumerable: true, value: to }
  });
  return Object.freeze(target);
}
function createCollectionArtifact(state) {
  const compiled = createExecutionArtifact(
    state.plan,
    () => lowerExecutionPlan(state.plan)
  );
  const artifact = compiled;
  Object.defineProperties(artifact, {
    schema: { enumerable: true, value: state.schema },
    validate: { enumerable: false, value: () => appendValidation(artifact, state.schema) },
    filter: {
      enumerable: false,
      value: (predicate) => {
        const builder2 = state.builder.filter(predicate);
        return createCollectionArtifact({
          source: state.source,
          schema: state.schema,
          querySource: state.querySource,
          builder: builder2,
          plan: appendQueryStage(state.plan, state.querySource, state.schema, "filter", builder2)
        });
      }
    },
    select: {
      enumerable: false,
      value: (...fields) => {
        const selectedSchema = selectArraySchema(state.schema, fields);
        const builder2 = state.builder.select(...fields);
        return createCollectionArtifact({
          source: state.source,
          schema: selectedSchema,
          querySource: state.querySource,
          builder: builder2,
          plan: appendQueryStage(state.plan, state.querySource, selectedSchema, "select", builder2)
        });
      }
    },
    map: {
      enumerable: false,
      value: (target, mapping) => mappedCollection(
        state,
        target,
        mapping
      )
    },
    transform: {
      enumerable: false,
      value: (target, transforms) => transformedCollection(
        state,
        target,
        transforms
      )
    },
    update: {
      enumerable: false,
      value: (patch3) => updatedCollection(state, patch3)
    },
    mask: {
      enumerable: false,
      value: () => securedCollection(state, "mask")
    },
    sanitize: {
      enumerable: false,
      value: () => securedCollection(state, "sanitize")
    },
    count: { enumerable: false, value: () => aggregateCollection(state, "count") },
    sum: { enumerable: false, value: (field) => aggregateCollection(state, "sum", field) },
    avg: { enumerable: false, value: (field) => aggregateCollection(state, "avg", field) },
    min: { enumerable: false, value: (field) => aggregateCollection(state, "min", field) },
    max: { enumerable: false, value: (field) => aggregateCollection(state, "max", field) },
    to: { enumerable: true, value: collectionSinks(compiled, state.schema) }
  });
  return Object.freeze(artifact);
}
function aggregateCollection(state, operation, key) {
  const builder2 = operation === "count" ? state.builder.count() : state.builder[operation](key);
  const program = getQueryProgram(builder2);
  if (!program) throw new JITError("INVALID_OPERATION", "aggregate pipeline lost its declarative program");
  const schema = aggregateResultSchema(operation);
  const plan = freezePlan2(schema, [
    ...state.plan.stages,
    {
      kind: "aggregate",
      input: "value",
      output: "value",
      source: state.querySource,
      schema,
      operation,
      ...key === void 0 ? {} : { key },
      program,
      requires: [],
      provides: ["aggregated"],
      effects: NO_EFFECTS
    }
  ]);
  return createExecutionArtifact(plan, () => lowerExecutionPlan(plan));
}
function aggregateResultSchema(operation) {
  const number3 = createSchema(TypeName.number, {});
  if (operation === "count" || operation === "sum") return number3;
  return createSchema(TypeName.union, {
    schemas: [number3, createSchema(TypeName.undefined, {})]
  });
}
function valueSinks(source, schema) {
  return Object.freeze({
    array: () => appendArraySink(source, schema),
    json: () => appendJsonSink(source, schema),
    binary: () => appendBinarySink(source, schema)
  });
}
function collectionSinks(source, schema) {
  return Object.freeze({
    array: () => appendArraySink(source, schema),
    json: () => appendJsonSink(source, schema),
    binary: () => appendBinarySink(source, schema)
  });
}
function appendArraySink(source, schema) {
  const plan = freezePlan2(schema, [
    ...source.plan.stages,
    {
      kind: "to.array",
      input: "value",
      output: "value",
      requires: [],
      provides: ["materialized"],
      effects: NO_EFFECTS
    }
  ]);
  return createExecutionArtifact(plan, () => lowerExecutionPlan(plan));
}
function appendJsonSink(source, schema) {
  const plan = freezePlan2(schema, [
    ...source.plan.stages,
    {
      kind: "json.encode",
      input: "value",
      output: "json-text",
      schema,
      requires: [],
      provides: ["materialized"],
      effects: { ...THROWING_EFFECTS, mayAllocate: true }
    }
  ]);
  return createExecutionArtifact(plan, () => lowerExecutionPlan(plan));
}
function appendBinarySink(source, schema) {
  const plan = freezePlan2(schema, [
    ...source.plan.stages,
    {
      kind: "binary.encode",
      input: "value",
      output: "binary",
      schema,
      requires: [],
      provides: ["materialized"],
      effects: { ...THROWING_EFFECTS, mayAllocate: true }
    }
  ]);
  return createExecutionArtifact(plan, () => lowerExecutionPlan(plan));
}
function appendQueryStage(plan, source, schema, operation, builder2) {
  const program = getQueryProgram(builder2);
  if (!program) throw new JITError("INVALID_OPERATION", "query pipeline lost its declarative program");
  return freezePlan2(schema, [
    ...plan.stages,
    {
      kind: "query",
      input: "value",
      output: "value",
      source,
      schema,
      operation,
      program,
      requires: [],
      provides: operation === "filter" ? ["filtered"] : ["projected"],
      effects: { ...NO_EFFECTS, mayAllocate: operation === "select" }
    }
  ]);
}
function mapStage(source, target, many, mapping) {
  return {
    kind: "map",
    input: "value",
    output: "value",
    schema: target,
    source,
    target,
    many,
    bindings: [mapping],
    requires: [],
    provides: ["mapped"],
    effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: Object.keys(mapping).length > 0 }
  };
}
function transformStage(source, target, many, transforms) {
  assertTransformTarget(source, target, transforms);
  return {
    kind: "transform",
    input: "value",
    output: "value",
    schema: target,
    source,
    target,
    many,
    transforms,
    requires: [],
    provides: ["transformed"],
    effects: {
      ...NO_EFFECTS,
      mayAllocate: true,
      usesExternalBindings: Object.keys(transforms).length > 0
    }
  };
}
function assertTransformTarget(source, target, transforms) {
  if (transforms === null || typeof transforms !== "object" || Array.isArray(transforms)) {
    throw new JITError("INVALID_OPERATION", "execution transforms must be a field-to-callback object");
  }
  const sourceObject = resolveWrappers(source).base;
  const targetObject = resolveWrappers(target).base;
  if (sourceObject.type !== TypeName.object || targetObject.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "execution transforms require object source and target schemas");
  }
  const sourceKeys = Object.keys(sourceObject.def.props);
  const targetKeys = Object.keys(targetObject.def.props);
  if (sourceKeys.length !== targetKeys.length || sourceKeys.some((key) => !targetKeys.includes(key))) {
    throw new JITError(
      "INVALID_OPERATION",
      "execution transform targets must preserve the source object's field set; use .map() for projections or renames"
    );
  }
  for (const key of Object.keys(transforms)) {
    if (!sourceKeys.includes(key)) {
      throw new JITError("INVALID_OPERATION", `execution transform selected unknown field ${JSON.stringify(key)}`);
    }
    if (typeof transforms[key] !== "function") {
      throw new JITError("INVALID_OPERATION", `execution transform for ${JSON.stringify(key)} must be a function`);
    }
  }
}
function updateStage(schema, many, patch3) {
  return {
    kind: "update",
    input: "value",
    output: "value",
    schema,
    many,
    patch: patch3,
    requires: [],
    provides: ["updated"],
    effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: true }
  };
}
function securityStage(schema, operation, many) {
  return {
    kind: "security",
    input: "value",
    output: "value",
    schema,
    operation,
    many,
    requires: [],
    provides: [operation === "mask" ? "masked" : "sanitized"],
    effects: { ...NO_EFFECTS, mayAllocate: true }
  };
}
function arraySchema(element) {
  return createSchema(TypeName.array, { element });
}
function selectArraySchema(schema, fields) {
  const element = schema.def.element;
  if (element.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "select pipelines require an array of object schemas");
  }
  const object2 = element;
  const props = {};
  for (const field of fields) {
    const value = object2.def.props[field];
    if (value === void 0) throw new JITError("INVALID_OPERATION", `unknown selected field ${JSON.stringify(field)}`);
    props[field] = value;
  }
  const selectedObject = createSchema(TypeName.object, {
    ...object2.def,
    props
  });
  return createSchema(TypeName.array, {
    ...schema.def,
    element: selectedObject
  });
}

// ../../packages/jit/src/factories/special/special.ts
function literal3(value) {
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
function jsonValue() {
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
function parseAsync(schema) {
  return validationArtifact(schema, "parseAsync");
}
function safeParseAsync(schema) {
  return validationArtifact(schema, "safeParseAsync");
}
var validate = Object.freeze({
  is(schema) {
    return validationArtifact(schema, "is");
  },
  parse(schema) {
    return validationArtifact(schema, "parse");
  },
  safeParse(schema) {
    return validationArtifact(schema, "safeParse");
  },
  issues(schema) {
    return validationArtifact(schema, "issues");
  },
  parseAsync,
  safeParseAsync,
  async: Object.freeze({
    parse: parseAsync,
    safeParse: safeParseAsync
  })
});
var json = Object.freeze({
  value: jsonValue,
  parse: jsonParse,
  stringify: jsonStringify,
  stringifyChunks(schema, options) {
    const unwrapped = unwrapSchema(schema);
    const base = jsonStringify(unwrapped);
    const last2 = base.plan.stages[base.plan.stages.length - 1];
    const plan = Object.freeze({
      ...base.plan,
      stages: Object.freeze([
        ...base.plan.stages.slice(0, -1),
        Object.freeze({
          ...last2,
          mode: "chunks",
          ...options?.chunkBytes === void 0 ? {} : { chunkBytes: options.chunkBytes }
        })
      ])
    });
    return createExecutionArtifact(plan, () => compileStringifyChunks(unwrapped, options));
  }
});
var binary2 = Object.freeze({
  encode: binaryEncode,
  decode: binaryDecode,
  codec(schema, options) {
    return compileCodec(unwrapSchema(schema), options);
  }
});
function equal(schema) {
  const artifact = operationArtifact(schema, "equal", "value", "boolean", compileEqual);
  if ("select" in artifact) return artifact;
  Object.defineProperty(artifact, "select", {
    value: (...paths) => operationArtifact(
      buildProjectionTree(unwrapSchema(schema), paths, "JIT.compare.equal().select()").schema,
      "equal",
      "value",
      "boolean",
      compileEqual
    )
  });
  return artifact;
}
function changed(schema) {
  const unwrapped = unwrapSchema(schema);
  const plan = createChangedMask(unwrapped, allFieldPaths(unwrapped, "JIT.compare.changed()"));
  Object.defineProperty(plan, "select", {
    value: (...paths) => createChangedMask(unwrapped, paths)
  });
  return plan;
}
function createChangedMask(schema, paths) {
  const descriptor = resolveChangedDescriptor(schema, paths);
  const compiled = compileChanged(schema, descriptor);
  const fields = descriptor.fields.map((field) => field.path);
  const bits = new Map(fields.map((path, index2) => [path, index2]));
  Object.defineProperties(compiled, {
    fields: { value: Object.freeze(fields) },
    has: {
      value: (mask3, path) => {
        const bit = bits.get(path);
        if (bit === void 0) return false;
        return typeof mask3 === "bigint" ? (mask3 & 1n << BigInt(bit)) !== 0n : (mask3 & 1 << bit) !== 0;
      }
    }
  });
  return compiled;
}
function clone(schema) {
  return operationArtifact(schema, "clone", "value", "value", compileClone);
}
function diff(schema) {
  return operationArtifact(schema, "diff", "value", "value", compileDiff);
}
function hash2(schema) {
  return operationArtifact(schema, "hash", "value", "value", compileHash);
}
function mock(schema) {
  return compileMock(unwrapSchema(schema));
}
function format(schema) {
  return operationArtifact(schema, "format", "value", "value", compileFormat);
}
function mask(schema) {
  return operationArtifact(schema, "mask", "value", "value", compileMask);
}
function sanitize(schema) {
  return operationArtifact(schema, "sanitize", "value", "value", compileSanitize);
}
var compare2 = Object.freeze({ equal, diff, hash: hash2, changed });
var security = Object.freeze({ mask, sanitize });
function mapCapability(source, target, ...overrides) {
  const sourceSchema = unwrapSchema(source);
  return mappedValue(
    from(sourceSchema),
    sourceSchema,
    target,
    overrides[0] ?? {}
  );
}
function mapMany(source, target, ...overrides) {
  const sourceSchema = unwrapSchema(source);
  const sourceCollection = from(arrayOf(sourceSchema));
  if (sourceCollection.schema.type !== "array") {
    throw new Error("unreachable collection schema");
  }
  return sourceCollection.map(target, overrides[0] ?? {});
}
function arrayOf(schema) {
  return {
    type: "array",
    _type: null,
    def: { element: schema },
    annotations: void 0
  };
}
var map2 = Object.assign(mapCapability, {
  many: mapMany
});

// ../../packages/jit/src/factories/serialize.ts
function codec(input, output, options) {
  return createBuilder(
    createSchema(TypeName.codec, {
      input: unwrapSchema(input),
      output: unwrapSchema(output),
      decode: options.decode,
      encode: options.encode
    })
  );
}

// ../../packages/jit/src/factories/sort.ts
function sort(schema) {
  const unwrapped = unwrapSchema(schema);
  return Object.freeze({
    by(key, direction = "asc") {
      return createSortPlan(unwrapped, [{ key, direction }]);
    }
  });
}
function createSortPlan(schema, criteria) {
  const descriptor = resolveOrderingDescriptor(schema, criteria);
  const compiled = compileSort(schema, descriptor);
  Object.defineProperties(compiled, {
    by: {
      value: (key, direction = "asc") => createSortPlan(schema, [{ key, direction }])
    },
    thenBy: {
      value: (key, direction = "asc") => createSortPlan(schema, [...criteria, { key, direction }])
    }
  });
  return compiled;
}

// ../../packages/jit/src/factories/stream.ts
function streamFactory(schema, options) {
  return compileStream(unwrapSchema(schema), options);
}
var stream = Object.assign(streamFactory, {
  json(schema, options) {
    return compileStream(unwrapSchema(schema), { ...options, format: "json" });
  },
  ndjson(schema, options) {
    return compileStream(unwrapSchema(schema), { ...options, format: "ndjson" });
  }
});

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
    map(key, mapper) {
      const result = mapper(createFieldOps());
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
    for (let index2 = 0; index2 < items.length; index2++) {
      const item = items[index2];
      const previous = this.lookup(previousIndex, previousItems, item);
      if (!previous) {
        newItems[newItems.length] = item;
      } else if (previous.item !== item) {
        updatedItems[updatedItems.length] = { previous: previous.item, current: item };
      }
    }
    for (let index2 = 0; index2 < previousItems.length; index2++) {
      const item = previousItems[index2];
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
      const index2 = this.createIndex(items);
      const found = this.lookup(index2, items, item);
      return found?.index ?? -1;
    }
    for (let index2 = 0; index2 < items.length; index2++) {
      if (this.compareItems(item, items[index2])) return index2;
    }
    return -1;
  }
  createIndex(items) {
    if (this.compare && !this.key) return void 0;
    const index2 = /* @__PURE__ */ new Map();
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      index2.set(this.identityOf(item), { item, index: itemIndex });
    }
    return index2;
  }
  lookup(index2, items, item) {
    if (index2) return index2.get(this.identityOf(item));
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const current = items[itemIndex];
      if (this.compareItems(item, current)) return { item: current, index: itemIndex };
    }
    return void 0;
  }
  identityOf(item) {
    return this.key ? item[this.key] : item;
  }
  removeAt(items, index2) {
    for (let next = index2 + 1; next < items.length; next++) {
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
    for (let index2 = 0; index2 < items.length; index2++) {
      const item = items[index2];
      const id = this.identityOf(item);
      const previous = previousIndex.get(id);
      nextIndex.set(id, { item, index: index2 });
      if (!previous) {
        newItems[newItems.length] = item;
      } else if (previous.item !== item) {
        updatedItems[updatedItems.length] = { previous: previous.item, current: item };
      }
    }
    for (let index2 = 0; index2 < previousItems.length; index2++) {
      const item = previousItems[index2];
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
  reindex(index2, items) {
    index2.clear();
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      index2.set(this.identityOf(item), { item, index: itemIndex });
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
var NO_EFFECTS2 = Object.freeze({
  mayThrow: false,
  mayAllocate: false,
  usesExternalBindings: false
});
var THROWING_EFFECTS2 = Object.freeze({
  mayThrow: true,
  mayAllocate: false,
  usesExternalBindings: false
});
function parseAsync2(schema) {
  return validationStub(schema, "parseAsync");
}
function safeParseAsync2(schema) {
  return validationStub(schema, "safeParseAsync");
}
var validate2 = Object.freeze({
  is(schema) {
    return validationStub(schema, "is");
  },
  parse(schema) {
    return validationStub(schema, "parse");
  },
  safeParse(schema) {
    return validationStub(schema, "safeParse");
  },
  issues(schema) {
    return validationStub(schema, "issues");
  },
  parseAsync: parseAsync2,
  safeParseAsync: safeParseAsync2,
  async: Object.freeze({
    parse: parseAsync2,
    safeParse: safeParseAsync2
  })
});
var json2 = Object.freeze({
  value: json.value,
  parse(schema) {
    return executionStub(schema, [
      {
        ...stage("json.decode", "json-text", "value"),
        schema: unwrapSchema(schema),
        provides: ["json-syntax-valid"]
      }
    ]);
  },
  stringify(schema) {
    return executionStub(schema, [
      stage("value", "value", "value"),
      stage("json.encode", "value", "json-text")
    ]);
  },
  stringifyChunks(schema, options) {
    const unwrapped = unwrapSchema(schema);
    return executionStub(unwrapped, [
      {
        ...stage("value", "value", "value"),
        schema: unwrapped
      },
      {
        ...stage("json.encode", "value", "json-text"),
        schema: unwrapped,
        mode: "chunks",
        ...options?.chunkBytes === void 0 ? {} : { chunkBytes: options.chunkBytes }
      }
    ]);
  }
});
var binary3 = Object.freeze({
  encode(schema) {
    return executionStub(schema, [
      stage("value", "value", "value"),
      stage("binary.encode", "value", "binary")
    ]);
  },
  codec(schema) {
    return operationStub(
      schema,
      "codec",
      "value"
    );
  },
  decode(schema) {
    return executionStub(schema, [
      {
        ...stage("binary.decode", "binary", "value"),
        schema: unwrapSchema(schema),
        provides: ["binary-layout-valid"]
      }
    ]);
  }
});
function from2(schema) {
  return executionStub(schema, [
    {
      ...stage("value", "value", "value"),
      schema: unwrapSchema(schema)
    }
  ]);
}
function map3(source, target, mapping = {}) {
  const sourceSchema = unwrapSchema(source);
  const targetSchema = unwrapSchema(target);
  return executionStub(targetSchema, [
    {
      ...stage("value", "value", "value"),
      schema: sourceSchema
    },
    mapStage2(sourceSchema, targetSchema, false, mapping)
  ]);
}
function mapMany2(source, target, mapping = {}) {
  const sourceSchema = unwrapSchema(source);
  const targetSchema = unwrapSchema(target);
  const collection = unwrapSchema(array(sourceSchema));
  const result = unwrapSchema(array(targetSchema));
  return executionStub(
    result,
    [
      {
        ...stage("value", "value", "value"),
        schema: collection
      },
      mapStage2(sourceSchema, targetSchema, true, mapping)
    ]
  );
}
function equal2(schema) {
  const select = (...paths) => operationStub(
    buildProjectionTree(unwrapSchema(schema), paths, "JIT.compare.equal().select()").schema,
    "equal",
    "boolean"
  );
  return operationStub(schema, "equal", "boolean", {
    select
  });
}
function changed2(schema) {
  const unwrapped = unwrapSchema(schema);
  const stub = defineChangedMask(unwrapped, allFieldPaths(unwrapped, "JIT.compare.changed()"));
  Object.defineProperty(stub, "select", { value: (...paths) => defineChangedMask(unwrapped, paths) });
  return stub;
}
function defineChangedMask(schema, paths) {
  const descriptor = resolveChangedDescriptor(schema, paths);
  const fields = descriptor.fields.map((field) => field.path);
  const bits = new Map(fields.map((path, index2) => [path, index2]));
  const stub = function aotChangedArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:changed",
        schemaId: schema.type,
        operation: { kind: "operation", op: "changed" }
      }
    },
    fields: { value: Object.freeze(fields) },
    has: {
      value: (mask3, path) => {
        const bit = bits.get(path);
        if (bit === void 0) return false;
        return typeof mask3 === "bigint" ? (mask3 & 1n << BigInt(bit)) !== 0n : (mask3 & 1 << bit) !== 0;
      }
    }
  });
  registerArtifact(stub, { kind: "changed-plan", schema, descriptor });
  return stub;
}
function clone2(schema) {
  return operationStub(schema, "clone", "value");
}
function diff2(schema) {
  return operationStub(schema, "diff", "value");
}
function hash3(schema) {
  return operationStub(schema, "hash", "value");
}
function format2(schema) {
  return operationStub(schema, "format", "value");
}
function validationStub(schema, operation) {
  return executionStub(schema, [
    stage("value", "value", "value"),
    {
      ...stage("validate", "value", operation === "is" ? "boolean" : operation === "issues" ? "issues" : "value"),
      operation,
      provides: operation === "is" ? [] : ["schema-validated"]
    }
  ]);
}
var jsonSchema2 = Object.freeze({
  to(schema, options) {
    const document = jsonSchema.to(schema, options);
    registerArtifact(document, {
      kind: "operation",
      schema: unwrapSchema(schema),
      op: "jsonSchema"
    });
    return document;
  },
  from: jsonSchema.from
});
function mock2(schema) {
  return operationStub(schema, "mock", "value");
}
function mask2(schema) {
  return operationStub(schema, "mask", "value");
}
function sanitize2(schema) {
  return operationStub(schema, "sanitize", "value");
}
function defineSort(schema) {
  const unwrapped = unwrapSchema(schema);
  return Object.freeze({
    by(key, direction = "asc") {
      return createDefineSortPlan(unwrapped, [{ key, direction }]);
    }
  });
}
function createDefineSortPlan(schema, criteria) {
  const descriptor = resolveOrderingDescriptor(schema, criteria);
  const stub = function aotSortArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  const fail = () => {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:sort",
        schemaId: schema.type,
        operation: { kind: "operation", op: "sort" }
      }
    },
    compare: { value: fail },
    inPlace: { value: fail },
    by: {
      value: (key, direction = "asc") => createDefineSortPlan(schema, [{ key, direction }])
    },
    thenBy: {
      value: (key, direction = "asc") => createDefineSortPlan(schema, [...criteria, { key, direction }])
    }
  });
  registerArtifact(stub, { kind: "sort-plan", schema, descriptor });
  return stub;
}
function defineIndex(schema) {
  const unwrapped = unwrapSchema(schema);
  const plan = createDefineIndexPlan(
    unwrapped,
    resolveIndexKeysFromFacts(unwrapped),
    "unique"
  );
  Object.defineProperty(plan, "by", {
    value: (...keys) => createDefineIndexPlan(unwrapped, keys, "unique")
  });
  return plan;
}
function createDefineIndexPlan(schema, keys, shape) {
  const stub = function aotIndexArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:index",
        schemaId: schema.type,
        operation: { kind: "operation", op: "index" }
      }
    },
    cached: { value: stub },
    grouped: { value: () => createDefineIndexPlan(schema, keys, "grouped") }
  });
  if (keys || resolveIndexKeysFromFacts(schema)) {
    registerArtifact(stub, {
      kind: "index-plan",
      schema,
      descriptor: resolveIndexDescriptor(schema, keys, shape)
    });
  }
  return stub;
}
function defineLookup(schema) {
  const unwrapped = unwrapSchema(schema);
  const plan = createDefineLookupPlan(unwrapped, void 0);
  Object.defineProperty(plan, "by", { value: (key) => createDefineLookupPlan(unwrapped, key) });
  return plan;
}
function createDefineLookupPlan(schema, key) {
  const stub = function aotLookupArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  const lookup2 = resolveLookupDescriptor(schema, key);
  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:lookup",
        schemaId: schema.type,
        operation: { kind: "operation", op: "lookup" }
      }
    },
    explain: {
      value: () => Object.freeze({
        strategy: lookup2.choice.strategy,
        reason: lookup2.choice.reason,
        complexity: lookup2.choice.complexity,
        facts: lookup2.choice.facts
      })
    }
  });
  registerArtifact(stub, { kind: "lookup-plan", schema, lookup: lookup2 });
  return stub;
}
function defineMatch(schema) {
  return createDefineMatch(unwrapSchema(schema), [], []);
}
function createDefineMatch(schema, tags, handlers) {
  const finish = (fallback, exhaustive) => {
    const descriptor = resolveMatchDescriptor(schema, tags, fallback !== void 0, exhaustive);
    const stub = function aotMatchArtifact() {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    };
    const names = tags.map((_, index2) => `__case${index2}`);
    Object.defineProperty(stub, AOT_ARTIFACT, {
      value: {
        artifactId: "operation:match",
        schemaId: schema.type,
        operation: { kind: "operation", op: "match" }
      }
    });
    registerArtifact(stub, {
      kind: "match-plan",
      schema,
      descriptor,
      bindingNames: names.concat(fallback === void 0 ? [] : ["__fallback"]),
      bindingValues: handlers.concat(fallback === void 0 ? [] : [fallback])
    });
    return stub;
  };
  return Object.freeze({
    case: (tag, handler) => createDefineMatch(schema, [...tags, tag], [...handlers, handler]),
    otherwise: (handler) => finish(handler, false),
    exhaustive: () => finish(void 0, true)
  });
}
function defineMigrate(schema) {
  return createDefineMigration(createMigrationDescriptor(unwrapSchema(schema)), schema);
}
function createDefineMigration(descriptor, current) {
  const stub = function aotMigrationArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:migrate",
        schemaId: descriptor.schemas[0]?.type ?? "unknown",
        operation: { kind: "operation", op: "migrate" }
      }
    },
    to: {
      value: (target, overrides) => createDefineMigration(appendMigrationEdge(descriptor, unwrapSchema(target), overrides), target)
    },
    versions: { value: descriptor.versions },
    current: { value: current },
    explain: {
      value: () => Object.freeze({
        strategy: "VersionSwitch",
        versions: descriptor.versions,
        passes: descriptor.edges.length,
        complexity: "O(remaining edges)"
      })
    }
  });
  registerArtifact(stub, { kind: "migration-plan", descriptor });
  return stub;
}
function defineCsvStub(descriptor) {
  const stub = function aotCsvArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperty(stub, AOT_ARTIFACT, {
    value: {
      artifactId: `operation:csv.${descriptor.operation}.${descriptor.sink}`,
      schemaId: descriptor.schema.type,
      operation: { kind: "operation", op: "csv" }
    }
  });
  registerArtifact(stub, { kind: "csv-plan", descriptor });
  return stub;
}
function defineCsvParse(schema, options) {
  const unwrapped = unwrapSchema(schema);
  const result = defineCsvStub(
    resolveCsvDescriptor(unwrapped, "parse", "result", options)
  );
  Object.defineProperty(result, "to", {
    value: Object.freeze({
      iterator: () => defineCsvStub(resolveCsvDescriptor(unwrapped, "parse", "iterator", options)),
      visitor: () => defineCsvStub(resolveCsvDescriptor(unwrapped, "parse", "visitor", options))
    })
  });
  return result;
}
function defineCsvStringify(schema, options) {
  const unwrapped = unwrapSchema(schema);
  const result = defineCsvStub(
    resolveCsvDescriptor(unwrapped, "stringify", "string", options)
  );
  Object.defineProperty(result, "to", {
    value: Object.freeze({
      iterator: () => defineCsvStub(resolveCsvDescriptor(unwrapped, "stringify", "iterator", options))
    })
  });
  return result;
}
var csv2 = Object.freeze({ parse: defineCsvParse, stringify: defineCsvStringify });
function defineNdjsonStub(descriptor) {
  const stub = function aotNdjsonArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperty(stub, AOT_ARTIFACT, {
    value: {
      artifactId: `operation:ndjson.${descriptor.operation}.${descriptor.sink}`,
      schemaId: descriptor.schema.type,
      operation: { kind: "operation", op: "ndjson" }
    }
  });
  registerArtifact(stub, { kind: "ndjson-plan", descriptor });
  return stub;
}
function createDefineNdjsonParse(descriptor) {
  const result = defineNdjsonStub(descriptor);
  Object.defineProperties(result, {
    validate: { value: () => result },
    where: {
      value: (predicate) => {
        const state = createConditionBuilder(descriptor.bindingValues.length);
        return createDefineNdjsonParse(appendNdjsonFilter(descriptor, predicate(state.builder), state.bindings));
      }
    },
    select: { value: (...fields) => createDefineNdjsonParse(selectNdjson(descriptor, fields)) },
    to: {
      value: Object.freeze({
        iterator: () => defineNdjsonStub(withNdjsonSink(descriptor, "iterator")),
        visitor: () => defineNdjsonStub(withNdjsonSink(descriptor, "visitor")),
        ndjson: () => defineNdjsonStub(withNdjsonSink(descriptor, "ndjson"))
      })
    }
  });
  return result;
}
function defineNdjsonParse(schema) {
  return createDefineNdjsonParse(createNdjsonDescriptor(unwrapSchema(schema), "parse"));
}
function defineNdjsonStringify(schema) {
  const descriptor = createNdjsonDescriptor(unwrapSchema(schema), "stringify");
  const result = defineNdjsonStub(descriptor);
  Object.defineProperty(result, "to", {
    value: Object.freeze({ iterator: () => defineNdjsonStub(withNdjsonSink(descriptor, "iterator")) })
  });
  return result;
}
var ndjson2 = Object.freeze({ parse: defineNdjsonParse, stringify: defineNdjsonStringify });
function defineReconcile(schema, channels) {
  return createDefineReconcilePlan(unwrapSchema(schema), void 0, { ...ALL_CHANNELS, ...channels }, "value");
}
function createDefineReconcilePlan(schema, key, channels, changes) {
  const stub = (sink) => {
    const artifact = function aotReconcileArtifact() {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    };
    Object.defineProperty(artifact, AOT_ARTIFACT, {
      value: {
        artifactId: "operation:reconcile",
        schemaId: schema.type,
        operation: { kind: "operation", op: "reconcile" }
      }
    });
    registerArtifact(artifact, {
      kind: "reconcile-plan",
      schema,
      descriptor: resolveReconcileDescriptor(schema, key, channels, changes, sink)
    });
    return artifact;
  };
  const plan = stub("result");
  Object.defineProperties(plan, {
    by: { value: (next) => createDefineReconcilePlan(schema, next, channels, changes) },
    changes: { value: (mode) => createDefineReconcilePlan(schema, key, channels, mode) },
    to: { value: Object.freeze({ iterator: () => stub("iterator"), visitor: () => stub("visitor") }) }
  });
  return plan;
}
function defineProject(schema) {
  const unwrapped = unwrapSchema(schema);
  return Object.freeze({
    authorize: (ability, action, actor) => {
      const context = resolveAccessContext(ability, actor);
      if (context === void 0) {
        throw new JITError("INVALID_OPERATION", "project.authorize() requires an ability created by JIT.access()");
      }
      const stub = function aotAuthorizedProjectArtifact() {
        throw new JITError(
          "JIT_AOT_001_ARTIFACT_EXECUTED",
          "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
        );
      };
      registerArtifact(stub, {
        kind: "authorized-project-plan",
        schema: unwrapped,
        descriptor: context.descriptor,
        actor: context.actor,
        action
      });
      return stub;
    },
    select: (...paths) => {
      const stub = function aotProjectArtifact() {
        throw new JITError(
          "JIT_AOT_001_ARTIFACT_EXECUTED",
          "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
        );
      };
      Object.defineProperty(stub, AOT_ARTIFACT, {
        value: {
          artifactId: "operation:project",
          schemaId: unwrapped.type,
          operation: { kind: "operation", op: "project" }
        }
      });
      registerArtifact(stub, {
        kind: "project-plan",
        schema: unwrapped,
        tree: buildProjectionTree(unwrapped, paths, "JIT.project()")
      });
      return stub;
    }
  });
}
var patch2 = Object.freeze({
  // `update` is not stubbed on this host, so `apply` is the same function the
  // runtime namespace exposes — which is exactly the one-to-one the contract asks for.
  apply: update,
  merge: (schema) => definePatchStub(schema, "merge"),
  json: (schema) => definePatchStub(schema, "json")
});
function definePatchStub(schema, mode) {
  const unwrapped = unwrapSchema(schema);
  const stub = function aotPatchArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperty(stub, AOT_ARTIFACT, {
    value: {
      artifactId: `operation:patch.${mode}`,
      schemaId: unwrapped.type,
      operation: { kind: "operation", op: "patch" }
    }
  });
  registerArtifact(stub, { kind: "patch-plan", schema: unwrapped, mode });
  return stub;
}
function defineCacheKeyBuilder(schema, form) {
  const unwrapped = unwrapSchema(schema);
  return Object.freeze({
    select: (...paths) => {
      const stub = function aotCacheKeyArtifact() {
        throw new JITError(
          "JIT_AOT_001_ARTIFACT_EXECUTED",
          "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
        );
      };
      Object.defineProperty(stub, AOT_ARTIFACT, {
        value: {
          artifactId: `operation:cacheKey.${form}`,
          schemaId: unwrapped.type,
          operation: { kind: "operation", op: "cacheKey" }
        }
      });
      registerArtifact(stub, {
        kind: "cache-key-plan",
        schema: unwrapped,
        descriptor: resolveCacheKeyDescriptor(unwrapped, paths, form)
      });
      return stub;
    }
  });
}
var cacheKey2 = Object.assign((schema) => defineCacheKeyBuilder(schema, "string"), {
  string: (schema) => defineCacheKeyBuilder(schema, "string"),
  hash: (schema) => defineCacheKeyBuilder(schema, "hash")
});
function defineCanonical(schema) {
  const unwrapped = unwrapSchema(schema);
  const stub = function aotCanonicalArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperty(stub, AOT_ARTIFACT, {
    value: {
      artifactId: "operation:canonical",
      schemaId: unwrapped.type,
      operation: { kind: "operation", op: "canonical" }
    }
  });
  registerArtifact(stub, { kind: "canonical-plan", schema: unwrapped });
  return stub;
}
function defineAccess(schema) {
  return defineAccessPlan(unwrapSchema(schema), void 0, []);
}
function defineAccessPlan(subject, actor, rules2) {
  const descriptor = resolveAccessDescriptor(subject, actor, rules2);
  const stub = function aotAccessArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  const runtimePlan = access(subject);
  const add = (effect) => (action, rule) => {
    const next = effect === "can" ? runtimePlan.can : runtimePlan.cannot;
    const built = getArtifact(next.call(runtimePlan, action, rule));
    if (built?.kind !== "access-plan") throw new JITError("INVALID_OPERATION", "access rule could not be resolved");
    return defineAccessPlan(subject, actor, [...rules2, ...built.descriptor.rules.slice(-1)]);
  };
  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:access",
        schemaId: subject.type,
        operation: { kind: "operation", op: "access" }
      }
    },
    actor: { value: (next) => defineAccessPlan(subject, unwrapSchema(next), rules2) },
    can: { value: add("can") },
    cannot: { value: add("cannot") },
    actions: { value: descriptor.actions },
    fields: { value: (action) => unconditionalFields(descriptor, action) }
  });
  registerArtifact(stub, { kind: "access-plan", schema: subject, descriptor });
  return stub;
}
function defineRules(schema) {
  return defineRulesPlan(rules(schema));
}
function defineRulesPlan(runtime) {
  const artifact = getArtifact(runtime);
  if (artifact?.kind !== "rules-plan") {
    throw new JITError("INVALID_OPERATION", "rules descriptor could not be resolved");
  }
  const register = (name, ruleId) => {
    const fail = function aotRulesArtifact() {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    };
    Object.defineProperty(fail, AOT_ARTIFACT, {
      value: {
        artifactId: `operation:rules:${ruleId === void 0 ? name : `${name}:${ruleId}`}`,
        schemaId: artifact.schema.type,
        operation: { kind: "operation", op: "rules" }
      }
    });
    registerArtifact(fail, { ...artifact, sink: name, ...ruleId === void 0 ? {} : { ruleId } });
    return fail;
  };
  const test = register("test");
  const some = register("some");
  const first = register("first");
  const match2 = register("match");
  const run = register("run");
  const explain = register("explain");
  const predicates = /* @__PURE__ */ new Map();
  const visitor = register("visitor");
  const iterator = register("iterator");
  const many = register("many");
  const manyVisitor = register("many-visitor");
  const manyIterator = register("many-iterator");
  const plan = {};
  Object.defineProperty(many, "to", {
    value: Object.freeze({ visitor: () => manyVisitor, iterator: () => manyIterator })
  });
  Object.defineProperties(plan, {
    inputs: {
      value: (shape) => defineRulesPlan(runtime.inputs(shape))
    },
    rule: {
      value: (id, options) => defineRulesPlan(
        runtime.rule(id, options)
      )
    },
    test: { value: test },
    some: { value: some },
    first: { value: first },
    match: { value: match2 },
    run: { value: run },
    explain: { value: explain },
    predicate: {
      value: (rule) => {
        let value = predicates.get(rule);
        if (value === void 0) {
          value = register("predicate", rule);
          predicates.set(rule, value);
        }
        return value;
      }
    },
    many: { value: () => many },
    to: { value: Object.freeze({ visitor: () => visitor, iterator: () => iterator }) },
    ids: { value: artifact.descriptor.ids, enumerable: true },
    inspect: { value: () => inspectRules(artifact.descriptor) }
  });
  Object.freeze(plan);
  registerArtifact(plan, { ...artifact, sink: "plan" });
  return plan;
}
function defineCqrsQuery(schema) {
  const builder2 = cqrs.query(schema);
  if (getArtifact(builder2)?.kind === "query" || !("~query" in builder2)) {
    return builder2;
  }
  return wrapDefineCqrsQuery(builder2);
}
function wrapDefineCqrsQuery(builder2) {
  const artifact = getArtifact(builder2);
  if (artifact?.kind !== "query-plan") {
    throw new JITError("INVALID_QUERY", "CQRS definition query is missing its reconstructive QueryProgram");
  }
  const terminal = (mode) => {
    const stub2 = function aotQueryArtifact() {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    };
    Object.defineProperty(stub2, AOT_ARTIFACT, {
      value: {
        artifactId: `query:${mode}`,
        schemaId: artifact.schema.type,
        operation: {
          kind: "query",
          ...artifact.program.params === void 0 ? {} : { params: artifact.program.params }
        }
      }
    });
    registerArtifact(stub2, { ...artifact, mode });
    return stub2;
  };
  const stub = terminal("array");
  const source = builder2;
  const chainMethods = [
    "params",
    "authorize",
    "filter",
    "where",
    "select",
    "unique",
    "distinct",
    "keyed",
    "groupBy",
    "orderBy",
    "flatMap",
    "take",
    "limit",
    "drop",
    "takeWhile",
    "dropWhile",
    "chunk",
    "window",
    "pairwise",
    "scan",
    "groupAdjacentBy",
    "delete",
    "update",
    "sum",
    "count",
    "avg",
    "min",
    "max",
    "aggregate",
    "first",
    "findIndex",
    "some",
    "every"
  ];
  for (const key of chainMethods) {
    const method = source[key];
    Object.defineProperty(stub, key, {
      value: (...args) => wrapDefineCqrsQuery(method(...args))
    });
  }
  const joinMethod = source.join;
  Object.defineProperties(stub, {
    join: {
      value: (...args) => {
        const pending = joinMethod(...args);
        return Object.freeze({
          on: (...keys) => wrapDefineJoin(pending.on(...keys))
        });
      }
    },
    "~query": { get: () => source["~query"] },
    explain: {
      value: (...args) => source.explain(...args)
    },
    to: {
      value: Object.freeze({
        iterator: () => terminal("iterator"),
        asyncIterator: () => terminal("async-iterator"),
        visitor: () => terminal("visitor")
      })
    },
    lazy: {
      value: () => {
        const lazy2 = terminal("iterator");
        Object.defineProperties(lazy2, {
          explain: {
            value: (...args) => source.explain(...args)
          },
          to: {
            value: Object.freeze({
              asyncIterator: () => terminal("async-iterator"),
              visitor: () => terminal("visitor")
            })
          }
        });
        return lazy2;
      }
    }
  });
  registerArtifact(stub, artifact);
  return stub;
}
function wrapDefineJoin(join2) {
  const artifact = getArtifact(join2);
  if (artifact?.kind !== "join-plan") {
    throw new JITError("INVALID_QUERY", "CQRS definition join is missing its reconstructive JoinPlan");
  }
  const stub = function aotJoinArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: `query:join:${artifact.plan.kind}`,
        schemaId: artifact.plan.leftSchema.type,
        operation: {
          kind: "query",
          ...artifact.plan.leftProgram.params === void 0 ? {} : { params: artifact.plan.leftProgram.params }
        }
      }
    },
    explain: {
      value: () => join2.explain()
    },
    "~query": {
      value: join2["~query"]
    }
  });
  registerArtifact(stub, artifact);
  return stub;
}
var cqrs2 = Object.freeze({
  ...cqrs,
  parse(definition) {
    const artifact = getArtifact(definition);
    if (artifact?.kind !== "cqrs-input") {
      throw new JITError("INVALID_QUERY", "CQRS input is missing reconstructive parser metadata");
    }
    const stub = function aotCqrsParser() {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    };
    Object.defineProperty(stub, AOT_ARTIFACT, {
      value: {
        artifactId: "cqrs:parse",
        schemaId: definition.schema.type,
        operation: { kind: "query" }
      }
    });
    registerArtifact(stub, {
      kind: "cqrs-parser",
      definition: artifact.definition,
      source: artifact.source
    });
    return stub;
  },
  query: defineCqrsQuery
});
function operationStub(schema, operation, output, extras) {
  return executionStub(
    schema,
    [stage("value", "value", "value"), { ...stage("operation", "value", output), operation }],
    void 0,
    extras
  );
}
function executionStub(schema, stages, queryBuilder, extras) {
  const unwrapped = unwrapSchema(schema);
  const plan = Object.freeze({
    version: 1,
    schema: unwrapped,
    stages: Object.freeze(stages)
  });
  const operation = {
    kind: "operation",
    op: "fromJSON"
  };
  const stub = function aotExecutionArtifact() {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };
  Object.defineProperties(stub, {
    plan: { enumerable: true, value: plan },
    compile: { enumerable: false, value: () => stub },
    explain: { enumerable: false, value: () => plan },
    [AOT_ARTIFACT]: {
      enumerable: false,
      value: {
        artifactId: `execution:${stages.map((item) => item.kind).join(">")}`,
        schemaId: unwrapped.type,
        operation
      }
    }
  });
  const artifact = stub;
  const append2 = (nextSchema, nextStage, nextQuery) => executionStub(nextSchema, [...plan.stages, nextStage], nextQuery);
  Object.defineProperties(artifact, {
    schema: { enumerable: true, value: unwrapped },
    validate: {
      enumerable: false,
      value: () => append2(unwrapped, {
        ...stage("validate", "value", "value"),
        schema: unwrapped,
        operation: "parse",
        provides: ["schema-validated"]
      })
    },
    map: {
      enumerable: false,
      value: (target, mapping = {}) => {
        const targetSchema = unwrapSchema(target);
        const many = unwrapped.type === "array";
        const source = many ? unwrapped.def.element : unwrapped;
        const output = many ? unwrapSchema(array(targetSchema)) : targetSchema;
        return append2(output, mapStage2(source, targetSchema, many, mapping));
      }
    },
    transform: {
      enumerable: false,
      value: (target, transforms) => {
        const targetSchema = unwrapSchema(target);
        const many = unwrapped.type === "array";
        const source = many ? unwrapped.def.element : unwrapped;
        const output = many ? unwrapSchema(array(targetSchema)) : targetSchema;
        return append2(output, transformStage2(source, targetSchema, many, transforms));
      }
    },
    update: {
      enumerable: false,
      value: (patch3) => {
        const many = unwrapped.type === "array";
        const schema2 = many ? unwrapped.def.element : unwrapped;
        return append2(unwrapped, updateStage2(schema2, many, patch3));
      }
    },
    mask: {
      enumerable: false,
      value: () => {
        const many = unwrapped.type === "array";
        const schema2 = many ? unwrapped.def.element : unwrapped;
        return append2(unwrapped, securityStage2(schema2, "mask", many));
      }
    },
    sanitize: {
      enumerable: false,
      value: () => {
        const many = unwrapped.type === "array";
        const schema2 = many ? unwrapped.def.element : unwrapped;
        return append2(unwrapped, securityStage2(schema2, "sanitize", many));
      }
    },
    to: {
      enumerable: true,
      value: Object.freeze({
        array: () => append2(unwrapped, stage("to.array", "value", "value")),
        json: () => append2(unwrapped, {
          ...stage("json.encode", "value", "json-text"),
          schema: unwrapped
        }),
        binary: () => append2(unwrapped, {
          ...stage("binary.encode", "value", "binary"),
          schema: unwrapped
        })
      })
    }
  });
  if (unwrapped.type === "array") {
    const source = queryBuilder ?? from(unwrapped);
    Object.defineProperties(artifact, {
      filter: {
        enumerable: false,
        value: (predicate) => {
          const next = source.filter(predicate);
          const query2 = next.plan.stages[next.plan.stages.length - 1];
          return append2(next.schema, query2, next);
        }
      },
      select: {
        enumerable: false,
        value: (...fields) => {
          const next = source.select(...fields);
          const query2 = next.plan.stages[next.plan.stages.length - 1];
          return append2(next.schema, query2, next);
        }
      }
    });
  }
  if (extras !== void 0) {
    for (const [name, value] of Object.entries(extras)) {
      Object.defineProperty(artifact, name, { enumerable: false, value });
    }
  }
  registerArtifact(stub, { kind: "execution", plan });
  return Object.freeze(stub);
}
function mapStage2(source, target, many, mapping) {
  return {
    ...stage("map", "value", "value"),
    schema: target,
    source,
    target,
    many,
    bindings: [mapping],
    provides: ["mapped"],
    effects: {
      ...NO_EFFECTS2,
      mayAllocate: true,
      usesExternalBindings: Object.keys(mapping).length > 0
    }
  };
}
function transformStage2(source, target, many, transforms) {
  assertTransformTarget2(source, target, transforms);
  return {
    ...stage("transform", "value", "value"),
    schema: target,
    source,
    target,
    many,
    transforms,
    provides: ["transformed"],
    effects: {
      ...NO_EFFECTS2,
      mayAllocate: true,
      usesExternalBindings: Object.keys(transforms).length > 0
    }
  };
}
function assertTransformTarget2(source, target, transforms) {
  if (transforms === null || typeof transforms !== "object" || Array.isArray(transforms)) {
    throw new JITError("INVALID_OPERATION", "execution transforms must be a field-to-callback object");
  }
  const sourceObject = resolveWrappers(source).base;
  const targetObject = resolveWrappers(target).base;
  if (sourceObject.type !== "object" || targetObject.type !== "object") {
    throw new JITError("INVALID_OPERATION", "execution transforms require object source and target schemas");
  }
  const sourceKeys = Object.keys(sourceObject.def.props);
  const targetKeys = Object.keys(targetObject.def.props);
  if (sourceKeys.length !== targetKeys.length || sourceKeys.some((key) => !targetKeys.includes(key))) {
    throw new JITError(
      "INVALID_OPERATION",
      "execution transform targets must preserve the source object's field set; use .map() for projections or renames"
    );
  }
  for (const key of Object.keys(transforms)) {
    if (!sourceKeys.includes(key)) {
      throw new JITError("INVALID_OPERATION", `execution transform selected unknown field ${JSON.stringify(key)}`);
    }
    if (typeof transforms[key] !== "function") {
      throw new JITError("INVALID_OPERATION", `execution transform for ${JSON.stringify(key)} must be a function`);
    }
  }
}
function updateStage2(schema, many, patch3) {
  return {
    ...stage("update", "value", "value"),
    schema,
    many,
    patch: patch3,
    provides: ["updated"],
    effects: { ...NO_EFFECTS2, mayAllocate: true, usesExternalBindings: true }
  };
}
function securityStage2(schema, operation, many) {
  return {
    ...stage("security", "value", "value"),
    schema,
    operation,
    many,
    provides: [operation === "mask" ? "masked" : "sanitized"],
    effects: { ...NO_EFFECTS2, mayAllocate: true }
  };
}
function stage(kind, input, output) {
  return {
    kind,
    input,
    output,
    requires: [],
    provides: [],
    effects: kind === "value" ? NO_EFFECTS2 : THROWING_EFFECTS2
  };
}
var JIT = {
  ...factories_exports,
  validate: validate2,
  json: json2,
  binary: binary3,
  from: from2,
  map: Object.assign(
    ((source, target, mapping) => map3(source, target, mapping ?? {})),
    { many: mapMany2 }
  ),
  clone: clone2,
  format: format2,
  jsonSchema: jsonSchema2,
  mock: mock2,
  sort: defineSort,
  index: defineIndex,
  lookup: defineLookup,
  reconcile: defineReconcile,
  project: defineProject,
  patch: patch2,
  cacheKey: cacheKey2,
  canonical: defineCanonical,
  access: defineAccess,
  rules: defineRules,
  match: defineMatch,
  migrate: defineMigrate,
  csv: csv2,
  ndjson: ndjson2,
  cqrs: cqrs2,
  compare: Object.freeze({ equal: equal2, diff: diff2, hash: hash3, changed: changed2 }),
  security: Object.freeze({ mask: mask2, sanitize: sanitize2 })
};

// lib/lab/compiler/entry.ts
function compileBindings(bindings, options) {
  resetVirtualFiles();
  const result = generate({
    ...classifyDeclarations(bindings),
    outDir: "/jit-lab",
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
function outputName(generated, requested) {
  const base = requested.replace(/\.(?:d\.)?(?:ts|cts|mts|js|cjs|mjs)$/, "");
  const extension = generated.slice("index".length);
  return `${base}${extension}`;
}
export {
  JIT,
  compileBindings
};
