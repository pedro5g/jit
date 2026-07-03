import { JIT } from "jit";

export interface SmallUser {
  readonly id: number;
  readonly name: string;
  readonly active: boolean;
}

export interface MediumUser {
  readonly id: number;
  readonly name: string;
  readonly active: boolean;
  readonly profile: {
    readonly email: string;
    readonly age: number;
    readonly score: number;
  };
}

export interface DeepUser {
  readonly id: number;
  readonly profile: {
    readonly name: string;
    readonly address: {
      readonly city: string;
      readonly zip: number;
    };
  };
}

export const SmallUserSchema = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  active: JIT.boolean(),
});

export const MediumUserSchema = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  active: JIT.boolean(),
  profile: JIT.object({
    email: JIT.string(),
    age: JIT.number(),
    score: JIT.number(),
  }),
});

export const DeepUserSchema = JIT.object({
  id: JIT.number(),
  profile: JIT.object({
    name: JIT.string(),
    address: JIT.object({
      city: JIT.string(),
      zip: JIT.number(),
    }),
  }),
});

export const UsersSchema = JIT.array(MediumUserSchema);
export const NestedArraysSchema = JIT.array(JIT.array(MediumUserSchema));
export const NumberSetSchema = JIT.set(JIT.number());
export const NumberMapSchema = JIT.map(JIT.string(), JIT.number());

export function range(length: number): number[] {
  const out = new Array<number>(length);

  for (let i = 0; i < length; i++) out[i] = i;

  return out;
}

export function createSmallUser(id = 1): SmallUser {
  return { id, name: `user-${id}`, active: true };
}

export function createMediumUser(id = 1): MediumUser {
  return {
    id,
    name: `user-${id}`,
    active: true,
    profile: {
      email: `user-${id}@example.com`,
      age: 30 + (id % 20),
      score: id * 3,
    },
  };
}

export function createDeepUser(id = 1): DeepUser {
  return {
    id,
    profile: {
      name: `user-${id}`,
      address: {
        city: `city-${id}`,
        zip: 10_000 + id,
      },
    },
  };
}

export function createUsers(length: number): MediumUser[] {
  const out = new Array<MediumUser>(length);

  for (let i = 0; i < length; i++) out[i] = createMediumUser(i);

  return out;
}

export function createNestedUsers(width: number, depth: number): MediumUser[][] {
  const out = new Array<MediumUser[]>(depth);

  for (let i = 0; i < depth; i++) out[i] = createUsers(width);

  return out;
}

export function createNumberSet(length: number): Set<number> {
  return new Set(range(length));
}

export function createNumberMap(length: number): Map<string, number> {
  const out = new Map<string, number>();

  for (let i = 0; i < length; i++) out.set(`key-${i}`, i);

  return out;
}
