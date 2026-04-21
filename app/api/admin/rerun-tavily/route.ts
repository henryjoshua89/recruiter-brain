/**
 * POST /api/admin/rerun-tavily
 *
 * Re-fetches Tavily market intelligence (JD enrichment + talent flow) for
 * every role in the database and writes the result back to market_intelligence.
 * Does NOT regenerate the Claude briefing — only updates the raw research data.
 *
 * Returns a streaming NDJSON response so you can watch progress in real time:
 *   curl -sN -X POST http://localhost:3000/api/admin/rerun-tavily
 */

import { supabase } from "@/lib/supabase";
import {
  fetchJDEnrichment,
  fetchTalentFlow,
  heuristicRoleTitleFromJD,
} from "@/lib/tavily";

export const maxDuration = 300; // 5-minute Vercel function timeout

export async function POST() {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) {
    return new Response(
      JSON.stringify({ error: "TAVILY_API_KEY not set." }) + "\n",
      { status: 500, headers: { "Content-Type": "application/x-ndjson" } }
    );
  }

  // Fetch all roles with their company
  const { data: roles, error } = await supabase
    .from("roles")
    .select(
      "id, job_description, companies ( id, name )"
    )
    .order("created_at", { ascending: true });

  if (error || !roles) {
    return new Response(
      JSON.stringify({ error: "Failed to load roles.", details: error?.message }) + "\n",
      { status: 500, headers: { "Content-Type": "application/x-ndjson" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      }

      send({ event: "start", total: roles.length });

      let succeeded = 0;
      let failed = 0;

      for (let i = 0; i < roles.length; i++) {
        const row = roles[i];
        const rawCo = row.companies as unknown;
        const co = (Array.isArray(rawCo) ? rawCo[0] : rawCo) as { id: string; name: string } | null;
        const companyName = co?.name ?? "Unknown";
        const roleTitle = heuristicRoleTitleFromJD((row.job_description ?? "").trim(), companyName);

        send({ event: "progress", index: i + 1, total: roles.length, roleId: row.id, roleTitle, company: companyName });

        try {
          const [jdEnrichment, talentFlowResult] = await Promise.all([
            fetchJDEnrichment({ companyName, roleTitle, apiKey: tavilyKey }),
            fetchTalentFlow({ roleTitle, industry: companyName, apiKey: tavilyKey }).catch((e) => {
              console.error(`Talent flow failed for role ${row.id}:`, e);
              return null;
            }),
          ]);

          const marketIntelligence = {
            ...jdEnrichment,
            talentFlowResearch: talentFlowResult,
          };

          const { error: updateErr } = await supabase
            .from("roles")
            .update({ market_intelligence: marketIntelligence })
            .eq("id", row.id);

          if (updateErr) throw new Error(updateErr.message);

          succeeded++;
          send({
            event: "done",
            roleId: row.id,
            roleTitle,
            company: companyName,
            talentFlow: talentFlowResult !== null,
          });
        } catch (e) {
          failed++;
          send({
            event: "error",
            roleId: row.id,
            roleTitle,
            company: companyName,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      send({ event: "complete", total: roles.length, succeeded, failed });
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
