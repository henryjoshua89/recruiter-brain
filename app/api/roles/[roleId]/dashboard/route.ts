import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { parseModelJson } from "@/lib/parse-model-json";

const MODEL = "claude-sonnet-4-20250514";

type CandidateRow = {
  id: string;
  role_fit_score: number;
  created_at: string;
  source: string | null;
};

type FeedbackRow = {
  candidate_id: string;
  feedback_type: string;
  reject_reason: string | null;
  created_at: string;
};

type StrategyLogRow = {
  id: string;
  entry_type: string;
  body: string;
  created_at: string;
};

// ── ISO week helper ───────────────────────────────────────────────────────────
function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayOfWeek = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // ── Parallel data fetches ─────────────────────────────────────────────────
  const [candidatesRes, feedbackRes, annotationsRes, strategyRes, roleRes] =
    await Promise.all([
      supabase
        .from("candidates")
        .select("id, role_fit_score, created_at, source")
        .eq("role_id", roleId)
        .order("created_at", { ascending: true }),
      supabase
        .from("candidate_feedback")
        .select("candidate_id, feedback_type, reject_reason, created_at")
        .eq("role_id", roleId)
        .order("created_at", { ascending: true }),
      supabase
        .from("candidate_annotations")
        .select("sentiment, strengths, concerns")
        .eq("role_id", roleId),
      supabase
        .from("role_strategy_log")
        .select("id, entry_type, body, created_at")
        .eq("role_id", roleId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("roles")
        .select("scoring_calibration, annotation_patterns")
        .eq("id", roleId)
        .single(),
    ]);

  const candidates = (candidatesRes.data ?? []) as CandidateRow[];
  const feedback = (feedbackRes.data ?? []) as FeedbackRow[];
  const annotations = annotationsRes.data ?? [];
  const strategyLog = (strategyRes.data ?? []) as StrategyLogRow[];
  const role = roleRes.data;

  // ── Role Health Score ─────────────────────────────────────────────────────
  const total = candidates.length;
  const shortlistCount = feedback.filter(
    (f) => f.feedback_type === "shortlist"
  ).length;
  const rejectCount = feedback.filter(
    (f) => f.feedback_type === "reject"
  ).length;

  // One point per 5 candidates, capped at 10
  const volumeScore10 = Math.min(10, total / 5);
  const avgQuality =
    total > 0
      ? candidates.reduce((s, c) => s + (c.role_fit_score ?? 0), 0) / total
      : 0;
  const conversionScore =
    total > 0 ? Math.min(10, (shortlistCount / total) * 10 * 2.5) : 0; // 40% shortlist = 10
  const healthScore = Math.round(
    (0.3 * volumeScore10 + 0.5 * avgQuality + 0.2 * conversionScore) * 10
  ) / 10;

  // ── Pipeline Trends (weekly) ──────────────────────────────────────────────
  const weekMap = new Map<string, { count: number; scores: number[] }>();
  for (const c of candidates) {
    const key = isoWeekKey(c.created_at);
    const entry = weekMap.get(key) ?? { count: 0, scores: [] };
    entry.count++;
    entry.scores.push(c.role_fit_score ?? 0);
    weekMap.set(key, entry);
  }
  const pipelineTrends = [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, { count, scores }]) => ({
      week,
      candidates: count,
      avgScore:
        Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) /
        10,
    }));

  // ── Source split ──────────────────────────────────────────────────────────
  let inboundCount = 0;
  let outboundCount = 0;
  for (const c of candidates) {
    if (c.source === "outbound") outboundCount++;
    else inboundCount++;
  }
  const sourceSplit =
    total > 0
      ? [
          {
            source: "Inbound",
            count: inboundCount,
            pct: Math.round((inboundCount / total) * 100),
          },
          {
            source: "Outbound",
            count: outboundCount,
            pct: Math.round((outboundCount / total) * 100),
          },
        ]
      : [];

  // ── Misses log ────────────────────────────────────────────────────────────
  const rejectedFeedback = feedback.filter(
    (f) => f.feedback_type === "reject"
  );
  const reasonCounts = new Map<string, number>();
  for (const f of rejectedFeedback) {
    const r = f.reject_reason ?? "Other";
    reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  }
  const missesLog = [...reasonCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => ({
      reason,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }));

  // ── What is Working (Claude) ──────────────────────────────────────────────
  let whatIsWorking: string[] = [];
  if (apiKey && total > 0) {
    try {
      const calText =
        typeof role?.scoring_calibration === "object" &&
        role.scoring_calibration !== null &&
        "roleFitScoringGuidance" in (role.scoring_calibration as object)
          ? (role.scoring_calibration as { roleFitScoringGuidance: string })
              .roleFitScoringGuidance
          : null;

      const annPatterns = role?.annotation_patterns ?? null;

      // Aggregate annotation sentiment
      const sentTotals = { positive: 0, neutral: 0, negative: 0 };
      const strengthFreq = new Map<string, number>();
      const concernFreq = new Map<string, number>();
      for (const ann of annotations) {
        const s = (ann.sentiment as string) ?? "neutral";
        if (s in sentTotals) sentTotals[s as keyof typeof sentTotals]++;
        for (const str of (ann.strengths as string[]) ?? []) {
          const k = str.toLowerCase().trim();
          strengthFreq.set(k, (strengthFreq.get(k) ?? 0) + 1);
        }
        for (const con of (ann.concerns as string[]) ?? []) {
          const k = con.toLowerCase().trim();
          concernFreq.set(k, (concernFreq.get(k) ?? 0) + 1);
        }
      }
      const topStrengths = [...strengthFreq.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([k]) => k);
      const topConcerns = [...concernFreq.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([k]) => k);

      const prompt = `You are a recruiter analyst. Based on the data below for ONE open role, identify what is working well in the search. Respond with STRICT JSON ONLY:
{ "bullets": ["string", "string", "string"] }

Three short, specific, actionable bullets. No fluff. Each bullet should name a concrete positive signal from the data.

Pipeline stats:
- Total candidates: ${total}
- Shortlisted: ${shortlistCount} (${total > 0 ? Math.round((shortlistCount / total) * 100) : 0}%)
- Rejected: ${rejectCount}
- Average role_fit_score: ${avgQuality.toFixed(1)}/10
- Health score: ${healthScore}/10

Top candidate strengths (from voice annotations): ${topStrengths.join(", ") || "none yet"}
Common concerns flagged: ${topConcerns.join(", ") || "none yet"}
Sentiment breakdown: ${JSON.stringify(sentTotals)}

${calText ? `Calibration patterns:\n${calText}` : ""}
${annPatterns ? `Annotation patterns:\n${annPatterns}` : ""}`;

      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 512,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = msg.content.find((b) => b.type === "text");
      if (textBlock && "text" in textBlock) {
        const parsed = parseModelJson<{ bullets?: unknown[] }>(textBlock.text);
        whatIsWorking = Array.isArray(parsed.bullets)
          ? parsed.bullets.map(String).slice(0, 3)
          : [];
      }
    } catch {
      // fail silently — dashboard still renders without this
    }
  }

  return NextResponse.json({
    healthScore,
    stats: {
      total,
      shortlistCount,
      rejectCount,
      avgQuality: Math.round(avgQuality * 10) / 10,
      shortlistRate:
        total > 0 ? Math.round((shortlistCount / total) * 100) : 0,
    },
    pipelineTrends,
    sourceSplit,
    missesLog,
    strategyLog: strategyLog.map((e) => ({
      id: e.id,
      entryType: e.entry_type,
      body: e.body,
      createdAt: e.created_at,
    })),
    whatIsWorking,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;
  const body = (await request.json()) as {
    entry_type?: string;
    body?: string;
  };
  if (!body.body?.trim()) {
    return NextResponse.json({ error: "Body is required." }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("role_strategy_log")
    .insert({
      role_id: roleId,
      entry_type: body.entry_type ?? "note",
      body: body.body.trim(),
    })
    .select("id, entry_type, body, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to save log entry.", details: error?.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ entry: data });
}
