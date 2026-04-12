import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ candidateId: string; feedbackId: string }> }
) {
  const { candidateId, feedbackId } = await context.params;

  const { error } = await supabase
    .from("candidate_feedback")
    .delete()
    .eq("id", feedbackId)
    .eq("candidate_id", candidateId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete feedback.", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ deleted: true });
}
