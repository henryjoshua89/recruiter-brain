import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractPdfText } from "@/lib/extract-pdf-text";
import { parseCalibrationFromRoleRow } from "@/lib/calibration-db";
import { runResumeAnalysis } from "@/lib/resume-claude";
import { updateTalentFlowOnAnalysis } from "@/lib/talent-flow-db";
import type { ResumeCompanyEntry } from "@/lib/types";

export const runtime = "nodejs";

const MAX_RESUME_CHARS = 55_000;
const MAX_PDF_BYTES = 12 * 1024 * 1024;

type CandidateRow = {
  id: string;
  role_id: string;
  resume_filename: string | null;
  resume_text?: string | null;
  analysis: unknown;
  jd_fit_score: number;
  role_fit_score: number;
  jd_fit_rationale: string;
  role_fit_rationale: string;
  created_at: string;
};

type AnnotationRow = {
  id: string;
  candidate_id: string;
  transcript: string;
  sentiment: string | null;
  observations: unknown;
  concerns: unknown;
  strengths: unknown;
  suggested_feedback: string | null;
  created_at: string;
};

function attachLatestFeedback(
  candidates: CandidateRow[],
  feedback: {
    candidate_id: string;
    feedback_type: string;
    reject_reason: string | null;
    created_at: string;
  }[]
) {
  const latestMap = new Map<string, { feedback_type: string; reject_reason: string | null; created_at: string }>();
  for (const f of feedback) {
    if (!latestMap.has(f.candidate_id)) {
      latestMap.set(f.candidate_id, {
        feedback_type: f.feedback_type,
        reject_reason: f.reject_reason,
        created_at: f.created_at,
      });
    }
  }
  return candidates.map((c) => ({
    ...c,
    latestFeedback: latestMap.get(c.id) ?? null,
  }));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;

  const { data: candidates, error } = await supabase
    .from("candidates")
    .select(
      "id, role_id, resume_filename, resume_text, analysis, jd_fit_score, role_fit_score, jd_fit_rationale, role_fit_rationale, created_at"
    )
    .eq("role_id", roleId)
    .order("jd_fit_score", { ascending: false });
    
  if (error) {
    return NextResponse.json(
      { error: "Failed to load candidates.", details: error.message },
      { status: 500 }
    );
  }

  const ids = (candidates ?? []).map((c) => c.id);
  let feedback: {
    candidate_id: string;
    feedback_type: string;
    reject_reason: string | null;
    created_at: string;
  }[] = [];
  let annotations: AnnotationRow[] = [];

  if (ids.length > 0) {
    const [fbResult, annResult] = await Promise.all([
      supabase
        .from("candidate_feedback")
        .select("candidate_id, feedback_type, reject_reason, created_at")
        .in("candidate_id", ids)
        .order("created_at", { ascending: false }),
      supabase
        .from("candidate_annotations")
        .select("id, candidate_id, transcript, sentiment, observations, concerns, strengths, suggested_feedback, created_at")
        .in("candidate_id", ids)
        .order("created_at", { ascending: false }),
    ]);
    feedback = fbResult.data ?? [];
    annotations = (annResult.data ?? []) as AnnotationRow[];
  }

  const annotationsByCandidate = new Map<string, AnnotationRow[]>();
  for (const ann of annotations) {
    const list = annotationsByCandidate.get(ann.candidate_id) ?? [];
    list.push(ann);
    annotationsByCandidate.set(ann.candidate_id, list);
  }

  const withMeta = attachLatestFeedback(
    (candidates ?? []) as CandidateRow[],
    feedback
  ).map((c) => ({
    ...c,
    annotations: (annotationsByCandidate.get(c.id) ?? []).map((ann) => ({
      id: ann.id,
      transcript: ann.transcript,
      sentiment: ann.sentiment ?? "neutral",
      observations: (ann.observations as string[]) ?? [],
      concerns: (ann.concerns as string[]) ?? [],
      strengths: (ann.strengths as string[]) ?? [],
      suggested_feedback: ann.suggested_feedback,
      created_at: ann.created_at,
    })),
  }));

  const { count: feedbackSignalCount } = await supabase
    .from("candidate_feedback")
    .select("*", { count: "exact", head: true })
    .eq("role_id", roleId);

  return NextResponse.json({
    candidates: withMeta,
    feedbackSignalCount: feedbackSignalCount ?? 0,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  let resumeText = "";
  let resumeFilename: string | null = null;
  let reanalyseCandidateId: string | null = null;
  let forceNew = false;
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const pasted = form.get("resumeText");
    forceNew = form.get("forceNew") === "true";
    const formReanalyseId = form.get("reanalyseCandidateId");
    if (typeof formReanalyseId === "string" && formReanalyseId.trim()) {
      reanalyseCandidateId = formReanalyseId.trim();
    }
    
    if (file && typeof file !== "string" && file.size > 0) {
      if (file.size > MAX_PDF_BYTES) {
        return NextResponse.json(
          { error: "PDF is too large (max 12 MB)." },
          { status: 400 }
        );
      }
      const name = file.name?.toLowerCase() ?? "";
      if (name.endsWith(".pdf")) {
        const buf = Buffer.from(await file.arrayBuffer());
        resumeText = await extractPdfText(buf);
        resumeFilename = file.name || "resume.pdf";
      } else {
        return NextResponse.json(
          { error: "Please upload a PDF file or paste resume text." },
          { status: 400 }
        );
      }
    } else if (typeof pasted === "string" && pasted.trim()) {
      resumeText = pasted.trim();
    } else {
      return NextResponse.json(
        { error: "Provide a PDF file or resume text." },
        { status: 400 }
      );
    }
  } else {
    const body = (await request.json()) as {
      resumeText?: string;
      reanalyseCandidateId?: string;
      forceNew?: boolean;
    };
    resumeText = body.resumeText?.trim() ?? "";
    reanalyseCandidateId = body.reanalyseCandidateId ?? null;
    forceNew = body.forceNew ?? false;
  }

  if (!resumeText || resumeText.length < 40) {
    return NextResponse.json(
      {
        error:
          "Resume text is too short — paste more content or try another PDF.",
      },
      { status: 400 }
    );
  }

  if (resumeText.length > MAX_RESUME_CHARS) {
    resumeText = resumeText.slice(0, MAX_RESUME_CHARS);
  }

  const [
    { data: role, error: roleError },
    { count: feedbackSignalCount },
    { data: intelligenceRows },
  ] = await Promise.all([
    supabase
      .from("roles")
      .select("id, job_description, internal_context, briefing, scoring_calibration, annotation_patterns")
      .eq("id", roleId)
      .single(),
    supabase
      .from("candidate_feedback")
      .select("*", { count: "exact", head: true })
      .eq("role_id", roleId),
    supabase
      .from("role_intelligence")
      .select("entry")
      .eq("role_id", roleId)
      .order("created_at", { ascending: true }),
  ]);

  if (roleError || !role) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  const signalCount = feedbackSignalCount ?? 0;
  const calibration =
    signalCount >= 5
      ? parseCalibrationFromRoleRow(role.scoring_calibration)
      : null;

  const roleIntelligence =
    (intelligenceRows ?? []).length > 0
      ? (intelligenceRows ?? []).map((r) => r.entry as string)
      : null;

  const analysis = await runResumeAnalysis({
    apiKey,
    jobDescription: role.job_description,
    briefing: role.briefing as object,
    internalContext: role.internal_context as object,
    resumeText,
    calibration,
    feedbackSignalCount: signalCount,
    annotationPatterns: (role.annotation_patterns as string | null) ?? null,
    roleIntelligence,
  });

  // ── Re-analyse existing candidate ──────────────────────────────────────────
  if (reanalyseCandidateId) {
    const { data: updated, error: upErr } = await supabase
      .from("candidates")
      .update({
        resume_text: resumeText,
        analysis,
        jd_fit_score: analysis.jdFitScore,
        role_fit_score: analysis.roleFitScore,
        jd_fit_rationale: analysis.jdFitRationale,
        role_fit_rationale: analysis.roleFitRationale,
      })
      .eq("id", reanalyseCandidateId)
      .select(
        "id, role_id, resume_filename, resume_text, analysis, jd_fit_score, role_fit_score, jd_fit_rationale, role_fit_rationale, created_at"
      )
      .single();

    if (upErr || !updated) {
      return NextResponse.json(
        { error: "Failed to update candidate.", details: upErr?.message },
        { status: 500 }
      );
    }

    // Update talent flow totals (non-fatal — companies may have changed on re-analyse)
    updateTalentFlowOnAnalysis(
      roleId,
      (analysis.companies ?? []) as ResumeCompanyEntry[]
    ).catch((e) => console.error("talent-flow reanalyse update failed (non-fatal):", e));

    return NextResponse.json({
      candidate: { ...updated, latestFeedback: null },
      reanalysed: true,
    });
  }

  // ── Duplicate detection ────────────────────────────────────────────────────
  if (!forceNew && analysis.fullName) {
    const { data: existing } = await supabase
      .from("candidates")
      .select(
        "id, role_id, resume_filename, resume_text, analysis, jd_fit_score, role_fit_score, jd_fit_rationale, role_fit_rationale, created_at"
      )
      .eq("role_id", roleId)
      .ilike(
        "analysis->>fullName",
        `%${analysis.fullName.split(" ")[0]}%`
      );

    if (existing && existing.length > 0) {
      return NextResponse.json(
        {
          duplicate: true,
          existingCandidateId: existing[0].id,
          existingName: (existing[0].analysis as { fullName?: string })
            ?.fullName,
          message: `A candidate named "${(existing[0].analysis as { fullName?: string })?.fullName}" already exists for this role. Do you want to update their analysis or add as a new entry?`,
        },
        { status: 409 }
      );
    }
  }

  // ── Insert new candidate ───────────────────────────────────────────────────
  const { data: inserted, error: insErr } = await supabase
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
    })
    .select(
      "id, role_id, resume_filename, resume_text, analysis, jd_fit_score, role_fit_score, jd_fit_rationale, role_fit_rationale, created_at"
    )
    .single();

  if (insErr || !inserted) {
    return NextResponse.json(
      { error: "Failed to save candidate.", details: insErr?.message },
      { status: 500 }
    );
  }

  // Update talent flow totals — fire-and-forget, non-fatal
  updateTalentFlowOnAnalysis(
    roleId,
    (analysis.companies ?? []) as ResumeCompanyEntry[]
  ).catch((e) => console.error("talent-flow insert update failed (non-fatal):", e));

  return NextResponse.json({
    candidate: { ...inserted, latestFeedback: null },
  });
}