/**
 * POST /api/admin/backfill-talent-flow
 *
 * Rebuilds talent_flow_data from scratch for every role using existing
 * candidate analyses and feedback records. Safe to re-run — overwrites
 * any existing talent_flow_data with a freshly computed value.
 *
 *   curl -sN -X POST http://localhost:3000/api/admin/backfill-talent-flow
 */

import { supabase } from "@/lib/supabase";
import type { ResumeCompanyEntry, TalentFlowData, TalentFlowEntry } from "@/lib/types";

export const maxDuration = 120;

function recalc(e: TalentFlowEntry): TalentFlowEntry {
  return {
    ...e,
    conversion_rate: e.total > 0 ? Math.min(100, Math.round((e.shortlisted / e.total) * 100)) : 0,
  };
}

export async function POST() {
  // 1. Fetch all roles
  const { data: roles, error: rErr } = await supabase
    .from("roles")
    .select("id")
    .order("created_at", { ascending: true });

  if (rErr || !roles) {
    return new Response(
      JSON.stringify({ error: "Failed to load roles.", details: rErr?.message }) + "\n",
      { status: 500, headers: { "Content-Type": "application/x-ndjson" } }
    );
  }

  // 2. Fetch all candidates
  const { data: candidates, error: cErr } = await supabase
    .from("candidates")
    .select("id, role_id, analysis");

  if (cErr || !candidates) {
    return new Response(
      JSON.stringify({ error: "Failed to load candidates.", details: cErr?.message }) + "\n",
      { status: 500, headers: { "Content-Type": "application/x-ndjson" } }
    );
  }

  // 3. Fetch all feedback
  const { data: feedback } = await supabase
    .from("candidate_feedback")
    .select("candidate_id, feedback_type");

  // Index feedback by candidate_id — keep only the LATEST signal per candidate
  // (matches how the UI resolves feedback: attachLatestFeedback picks the first row
  //  when ordered by created_at descending, i.e. the most recent record)
  const fbMap = new Map<string, string>(); // candidateId → latest feedbackType
  for (const f of (feedback ?? [])) {
    if (!fbMap.has(f.candidate_id)) fbMap.set(f.candidate_id, f.feedback_type);
  }

  // Group candidates by role
  const byRole = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const list = byRole.get(c.role_id) ?? [];
    list.push(c);
    byRole.set(c.role_id, list);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      }

      send({ event: "start", roles: roles.length, candidates: candidates.length });

      let succeeded = 0;
      let failed = 0;
      let totalCandidatesProcessed = 0;

      for (const role of roles) {
        const roleCandidates = byRole.get(role.id) ?? [];
        const tfd: TalentFlowData = {};

        for (const c of roleCandidates) {
          const analysis = c.analysis as { companies?: ResumeCompanyEntry[] } | null;
          const companies = analysis?.companies ?? [];
          totalCandidatesProcessed++;

          // Increment totals
          for (const co of companies) {
            const name = co.name?.trim();
            if (!name) continue;
            const entry = tfd[name] ?? { total: 0, shortlisted: 0, rejected: 0, conversion_rate: 0 };
            tfd[name] = { ...entry, total: entry.total + 1 };
          }

          // Apply latest feedback signal (one per candidate)
          const signal = fbMap.get(c.id);
          if (signal === "shortlist" || signal === "reject") {
            for (const co of companies) {
              const name = co.name?.trim();
              if (!name || !tfd[name]) continue;
              if (signal === "shortlist") tfd[name].shortlisted += 1;
              else tfd[name].rejected += 1;
            }
          }
        }

        // Recalculate conversion rates — cap at 100%
        for (const name of Object.keys(tfd)) tfd[name] = recalc(tfd[name]);


        const { error: updateErr } = await supabase
          .from("roles")
          .update({ talent_flow_data: Object.keys(tfd).length > 0 ? tfd : null })
          .eq("id", role.id);

        if (updateErr) {
          failed++;
          send({ event: "error", roleId: role.id, message: updateErr.message });
        } else {
          succeeded++;
          send({
            event: "done",
            roleId: role.id,
            candidates: roleCandidates.length,
            companies: Object.keys(tfd).length,
            data: tfd,
          });
        }
      }

      send({
        event: "complete",
        roles: roles.length,
        succeeded,
        failed,
        candidatesProcessed: totalCandidatesProcessed,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
