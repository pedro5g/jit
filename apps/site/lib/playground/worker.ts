import { JIT } from "@pedro5g/jit/runtime";

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
  | "codec";

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
 * Executes user schema code with JIT in scope, then compiles and runs the
 * selected operation (guide §16: client-only, terminable worker, never on a
 * server, never logged). Import lines are stripped — JIT is injected.
 */
self.onmessage = (event: MessageEvent<PlaygroundRequest>) => {
  const { id, code, op, inputA, inputB } = event.data;

  const reply = (response: PlaygroundResponse) => self.postMessage(response);

  try {
    const body = code.replace(/^\s*import[^\n]*$/gm, "");
    const build = new Function(
      "JIT",
      `"use strict";\n${body}\n;return typeof schema === "undefined" ? undefined : schema;`
    );
    const schema = build(JIT);
    if (!schema) {
      throw new Error("define a `schema` binding, e.g. `const schema = JIT.object({ … })`");
    }

    const a: unknown = inputA.trim() === "" ? undefined : JSON.parse(inputA);
    const b: unknown = inputB.trim() === "" ? undefined : JSON.parse(inputB);
    const requireA = () => {
      if (a === undefined) throw new Error("this operation needs a JSON value in input A");
      return a;
    };
    const requireB = (label: string) => {
      if (b === undefined) throw new Error(`this operation needs ${label} in input B`);
      return b;
    };

    let source: string | null = null;
    let run: () => unknown;

    const compileStart = performance.now();
    switch (op) {
      case "validate": {
        const is = JIT.validate(schema).is().compile();
        const validator = JIT.validator(schema);
        source = is.source;
        run = () => ({ is: is(requireA()), safeParse: validator.safeParse(requireA()) });
        break;
      }
      case "parse": {
        const parse = JIT.validate(schema).parse().compile();
        source = parse.source;
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
        const equal = JIT.equal(schema).compile();
        source = equal.source;
        run = () => equal(requireA(), requireB("a second value"));
        break;
      }
      case "clone": {
        const clone = JIT.clone(schema).compile();
        source = clone.source;
        run = () => {
          const out = clone(requireA());
          return { clone: out, newReference: out !== a };
        };
        break;
      }
      case "diff": {
        const diff = JIT.diff(schema).compile();
        source = diff.source;
        run = () => diff(requireA(), requireB("a second value"));
        break;
      }
      case "hash": {
        const hashFn = JIT.hash(schema).compile();
        source = hashFn.source;
        run = () => hashFn(requireA());
        break;
      }
      case "update": {
        const model = JIT.model(schema);
        run = () => {
          const out = model.update(requireA() as never, requireB("a patch object") as never);
          return { updated: out, untouchedInput: out !== a };
        };
        break;
      }
      case "stringify": {
        const stringify = JIT.json(schema).stringify().compile();
        source = stringify.source;
        run = () => stringify(requireA());
        break;
      }
      case "mask": {
        const model = JIT.model(schema);
        run = () => model.mask(requireA() as never);
        break;
      }
      case "sanitize": {
        const model = JIT.model(schema);
        run = () => model.sanitize(requireA() as never);
        break;
      }
      case "codec": {
        const codec = JIT.codec(schema, { version: 2 });
        run = () => {
          const bytes = codec.encode(requireA() as never);
          return { byteLength: bytes.length, wire: hex(bytes), decoded: codec.decode(bytes) };
        };
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
