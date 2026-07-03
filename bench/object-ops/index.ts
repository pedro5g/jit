import { JIT } from "jit";
import { bench, do_not_optimize, run } from "mitata";
import { createMediumUser, createUsers, type MediumUser, MediumUserSchema } from "../shared/data.js";

const merge = JIT.compileMerge(MediumUserSchema.schema);
const pick = JIT.compilePick(MediumUserSchema.schema, ["id", "name"]);
const omit = JIT.compileOmit(MediumUserSchema.schema, ["profile"]);
const transform = JIT.compileTransform(MediumUserSchema.schema, {
  name: (value) => value.toUpperCase(),
  active: (value) => !value,
});
const UsersSchema = JIT.array(MediumUserSchema).keyed("id");
const normalize = JIT.compileNormalize(UsersSchema.schema);
const sortBy = JIT.compileSortBy(JIT.array(MediumUserSchema).sortBy("id", "desc").schema);
const uniqueBy = JIT.compileUniqueBy(JIT.array(MediumUserSchema).uniqueBy("id").schema);
const RoleUserSchema = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  role: JIT.string(),
});
const RoleUsersSchema = JIT.array(RoleUserSchema).keyed("id").groupBy("role");
const groupBy = JIT.compileGroupBy(RoleUsersSchema.schema);

const medium = createMediumUser();
const mergePatch = { profile: { score: 999 } };
const users = createUsers(10_000);
const roleUsers = createRoleUsers(10_000);

function createRoleUsers(length: number): { readonly id: number; readonly name: string; readonly role: string }[] {
  const out = new Array<{ readonly id: number; readonly name: string; readonly role: string }>(length);

  for (let i = 0; i < length; i++) {
    out[i] = { id: i, name: `user-${i}`, role: i % 3 === 0 ? "admin" : i % 3 === 1 ? "editor" : "viewer" };
  }

  return out;
}

function genericMerge<T>(left: T, right: unknown): T {
  if (right === undefined || Object.is(left, right)) return left;
  if (left == null || right == null || typeof left !== "object" || typeof right !== "object") return right as T;

  let changed = false;
  const out: Record<string, unknown> = {};
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);

  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    const next = genericMerge(leftRecord[key], rightRecord[key]);

    out[key] = next;
    if (!Object.is(next, leftRecord[key])) changed = true;
  }

  return changed ? (out as T) : left;
}

function genericPick<T extends object>(value: T, keys: readonly (keyof T & string)[]): Partial<T> {
  const out: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;

  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    out[key] = record[key];
  }

  return out as Partial<T>;
}

function genericOmit<T extends object>(value: T, omitted: readonly (keyof T & string)[]): Partial<T> {
  const omittedSet = new Set(omitted);
  const out: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    if (!omittedSet.has(key as keyof T & string)) out[key] = record[key];
  }

  return out as Partial<T>;
}

function genericTransform<T extends object>(
  value: T,
  transforms: Partial<Record<keyof T & string, (value: unknown, source: T) => unknown>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    const typedKey = key as keyof T & string;
    const fn = transforms[typedKey];
    out[key] = fn ? fn(record[key], value) : record[key];
  }

  return out;
}

function genericNormalize<T extends object>(
  value: readonly T[],
  keyName: keyof T & string
): { readonly byId: Record<PropertyKey, T>; readonly ids: PropertyKey[] } {
  return value.reduce(
    (out, item) => {
      const id = (item as Record<string, unknown>)[keyName] as PropertyKey;

      out.ids.push(id);
      out.byId[id] = item;
      return out;
    },
    { byId: {} as Record<PropertyKey, T>, ids: [] as PropertyKey[] }
  );
}

function genericGroupBy<T extends object>(value: readonly T[], keyName: keyof T & string): Record<PropertyKey, T[]> {
  return value.reduce(
    (out, item) => {
      const key = (item as Record<string, unknown>)[keyName] as PropertyKey;
      const group = out[key] ?? [];

      group.push(item);
      out[key] = group;
      return out;
    },
    {} as Record<PropertyKey, T[]>
  );
}

function genericSortBy<T extends object>(
  value: readonly T[],
  keyName: keyof T & string,
  direction: "asc" | "desc"
): T[] {
  return [...value].sort((left, right) => {
    const leftValue = (left as Record<string, string | number>)[keyName];
    const rightValue = (right as Record<string, string | number>)[keyName];

    if (leftValue === rightValue) return 0;
    if (direction === "desc") return leftValue < rightValue ? 1 : -1;
    return leftValue < rightValue ? -1 : 1;
  });
}

function genericUniqueBy<T extends object>(value: readonly T[], keyName: keyof T & string): T[] {
  const seen = new Set();

  return value.filter((item) => {
    const key = (item as Record<string, unknown>)[keyName];

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

bench("JIT merge / medium nested", () => do_not_optimize(merge(medium, mergePatch)));
bench("generic merge / medium nested", () => do_not_optimize(genericMerge(medium, mergePatch)));

bench("JIT pick / medium object", () => do_not_optimize(pick(medium)));
bench("generic pick / medium object", () => do_not_optimize(genericPick(medium, ["id", "name"])));

bench("JIT omit / medium object", () => do_not_optimize(omit(medium)));
bench("generic omit / medium object", () => do_not_optimize(genericOmit(medium, ["profile"])));

bench("JIT transform / medium object", () => do_not_optimize(transform(medium)));
bench("generic transform / medium object", () =>
  do_not_optimize(
    genericTransform(medium, {
      name: (value) => String(value).toUpperCase(),
      active: (value) => !value,
    })
  )
);

bench("JIT normalize / users 10000", () => do_not_optimize(normalize(users)));
bench("generic reduce normalize / users 10000", () => do_not_optimize(genericNormalize(users, "id")));

bench("JIT groupBy / role users 10000", () => do_not_optimize(groupBy(roleUsers)));
bench("generic reduce groupBy / role users 10000", () => do_not_optimize(genericGroupBy(roleUsers, "role")));

bench("JIT sortBy / users 10000", () => do_not_optimize(sortBy(users)));
bench("generic sortBy / users 10000", () => do_not_optimize(genericSortBy<MediumUser>(users, "id", "desc")));

bench("JIT uniqueBy / users 10000", () => do_not_optimize(uniqueBy(users)));
bench("generic filter uniqueBy / users 10000", () => do_not_optimize(genericUniqueBy(users, "id")));

await run();
