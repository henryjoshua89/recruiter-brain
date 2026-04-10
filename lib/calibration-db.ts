import type { RoleScoringCalibration } from "@/lib/types";

export function parseCalibrationFromRoleRow(
  raw: unknown
): RoleScoringCalibration | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const patternSummary = String(o.patternSummary ?? "").trim();
  const roleFitScoringGuidance = String(
    o.roleFitScoringGuidance ?? ""
  ).trim();
  if (!patternSummary || !roleFitScoringGuidance) return null;
  return {
    patternSummary,
    roleFitScoringGuidance,
    feedbackCount: Number(o.feedbackCount ?? 0),
    updatedAt: String(o.updatedAt ?? ""),
  };
}
