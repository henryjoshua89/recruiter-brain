import Anthropic from "@anthropic-ai/sdk";
import { clampScore, parseModelJson } from "@/lib/parse-model-json";
import { normalizeScoreBreakdown } from "@/lib/score-breakdown";
import type {
  ResumeAnalysisPayload,
  RoleScoringCalibration,
} from "@/lib/types";

const MODEL = "claude-sonnet-4-20250514";

function ensureAnalysisShape(data: unknown): ResumeAnalysisPayload {
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object") {
    throw new Error("Invalid analysis payload.");
  }
  const companies = Array.isArray(d.companies) ? d.companies : [];
  const mappedCompanies = companies.map((c) => {
    const x = c as Record<string, unknown>;
    return {
      name: String(x?.name ?? ""),
      estimatedSize: String(x?.estimatedSize ?? "unknown"),
      estimatedStage: String(x?.estimatedStage ?? "unknown"),
    };
  });

  const traj = String(d.careerTrajectory ?? "lateral").toLowerCase();
  const careerTrajectory =
    traj === "ascending" || traj === "descending" || traj === "lateral"
      ? traj
      : "lateral";

  const jdFitRationale = String(d.jdFitRationale ?? "");
  const roleFitRationale = String(d.roleFitRationale ?? "");

  return {
    fullName: String(d.fullName ?? ""),
    currentTitle: String(d.currentTitle ?? ""),
    totalYearsExperience: Number(d.totalYearsExperience) || 0,
    relevantYearsForRole: Number(d.relevantYearsForRole) || 0,
    companies: mappedCompanies,
    industryBackground: String(d.industryBackground ?? ""),
    averageTenureYearsPerRole: Number(d.averageTenureYearsPerRole) || 0,
    keyMetricsRelevantToRole: Array.isArray(d.keyMetricsRelevantToRole)
      ? (d.keyMetricsRelevantToRole as unknown[]).map(String)
      : [],
    careerTrajectory,
    missingForRole: Array.isArray(d.missingForRole)
      ? (d.missingForRole as unknown[]).map(String)
      : [],
    employmentGaps: Array.isArray(d.employmentGaps)
      ? (d.employmentGaps as unknown[]).map(String)
      : [],
    keySignals: Array.isArray(d.keySignals)
      ? (d.keySignals as unknown[]).map(String)
      : [],
    suggestedScreeningQuestions: Array.isArray(d.suggestedScreeningQuestions)
      ? (d.suggestedScreeningQuestions as unknown[]).map(String)
      : [],
    jdFitScore: clampScore(Number(d.jdFitScore)),
    roleFitScore: clampScore(Number(d.roleFitScore)),
    jdFitRationale,
    roleFitRationale,
    jdFitBreakdown: normalizeScoreBreakdown(d.jdFitBreakdown, jdFitRationale),
    roleFitBreakdown: normalizeScoreBreakdown(
      d.roleFitBreakdown,
      roleFitRationale
    ),
    marketAlignment: Array.isArray(d.marketAlignment)
      ? (d.marketAlignment as unknown[]).map(String)
      : [],
  };
}

