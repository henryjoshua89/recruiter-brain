import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import type { BriefingSections, NewRolePayload } from "@/lib/types";

const anthropicKey = process.env.ANTHROPIC_API_KEY;

const SECTION_HEADERS = [
  "ROLE_SUMMARY",
  "CONCEPT_DEFINITIONS",
  "IDEAL_PROFILE",
  "CANDIDATE_POOL",
  "SEARCH_DIRECTION",
  "DELIVERABLES",
  "HM_PREP",
] as const;

const SECTION_HEADER_RE = new RegExp(
  `^(${SECTION_HEADERS.join("|")}):\\s*`,
  "gim"
);

const SEARCH_SUBHEADER_RE =
  /^(TARGET_COMPANIES|ALTERNATIVE_TITLES|SOURCING_CHANNELS):\s*/gim;

function briefingPromptDateIST(): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function formatCompanyContextForPrompt(
  ctx: Record<string, unknown> | null
): string {
  if (!ctx || Object.keys(ctx).length === 0) {
    return "(No company website context was captured. State clearly where inference is limited.)";
  }

  const lines: string[] = [];

  if (typeof ctx.title === "string" && ctx.title.trim()) {
    lines.push(`PAGE TITLE: ${ctx.title.trim()}`);
  }
  if (typeof ctx.ogTitle === "string" && ctx.ogTitle.trim()) {
    lines.push(`OG / SOCIAL TITLE: ${ctx.ogTitle.trim()}`);
  }
  if (typeof ctx.metaDescription === "string" && ctx.metaDescription.trim()) {
    lines.push(`META / DESCRIPTION: ${ctx.metaDescription.trim()}`);
  }
  if (typeof ctx.summary === "string" && ctx.summary.trim()) {
    lines.push(`QUICK SUMMARY (derived): ${ctx.summary.trim()}`);
  }
  if (Array.isArray(ctx.headings) && ctx.headings.length > 0) {
    const hs = ctx.headings
      .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
      .map((h) => `- ${h.trim()}`);
    if (hs.length) {
      lines.push("KEY HEADINGS FROM SITE (structure / messaging):");
      lines.push(...hs);
    }
  }
  if (typeof ctx.extractedPageText === "string" && ctx.extractedPageText.trim()) {
    lines.push(
      "--- FULL EXTRACTED VISIBLE TEXT FROM THE FETCHED PAGE (use for business model, stage, products, positioning, customers, geography, hiring hints) ---"
    );
    lines.push(ctx.extractedPageText.trim());
  }
  if (typeof ctx.sourceUrl === "string" && ctx.sourceUrl) {
    lines.push(`SOURCE URL: ${ctx.sourceUrl}`);
  }
  if (typeof ctx.fetchedAt === "string" && ctx.fetchedAt) {
    lines.push(`CONTEXT FETCHED AT (UTC): ${ctx.fetchedAt}`);
  }

  return lines.join("\n");
}

