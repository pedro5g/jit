import type { CompileHints } from "./compile-hints.js";

export function mergeHints<T>(left: CompileHints<T> | undefined, right: CompileHints<T> | undefined): CompileHints<T> {
  if (!left) return right ?? {};
  if (!right) return left;
  const collection = mergeCollection(left.collection, right.collection);
  const entity = right.entity ?? left.entity;
  const index = right.index ?? left.index;
  const order = right.order ?? left.order;
  const compare = mergeOptional(left.compare, right.compare);
  const clone = mergeOptional(left.clone, right.clone);
  const hash = mergeOptional(left.hash, right.hash);
  const diff = mergeOptional(left.diff, right.diff);
  const serialize = mergeOptional(left.serialize, right.serialize);

  return {
    ...(entity ? { entity } : {}),
    ...(index ? { index } : {}),
    ...(order ? { order } : {}),
    ...(collection ? { collection } : {}),
    ...(compare ? { compare } : {}),
    ...(clone ? { clone } : {}),
    ...(hash ? { hash } : {}),
    ...(diff ? { diff } : {}),
    ...(serialize ? { serialize } : {}),
  };
}

function mergeOptional<T extends object>(left: T | undefined, right: T | undefined): T | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    ...left,
    ...right,
  };
}

function mergeCollection<T>(
  left: CompileHints<T>["collection"],
  right: CompileHints<T>["collection"]
): CompileHints<T>["collection"] {
  if (!left) return right;
  if (!right) return left;

  const ordered =
    left.ordered || right.ordered
      ? {
          ...left.ordered,
          ...right.ordered,
        }
      : undefined;

  return {
    ...left,
    ...right,
    ...(ordered ? { ordered } : {}),
  };
}
