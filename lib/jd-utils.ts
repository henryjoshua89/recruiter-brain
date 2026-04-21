/**
 * Lightweight JD / resume text utilities — no external SDK dependencies.
 * Safe to import from server components and API routes alike.
 */

// ── Role title extraction ──────────────────────────────────────────────────────

/**
 * Common intro section headers that appear at the top of JDs but are NOT
 * the role title. Skip any line that matches these exactly (case-insensitive).
 */
const SKIP_INTRO_RE = /^(about\s+(us|the\s+(role|company|position|team|job)|our\s+(company|team))|who\s+we\s+are|what\s+we\s+do|our\s+(story|mission|vision|values|company)|company\s+overview|role\s+overview|job\s+overview|overview|summary|description|introduction|the\s+(company|opportunity|role)|responsibilities|requirements|qualifications|benefits|why\s+(us|join\s+us|work\s+with\s+us)|join\s+us|we(?:'re| are)\s+hiring)\s*[:\-·]?$/i;

/**
 * Patterns that introduce the role title inline.
 * We capture the part AFTER the label as the title.
 * e.g. "We are looking for a Senior Data Analyst" → "Senior Data Analyst"
 */
const INLINE_TITLE_RES: RegExp[] = [
  /^(?:role|position|job\s+title|title|opening)\s*:\s*(.+)/i,
  /^we(?:'re| are)\s+(?:hiring|looking\s+for|seeking)\s+(?:a[n]?\s+)?(.+)/i,
  /^(?:hiring|seeking)\s+(?:a[n]?\s+)?(.+)/i,
  /^(?:looking\s+for)\s+(?:a[n]?\s+)?(.+)/i,
  /^(?:open\s+(?:role|position|req(?:uisition)?))\s*:\s*(.+)/i,
];

/**
 * Keywords that strongly suggest a line IS a job title.
 * A line that contains one of these (and isn't otherwise excluded) is accepted.
 */
const JOB_KEYWORD_RE =
  /\b(engineer|engineering|manager|director|analyst|designer|developer|lead|head\s+of|vp|vice\s+president|president|product|data|sales|marketing|operations|finance|hr|human\s+resources|recruiter|recruiting|talent|consultant|associate|specialist|coordinator|executive|officer|architect|scientist|researcher|writer|editor|producer|strategist|advisor|founder|cto|ceo|coo|cfo|cpo|growth|brand|content|seo|devops|backend|frontend|full.?stack|mobile|ios|android|cloud|security|qa|quality\s+assurance|tester|program|project|account|business\s+development|supply\s+chain|logistics|procurement|customer\s+success|customer\s+support|ux|ui|motion|visual|designer|illustrator|copywriter|technical\s+writer)\b/i;

/**
 * Extract the role title from a job description string.
 *
 * Strategy (in order):
 *  1. Scan the first 25 lines, skipping blank and intro-section headers.
 *  2. Check each line for explicit label patterns ("Role: X", "We are hiring X").
 *  3. If a line contains a job-function keyword and isn't a bare section header, accept it.
 *  4. Fall back to `{companyName} · Open Role` or plain "Open Role".
 *
 * @param jd - Full job description text
 * @param companyName - Optional company name used in the fallback string
 */
export function heuristicRoleTitleFromJD(jd: string, companyName?: string): string {
  const fallback = companyName ? `${companyName} · Open Role` : "Open Role";
  const lines = jd.split(/\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines.slice(0, 25)) {
    // Too short or too long to be a title
    if (line.length < 4 || line.length > 120) continue;

    // Recognised intro section header — skip
    if (SKIP_INTRO_RE.test(line)) continue;

    // Explicit label pattern → extract the trailing title
    for (const re of INLINE_TITLE_RES) {
      const m = line.match(re);
      if (m?.[1]) {
        return m[1].trim().replace(/[.,:;!?]+$/, "").slice(0, 100);
      }
    }

    // Bare section header (ends with colon) with no job keyword → skip
    if (line.endsWith(":") && !JOB_KEYWORD_RE.test(line)) continue;

    // Key–value line ("Location: Bangalore") with no job keyword → skip
    if (/^[^:]{1,30}:\s*\S/.test(line) && !JOB_KEYWORD_RE.test(line)) continue;

    // Line contains a job-function keyword → likely the title
    if (JOB_KEYWORD_RE.test(line)) {
      return line.replace(/[.,:;!?]+$/, "").slice(0, 100);
    }
  }

  return fallback;
}

// ── Resume name extraction ─────────────────────────────────────────────────────

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
