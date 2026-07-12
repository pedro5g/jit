import { JIT } from "@jit/compiler/runtime";

export type PlaygroundOp =
  | "validate"
  | "parse"
  | "equal"
  | "clone"
  | "diff"
  | "hash"
  | "update"
  | "stringify"
  | "mask"
  | "sanitize"
  | "codec"
  | "query"
  | "transform"
  | "mapper";

export interface PlaygroundRequest {
  id: number;
  code: string;
  op: PlaygroundOp;
  inputA: string;
  inputB: string;
}

export interface PlaygroundSuccess {
  id: number;
  ok: true;
  /** pretty-printed result of running the operation */
  result: string;
  /** generated source when the operation exposes it */
  source: string | null;
  compileMs: number;
  runMs: number;
}

export interface PlaygroundFailure {
  id: number;
  ok: false;
  error: string;
}

export type PlaygroundResponse = PlaygroundSuccess | PlaygroundFailure;

function safeStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, entry) => {
      if (typeof entry === "bigint") return `${entry}n`;
      if (entry instanceof Map) return { "[Map]": Object.fromEntries(entry) };
      if (entry instanceof Set) return { "[Set]": [...entry] };
      if (entry instanceof Uint8Array) return `Uint8Array(${entry.length})`;
      if (entry instanceof Error) return `${entry.name}: ${entry.message}`;
      if (typeof entry === "function") return `[function ${entry.name || "anonymous"}]`;
      if (entry !== null && typeof entry === "object") {
        if (seen.has(entry)) return "[circular]";
        seen.add(entry);
      }
      return entry;
    },
    2
  );
}

function hex(bytes: Uint8Array, limit = 48): string {
  const shown = [...bytes.slice(0, limit)].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return bytes.length > limit ? `${shown} … (+${bytes.length - limit} bytes)` : shown;
}

/**
 * Compiled artifacts are named functions produced by `new Function`, so their
 * toString() IS the real generated source. Runtime wrappers (arrow closures)
 * are rejected so we never present glue code as generated output.
 */
