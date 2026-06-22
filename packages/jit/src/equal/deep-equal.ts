import { ATS } from "../ATS/index.js";
import { type Builder, Equal, type Literal, Parse, type Path, type Scope, Utils } from "../shared/index.js";

function isCompositeTypeName(x: string): boolean {
  if (x === "object") return true;
  else if (x === "array") return true;
  else if (x === "record") return true;
  else if (x === "tuple") return true;
  else return false;
}

function SameNumberOrFail(l: Path, r: Path, isOptional: boolean): string {
  const X = Parse.join_path(l, isOptional);
  const Y = Parse.join_path(r, isOptional);
  return `if (${X} !== ${Y} && (${X} === ${X} || ${Y} === ${Y})) return false;`;
}

function SameValueOrFail(l: Path, r: Path, isOptional: boolean): string {
  const X = Parse.join_path(l, isOptional);
  const Y = Parse.join_path(r, isOptional);
  return `if (!Object.is(${X}, ${Y})) return false;`;
}

function StrictEqualOrFail(l: Path, r: Path, isOptional: boolean): string {
  const X = Parse.join_path(l, isOptional);
  const Y = Parse.join_path(r, isOptional);
  return `if (${X} !== ${Y}) return false;`;
}

export const defaults = {
  [ATS.TypeName.unknown]: Equal.SameValue,
  [ATS.TypeName.any]: Equal.SameValue,
  [ATS.TypeName.never]: Equal.SameValue,
  [ATS.TypeName.void]: Equal.IsStrictEqual<void>,
  [ATS.TypeName.undefined]: Equal.IsStrictEqual<undefined>,
  [ATS.TypeName.null]: Equal.IsStrictEqual<null>,
  [ATS.TypeName.symbol]: Equal.IsStrictEqual<symbol>,
  [ATS.TypeName.boolean]: Equal.IsStrictEqual<boolean>,
  [ATS.TypeName.nan]: Equal.SameNumber,
  [ATS.TypeName.int]: Equal.SameNumber,
  [ATS.TypeName.bigint]: Equal.IsStrictEqual<bigint>,
  [ATS.TypeName.number]: Equal.SameNumber,
  [ATS.TypeName.string]: Equal.IsStrictEqual<string>,
  [ATS.TypeName.literal]: Equal.SameValue,
  [ATS.TypeName.file]: Equal.SameValue,
  [ATS.TypeName.enum]: Equal.SameValue,
  [ATS.TypeName.date]: ((l, r) => Equal.SameValue(l.getTime(), r.getTime())) satisfies Equal<Date>,
} as const;

export const writeableDefaults = {
  [ATS.TypeName.never]: function continueNeverEquals(l, r, ix) {
    return SameValueOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.any]: function continueAnyEquals(l, r, ix) {
    return SameValueOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.unknown]: function continueUnknownEquals(l, r, ix) {
    return SameValueOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.void]: function continueVoidEquals(l, r, ix) {
    return SameValueOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.undefined]: function continueUndefinedEquals(l, r, ix) {
    return SameValueOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.null]: function continueNullEquals(l, r, ix) {
    return StrictEqualOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.symbol]: function continueSymbolEquals(l, r, ix) {
    return StrictEqualOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.boolean]: function continueBooleanEquals(l, r, ix) {
    return StrictEqualOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.nan]: function continueNaNEquals(l, r, ix) {
    return SameNumberOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.int]: function continueIntEquals(l, r, ix) {
    return SameNumberOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.bigint]: function continueIntEquals(l, r, ix) {
    return StrictEqualOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.number]: function continueNumberEquals(l, r, ix) {
    return SameNumberOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.string]: function continueStringEquals(l, r, ix) {
    return StrictEqualOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.enum]: function continueEnumEquals(l, r, ix) {
    return SameValueOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.file]: function continueFileEquals(l, r, ix) {
    return StrictEqualOrFail(l, r, ix.isOptional);
  },
  [ATS.TypeName.date]: function continueDateEquals(l, r, ix) {
    return `if (!Object.is(${Parse.join_path(l, ix.isOptional)}.getTime(), ${Parse.join_path(r, ix.isOptional)}.getTime())) return false;`;
  },
} as const satisfies Record<string, Builder>;

