import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import type { TalentFlowData } from "@/lib/types";

const MODEL = "claude-sonnet-4-20250514";

export type InsightType =
  | "movement_pattern"
  | "feeder_archetype"
  | "rejection_signal"
  | "surprise_signal"
  | "career_path"
  | "sourcing_recommendation"
  | "poaching_pattern";

export type InsightStrength = "high" | "medium" | "low";

export type TalentFlowInsight = {
  insight: string;
  type: InsightType;
  strength: InsightStrength;
};

export async function POST(
  _request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY." }, { status: 500 });
  }

  // ── Fetch role ────────────────────────────────────────────────────────────
  const { data: role, error: roleErr } = await supabase
    .from("roles")
    .select("id, job_description, briefing, market_intelligence, talent_flow_data, companies(name)")
    .eq("id", roleId)
    .single();

  if (roleErr || !role) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  const tfd = (role.talent_flow_data as TalentFlowData | null) ?? {};
  const companyCount = Object.keys(tfd).length;

  if (companyCount < 5) {
    return NextResponse.json(
      { error: "Not enough data. Need at least 5 company backgrounds." },
      { status: 422 }
    );
  }

  // ── Fetch top 30 candidates by role_fit_score ─────────────────────────────
  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, analysis, role_fit_score")
    .eq("role_id", roleId)
    .order("role_fit_score", { ascending: false })
    .limit(30);

  // Attach latest feedback per candidate
  const candidateIds = (candidates ?? []).map((c) => c.id);
  let feedbackMap: Record<string, string> = {};
  if (candidateIds.length > 0) {
    const { data: fbRows } = await supabase
      .from("candidate_feedback")
      .select("candidate_id, feedback_type, created_at")
      .in("candidate_id", candidateIds)
      .order("created_at", { ascending: false });

    for (const f of fbRows ?? []) {
      if (!feedbackMap[f.candidate_id]) feedbackMap[f.candidate_id] = f.feedback_type;
    }
  }

  // Build a compact candidate summary for the prompt
  const candidateSummaries = (candidates ?? []).map((c) => {
    const a = c.analysis as {
      fullName?: string;
      currentTitle?: string;
      companies?: { name: string; estimatedSize: string; estimatedStage: string }[];
      industryBackground?: string;
      careerTrajectory?: string;
      totalYearsExperience?: number;
    } | null;
    return {
      name: a?.fullName ?? "Unknown",
      currentTitle: a?.currentTitle ?? "",
      companies: (a?.companies ?? []).map((co) => co.name),
      industry: a?.industryBackground ?? "",
      trajectory: a?.careerTrajectory ?? "",
      yearsExp: a?.totalYearsExperience ?? 0,
      roleFitScore: c.role_fit_score,
      feedback: feedbackMap[c.id] ?? "none",
    };
  });

  // ── Build the prompt ──────────────────────────────────────────────────────
  const rawCo = role.companies as unknown;
  const co = (Array.isArray(rawCo) ? rawCo[0] : rawCo) as { name?: string } | null;
  const companyName = co?.name ?? "the company";

  const jdLines = ((role.job_description as string) ?? "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 12)
    .join("\n");

  // Sort tfd for readability: by total desc
  const tfdSorted = Object.entries(tfd)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, e]) => `  ${name}: reviewed=${e.total}, shortlisted=${e.shortlisted}, rejected=${e.rejected}, conversion=${e.conversion_rate}%`)
    .join("\n");

  const candidateBlock = candidateSummaries
    .map((c, i) =>
      `${i + 1}. ${c.name} | ${c.currentTitle} | ${c.yearsExp}y exp | ${c.trajectory} | feedback=${c.feedback} | score=${c.roleFitScore}\n   Companies: ${c.companies.join(" → ")}`
    )
    .join("\n");

  const prompt = `You are a senior talent intelligence analyst. Analyse the following talent flow data from a real hiring pipeline and generate specific, actionable insights. Do not list company names generically. Instead identify: movement patterns between company types, feeder archetypes that produce strong candidates, what rejection patterns reveal about the role requirements, surprising sources that are outperforming expectations, career path patterns among shortlisted candidates, specific sourcing recommendations based on conversion rates, and poaching patterns where candidates from one company consistently end up at a specific type of company or role. For example if multiple candidates moved from IndiaMart to real estate or property tech companies, that is a poaching pattern worth surfacing. Name the specific companies involved when the data supports it. Be specific, analytical, and direct. Each insight should be 1 to 2 sentences maximum.

ROLE: ${companyName}
JD SUMMARY:
${jdLines}

TALENT FLOW DATA (company → pipeline stats):
${tfdSorted}

TOP CANDIDATE PROFILES (name | title | trajectory | feedback | score | company history):
${candidateBlock}

Return ONLY a JSON array of 5–7 insight objects. Each object must have exactly these fields:
- "insight": string (1–2 sentences, specific, name companies where data supports it)
- "type": one of movement_pattern | feeder_archetype | rejection_signal | surprise_signal | career_path | sourcing_recommendation | poaching_pattern
- "strength": one of high | medium | low (based on how much data supports the insight)

Example:
[
  {
    "insight": "Candidates from Flipkart convert at 67% vs the pipeline average of 42%, making it the single strongest feeder company in this search.",
    "type": "feeder_archetype",
    "strength": "high"
  }
]

Return only the JSON array. No markdown, no explanation.`;

  // ── Call Claude ───────────────────────────────────────────────────────────
  const client = new Anthropic({ apiKey });
  let raw: string;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || !("text" in textBlock)) throw new Error("No text response.");
    raw = textBlock.text.trim();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Claude call failed." },
      { status: 500 }
    );
  }

  // ── Parse response ────────────────────────────────────────────────────────
  let insights: TalentFlowInsight[];
  try {
    // Strip optional markdown fence
    const cleaned = raw.replace(/^```[\w-]*\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    insights = JSON.parse(cleaned) as TalentFlowInsight[];
    if (!Array.isArray(insights)) throw new Error("Response was not an array.");
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to parse Claude response.", raw },
      { status: 500 }
    );
  }

  const generatedAt = new Date().toISOString();

  // Persist to the role so they survive navigation
  await supabase
    .from("roles")
    .update({ talent_flow_insights: { insights, generatedAt } })
    .eq("id", roleId);

  return NextResponse.json({ insights, generatedAt });
}
