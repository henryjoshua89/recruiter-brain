import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { parseModelJson } from "@/lib/parse-model-json";

const MODEL = "claude-sonnet-4-20250514";

type ExtractedAnnotation = {
  sentiment?: string;
  observations?: unknown[];
  concerns?: unknown[];
  strengths?: unknown[];
  suggested_feedback?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ candidateId: string }> }
) {
  const { candidateId } = await context.params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY." }, { status: 500 });
  }

  const body = (await request.json()) as { transcript?: string };
  const transcript = body.transcript?.trim();
  if (!transcript) {
    return NextResponse.json({ error: "Transcript is required." }, { status: 400 });
  }

  const { data: candidate, error: cErr } = await supabase
    .from("candidates")
    .select("id, role_id")
    .eq("id", candidateId)
    .single();

  if (cErr || !candidate) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  // Extract signals from transcript with Claude
  const client = new Anthropic({ apiKey });
  const extractPrompt = `You are a recruiter assistant. A recruiter has left a voice annotation about a candidate. Extract structured signals from the transcript.

Transcript: "${transcript}"

Return STRICT JSON ONLY (no markdown fences):
{
  "sentiment": "positive" | "negative" | "neutral",
  "observations": ["string"],
  "concerns": ["string"],
  "strengths": ["string"],
  "suggested_feedback": "shortlist" | "hold" | "reject" | null
}

Rules:
- sentiment: overall impression conveyed by the recruiter
- observations: factual notes about the candidate (max 5 items)
- concerns: specific negatives, risks, or red flags (max 3 items)
- strengths: specific positives or standout qualities (max 3 items)
- suggested_feedback: Set ONLY when the recruiter explicitly uses one of the following trigger words or phrases. Any other language — including analytical observations, uncertainty, or general commentary — must produce null.
  - "shortlist": shortlist, move forward, advance, good fit, strong candidate, call them, impressive, definitely
  - "hold": hold, on hold, keep in pipeline, revisit, check back, not yet but keep
  - "reject": reject, pass, not suitable, not a fit, move on, not right, no
  If none of these exact signals are present, return null for suggested_feedback.`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.1,
    messages: [{ role: "user", content: extractPrompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || !("text" in textBlock)) {
    return NextResponse.json({ error: "No response from Claude." }, { status: 500 });
  }

  const extracted = parseModelJson<ExtractedAnnotation>(textBlock.text);

  const toStringArray = (val: unknown): string[] =>
    Array.isArray(val) ? val.map(String) : [];

  const observations = toStringArray(extracted.observations);
  const concerns = toStringArray(extracted.concerns);
  const strengths = toStringArray(extracted.strengths);
  const sentiment = String(extracted.sentiment ?? "neutral");
  const suggested_feedback = extracted.suggested_feedback ?? null;

  const { data: annotation, error: annErr } = await supabase
    .from("candidate_annotations")
    .insert({
      candidate_id: candidateId,
      role_id: candidate.role_id,
      transcript,
      sentiment,
      observations,
      concerns,
      strengths,
      suggested_feedback,
    })
    .select("id, candidate_id, transcript, sentiment, observations, concerns, strengths, suggested_feedback, created_at")
    .single();

  if (annErr || !annotation) {
    return NextResponse.json(
      { error: "Failed to save annotation.", details: annErr?.message },
      { status: 500 }
    );
  }

  // Recalibrate annotation_patterns for the role (non-fatal)
  try {
    await recalibrateAnnotationPatterns(candidate.role_id, apiKey, client);
  } catch (e) {
    console.error("Annotation pattern recalibration failed:", e);
  }

  return NextResponse.json({ annotation });
}

async function recalibrateAnnotationPatterns(
  roleId: string,
  _apiKey: string,
  client: Anthropic
): Promise<void> {
  const { data: annotations } = await supabase
    .from("candidate_annotations")
    .select("transcript, sentiment, observations, concerns, strengths, suggested_feedback, created_at")
    .eq("role_id", roleId)
    .order("created_at", { ascending: true });

  if (!annotations?.length) return;

  const blocks = annotations.map((a, i) => {
    const obs = (a.observations as string[]).join("; ") || "none";
    const str = (a.strengths as string[]).join("; ") || "none";
    const con = (a.concerns as string[]).join("; ") || "none";
    return `Annotation ${i + 1} [${a.sentiment}] → suggested: ${a.suggested_feedback ?? "none"}
Observations: ${obs}
Strengths: ${str}
Concerns: ${con}`;
  });

  const calibrationMessage = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: `You analyse recruiter voice annotations for ONE role. Extract common patterns that should inform how future candidates are scored and evaluated.

Annotations:
${blocks.join("\n\n")}

Respond in 3–5 concise sentences describing: what signals the recruiter values, what concerns they flag repeatedly, and how these patterns should influence scoring of future candidates. Plain prose only.`,
      },
    ],
  });

  const calTextBlock = calibrationMessage.content.find((b) => b.type === "text");
  if (!calTextBlock || !("text" in calTextBlock)) return;

  await supabase
    .from("roles")
    .update({ annotation_patterns: calTextBlock.text.trim() })
    .eq("id", roleId);
}