export function buildResumeAnalysisUserPrompt(args: {
  jobDescription: string;
  briefingJson: string;
  internalContextJson: string;
  resumeText: string;
  calibration: RoleScoringCalibration | null;
  feedbackSignalCount: number;
  annotationPatterns?: string | null;
}): string {
  const calBlock =
    args.calibration && args.calibration.roleFitScoringGuidance
      ? `
CALIBRATION_FROM_PRIOR_FEEDBACK (${args.calibration.feedbackCount} recruiter signals as of last calibration update):
Pattern summary:
${args.calibration.patternSummary}

Role-fit adjustment guidance for NEW candidates (apply on top of JD fit — stay within 0–10, explain briefly in role_fit_rationale):
${args.calibration.roleFitScoringGuidance}
`
      : args.feedbackSignalCount >= 5
        ? `
CALIBRATION_FROM_PRIOR_FEEDBACK: There are ${args.feedbackSignalCount} feedback signals on record, but structured calibration text is not available yet. Set role_fit_score equal to jd_fit_score. Mention briefly that role-fit calibration will apply once pattern analysis has run after the latest feedback.
`
        : `
CALIBRATION_FROM_PRIOR_FEEDBACK: None yet (fewer than 5 recruiter feedback signals on this role). Set role_fit_score equal to jd_fit_score and state that role fit will calibrate as more feedback is collected.
`;

  const annotationBlock = args.annotationPatterns
    ? `
RECRUITER ANNOTATION PATTERNS — HIGH PRIORITY SIGNAL (read before scoring):
The following patterns were extracted from the recruiter's own voice annotations on previously reviewed candidates for this exact role. They represent the recruiter's expressed preferences and aversions in their own words and carry significant weight:
- A pattern expressing dislike of a candidate type (e.g. "candidates from services firms feel too slow") MUST reduce role_fit_score by at least 2 points for matching candidates, regardless of jd_fit_score.
- A pattern expressing preference (e.g. "loves early-stage startup experience") MUST increase role_fit_score proportionally.
- You MUST reference how annotation patterns influenced scoring in roleFitRationale. If they had no material effect, state that explicitly.
Patterns:
${args.annotationPatterns}
`
    : "";

  return `
You are a senior search partner with 20 years of experience operating exclusively in the India talent market. Your assessments are reviewed by hiring managers and C-suite stakeholders who will push back on inflated scores. Be honest, critical, and precise. A generous score that does not reflect reality wastes a client's time.

═══ INDIA TALENT MARKET CONTEXT ═══
Apply these India-specific heuristics throughout your analysis:

EDUCATION TIERS (mention tier in keySignals if relevant):
- Tier 1 — Strong positive signal: IIT, IIM, BITS Pilani, NIT (top-5), SRCC, LSR, ISB, SP Jain, XLRI
- Tier 2 — Neutral: Other NITs, state-government engineering colleges, mid-tier MBA programmes
- Tier 3 — No signal: Private deemed universities not in Tier 1 or 2

COMPANY TIERS (use to calibrate rigor of experience claims):
- Tier A — Strong signal (peer to global Tier-1 tech): Flipkart, Zomato, Swiggy, Razorpay, CRED, PhonePe, Meesho, Groww, Zepto, Juspay, Urban Company, Lenskart, Dream11, Nykaa, ShareChat; also Google/Microsoft/Amazon/Uber India centres
- Tier B — Moderate signal: Well-funded Series B–D startups, large NBFCs, HDFC/ICICI/Axis in specialist roles, Tata Digital, Reliance Retail (digital)
- Tier C — Weaker signal for product/growth roles: TCS, Infosys, Wipro, HCL, Tech Mahindra, Cognizant, Capgemini (IT services). Flag as mismatch when JD requires product/startup/growth experience.

NOTICE PERIODS: Standard India notice periods are 30, 60, or 90 days. A 90-day notice is the norm at mid-senior levels — do NOT penalise it. Flag in missingForRole ONLY if the JD or internal context explicitly requires an immediate or ≤30-day joiner.

═══ STRICT SCORING MANDATE ═══
Use the FULL 0–10 scale. Grade inflation is the most common failure mode — resist it.

Score bands:
- 9–10 · Exceptional: Meets ALL must-haves AND non-negotiables, directly comparable scope/impact, Tier A company. Fewer than 1 in 20 candidates.
- 7–8 · Strong: Meets all must-haves with minor gaps on nice-to-haves. A 7 is already a confident shortlist candidate.
- 5–6 · Adequate: Meets most must-haves but has one meaningful gap, weaker market signal, or unverified claims.
- 3–4 · Weak: Missing a key must-have OR significant red flag (instability, wrong industry where JD is explicit, services background for a product role).
- 0–2 · Unsuitable: Fundamentally wrong domain or completely fails the non-negotiables.

MANDATORY DEDUCTION RULE:
Each missing must-have skill or non-negotiable (from JD or INTERNAL CONTEXT.nonNegotiables) deducts a MINIMUM of 2 points from jdFitScore before any positive adjustments. Two missing must-haves = minimum 4-point deduction. Document each deduction explicitly in jdFitRationale.

═══ JD FIT SCORE ═══
1. Extract must-haves vs nice-to-haves from the JD and briefing nonNegotiables.
2. Apply the mandatory deduction rule for each missing must-have.
3. Reward DIRECT experience (same function, domain, scope) — not adjacent or transferable.
4. Penalise: wrong seniority, wrong industry where explicit, vague bullets with no outcomes, Tier C background when JD requires Tier A.

═══ ROLE FIT SCORE ═══
${args.feedbackSignalCount >= 5 && args.calibration
  ? "This score reflects what this recruiter has actually signalled through feedback on this exact role (see CALIBRATION block). Apply calibration guidance to adjust up or down from JD fit — it is NOT a repeat of JD fit. ALSO apply the ANNOTATION PATTERNS block if present: annotation patterns are first-person recruiter signals and may override calibration on specific dimensions."
  : "No calibration yet — set role_fit_score EQUAL to jd_fit_score. HOWEVER, still apply ANNOTATION PATTERNS above if they exist: they are direct recruiter voice and must influence role_fit_score even before formal calibration. Explain in roleFitRationale."}

═══ CONTEXTUAL GAP EVALUATION ═══
Use INTERNAL CONTEXT fields whyRoleOpen, successIn90Days, and nonNegotiables:
- If the candidate meets ALL non-negotiables, a career gap of up to 12 months is NOT a dealbreaker — include in employmentGaps with a neutral note but NOT in missingForRole.
- If the candidate is missing one or more non-negotiables, any career gap compounds the concern — flag in both employmentGaps and missingForRole.
- If whyRoleOpen indicates a growth/scale trigger, weight scale-up experience heavily.

═══ TRANSPARENCY ═══
jdFitBreakdown and roleFitBreakdown MUST each contain:
- strengths: 2–3 SHORT specific strings citing concrete resume/JD evidence
- weaknesses: 2–3 SHORT specific strings citing gaps, risks, or misses
- biggestFactor: ONE string — the single clearest driver of that score

Return STRICT JSON ONLY (no markdown fences):

{
  "fullName": "string",
  "currentTitle": "string",
  "totalYearsExperience": number,
  "relevantYearsForRole": number,
  "companies": [
    { "name": "string", "estimatedSize": "SMB|mid|large|enterprise|unknown", "estimatedStage": "startup|scaleup|enterprise|unknown" }
  ],
  "industryBackground": "string",
  "averageTenureYearsPerRole": number,
  "keyMetricsRelevantToRole": ["string"],
  "careerTrajectory": "ascending" | "lateral" | "descending",
  "missingForRole": ["string"],
  "employmentGaps": ["string"],
  "keySignals": ["string"],
  "suggestedScreeningQuestions": ["string"],
  "jdFitScore": number,
  "roleFitScore": number,
  "jdFitRationale": "2-3 sentences — must name any mandatory deductions applied",
  "roleFitRationale": "2-3 sentences — must state how annotation patterns and/or calibration influenced the score",
  "jdFitBreakdown": {
    "strengths": ["2-3 items"],
    "weaknesses": ["2-3 items"],
    "biggestFactor": "one decisive sentence"
  },
  "roleFitBreakdown": {
    "strengths": ["2-3 items"],
    "weaknesses": ["2-3 items"],
    "biggestFactor": "one decisive sentence"
  },
  "marketAlignment": [
    "string — specific Indian company archetype or career trajectory this candidate resembles (e.g. 'Mid-level Flipkart growth PM, 4-6 YOE, scaling 1→10 products')",
    "string — second alignment (may contrast, e.g. 'TCS-to-startup transition — strong execution but limited product ownership')"
  ]
}

Rules:
- jdFitScore and roleFitScore: integers 0–10 only.
- ${args.feedbackSignalCount >= 5 && args.calibration ? "roleFitScore may differ from jdFitScore; roleFitBreakdown must reflect calibration-informed and annotation-informed judgment." : "roleFitScore MUST equal jdFitScore unless annotation patterns justify a deviation. Note pending calibration in biggestFactor."}
- Apply mandatory deductions before assigning jdFitScore — document them in jdFitRationale.
- marketAlignment: exactly 2–3 entries, specific to the India market, named archetypes preferred over vague descriptions.

JOB DESCRIPTION:
${args.jobDescription}

BRIEFING (Phase 1 JSON):
${args.briefingJson}

INTERNAL CONTEXT (JSON):
${args.internalContextJson}

RESUME TEXT:
${args.resumeText}

${calBlock}
${annotationBlock}`.trim();
}

