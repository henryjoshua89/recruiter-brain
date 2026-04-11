"use client";

import { useState, useEffect } from "react";
import { normalizeScoreBreakdown } from "@/lib/score-breakdown";
import type {
  FeedbackType,
  RejectReason,
  ResumeAnalysisPayload,
} from "@/lib/types";
import ScoreWithTooltip from "./score-with-tooltip";

const REJECT_REASONS: RejectReason[] = [
  "Overqualified",
  "Underqualified",
  "Wrong industry",
  "Poor stability",
  "Missing skills",
  "Other",
];

export type CandidateWithFeedback = {
  id: string;
  resume_filename: string | null;
  resume_text?: string | null;
  analysis: ResumeAnalysisPayload;
  jd_fit_score: number;
  role_fit_score: number;
  jd_fit_rationale: string;
  role_fit_rationale: string;
  created_at: string;
  role_id: string;
  latestFeedback: {
    feedback_type: string;
    reject_reason: string | null;
    created_at: string;
  } | null;
};

export default function CandidateCard({
  candidate,
  feedbackSignalCount,
  onAfterFeedback,
}: {
  candidate: CandidateWithFeedback;
  feedbackSignalCount: number;
  onAfterFeedback: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reanalysing, setReanalysing] = useState(false);
  const [reanalyseError, setReanalyseError] = useState<string | null>(null);
  const [reanalyseSuccess, setReanalyseSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState<RejectReason | "">("");
  const [localCandidate, setLocalCandidate] = useState(candidate);
  useEffect(() => {
    setLocalCandidate(candidate);
  }, [candidate]);

  const a = localCandidate.analysis;
  const roleFitBuilding = feedbackSignalCount < 20;
  const jdBreakdown = normalizeScoreBreakdown(
    a.jdFitBreakdown ?? null,
    localCandidate.jd_fit_rationale
  );
  const roleBreakdown = normalizeScoreBreakdown(
    a.roleFitBreakdown ?? null,
    localCandidate.role_fit_rationale
  );

  async function handleReanalyse() {
    setReanalyseError(null);
    setReanalyseSuccess(false);
    setReanalysing(true);
    try {
      const res = await fetch(
        `/api/roles/${localCandidate.role_id}/candidates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resumeText: localCandidate.resume_text ?? a.rawText ?? "",
            reanalyseCandidateId: localCandidate.id,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Re-analysis failed.");
      setLocalCandidate((prev) => ({ ...prev, ...data.candidate }));
      setReanalyseSuccess(true);
      onAfterFeedback();
    } catch (e) {
      setReanalyseError(
        e instanceof Error ? e.message : "Re-analysis failed."
      );
    } finally {
      setReanalysing(false);
    }
  }

  async function submitFeedback(
    feedbackType: FeedbackType,
    reason?: RejectReason
  ) {
    setError(null);
    if (feedbackType === "reject") {
      if (!reason) {
        setError("Choose a reject reason.");
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedbackType,
          rejectReason: feedbackType === "reject" ? reason : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Feedback failed.");
      setRejectOpen(false);
      setRejectReason("");
      onAfterFeedback();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Feedback failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">
            {a.fullName || "Unknown name"}
          </h3>
          <p className="text-sm text-slate-600">{a.currentTitle}</p>
          <p className="mt-1 text-xs text-slate-500">
            Analysed{" "}
            {new Date(localCandidate.created_at).toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {localCandidate.resume_filename
              ? ` · ${localCandidate.resume_filename}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-center">
            <div className="text-xs font-medium text-blue-800">JD fit</div>
            <div className="flex justify-center text-xl font-semibold text-blue-950">
              <ScoreWithTooltip
                variant="jd"
                score={localCandidate.jd_fit_score}
                breakdown={jdBreakdown}
              />
            </div>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-medium text-emerald-800">
              Role fit
              {roleFitBuilding ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                  Building
                </span>
              ) : null}
            </div>
            <div className="flex justify-center text-xl font-semibold text-emerald-950">
              <ScoreWithTooltip
                variant="role"
                score={localCandidate.role_fit_score}
                breakdown={roleBreakdown}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={reanalysing}
            onClick={handleReanalyse}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
          >
            {reanalysing ? "Re-analysing…" : "Re-analyse"}
          </button>
        </div>
      </div>

      {reanalyseSuccess && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✓ Re-analysis complete. Scores and tooltips updated.
        </div>
      )}
      {reanalyseError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {reanalyseError}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            JD fit rationale
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-800">
            {localCandidate.jd_fit_rationale}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Role fit rationale
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-800">
            {localCandidate.role_fit_rationale}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-blue-800">Key signals</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-800">
            {(a.keySignals ?? []).map((s, i) => (
              <li key={`sig-${i}`} className="flex gap-2">
                <span className="text-emerald-600">✓</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3">
          <p className="text-xs font-semibold text-amber-900">
            Gaps &amp; screening questions
          </p>
          <p className="mt-2 text-xs font-medium text-slate-700">Missing</p>
          <ul className="mt-1 list-inside list-disc text-sm text-slate-800">
            {(a.missingForRole ?? []).map((m, i) => (
              <li key={`miss-${i}`}>{m}</li>
            ))}
          </ul>
          {(a.employmentGaps ?? []).length > 0 ? (
            <>
              <p className="mt-2 text-xs font-medium text-slate-700">
                Employment gaps
              </p>
              <ul className="mt-1 list-inside list-disc text-sm text-slate-800">
                {(a.employmentGaps ?? []).map((g, i) => (
                  <li key={`gap-${i}`}>{g}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="mt-2 text-xs font-medium text-slate-700">
            Suggested screening questions
          </p>
          <ul className="mt-1 space-y-1 text-sm text-slate-800">
            {(a.suggestedScreeningQuestions ?? []).map((q, i) => (
              <li
                key={`q-${i}`}
                className="rounded border border-amber-100 bg-white px-2 py-1"
              >
                {q}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Experience</dt>
          <dd className="font-medium text-slate-900">
            {a.totalYearsExperience} yrs total · {a.relevantYearsForRole} yrs
            relevant
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Avg tenure / role</dt>
          <dd className="font-medium text-slate-900">
            {a.averageTenureYearsPerRole} yrs
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Trajectory</dt>
          <dd className="font-medium capitalize text-slate-900">
            {a.careerTrajectory}
          </dd>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <dt className="text-xs text-slate-500">Industry background</dt>
          <dd className="text-slate-800">{a.industryBackground}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Companies (estimated size / stage)
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {(a.companies ?? []).map((c, i) => (
            <li
              key={`${c.name}-${i}`}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-800"
            >
              <span className="font-medium">{c.name}</span>
              <span className="text-slate-500">
                {" "}
                · {c.estimatedSize} · {c.estimatedStage}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {(a.keyMetricsRelevantToRole ?? []).length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Metrics (role-relevant)
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-800">
            {(a.keyMetricsRelevantToRole ?? []).map((m, i) => (
              <li
                key={`met-${i}`}
                className="rounded-md bg-slate-50 px-3 py-1.5"
              >
                {m}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {localCandidate.latestFeedback ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="font-medium">Last feedback: </span>
          <span className="capitalize">
            {localCandidate.latestFeedback.feedback_type}
          </span>
          {localCandidate.latestFeedback.reject_reason
            ? ` — ${localCandidate.latestFeedback.reject_reason}`
            : null}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Your feedback
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => submitFeedback("shortlist")}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Shortlist
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submitFeedback("hold")}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-600 disabled:opacity-50"
        >
          Hold
        </button>
        {!rejectOpen ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setRejectOpen(true)}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Reject…
          </button>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={rejectReason}
              onChange={(e) =>
                setRejectReason(e.target.value as RejectReason | "")
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Reason…</option>
              {REJECT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!rejectReason) {
                  setError("Choose a reject reason.");
                  return;
                }
                submitFeedback("reject", rejectReason as RejectReason);
              }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Confirm reject
            </button>
            <button
              type="button"
              className="text-sm text-slate-600 underline"
              onClick={() => {
                setRejectOpen(false);
                setRejectReason("");
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </article>
  );
}