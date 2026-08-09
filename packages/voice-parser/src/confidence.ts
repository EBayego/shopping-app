import type { ShoppingIntentConfidence } from "./types.js";

export interface ConfidenceEvidence {
  hasProduct: boolean;
  hasExplicitMeasurement: boolean;
  hasPackaging: boolean;
  hasCount: boolean;
  incomplete: boolean;
  ambiguousFraction: boolean;
  knownBareProduct: boolean;
}

export function classifyConfidence(
  evidence: ConfidenceEvidence,
): ShoppingIntentConfidence {
  if (
    !evidence.hasProduct ||
    evidence.incomplete ||
    evidence.ambiguousFraction
  ) {
    return "LOW";
  }
  if (evidence.hasExplicitMeasurement || evidence.hasPackaging) return "HIGH";
  if (evidence.hasCount || evidence.knownBareProduct) return "MEDIUM";
  return "LOW";
}
