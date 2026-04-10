import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data: roles, error } = await supabase
    .from("roles")
    .select(
      `
      id,
      created_at,
      company_id,
      job_description,
      companies ( id, name, website_url )
    `
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load roles.", details: error.message },
      { status: 500 }
    );
  }

  const roleIds = (roles ?? []).map((r) => r.id);
  const counts = new Map<string, number>();

  if (roleIds.length > 0) {
    const { data: agg } = await supabase
      .from("candidates")
      .select("role_id")
      .in("role_id", roleIds);

    for (const row of agg ?? []) {
      const id = row.role_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  const payload = (roles ?? []).map((r) => {
    const raw = r.companies as unknown;
    const row = Array.isArray(raw) ? raw[0] : raw;
    const c = row as {
      id: string;
      name: string;
      website_url: string;
    } | null;
    return {
      id: r.id,
      createdAt: r.created_at,
      companyId: r.company_id,
      companyName: c?.name ?? "Company",
      companyWebsite: c?.website_url ?? "",
      candidateCount: counts.get(r.id) ?? 0,
      jobDescriptionPreview: (r.job_description as string)?.slice(0, 140) ?? "",
    };
  });

  return NextResponse.json({ roles: payload });
}
