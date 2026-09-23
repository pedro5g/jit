import {
  createPerformanceEvidenceRegistry,
  type PerformanceEvidence,
} from "../../packages/jit/src/compiler/performance/evidence.js";
import { assumptions } from "../assumptions/index.js";

/** Reviewed engine measurements admitted to compiler performance profiles. */
export const reviewedEvidence: readonly PerformanceEvidence[] = Object.freeze([]);

/** Connects reviewed measurements to their named assumptions. */
export const evidenceRegistry = createPerformanceEvidenceRegistry(assumptions, reviewedEvidence);