export async function runResumeAnalysis(args: {
  apiKey: string;
  jobDescription: string;
  briefing: object;
  internalContext: object;
  resumeText: string;
  calibration: RoleScoringCalibration | null;
  feedbackSignalCount: number;
  annotationPatterns?: string | null;
}): Promise<ResumeAnalysisPayload> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const text = buildResumeAnalysisUserPrompt({
    jobDescription: args.jobDescription,
    briefingJson: JSON.stringify(args.briefing),
    internalContextJson: JSON.stringify(args.internalContext),
    resumeText: args.resumeText,
    calibration: args.calibration,
    feedbackSignalCount: args.feedbackSignalCount,
    annotationPatterns: args.annotationPatterns,
  });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 5000,
    temperature: 0.15,
    messages: [{ role: "user", content: text }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || !("text" in textBlock)) {
    throw new Error("No text in model response.");
  }

  const parsed = parseModelJson<unknown>(textBlock.text);
  const shaped = ensureAnalysisShape(parsed);

  if (
    args.feedbackSignalCount < 5 ||
    !args.calibration?.roleFitScoringGuidance
  ) {
    shaped.roleFitScore = shaped.jdFitScore;
    shaped.roleFitBreakdown = {
      strengths: [...shaped.jdFitBreakdown.strengths],
      weaknesses: [...shaped.jdFitBreakdown.weaknesses],
      biggestFactor: `${shaped.jdFitBreakdown.biggestFactor} Role fit is held equal to JD fit until at least five recruiter feedback signals exist to calibrate what “good” looks like for this role in practice.`,
    };
  }

  return shaped;
}

