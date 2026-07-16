import { type CompiledCodec, compileCodec } from "../compiler/codec.js";
import type { MapperOverridesInput } from "../compiler/mapper/build-mapper-plan.js";
import { createMapperFacade, type MapperFacade } from "../compiler/mapper.js";
import { compileSerialize, type Serialize } from "../compiler/serialize.js";
import { compileValidatorSelection, type SafeParseResult, type ValidatorOp } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import type { MapperOverridesOnlyArg } from "./mapper.js";

export type DtoTransportOp =
  | "is"
  | "parse"
  | "safeParse"
  | "parseAsync"
  | "safeParseAsync"
  | "fromJSON"
  | "stringify"
  | "codec";
export type DtoMappingOp = "from" | "many";
export type DtoOp = DtoTransportOp | DtoMappingOp;

const DTO_TRANSPORT_OPS: readonly DtoTransportOp[] = Object.freeze([
  "is",
  "parse",
  "safeParse",
  "parseAsync",
  "safeParseAsync",
  "fromJSON",
  "stringify",
  "codec",
] as const);
const DTO_MAPPING_OPS: readonly DtoMappingOp[] = Object.freeze(["from", "many"] as const);

export const DTO_OPS: readonly DtoOp[] = Object.freeze([...DTO_TRANSPORT_OPS, ...DTO_MAPPING_OPS]);
export type DtoAvailableOp<TSource> = DtoTransportOp | ([TSource] extends [never] ? never : DtoMappingOp);

export interface CompiledDtoMethods<TSource, TDto> {
  readonly is: (value: unknown) => value is TDto;
  readonly parse: (value: unknown) => TDto;
  readonly safeParse: (value: unknown) => SafeParseResult<TDto>;
  readonly parseAsync: (value: unknown) => Promise<TDto>;
  readonly safeParseAsync: (value: unknown) => Promise<SafeParseResult<TDto>>;
  readonly fromJSON: (json: string) => TDto;
  readonly stringify: Serialize<TDto>;
  readonly codec: CompiledCodec<TDto>;
  /** Whitelist mapper from one domain/entity value to the DTO shape. */
  readonly from: (source: TSource) => TDto;
  /** Fused bulk mapper with one indexed output loop. */
  readonly many: (sources: readonly TSource[]) => TDto[];
}

export type DtoSelection<TSource, TDto, TOps extends readonly DtoAvailableOp<TSource>[]> = {
  readonly schema: ATS.AnyTypeSchema;
  readonly ops: readonly DtoTransportOp[];
  readonly extras: readonly DtoMappingOp[];
  readonly operations: TOps;
} & Pick<CompiledDtoMethods<TSource, TDto>, TOps[number]>;

export interface DtoGet<TSource, TDto> {
  /** Compiles only the selected DTO boundary operations. */
  get<const TOps extends readonly DtoAvailableOp<TSource>[]>(...ops: TOps): DtoSelection<TSource, TDto, TOps>;
}

export type DtoFacade<TSource, TDto> = DtoSelection<TSource, TDto, readonly DtoAvailableOp<TSource>[]> &
  DtoGet<TSource, TDto>;

