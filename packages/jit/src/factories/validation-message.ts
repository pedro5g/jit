/**
 * Custom validation message accepted by schema factories.
 *
 * @example
 * ```ts
 * const Name = JIT.string({ message: "name is required" });
 * const Age = JIT.number("age must be numeric");
 * ```
 */
export type ValidationMessage = string | { readonly message?: string };

/** Returns the JIT resolve validation message result for the supplied input. */
export function resolveValidationMessage(input: ValidationMessage | undefined): string | undefined {
  return typeof input === "string" ? input : input?.message;
}

/** Adds diagnostic-only metadata without changing the schema's semantic def. */
export function withValidationMessage<TDef extends object>(def: TDef, input: ValidationMessage | undefined): TDef {
  const message = resolveValidationMessage(input);

  return { ...def, requiredMessage: message } as TDef;
}
