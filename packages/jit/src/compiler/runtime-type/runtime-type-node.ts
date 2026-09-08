import type * as ATS from "../../core/ats/index.js";

/**
 * A schema operation's resolved view of a Runtime Type boundary.
 *
 * The class constructor is declaration-time metadata only. Emitters may use
 * the trusted materializer binding, but never inspect this descriptor while a
 * generated operation is running.
 */
export interface RuntimeTypeOperationDescriptor {
  readonly schema: ATS.RuntimeTypeSchema;
  readonly innerType: ATS.AnyTypeSchema;
  readonly representation: "object" | "value";
  readonly identifier: boolean;
  readonly materialize: Function;
  readonly trustedMaterialize: Function | undefined;
  readonly immutable: boolean;
}

export interface RuntimeTypeNode<TNode> {
  readonly kind: "runtimeType";
  readonly representation: "object" | "value";
  readonly inner: TNode;
  readonly materializer: Function;
  readonly trustedMaterializer: Function | undefined;
  readonly immutable: boolean;
}
