/** Materialized runtime capability available for reuse by later stages. */
export type PhysicalCapabilityKind = "index" | "hash" | "ordering" | "enum-ordinal";

/** Physical capability descriptor kept separate from semantic facts. */
export interface PhysicalCapability {
  readonly kind: PhysicalCapabilityKind;
  readonly key?: string;
  readonly sourceStage: number;
  readonly reusable: boolean;
}