function buildPrompt({
  companyName,
  companyWebsite,
  companyContext,
  jobDescription,
  internalContext,
}: {
  companyName: string;
  companyWebsite: string;
  companyContext: Record<string, unknown> | null;
  jobDescription: string;
  internalContext: NewRolePayload["internalContext"];
}) {
  const companyBlock = formatCompanyContextForPrompt(companyContext);
  const today = briefingPromptDateIST();

  return `
Today's date (India, IST): ${today}

You are an expert recruiter and search strategist with 20 years of experience in India's talent market (including metros, NCR, Bangalore, Hyderabad, Pune, Chennai, Mumbai, and emerging hubs). You advise on how roles actually get filled in India: title conventions on Naukri and LinkedIn, compensation bands by city and stage, where candidates actually sit, and what hiring managers really mean when they write a JD.

CRITICAL: Do not use generic advice. Every insight must be grounded in (a) the specific company context below, including everything we fetched from their website, (b) the internal recruiter context, (c) the full job description, and (d) the Indian talent market for this exact role and domain. If you lack a fact, infer cautiously and label the uncertainty in one short clause—do not substitute boilerplate.

Your job is to produce a hiring briefing that reads like it was written by someone who already knows THIS company and THIS mandate—not a template.

---

INPUT — COMPANY (name + URL):
Company name: ${companyName}
Company website: ${companyWebsite}

INPUT — COMPANY WEBSITE CONTEXT (use all of it; this includes description signals, what they do, business model hints, stage, products, customers, geography, and any other details present in the extraction):
${companyBlock}

INPUT — INTERNAL CONTEXT (from the recruiter; treat as authoritative for politics, urgency, and hidden requirements):
- Why role open: ${internalContext.whyRoleOpen}
- Success in first 90 days: ${internalContext.successIn90Days}
- Non-negotiables not in the JD: ${internalContext.nonNegotiables}
- Hiring manager and working style: ${internalContext.hiringManagerStyle}
- Team size and structure: ${internalContext.teamStructure}
- Why previous person left: ${internalContext.whyLastPersonLeft || "Not provided"}

INPUT — FULL JOB DESCRIPTION:
${jobDescription}

---

SECTION-BY-SECTION QUALITY BAR (each section must cite specifics from company context + JD + internal notes; avoid repeats of the JD without interpretation):

ROLE_SUMMARY:
Explain what this role actually does in plain language, explicitly tied to THIS company's business model and stage (e.g. B2B SaaS vs marketplace vs services, India vs global footprint, growth vs efficiency chapter, regulated vs unregulated) as evidenced from the website text. Say what problem this hire solves for the company right now, not a generic "drive growth" summary.

CONCEPT_DEFINITIONS:
List JD terms and domain jargon. For each, define it as it applies HERE: this company's product, customer, and market—not a textbook definition. If the site uses their own vocabulary (e.g. "merchant", "partner", "enterprise", "platform"), align definitions to that.

IDEAL_PROFILE:
Describe the exact career trajectory and profile that wins in India for this mandate. Name plausible prior employer types and example company archetypes in India (e.g. well-known Indian unicorns or MNC captive centres, IT services majors, domestic banks, D2C brands—only where they genuinely fit the JD and company context). Be concrete about years of experience bands, scope (people/process/geo), and what "great" looks like in similar hires. Do not list vague bullets like "strong communicator".

CANDIDATE_POOL_REALITY:
Give an honest view of talent availability in India for this role: how deep/narrow the pool is, typical competition, visa/remote constraints if any, salary pressure by geography where relevant, and which industries or company types in India most often produce these people today. No generic "competitive market" phrasing—name sectors and hiring patterns.

SEARCH_DIRECTION:
You MUST fill the three subsections below. Use real, specific names where the website and JD support them; otherwise name defensible archetypes and example clusters in India (e.g. "Bangalore SaaS scale-ups in fintech infra") and explain why.

TARGET_COMPANIES: Name actual Indian companies or clearly named clusters (sector + stage + city) to source from—not "leading companies". Tie choices to why those places employ people who can do THIS job.
ALTERNATIVE_TITLES: List titles recruiters actually see on LinkedIn/Naukri for this work in India (include Hindi-English hybrid labels if common in this domain).
SOURCING_CHANNELS: Give specific LinkedIn Recruiter search moves (keywords, boolean patterns, filters, groups), plus other channels (communities, events, agencies, campuses) that fit THIS role—not generic "use LinkedIn".

DELIVERABLES (Key outcomes / metrics):
Bullet measurable outcomes and success signals that match THIS company's stage and model (e.g. revenue, margin, activation, SLAs, ship velocity, compliance, NPS—not a generic list). Tie metrics to what the HM said matters in internal context where possible.

HM_PREP:
Exactly 5 questions for the hiring manager that force clarity on THIS search. Each must reference something from internal context, company context, or JD ambiguity (scope, trade-offs, non-negotiables, success definition, team politics). Do NOT ask generic "tell me about culture" or "what are you looking for" questions.

---

OUTPUT FORMAT (plain text only — do NOT use JSON, markdown code fences, or XML):

Use EXACTLY these section headers, each on its own line, in this order. After each header, write the section body on the following lines. Plain text only; apostrophes, quotes, and line breaks in the body are fine.

ROLE_SUMMARY:
(Your prose.)

CONCEPT_DEFINITIONS:
(One term per line, hyphen bullets: "- Term: definition")

IDEAL_PROFILE:
(Your prose.)

CANDIDATE_POOL:
(Your prose.)

SEARCH_DIRECTION:
(Include the three subsections below in this exact order. Hyphen bullets under each.)

TARGET_COMPANIES:
- …
ALTERNATIVE_TITLES:
- …
SOURCING_CHANNELS:
- …

DELIVERABLES:
- …

HM_PREP:
(Exactly 5 questions, one per line; may number 1.–5. or use hyphen bullets.)

---

FINAL CONSTRAINTS:
- Follow header labels exactly (ALL CAPS, with a colon). No markdown wrapping the full response.
- Be direct, recruiter-native, and India-grounded. No clichés ("rockstar", "ninja", "world-class") unless quoting the JD.
`.trim();
}