/** Creates an input DTO facade for validation, JSON, and binary transport. */
export function dto<TDtoSchema extends ATS.AnyTypeSchema>(
  target: SchemaInput<TDtoSchema>
): DtoFacade<never, ATS.TypeofSchema<TDtoSchema>>;
/** Creates an output DTO facade with a whitelist mapper from source to target. */
export function dto<TSourceSchema extends ATS.AnyTypeSchema, TDtoSchema extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSourceSchema>,
  target: SchemaInput<TDtoSchema>,
  ...rest: MapperOverridesOnlyArg<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TDtoSchema>>
): DtoFacade<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TDtoSchema>>;
export function dto<TSourceSchema extends ATS.AnyTypeSchema, TDtoSchema extends ATS.AnyTypeSchema>(
  sourceOrTarget: SchemaInput<TSourceSchema> | SchemaInput<TDtoSchema>,
  maybeTarget?: SchemaInput<TDtoSchema>,
  ...rest: [overrides?: MapperOverridesInput]
):
  | DtoFacade<never, ATS.TypeofSchema<TDtoSchema>>
  | DtoFacade<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TDtoSchema>> {
  type TSource = ATS.TypeofSchema<TSourceSchema>;
  type TDto = ATS.TypeofSchema<TDtoSchema>;
  const hasSource = maybeTarget !== undefined;
  const overrides = rest[0] ?? {};
  const sourceSchema = hasSource ? unwrapSchema(sourceOrTarget as SchemaInput<TSourceSchema>) : undefined;
  const targetSchema = unwrapSchema(
    (hasSource ? maybeTarget : sourceOrTarget) as SchemaInput<TDtoSchema>
  ) as TDtoSchema;
  const availableOps = (hasSource ? DTO_OPS : DTO_TRANSPORT_OPS) as readonly DtoAvailableOp<TSource>[];
  const selections = new Map<string, object>();
  let mapper: MapperFacade<TSource, TDto> | undefined;

  const getMapper = (): MapperFacade<TSource, TDto> => {
    if (!sourceSchema) throw new JITError("INVALID_OPERATION", "DTO mapping requires a source schema");
    mapper ??= createMapperFacade<TSource, TDto>(sourceSchema, targetSchema, overrides);
    return mapper;
  };

  const select = <const TOps extends readonly DtoAvailableOp<TSource>[]>(
    ops: TOps
  ): DtoSelection<TSource, TDto, TOps> => {
    const normalized = normalizeDtoOps(ops as readonly DtoOp[], hasSource);
    const key = normalized.join(",");
    const cached = selections.get(key);

    if (cached) return cached as DtoSelection<TSource, TDto, TOps>;

    const transportOps = normalized.filter(isDtoTransportOp);
    const mappingOps = normalized.filter(isDtoMappingOp);
    const validatorOps = collectValidatorOps(transportOps);
    const validator = validatorOps.length > 0 ? compileValidatorSelection(targetSchema, validatorOps) : undefined;
    const selectedMapper =
      mappingOps.length > 0 ? getMapper().get(...mappingOps.map((op) => (op === "from" ? "map" : "many"))) : undefined;
    const selection: Record<string, unknown> = {
      schema: targetSchema,
      ops: Object.freeze([...transportOps]),
      extras: Object.freeze([...mappingOps]),
    };

    Object.defineProperty(selection, "operations", {
      enumerable: false,
      value: Object.freeze([...normalized]),
    });

    for (const op of normalized) {
      switch (op) {
        case "is":
        case "parse":
        case "safeParse":
        case "parseAsync":
        case "safeParseAsync":
          selection[op] = validator?.[op];
          break;
        case "fromJSON": {
          const parse = validator?.parse as ((value: unknown) => TDto) | undefined;

          if (!parse) throw new JITError("INVALID_OPERATION", "DTO fromJSON requires parse generation");
          selection.fromJSON = (json: string) => parse(JSON.parse(json));
          break;
        }
        case "stringify":
          selection.stringify = compileSerialize(targetSchema);
          break;
        case "codec":
          selection.codec = compileCodec(targetSchema);
          break;
        case "from":
          selection.from = selectedMapper?.map;
          break;
        case "many":
          selection.many = selectedMapper?.many;
          break;
      }
    }

    Object.defineProperty(selection, "__jitAot", { enumerable: false, value: "grouped" });
    const compiled = Object.freeze(selection) as DtoSelection<TSource, TDto, TOps>;

    selections.set(key, compiled);
    return compiled;
  };

  const target: Record<string, unknown> = {
    schema: targetSchema,
    ops: DTO_TRANSPORT_OPS,
    extras: hasSource ? DTO_MAPPING_OPS : Object.freeze([]),
    get<const TOps extends readonly DtoAvailableOp<TSource>[]>(...ops: TOps) {
      return select(ops);
    },
  };

  Object.defineProperty(target, "operations", { enumerable: false, value: availableOps });
  Object.defineProperty(target, "__jitAot", { enumerable: false, value: "grouped" });

  for (const op of availableOps) {
    Object.defineProperty(target, op, {
      configurable: false,
      enumerable: true,
      get() {
        return select([op] as readonly DtoAvailableOp<TSource>[])[op];
      },
    });
  }

  return Object.freeze(target) as unknown as DtoFacade<TSource, TDto>;
}

function normalizeDtoOps(ops: readonly DtoOp[], hasSource: boolean): readonly DtoOp[] {
  for (const op of ops) {
    if (!(DTO_OPS as readonly string[]).includes(op)) {
      throw new JITError("INVALID_OPERATION", `unknown DTO operation ${JSON.stringify(op)}`);
    }
    if (!hasSource && isDtoMappingOp(op)) {
      throw new JITError("INVALID_OPERATION", `DTO operation ${JSON.stringify(op)} requires a source schema`);
    }
  }

  return DTO_OPS.filter((op) => ops.includes(op) && (hasSource || !isDtoMappingOp(op)));
}

function collectValidatorOps(ops: readonly DtoTransportOp[]): readonly ValidatorOp[] {
  const selected = new Set<ValidatorOp>();

  for (const op of ops) {
    if (isValidatorOp(op)) selected.add(op);
    else if (op === "fromJSON") selected.add("parse");
  }
  return [...selected];
}

function isValidatorOp(value: DtoTransportOp): value is ValidatorOp {
  return (
    value === "is" || value === "parse" || value === "safeParse" || value === "parseAsync" || value === "safeParseAsync"
  );
}

function isDtoTransportOp(value: DtoOp): value is DtoTransportOp {
  return (DTO_TRANSPORT_OPS as readonly string[]).includes(value);
}

function isDtoMappingOp(value: DtoOp): value is DtoMappingOp {
  return value === "from" || value === "many";
}