function literalEquals<T>(x: Literal<T>, _isOptional: boolean): Builder {
  return function continueLiteralEquals(LEFT, RIGHT, IX) {
    const v = Array.isArray(x) ? x : [x];
    return v.every((v) => typeof v === "number")
      ? SameNumberOrFail(LEFT, RIGHT, IX.isOptional)
      : v.some((v) => typeof v === "number")
        ? SameValueOrFail(LEFT, RIGHT, IX.isOptional)
        : StrictEqualOrFail(LEFT, RIGHT, IX.isOptional);
  };
}

function nullable<T>(deepEqualFn: Equal<T>): Equal<T | null> {
  return (l, r) => Equal.SameValue(l, r) || deepEqualFn(l!, r!);
}
nullable.writeable = function nullableEquals(x: Builder): Builder {
  return function continueNullableEquals(LEFT_PATH, RIGHT_PATH, IX) {
    const LEFT = Parse.join_path(LEFT_PATH, IX.isOptional);
    const RIGHT = Parse.join_path(RIGHT_PATH, IX.isOptional);

    return [
      `if (${LEFT} !== ${RIGHT}) {`,
      `  if (${LEFT} === null || ${RIGHT} === null) return false`,
      //if they are not strictly equal and neither is null on its own,
      //calls the internal builder
      x(LEFT_PATH, RIGHT_PATH, IX),
      `}`,
    ].join("\n");
  };
};

function optional<T>(deepEqualFn: Equal<T>): Equal<T | undefined> {
  return (l, r) => Equal.SameValue(l, r) || deepEqualFn(l!, r!);
}

optional.writeable = function optionalEquals(x: Builder): Builder {
  return function continueOptionalEquals(LEFT_PATH, RIGHT_PATH, IX) {
    const LEFT = Parse.join_path(LEFT_PATH, IX.isOptional);
    const RIGHT = Parse.join_path(RIGHT_PATH, IX.isOptional);
    return [
      `if (!Object.is(${LEFT}, ${RIGHT})) {`,
      `  if (${LEFT} === undefined || ${RIGHT} === undefined) return false;`,
      //if it has survived this far, none of them are undefined and they are different,
      //then we trigger the internal validator (e.g., string validation, object validation, etc.)
      x(LEFT_PATH, RIGHT_PATH, IX),
      `}`,
    ].join("\n");
  };
};

function set<T>(deepEqualFn: Equal<T>): Equal<Set<T>> {
  return (l, r) => {
    if (Utils.Object_is(l, r)) return true;
    else if (l.size !== r.size) return false;
    else return array(deepEqualFn)(Array.from(l).sort(), Array.from(r).sort());
  };
}

set.writeable = function setEquals(x: Builder): Builder & { type: "set" } {
  function continueSetEquals(LEFT_PATH: Path, RIGHT_PATH: Path, IX: Scope) {
    const LEFT = Parse.join_path(LEFT_PATH, IX.isOptional);
    const RIGHT = Parse.join_path(RIGHT_PATH, IX.isOptional);
    const LEFT_IDENT = Parse.ident(LEFT, IX.bindings);
    const RIGHT_IDENT = Parse.ident(RIGHT, IX.bindings);
    const LEFT_VALUES_IDENT = `${LEFT_IDENT}_values`;
    const RIGHT_VALUES_IDENT = `${RIGHT_IDENT}_values`;
    const LEFT_VALUE_IDENT = `${LEFT_IDENT}_value`;
    const RIGHT_VALUE_IDENT = `${RIGHT_IDENT}_value`;
    const LENGTH = Parse.ident("length", IX.bindings);
    return [
      `if (${LEFT}.size !== ${RIGHT}.size) return false;`,
      `const ${LEFT_VALUES_IDENT} = Array.from(${LEFT}).sort();`,
      `const ${RIGHT_VALUES_IDENT} = Array.from(${RIGHT}).sort();`,
      `let ${LENGTH} = ${LEFT_VALUES_IDENT}.length;`,
      `for (let ix = ${LENGTH}; ix-- !== 0;) {`,
      `const ${LEFT_VALUE_IDENT} = ${LEFT_VALUES_IDENT}[ix];`,
      `const ${RIGHT_VALUE_IDENT} = ${RIGHT_VALUES_IDENT}[ix];`,
      x([LEFT_VALUE_IDENT], [RIGHT_VALUE_IDENT], IX),
      `}`,
    ].join("\n");
  }
  continueSetEquals.type = "set" as const;
  return continueSetEquals;
};