/** Remove optional markdown fence if the model wraps the reply in \`\`\` ... \`\`\` */
function stripOptionalMarkdownFence(raw: string): string {
  let s = raw.trim();
  if (!s.startsWith("```")) {
    return s;
  }
  s = s.replace(/^```[\w-]*\s*\r?\n?/i, "").trimStart();
  s = s.replace(/\r?\n?```\s*$/i, "");
  return s.trim();
}

function extractLabeledSections(
  text: string,
  headerRegex: RegExp
): Record<string, string> {
  const matches = Array.from(text.matchAll(headerRegex));
  const out: Record<string, string> = {};
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1] as string;
    const start = matches[i].index! + matches[i][0].length;
    const end = matches[i + 1]?.index ?? text.length;
    out[key] = text.slice(start, end).trim();
  }
  return out;
}

/** Lines to list items: bullets, numbered items, or non-empty trimmed lines. */
function linesToListItems(block: string): string[] {
  if (!block.trim()) return [];
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim()
    )
    .filter(Boolean);
}

function proseFromBlock(block: string): string {
  return block.trim();
}

function parseSearchDirectionBlock(
  block: string
): BriefingSections["searchDirection"] {
  const sub = extractLabeledSections(block, SEARCH_SUBHEADER_RE);
  const keys = ["TARGET_COMPANIES", "ALTERNATIVE_TITLES", "SOURCING_CHANNELS"] as const;
  const hasAny = keys.some((k) => sub[k] !== undefined && sub[k].length > 0);
  if (!hasAny) {
    const fallback = linesToListItems(block);
    return {
      targetCompanies: fallback.length > 0 ? fallback : [proseFromBlock(block)],
      alternativeTitles: [],
      sourcingChannels: [],
    };
  }
  return {
    targetCompanies: linesToListItems(sub.TARGET_COMPANIES ?? ""),
    alternativeTitles: linesToListItems(sub.ALTERNATIVE_TITLES ?? ""),
    sourcingChannels: linesToListItems(sub.SOURCING_CHANNELS ?? ""),
  };
}

function parseBriefingPlainText(raw: string): BriefingSections {
  const text = stripOptionalMarkdownFence(raw);
  const sections = extractLabeledSections(
    text,
    new RegExp(SECTION_HEADER_RE.source, "gim")
  );

  const roleSummary = proseFromBlock(sections.ROLE_SUMMARY ?? "");
  if (!roleSummary) {
    throw new Error(
      "Model response missing ROLE_SUMMARY section or empty body. Check the prompt output format."
    );
  }

  const conceptDefs = linesToListItems(sections.CONCEPT_DEFINITIONS ?? "");
  const idealProfile = proseFromBlock(sections.IDEAL_PROFILE ?? "");
  const candidatePool = proseFromBlock(sections.CANDIDATE_POOL ?? "");
  const searchDirection = parseSearchDirectionBlock(
    sections.SEARCH_DIRECTION ?? ""
  );
  const deliverables = linesToListItems(sections.DELIVERABLES ?? "");
  let hmPrep = linesToListItems(sections.HM_PREP ?? "");

  if (hmPrep.length === 0 && (sections.HM_PREP ?? "").trim()) {
    hmPrep = [(sections.HM_PREP ?? "").trim()];
  }

  return {
    roleSummary,
    conceptDefinitions:
      conceptDefs.length > 0
        ? conceptDefs
        : ["No specialised terms called out — review JD for domain jargon."],
    idealProfile: idealProfile || "Not specified in briefing.",
    candidatePoolReality:
      candidatePool || "Not specified in briefing.",
    searchDirection,
    keyDeliverablesAndMetrics:
      deliverables.length > 0
        ? deliverables
        : ["See role description for deliverables; refine with hiring manager."],
    hmMeetingPrep: hmPrep,
  };
}

export async function POST(request: Request) {
  try {
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

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: buildPrompt({
            companyName: company.name,
            companyWebsite: company.website_url,
            companyContext: (company.public_context ??
              null) as Record<string, unknown> | null,
            jobDescription: body.jobDescription.trim(),
            internalContext: body.internalContext,
          }),
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || !("text" in textBlock)) {
      return NextResponse.json(
        { error: "No text response from model." },
        { status: 500 }
      );
    }

    const parsed = parseBriefingPlainText(textBlock.text);

    const { data: role, error: roleError } = await supabase
      .from("roles")
      .insert({
        company_id: body.companyId,
        job_description: body.jobDescription.trim(),
        internal_context: body.internalContext,
        briefing: parsed,
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
