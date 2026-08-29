import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Compiler, JIT } from "../../index.js";

/**
 * The operator diagnostics matrix.
 *
 * A validation operator that can fail owes a caller three things: a stable
 * machine-readable code, a default message, and a way to replace that message
 * without touching the code. This table is the proof, and the completeness
 * check below is what keeps it true — a new operator that fails without
 * declaring its diagnostics breaks the build here rather than shipping with a
 * message nobody can change.
 */
interface OperatorCase {
  /** Check kind as it appears in the schema AST. */
  readonly kind: string;
  /** Schema carrying the default message. */
  readonly base: unknown;
  /** The same schema with a custom message. */
  readonly custom: unknown;
  /** A value the check rejects. */
  readonly invalid: unknown;
}

const MESSAGE = "custom diagnostic";

const cases: readonly OperatorCase[] = [
  { kind: "min", base: JIT.string().min(3), custom: JIT.string().min(3, MESSAGE), invalid: "x" },
  { kind: "max", base: JIT.string().max(2), custom: JIT.string().max(2, MESSAGE), invalid: "xxx" },
  { kind: "length", base: JIT.string().length(2), custom: JIT.string().length(2, MESSAGE), invalid: "x" },
  {
    kind: "oneOf",
    base: JIT.string().oneOf(["a"]),
    custom: JIT.string().oneOf(["a"], MESSAGE),
    invalid: "b",
  },
  {
    kind: "startsWith",
    base: JIT.string().startsWith("a"),
    custom: JIT.string().startsWith("a", MESSAGE),
    invalid: "b",
  },
  { kind: "endsWith", base: JIT.string().endsWith("a"), custom: JIT.string().endsWith("a", MESSAGE), invalid: "b" },
  { kind: "includes", base: JIT.string().includes("a"), custom: JIT.string().includes("a", MESSAGE), invalid: "b" },
  { kind: "regex", base: JIT.string().regex(/^a$/), custom: JIT.string().regex(/^a$/, MESSAGE), invalid: "b" },
  { kind: "email", base: JIT.string().email(), custom: JIT.string().email(MESSAGE), invalid: "b" },
  { kind: "uuid", base: JIT.string().uuid(), custom: JIT.string().uuid(MESSAGE), invalid: "b" },
  { kind: "url", base: JIT.string().url(), custom: JIT.string().url(MESSAGE), invalid: "b" },
  { kind: "httpUrl", base: JIT.string().httpUrl(), custom: JIT.string().httpUrl(MESSAGE), invalid: "b" },
  { kind: "guid", base: JIT.string().guid(), custom: JIT.string().guid(MESSAGE), invalid: "b" },
  { kind: "cuid", base: JIT.string().cuid(), custom: JIT.string().cuid(MESSAGE), invalid: "b" },
  { kind: "cuid2", base: JIT.string().cuid2(), custom: JIT.string().cuid2(MESSAGE), invalid: "!" },
  { kind: "ulid", base: JIT.string().ulid(), custom: JIT.string().ulid(MESSAGE), invalid: "b" },
  { kind: "xid", base: JIT.string().xid(), custom: JIT.string().xid(MESSAGE), invalid: "b" },
  { kind: "ksuid", base: JIT.string().ksuid(), custom: JIT.string().ksuid(MESSAGE), invalid: "b" },
  { kind: "nanoid", base: JIT.string().nanoid(), custom: JIT.string().nanoid(MESSAGE), invalid: "!" },
  { kind: "emoji", base: JIT.string().emoji(), custom: JIT.string().emoji(MESSAGE), invalid: "b" },
  { kind: "base64", base: JIT.string().base64(), custom: JIT.string().base64(MESSAGE), invalid: "!" },
  { kind: "base64url", base: JIT.string().base64url(), custom: JIT.string().base64url(MESSAGE), invalid: "!" },
  { kind: "hex", base: JIT.string().hex(), custom: JIT.string().hex(MESSAGE), invalid: "zz" },
  { kind: "jwt", base: JIT.string().jwt(), custom: JIT.string().jwt(MESSAGE), invalid: "b" },
  { kind: "duration", base: JIT.string().duration(), custom: JIT.string().duration(MESSAGE), invalid: "b" },
  { kind: "e164", base: JIT.string().e164(), custom: JIT.string().e164(MESSAGE), invalid: "b" },
  { kind: "domain", base: JIT.string().domain(), custom: JIT.string().domain(MESSAGE), invalid: "!" },
  { kind: "hostname", base: JIT.string().hostname(), custom: JIT.string().hostname(MESSAGE), invalid: "!" },
  { kind: "mac", base: JIT.string().mac(), custom: JIT.string().mac(undefined, MESSAGE), invalid: "b" },
  { kind: "ipv4", base: JIT.string().ipv4(), custom: JIT.string().ipv4(MESSAGE), invalid: "b" },
  { kind: "ipv6", base: JIT.string().ipv6(), custom: JIT.string().ipv6(MESSAGE), invalid: "b" },
  { kind: "cidrv4", base: JIT.string().cidrv4(), custom: JIT.string().cidrv4(MESSAGE), invalid: "b" },
  { kind: "cidrv6", base: JIT.string().cidrv6(), custom: JIT.string().cidrv6(MESSAGE), invalid: "b" },
  { kind: "date", base: JIT.string().date(), custom: JIT.string().date(MESSAGE), invalid: "b" },
  { kind: "time", base: JIT.string().time(), custom: JIT.string().time(MESSAGE), invalid: "b" },
  { kind: "datetime", base: JIT.string().datetime(), custom: JIT.string().datetime(MESSAGE), invalid: "b" },
  {
    kind: "format",
    base: JIT.string().format("###-##"),
    custom: JIT.string().format("###-##", MESSAGE),
    invalid: "zz",
  },
  { kind: "digest", base: JIT.string().digest("sha256"), custom: JIT.string().digest("sha256", MESSAGE), invalid: "b" },
  {
    kind: "stringFormat",
    base: JIT.string().stringFormat("slug", /^[a-z]+$/),
    custom: JIT.string().stringFormat("slug", /^[a-z]+$/, MESSAGE),
    invalid: "1",
  },
  { kind: "phoneBR", base: JIT.string().phoneBR(), custom: JIT.string().phoneBR(MESSAGE), invalid: "1" },
  { kind: "moreThan", base: JIT.number().gt(1), custom: JIT.number().gt(1, MESSAGE), invalid: 0 },
  { kind: "lessThan", base: JIT.number().lt(1), custom: JIT.number().lt(1, MESSAGE), invalid: 2 },
  { kind: "multipleOf", base: JIT.number().multipleOf(2), custom: JIT.number().multipleOf(2, MESSAGE), invalid: 3 },
  { kind: "positive", base: JIT.number().positive(), custom: JIT.number().positive(MESSAGE), invalid: -1 },
  { kind: "negative", base: JIT.number().negative(), custom: JIT.number().negative(MESSAGE), invalid: 1 },
  { kind: "integer", base: JIT.number().int(), custom: JIT.number().int(MESSAGE), invalid: 1.5 },
  {
    kind: "finite",
    base: JIT.number().finite(),
    custom: JIT.number().finite(MESSAGE),
    invalid: Number.POSITIVE_INFINITY,
  },
  { kind: "safe", base: JIT.number().safe(), custom: JIT.number().safe(MESSAGE), invalid: 2 ** 60 },
  { kind: "int32", base: JIT.number().int32(), custom: JIT.number().int32(MESSAGE), invalid: 2 ** 40 },
  { kind: "float32", base: JIT.number().float32(), custom: JIT.number().float32(MESSAGE), invalid: 1e60 },
  { kind: "float64", base: JIT.number().float64(), custom: JIT.number().float64(MESSAGE), invalid: Number.NaN },
  {
    kind: "nonEmpty",
    base: JIT.array(JIT.number()).nonEmpty(),
    custom: JIT.array(JIT.number()).nonEmpty(MESSAGE),
    invalid: [],
  },
  {
    kind: "between",
    base: JIT.date().between(new Date(0), new Date(10)),
    custom: JIT.date().between(new Date(0), new Date(10), MESSAGE),
    invalid: new Date(100),
  },
  {
    kind: "daysOfWeek",
    base: JIT.date().daysOfWeek([1]),
    custom: JIT.date().daysOfWeek([1], MESSAGE),
    invalid: new Date("2026-01-04T00:00:00.000Z"),
  },
  {
    kind: "monthsOfYear",
    base: JIT.date().monthsOfYear([2]),
    custom: JIT.date().monthsOfYear([2], MESSAGE),
    invalid: new Date("2026-01-04T00:00:00.000Z"),
  },
  {
    kind: "truncateTo",
    base: JIT.date().truncateTo("minute"),
    custom: JIT.date().truncateTo("minute", MESSAGE),
    invalid: new Date("2026-01-04T00:00:01.000Z"),
  },
];

