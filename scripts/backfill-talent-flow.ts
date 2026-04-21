/**
 * Backfill talent_flow_data for all existing roles.
 *
 * Run via:
 *   npx ts-node --project tsconfig.scripts.json scripts/backfill-talent-flow.ts
 *
 * Or (more reliably, while dev server is running):
 *   curl -sN -X POST http://localhost:3000/api/admin/backfill-talent-flow
 *
 * The script reads .env.local automatically, so no manual env setup needed.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import * as fs from "fs";
import * as path from "path";

// Load .env.local BEFORE requiring any module that reads process.env
(function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([^#=\s][^=]*)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
})();

const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

type CompanyEntry = { name: string; estimatedSize: string; estimatedStage: string };
type TalentEntry = { total: number; shortlisted: number; rejected: number; conversion_rate: number };
type TalentFlowData = Record<string, TalentEntry>;

function recalc(e: TalentEntry): TalentEntry {
  return { ...e, conversion_rate: e.total > 0 ? Math.min(100, Math.round((e.shortlisted / e.total) * 100)) : 0 };
}

async function main() {
  console.log("🔄  Loading roles…");
  const { data: roles, error: rErr } = await db
    .from("roles")
    .select("id")
    .order("created_at", { ascending: true });

  if (rErr || !roles) { console.error("❌  Failed to load roles:", rErr?.message); process.exit(1); }
  console.log(`   Found ${roles.length} role(s)`);

  console.log("🔄  Loading candidates…");
  const { data: candidates, error: cErr } = await db
    .from("candidates")
    .select("id, role_id, analysis");

  if (cErr || !candidates) { console.error("❌  Failed to load candidates:", cErr?.message); process.exit(1); }
  console.log(`   Found ${candidates.length} candidate(s)`);

  console.log("🔄  Loading feedback…");
  const { data: feedback, error: fErr } = await db
    .from("candidate_feedback")
    .select("candidate_id, feedback_type");

  if (fErr) { console.error("❌  Failed to load feedback:", fErr?.message); process.exit(1); }

  // Index feedback by candidate_id — keep only the LATEST signal per candidate
  // Supabase returns rows in insert order; we just take first seen (latest via ordering)
  const fbByCandidateId = new Map<string, string>(); // candidateId → latest feedbackType
  for (const f of (feedback ?? [])) {
    if (!fbByCandidateId.has(f.candidate_id)) fbByCandidateId.set(f.candidate_id, f.feedback_type);
  }

  // Group candidates by role
  const candidatesByRole = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const list = candidatesByRole.get(c.role_id) ?? [];
    list.push(c);
    candidatesByRole.set(c.role_id, list);
  }

  let rolesUpdated = 0;
  let totalCandidates = 0;

  for (const role of roles) {
    const roleCandidates = candidatesByRole.get(role.id) ?? [];
    const tfd: TalentFlowData = {};

    for (const c of roleCandidates) {
      const analysis = c.analysis as { companies?: CompanyEntry[] } | null;
      const companies = analysis?.companies ?? [];
      totalCandidates++;

      for (const co of companies) {
        const name = co.name?.trim();
        if (!name) continue;
        const entry = tfd[name] ?? { total: 0, shortlisted: 0, rejected: 0, conversion_rate: 0 };
        entry.total += 1;
        tfd[name] = entry;
      }

      // Apply latest feedback signal (one per candidate)
      const signal = fbByCandidateId.get(c.id);
      if (signal === "shortlist" || signal === "reject") {
        for (const co of companies) {
          const name = co.name?.trim();
          if (!name || !tfd[name]) continue;
          if (signal === "shortlist") tfd[name].shortlisted += 1;
          else tfd[name].rejected += 1;
        }
      }
    }

    // Recalculate conversion rates
    for (const name of Object.keys(tfd)) {
      tfd[name] = recalc(tfd[name]);
    }

    const { error: updateErr } = await db
      .from("roles")
      .update({ talent_flow_data: Object.keys(tfd).length > 0 ? tfd : null })
      .eq("id", role.id);

    if (updateErr) {
      console.error(`❌  Failed to update role ${role.id}:`, updateErr.message);
    } else {
      rolesUpdated++;
      const companyCount = Object.keys(tfd).length;
      console.log(`✅  Role ${role.id} — ${roleCandidates.length} candidates, ${companyCount} companies tracked`);
    }
  }

  console.log(`\n🎉  Done. Updated ${rolesUpdated}/${roles.length} roles, processed ${totalCandidates} candidates.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
