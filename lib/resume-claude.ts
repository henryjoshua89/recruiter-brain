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
  };
}

export function buildResumeAnalysisUserPrompt(args: {
  jobDescription: string;
  briefingJson: string;
  internalContextJson: string;
  resumeText: string;
  calibration: RoleScoringCalibration | null;
  feedbackSignalCount: number;
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

  return `
You are a senior search partner and recruiter with 20 years of experience in the India talent market. You are accountable for every hiring recommendation: your scores will be challenged by hiring managers and leadership. Be honest, critical, and precise — not generous. If someone does not meet the bar, scores of 5 or below are not only allowed but required.

SCORING PHILOSOPHY:
- Use the FULL 0–10 scale. A 7 must feel clearly stronger than a 6; a 4 clearly weaker than a 5. Do NOT cluster everyone between 6 and 8.
- Differentiate candidates meaningfully. Tie-break using depth of direct (not adjacent) experience, evidence on the resume, and India-market realism.

JD FIT SCORE (0–10):
- Decompose the JD into concrete requirements (must-haves vs nice-to-haves). Weight must-haves heavily; missing a stated must-have should materially lower the score.
- Reward DIRECT experience (same function, domain, and scope as the JD) over adjacent or transferable experience.
- Penalise missing skills, wrong seniority, wrong industry where the JD is explicit, and weak evidence (vague bullets with no outcomes).
- Cross-check with the Phase 1 briefing and internal context for hidden bar-raisers (non-negotiables, team context).

ROLE FIT SCORE (0–10):
- ${args.feedbackSignalCount >= 5 && args.calibration ? "This score reflects what we have learned from recruiter feedback on THIS role (see CALIBRATION block): who gets shortlisted vs rejected, stability vs skills trade-offs, industry fit, etc. It is NOT a repeat of JD fit — apply the calibration guidance to adjust up or down from what JD fit alone would suggest, when justified." : "Until calibration exists, set role_fit_score EQUAL to jd_fit_score (same integer). Still output roleFitBreakdown: mirror jdFitBreakdown for strengths/weaknesses/biggestFactor, but phrase biggestFactor to note that role-level calibration will refine this once more recruiter feedback exists."}
- When calibration applies: score against \"what good looks like for this mandate in practice\" including patterns from feedback, not only literal JD text.

TRANSPARENCY (required for trust):
- jdFitBreakdown and roleFitBreakdown MUST each contain exactly:
  - strengths: array of 2 or 3 SHORT specific strings (what helped the score — cite concrete resume/JD evidence).
  - weaknesses: array of 2 or 3 SHORT specific strings (what hurt the score — gaps, risks, or misses).
  - biggestFactor: ONE string — the single clearest driver of that score (could be positive or negative).

Return STRICT JSON ONLY (no markdown fences). Use this exact shape and keys:

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
  "jdFitRationale": "2-3 sentences, plain prose",
  "roleFitRationale": "2-3 sentences, plain prose",
  "jdFitBreakdown": {
    "strengths": ["2-3 items"],
    "weaknesses": ["2-3 items"],
    "biggestFactor": "one decisive sentence"
  },
  "roleFitBreakdown": {
    "strengths": ["2-3 items"],
    "weaknesses": ["2-3 items"],
    "biggestFactor": "one decisive sentence"
  }
}

Rules:
- jdFitScore and roleFitScore: integers 0–10 only.
- ${args.feedbackSignalCount >= 5 && args.calibration ? "roleFitScore may differ from jdFitScore; roleFitBreakdown must reflect calibration-informed judgment." : "roleFitScore MUST equal jdFitScore. roleFitBreakdown should align with jdFitBreakdown (you may slightly rephrase biggestFactor to mention pending calibration)."}
- Be critical: many average candidates should land in the 4–6 range if evidence is thin.

JOB DESCRIPTION:
${args.jobDescription}

BRIEFING (Phase 1 JSON):
${args.briefingJson}

INTERNAL CONTEXT (JSON):
${args.internalContextJson}

RESUME TEXT:
${args.resumeText}

${calBlock}
`.trim();
}

export async function runResumeAnalysis(args: {
  apiKey: string;
  jobDescription: string;
  briefing: object;
  internalContext: object;
  resumeText: string;
  calibration: RoleScoringCalibration | null;
  feedbackSignalCount: number;
}): Promise<ResumeAnalysisPayload> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const text = buildResumeAnalysisUserPrompt({
    jobDescription: args.jobDescription,
    briefingJson: JSON.stringify(args.briefing),
    internalContextJson: JSON.stringify(args.internalContext),
    resumeText: args.resumeText,
    calibration: args.calibration,
    feedbackSignalCount: args.feedbackSignalCount,
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
