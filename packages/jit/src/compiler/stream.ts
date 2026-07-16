import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { JITValidationError, type ValidationIssue } from "../errors/validation-error.js";
import type { CompileCacheOptions } from "../runtime/cache/compile-cache.js";
import { ArrayBoundaryScanner, ValueBoundaryScanner } from "../runtime/stream/boundary-scanner.js";
import { compileValidator } from "./validate.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

export interface StreamOptions<TItem = unknown> {
  /**
   * Input format. `"json"` (default) expects one JSON document; when the
   * schema root is an array, elements are validated as they complete.
   * `"ndjson"` expects one JSON document per line, each validated against
   * the schema (the schema describes a line, not the whole stream).
   */
  readonly format?: "json" | "ndjson";
  /** Called with each progressively validated element (array root / ndjson line). */
  readonly onItem?: (item: TItem, index: number) => void;
}

/**
 * A progressive validating JSON stream for one schema.
 *
 * `write` accepts network chunks (strings or bytes; UTF-8 sequences split
 * across chunks are handled) and fails fast: structural violations and
 * schema violations throw a consumable `JITValidationError` at the chunk
 * where they become undeniable — long before the document finishes.
 */
export interface CompiledStream<T, TItem = unknown> {
  /** Feeds one chunk; throws JITValidationError on the first impossible state. */
  readonly write: (chunk: string | Uint8Array) => void;
  /** Finishes the stream, returning the fully validated value. */
  readonly end: () => T;
  /** Elements validated so far (array root and ndjson formats). */
  readonly items: readonly TItem[];
}

interface SchemaCheckRecord {
  readonly kind: string;
  readonly value?: unknown;
}

function resolveRoot(schema: ATS.AnyTypeSchema): AnySchema {
  let current = schema as AnySchema;

  while (true) {
    switch (current.type) {
      case TypeName.default:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType as AnySchema;
        continue;
      case TypeName.lazy:
        current = (current.def.getter as () => AnySchema)();
        continue;
      default:
        return current;
    }
  }
}

/** First-byte gate: the character class the schema root demands, if rigid. */
function rootGate(schema: AnySchema): { test: (code: number) => boolean; expected: string } | undefined {
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
        test: (code) => code === 45 || (code >= 48 && code <= 57),
        expected: "number",
      };
    case TypeName.boolean:
      return {
        test: (code) => code === 116 || code === 102,
        expected: "boolean",
      };
    case TypeName.null:
      return { test: (code) => code === 110, expected: "null" };
    default:
      return undefined;
  }
}

function structuralIssue(message: string, path = ""): ValidationIssue {
  return { path, code: "invalid_json", expected: "well-formed JSON", message };
}

function throwStructural(message: string, path = ""): never {
  throw new JITValidationError([structuralIssue(message, path)]);
}

function prefixIssues(issues: readonly ValidationIssue[], prefix: string): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path === "" ? prefix : `${prefix}${issue.path.startsWith("[") ? "" : "."}${issue.path}`,
  }));
}

/**
 * Compiles a progressive validating stream for a schema.
 *
 * Array roots are validated element-by-element as chunks arrive — the
 * boundary FSM reassembles fragmented tokens, and the first invalid
 * element aborts the stream with its `[index].path` issue vector. Object
 * and scalar roots are structurally supervised per chunk (unbalanced
 * brackets and trailing garbage fail immediately) and fully validated on
 * `end()`. NDJSON validates one document per line.
 */
export function compileStream<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options: StreamOptions & CompileCacheOptions = {}
): CompiledStream<ATS.TypeofSchema<TSchema>> {
  const format = options.format ?? "json";
  const root = resolveRoot(schema);

  if (format === "ndjson") return createNdjsonStream(schema, options) as CompiledStream<ATS.TypeofSchema<TSchema>>;
  if (root.type === TypeName.array) return createArrayStream<TSchema>(root, options);
  return createValueStream(schema, root, options);
}

function createDecoder(): (chunk: string | Uint8Array, last: boolean) => string {
  const decoder = new TextDecoder();

  return (chunk, last) => (typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: !last }));
}