export function buildCalibrationUserPrompt(rows: string): string {
  return `
You analyse recruiter feedback on candidates for ONE role. Summarise patterns that should adjust "role fit" scoring for future candidates (vs pure JD fit).

Input rows (each line is one feedback event; includes candidate label, scores, and decision):
${rows}

Return STRICT JSON ONLY:
{
  "patternSummary": "2-5 short paragraphs",
  "roleFitScoringGuidance": "Concrete instructions for the resume scorer: e.g. when to raise or lower role_fit vs jd_fit, what signals aligned with shortlist vs reject, stability vs ambition tradeoffs, industry fit, etc."
}
`.trim();
}

export async function runCalibration(args: {
  apiKey: string;
  feedbackRows: string;
}): Promise<RoleScoringCalibration> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0.2,
    messages: [
      { role: "user", content: buildCalibrationUserPrompt(args.feedbackRows) },
    ],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || !("text" in textBlock)) {
    throw new Error("No calibration text from model.");
  }
  const parsed = parseModelJson<{
    patternSummary?: string;
    roleFitScoringGuidance?: string;
  }>(textBlock.text);
  const patternSummary = String(parsed.patternSummary ?? "").trim();
  const roleFitScoringGuidance = String(
    parsed.roleFitScoringGuidance ?? ""
  ).trim();
  if (!patternSummary || !roleFitScoringGuidance) {
    throw new Error("Calibration response missing fields.");
  }
  return {
    patternSummary,
    roleFitScoringGuidance,
    feedbackCount: 0,
    updatedAt: new Date().toISOString(),
  };
}
