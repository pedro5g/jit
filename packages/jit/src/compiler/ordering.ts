import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import type { CodeWriter } from "./emitter/code-writer.js";
import { CodeWriter as OrderingCodeWriter } from "./emitter/code-writer.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";

export type OrderDirection = "asc" | "desc";
export type OrderingValueKind = "direct" | "numeric" | "date";

export interface OrderingCriterion {
  readonly key: string;
  readonly direction: OrderDirection;
  readonly valueKind: OrderingValueKind;
  readonly nullish: boolean;
}

/** Semantic ordering shared by standalone sort and query physical lowering. */
export interface OrderingDescriptor {
  readonly criteria: readonly OrderingCriterion[];
}

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

export function resolveOrderingDescriptor(
  schema: ATS.AnyTypeSchema,
  criteria: readonly { readonly key: string; readonly direction: OrderDirection }[]
): OrderingDescriptor {
  const object = resolveOrderingObjectSchema(schema);

  if (criteria.length === 0) {
    throw new JITError("INVALID_OPERATION", "ordering requires at least one criterion");
  }

  const seen = new Set<string>();
  const resolved = criteria.map((criterion) => {
    if (typeof criterion.key !== "string" || criterion.key.length === 0) {
      throw new JITError("INVALID_OPERATION", "ordering keys must be non-empty strings");
    }
    if (criterion.direction !== "asc" && criterion.direction !== "desc") {
      throw new JITError("INVALID_OPERATION", "ordering direction must be asc or desc");
    }
    const field = object.def.props[criterion.key];

    if (!field) {
      throw new JITError("INVALID_OPERATION", `ordering received unknown key ${JSON.stringify(criterion.key)}`, {
        path: [criterion.key],
      });
    }
    if (seen.has(criterion.key)) {
      throw new JITError("INVALID_OPERATION", `ordering repeats key ${JSON.stringify(criterion.key)}`, {
        path: [criterion.key],
      });
    }
    seen.add(criterion.key);

    return Object.freeze({
      key: criterion.key,
      direction: criterion.direction,
      valueKind: resolveOrderingValueKind(field, criterion.key),
      nullish: isNullish(field),
    });
  });

  return Object.freeze({ criteria: Object.freeze(resolved) });
}

export function emitOrderingComparatorBody(
  writer: CodeWriter,
  descriptor: OrderingDescriptor,
  left = "left",
  right = "right"
): void {
  const last = descriptor.criteria.length - 1;
  let terminated = false;

  descriptor.criteria.forEach((criterion, index) => {
    const suffix = descriptor.criteria.length === 1 ? "" : String(index);
    const date = criterion.valueKind === "date";
    const leftRaw = `left${date ? "Raw" : "Value"}${suffix}`;
    const rightRaw = `right${date ? "Raw" : "Value"}${suffix}`;
    const leftValue = `leftValue${suffix}`;
    const rightValue = `rightValue${suffix}`;
    // Absent values order before present ones ascending, after them descending.
    const leftPresentWins = criterion.direction === "desc" ? "-1" : "1";
    const rightPresentWins = criterion.direction === "desc" ? "1" : "-1";
    // Float64 subtraction beats a comparison pair, but its result cannot be
    // told apart from "equal" when it is NaN (Infinity minus Infinity), so it
    // is only safe where no later criterion depends on falling through.
    const subtract = criterion.valueKind === "numeric" && index === last;
    const emitCompare = () => {
      if (date) {
        writer.line(`const ${leftValue} = ${leftRaw}.getTime();`);
        writer.line(`const ${rightValue} = ${rightRaw}.getTime();`);
      }
      if (subtract) {
        writer.line(
          criterion.direction === "desc"
            ? `return ${rightValue} - ${leftValue};`
            : `return ${leftValue} - ${rightValue};`
        );
        return;
      }
      writer.line(`if (${leftValue} !== ${rightValue}) {`);
      writer.indent(() => {
        writer.line(
          criterion.direction === "desc"
            ? `return ${leftValue} < ${rightValue} ? 1 : -1;`
            : `return ${leftValue} < ${rightValue} ? -1 : 1;`
        );
      });
      writer.line("}");
    };

    writer.line(`const ${leftRaw} = ${emitPropertyAccess(left, criterion.key)};`);
    writer.line(`const ${rightRaw} = ${emitPropertyAccess(right, criterion.key)};`);
    if (!criterion.nullish) {
      emitCompare();
      terminated = subtract;
      return;
    }
    // Two absent values are equal for this criterion and fall through to the
    // next one; `null` and `undefined` must not be told apart by `<`.
    writer.line(`if (${leftRaw} == null || ${rightRaw} == null) {`);
    writer.indent(() => {
      writer.line(`if (${leftRaw} != null) return ${leftPresentWins};`);
      writer.line(`if (${rightRaw} != null) return ${rightPresentWins};`);
    });
    writer.line("} else {");
    writer.indent(emitCompare);
    writer.line("}");
  });
  if (!terminated) writer.line("return 0;");
}

export function emitOrderingComparatorBodySource(descriptor: OrderingDescriptor): string {
  const writer = new OrderingCodeWriter();
  emitOrderingComparatorBody(writer, descriptor);
  return writer.toString();
}

function resolveOrderingObjectSchema(schema: ATS.AnyTypeSchema): ObjectSchema {
  let base = resolveWrappers(schema).base;

  if (base.type === TypeName.array) {
    base = resolveWrappers((base.def as ATS.ElementDef).element).base;
  }
  if (base.type === TypeName.runtimeType) {
    base = resolveWrappers((base.def as ATS.RuntimeTypeDef).innerType).base;
  }
  if (base.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "ordering expects an object or array-of-objects schema");
  }
  return base as ObjectSchema;
}

function resolveOrderingValueKind(schema: ATS.AnyTypeSchema, key: string): OrderingValueKind {
  let base = resolveWrappers(schema).base;

  if (base.type === TypeName.runtimeType) {
    base = resolveWrappers((base.def as ATS.RuntimeTypeDef).innerType).base;
  }
  if (base.type === TypeName.date) return "date";
  // Float64 keys subtract without branching; bigint cannot (it yields a BigInt).
  if (base.type === TypeName.number || base.type === TypeName.int) return "numeric";
  if (
    base.type === TypeName.string ||
    base.type === TypeName.bigint ||
    base.type === TypeName.boolean ||
    base.type === TypeName.literal ||
    base.type === TypeName.enum
  ) {
    return "direct";
  }
  throw new JITError(
    "INVALID_OPERATION",
    `ordering key ${JSON.stringify(key)} must resolve to a statically orderable scalar`
  );
}

function isNullish(schema: ATS.AnyTypeSchema): boolean {
  const resolved = resolveWrappers(schema);
  return resolved.optional || resolved.nullable;
}
