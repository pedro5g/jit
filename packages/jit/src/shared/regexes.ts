/**
 * Format regexes powering the string format checks (`.email()`, `.cuid2()`,
 * `.uuid(7)`, ...). Exported publicly as `JIT.regexes` so devs can reuse or
 * override them (`.email(JIT.regexes.rfc5322Email)`).
 */

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @deprecated CUID v1 is deprecated by its authors due to information
 * leakage (timestamps embedded in the id). Use {@link cuid2} instead.
 */
export const cuid: RegExp = /^[cC][0-9a-z]{6,}$/;
/** Lowercase alphanumeric CUID2 identifier. */
export const cuid2: RegExp = /^[0-9a-z]+$/;
/** Crockford-base32 ULID identifier. */
export const ulid: RegExp = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
/** Lowercase hexadecimal XID identifier. */
export const xid: RegExp = /^[0-9a-vA-V]{20}$/;
/** Base62 KSUID identifier. */
export const ksuid: RegExp = /^[A-Za-z0-9]{27}$/;
/** URL-safe 21-character Nano ID. */
export const nanoid: RegExp = /^[a-zA-Z0-9_-]{21}$/;

/** ISO 8601-1 duration. No 8601-2 extensions (negative/fractional parts). */
export const duration: RegExp =
  /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;

/** ISO 8601-2 extensions: +- prefixes, weeks mixed with other units, fractional/negative components. */
export const extendedDuration: RegExp =
  /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;

/** Any UUID-like identifier: 8-4-4-4-12 hex pattern. */
export const guid: RegExp = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/**
 * RFC 9562/4122 UUID. With no version, all versions (plus the nil and max
 * UUIDs) are accepted.
 */
export const uuid = (version?: number | undefined): RegExp => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(
    `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`
  );
};
/** RFC 9562 version 4 UUID. */
export const uuid4: RegExp = /*@__PURE__*/ uuid(4);
/** RFC 9562 version 6 UUID. */
export const uuid6: RegExp = /*@__PURE__*/ uuid(6);
/** RFC 9562 version 7 UUID. */
export const uuid7: RegExp = /*@__PURE__*/ uuid(7);

/** Practical email validation (the default for `.email()`). */
export const email: RegExp =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** Equivalent to the HTML5 `input[type=email]` validation implemented by browsers. */
export const html5Email: RegExp =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
/** Alias for the browser-compatible HTML5 email pattern. */
export const browserEmail: RegExp = html5Email;

/** The classic emailregex.com regex for RFC 5322-compliant emails. */
export const rfc5322Email: RegExp =
  /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

/** Loose Unicode email: length limits and a single `@`, nothing else. */
export const unicodeEmail: RegExp = /^[^\s@"]{1,64}@[^\s@]{1,255}$/u;
/** Alias for the Unicode-aware email pattern. */
export const idnEmail: RegExp = unicodeEmail;

const EMOJI_SOURCE = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
/** Matches one or more Unicode emoji components. */
export function emoji(): RegExp {
  return new RegExp(EMOJI_SOURCE, "u");
}

/** IPv4 address in dotted-decimal notation. */
export const ipv4: RegExp =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
/** IPv6 address, including compressed forms. */
export const ipv6: RegExp =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;

/** MAC address using the supplied delimiter, defaulting to `:`. */
export const mac = (delimiter?: string): RegExp => {
  const escapedDelim = escapeRegex(delimiter ?? ":");

  return new RegExp(`^(?:[0-9A-F]{2}${escapedDelim}){5}[0-9A-F]{2}$|^(?:[0-9a-f]{2}${escapedDelim}){5}[0-9a-f]{2}$`);
};

/** IPv4 address with a CIDR prefix length. */
export const cidrv4: RegExp =
  /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
/** IPv6 address with a CIDR prefix length. */
export const cidrv6: RegExp =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;

/** RFC 4648 Base64 with optional padding for complete groups. */
export const base64: RegExp = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
/** Unpadded URL-safe Base64 alphabet. */
export const base64url: RegExp = /^[A-Za-z0-9_-]*$/;

/** DNS hostname with label and total-length limits. */
export const hostname: RegExp =
  /^(?=.{1,253}\.?$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-0-9a-zA-Z]{0,61}[0-9a-zA-Z])?)*\.?$/;
/** Fully qualified DNS domain with a letter-based top-level label. */
export const domain: RegExp = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
/** HTTP and HTTPS protocol names. */
export const httpProtocol: RegExp = /^https?$/;
/** Three-segment compact JSON Web Token shape. */
export const jwt: RegExp = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** E.164 phone number: leading digit 1-9, 7-15 digits total (excluding `+`). */
export const e164: RegExp = /^\+[1-9]\d{6,14}$/;

const DATE_SOURCE = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
/** Gregorian calendar date in `YYYY-MM-DD` form. */
export const date: RegExp = /*@__PURE__*/ new RegExp(`^${DATE_SOURCE}$`);