function sourceOf(fn: unknown): string | null {
  if (typeof fn !== "function") return null;
  const withSource = fn as { source?: unknown };
  if (typeof withSource.source === "string") return withSource.source;
  const text = Function.prototype.toString.call(fn);
  return /^function\s+\w*\s*\(/.test(text) && !text.includes("[native code]") ? text : null;
}

interface UserBindings {
  schema?: unknown;
  query?: unknown;
  transform?: unknown;
  mapper?: unknown;
}

/**
 * Executes user schema code with JIT in scope, then compiles and runs the
 * selected operation (guide §16: client-only, terminable worker, never on a
 * server, never logged). Import lines are stripped — JIT is injected. Besides
 * `schema`, the snippet may define `query`, `transform` and `mapper` bindings
 * for the pipeline operations.
 */
self.onmessage = (event: MessageEvent<PlaygroundRequest>) => {
  const { id, code, op, inputA, inputB } = event.data;

  const reply = (response: PlaygroundResponse) => self.postMessage(response);

  try {
    const body = code.replace(/^\s*import[^\n]*$/gm, "");
    const build = new Function(
      "JIT",
      `"use strict";\n${body}\n;return {
        schema: typeof schema === "undefined" ? undefined : schema,
        query: typeof query === "undefined" ? undefined : query,
        transform: typeof transform === "undefined" ? undefined : transform,
        mapper: typeof mapper === "undefined" ? undefined : mapper,
      };`
    );

    const compileStart = performance.now();
    const bindings = build(JIT) as UserBindings;

    const requireSchema = () => {
      if (!bindings.schema) throw new Error("define a `schema` binding, e.g. `const schema = JIT.object({ … })`");
      return bindings.schema as never;
    };

    const a: unknown = inputA.trim() === "" ? undefined : JSON.parse(inputA);
    const b: unknown = inputB.trim() === "" ? undefined : JSON.parse(inputB);
    // returns `never` so the values fit every compiled signature — the real
    // shape check is exactly what the compiled operations do at runtime
    const requireA = (label = "a JSON value"): never => {
      if (a === undefined) throw new Error(`this operation needs ${label} in input A`);
      return a as never;
    };
    const requireB = (label: string): never => {
      if (b === undefined) throw new Error(`this operation needs ${label} in input B`);
      return b as never;
    };

    let source: string | null = null;
    let run: () => unknown;

    switch (op) {
      case "validate": {
        const is = JIT.validate(requireSchema()).is().compile();
        const validator = JIT.validator(requireSchema());
        source = sourceOf(is);
        run = () => ({ is: is(requireA()), safeParse: validator.safeParse(requireA()) });
        break;
      }
      case "parse": {
        const parse = JIT.validate(requireSchema()).parse().compile();
        source = sourceOf(parse);
        run = () => {
          try {
            return parse(requireA());
          } catch (error) {
            return {
              thrown: error instanceof Error ? error.name : "Error",
              issues: (error as { issues?: unknown }).issues,
            };
          }
        };
        break;
      }
      case "equal": {
        const equal = JIT.equal(requireSchema()).compile();
        source = sourceOf(equal);
        run = () => equal(requireA(), requireB("a second value"));
        break;
      }
      case "clone": {
        const clone = JIT.clone(requireSchema()).compile();
        source = sourceOf(clone);
        run = () => {
          const out = clone(requireA());
          return { clone: out, newReference: out !== a };
        };
        break;
      }
      case "diff": {
        const diff = JIT.diff(requireSchema()).compile();
        source = sourceOf(diff);
        run = () => diff(requireA(), requireB("a second value"));
        break;
      }
      case "hash": {
        const hashFn = JIT.hash(requireSchema()).compile();
        source = sourceOf(hashFn);
        run = () => hashFn(requireA());
        break;
      }
      case "update": {
        const model = JIT.model(requireSchema());
        run = () => {
          const out = model.update(requireA() as never, requireB("a patch object") as never);
          return { updated: out, untouchedInput: out !== a };
        };
        break;
      }
      case "stringify": {
        const stringify = JIT.json(requireSchema()).stringify().compile();
        source = sourceOf(stringify);
        run = () => stringify(requireA() as never);
        break;
      }
      case "mask": {
        const mask = JIT.mask(requireSchema());
        run = () => mask(requireA() as never);
        // compiles lazily on first call — capture the source after running once
        run();
        source = sourceOf(mask);
        break;
      }
      case "sanitize": {
        const sanitize = JIT.sanitize(requireSchema());
        run = () => sanitize(requireA() as never);
        run();
        source = sourceOf(sanitize);
        break;
      }
      case "codec": {
        const codec = JIT.codec(requireSchema(), { version: 2 });
        source = sourceOf(codec.encode);
        run = () => {
          const bytes = codec.encode(requireA() as never);
          return { byteLength: bytes.length, wire: hex(bytes), decoded: codec.decode(bytes) };
        };
        break;
      }
      case "query": {
        const query = bindings.query as ((rows: unknown, params?: unknown) => unknown) | undefined;
        if (typeof query !== "function") {
          throw new Error(
            "define a `query` binding, e.g. `const query = JIT.query(JIT.array(schema)).filter(...).compile()`"
          );
        }
        source = sourceOf(query);
        run = () =>
          b === undefined ? query(requireA("a JSON array of rows")) : query(requireA("a JSON array of rows"), b);
        break;
      }
      case "transform": {
        const transform = bindings.transform as ((value: unknown) => unknown) | undefined;
        if (typeof transform !== "function") {
          throw new Error(
            "define a `transform` binding, e.g. `const transform = JIT.transform(schema).select(...).compile()`"
          );
        }
        source = sourceOf(transform);
        run = () => transform(requireA());
        break;
      }
      case "mapper": {
        const mapper = bindings.mapper as
          | { map: (value: unknown) => unknown; many: (values: unknown[]) => unknown }
          | undefined;
        if (!mapper || typeof mapper.map !== "function") {
          throw new Error("define a `mapper` binding, e.g. `const mapper = JIT.mapper(schema, Target, { … })`");
        }
        source = sourceOf(mapper.map);
        run = () => (Array.isArray(a) ? mapper.many(a) : mapper.map(requireA()));
        break;
      }
      default:
        throw new Error(`unknown operation: ${op satisfies never}`);
    }
    const compileMs = performance.now() - compileStart;

    const runStart = performance.now();
    const result = run();
    const runMs = performance.now() - runStart;

    reply({ id, ok: true, result: safeStringify(result), source, compileMs, runMs });
  } catch (error) {
    reply({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
