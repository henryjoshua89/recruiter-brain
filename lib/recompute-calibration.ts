import { supabase } from "@/lib/supabase";
import { runCalibration } from "@/lib/resume-claude";

export async function recomputeRoleCalibration(
  roleId: string,
  apiKey: string
): Promise<void> {
  const { count } = await supabase
    .from("candidate_feedback")
    .select("*", { count: "exact", head: true })
    .eq("role_id", roleId);

  const n = count ?? 0;
  if (n < 5) return;

  const { data: feedbacks } = await supabase
    .from("candidate_feedback")
    .select("candidate_id, feedback_type, reject_reason, created_at")
    .eq("role_id", roleId)
    .order("created_at", { ascending: true });

  if (!feedbacks?.length) return;

  const candidateIds = [...new Set(feedbacks.map((f) => f.candidate_id))];
  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, analysis, jd_fit_score, role_fit_score")
    .in("id", candidateIds);

  const cmap = new Map((candidates ?? []).map((c) => [c.id, c]));
  const lines = feedbacks.map((f) => {
    const c = cmap.get(f.candidate_id);
    const a = (c?.analysis as Record<string, unknown>) ?? {};
    const name = String(a.fullName ?? "Unknown");
    const title = String(a.currentTitle ?? "");
    const rj =
      f.feedback_type === "reject" && f.reject_reason
        ? ` reason=${f.reject_reason}`
        : "";
    return `[${f.created_at}] ${f.feedback_type}${rj} | ${name} (${title}) | jd=${c?.jd_fit_score} role=${c?.role_fit_score}`;
  });

  const cal = await runCalibration({
    apiKey,
    feedbackRows: lines.join("\n"),
  });

  const payload = {
    patternSummary: cal.patternSummary,
    roleFitScoringGuidance: cal.roleFitScoringGuidance,
    feedbackCount: n,
    updatedAt: new Date().toISOString(),
  };

  await supabase
    .from("roles")
    .update({
      scoring_calibration: payload,
      scoring_calibration_at: new Date().toISOString(),
      scoring_calibration_feedback_count: n,
    })
    .eq("id", roleId);
}
