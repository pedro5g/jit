/**
 * Declarative value operations used by schema transforms and the compiler.
 *
 * An operation chain keeps a transform serializable: the validator can emit
 * the chain into generated source, while a callback remains available for
 * transformations that need runtime state.
 */

/**
 * One step of a chain, able to emit itself as an expression.
 *
 * @example
 * ```ts
 * const handle = JIT.string().pipe(JIT.ops.trim().lowercase());
 * ```
 */
export interface OpStep {
  readonly kind: string;
  /** Emits this step over `expr`, binding runtime values instead of interpolating them. */
  readonly emit: (expr: string, bind: (value: unknown) => string) => string;
}

const OPS = "__jitOps";

/**
 * A chain of operations, recognizable at runtime and by the emitter.
 *
 * @example
 * ```ts
 * const clean = JIT.string().pipe(JIT.ops.trim().collapseWhitespace());
 * ```
 */
export interface OpChain<TInput = unknown, TOutput = unknown> {
  readonly [OPS]: readonly OpStep[];
  readonly _input?: TInput;
  readonly _output?: TOutput;
}

/**
 * String operations available under `JIT.ops`.
 *
 * @example
 * ```ts
 * const slug = JIT.string().pipe(JIT.ops.trim().lowercase().replace(" ", "-"));
 * ```
 */
export interface StringOps extends OpChain<string, string> {
  /** Removes leading and trailing whitespace. */
  trim(): StringOps;
  /** Converts the string to lower case. */
  lowercase(): StringOps;
  /** Converts the string to upper case. */
  uppercase(): StringOps;
  /** Unicode normalization; `NFC` unless another form is given. */
  normalize(form?: "NFC" | "NFD" | "NFKC" | "NFKD"): StringOps;
  /** Returns the substring between `start` and the optional `end` index. */
  slice(start: number, end?: number): StringOps;
  /** Replaces matching text or a bound regular expression with `replacement`. */
  replace(pattern: string | RegExp, replacement: string): StringOps;
  /** Pads on the left until the string reaches `length`. */
  padStart(length: number, pad?: string): StringOps;
  /** Pads on the right until the string reaches `length`. */
  padEnd(length: number, pad?: string): StringOps;
  /** Collapses runs of whitespace into single spaces. */
  collapseWhitespace(): StringOps;
  /** Converts the string with JavaScript's `Number()` conversion. */
  toNumber(): NumberOps;
  /** Converts the string to a JavaScript `Date`. */
  toDate(): DateOps;
}

/**
 * Number operations available under `JIT.ops`.
 *
 * @example
 * ```ts
 * const cents = JIT.number().pipe(JIT.ops.round().clamp(0, 100));
 * ```
 */
export interface NumberOps extends OpChain<number, number> {
  /** Rounds to the nearest integer. */
  round(): NumberOps;
  /** Rounds down to the next lower integer. */
  floor(): NumberOps;
  /** Rounds up to the next higher integer. */
  ceil(): NumberOps;
  /** Returns the absolute value. */
  abs(): NumberOps;
  /** Clamps the number to the inclusive `[min, max]` range. */
  clamp(min: number, max: number): NumberOps;
  /** Rounds to a fixed number of decimal places, staying a number. */
  toFixed(digits: number): NumberOps;
  /** Converts the number to text. */
  toText(): StringOps;
}

/**
 * Date operations available under `JIT.ops`.
 *
 * @example
 * ```ts
 * const day = JIT.date().pipe(JIT.ops.startOfDay().toISO());
 * ```
 */
export interface DateOps extends OpChain<Date, Date> {
  /** Drops the time part, in UTC. */
  startOfDay(): DateOps;
  /** Converts the date to an ISO 8601 string. */
  toISO(): StringOps;
  /** Returns the Unix epoch time in milliseconds. */
  toEpoch(): NumberOps;
}

/**
 * Union of all built-in operation-chain surfaces.
 *
 * @example
 * ```ts
 * const operation: AnyOpChain = JIT.ops.trim();
 * ```
 */
export type AnyOpChain = StringOps | NumberOps | DateOps;

/** True when a `.pipe` argument is a chain rather than a callback. */
export function isOpChain(value: unknown): value is OpChain {
  return typeof value === "object" && value !== null && Array.isArray((value as OpChain)[OPS]);
}

/** Provides the JIT op steps operation for the supplied input. */
export function opSteps(chain: OpChain): readonly OpStep[] {
  return chain[OPS];
}

/** Emits a whole chain over one expression as a single generated expression. */
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