function map<K, V>(keyEqualsFn: Equal<K>, valueEqualFn: Equal<V>): Equal<Map<K, V>> {
  return (l, r) => {
    if (Utils.Object_is(l, r)) return true;
    else if (l.size !== r.size) return false;
    else {
      const lEntries = Array.from(l).sort();
      const rEntries = Array.from(r).sort();
      for (let ix = 0, len = l.size; ix < len; ix++) {
        const [lk, lv] = lEntries[ix];
        const [rk, rv] = rEntries[ix];
        if (!keyEqualsFn(lk, rk)) return false;
        if (!valueEqualFn(lv, rv)) return false;
      }
      return true;
    }
  };
}

map.writeable = function mapEquals(keyBuilder: Builder, valueBuilder: Builder): Builder & { type: "map" } {
  function continueMapEquals(LEFT_PATH: Path, RIGHT_PATH: Path, IX: Scope) {
    const LEFT_ACCESSOR = Parse.join_path(LEFT_PATH, IX.isOptional);
    const RIGHT_ACCESSOR = Parse.join_path(RIGHT_PATH, IX.isOptional);
    const LEFT_IDENT = Parse.ident(LEFT_ACCESSOR, IX.bindings);
    const RIGHT_IDENT = Parse.ident(RIGHT_ACCESSOR, IX.bindings);
    const LEFT_ENTRIES = `${LEFT_IDENT}_entries`;
    const RIGHT_ENTRIES = `${RIGHT_IDENT}_entries`;
    const LEFT_KEY = `${LEFT_IDENT}_key`;
    const RIGHT_KEY = `${RIGHT_IDENT}_key`;
    const LEFT_VALUE = `${LEFT_IDENT}_value`;
    const RIGHT_VALUE = `${RIGHT_IDENT}_value`;
    return [
      `if (${LEFT_ACCESSOR}.size !== ${RIGHT_ACCESSOR}.size) return false;`,
      `const ${LEFT_ENTRIES} = Array.from(${LEFT_ACCESSOR}).sort();`,
      `const ${RIGHT_ENTRIES} = Array.from(${RIGHT_ACCESSOR}).sort();`,
      `for (let ix = 0, len = ${LEFT_ENTRIES}.length; ix < len; ix++) {`,
      `const [${LEFT_KEY}, ${LEFT_VALUE}] = ${LEFT_ENTRIES}[ix];`,
      `const [${RIGHT_KEY}, ${RIGHT_VALUE}] = ${RIGHT_ENTRIES}[ix];`,
      keyBuilder([LEFT_KEY], [RIGHT_KEY], IX),
      valueBuilder([LEFT_VALUE], [RIGHT_VALUE], IX),
      `}`,
    ].join("\n");
  }
  continueMapEquals.type = "map" as const;
  return continueMapEquals;
};

function union<T>(deepEqualFns: readonly Equal<T>[]): Equal<T> {
  return (l, r) => {
    if (Utils.Object_is(l, r)) return true;
    return deepEqualFns.some((deepEqualFn) => deepEqualFn(l, r));
  };
}

union.writeable = function unionEquals(...builders: Builder[]): Builder & { type: "union" } {
  function continueUnionEquals(LEFT_PATH: Path, RIGHT_PATH: Path, IX: Scope) {
    const SATISFIED = Parse.ident("satisfied", IX.bindings);

    const CHECKS = builders.map((continuation) => {
      const branchBody = continuation(LEFT_PATH, RIGHT_PATH, IX);
      //wraps the builder body in an IIFE to isolate the "return false" statements.
      //if the IIFE reaches the end without returning false, it means the branch is valid
      return [
        `if (!${SATISFIED}) {`,
        `  ${SATISFIED} = (function() {`,
        `    ${branchBody}`,
        `    return true;`,
        `  })();`,
        `}`,
      ].join("\n");
    });

    return [`let ${SATISFIED} = false;`, ...CHECKS, `if (!${SATISFIED}) return false;`].join("\n");
  }

