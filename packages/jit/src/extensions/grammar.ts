/** Fluent grammar constraints declared by an extension. */
export interface ExtensionGrammar {
  readonly repeat?: "allow" | "forbid";
  readonly requires?: readonly string[];
  readonly provides?: readonly string[];
  readonly conflicts?: readonly string[];
  readonly terminal?: boolean;
  readonly fusion?: readonly string[];
}
