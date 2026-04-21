/**
 * Shared utilities for maintaining `talent_flow_data` on the roles table.
 *
 * talent_flow_data is a jsonb column with shape:
 *   { [companyName]: { total, shortlisted, rejected, conversion_rate } }
 *
 * - total            — how many candidates reviewed who worked at this company
 * - shortlisted      — how many of those were shortlisted
 * - rejected         — how many of those were rejected
 * - conversion_rate  — Math.round(shortlisted / total * 100)
 *
 * Hold feedback is intentionally ignored — it's a deferral, not a signal.
 */

import { supabase } from "@/lib/supabase";
import type { ResumeCompanyEntry, TalentFlowData, TalentFlowEntry } from "@/lib/types";

function blank(): TalentFlowEntry {
  return { total: 0, shortlisted: 0, rejected: 0, conversion_rate: 0 };
}

function recalc(e: TalentFlowEntry): TalentFlowEntry {
  return {
    ...e,
    // Cap at 100 — multiple feedback records per candidate can push shortlisted > total
    conversion_rate: e.total > 0 ? Math.min(100, Math.round((e.shortlisted / e.total) * 100)) : 0,
  };
}

async function fetchCurrent(roleId: string): Promise<TalentFlowData> {
  const { data } = await supabase
    .from("roles")
    .select("talent_flow_data")
    .eq("id", roleId)
    .single();
  return (data?.talent_flow_data as TalentFlowData | null) ?? {};
}

async function writeCurrent(roleId: string, data: TalentFlowData): Promise<void> {
  await supabase
    .from("roles")
    .update({ talent_flow_data: data })
    .eq("id", roleId);
}

/**
 * Called after a new candidate is inserted.
 * Increments the `total` counter for each company in their work history.
 */
export async function updateTalentFlowOnAnalysis(
  roleId: string,
  companies: ResumeCompanyEntry[]
): Promise<void> {
  if (!companies?.length) return;
  const current = await fetchCurrent(roleId);
  for (const co of companies) {
    const name = co.name?.trim();
    if (!name) continue;
    const entry = current[name] ?? blank();
    current[name] = recalc({ ...entry, total: entry.total + 1 });
  }
  await writeCurrent(roleId, current);
}

/**
 * Called after shortlist or reject feedback is saved.
 * Increments shortlisted or rejected for each of the candidate's companies,
 * then recalculates conversion_rate.
 */
export async function updateTalentFlowOnFeedback(
  roleId: string,
  companies: ResumeCompanyEntry[],
  feedbackType: "shortlist" | "reject" | "hold"
): Promise<void> {
  if (!companies?.length || feedbackType === "hold") return;
  const current = await fetchCurrent(roleId);
  for (const co of companies) {
    const name = co.name?.trim();
    if (!name) continue;
    const entry = current[name] ?? blank();
    const updated = { ...entry };
    if (feedbackType === "shortlist") updated.shortlisted += 1;
    else updated.rejected += 1;
    current[name] = recalc(updated);
  }
  await writeCurrent(roleId, current);
}