  continueUnionEquals.type = "union" as const;
  return continueUnionEquals;
};

export function intersection<T>(deepEqualFns: readonly Equal<any>[]): Equal<T> {
  return (l, r) => {
    if (Utils.Object_is(l, r)) return true;
    return deepEqualFns.every((deepEqualFn) => deepEqualFn(l, r));
  };
}

intersection.writeable = function intersectionEquals(...builders: Builder[]): Builder & { type: "intersection" } {
  function continueIntersectionEquals(LEFT_PATH: Path, RIGHT_PATH: Path, IX: Scope) {
    const CHECKS = builders.map((continuation) => {
      return continuation(LEFT_PATH, RIGHT_PATH, IX);
    });
    return CHECKS.join("\n");
  }

  continueIntersectionEquals.type = "intersection" as const;
  return continueIntersectionEquals;
};

function tuple<T>(deepEqualFns: Equal<T>[], restEquals?: Equal<T>): Equal<readonly T[]> {
  return (l, r) => {
    if (Utils.Object_is(l, r)) return true;
    if (l.length !== r.length) return false;
    const len = deepEqualFns.length;
    for (let ix = len; ix-- !== 0; ) {
      const deepEqualFn = deepEqualFns[ix];
      if (!deepEqualFn(l[ix], r[ix])) return false;
    }
    if (l.length > len) {
      if (!restEquals) return false;
      for (let ix = len; ix < l.length; ix++) {
        if (!restEquals(l[ix], r[ix])) return false;
      }
    }
    return true;
  };
}

tuple.writeable = function tupleEquals(items: Builder[], rest?: Builder): Builder & { type: "tuple" } {
  function continueTupleEquals(LEFT_PATH: Path, RIGHT_PATH: Path, IX: Scope) {
    const LEFT = Parse.join_path(LEFT_PATH, IX.isOptional);
    const RIGHT = Parse.join_path(RIGHT_PATH, IX.isOptional);
    // if we got `tuple([])`, just check that the lengths are the same
    if (items.length === 0 && !rest) {
      return `if (${LEFT}.length !== ${RIGHT}.length) return false;`;
    }
    const LENGTH = Parse.ident("length", IX.bindings);
    const LENGTH_CHECK = rest
      ? [`const ${LENGTH} = ${LEFT}.length;`, `if (${LENGTH} !== ${RIGHT}.length) return false;`].join("\n")
      : `if (${LEFT}.length !== ${items.length} || ${RIGHT}.length !== ${items.length}) return false;`;

    const ITEM_CHECKS = items.map((continuation, i) =>
      continuation([...LEFT_PATH, String(i)], [...RIGHT_PATH, String(i)], IX)
    );
    const REST_CHECK = rest
      ? [
          `if (${LENGTH} > ${items.length}) {`,
          `  for (let ix = ${LENGTH}; ix-- !== ${items.length};) {`,
          `    const LEFT_ITEM = ${LEFT}[ix];`,
          `    const RIGHT_ITEM = ${RIGHT}[ix];`,
          rest(["LEFT_ITEM"], ["RIGHT_ITEM"], IX),
          `  }`,
          `}`,
        ].join("\n")
      : null;

    return [LENGTH_CHECK, ...ITEM_CHECKS, REST_CHECK].filter(Boolean).join("\n");
  }

  continueTupleEquals.type = "tuple" as const;
  return continueTupleEquals;
};

function array<T>(deepEqualFn: Equal<T>): Equal<readonly T[]> {
  return (l, r) => {
    if (Utils.Object_is(l, r)) return true;
    const length = l.length;
    if (length !== r.length) return false;
    for (let ix = length; ix-- !== 0; ) {
      if (!deepEqualFn(l[ix], r[ix])) return false;
    }
    return true;
  };
}

