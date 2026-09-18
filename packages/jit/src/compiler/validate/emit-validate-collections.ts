import type * as ATS from "../../core/ats/index.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitSchemaGuard } from "../source/guard.js";
import { emitLiteral } from "../source/literal.js";
import type { AnySchema, PathRef, SchemaCheckRecord, ValidatorEmitter } from "./emit-validate.js";
import { emitArrayCheck } from "./emit-validate-array-checks.js";
import {
  dynamicChild,
  dynamicKeyChild,
  isShallowOption,
  literalTag,
  needsBuild,
  rootPath,
  staticChild,
} from "./emit-validate-helpers.js";
export function emitArray(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const element = schema.def.element as ATS.AnyTypeSchema;
  const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];
  const build = emitter.mode !== "is" && needsBuild(element);
  const out = build ? emitter.nextVar("b") : value;

  if (build) emitter.writer.line(`let ${out};`);

  emitter.typeGate(
    `!Array.isArray(${value})`,
    path,
    "expected_array",
    "array",
    emitter.requiredMessage(schema, "expected array"),
    () => {
      for (const check of checks) {
        emitArrayCheck(emitter, check, value, path);
      }

      const index = emitter.nextVar("i");

      if (build) emitter.writer.line(`${out} = new Array(${value}.length);`);
      emitter.writer.line(`for (let ${index} = 0; ${index} < ${value}.length; ${index}++) {`);
      emitter.writer.indent(() => {
        const elementOut = emitter.emitNode(element, `${value}[${index}]`, dynamicChild(path, index));

        if (build) emitter.writer.line(`${out}[${index}] = ${elementOut};`);
      });
      emitter.writer.line("}");
    },
    `typeof ${value}`
  );

  if (build) emitter.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
  return out;
}

