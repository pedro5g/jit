import { beforeAll, describe, expect, it } from "vitest";
import { build } from "../../../scripts/knowledge/build";
import { buildSchema } from "../application/schema/build-schema";
import { generateSchemaCode, generateSchemaFile } from "../application/schema/generate-code";
import { extractJson, parseSchemaIntent } from "../application/schema/intent-schema";
import { SchemaService } from "../application/schema/schema.service";
import { verifyIntent } from "../application/schema/verify-intent";
import { validatorMenu } from "../config/schema-prompt";
import type { SchemaIntent } from "../core/entities/schema-intent";
import type { GenerationRequest, GenerationResult, LanguageModelPort } from "../core/ports/language-model";
import type { SymbolRepository } from "../core/repositories";
import { createKnowledgeEngine } from "../infrastructure/knowledge-engine";
import { MemoryArtifactLoader } from "../infrastructure/storage/memory-artifact-loader";

/**
 * §102's criterion, tested the only way it means anything: the model does not
 * write jit API.
 *
 * Every case below hands the pipeline something a small model actually emits
 * — JSON wrapped in prose, a method that does not exist, a method that exists
 * on the wrong kind — and asserts that what comes out is either code the real
 * library accepts or a refusal naming what was wrong. There is no third
 * outcome, and the absence of a third outcome is the feature.
 */

const INTENT: SchemaIntent = {
  kind: "object",
  name: "User",
  fields: [
    { name: "id", type: "string", validators: [{ type: "uuid" }], default: { type: "crypto.randomUUID" } },
    { name: "email", type: "string", validators: [{ type: "email" }] },
    { name: "name", type: "string", validators: [{ type: "min", value: 3 }] },
    { name: "age", type: "int", optional: true, validators: [{ type: "min", value: 0 }] },
  ],
};

class ScriptedModel implements LanguageModelPort {
  readonly id = "scripted";
  readonly label = "Scripted";
  readonly seen: GenerationRequest[] = [];

  constructor(private readonly replies: string[]) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.seen.push(request);
    return { text: this.replies[this.seen.length - 1] ?? "", finish: "stop" };
  }

  stream(request: GenerationRequest): Promise<GenerationResult> {
    return this.generate(request);
  }
}

describe("extracting the model's JSON", () => {
  it("finds the object inside a fence, prose, or both", () => {
    expect(extractJson('Here you go:\n```json\n{"kind":"object"}\n```\nHope that helps')).toBe('{"kind":"object"}');
    expect(extractJson('{"a":{"b":1}} trailing')).toBe('{"a":{"b":1}}');
  });

  it("is not fooled by a brace inside a string", () => {
    expect(extractJson('{"description":"a } brace"}')).toBe('{"description":"a } brace"}');
  });

  it("returns null when there is no object at all", () => {
    expect(extractJson("I cannot do that")).toBeNull();
  });
});