array.writable = function arrayEquals(x: Builder): Builder & { type: "array" } {
  function continueArrayEquals(LEFT_PATH: Path, RIGHT_PATH: Path, IX: Scope) {
    const LEFT = Parse.join_path(LEFT_PATH, IX.isOptional);
    const RIGHT = Parse.join_path(RIGHT_PATH, IX.isOptional);
    const LEFT_ITEM_IDENT = `${Parse.ident(LEFT, IX.bindings)}_item`;
    const RIGHT_ITEM_IDENT = `${Parse.ident(RIGHT, IX.bindings)}_item`;
    const LENGTH = Parse.ident("length", IX.bindings);
    const DOT = IX.isOptional ? "?." : ".";
    return [
      `const ${LENGTH} = ${LEFT}${DOT}length;`,
      `if (${LENGTH} !== ${RIGHT}${DOT}length) return false`,
      `for (let ix = ${LENGTH}; ix-- !== 0;) {`,
      `const ${LEFT_ITEM_IDENT} = ${LEFT}[ix];`,
      `const ${RIGHT_ITEM_IDENT} = ${RIGHT}[ix];`,
      x([LEFT_ITEM_IDENT], [RIGHT_ITEM_IDENT], IX),
      `}`,
    ].join("\n");
  }
  continueArrayEquals.type = "array" as const;
  return continueArrayEquals;
};

function record<T>(valueEqualsFn: Equal<T>, _keyEqualsFn?: Equal<T>): Equal<Record<string, T>> {
  return (r, l) => {
    if (Utils.Object_is(r, l)) return true;
    const lk = Utils.Object_keys(l);
    const rK = Utils.Object_keys(r);
    const length = lk.length;
    let k: string;
    if (length !== rK.length) return false;
    for (let ix = length; ix-- !== 0; ) {
      k = lk[ix];
      if (Utils.Object_hasOwn(r, k)) return false;
      if (!valueEqualsFn(l[k], r[k])) return false;
    }
    for (let ix = length; ix-- !== 0; ) {
      k = rK[ix];
      if (!Utils.Object_hasOwn(l, k)) return false;
      if (!valueEqualsFn(l[k], r[k])) return false;
    }
    return true;
  };
}

record.writeable = function recordEquals(x: Builder): Builder & { type: "record" } {
  function continueRecordEquals(LEFT_PATH: Path, RIGHT_PATH: Path, IX: Scope) {
    const LEFT = Parse.join_path(LEFT_PATH, IX.isOptional);
    const RIGHT = Parse.join_path(RIGHT_PATH, IX.isOptional);
    const LEFT_IDENT = Parse.ident(LEFT, IX.bindings);
    const RIGHT_IDENT = Parse.ident(RIGHT, IX.bindings);
    const LEFT_KEYS_IDENT = `${LEFT_IDENT}_keys`;
    const RIGHT_KEYS_IDENT = `${RIGHT_IDENT}_keys`;
    const LEFT_VALUE_IDENT = Parse.ident(`${LEFT_IDENT}[k]`, IX.bindings);
    const RIGHT_VALUE_IDENT = Parse.ident(`${RIGHT_IDENT}[k]`, IX.bindings);
    const LENGTH = Parse.ident("length", IX.bindings);
    return [
      `const ${LEFT_KEYS_IDENT} = Object.keys(${LEFT});`,
      `const ${RIGHT_KEYS_IDENT} = Object.keys(${RIGHT});`,
      `const ${LENGTH} = ${LEFT_KEYS_IDENT}.length;`,
      `if (${LENGTH} !== ${RIGHT_KEYS_IDENT}.length) return false;`,
      `for (let ix = 0; ix < ${LENGTH}; ix++) {`,
      `const k = ${LEFT_KEYS_IDENT}[ix];`,
      `if (!${RIGHT_KEYS_IDENT}.includes(k)) return false;`,
      `const ${LEFT_VALUE_IDENT} = ${LEFT}[k];`,
      `const ${RIGHT_VALUE_IDENT} = ${RIGHT}[k];`,
      x([LEFT_VALUE_IDENT], [RIGHT_VALUE_IDENT], IX),
      `}`,
    ].join("\n");
  }
  continueRecordEquals.type = "record" as const;
  return continueRecordEquals;
};

