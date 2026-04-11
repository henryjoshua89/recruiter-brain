import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractPdfText } from "@/lib/extract-pdf-text";
import { parseCalibrationFromRoleRow } from "@/lib/calibration-db";
import { runResumeAnalysis } from "@/lib/resume-claude";

export const runtime = "nodejs";

const MAX_RESUME_CHARS = 55_000;
const MAX_PDF_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Request must be multipart/form-data." },
      { status: 400 }
    );
  }

  const form = await request.formData();

  const roleId = (form.get("roleId") as string | null)?.trim() ?? "";
  const fullName = (form.get("fullName") as string | null)?.trim() ?? "";
  const email = (form.get("email") as string | null)?.trim() ?? "";
  const phone = (form.get("phone") as string | null)?.trim() ?? "";
  const linkedinUrl = (form.get("linkedinUrl") as string | null)?.trim() ?? "";
  const coverNote = (form.get("coverNote") as string | null)?.trim() ?? "";
  const portfolioUrl = (form.get("portfolioUrl") as string | null)?.trim() ?? "";
  const file = form.get("file") as File | null;
  const pastedText = (form.get("resumeText") as string | null)?.trim() ?? "";

  if (!roleId) {
    return NextResponse.json({ error: "Missing roleId." }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  // ── Extract resume text ───────────────────────────────────────────────────
  let resumeText = "";
  let resumeFilename: string | null = null;

  if (file && file.size > 0) {
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "PDF is too large (max 12 MB)." },
        { status: 400 }
      );
    }
    const name = file.name?.toLowerCase() ?? "";
    if (!name.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Please upload a PDF file." },
        { status: 400 }
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    resumeText = await extractPdfText(buf);
    resumeFilename = file.name || "resume.pdf";
  } else if (pastedText) {
    resumeText = pastedText;
  } else {
    return NextResponse.json(
      { error: "Please upload a PDF resume or paste your resume text." },
      { status: 400 }
    );
  }

  if (resumeText.length < 40) {
    return NextResponse.json(
      { error: "Resume text is too short. Please upload a valid PDF or paste more content." },
      { status: 400 }
    );
  }

  if (resumeText.length > MAX_RESUME_CHARS) {
    resumeText = resumeText.slice(0, MAX_RESUME_CHARS);
  }

  // ── Fetch role ────────────────────────────────────────────────────────────
  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("id, job_description, internal_context, briefing, scoring_calibration")
    .eq("id", roleId)
    .single();

  if (roleError || !role) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  // ── Calibration ───────────────────────────────────────────────────────────
  const { count: feedbackSignalCount } = await supabase
    .from("candidate_feedback")
    .select("*", { count: "exact", head: true })
    .eq("role_id", roleId);

  const signalCount = feedbackSignalCount ?? 0;
  const calibration =
    signalCount >= 5
      ? parseCalibrationFromRoleRow(role.scoring_calibration)
      : null;

  // ── Run AI analysis ───────────────────────────────────────────────────────
  const analysis = await runResumeAnalysis({
    apiKey,
    jobDescription: role.job_description,
    briefing: role.briefing as object,
    internalContext: role.internal_context as object,
    resumeText,
    calibration,
    feedbackSignalCount: signalCount,
  });

  // ── Save to Supabase ──────────────────────────────────────────────────────
  const { error: insErr } = await supabase
    .from("candidates")
    .insert({
      role_id: roleId,
      resume_text: resumeText,
      resume_filename: resumeFilename,
      analysis,
      jd_fit_score: analysis.jdFitScore,
      role_fit_score: analysis.roleFitScore,
      jd_fit_rationale: analysis.jdFitRationale,
      role_fit_rationale: analysis.roleFitRationale,
      source: "inbound",
      applicant_name: fullName,
      applicant_email: email,
      applicant_phone: phone || null,
      applicant_linkedin: linkedinUrl || null,
      applicant_cover_note: coverNote || null,
      applicant_portfolio: portfolioUrl || null,
    });

  if (insErr) {
    return NextResponse.json(
      { error: "Failed to save application.", details: insErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
