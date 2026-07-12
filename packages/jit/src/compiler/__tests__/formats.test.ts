import { JIT } from "../../index.js";

function accepts(builder: Parameters<typeof JIT.validator>[0], good: readonly string[], bad: readonly string[]): void {
  const validate = JIT.validator(JIT.object({ value: builder as never }));

  for (const sample of good) {
    expect(validate.is({ value: sample }), `should accept ${JSON.stringify(sample)}`).toBe(true);
  }
  for (const sample of bad) {
    expect(validate.is({ value: sample }), `should reject ${JSON.stringify(sample)}`).toBe(false);
  }
}

describe("JIT string format checks", () => {
  it("should validate identifier formats", () => {
    accepts(JIT.string().cuid2(), ["tz4a98xxat96iws9zmbrgj3a"], ["", "TZ4A98!"]);
    accepts(JIT.string().ulid(), ["01ARZ3NDEKTSV4RRFFQ69G5FAV"], ["01ARZ3NDEKTSV4RRFFQ69G5FA"]);
    accepts(JIT.string().nanoid(), ["V1StGXR8_Z5jdHi6B-myT"], ["too-short"]);
    accepts(JIT.string().ksuid(), ["0ujtsYcgvSTl8PAuAdqWYSMnLOv"], ["!bad"]);
    accepts(JIT.string().xid(), ["9m4e2mr0ui3e8a215n4g"], ["9m4e2mr0ui3e8a215n4"]);
  });

  it("should validate versioned uuids and guid", () => {
    const v4 = "9b2b9f2e-8f2a-4b6e-9d3c-2f6a8b1c9d0e";
    const v7 = "0190d8b0-8f2a-7b6e-9d3c-2f6a8b1c9d0e";

    accepts(JIT.string().uuid(), [v4, v7, "00000000-0000-0000-0000-000000000000"], ["not-a-uuid"]);
    accepts(JIT.string().uuid(4), [v4], [v7]);
    accepts(JIT.string().uuid(7), [v7], [v4]);
    accepts(JIT.string().guid(), [v4, "12345678-1234-1234-1234-123456789abc"], ["xyz"]);
  });

  it("should let a custom regex override the default email pattern", () => {
    const unicode = "josé@empresa.com.br";

    accepts(JIT.string().email(), ["ada@math.org"], [unicode, "a..b@x.com"]);
    accepts(JIT.string().email(JIT.regexes.unicodeEmail), [unicode, "ada@math.org"], ["semarroba"]);

    const custom = JIT.validator(
      JIT.object({ email: JIT.string().email(JIT.regexes.rfc5322Email, "e-mail fora do RFC") })
    );
    const bad = custom.safeParse({ email: "not an email" });

    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.issues[0].message).toBe("e-mail fora do RFC");
  });

  it("should validate network formats", () => {
    accepts(JIT.string().ipv4(), ["192.168.0.1", "255.255.255.255"], ["256.1.1.1", "1.2.3"]);
    accepts(JIT.string().ipv6(), ["2001:db8::8a2e:370:7334", "::1"], ["2001:db8::g"]);
    accepts(JIT.string().cidrv4(), ["10.0.0.0/8"], ["10.0.0.0/33"]);
    accepts(JIT.string().mac(), ["00:1A:2B:3C:4D:5E"], ["00-1A-2B-3C-4D-5E"]);
    accepts(JIT.string().mac("-"), ["00-1a-2b-3c-4d-5e"], ["00:1a:2b:3c:4d:5e"]);
    accepts(JIT.string().hostname(), ["example.com", "localhost"], ["-bad.com"]);
    accepts(JIT.string().domain(), ["example.com.br"], ["localhost"]);
    accepts(JIT.string().e164(), ["+5511999998888"], ["11999998888", "+0123"]);
    accepts(JIT.string().httpUrl(), ["https://example.com", "http://localhost:3000"], ["ftp://example.com", "nope"]);
  });

  it("should validate encodings, hex, and digests", () => {
    accepts(JIT.string().base64(), ["aGVsbG8=", ""], ["aGVsbG8"]);
    accepts(JIT.string().base64url(), ["aGVsbG8_-", ""], ["aGVsbG8="]);
    accepts(JIT.string().hex(), ["deadBEEF", ""], ["xyz"]);
    accepts(JIT.string().jwt(), ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"], ["header.payload"]);
    accepts(JIT.string().digest("sha256"), ["a".repeat(64)], ["a".repeat(63)]);
    accepts(JIT.string().digest("md5", "base64"), ["1B2M2Y8AsgTpgAmY7PhCfg=="], ["1B2M2Y8AsgTpgAmY7PhCfg"]);
  });

  it("should validate string operators and custom regex formats", () => {
    accepts(
      JIT.string().startsWith("jit:").includes(":user:").endsWith(":v1"),
      ["jit:tenant:user:42:v1"],
      ["tenant:user:42:v1", "jit:tenant:admin:42:v1", "jit:tenant:user:42:v2"]
    );
    accepts(JIT.string().stringFormat("slug", /^[a-z0-9]+(?:-[a-z0-9]+)*$/), ["hello-world"], ["Hello World"]);

    const normalized = JIT.validator(JIT.string().normalize("NFC").toLowerCase()).parse("A\u0301");

    expect(normalized).toBe("á");
  });

  it("should validate temporal formats", () => {
    accepts(JIT.string().date(), ["2026-07-05", "2024-02-29"], ["2026-13-01", "2025-02-29"]);
    accepts(JIT.string().time(), ["23:59", "23:59:59.123"], ["24:00"]);
    accepts(JIT.string().time({ precision: -1 }), ["23:59"], ["23:59:59"]);
    accepts(JIT.string().datetime(), ["2026-07-05T12:00:00Z"], ["2026-07-05T12:00:00"]);
    accepts(JIT.string().datetime({ local: true }), ["2026-07-05T12:00:00"], ["2026-07-05"]);
    accepts(JIT.string().datetime({ offset: true }), ["2026-07-05T12:00:00-03:00"], ["2026-07-05T12:00:00-3:00"]);
    accepts(JIT.string().duration(), ["P3Y6M4DT12H30M5S", "P4W"], ["P", "3Y"]);
  });

  it("should expose the same ISO checks through JIT.iso", () => {
    accepts(JIT.iso.date(), ["2026-07-05", "2024-02-29"], ["2026-13-01", "2025-02-29"]);
    accepts(JIT.iso.time({ precision: 3 }), ["23:59:59.123"], ["23:59", "23:59:59.12"]);
    accepts(
      JIT.iso.datetime({ offset: true, precision: 0 }),
      ["2026-07-05T12:00:00Z", "2026-07-05T12:00:00-03:00"],
      ["2026-07-05T12:00Z", "2026-07-05T12:00:00-0300"]
    );
    accepts(JIT.iso.duration(), ["P3Y6M4DT12H30M5S", "P4W"], ["P", "3Y"]);
  });

  it("should validate emoji strings", () => {
    accepts(JIT.string().emoji(), ["🚀", "👍🏽🎉"], ["rocket 🚀"]);
  });

  it("should report custom messages and the format kind in issues", () => {
    const validate = JIT.validator(JIT.object({ id: JIT.string().ulid("id deve ser um ULID") }));
    const result = validate.safeParse({ id: "nope" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0].code).toBe("invalid_format");
      expect(result.issues[0].expected).toBe("ulid");
      expect(result.issues[0].message).toBe("id deve ser um ULID");
    }
  });

  it("should expose the regex library as JIT.regexes", () => {
    expect(JIT.regexes.ipv4.test("127.0.0.1")).toBe(true);
    expect(JIT.regexes.uuid(4).test("9b2b9f2e-8f2a-4b6e-9d3c-2f6a8b1c9d0e")).toBe(true);
    expect(JIT.regexes.hash("sha512", "base64url").test("x".repeat(86))).toBe(true);
  });
});
