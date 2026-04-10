import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { recomputeRoleCalibration } from "@/lib/recompute-calibration";
import type { FeedbackType, RejectReason } from "@/lib/types";

const REJECT_REASONS: RejectReason[] = [
  "Overqualified",
  "Underqualified",
  "Wrong industry",
  "Poor stability",
  "Missing skills",
  "Other",
];

export async function POST(
  request: Request,
  context: { params: Promise<{ candidateId: string }> }
) {
  const { candidateId } = await context.params;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as {
    feedbackType?: FeedbackType;
    rejectReason?: RejectReason | null;
  };

  const feedbackType = body.feedbackType;
  if (
    feedbackType !== "shortlist" &&
    feedbackType !== "reject" &&
    feedbackType !== "hold"
  ) {
    return NextResponse.json(
      { error: "Invalid feedbackType." },
      { status: 400 }
    );
  }

  if (feedbackType === "reject") {
    const rr = body.rejectReason;
    if (!rr || !REJECT_REASONS.includes(rr)) {
      return NextResponse.json(
        { error: "Reject feedback requires a valid rejectReason." },
        { status: 400 }
      );
    }
  } else if (body.rejectReason) {
    return NextResponse.json(
      { error: "rejectReason is only valid when feedbackType is reject." },
      { status: 400 }
    );
  }

  const { data: candidate, error: cErr } = await supabase
    .from("candidates")
    .select("id, role_id")
    .eq("id", candidateId)
    .single();

  if (cErr || !candidate) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  const { data: row, error: insErr } = await supabase
    .from("candidate_feedback")
    .insert({
      candidate_id: candidateId,
      role_id: candidate.role_id,
      feedback_type: feedbackType,
      reject_reason:
        feedbackType === "reject" ? (body.rejectReason as string) : null,
    })
    .select("id, feedback_type, reject_reason, created_at")
    .single();

  if (insErr || !row) {
    return NextResponse.json(
      { error: "Failed to save feedback.", details: insErr?.message },
      { status: 500 }
    );
  }

  const { count } = await supabase
    .from("candidate_feedback")
    .select("*", { count: "exact", head: true })
    .eq("role_id", candidate.role_id);

  const n = count ?? 0;
  let calibrationError: string | null = null;
  if (n >= 5) {
    try {
      await recomputeRoleCalibration(candidate.role_id, apiKey);
    } catch (e) {
      calibrationError =
        e instanceof Error ? e.message : "Calibration update failed.";
    }
  }

  return NextResponse.json(
    {
      feedback: row,
      feedbackCount: n,
      calibrationUpdated: n >= 5 && !calibrationError,
      calibrationError,
    },
    { status: 200 }
  );
}
