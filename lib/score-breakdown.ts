import type { ScoreBreakdown } from "@/lib/types";

export function normalizeScoreBreakdown(
  raw: unknown,
  rationaleFallback: string
): ScoreBreakdown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      strengths: [
        "No granular breakdown was stored for this candidate (likely analysed before score transparency was added).",
      ],
      weaknesses: [],
      biggestFactor:
        rationaleFallback.trim() ||
        "See the written rationale in the expanded card.",
    };
  }
  const o = raw as Record<string, unknown>;
  const strengths = Array.isArray(o.strengths)
    ? (o.strengths as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  const weaknesses = Array.isArray(o.weaknesses)
    ? (o.weaknesses as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  const biggestFactor = String(o.biggestFactor ?? "").trim();
  return {
    strengths: strengths.length
      ? strengths.slice(0, 5)
      : [
          "Strengths were not listed in the stored breakdown — refer to the rationale text.",
        ],
    weaknesses: weaknesses.length
      ? weaknesses.slice(0, 5)
      : [
          "No separate weaknesses listed; the score reflects the overall judgment in the rationale.",
        ],
    biggestFactor:
      biggestFactor ||
      rationaleFallback.trim() ||
      "See rationale for the main driver of this score.",
  };
}