function gateFirstChar(text: string, gateRef: { pending: ReturnType<typeof rootGate> }): void {
  const gate = gateRef.pending;

  if (!gate) return;

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);

    if (code === 32 || code === 9 || code === 10 || code === 13) continue;
    gateRef.pending = undefined;
    if (!gate.test(code)) {
      throw new JITValidationError([
        {
          path: "",
          code: "invalid_type",
          expected: gate.expected,
          message: `stream root must be ${gate.expected}`,
          received: JSON.stringify(text[index]),
        },
      ]);
    }
    return;
  }
}

function createArrayStream<TSchema extends ATS.AnyTypeSchema>(
  root: AnySchema,
  options: StreamOptions
): CompiledStream<ATS.TypeofSchema<TSchema>> {
  const element = root.def.element as ATS.AnyTypeSchema;
  const checks = ((root.def.checks as readonly SchemaCheckRecord[] | undefined) ?? []).filter(
    (check) => check.kind === "min" || check.kind === "max" || check.kind === "length" || check.kind === "nonEmpty"
  );
  const validator = compileValidator(element);
  const decode = createDecoder();
  const items: unknown[] = [];
  const gateRef = { pending: rootGate(root) };
  let failed = false;
  let ended = false;

  const scanner = new ArrayBoundaryScanner({
    onElement(text) {
      let parsed: unknown;

      try {
        parsed = JSON.parse(text);
      } catch {
        throwStructural(`malformed JSON element at index ${items.length}`, `[${items.length}]`);
      }

      const result = validator.safeParse(parsed);

      if (!result.success) {
        throw new JITValidationError(prefixIssues(result.issues, `[${items.length}]`));
      }

      const index = items.length;

      items.push(result.data);
      // Early max check: abort as soon as the stream exceeds the bound.
      for (const check of checks) {
        if (check.kind === "max" && items.length > (check.value as number)) {
          throwStructural(`expected at most ${check.value} items`, "");
        }
      }
      options.onItem?.(result.data, index);
    },
    fail(message) {
      throwStructural(message);
    },
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
        if (check.kind === "min" && items.length < (check.value as number)) {
          throwStructural(`expected at least ${check.value} items`);
        }
        if (check.kind === "nonEmpty" && items.length === 0) {
          throwStructural("expected a non-empty array");
        }
        if (check.kind === "length" && items.length !== (check.value as number)) {
          throwStructural(`expected exactly ${check.value} items`);
        }
        if (check.kind === "max" && items.length > (check.value as number)) {
          throwStructural(`expected at most ${check.value} items`);
        }
      }

      return items as ATS.TypeofSchema<TSchema>;
    },
  };
}

function createValueStream<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  root: AnySchema,
  options: StreamOptions & CompileCacheOptions
): CompiledStream<ATS.TypeofSchema<TSchema>> {
  const validator = compileValidator(schema, options);
  const decode = createDecoder();
  const gateRef = { pending: rootGate(root) };
  const scanner = new ValueBoundaryScanner({
    fail(message) {
      throwStructural(message);
    },
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

      let parsed: unknown;

      try {
        parsed = JSON.parse(buffer);
      } catch {
        failed = true;
        throwStructural("unexpected end of stream: incomplete JSON document");
      }

      return validator.parse(parsed);
    },
  };
}

function createNdjsonStream<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options: StreamOptions & CompileCacheOptions
): CompiledStream<readonly ATS.TypeofSchema<TSchema>[], ATS.TypeofSchema<TSchema>> {
  const validator = compileValidator(schema, options);
  const decode = createDecoder();
  const items: ATS.TypeofSchema<TSchema>[] = [];
  let buffer = "";
  let line = 0;
  let failed = false;
  let ended = false;

  const consume = (text: string) => {
    if (text.trim() === "") {
      line++;
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throwStructural(`malformed JSON on line ${line}`, `line ${line}`);
    }

    const result = validator.safeParse(parsed);

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
    },
  };
}
