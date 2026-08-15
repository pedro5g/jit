/**
 * Declarative value operations.
 *
 * `.pipe(fn)` is convenient but opaque: the generated validator can only call
 * the closure. An operation chain says the same thing as data, so the emitter
 * writes it into the source — `v = v.trim().toLowerCase()` instead of
 * `v = __v3(v)`.
 *
 * This is not a runtime speed optimization. A monomorphic callback is inlined
 * by the engine, and both forms measure the same. What a chain buys is
 * ahead-of-time coverage: a callback that closes over its scope cannot be
 * serialized into a generated module, so `jit generate` skips the artifact.
 * A chain has no closure, so the same transform always generates.
 *
 * Both forms stay valid. `.pipe` accepts a chain (compiled) or a function
 * (unchanged), told apart by what it is, not by a flag.
 */

/** One step of a chain, able to emit itself as an expression. */
export interface OpStep {
  readonly kind: string;
  /**
   * Emits this step over `expr`. Runtime values travel through `bind`, never
   * interpolated — the same rule the rest of the compiler follows.
   */
  readonly emit: (expr: string, bind: (value: unknown) => string) => string;
}

const OPS = "__jitOps";

/** A chain of operations, recognizable at runtime and by the emitter. */
export interface OpChain<TInput = unknown, TOutput = unknown> {
  readonly [OPS]: readonly OpStep[];
  readonly _input?: TInput;
  readonly _output?: TOutput;
}

export interface StringOps extends OpChain<string, string> {
  trim(): StringOps;
  lowercase(): StringOps;
  uppercase(): StringOps;
  /** Unicode normalization; `NFC` unless another form is given. */
  normalize(form?: "NFC" | "NFD" | "NFKC" | "NFKD"): StringOps;
  slice(start: number, end?: number): StringOps;
  replace(pattern: string | RegExp, replacement: string): StringOps;
  padStart(length: number, pad?: string): StringOps;
  padEnd(length: number, pad?: string): StringOps;
  /** Collapses runs of whitespace into single spaces. */
  collapseWhitespace(): StringOps;
  toNumber(): NumberOps;
  toDate(): DateOps;
}

export interface NumberOps extends OpChain<number, number> {
  round(): NumberOps;
  floor(): NumberOps;
  ceil(): NumberOps;
  abs(): NumberOps;
  clamp(min: number, max: number): NumberOps;
  /** Rounds to a fixed number of decimal places, staying a number. */
  toFixed(digits: number): NumberOps;
  toText(): StringOps;
}

export interface DateOps extends OpChain<Date, Date> {
  /** Drops the time part, in UTC. */
  startOfDay(): DateOps;
  toISO(): StringOps;
  toEpoch(): NumberOps;
}

export type AnyOpChain = StringOps | NumberOps | DateOps;

/** True when a `.pipe` argument is a chain rather than a callback. */
export function isOpChain(value: unknown): value is OpChain {
  return typeof value === "object" && value !== null && Array.isArray((value as OpChain)[OPS]);
}

export function opSteps(chain: OpChain): readonly OpStep[] {
  return chain[OPS];
}

/**
 * Emits a whole chain over one expression, folding each step into the next
 * so the result is a single expression with no intermediate binding.
 */
export function emitOpChain(chain: OpChain, expr: string, bind: (value: unknown) => string): string {
  return opSteps(chain).reduce((current, step) => step.emit(current, bind), expr);
}

function chain(steps: readonly OpStep[]): AnyOpChain {
  const step = (kind: string, emit: OpStep["emit"]) => chain([...steps, { kind, emit }]);

  return {
    [OPS]: steps,

    trim: () => step("trim", (expr) => `${expr}.trim()`),
    lowercase: () => step("lowercase", (expr) => `${expr}.toLowerCase()`),
    uppercase: () => step("uppercase", (expr) => `${expr}.toUpperCase()`),
    normalize: (form: "NFC" | "NFD" | "NFKC" | "NFKD" = "NFC") =>
      step("normalize", (expr) => `${expr}.normalize(${JSON.stringify(form)})`),
    slice: (start: number, end?: number) =>
      step("slice", (expr) => `${expr}.slice(${start}${end === undefined ? "" : `, ${end}`})`),
    replace: (pattern: string | RegExp, replacement: string) =>
      step("replace", (expr, bind) => {
        // A regex is a runtime value: it is bound, never interpolated.
        const target = pattern instanceof RegExp ? bind(pattern) : JSON.stringify(pattern);

        return `${expr}.replace(${target}, ${JSON.stringify(replacement)})`;
      }),
    padStart: (length: number, pad = " ") =>
      step("padStart", (expr) => `${expr}.padStart(${length}, ${JSON.stringify(pad)})`),
    padEnd: (length: number, pad = " ") =>
      step("padEnd", (expr) => `${expr}.padEnd(${length}, ${JSON.stringify(pad)})`),
    collapseWhitespace: () => step("collapseWhitespace", (expr, bind) => `${expr}.replace(${bind(/\s+/g)}, " ")`),
    toNumber: () => step("toNumber", (expr) => `Number(${expr})`),
    toDate: () => step("toDate", (expr) => `new Date(${expr})`),

    round: () => step("round", (expr) => `Math.round(${expr})`),
    floor: () => step("floor", (expr) => `Math.floor(${expr})`),
    ceil: () => step("ceil", (expr) => `Math.ceil(${expr})`),
    abs: () => step("abs", (expr) => `Math.abs(${expr})`),
    clamp: (min: number, max: number) => step("clamp", (expr) => `Math.min(${max}, Math.max(${min}, ${expr}))`),
    toFixed: (digits: number) => step("toFixed", (expr) => `Number((${expr}).toFixed(${digits}))`),
    toText: () => step("toText", (expr) => `String(${expr})`),

    startOfDay: () => step("startOfDay", (expr) => `new Date(Math.floor((${expr}).getTime() / 86400000) * 86400000)`),
    toISO: () => step("toISO", (expr) => `(${expr}).toISOString()`),
    toEpoch: () => step("toEpoch", (expr) => `(${expr}).getTime()`),
  } as unknown as AnyOpChain;
}

/**
 * The entry point for a compiled transformation.
 *
 * @example
 * ```ts
 * const Handle = JIT.string().pipe(JIT.ops.trim().lowercase().slice(0, 20));
 * const Price = JIT.number().pipe(JIT.ops.clamp(0, 1000).toFixed(2));
 * ```
 */
export const ops: StringOps & NumberOps & DateOps = chain([]) as StringOps & NumberOps & DateOps;
