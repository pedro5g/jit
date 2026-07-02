import { type IRVar, irVar } from "./ir.js";

export class Scope {
  readonly #counts = new Map<string, number>();
  readonly #names = new Set<string>();

  createVar(prefix: string): IRVar {
    const safePrefix = prefix.replace(/[^$_a-zA-Z0-9]/g, "_").replace(/^[^$_a-zA-Z]/, "_") || "_";
    let next = this.#counts.get(safePrefix) ?? 0;
    let name = next === 0 ? safePrefix : `${safePrefix}${next}`;

    while (this.#names.has(name)) {
      next++;
      name = `${safePrefix}${next}`;
    }

    this.#counts.set(safePrefix, next + 1);
    this.#names.add(name);
    return irVar(name);
  }
}
