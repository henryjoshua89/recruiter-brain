import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ── PATCH — update an entry's text ───────────────────────────────────────────
export async function PATCH(
  request: Request,
  context: { params: Promise<{ roleId: string; entryId: string }> }
) {
  const { roleId, entryId } = await context.params;

  const body = (await request.json()) as { entry?: string };
  const entry = body.entry?.trim();

  if (!entry) {
    return NextResponse.json(
      { error: "entry is required and must not be empty." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("role_intelligence")
    .update({ entry, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("role_id", roleId)
    .select("id, entry, created_at, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to update intelligence entry.", details: error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    entry: {
      id: data.id,
      entry: data.entry,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}

// ── DELETE — remove an entry ──────────────────────────────────────────────────
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ roleId: string; entryId: string }> }
) {
  const { roleId, entryId } = await context.params;

  const { error } = await supabase
    .from("role_intelligence")
    .delete()
    .eq("id", entryId)
    .eq("role_id", roleId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete intelligence entry.", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
