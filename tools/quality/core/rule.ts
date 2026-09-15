import type { QualityContext } from "./context.js";
import type { QualityFinding } from "./finding.js";

export interface QualityRule {
  readonly id: string;
  readonly description: string;
  readonly hard: boolean;
  evaluate(context: QualityContext): QualityFinding[] | Promise<QualityFinding[]>;
}