function object<T>(deepEqualFns: { [x: string]: Equal<T> }, catchAllEquals?: Equal<T>): Equal<{ [x: string]: T }> {
  return (l, r) => {
    if (Utils.Object_is(l, r)) return false;
    const lKeys = Utils.Object_keys(l);
    const rKeys = Utils.Object_keys(r);
    if (lKeys.length !== rKeys.length) return false;
    const keysSet = catchAllEquals ? new Set(lKeys.concat(rKeys)) : null;
    for (const k in deepEqualFns) {
      keysSet?.delete(k);
      const deepEqualFn = deepEqualFns[k];
      const lHas = Utils.Object_hasOwn(l, k);
      const rHas = Utils.Object_hasOwn(r, k);
      if (lHas) {
        if (!rHas) return false;
        if (!deepEqualFn(l[k], r[k])) return false;
      }
      if (rHas) {
        if (!lHas) return false;
        if (!deepEqualFn(l[k], r[k])) return false;
      }
      if (!deepEqualFn(l[k], r[k])) return false;
    }
    if (catchAllEquals && keysSet) {
      const catchAllKeys = Array.from(keysSet);
      let k: string | undefined;
      while ((k = catchAllKeys.shift()) !== undefined) {
        if (!Utils.Object_hasOwn(l, k)) return false;
        if (!Utils.Object_hasOwn(r, k)) return false;
        if (!catchAllEquals(l[k], r[k])) return false;
      }
    }
    return true;
  };
}

object.writeable = function objectEquals(
  x: Record<string, Builder & { type: string }>,
  catchAll?: Builder
): Builder & { type: "object" } {
  function continueObjectEquals(LEFT_PATH: Path, RIGHT_PATH: Path, IX: Scope) {
    const LEFT = Parse.join_path(LEFT_PATH, IX.isOptional);
    const RIGHT = Parse.join_path(RIGHT_PATH, IX.isOptional);
    const keys = Utils.Object_keys(x);
    if (keys.length === 0) return `if (Object.keys(${LEFT}).length !== Object.keys(${RIGHT}).length) return false`;

    const LENGTH = Parse.ident("length", IX.bindings);
    const LEFT_KEYS_IDENT = Parse.ident(`${LEFT_PATH}_keys`, IX.bindings);
    const KEY_IDENT = Parse.ident("key", IX.bindings);
    const KNOWN_KEY_CHECK = Utils.Object_keys(x)
      .map((k) => `${KEY_IDENT} === ${Parse.stringify_key(k)}`)
      .join(" || ");
    const LEFT_VALUE_IDENT = Parse.ident(`${LEFT}_value`, IX.bindings);
    const RIGHT_VALUE_IDENT = Parse.ident(`${RIGHT}_value`, IX.bindings);
    const LENGTH_CHECK = !catchAll
      ? null
      : [
          `const ${LEFT_KEYS_IDENT} = Object.keys(${LEFT})`,
          `const ${LENGTH} = ${LEFT_KEYS_IDENT}.length`,
          `if (${LENGTH} !== Object.keys(${RIGHT}).length) return false`,
        ].join("\n");
    const FOR_LOOP = !catchAll
      ? null
      : [
          `for (let ix = ${LENGTH}; ix-- !== 0; ) {`,
          `const ${KEY_IDENT} = ${LEFT_KEYS_IDENT}[ix];`,
          `if (${KNOWN_KEY_CHECK}) continue;`,
          `const ${LEFT_VALUE_IDENT} = ${LEFT}[${KEY_IDENT}];`,
          `const ${RIGHT_VALUE_IDENT} = ${RIGHT}[${KEY_IDENT}];`,
          catchAll([LEFT_VALUE_IDENT], [RIGHT_VALUE_IDENT], {
            ...IX,
            isOptional: true,
          }),
          `}`,
        ].join("\n");

    return [
      ...Object.entries(x).map(([key, continuation]) => {
        if (!isCompositeTypeName(x[key].type)) return continuation([LEFT, key], [RIGHT, key], IX);
        else {
          const LEFT_ACCESSOR = Parse.join_path([LEFT, key], IX.isOptional);
          const RIGHT_ACCESSOR = Parse.join_path([RIGHT, key], IX.isOptional);
          return [
            `if (${LEFT_ACCESSOR} !== ${RIGHT_ACCESSOR}) {`,
            continuation([LEFT, key], [RIGHT, key], IX),
            `}`,
          ].join("\n");
        }
      }),
      LENGTH_CHECK,
      FOR_LOOP,
    ]
      .filter((_) => _ !== null)
      .join("\n");
  }
  continueObjectEquals.type = "object" as const;
  return continueObjectEquals;
};

