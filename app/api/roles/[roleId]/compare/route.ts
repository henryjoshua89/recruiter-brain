import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";

export async function POST(
  request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY." }, { status: 500 });
  }

  const body = (await request.json()) as { candidateIds?: string[] };
  const { candidateIds } = body;

  if (!Array.isArray(candidateIds) || candidateIds.length < 2 || candidateIds.length > 4) {
    return NextResponse.json({ error: "Provide 2–4 candidateIds." }, { status: 400 });
  }

  const { data: candidates, error } = await supabase
    .from("candidates")
    .select("id, analysis, jd_fit_score, role_fit_score")
    .eq("role_id", roleId)
    .in("id", candidateIds);

  if (error || !candidates?.length) {
    return NextResponse.json({ error: "Could not load candidates." }, { status: 404 });
  }

  const { data: feedbacks } = await supabase
    .from("candidate_feedback")
    .select("candidate_id, feedback_type, reject_reason, created_at")
    .in("candidate_id", candidateIds)
    .order("created_at", { ascending: false });

  const feedbackMap = new Map<string, { feedback_type: string; reject_reason: string | null }>();
  for (const f of feedbacks ?? []) {
    if (!feedbackMap.has(f.candidate_id)) {
      feedbackMap.set(f.candidate_id, {
        feedback_type: f.feedback_type,
        reject_reason: f.reject_reason,
      });
    }
  }

  const candidateBlocks = candidates.map((c) => {
    const a = c.analysis as Record<string, unknown>;
    const fb = feedbackMap.get(c.id);
    const signals = (Array.isArray(a.keySignals) ? (a.keySignals as unknown[]).map(String) : [])
      .slice(0, 3)
      .join("; ");
    const gaps = (Array.isArray(a.missingForRole) ? (a.missingForRole as unknown[]).map(String) : [])
      .slice(0, 2)
      .join("; ");
    const feedback = fb
      ? `${fb.feedback_type}${fb.reject_reason ? ` (${fb.reject_reason})` : ""}`
      : "no feedback yet";

    return [
      `Candidate: ${String(a.fullName ?? "Unknown")} — ${String(a.currentTitle ?? "")}`,
      `JD fit: ${c.jd_fit_score}/10 | Role fit: ${c.role_fit_score}/10`,
      `Experience: ${String(a.totalYearsExperience ?? 0)} yrs total, ${String(a.relevantYearsForRole ?? 0)} yrs relevant`,
      `Average tenure: ${String(a.averageTenureYearsPerRole ?? 0)} yrs/role`,
      `Career trajectory: ${String(a.careerTrajectory ?? "lateral")}`,
      `Top signals: ${signals || "none"}`,
      `Top gaps: ${gaps || "none"}`,
      `Current feedback: ${feedback}`,
    ].join("\n");
  });

  const prompt = `You are a senior recruiter comparing candidates for a role. Based solely on the data below, recommend the single strongest candidate and explain why in 2–3 concise sentences. Be direct — name the candidate explicitly. Plain prose only, no bullet points, no markdown.

${candidateBlocks.join("\n\n")}`;

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const recommendation =
    textBlock && "text" in textBlock ? textBlock.text.trim() : "";

  return NextResponse.json({ recommendation });
}
