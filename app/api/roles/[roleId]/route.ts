import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateBriefing } from "@/lib/briefing-claude";
import {
  fetchJDEnrichment,
  fetchTalentFlow,
  formatMarketIntelligenceForPrompt,
  heuristicRoleTitleFromJD,
} from "@/lib/tavily";
import type { MarketIntelligence, NewRolePayload } from "@/lib/types";

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
      market_intelligence,
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

  const [
    { count: feedbackCount },
    { count: candidateCount },
    { data: annotationRows },
  ] = await Promise.all([
    supabase
      .from("candidate_feedback")
      .select("*", { count: "exact", head: true })
      .eq("role_id", roleId),
    supabase
      .from("candidates")
      .select("*", { count: "exact", head: true })
      .eq("role_id", roleId),
    supabase
      .from("candidate_annotations")
      .select(
        "id, candidate_id, transcript, sentiment, observations, concerns, strengths, suggested_feedback, created_at, candidates(analysis)"
      )
      .eq("role_id", roleId)
      .order("created_at", { ascending: false }),
  ]);

  const rawCo = role.companies as unknown;
  const coRow = Array.isArray(rawCo) ? rawCo[0] : rawCo;
  const co = coRow as {
    id: string;
    name: string;
    website_url: string;
    public_context: unknown;
  } | null;

  const annotations = (annotationRows ?? []).map((ann) => {
    const candidateData = ann.candidates as { analysis?: { fullName?: string } } | null;
    const candidateName =
      candidateData?.analysis?.fullName ?? "Unknown candidate";
    return {
      id: ann.id,
      candidateId: ann.candidate_id,
      candidateName,
      transcript: ann.transcript,
      sentiment: ann.sentiment ?? "neutral",
      observations: (ann.observations as string[]) ?? [],
      concerns: (ann.concerns as string[]) ?? [],
      strengths: (ann.strengths as string[]) ?? [],
      suggestedFeedback: ann.suggested_feedback,
      createdAt: ann.created_at,
    };
  });

  // ── Annotation insights ──────────────────────────────────────────────────
  // Group all annotations by candidate so we can count per-candidate signal prevalence
  type CandAnn = { strengths: string[]; concerns: string[] };
  const annsByCandidate = new Map<string, CandAnn[]>();
  const sentiments = { positive: 0, neutral: 0, negative: 0 };

  for (const ann of annotations) {
    const list = annsByCandidate.get(ann.candidateId) ?? [];
    list.push({ strengths: ann.strengths, concerns: ann.concerns });
    annsByCandidate.set(ann.candidateId, list);
    const s = ann.sentiment as keyof typeof sentiments;
    if (s in sentiments) sentiments[s]++;
  }

  const annotatedCandidateCount = annsByCandidate.size;

  function computeSignalPrevalence(
    field: "strengths" | "concerns",
    max = 8
  ): { label: string; candidateCount: number; percentage: number }[] {
    // Track which candidates mention each signal (deduplicated per candidate)
    const signalMap = new Map<string, { original: string; candidates: Set<string> }>();
    for (const [candidateId, anns] of annsByCandidate) {
      const seenKeys = new Set<string>();
      for (const ann of anns) {
        for (const item of ann[field]) {
          const key = item.toLowerCase().trim();
          if (!key || seenKeys.has(key)) continue;
          seenKeys.add(key);
          const entry = signalMap.get(key);
          if (entry) entry.candidates.add(candidateId);
          else signalMap.set(key, { original: item, candidates: new Set([candidateId]) });
        }
      }
    }
    return [...signalMap.values()]
      .sort((a, b) => b.candidates.size - a.candidates.size)
      .slice(0, max)
      .map(({ original, candidates }) => ({
        label: original,
        candidateCount: candidates.size,
        percentage:
          annotatedCandidateCount > 0
            ? Math.round((candidates.size / annotatedCandidateCount) * 100)
            : 0,
      }));
  }

  const annotationInsights = {
    totalAnnotations: annotations.length,
    annotatedCandidateCount,
    sentiments,
    topStrengths: computeSignalPrevalence("strengths"),
    topConcerns: computeSignalPrevalence("concerns"),
  };

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
      marketIntelligence: role.market_intelligence ?? null,
      annotations,
      annotationInsights,
    },
  });
}

// ── DELETE — permanently remove a role (candidates cascade via FK) ─────────
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;

  const { error } = await supabase.from("roles").delete().eq("id", roleId);
  if (error) {
    return NextResponse.json(
      { error: "Failed to delete role.", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true });
}

// ── PATCH — regenerate briefing with updated inputs ────────────────────────
export async function PATCH(
  request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY." }, { status: 500 });
  }

  const body = (await request.json()) as {
    companyId: string;
    jobDescription: string;
    internalContext: NewRolePayload["internalContext"];
  };

  if (!body.companyId || !body.jobDescription?.trim()) {
    return NextResponse.json(
      { error: "companyId and jobDescription are required." },
      { status: 400 }
    );
  }

  const { data: company, error: coErr } = await supabase
    .from("companies")
    .select("id, name, website_url, public_context")
    .eq("id", body.companyId)
    .single();

  if (coErr || !company) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }

  // Tavily market intelligence (non-fatal)
  const tavilyKey = process.env.TAVILY_API_KEY;
  let marketIntelligence: MarketIntelligence | null = null;
  let marketIntelligenceContext: string | null = null;
  if (tavilyKey) {
    try {
      const roleTitle = heuristicRoleTitleFromJD(body.jobDescription.trim(), company.name);
      // Run JD enrichment + talent flow searches in parallel
      const [jdEnrichment, talentFlowResult] = await Promise.all([
        fetchJDEnrichment({ companyName: company.name, roleTitle, apiKey: tavilyKey }),
        fetchTalentFlow({ roleTitle, industry: company.name, apiKey: tavilyKey }).catch((e) => {
          console.error("Tavily talent flow failed (non-fatal):", e);
          return null;
        }),
      ]);
      marketIntelligence = {
        ...jdEnrichment,
        talentFlowResearch: talentFlowResult,
      };
      marketIntelligenceContext = formatMarketIntelligenceForPrompt(marketIntelligence);
    } catch (e) {
      console.error("Tavily enrichment failed (non-fatal):", e);
    }
  }

  // Generate new briefing using shared lib
  let parsed;
  try {
    parsed = await generateBriefing({
      apiKey: anthropicKey,
      companyName: company.name,
      companyWebsite: company.website_url,
      companyContext: (company.public_context ?? null) as Record<string, unknown> | null,
      jobDescription: body.jobDescription.trim(),
      internalContext: body.internalContext,
      marketIntelligenceContext,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Briefing generation failed." },
      { status: 500 }
    );
  }

  // Update existing role in Supabase
  const { error: updateErr } = await supabase
    .from("roles")
    .update({
      job_description: body.jobDescription.trim(),
      internal_context: body.internalContext,
      briefing: parsed,
      market_intelligence: marketIntelligence ?? null,
    })
    .eq("id", roleId);

  if (updateErr) {
    return NextResponse.json(
      { error: "Failed to update role.", details: updateErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ briefing: parsed, marketIntelligence });
}