/** Configures the precision accepted by the ISO-like time pattern. */
export interface TimeOptions {
  /** `-1` = HH:MM, `0` = HH:MM:SS, `n` = exactly n fraction digits; omit for flexible seconds. */
  readonly precision?: number | null;
}

function timeSource(options: TimeOptions): string {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;

  if (typeof options.precision !== "number") return `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  if (options.precision === -1) return hhmm;
  if (options.precision === 0) return `${hhmm}:[0-5]\\d`;
  return `${hhmm}:[0-5]\\d\\.\\d{${options.precision}}`;
}

/** Creates a time pattern from the requested precision. */
export function time(options: TimeOptions = {}): RegExp {
  return new RegExp(`^${timeSource(options)}$`);
}

/** Configures timezone handling for the ISO-like datetime pattern. */
export interface DatetimeOptions extends TimeOptions {
  /** Accept a `±HH:MM` numeric offset in addition to `Z`. */
  readonly offset?: boolean;
  /** Accept a timestamp without any timezone designator. */
  readonly local?: boolean;
}

/** Creates a strict ISO-like datetime pattern from the supplied options. */
export function datetime(options: DatetimeOptions = {}): RegExp {
  const timePart = timeSource(options);
  const zones = ["Z"];

  if (options.local) zones.push("");
  if (options.offset) zones.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  return new RegExp(`^${DATE_SOURCE}T(?:${timePart}(?:${zones.join("|")}))$`);
}

/** Signed integer with an optional JavaScript `n` suffix. */
export const bigint: RegExp = /^-?\d+n?$/;
/** Signed decimal integer. */
export const integer: RegExp = /^-?\d+$/;
/** Signed decimal number without exponent notation. */
export const number: RegExp = /^-?\d+(?:\.\d+)?$/;
/** Case-insensitive textual boolean. */
export const boolean: RegExp = /^(?:true|false)$/i;

/** String containing no uppercase letters. */
export const lowercase: RegExp = /^[^A-Z]*$/;
/** String containing no lowercase letters. */
export const uppercase: RegExp = /^[^a-z]*$/;
/** Hexadecimal string of any length. */
export const hex: RegExp = /^[0-9a-fA-F]*$/;

/** Encodings supported by {@link hash}. */
export type HashEncoding = "hex" | "base64" | "base64url";

function fixedBase64(bodyLength: number, padding: "" | "=" | "=="): RegExp {
  return new RegExp(`^[A-Za-z0-9+/]{${bodyLength}}${padding}$`);
}

function fixedBase64url(length: number): RegExp {
  return new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
}

const HASH_REGEXES: Readonly<Record<string, Readonly<Record<HashEncoding, RegExp>>>> = {
  md5: {
    hex: /^[0-9a-fA-F]{32}$/,
    base64: /*@__PURE__*/ fixedBase64(22, "=="),
    base64url: /*@__PURE__*/ fixedBase64url(22),
  },
  sha1: {
    hex: /^[0-9a-fA-F]{40}$/,
    base64: /*@__PURE__*/ fixedBase64(27, "="),
    base64url: /*@__PURE__*/ fixedBase64url(27),
  },
  sha256: {
    hex: /^[0-9a-fA-F]{64}$/,
    base64: /*@__PURE__*/ fixedBase64(43, "="),
    base64url: /*@__PURE__*/ fixedBase64url(43),
  },
  sha384: {
    hex: /^[0-9a-fA-F]{96}$/,
    base64: /*@__PURE__*/ fixedBase64(64, ""),
    base64url: /*@__PURE__*/ fixedBase64url(64),
  },
  sha512: {
    hex: /^[0-9a-fA-F]{128}$/,
    base64: /*@__PURE__*/ fixedBase64(86, "=="),
    base64url: /*@__PURE__*/ fixedBase64url(86),
  },
};

/** Digest algorithms supported by {@link hash}. */
export type HashAlgorithm = keyof typeof HASH_REGEXES & string;

/** Regex for a hash digest of `algorithm` in the given encoding. */
export function hash(algorithm: HashAlgorithm, encoding: HashEncoding = "hex"): RegExp {
  return HASH_REGEXES[algorithm][encoding];
}

/** MD5 digest encoded as hexadecimal. */
export const md5_hex: RegExp = HASH_REGEXES.md5.hex;
/** SHA-1 digest encoded as hexadecimal. */
export const sha1_hex: RegExp = HASH_REGEXES.sha1.hex;
/** SHA-256 digest encoded as hexadecimal. */
export const sha256_hex: RegExp = HASH_REGEXES.sha256.hex;
/** SHA-384 digest encoded as hexadecimal. */
export const sha384_hex: RegExp = HASH_REGEXES.sha384.hex;
/** SHA-512 digest encoded as hexadecimal. */
export const sha512_hex: RegExp = HASH_REGEXES.sha512.hex;
