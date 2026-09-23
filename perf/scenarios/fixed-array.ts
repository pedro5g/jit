import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { portableProfile } from "../../packages/jit/src/compiler/target/portable-profile.js";
import { createNodeProfile } from "../../packages/jit/src/compiler/target/v8/profile.js";
import { emitValidator } from "../../packages/jit/src/compiler/validate/emit-validator-entry.js";
import type { AnyTypeSchema } from "../../packages/jit/src/core/ats/index.js";
import { AOT, Compiler, JIT } from "../../packages/jit/src/index.js";

interface GeneratedModule {
  readonly isValues: (value: unknown) => boolean;
}

interface DisposableCandidate {
  readonly run: () => unknown;
  readonly dispose?: () => void;
}

interface FixedArrayScenario {
  readonly length?: number;
  readonly elementCost?: "trivial" | "medium" | "high";
  readonly result?: "success" | "fail-first" | "fail-middle" | "fail-last";
}

/** Creates one deterministic implementation of a fixed-array scenario. */
export async function createCandidate(id: string, input: unknown = {}): Promise<(() => unknown) | DisposableCandidate> {
  const scenario = resolveScenario(input);
  const element = elementSchema(scenario.elementCost);
  const schema = JIT.array(element).length(scenario.length);
  const value = scenarioValue(scenario);
  switch (id) {
    case "ceiling":
      return () => handwrittenValidation(value, scenario);
    case "idiomatic":
      return () =>
        Array.isArray(value) &&
        value.length === scenario.length &&
        value.every((item) => validElement(item, scenario.elementCost));
    case "indexed-loop":
    case "unrolled": {
      const target = id === "unrolled" ? createNodeProfile("26") : portableProfile;
      const emitted = emitValidator(schema.schema, { is: true, safeParse: false, safeParseAsync: false, target });
      const compiled = globalThis.Function(...emitted.bindings.names, emitted.source)(...emitted.bindings.values) as {
        readonly is: (value: unknown) => boolean;
      };
      return () => compiled.is(value);
    }
    case "runtime-jit": {
      const validate = Compiler.compileValidator(schema.schema).is;
      return () => validate(value);
    }
    case "aot": {
      const outDir = mkdtempSync(join(tmpdir(), "jit-perf-array-"));
      AOT.generate({
        artifacts: { isValues: JIT.validate.is(schema) },
        outDir,
        format: "js",
        target: { profile: "portable-1" },
      });
      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as GeneratedModule;
      return {
        run: () => generated.isValues(value),
        dispose: () => rmSync(outDir, { recursive: true, force: true }),
      };
    }
    default:
      throw new Error(`unknown fixed-array candidate ${id}`);
  }
}

function resolveScenario(input: unknown): Required<FixedArrayScenario> {
  const value = typeof input === "object" && input !== null ? (input as FixedArrayScenario) : {};
  const length = value.length ?? 5;
  const elementCost = value.elementCost ?? "trivial";
  const result = value.result ?? "success";
  if (!Number.isSafeInteger(length) || length < 0)
    throw new RangeError("fixed-array scenario length must be non-negative");
  if (!["trivial", "medium", "high"].includes(elementCost)) throw new TypeError("unknown fixed-array element cost");
  if (!["success", "fail-first", "fail-middle", "fail-last"].includes(result))
    throw new TypeError("unknown fixed-array result case");
  return { length, elementCost, result };
}

function elementSchema(cost: FixedArrayScenario["elementCost"]): AnyTypeSchema {
  if (cost === "medium") return JIT.object({ value: JIT.string() }).schema;
  if (cost === "high") return JIT.object({ nested: JIT.object({ value: JIT.string() }) }).schema;
  return JIT.string().schema;
}

function scenarioValue(scenario: Required<FixedArrayScenario>): readonly unknown[] {
  const values: unknown[] = Array.from({ length: scenario.length }, () => validElementValue(scenario.elementCost));
  if (scenario.result !== "success" && values.length > 0) {
    const index =
      scenario.result === "fail-first"
        ? 0
        : scenario.result === "fail-last"
          ? values.length - 1
          : Math.floor(values.length / 2);
    values[index] =
      scenario.elementCost === "trivial"
        ? 42
        : scenario.elementCost === "medium"
          ? { value: 42 }
          : { nested: { value: 42 } };
  }
  return values;
}

function validElementValue(cost: FixedArrayScenario["elementCost"]): unknown {
  if (cost === "medium") return { value: "ok" };
  if (cost === "high") return { nested: { value: "ok" } };
  return "ok";
}

function validElement(value: unknown, cost: FixedArrayScenario["elementCost"]): boolean {
  if (cost === "medium")
    return typeof value === "object" && value !== null && "value" in value && typeof value.value === "string";
  if (cost === "high") {
    return (
      typeof value === "object" &&
      value !== null &&
      "nested" in value &&
      typeof value.nested === "object" &&
      value.nested !== null &&
      "value" in value.nested &&
      typeof value.nested.value === "string"
    );
  }
  return typeof value === "string";
}

function handwrittenValidation(value: unknown, scenario: Required<FixedArrayScenario>): boolean {
  if (!Array.isArray(value) || value.length !== scenario.length) return false;
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (scenario.elementCost === "trivial") {
      if (typeof item !== "string") return false;
    } else if (scenario.elementCost === "medium") {
      if (typeof item !== "object" || item === null || typeof (item as { value?: unknown }).value !== "string")
        return false;
    } else {
      if (typeof item !== "object" || item === null) return false;
      const nested = (item as { nested?: unknown }).nested;
      if (typeof nested !== "object" || nested === null || typeof (nested as { value?: unknown }).value !== "string")
        return false;
    }
  }
  return true;
}