/**
 * Kinds that cannot produce an issue of their own.
 *
 * These rewrite the value rather than reject it; when the rewritten value is
 * unacceptable the type gate reports it, and the message belongs to the gate.
 */
const TRANSFORM_KINDS: ReadonlySet<string> = new Set([
  "trim",
  "normalize",
  "lowercase",
  "uppercase",
  "sanitize",
  "noEmpty",
]);

function declaredCheckKinds(): ReadonlySet<string> {
  const source = readFileSync(fileURLToPath(new URL("../../core/builder/create-builder.ts", import.meta.url)), "utf8");
  const kinds = new Set<string>();

  for (const match of source.matchAll(/appendCheck\(this\.schema, \{\s*kind:\s*"([A-Za-z0-9]+)"/g)) {
    kinds.add(match[1] as string);
  }
  return kinds;
}

function firstIssue(schema: unknown, invalid: unknown) {
  const result = JIT.validate.safeParse(JIT.object({ value: schema as never }))({ value: invalid } as never);

  if (result.success) throw new Error("expected the operator to reject its sample value");
  return result.issues[0];
}

describe("validation operator diagnostics", () => {
  it("covers every check the builder can append", () => {
    const declared = declaredCheckKinds();
    const covered = new Set(cases.map((entry) => entry.kind));
    const missing = [...declared].filter((kind) => !covered.has(kind) && !TRANSFORM_KINDS.has(kind));
    const stale = [...covered].filter((kind) => !declared.has(kind));

    // A new operator arrives here before it reaches a user without a message.
    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
    expect(declared.size).toBeGreaterThan(cases.length);
  });

  it.each(
    cases.map((entry) => [entry.kind, entry] as const)
  )("%s reports a stable code and an overridable message", (_kind, entry) => {
    const base = firstIssue(entry.base, entry.invalid);
    const custom = firstIssue(entry.custom, entry.invalid);

    expect(base?.message).toBeTruthy();
    expect(custom?.message).toBe(MESSAGE);
    // The message is presentation; the code is what application logic reads,
    // and replacing one must never move the other.
    expect(custom?.code).toBe(base?.code);
    expect(custom?.expected).toBe(base?.expected);
    expect(custom?.path).toBe("value");
  });

  it("carries the bound a translator needs, and nothing more", () => {
    const issues = (schema: unknown, invalid: unknown) => firstIssue(schema, invalid);

    expect(issues(JIT.string().min(3), "x")?.params).toEqual({ minimum: 3, inclusive: true });
    expect(issues(JIT.string().max(1), "xx")?.params).toEqual({ maximum: 1, inclusive: true });
    expect(issues(JIT.string().length(4), "x")?.params).toEqual({ length: 4 });
    expect(issues(JIT.number().gte(18), 1)?.params).toEqual({ minimum: 18, inclusive: true });
    expect(issues(JIT.number().gt(0), 0)?.params).toEqual({ minimum: 0, inclusive: false });
    expect(issues(JIT.number().lt(0), 1)?.params).toEqual({ maximum: 0, inclusive: false });
    expect(issues(JIT.number().multipleOf(5), 3)?.params).toEqual({ multipleOf: 5 });
    expect(issues(JIT.array(JIT.string()).min(2), [])?.params).toEqual({ minimum: 2, inclusive: true });
    // A format check has no bound to report, so the key is absent rather than
    // an empty object every issue would have to carry.
    expect(issues(JIT.string().email(), "x")).not.toHaveProperty("params");
    // And a diagnostic never carries the value it rejected.
    expect(JSON.stringify(issues(JIT.string().min(8), "secret"))).not.toContain("secret");
  });

  it("keeps a custom message out of boolean validation", () => {
    const withMessage = JIT.object({ value: JIT.string().min(3, "a very long custom diagnostic message") });
    const withoutMessage = JIT.object({ value: JIT.string().min(3) });

    expect(JIT.validate.is(withMessage)({ value: "ab" })).toBe(false);
    expect(JIT.validate.is(withMessage)({ value: "abc" })).toBe(true);
    // `is` answers a boolean; it never reaches for a message to do it.
    expect(Compiler.emitValidatorSource(withMessage.schema, { ops: ["is"] })).toBe(
      Compiler.emitValidatorSource(withoutMessage.schema, { ops: ["is"] })
    );
  });
});