const fold = (x: ATS.TypeSchema<any>): Equal<any> => {
  switch (true) {
    case x.type in defaults:
      return defaults[x.type as keyof typeof defaults];
    case x.type === ATS.TypeName.optional:
      return optional(fold(x.item));
    case x.type === ATS.TypeName.nullable:
      return nullable(fold(x.item));
    case x.type === ATS.TypeName.set:
      return set(fold(x.item));
    case x.type === ATS.TypeName.array:
      return array(fold(x.item));
    case x.type === ATS.TypeName.map:
      return map(fold(x.key), fold(x.value));
    case x.type === ATS.TypeName.record:
      return record(fold(x.value), fold(x.key));
    case x.type === ATS.TypeName.tuple:
      return tuple(x.items.map(fold));
    case x.type === ATS.TypeName.union:
      return union(x.schemas.map(fold));
    case x.type === ATS.TypeName.intersection:
      return intersection(x.schemas.map(fold));
    case x.type === ATS.TypeName.object: {
      const props: Record<string, Equal<any>> = {};
      for (const k in x.props) props[k] = fold(x.props[k]);
      return object(props);
    }

    default:
      throw new Error(`[JIT] Unimplemented classic deepEqual for type: ${x.type}`);
  }
};

const compileWriteable = (x: ATS.TypeSchema<any>): Builder => {
  switch (true) {
    case x.type in writeableDefaults:
      return writeableDefaults[x.type as keyof typeof writeableDefaults];
    case x.type === ATS.TypeName.literal:
      return literalEquals<any>(x.literalValue, false);
    case x.type === ATS.TypeName.optional:
      return optional.writeable(compileWriteable(x.item));
    case x.type === ATS.TypeName.nullable:
      return nullable.writeable(compileWriteable(x.item));
    case x.type === ATS.TypeName.set:
      return set.writeable(compileWriteable(x.item));
    case x.type === ATS.TypeName.map:
      return map.writeable(compileWriteable(x.key), compileWriteable(x.value));
    case x.type === ATS.TypeName.array:
      return array.writable(compileWriteable(x.item));
    case x.type === ATS.TypeName.tuple:
      return tuple.writeable(x.items.map(compileWriteable));
    case x.type === ATS.TypeName.union:
      return union.writeable(...x.schemas.map(compileWriteable));
    case x.type === ATS.TypeName.intersection:
      return intersection.writeable(...x.schemas.map(compileWriteable));
    case x.type === ATS.TypeName.record:
      return record.writeable(compileWriteable(x.value));
    case x.type === ATS.TypeName.object: {
      const props: Record<string, Builder & { type: string }> = {};
      for (const key in x.props) {
        const child = x.props[key];
        props[key] = Object.assign(compileWriteable(child), {
          type: child.type,
        });
      }
      return object.writeable(props);
    }
    default:
      throw new Error(`[JIT] Unimplemented writeable builder for type: ${x.type}`);
  }
};

export function deepEqual<T>(type: ATS.TypeSchema<T>): Equal<ATS.Infer<typeof type>> {
  const index: Scope = { bindings: new Map(), isOptional: false };
  const isNullary = type.type in writeableDefaults && type.type !== ATS.TypeName.object;
  const ROOT_CHECK = `if (Object.is(l, r)) return true;`;
  const BODY = compileWriteable(type)(["l"], ["r"], index);
  return isNullary || (type.type as any) === ATS.TypeName.enum
    ? (globalThis.Function("l", "r", [BODY, "return true"].join("\n")) as Equal<ATS.Infer<typeof type>>)
    : (globalThis.Function("l", "r", [ROOT_CHECK, BODY, "return true"].join("\n")) as Equal<ATS.Infer<typeof type>>);
}

deepEqual.writeable = compileWriteable;
deepEqual.classic = fold;
