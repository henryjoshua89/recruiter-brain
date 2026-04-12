import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractPdfText } from "@/lib/extract-pdf-text";
import { parseCalibrationFromRoleRow } from "@/lib/calibration-db";
import { runResumeAnalysis } from "@/lib/resume-claude";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_RESUME_CHARS = 55_000;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  const form = await request.formData();
  const roleId = form.get("roleId") as string;
  const fullName = form.get("fullName") as string;
  const email = form.get("email") as string;
  const phone = (form.get("phone") as string) || null;
  const linkedinUrl = (form.get("linkedinUrl") as string) || null;
  const coverNote = (form.get("coverNote") as string) || null;
  const portfolioUrl = (form.get("portfolioUrl") as string) || null;
  const file = form.get("file") as File | null;

  if (!roleId || !fullName || !email || !file) {
    return NextResponse.json(
      { error: "Missing required fields." },
      { status: 400 }
    );
  }

  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: "PDF is too large (max 12 MB)." },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let resumeText = await extractPdfText(buf);

  if (!resumeText || resumeText.length < 40) {
    return NextResponse.json(
      { error: "Could not extract text from PDF. Please try another file." },
      { status: 400 }
    );
  }

  if (resumeText.length > MAX_RESUME_CHARS) {
    resumeText = resumeText.slice(0, MAX_RESUME_CHARS);
  }

  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select(
      "id, job_description, internal_context, briefing, scoring_calibration"
    )
    .eq("id", roleId)
    .single();

  if (roleError || !role) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  const { count: feedbackSignalCount } = await supabase
    .from("candidate_feedback")
    .select("*", { count: "exact", head: true })
    .eq("role_id", roleId);

  const signalCount = feedbackSignalCount ?? 0;
  const calibration =
    signalCount >= 5
      ? parseCalibrationFromRoleRow(role.scoring_calibration)
      : null;

  const analysis = await runResumeAnalysis({
    apiKey,
    jobDescription: role.job_description,
    briefing: role.briefing as object,
    internalContext: role.internal_context as object,
    resumeText,
    calibration,
    feedbackSignalCount: signalCount,
  });

  const { error: insertError } = await supabase.from("candidates").insert({
    role_id: roleId,
    resume_text: resumeText,
    resume_filename: file.name,
    analysis,
    jd_fit_score: analysis.jdFitScore,
    role_fit_score: analysis.roleFitScore,
    jd_fit_rationale: analysis.jdFitRationale,
    role_fit_rationale: analysis.roleFitRationale,
    source: "inbound",
    applicant_name: fullName,
    applicant_email: email,
    applicant_phone: phone,
    applicant_linkedin: linkedinUrl,
    applicant_cover_note: coverNote,
    applicant_portfolio: portfolioUrl,
  });

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to save application.", details: insertError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}