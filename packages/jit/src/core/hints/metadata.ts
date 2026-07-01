export interface Metadata {
  title?: string;
  description?: string;
  deprecated?: boolean;
  examples?: readonly unknown[];
  tags?: readonly string[];
  custom?: Readonly<Record<string, unknown>>;
}
