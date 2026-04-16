import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { MarketIntelligence, NewRolePayload } from "@/lib/types";
import { generateBriefing } from "@/lib/briefing-claude";
import {
  fetchJDEnrichment,
  fetchTalentFlow,
  formatMarketIntelligenceForPrompt,
  heuristicRoleTitleFromJD,
} from "@/lib/tavily";

export async function POST(request: Request) {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json(
        { error: "Missing ANTHROPIC_API_KEY in environment." },
        { status: 500 }
      );
    }

    const body = (await request.json()) as NewRolePayload;
    if (!body.companyId || !body.jobDescription?.trim()) {
      return NextResponse.json(
        { error: "Company and job description are required." },
        { status: 400 }
      );
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, name, website_url, public_context")
      .eq("id", body.companyId)
      .single();

    if (companyError || !company) {
      return NextResponse.json(
        { error: "Company not found.", details: companyError?.message },
        { status: 404 }
      );
    }

    // ── Tavily market intelligence (non-fatal) ──────────────────────────────
    const tavilyKey = process.env.TAVILY_API_KEY;
    let marketIntelligence: MarketIntelligence | null = null;
    let marketIntelligenceContext: string | null = null;
    if (tavilyKey) {
      try {
        const roleTitle = heuristicRoleTitleFromJD(body.jobDescription.trim());
        // Run JD enrichment + talent flow searches in parallel
        const [jdEnrichment, talentFlowResult] = await Promise.all([
          fetchJDEnrichment({ companyName: company.name, roleTitle, apiKey: tavilyKey }),
          fetchTalentFlow({ roleTitle, industry: company.name, apiKey: tavilyKey }).catch((e) => {
            console.error("Tavily talent flow failed (non-fatal):", e);
            return null;
          }),
        ]);
        marketIntelligence = {
          ...jdEnrichment,
          talentFlowResearch: talentFlowResult,
        };
        marketIntelligenceContext = formatMarketIntelligenceForPrompt(marketIntelligence);
      } catch (e) {
        console.error("Tavily enrichment failed (non-fatal):", e);
      }
    }

    // ── Generate briefing with Claude ────────────────────────────────────────
    const parsed = await generateBriefing({
      apiKey: anthropicKey,
      companyName: company.name,
      companyWebsite: company.website_url,
      companyContext: (company.public_context ?? null) as Record<string, unknown> | null,
      jobDescription: body.jobDescription.trim(),
      internalContext: body.internalContext,
      marketIntelligenceContext,
    });

    // ── Save to Supabase ─────────────────────────────────────────────────────
    const { data: role, error: roleError } = await supabase
      .from("roles")
      .insert({
        company_id: body.companyId,
        job_description: body.jobDescription.trim(),
        internal_context: body.internalContext,
        briefing: parsed,
        market_intelligence: marketIntelligence ?? null,
      })
      .select("id, created_at")
      .single();

    if (roleError || !role) {
      return NextResponse.json(
        { error: "Failed to save role.", details: roleError?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      roleId: role.id,
      createdAt: role.created_at,
      briefing: parsed,
      marketIntelligence: marketIntelligence ?? null,
      company: {
        id: company.id,
        name: company.name,
        websiteUrl: company.website_url,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
