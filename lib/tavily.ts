import { tavily } from "@tavily/core";

// ── Shared types ──────────────────────────────────────────────────────────────
export type TavilyFootprint = {
  summary: string;
  signals: string[];
  scoreBoost: number; // 0–1.0, applied to jd/role fit scores
};

export type MarketIntelligenceSearch = {
  answer: string;
  snippets: string[];
};

export type MarketIntelligence = {
  companyIntelligence: MarketIntelligenceSearch;
  talentPool: MarketIntelligenceSearch;
  industryMetrics: MarketIntelligenceSearch;
  roleTitle: string;
  fetchedAt: string;
};

// ── Helper ────────────────────────────────────────────────────────────────────
function makeClient(apiKey: string) {
  return tavily({ apiKey });
}

function pickSnippets(
  results: { title: string; content: string }[],
  max = 4
): string[] {
  return results
    .slice(0, max)
    .map((r) => `[${r.title}] ${r.content.slice(0, 300)}`)
    .filter(Boolean);
}

// ── JD Comprehension — three market intelligence searches ─────────────────────
export async function fetchJDEnrichment(params: {
  companyName: string;
  roleTitle: string;
  apiKey: string;
}): Promise<MarketIntelligence> {
  const { companyName, roleTitle, apiKey } = params;
  const client = makeClient(apiKey);
  const opts = { searchDepth: "basic" as const, maxResults: 5, includeAnswer: true };

  const [compRes, talentRes, metricsRes] = await Promise.allSettled([
    client.search(
      `"${companyName}" company overview funding stage product India 2025 2026`,
      opts
    ),
    client.search(
      `"${roleTitle}" hiring India talent pool salary range 2025 2026`,
      opts
    ),
    client.search(
      `${roleTitle} KPIs metrics benchmarks India success criteria 2025`,
      opts
    ),
  ]);

  function extract(r: PromiseSettledResult<Awaited<ReturnType<typeof client.search>>>): MarketIntelligenceSearch {
    if (r.status === "rejected") return { answer: "", snippets: [] };
    return {
      answer: r.value.answer ?? "",
      snippets: pickSnippets(r.value.results),
    };
  }

  return {
    companyIntelligence: extract(compRes),
    talentPool: extract(talentRes),
    industryMetrics: extract(metricsRes),
    roleTitle,
    fetchedAt: new Date().toISOString(),
  };
}

/** Format market intelligence as a block to inject into Claude prompts. */
export function formatMarketIntelligenceForPrompt(mi: MarketIntelligence): string {
  const lines: string[] = [
    "═══ LIVE MARKET INTELLIGENCE (from web research — use to make briefing specific and current) ═══",
    "",
    "COMPANY INTELLIGENCE:",
    mi.companyIntelligence.answer || "(no summary available)",
    ...mi.companyIntelligence.snippets.map((s) => `  • ${s}`),
    "",
    "TALENT POOL & SALARY (India, 2025–26):",
    mi.talentPool.answer || "(no summary available)",
    ...mi.talentPool.snippets.map((s) => `  • ${s}`),
    "",
    "INDUSTRY METRICS & KPIs:",
    mi.industryMetrics.answer || "(no summary available)",
    ...mi.industryMetrics.snippets.map((s) => `  • ${s}`),
    "",
    "Use the above to:",
    "- Cite current salary ranges in CANDIDATE_POOL_REALITY",
    "- Name real companies hiring for this role in TARGET_COMPANIES",
    "- Reference role-specific KPIs in DELIVERABLES",
    "- Ground company stage claims in ROLE_SUMMARY with evidence from the intelligence above",
  ];
  return lines.join("\n");
}

// ── Candidate digital footprint (for resume enrichment) ──────────────────────
export async function fetchCandidateFootprint(
  candidateName: string,
  currentCompany: string,
  apiKey: string
): Promise<TavilyFootprint | null> {
  if (!candidateName.trim()) return null;
  try {
    const client = makeClient(apiKey);
    const res = await client.search(
      `"${candidateName}" ${currentCompany} github linkedin conference speaker blog article`,
      { searchDepth: "basic", maxResults: 5, includeAnswer: false }
    );
    if (!res.results.length) return null;

    const allText = res.results
      .map((r) => `${r.title} ${r.url} ${r.content}`)
      .join(" ")
      .toLowerCase();

    const signals: string[] = [];
    if (/github\.com/.test(allText)) signals.push("GitHub presence");
    if (/conference|speaker|keynote|presented at|talk at/.test(allText))
      signals.push("Conference speaker");
    if (/blog|medium\.com|dev\.to|substack|hashnode|wrote|article/.test(allText))
      signals.push("Published articles");
    if (/open.?source|contributor|pull request|merged pr/.test(allText))
      signals.push("Open source contributor");
    if (/patent/.test(allText)) signals.push("Patent holder");
    if (/podcast/.test(allText)) signals.push("Podcast guest");
    if (/award|winner|recognised|recognition|top \d+/.test(allText))
      signals.push("Industry recognition");

    const scoreBoost = Math.min(signals.length * 0.25, 1.0);
    const summary = res.results
      .slice(0, 3)
      .map((r) => r.content.slice(0, 250))
      .join(" | ")
      .slice(0, 700);

    return { summary, signals, scoreBoost };
  } catch {
    return null;
  }
}

/** Crawl specific URLs (LinkedIn, portfolio) and return raw text. */
export async function fetchUrlFootprint(
  urls: string[],
  apiKey: string
): Promise<string | null> {
  const validUrls = urls.filter(Boolean).slice(0, 3);
  if (!validUrls.length) return null;
  try {
    const client = makeClient(apiKey);
    const res = await client.extract(validUrls);
    const snippets = (res.results ?? []).map(
      (r: { url: string; rawContent?: string }) =>
        `[${r.url}]\n${(r.rawContent ?? "").slice(0, 800)}`
    );
    return snippets.join("\n\n").slice(0, 3000) || null;
  } catch {
    return null;
  }
}

/** Simple heuristic: grab a candidate name from the top lines of a resume. */
export function heuristicNameFromResume(resumeText: string): string {
  const lines = resumeText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 10)) {
    if (
      line.length >= 4 &&
      line.length <= 60 &&
      /^[A-Za-z][A-Za-z\s.\-]{2,58}$/.test(line) &&
      line.split(/\s+/).length >= 2 &&
      line.split(/\s+/).length <= 5
    ) {
      return line;
    }
  }
  return "";
}

/** Extract role title from first usable line of a job description. */
export function heuristicRoleTitleFromJD(jd: string): string {
  const lines = jd.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (line.length >= 4 && line.length <= 120 && !line.includes(":")) {
      return line;
    }
  }
  return lines[0]?.slice(0, 100) ?? "Senior Role";
}
