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
 * Keywords that strongly suggest a line IS a job title when it appears as a
 * standalone phrase. Use specific, compound terms — avoid words like "product",
 * "data", "growth" that also appear heavily in requirement bullet points.
 */
const JOB_KEYWORD_RE =
  /\b(software\s+engineer|senior\s+engineer|staff\s+engineer|principal\s+engineer|engineering\s+manager|product\s+manager|product\s+lead|program\s+manager|project\s+manager|data\s+scientist|data\s+analyst|data\s+engineer|machine\s+learning|ml\s+engineer|devops\s+engineer|backend\s+developer|frontend\s+developer|full.?stack\s+developer|mobile\s+developer|ios\s+developer|android\s+developer|cloud\s+architect|solutions\s+architect|security\s+engineer|qa\s+engineer|quality\s+assurance|marketing\s+manager|brand\s+manager|content\s+strategist|seo\s+specialist|growth\s+manager|sales\s+manager|account\s+manager|business\s+development|supply\s+chain|customer\s+success|customer\s+support|ux\s+(designer|researcher|lead)|ui\s+designer|visual\s+designer|graphic\s+designer|technical\s+writer|copywriter|hr\s+(manager|business\s+partner|lead)|human\s+resources|talent\s+acquisition|recruiter|finance\s+manager|financial\s+analyst|operations\s+manager|chief\s+(executive|technology|product|operating|financial|marketing|people)|head\s+of|vp\s+of|vice\s+president|director\s+of|associate\s+director|general\s+manager|managing\s+director|country\s+manager|regional\s+manager)\b/i;

/**
 * Lines that start with these words are almost certainly requirement bullets
 * or description sentences, not role titles. Skip them.
 */
const BULLET_VERB_RE =
  /^(have|be\s+a|you\s+(will|are|should|must)|must\s+(have|be)|should\s+(have|be)|will\s+(be|work|help|own|lead|drive|build|manage|define|create|develop|design)|work|build|drive|own|define|develop|create|design|implement|deliver|oversee|ensure|collaborate|partner|support|help|contribute|use\s+(your|the)|make|take\s+ownership|provide|maintain|analyze|analyse|report|communicate|understand|what\s+you|as\s+a\s+\w+,\s+you|in\s+this\s+role|the\s+ideal|if\s+you|looking\s+for\s+someone|who\s+you\s+are|what\s+we\s+look|experience\s+(in|with)|proven\s+track|strong\s+(understanding|experience|background|knowledge|ability))\b/i;

/**
 * A line that looks like a job title: starts with a capital letter, is
 * relatively short, doesn't start with a bullet verb, and has the right
 * word count (2–8 words). Used as a final structural check.
 */
function looksLikeTitle(line: string): boolean {
  const words = line.split(/\s+/);
  return (
    words.length >= 2 &&
    words.length <= 8 &&
    /^[A-Z]/.test(line) &&
    !BULLET_VERB_RE.test(line)
  );
}

/**
 * Extract the role title from a job description string.
 *
 * Strategy (in order):
 *  1. Scan the first 30 lines, skipping blank and intro-section headers.
 *  2. Skip lines that start with bullet/requirement verbs.
 *  3. Check each line for explicit label patterns ("Role: X", "We are hiring X").
 *  4. Accept lines with a specific compound job-title keyword.
 *  5. Fall back to `{companyName} · Open Role` or plain "Open Role".
 *
 * @param jd - Full job description text
 * @param companyName - Optional company name used in the fallback string
 */
export function heuristicRoleTitleFromJD(jd: string, companyName?: string): string {
  const fallback = companyName ? `${companyName} · Open Role` : "Open Role";
  const lines = jd.split(/\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines.slice(0, 30)) {
    // Too short or too long to be a title
    if (line.length < 4 || line.length > 120) continue;

    // Recognised intro section header — skip
    if (SKIP_INTRO_RE.test(line)) continue;

    // Requirement / bullet verb at start — definitely not a title
    if (BULLET_VERB_RE.test(line)) continue;

    // Explicit label pattern → extract the trailing title
    for (const re of INLINE_TITLE_RES) {
      const m = line.match(re);
      if (m?.[1]) {
        const candidate = m[1].trim().replace(/[.,:;!?]+$/, "").slice(0, 100);
        // Don't return if the extracted part itself looks like a bullet
        if (!BULLET_VERB_RE.test(candidate)) return candidate;
      }
    }

    // Bare section header (ends with colon) → skip
    if (line.endsWith(":")) continue;

    // Key–value line ("Location: Bangalore") with short key → skip
    if (/^[^:]{1,30}:\s*\S/.test(line)) continue;

    // Line contains a specific compound job-title keyword AND looks like a title
    if (JOB_KEYWORD_RE.test(line) && looksLikeTitle(line)) {
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
