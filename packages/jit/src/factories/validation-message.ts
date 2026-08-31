export type ValidationMessage = string | { readonly message?: string };

export function resolveValidationMessage(input: ValidationMessage | undefined): string | undefined {
  return typeof input === "string" ? input : input?.message;
}

/** Adds diagnostic-only metadata without changing the schema's semantic def. */
export function withValidationMessage<TDef extends object>(def: TDef, input: ValidationMessage | undefined): TDef {
  const message = resolveValidationMessage(input);

  return { ...def, requiredMessage: message } as TDef;
}
