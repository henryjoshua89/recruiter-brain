import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  _request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;

  const { data: role, error } = await supabase
    .from("roles")
    .select(
      `
      id,
      company_id,
      job_description,
      internal_context,
      briefing,
      scoring_calibration,
      scoring_calibration_at,
      scoring_calibration_feedback_count,
      created_at,
      companies ( id, name, website_url, public_context )
    `
    )
    .eq("id", roleId)
    .single();

  if (error || !role) {
    return NextResponse.json(
      { error: "Role not found.", details: error?.message },
      { status: 404 }
    );
  }

  const { count: feedbackCount } = await supabase
    .from("candidate_feedback")
    .select("*", { count: "exact", head: true })
    .eq("role_id", roleId);

  const { count: candidateCount } = await supabase
    .from("candidates")
    .select("*", { count: "exact", head: true })
    .eq("role_id", roleId);

  const rawCo = role.companies as unknown;
  const coRow = Array.isArray(rawCo) ? rawCo[0] : rawCo;
  const co = coRow as {
    id: string;
    name: string;
    website_url: string;
    public_context: unknown;
  } | null;

  return NextResponse.json({
    role: {
      id: role.id,
      companyId: role.company_id,
      jobDescription: role.job_description,
      internalContext: role.internal_context,
      briefing: role.briefing,
      scoringCalibration: role.scoring_calibration,
      scoringCalibrationAt: role.scoring_calibration_at,
      scoringCalibrationFeedbackCount: role.scoring_calibration_feedback_count,
      createdAt: role.created_at,
      company: co
        ? {
            id: co.id,
            name: co.name,
            websiteUrl: co.website_url,
            publicContext: co.public_context,
          }
        : null,
      candidateCount: candidateCount ?? 0,
      feedbackSignalCount: feedbackCount ?? 0,
    },
  });
}
