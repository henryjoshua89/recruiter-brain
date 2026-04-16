/**
 * Shared briefing generation logic — used by both:
 *   app/api/new-role/route.ts  (create)
 *   app/api/roles/[roleId]/route.ts  (regenerate / PATCH)
 */

import Anthropic from "@anthropic-ai/sdk";
import type { BriefingSections, NewRolePayload } from "@/lib/types";

const MODEL = "claude-sonnet-4-20250514";

const SECTION_HEADERS = [
  "ROLE_SUMMARY",
  "CONCEPT_DEFINITIONS",
  "IDEAL_PROFILE",
  "CANDIDATE_POOL",
  "SEARCH_DIRECTION",
  "DELIVERABLES",
  "HM_PREP",
] as const;

export const SECTION_HEADER_RE = new RegExp(
  `^(${SECTION_HEADERS.join("|")}):\\s*`,
  "gim"
);

export const SEARCH_SUBHEADER_RE =
  /^(TARGET_COMPANIES|ALTERNATIVE_TITLES|SOURCING_CHANNELS):\s*/gim;

export function briefingPromptDateIST(): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

export function formatCompanyContextForPrompt(
  ctx: Record<string, unknown> | null
): string {
  if (!ctx || Object.keys(ctx).length === 0) {
    return "(No company website context was captured. State clearly where inference is limited.)";
  }
  const lines: string[] = [];
  if (typeof ctx.title === "string" && ctx.title.trim())
    lines.push(`PAGE TITLE: ${ctx.title.trim()}`);
  if (typeof ctx.ogTitle === "string" && ctx.ogTitle.trim())
    lines.push(`OG / SOCIAL TITLE: ${ctx.ogTitle.trim()}`);
  if (typeof ctx.metaDescription === "string" && ctx.metaDescription.trim())
    lines.push(`META / DESCRIPTION: ${ctx.metaDescription.trim()}`);
  if (typeof ctx.summary === "string" && ctx.summary.trim())
    lines.push(`QUICK SUMMARY (derived): ${ctx.summary.trim()}`);
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
      "--- FULL EXTRACTED VISIBLE TEXT FROM THE FETCHED PAGE ---"
    );
    lines.push(ctx.extractedPageText.trim());
  }
  if (typeof ctx.sourceUrl === "string" && ctx.sourceUrl)
    lines.push(`SOURCE URL: ${ctx.sourceUrl}`);
  if (typeof ctx.fetchedAt === "string" && ctx.fetchedAt)
    lines.push(`CONTEXT FETCHED AT (UTC): ${ctx.fetchedAt}`);
  return lines.join("\n");
}

export function buildBriefingPrompt({
  companyName,
  companyWebsite,
  companyContext,
  jobDescription,
  internalContext,
  marketIntelligenceContext,
}: {
  companyName: string;
  companyWebsite: string;
  companyContext: Record<string, unknown> | null;
  jobDescription: string;
  internalContext: NewRolePayload["internalContext"];
  marketIntelligenceContext?: string | null;
}): string {
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

${marketIntelligenceContext ? marketIntelligenceContext + "\n\n" : ""}INPUT — FULL JOB DESCRIPTION:
${jobDescription}

---

SECTION-BY-SECTION QUALITY BAR (each section must cite specifics from company context + JD + internal notes; avoid repeats of the JD without interpretation):

ROLE_SUMMARY:
Explain what this role actually does in plain language, explicitly tied to THIS company's business model and stage.

CONCEPT_DEFINITIONS:
List JD terms and domain jargon. For each, define it as it applies HERE.

IDEAL_PROFILE:
Describe the exact career trajectory and profile that wins in India for this mandate. Name plausible prior employer types and example company archetypes in India.

CANDIDATE_POOL_REALITY:
Give an honest view of talent availability in India for this role.

SEARCH_DIRECTION:
You MUST fill the three subsections below.

TARGET_COMPANIES: Name actual Indian companies or clearly named clusters.
ALTERNATIVE_TITLES: List titles recruiters actually see on LinkedIn/Naukri.
SOURCING_CHANNELS: Give specific LinkedIn Recruiter search moves and other channels.

DELIVERABLES (Key outcomes / metrics):
Bullet measurable outcomes and success signals.

HM_PREP:
Exactly 5 questions for the hiring manager.

---

OUTPUT FORMAT (plain text only — do NOT use JSON, markdown code fences, or XML):

Use EXACTLY these section headers, each on its own line, in this order.

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

export function stripOptionalMarkdownFence(raw: string): string {
  let s = raw.trim();
  if (!s.startsWith("```")) return s;
  s = s.replace(/^```[\w-]*\s*\r?\n?/i, "").trimStart();
  s = s.replace(/\r?\n?```\s*$/i, "");
  return s.trim();
}

export function extractLabeledSections(
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

export function linesToListItems(block: string): string[] {
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

export function proseFromBlock(block: string): string {
  return block.trim();
}

export function parseSearchDirectionBlock(
  block: string
): BriefingSections["searchDirection"] {
  const sub = extractLabeledSections(
    block,
    new RegExp(SEARCH_SUBHEADER_RE.source, "gim")
  );
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

export function parseBriefingPlainText(raw: string): BriefingSections {
  const text = stripOptionalMarkdownFence(raw);
  const sections = extractLabeledSections(
    text,
    new RegExp(SECTION_HEADER_RE.source, "gim")
  );

  const roleSummary = proseFromBlock(sections.ROLE_SUMMARY ?? "");
  if (!roleSummary) {
    throw new Error(
      "Model response missing ROLE_SUMMARY section or empty body."
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
    candidatePoolReality: candidatePool || "Not specified in briefing.",
    searchDirection,
    keyDeliverablesAndMetrics:
      deliverables.length > 0
        ? deliverables
        : ["See role description for deliverables; refine with hiring manager."],
    hmMeetingPrep: hmPrep,
  };
}

/** Run the full Claude briefing generation and return parsed BriefingSections. */
export async function generateBriefing(args: {
  apiKey: string;
  companyName: string;
  companyWebsite: string;
  companyContext: Record<string, unknown> | null;
  jobDescription: string;
  internalContext: NewRolePayload["internalContext"];
  marketIntelligenceContext?: string | null;
}): Promise<BriefingSections> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const prompt = buildBriefingPrompt(args);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || !("text" in textBlock)) {
    throw new Error("No text response from model.");
  }

  return parseBriefingPlainText(textBlock.text);
}
