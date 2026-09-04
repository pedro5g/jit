import type { AnyTypeSchema } from "../core/ats/index.js";

export type ResolvedMemberKind = "field" | "method" | "getter" | "setter" | "factory";
export type ResolvedMemberSource = "schema" | "preset" | "capability" | "extension" | "overwrite";

/** One declaration-level member used for collision and overwrite resolution. */
export interface ResolvedClassMember {
  readonly name: string;
  readonly kind: ResolvedMemberKind;
  readonly source: ResolvedMemberSource;
  readonly owner?: string;
  readonly descriptor?: PropertyDescriptor;
  readonly schema?: AnyTypeSchema;
}

/**
 * Central member table for a class definition. It is deliberately a plain
 * Map-like object used only during declaration; generated calls never consult
 * it.
 */
export class ResolvedMemberTable {
  private readonly members = new Map<string, ResolvedClassMember>();

  add(member: ResolvedClassMember): void {
    this.members.set(member.name, member);
  }

  get(name: string): ResolvedClassMember | undefined {
    return this.members.get(name);
  }

  has(name: string): boolean {
    return this.members.has(name);
  }

  replace(name: string, member: ResolvedClassMember): void {
    if (!this.members.has(name)) throw new Error(`Cannot replace missing class member ${JSON.stringify(name)}`);
    this.members.set(name, member);
  }

  entries(): readonly ResolvedClassMember[] {
    return [...this.members.values()];
  }

  clone(): ResolvedMemberTable {
    const copy = new ResolvedMemberTable();
    for (const member of this.members.values()) copy.add(member);
    return copy;
  }
}
