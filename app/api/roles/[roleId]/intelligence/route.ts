import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export type IntelligenceEntry = {
  id: string;
  entry: string;
  createdAt: string;
  updatedAt: string;
};

// ── GET — list all entries for a role, newest first ──────────────────────────
export async function GET(
  _request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;

  const { data, error } = await supabase
    .from("role_intelligence")
    .select("id, entry, created_at, updated_at")
    .eq("role_id", roleId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch intelligence entries.", details: error.message },
      { status: 500 }
    );
  }

  const entries: IntelligenceEntry[] = (data ?? []).map((row) => ({
    id: row.id,
    entry: row.entry,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json({ entries });
}

// ── POST — create a new entry ─────────────────────────────────────────────────
export async function POST(
  request: Request,
  context: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await context.params;

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
    .insert({ role_id: roleId, entry })
    .select("id, entry, created_at, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create intelligence entry.", details: error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    entry: {
      id: data.id,
      entry: data.entry,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    } satisfies IntelligenceEntry,
  });
}