export function emitTuple(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const items = (schema.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
  const rest = schema.def.rest as ATS.AnyTypeSchema | undefined;
  const build =
    emitter.mode !== "is" && (items.some((item) => needsBuild(item)) || (rest !== undefined && needsBuild(rest)));
  const out = build ? emitter.nextVar("b") : value;

  if (build) emitter.writer.line(`let ${out};`);

  emitter.typeGate(
    `!Array.isArray(${value})`,
    path,
    "expected_array",
    "tuple",
    emitter.requiredMessage(schema, "expected tuple"),
    () => {
      const lengthTest = rest ? `${value}.length < ${items.length}` : `${value}.length !== ${items.length}`;

      emitter.failIf(
        lengthTest,
        path,
        "invalid_length",
        rest ? `length >= ${items.length}` : `length === ${items.length}`,
        rest ? `expected at least ${items.length} items` : `expected exactly ${items.length} items`
      );

      if (build) emitter.writer.line(`${out} = new Array(${value}.length);`);

      items.forEach((item, position) => {
        const itemOut = emitter.emitNode(item, `${value}[${position}]`, staticChild(path, position));

        if (build) emitter.writer.line(`${out}[${position}] = ${itemOut};`);
      });

      if (rest) {
        const index = emitter.nextVar("i");

        emitter.writer.line(`for (let ${index} = ${items.length}; ${index} < ${value}.length; ${index}++) {`);
        emitter.writer.indent(() => {
          const restOut = emitter.emitNode(rest, `${value}[${index}]`, dynamicChild(path, index));

          if (build) emitter.writer.line(`${out}[${index}] = ${restOut};`);
        });
        emitter.writer.line("}");
      }
    },
    `typeof ${value}`
  );

  if (build) emitter.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
  return out;
}

export function emitSet(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const element = schema.def.element as ATS.AnyTypeSchema;
  const build = emitter.mode !== "is" && needsBuild(element);
  const out = build ? emitter.nextVar("b") : value;

  if (build) emitter.writer.line(`let ${out};`);

  emitter.typeGate(
    `!(${value} instanceof Set)`,
    path,
    "expected_set",
    "Set",
    emitter.requiredMessage(schema, "expected a Set"),
    () => {
      const item = emitter.nextVar("e");

      if (build) emitter.writer.line(`${out} = new Set();`);
      emitter.writer.line(`for (const ${item} of ${value}) {`);
      emitter.writer.indent(() => {
        const elementOut = emitter.emitNode(element, item, staticChild(path, "element"));

        if (build) emitter.writer.line(`${out}.add(${elementOut});`);
      });
      emitter.writer.line("}");
    },
    `typeof ${value}`
  );

  if (build) emitter.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
  return out;
}

export function emitMap(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const keySchema = schema.def.key as ATS.AnyTypeSchema;
  const valueSchema = schema.def.value as ATS.AnyTypeSchema;
  const build = emitter.mode !== "is" && (needsBuild(keySchema) || needsBuild(valueSchema));
  const out = build ? emitter.nextVar("b") : value;

  if (build) emitter.writer.line(`let ${out};`);

  emitter.typeGate(
    `!(${value} instanceof Map)`,
    path,
    "expected_map",
    "Map",
    emitter.requiredMessage(schema, "expected a Map"),
    () => {
      const entry = emitter.nextVar("e");

      if (build) emitter.writer.line(`${out} = new Map();`);
      emitter.writer.line(`for (const ${entry} of ${value}) {`);
      emitter.writer.indent(() => {
        const keyOut = emitter.emitNode(keySchema, `${entry}[0]`, staticChild(path, "key"));
        const valueOut = emitter.emitNode(valueSchema, `${entry}[1]`, staticChild(path, "value"));

        if (build) emitter.writer.line(`${out}.set(${keyOut}, ${valueOut});`);
      });
      emitter.writer.line("}");
    },
    `typeof ${value}`
  );

  if (build) emitter.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
  return out;
}

export function emitRecord(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const valueSchema = schema.def.value as ATS.AnyTypeSchema;
  const build = emitter.mode !== "is" && needsBuild(valueSchema);
  const out = build ? emitter.nextVar("b") : value;

  if (build) emitter.writer.line(`let ${out};`);

  emitter.typeGate(
    `${value} === null || typeof ${value} !== "object" || Array.isArray(${value})`,
    path,
    "expected_object",
    "record",
    emitter.requiredMessage(schema, "expected a plain object"),
    () => {
      const keys = emitter.nextVar("k");
      const index = emitter.nextVar("i");

      if (build) emitter.writer.line(`${out} = {};`);
      emitter.writer.dynamicLine(`const ${keys} = Object.keys(${value});`);
      emitter.writer.line(`for (let ${index} = 0; ${index} < ${keys}.length; ${index}++) {`);
      emitter.writer.indent(() => {
        const valueOut = emitter.emitNode(
          valueSchema,
          `${value}[${keys}[${index}]]`,
          dynamicKeyChild(path, `${keys}[${index}]`)
        );

        if (build) emitter.writer.line(`${out}[${keys}[${index}]] = ${valueOut};`);
      });
      emitter.writer.line("}");
    },
    `typeof ${value}`
  );

  if (build) emitter.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
  return out;
}

export function emitObject(
  emitter: ValidatorEmitter,
  schema: AnySchema,
  value: string,
  path: PathRef,
  fieldTransforms: Readonly<Record<string, string>> | undefined
): string {
  const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
  const unknownKeys = schema.def.unknownKeys as "strip" | "passthrough" | "strict" | undefined;
  const catchall = schema.def.catchall as ATS.AnyTypeSchema | undefined;
  const keys = Object.keys(props);
  const catchallBuild = catchall !== undefined && needsBuild(catchall);
  const preserveUnknownKeys = unknownKeys === "passthrough" || catchall !== undefined;
  const build =
    emitter.mode !== "is" &&
    (fieldTransforms !== undefined ||
      unknownKeys === "strip" ||
      catchallBuild ||
      keys.some((key) => needsBuild(props[key])));
  const out = build ? emitter.nextVar("b") : value;

  if (build) emitter.writer.line(`let ${out};`);

  emitter.typeGate(
    `${value} === null || typeof ${value} !== "object" || Array.isArray(${value})`,
    path,
    "expected_object",
    "object",
    emitter.requiredMessage(schema, "expected object"),
    () =>
      emitObjectBody(
        emitter,
        props,
        value,
        path,
        fieldTransforms,
        keys,
        unknownKeys,
        catchall,
        catchallBuild,
        build,
        preserveUnknownKeys,
        out
      ),
    `typeof ${value}`
  );

  if (build) emitter.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
  return out;
}

function emitObjectBody(
  emitter: ValidatorEmitter,
  props: Readonly<Record<string, ATS.AnyTypeSchema>>,
  value: string,
  path: PathRef,
  fieldTransforms: Readonly<Record<string, string>> | undefined,
  keys: readonly string[],
  unknownKeys: "strip" | "passthrough" | "strict" | undefined,
  catchall: ATS.AnyTypeSchema | undefined,
  catchallBuild: boolean,
  build: boolean,
  preserveUnknownKeys: boolean,
  out: string
): void {
  const outputs = keys.map((key) => {
    const propOut = emitter.emitNode(props[key], emitPropertyAccess(value, key), staticChild(path, key), value);
    const transform = fieldTransforms?.[key];
    return { key, expr: transform ? `${transform}(${propOut}, ${value})` : propOut };
  });

  if (build && preserveUnknownKeys) emitter.writer.line(`${out} = Object.assign({}, ${value});`);
  if (unknownKeys === "strict" || catchall !== undefined)
    emitUnknownObjectKeys(emitter, value, path, keys, unknownKeys, catchall, catchallBuild, build, out);
  if (build) emitObjectOutput(emitter, outputs, preserveUnknownKeys, out);
}

function emitUnknownObjectKeys(
  emitter: ValidatorEmitter,
  value: string,
  path: PathRef,
  keys: readonly string[],
  unknownKeys: "strip" | "passthrough" | "strict" | undefined,
  catchall: ATS.AnyTypeSchema | undefined,
  catchallBuild: boolean,
  build: boolean,
  out: string
): void {
  const known = emitter.nextVar("k");
  const index = emitter.nextVar("i");
  const keyTest = keys.map((key) => `${known}[${index}] !== ${emitLiteral(key)}`).join(" && ");
  const unknownTest = keys.length === 0 ? "true" : keyTest;
  emitter.writer.dynamicLine(`const ${known} = Object.keys(${value});`);
  emitter.writer.line(`for (let ${index} = 0; ${index} < ${known}.length; ${index}++) {`);
  emitter.writer.indent(() => {
    if (unknownKeys === "strict") {
      emitter.failIf(
        unknownTest,
        dynamicKeyChild(path, `${known}[${index}]`),
        "unknown_key",
        "known keys only",
        "object contains unknown keys"
      );
      return;
    }
    if (catchall !== undefined)
      emitCatchallObjectKey(emitter, catchall, value, path, known, index, catchallBuild, build, out, unknownTest);
  });
  emitter.writer.line("}");
}

function emitCatchallObjectKey(
  emitter: ValidatorEmitter,
  catchall: ATS.AnyTypeSchema,
  value: string,
  path: PathRef,
  known: string,
  index: string,
  catchallBuild: boolean,
  build: boolean,
  out: string,
  unknownTest: string
): void {
  emitter.writer.line(`if (${unknownTest}) {`);
  emitter.writer.indent(() => {
    const catchallOut = emitter.emitNode(
      catchall,
      `${value}[${known}[${index}]]`,
      dynamicKeyChild(path, `${known}[${index}]`)
    );
    if (build && catchallBuild) emitter.writer.line(`${out}[${known}[${index}]] = ${catchallOut};`);
  });
  emitter.writer.line("}");
}

function emitObjectOutput(
  emitter: ValidatorEmitter,
  outputs: readonly { readonly key: string; readonly expr: string }[],
  preserveUnknownKeys: boolean,
  out: string
): void {
  if (!preserveUnknownKeys) {
    const entries = outputs.map((entry) => `${emitLiteral(entry.key)}: ${entry.expr}`).join(", ");
    emitter.writer.line(`${out} = { ${entries} };`);
    return;
  }
  for (const entry of outputs) emitter.writer.line(`${emitPropertyAccess(out, entry.key)} = ${entry.expr};`);
}

/**
 * Deep union validation: every option becomes a hoisted boolean predicate
 * (same Function scope, so `__v*` bindings stay reachable) running the full
 * is-mode pipeline — inner checks and refines included. Parse mode selects
 * the branch with the predicate and re-runs parse only for options that
 * rebuild their output (defaults/transforms/string mutations); coercions
 * inside union options do not participate in branch selection.
 */
export function emitUnion(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const options = schema.def.options as ATS.AnyTypeSchema[];
  // Shallow options (literal/enum/primitive without checks) stay inline —
  // their guard already is the complete validation, no call overhead.
  const tests = options.map((option) =>
    isShallowOption(option) ? `(${emitSchemaGuard(option, value)})` : `${emitter.emitOptionPredicate(option)}(${value})`
  );
  const matchTest = tests.join(" || ");

  if (emitter.mode === "is" || options.every((option) => !needsBuild(option))) {
    emitter.failIf(
      options.length === 0 ? "true" : `!(${matchTest})`,
      path,
      "invalid_union",
      "union",
      emitter.requiredMessage(schema, "value matched no union option")
    );
    return value;
  }

  const out = emitter.nextVar("o");

  emitter.writer.line(`let ${out} = ${value};`);
  emitOptionBranches(emitter, options, tests, value, path, out, () => {
    emitter.emitFail(path, "invalid_union", "union", emitter.requiredMessage(schema, "value matched no union option"));
  });
  return out;
}

export function emitXor(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const options = schema.def.options as ATS.AnyTypeSchema[];
  const tests = options.map((option) => `${emitter.emitOptionPredicate(option)}(${value})`);
  const count = tests.length === 0 ? "0" : tests.map((test) => `(${test} ? 1 : 0)`).join(" + ");
  const build = emitter.mode !== "is" && options.some(needsBuild);

  if (emitter.mode === "is" || !build) {
    emitter.failIf(
      `${count} !== 1`,
      path,
      "invalid_xor",
      "exactly one schema",
      emitter.requiredMessage(schema, "value must match exactly one schema")
    );
    return value;
  }

  const out = emitter.nextVar("o");

  emitter.writer.line(`let ${out} = ${value};`);
  emitter.writer.line(`if (${count} !== 1) {`);
  emitter.writer.indent(() => {
    emitter.emitFail(path, "invalid_xor", "exactly one schema", "value must match exactly one schema");
  });
  emitter.writer.line("} else {");
  emitter.writer.indent(() => {
    emitOptionBranches(emitter, options, tests, value, path, out);
  });
  emitter.writer.line("}");
  return out;
}

function emitOptionBranches(
  emitter: ValidatorEmitter,
  options: readonly ATS.AnyTypeSchema[],
  tests: readonly string[],
  value: string,
  path: PathRef,
  output: string,
  noMatch?: () => void
): void {
  options.forEach((option, position) => {
    emitter.writer.line(`${position === 0 ? "if" : "} else if"} (${tests[position]}) {`);
    emitter.writer.indent(() => {
      if (needsBuild(option)) {
        const branchOut = emitter.emitNode(option, value, path);

        emitter.writer.line(`${output} = ${branchOut};`);
      }
    });
  });
  if (noMatch !== undefined) {
    emitter.writer.line("} else {");
    emitter.writer.indent(noMatch);
    emitter.writer.line("}");
  } else if (options.length > 0) {
    emitter.writer.line("}");
  }
}

/** Emits (once per option schema) a hoisted `function iuN(value)` deep check. */
export function emitOptionPredicate(emitter: ValidatorEmitter, option: ATS.AnyTypeSchema): string {
  const existing = emitter.predicateNames.get(option);

  if (existing) return existing;

  const name = `${emitter.rootMode === "is" ? "iu" : "pu"}${++emitter.helperCounter}`;
  const savedWriter = emitter.writer;
  const savedMode = emitter.mode;
  const savedAwaited = emitter.awaited;

  emitter.predicateNames.set(option, name);
  emitter.writer = new CodeWriter();
  emitter.mode = "is";
  // Predicates are plain sync functions — `await` may not appear inside.
  emitter.awaited = false;
  emitter.writer.line(`function ${name}(value) {`);
  emitter.writer.indent(() => {
    emitter.emitNode(option, "value", rootPath());
    emitter.writer.line("return true;");
  });
  emitter.writer.line("}");
  emitter.helperSources.push(emitter.writer.toString());
  emitter.writer = savedWriter;
  emitter.mode = savedMode;
  emitter.awaited = savedAwaited;
  return name;
}

export function emitDiscriminatedUnion(
  emitter: ValidatorEmitter,
  schema: AnySchema,
  value: string,
  path: PathRef
): string {
  const discriminator = schema.def.discriminator as string;
  const options = schema.def.options as ATS.AnyTypeSchema[];
  const tagged = options
    .map((option) => ({ option, tag: literalTag(option, discriminator) }))
    .filter((entry): entry is { option: ATS.AnyTypeSchema; tag: string | number } => entry.tag !== undefined);
  const build = emitter.mode !== "is" && tagged.some((entry) => needsBuild(entry.option));
  const out = build ? emitter.nextVar("o") : value;

  if (build) emitter.writer.line(`let ${out} = ${value};`);

  emitter.typeGate(
    `${value} === null || typeof ${value} !== "object"`,
    path,
    "expected_object",
    "object",
    emitter.requiredMessage(schema, "expected object"),
    () => {
      if (tagged.length === 0) {
        emitter.emitFail(
          path,
          "invalid_union",
          "discriminated union",
          emitter.requiredMessage(schema, "unknown discriminator value")
        );
        return;
      }

      const tag = emitter.nextVar("t");

      emitter.writer.line(`const ${tag} = ${emitPropertyAccess(value, discriminator)};`);

      tagged.forEach((entry, position) => {
        emitter.writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${emitLiteral(entry.tag)}) {`);
        emitter.writer.indent(() => {
          const branchOut = emitter.emitNode(entry.option, value, path);

          if (build) emitter.writer.line(`${out} = ${branchOut};`);
        });
      });
      emitter.writer.line("} else {");
      emitter.writer.indent(() => {
        emitter.emitFail(
          path,
          "invalid_union",
          "discriminated union",
          emitter.requiredMessage(schema, "unknown discriminator value")
        );
      });
      emitter.writer.line("}");
    },
    `typeof ${value}`
  );

  return out;
}
