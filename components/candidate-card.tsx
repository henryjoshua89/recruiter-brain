"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { normalizeScoreBreakdown } from "@/lib/score-breakdown";
import type { FeedbackType, RejectReason, ResumeAnalysisPayload } from "@/lib/types";
import ScoreWithTooltip from "./score-with-tooltip";

// ── Speech Recognition minimal types ─────────────────────────────────────────
interface SRResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SRResultList {
  length: number;
  [i: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const REJECT_REASONS: RejectReason[] = [
  "Overqualified",
  "Underqualified",
  "Wrong industry",
  "Poor stability",
  "Missing skills",
  "Other",
];

const FEEDBACK_LABELS: Record<FeedbackType, string> = {
  shortlist: "Shortlisted",
  hold: "On Hold",
  reject: "Rejected",
};

// ── Exported types ────────────────────────────────────────────────────────────
export type CandidateAnnotation = {
  id: string;
  transcript: string;
  sentiment: string;
  observations: string[];
  concerns: string[];
  strengths: string[];
  suggested_feedback: string | null;
  created_at: string;
};

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
  annotations: CandidateAnnotation[];
};

type AnnotationMode = "idle" | "recording" | "review" | "saving";

// ── Component ─────────────────────────────────────────────────────────────────
export default function CandidateCard({
  candidate,
  feedbackSignalCount,
  onAfterFeedback,
}: {
  candidate: CandidateWithFeedback;
  feedbackSignalCount: number;
  onAfterFeedback: () => void;
}) {
  // ── Existing state ───────────────────────────────────────────────────────
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

  // ── Portal mount guard ───────────────────────────────────────────────────
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── Nudge modal state ────────────────────────────────────────────────────
  const [showNudge, setShowNudge] = useState(false);
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const [nudgeReason, setNudgeReason] = useState<"timeout" | "no-signal">("timeout");
  const feedbackGivenRef = useRef(false);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (showNudge) {
      requestAnimationFrame(() => setNudgeVisible(true));
    } else {
      setNudgeVisible(false);
    }
  }, [showNudge]);

  function scheduleNudge(delayMs: number) {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = setTimeout(() => {
      if (!feedbackGivenRef.current) {
        setNudgeReason("timeout");
        setShowNudge(true);
      }
    }, delayMs);
  }

  // Initial 60s timer on mount — only if no prior feedback
  useEffect(() => {
    if (candidate.latestFeedback !== null) return;
    scheduleNudge(60_000);
    return () => {
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-apply state (Improvement 3) ────────────────────────────────────
  const [autoApplied, setAutoApplied] = useState<{
    feedbackType: FeedbackType;
    feedbackId: string;
    label: string;
  } | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(0);

  useEffect(() => {
    if (undoCountdown <= 0) return;
    const t = setTimeout(() => {
      setUndoCountdown((n) => {
        if (n <= 1) {
          setAutoApplied(null);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [undoCountdown]);

  // ── Annotation state ─────────────────────────────────────────────────────
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("idle");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [editedTranscript, setEditedTranscript] = useState("");
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<CandidateAnnotation[]>(
    candidate.annotations ?? []
  );
  const [expandedAnnotationIds, setExpandedAnnotationIds] = useState<Set<string>>(
    () => new Set(candidate.annotations?.[0] ? [candidate.annotations[0].id] : [])
  );

  const recognitionRef = useRef<SRInstance | null>(null);
  const finalTranscriptRef = useRef("");
  const modeRef = useRef<AnnotationMode>("idle");
  modeRef.current = annotationMode;

  // Spacebar shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable
      )
        return;
      e.preventDefault();
      if (modeRef.current === "recording") stopRecording();
      else if (modeRef.current === "idle") startRecording();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Speech recording ──────────────────────────────────────────────────────
  function startRecording() {
    const win = window as unknown as {
      SpeechRecognition?: new () => SRInstance;
      webkitSpeechRecognition?: new () => SRInstance;
    };
    const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Ctor) {
      setAnnotationError(
        "Speech recognition is not supported in this browser. Try Chrome."
      );
      return;
    }

    finalTranscriptRef.current = "";
    setFinalTranscript("");
    setInterimTranscript("");
    setAnnotationError(null);

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (e: SREvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          finalTranscriptRef.current += r[0].transcript + " ";
        } else {
          interim += r[0].transcript;
        }
      }
      setFinalTranscript(finalTranscriptRef.current);
      setInterimTranscript(interim);
    };

    rec.onerror = (e: { error: string }) => {
      setAnnotationError(`Microphone error: ${e.error}`);
      setAnnotationMode("idle");
    };

    rec.onend = () => {
      setInterimTranscript("");
      const t = finalTranscriptRef.current.trim();
      if (t) {
        setEditedTranscript(t);
        setAnnotationMode("review");
      } else {
        setAnnotationMode("idle");
      }
    };

    rec.start();
    recognitionRef.current = rec;
    setAnnotationMode("recording");
  }

  function stopRecording() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }

  // ── Auto-apply feedback from annotation (Improvement 3) ──────────────────
  async function autoApplyFeedback(feedbackType: FeedbackType) {
    try {
      const res = await fetch(`/api/candidates/${localCandidate.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedbackType,
          ...(feedbackType === "reject" ? { rejectReason: "Other" } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) return; // fail silently
      feedbackGivenRef.current = true;
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      setShowNudge(false);
      setAutoApplied({
        feedbackType,
        feedbackId: data.feedback.id,
        label: FEEDBACK_LABELS[feedbackType],
      });
      setUndoCountdown(5);
      onAfterFeedback();
    } catch {
      // fail silently — annotation was still saved
    }
  }

  async function handleUndo() {
    if (!autoApplied) return;
    const { feedbackId } = autoApplied;
    setUndoCountdown(0);
    setAutoApplied(null);
    try {
      await fetch(
        `/api/candidates/${localCandidate.id}/feedback/${feedbackId}`,
        { method: "DELETE" }
      );
      onAfterFeedback();
    } catch {
      // fail silently
    }
  }

  // ── Save annotation ───────────────────────────────────────────────────────
  async function saveAnnotation() {
    const text = editedTranscript.trim();
    if (!text) return;
    setAnnotationMode("saving");
    setAnnotationError(null);
    try {
      const res = await fetch(`/api/candidates/${localCandidate.id}/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save annotation.");
      const saved = data.annotation as CandidateAnnotation;
      setAnnotations((prev) => [saved, ...prev]);
      setExpandedAnnotationIds((prev) => new Set([saved.id, ...prev]));
      setAnnotationMode("idle");
      setEditedTranscript("");
      setFinalTranscript("");

      const sf = saved.suggested_feedback;
      if (sf === "shortlist" || sf === "hold" || sf === "reject") {
        await autoApplyFeedback(sf as FeedbackType);
      } else {
        // No clear signal — show nudge modal immediately
        if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
        setNudgeReason("no-signal");
        setShowNudge(true);
      }
    } catch (e) {
      setAnnotationError(
        e instanceof Error ? e.message : "Failed to save annotation."
      );
      setAnnotationMode("review");
    }
  }

  // ── Reanalyse ─────────────────────────────────────────────────────────────
  async function handleReanalyse() {
    setReanalyseError(null);
    setReanalyseSuccess(false);
    setReanalysing(true);
    try {
      const res = await fetch(`/api/roles/${localCandidate.role_id}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeText: localCandidate.resume_text ?? a.rawText ?? "",
          reanalyseCandidateId: localCandidate.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Re-analysis failed.");
      setLocalCandidate((prev) => ({ ...prev, ...data.candidate }));
      setReanalyseSuccess(true);
      onAfterFeedback();
    } catch (e) {
      setReanalyseError(e instanceof Error ? e.message : "Re-analysis failed.");
    } finally {
      setReanalysing(false);
    }
  }

  // ── Submit feedback ───────────────────────────────────────────────────────
  async function submitFeedback(feedbackType: FeedbackType, reason?: RejectReason) {
    setError(null);
    if (feedbackType === "reject" && !reason) {
      setError("Choose a reject reason.");
      return;
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
      feedbackGivenRef.current = true;
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      setShowNudge(false);
      setRejectOpen(false);
      setRejectReason("");
      onAfterFeedback();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Feedback failed.");
    } finally {
      setBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {/* Header */}
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

        {/* Rationale */}
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

        {/* Signals & gaps */}
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

        {/* Stats */}
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

        {/* Companies */}
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

        {/* Metrics */}
        {(a.keyMetricsRelevantToRole ?? []).length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Metrics (role-relevant)
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-800">
              {(a.keyMetricsRelevantToRole ?? []).map((m, i) => (
                <li key={`met-${i}`} className="rounded-md bg-slate-50 px-3 py-1.5">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Last feedback */}
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

        {/* Auto-applied confirmation bar (Improvement 3) */}
        {autoApplied ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm text-emerald-800">
              <span className="font-semibold">Signal auto-applied: {autoApplied.label}</span>
              {" "}based on your voice annotation.
            </p>
            <button
              type="button"
              onClick={handleUndo}
              className="shrink-0 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              Undo ({undoCountdown}s)
            </button>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        {/* Feedback + voice note row */}
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

          {/* Divider */}
          <div className="hidden h-5 w-px bg-slate-200 sm:block" />

          {/* Mic button */}
          {annotationMode === "idle" ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startRecording}
                title="Start voice annotation"
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                <MicIcon />
                Voice note
              </button>
              <span className="text-xs text-slate-400">Press Space to record</span>
            </div>
          ) : null}
        </div>

        {/* Recording UI */}
        {annotationMode === "recording" ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
              </span>
              <span className="text-sm font-medium text-red-800">Listening…</span>
              <button
                type="button"
                onClick={stopRecording}
                className="ml-auto rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                Stop (Space)
              </button>
            </div>
            <div className="mt-3 min-h-[2rem] text-sm text-slate-800">
              {finalTranscript || interimTranscript ? (
                <p>
                  <span>{finalTranscript}</span>
                  <span className="text-slate-400">{interimTranscript}</span>
                </p>
              ) : (
                <p className="italic text-red-500/70 text-xs">Start speaking…</p>
              )}
            </div>
          </div>
        ) : null}

        {/* Review / edit transcript */}
        {annotationMode === "review" || annotationMode === "saving" ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Review transcript
            </p>
            <textarea
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
              rows={4}
              disabled={annotationMode === "saving"}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
            />
            {annotationError ? (
              <p className="mt-2 text-xs text-red-600">{annotationError}</p>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={saveAnnotation}
                disabled={annotationMode === "saving" || !editedTranscript.trim()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {annotationMode === "saving" ? "Saving…" : "Save annotation"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAnnotationMode("idle");
                  setEditedTranscript("");
                  setFinalTranscript("");
                }}
                disabled={annotationMode === "saving"}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Discard
              </button>
            </div>
          </div>
        ) : null}

        {annotationError && annotationMode === "idle" ? (
          <p className="mt-2 text-xs text-red-600">{annotationError}</p>
        ) : null}

        {/* Annotation history */}
        {annotations.length > 0 ? (
          <div className="mt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-800">
              Annotation history{annotations.length > 1 ? ` (${annotations.length})` : ""}
            </h4>
            <ul className="space-y-2">
              {annotations.map((ann) => {
                const isOpen = expandedAnnotationIds.has(ann.id);
                return (
                  <li key={ann.id} className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-500">
                          {new Date(ann.created_at).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                        <SentimentBadge sentiment={ann.sentiment} />
                        {ann.suggested_feedback ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              ann.suggested_feedback === "shortlist"
                                ? "bg-emerald-100 text-emerald-800"
                                : ann.suggested_feedback === "reject"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            Suggest: {ann.suggested_feedback}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedAnnotationIds((prev) => {
                            const next = new Set(prev);
                            next.has(ann.id) ? next.delete(ann.id) : next.add(ann.id);
                            return next;
                          })
                        }
                        className="shrink-0 text-xs text-violet-600 underline hover:text-violet-800"
                      >
                        {isOpen ? "Collapse" : "Expand"}
                      </button>
                    </div>

                    {isOpen ? (
                      <div className="mt-3 space-y-3">
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                            Transcript
                          </p>
                          <p className="text-sm italic text-slate-800">
                            &ldquo;{ann.transcript}&rdquo;
                          </p>
                        </div>
                        {ann.strengths.length > 0 ? (
                          <div>
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                              Strengths
                            </p>
                            <ul className="space-y-1">
                              {ann.strengths.map((s, i) => (
                                <li key={i} className="flex gap-1.5 text-xs text-slate-800">
                                  <span className="shrink-0 text-emerald-500">✓</span>
                                  {s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {ann.concerns.length > 0 ? (
                          <div>
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                              Concerns
                            </p>
                            <ul className="space-y-1">
                              {ann.concerns.map((c, i) => (
                                <li key={i} className="flex gap-1.5 text-xs text-slate-800">
                                  <span className="shrink-0 text-red-400">✗</span>
                                  {c}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {ann.observations.length > 0 ? (
                          <div>
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                              Observations
                            </p>
                            <ul className="space-y-0.5">
                              {ann.observations.map((o, i) => (
                                <li key={i} className="text-xs text-slate-700">
                                  · {o}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

      </article>

      {/* Nudge modal portal (Improvement 1) */}
      {mounted && showNudge
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div
                className={`w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl transition-all duration-200 ease-out ${
                  nudgeVisible ? "scale-100 opacity-100" : "scale-95 opacity-0"
                }`}
              >
                <h2 className="text-lg font-bold text-slate-950">
                  Still reviewing {a.fullName || "this candidate"}?
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {nudgeReason === "no-signal"
                    ? "Your annotation did not contain a clear signal. Say shortlist, hold, or reject in your next annotation, or give a quick signal now."
                    : "Give a quick signal to help the system learn. You can always change this later."}
                </p>
                <div className="mt-5 flex gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => submitFeedback("shortlist")}
                    className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Shortlist
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => submitFeedback("hold")}
                    className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-semibold text-amber-950 hover:bg-amber-600 disabled:opacity-50"
                  >
                    Hold
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => submitFeedback("reject", "Other")}
                    className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNudge(false);
                      scheduleNudge(30_000);
                    }}
                    className="text-sm text-slate-500 underline hover:text-slate-700"
                  >
                    Not yet
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function MicIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
      <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5H10.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
    </svg>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const cls =
    sentiment === "positive"
      ? "bg-emerald-100 text-emerald-800"
      : sentiment === "negative"
      ? "bg-red-100 text-red-700"
      : "bg-slate-100 text-slate-700";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {sentiment}
    </span>
  );
}
