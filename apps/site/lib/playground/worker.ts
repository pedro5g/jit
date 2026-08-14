import { JIT } from "@jit-compiler/jit/runtime";

export type PlaygroundOp =
  | "validate"
  | "parse"
  | "equal"
  | "clone"
  | "diff"
  | "hash"
  | "update"
  | "reactiveUpdate"
  | "stringify"
  | "mask"
  | "sanitize"
  | "codec"
  | "query"
  | "lazy"
  | "visitor"
  | "watch"
  | "watchedList"
  | "binary"
  | "jsonChunks"
  | "transform"
  | "mapper"
  | "compile"
  | "dto"
  | "indexes";

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
  const ancestors: object[] = [];
  return JSON.stringify(
    value,
    function stringifyEntry(this: unknown, _key: string, entry: unknown) {
      if (typeof entry === "bigint") return `${entry}n`;
      if (entry instanceof Map) return { "[Map]": Object.fromEntries(entry) };
      if (entry instanceof Set) return { "[Set]": [...entry] };
      if (entry instanceof Uint8Array) return `Uint8Array(${entry.length})`;
      if (entry instanceof Error) return `${entry.name}: ${entry.message}`;
      if (typeof entry === "function") return `[function ${entry.name || "anonymous"}]`;
      if (entry !== null && typeof entry === "object") {
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
        if (ancestors.includes(entry)) return "[circular]";
        ancestors[ancestors.length] = entry;
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
 * Capability artifacts expose their API-free execution plan before lowering.
 * Legacy compiled functions still report their generated source directly.
 */
function sourceOf(fn: unknown): string | null {
  if (typeof fn !== "function") return null;
  const withPlan = fn as { plan?: unknown };
  if (withPlan.plan !== undefined) return JSON.stringify(withPlan.plan, null, 2);
  const withSource = fn as { source?: unknown };
  if (typeof withSource.source === "string") return withSource.source;
  const text = Function.prototype.toString.call(fn);
  return /^function\s+\w*\s*\(/.test(text) && !text.includes("[native code]") ? text : null;
}

interface UserBindings {
  schema?: unknown;
  query?: unknown;
  lazy?: unknown;
  visitor?: unknown;
  watch?: unknown;
  watchedList?: unknown;
  binary?: unknown;
  binaryQuery?: unknown;
  stringifyChunks?: unknown;
  transform?: unknown;
  mapper?: unknown;
  compiled?: unknown;
  dto?: unknown;
  indexes?: unknown;
  reactiveUpdate?: unknown;
}

interface PlaygroundWatchedList {
  add(item: unknown): void;
  remove(item: unknown): void;
  update(items: readonly unknown[]): void;
  snapshot(): unknown;
}

interface PlaygroundBinaryRowSet {
  readonly bytes: Uint8Array;
  readonly count: number;
  readonly layout: { readonly memoryLayout: string; readonly rowSize: number };
  hydrate(): unknown[];
  release(): void;
}

interface PlaygroundBinaryArray {
  load(values: readonly unknown[]): PlaygroundBinaryRowSet;
}

/**
 * Executes user schema code with JIT in scope, then compiles and runs the
 * selected operation (guide §16: client-only, terminable worker, never on a
 * server, never logged). Import lines are stripped — JIT is injected. Besides
 * `schema`, the snippet may define operation-specific bindings returned below.
 */
export function executePlaygroundRequest(request: PlaygroundRequest): PlaygroundResponse {
  const { id, code, op, inputA, inputB } = request;

  try {
    const body = code.replace(/^\s*import[^\n]*$/gm, "");
    const build = new Function(
      "JIT",
      `"use strict";\n${body}\n;return {
        schema: typeof schema === "undefined" ? undefined : schema,
        query: typeof query === "undefined" ? undefined : query,
        lazy: typeof lazy === "undefined" ? undefined : lazy,
        visitor: typeof visitor === "undefined" ? undefined : visitor,
        watch: typeof watch === "undefined" ? undefined : watch,
        watchedList: typeof watchedList === "undefined" ? undefined : watchedList,
        binary: typeof binary === "undefined" ? undefined : binary,
        binaryQuery: typeof binaryQuery === "undefined" ? undefined : binaryQuery,
        stringifyChunks: typeof stringifyChunks === "undefined" ? undefined : stringifyChunks,
        transform: typeof transform === "undefined" ? undefined : transform,
        mapper: typeof mapper === "undefined" ? undefined : mapper,
        compiled: typeof compiled === "undefined" ? undefined : compiled,
        dto: typeof dto === "undefined" ? undefined : dto,
        indexes: typeof indexes === "undefined" ? undefined : indexes,
        reactiveUpdate: typeof reactiveUpdate === "undefined" ? undefined : reactiveUpdate,
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
        const is = JIT.validate.is(requireSchema());
        const safeParse = JIT.validate.safeParse(requireSchema());
        source = sourceOf(is);
        run = () => ({ is: is(requireA()), safeParse: safeParse(requireA()) });
        break;
      }
      case "parse": {
        const parse = JIT.validate.parse(requireSchema());
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
        const update = JIT.update(requireSchema()).compile();
        run = () => {
          const out = update(requireA() as never, requireB("a patch object") as never);
          return { updated: out, untouchedInput: out !== a };
        };
        break;
      }
      case "reactiveUpdate": {
        const reactiveUpdate = bindings.reactiveUpdate as ((initial: unknown, patches: unknown) => unknown) | undefined;
        if (typeof reactiveUpdate !== "function") {
          throw new Error("define a `reactiveUpdate` binding that creates `JIT.update(schema).reactive(initial)`");
        }
        run = () => reactiveUpdate(requireA("the initial JSON value"), requireB("a JSON patch array"));
        break;
      }
      case "stringify": {
        const stringify = JIT.json.stringify(requireSchema());
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
        const encode = JIT.binary.encode(requireSchema());
        const decode = JIT.binary.decode(requireSchema());
        source = sourceOf(encode);
        run = () => {
          const bytes = encode(requireA() as never);
          return { byteLength: bytes.length, wire: hex(bytes), decoded: decode(bytes) };
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
      case "lazy": {
        const lazy = bindings.lazy as ((rows: unknown, params?: unknown) => Iterable<unknown>) | undefined;
        if (typeof lazy !== "function") {
          throw new Error(
            "define a `lazy` binding, e.g. `const lazy = JIT.query(JIT.array(schema)).take(10).compileIterator()`"
          );
        }
        source = sourceOf(lazy);
        run = () => [
          ...(b === undefined ? lazy(requireA("a JSON array of rows")) : lazy(requireA("a JSON array of rows"), b)),
        ];
        break;
      }
      case "visitor": {
        const visitor = bindings.visitor as
          | ((rows: unknown, consumeOrParams: unknown, consume?: (value: unknown) => void) => number)
          | undefined;
        if (typeof visitor !== "function") {
          throw new Error(
            "define a `visitor` binding, e.g. `const visitor = JIT.query(JIT.array(schema)).compileVisitor()`"
          );
        }
        source = sourceOf(visitor);
        run = () => {
          const values: unknown[] = [];
          const consume = (value: unknown) => {
            values[values.length] = value;
          };
          const visited =
            b === undefined
              ? visitor(requireA("a JSON array of rows"), consume)
              : visitor(requireA("a JSON array of rows"), b, consume);
          return { visited, values };
        };
        break;
      }
      case "watch": {
        const watch = bindings.watch as ((previous: unknown, current: unknown) => unknown) | undefined;
        if (typeof watch !== "function") {
          throw new Error('define a `watch` binding, e.g. `const watch = JIT.watch(JIT.array(schema), { key: "id" })`');
        }
        source = sourceOf(watch);
        run = () => watch(requireA("the previous JSON collection"), requireB("the current JSON collection"));
        break;
      }
      case "watchedList": {
        const createWatchedList = bindings.watchedList as
          | ((initialItems: readonly unknown[]) => PlaygroundWatchedList)
          | undefined;
        if (typeof createWatchedList !== "function") {
          throw new Error(
            'define a `watchedList` factory, e.g. `const watchedList = (initial) => JIT.watchedList(Users, initial, { key: "id" })`'
          );
        }
        run = () => {
          requireA("a JSON array of initial items");
          requireB("a JSON array of watched-list actions");
          if (!Array.isArray(a) || !Array.isArray(b)) {
            throw new Error("watchedList expects an initial array and an action array");
          }
          const list = createWatchedList(a);
          for (const action of b) {
            if (action === null || typeof action !== "object") {
              throw new Error("every watched-list action must be an object");
            }
            const entry = action as { readonly type?: unknown; readonly item?: unknown; readonly items?: unknown };
            if (entry.type === "add") list.add(entry.item);
            else if (entry.type === "remove") list.remove(entry.item);
            else if (entry.type === "update" && Array.isArray(entry.items)) list.update(entry.items);
            else throw new Error('watched-list actions use { type: "add" | "remove" | "update", ... }');
          }
          return list.snapshot();
        };
        break;
      }
      case "binary": {
        const binary = bindings.binary as PlaygroundBinaryArray | undefined;
        const binaryQuery = bindings.binaryQuery as ((rowset: PlaygroundBinaryRowSet) => unknown) | undefined;
        if (!binary || typeof binary.load !== "function" || typeof binaryQuery !== "function") {
          throw new Error(
            "define `binary` and `binaryQuery` bindings from an array binary layout and `JIT.query(binary)`"
          );
        }
        source = sourceOf(binaryQuery);
        run = () => {
          const rows = requireA("a JSON array of flat rows");
          if (!Array.isArray(rows)) throw new Error("binary expects a JSON array of flat rows");
          const rowset = binary.load(rows);
          try {
            return {
              rows: rowset.count,
              bytes: rowset.bytes.byteLength,
              layout: rowset.layout.memoryLayout,
              rowSize: rowset.layout.rowSize,
              result: binaryQuery(rowset),
              hydrated: rowset.hydrate(),
            };
          } finally {
            rowset.release();
          }
        };
        break;
      }
      case "jsonChunks": {
        const stringifyChunks = bindings.stringifyChunks as ((value: unknown) => IterableIterator<string>) | undefined;
        if (typeof stringifyChunks !== "function") {
          throw new Error("define a `stringifyChunks` binding with `JIT.json.stringifyChunks(schema, { chunkBytes })`");
        }
        source = sourceOf(stringifyChunks);
        run = () => {
          const chunks = [...stringifyChunks(requireA())];
          return { chunks, chunkCount: chunks.length, json: chunks.join("") };
        };
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
        const mapper = bindings.mapper as ((value: unknown) => unknown) | undefined;
        if (typeof mapper !== "function") {
          throw new Error("define a map artifact, e.g. `const mapper = JIT.map(schema, Target, { … })`");
        }
        source = sourceOf(mapper);
        run = () => mapper(requireA());
        break;
      }
      case "compile": {
        const compiled = bindings.compiled as
          | {
              readonly ops?: readonly string[];
              readonly is?: (value: unknown) => boolean;
              readonly parse?: (value: unknown) => unknown;
              readonly clone?: (value: unknown) => unknown;
            }
          | undefined;
        if (!compiled || !Array.isArray(compiled.ops)) {
          throw new Error("define a `compiled` artifact group, e.g. `JIT.compile(schema, { is: JIT.is(schema) })`");
        }
        run = () => ({
          operations: compiled.ops,
          is: compiled.is?.(requireA()),
          parsed: compiled.parse?.(requireA()),
          cloned: compiled.clone?.(requireA()),
        });
        break;
      }
      case "dto": {
        const dto = bindings.dto as
          | (((value: unknown) => unknown) & {
              readonly schema?: unknown;
              readonly plan?: unknown;
            })
          | undefined;
        if (!dto || typeof dto !== "function" || dto.schema === undefined) {
          throw new Error("define a map artifact with `JIT.from(source).map(JIT.dto(target), mapping)`");
        }
        run = () => {
          const output = dto(requireA());
          const is = JIT.validate.is(dto.schema as never);
          const stringify = JIT.json.stringify(dto.schema as never);

          return {
            plan: dto.plan,
            dto: output,
            valid: is(output),
            json: stringify(output as never),
          };
        };
        break;
      }
      case "indexes": {
        const indexes = bindings.indexes as
          | {
              readonly entityEqual: (left: unknown, right: unknown) => boolean;
              readonly indexedEqual: (left: unknown, right: unknown) => boolean;
              readonly keyedEqual: (left: unknown, right: unknown) => boolean;
              readonly normalize: (value: unknown) => unknown;
              readonly keyedQuery: (value: unknown) => unknown;
            }
          | undefined;
        if (!indexes || typeof indexes.indexedEqual !== "function") {
          throw new Error("define an `indexes` binding with entity/indexBy/keyed compiled operations");
        }
        source = sourceOf(indexes.indexedEqual);
        run = () => {
          const left = requireA("the first entity collection");
          const right = requireB("the reordered entity collection");

          return {
            entityOnlyEqual: indexes.entityEqual(left, right),
            indexByEqual: indexes.indexedEqual(left, right),
            keyedEqual: indexes.keyedEqual(left, right),
            normalized: indexes.normalize(left),
            queryMap: indexes.keyedQuery(left),
          };
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

    return { id, ok: true, result: safeStringify(result), source, compileMs, runMs };
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

if (typeof self !== "undefined") {
  self.onmessage = (event: MessageEvent<PlaygroundRequest>) => {
    self.postMessage(executePlaygroundRequest(event.data));
  };
}