describe("validating the intent with jit itself", () => {
  it("accepts the protocol's own example", () => {
    const parsed = parseSchemaIntent(JSON.stringify(INTENT));
    expect(parsed.ok).toBe(true);
  });

  it("reports the field a wrong type is on, not just that something failed", () => {
    const parsed = parseSchemaIntent(JSON.stringify({ kind: "object", fields: [{ name: "id", type: "uuid" }] }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.stage).toBe("shape");
    expect(parsed.issues.join(" ")).toContain("fields.id.type");
  });

  it("refuses a structure that says object and declares nothing", () => {
    const parsed = parseSchemaIntent(JSON.stringify({ kind: "object", fields: [{ name: "profile", type: "object" }] }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.stage).toBe("shape");
    expect(parsed.issues[0]).toContain("must declare its own fields");
  });

  it("refuses nesting past the depth limit rather than walking it", () => {
    let field: unknown = { name: "leaf", type: "string" };
    for (let depth = 0; depth < 6; depth++) field = { name: `level${depth}`, type: "object", fields: [field] };

    const parsed = parseSchemaIntent(JSON.stringify({ kind: "object", fields: [field] }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.join(" ")).toContain("deeper than");
  });

  it("refuses the same field declared twice", () => {
    const parsed = parseSchemaIntent(
      JSON.stringify({
        kind: "object",
        fields: [
          { name: "id", type: "string" },
          { name: "id", type: "number" },
        ],
      })
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.join(" ")).toContain("declared twice");
  });
});

describe("generating code", () => {
  it("writes the chain in a fixed order, defaults last", () => {
    expect(generateSchemaCode(INTENT)).toBe(
      [
        "export const User = JIT.object({",
        "  id: JIT.string().uuid().default(() => crypto.randomUUID()),",
        "  email: JIT.string().email(),",
        "  name: JIT.string().min(3),",
        "  age: JIT.int().min(0).optional(),",
        "});",
      ].join("\n")
    );
  });

  it("emits the entrypoint the workspace restores", () => {
    expect(generateSchemaFile(INTENT)).toContain('import { JIT } from "@jit-compiler/jit/runtime";');
    expect(generateSchemaFile(INTENT, { entrypoint: "define" })).toContain('"@jit-compiler/jit/define"');
  });

  it("writes nested objects, arrays and enums", () => {
    const code = generateSchemaCode({
      kind: "object",
      name: "Order",
      fields: [
        { name: "status", type: "enum", values: ["draft", "confirmed"] },
        {
          name: "items",
          type: "array",
          items: { name: "item", type: "string", validators: [{ type: "min", value: 1 }] },
        },
        {
          name: "address",
          type: "object",
          fields: [{ name: "city", type: "string" }],
          optional: true,
        },
      ],
    });

    expect(code).toContain('status: JIT.enum(["draft", "confirmed"]),');
    expect(code).toContain("items: JIT.array(JIT.string().min(1)),");
    expect(code).toContain("address: JIT.object({\n    city: JIT.string(),\n  }).optional(),");
  });

  it("quotes a key that is not an identifier instead of writing it bare", () => {
    const code = generateSchemaCode({ kind: "object", fields: [{ name: "content-type", type: "string" }] });
    expect(code).toContain('"content-type": JIT.string(),');
  });

  it("writes a date bound as a date", () => {
    const code = generateSchemaCode({
      kind: "object",
      fields: [{ name: "from", type: "date", validators: [{ type: "min", value: "2020-01-01" }] }],
    });

    expect(code).toContain('from: JIT.date().min(new Date("2020-01-01")),');
  });
});

describe("building the intent as a real schema", () => {
  it("parses data with the schema it claims to describe", () => {
    const built = buildSchema(INTENT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const result = built.schema.safeParse({ email: "a@b.com", name: "abc" }) as {
      success: boolean;
      data?: { id?: string };
    };

    expect(result.success).toBe(true);
    // The default ran, which is the half of the intent that code review misses.
    expect(result.data?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  /**
   * The division of labour, stated as a test because it is easy to forget.
   *
   * Every builder shares one prototype, so `.email()` on a boolean constructs
   * and parses without complaint — the restriction lives in a conditional type
   * and is gone at runtime. Only the symbol index can catch it, which is why
   * `verifyIntent` runs first and why this check is not treated as a second
   * opinion on kinds.
   */
  it("does not catch a method on the wrong kind — nothing at runtime can", () => {
    const built = buildSchema({
      kind: "object",
      fields: [{ name: "flag", type: "boolean", validators: [{ type: "email" }] }],
    });

    expect(built.ok).toBe(true);
  });

  it("catches a factory that is not there", () => {
    const built = buildSchema({
      kind: "object",
      fields: [{ name: "x", type: "decimal" as "string" }],
    });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.path).toBe("fields.x");
    expect(built.error).toContain("JIT.decimal");
  });
});

describe("against the real API surface", () => {
  let symbols: SymbolRepository;
  let service: SchemaService;

  beforeAll(async () => {
    const result = await build({ embed: false, verifyExamples: false, write: false, quiet: true });
    const engine = await createKnowledgeEngine(
      new MemoryArtifactLoader({
        manifest: result.manifest,
        entries: result.entries,
        chunks: result.chunks,
        symbols: result.symbols,
        routes: result.routes,
        relations: result.relations,
        lexical: result.lexical,
      })
    );

    symbols = engine.symbols;
    service = new SchemaService({ symbols });
  }, 120_000);

  it("accepts an intent whose every name exists", () => {
    expect(verifyIntent(INTENT, { symbols })).toEqual([]);
  });

  it("refuses a method jit does not have", () => {
    const findings = verifyIntent(
      { kind: "object", fields: [{ name: "name", type: "string", validators: [{ type: "notEmpty" }] }] },
      { symbols }
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.offender).toBe("notEmpty");
    // The real one is `noEmpty`, and a retry that is told so tends to take it.
    expect(findings[0]?.suggestions).toContain("noEmpty");
  });

  it("refuses a real method on the wrong kind", () => {
    const findings = verifyIntent(
      { kind: "object", fields: [{ name: "age", type: "number", validators: [{ type: "email" }] }] },
      { symbols }
    );

    expect(findings[0]?.message).toContain("not a number method");
  });

  it("refuses a structural flag written as a validator", () => {
    const findings = verifyIntent(
      { kind: "object", fields: [{ name: "name", type: "string", validators: [{ type: "optional" }] }] },
      { symbols }
    );

    expect(findings[0]?.message).toContain("optional: true");
  });

  it("builds its prompt menu from the index rather than from a list", () => {
    const menu = validatorMenu(symbols);

    expect(menu).toContain("string:");
    // The constraints a request actually asks for, none of which survived the
    // alphabetical truncation this menu used to do.
    expect(menu).toMatch(/\buuid\b/);
    expect(menu).toMatch(/\bemail\b/);
    expect(menu).toMatch(/\bmin\b/);
    // Operations are not validators, and a menu that offers them invites one.
    expect(menu).not.toMatch(/\bsafeParse\b/);
    expect(menu).not.toMatch(/\bpipe\b/);
    expect(menu).not.toMatch(/\boptional\b/);
  });

  describe("end to end", () => {
    it("turns a reply wrapped in prose into a file", async () => {
      const model = new ScriptedModel([`Sure!\n\`\`\`json\n${JSON.stringify(INTENT)}\n\`\`\``]);
      const result = await service.generate({ request: "a user with an id, email and name" }, model);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.retried).toBe(false);
      expect(result.code).toContain("export const User = JIT.object({");
    });

    it("retries once with the findings, and keeps the corrected answer", async () => {
      const wrong = { ...INTENT, fields: [{ name: "name", type: "string", validators: [{ type: "notEmpty" }] }] };
      const model = new ScriptedModel([JSON.stringify(wrong), JSON.stringify(INTENT)]);

      const result = await service.generate({ request: "a user" }, model);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.retried).toBe(true);

      // The retry was told what was wrong, not merely asked again.
      const retryTurn = model.seen[1]?.messages.at(-1)?.content ?? "";
      expect(retryTurn).toContain("notEmpty");
    });

    it("refuses rather than inventing when both attempts fail", async () => {
      const model = new ScriptedModel(["no json here", "still none"]);
      const result = await service.generate({ request: "a user" }, model);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("json");
      expect(result.retried).toBe(true);
    });
  });
});
