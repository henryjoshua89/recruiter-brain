"use client";

import Link from "next/link";
import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { normalizeScoreBreakdown } from "@/lib/score-breakdown";
import type { BriefingSections } from "@/lib/types";
import CandidateCard, { type CandidateWithFeedback } from "./candidate-card";
import ScoreWithTooltip from "./score-with-tooltip";

type RoleDetail = {
  id: string;
  jobDescription: string;
  internalContext: unknown;
  briefing: BriefingSections;
  company: {
    id: string;
    name: string;
    websiteUrl: string;
  } | null;
  feedbackSignalCount: number;
};

type DuplicateState = {
  existingCandidateId: string;
  existingName: string;
  message: string;
  pendingFile: File | null;
  pendingText: string;
};

export default function RoleWorkspace({ roleId }: { roleId: string }) {
  const [tab, setTab] = useState<"briefing" | "candidates">("candidates");
  const [copiedLink, setCopiedLink] = useState(false);
  const [role, setRole] = useState<RoleDetail | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateWithFeedback[]>([]);
  const [feedbackSignalCount, setFeedbackSignalCount] = useState(0);
  const [candError, setCandError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null);
  const [batchSummary, setBatchSummary] = useState<{
    successes: number;
    failures: { name: string; error: string }[];
    skippedNonPdf: string[];
  } | null>(null);
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateState | null>(null);

  const loadRole = useCallback(async () => {
    const res = await fetch(`/api/roles/${roleId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load role.");
    setRole({
      id: data.role.id,
      jobDescription: data.role.jobDescription,
      internalContext: data.role.internalContext,
      briefing: data.role.briefing as BriefingSections,
      company: data.role.company,
      feedbackSignalCount: data.role.feedbackSignalCount ?? 0,
    });
    setFeedbackSignalCount(data.role.feedbackSignalCount ?? 0);
  }, [roleId]);

  const loadCandidates = useCallback(async () => {
    const res = await fetch(`/api/roles/${roleId}/candidates`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load candidates.");
    const list = (data.candidates ?? []).map((c: CandidateWithFeedback) => ({
      ...c,
      analysis: c.analysis as CandidateWithFeedback["analysis"],
    }));
    setCandidates(list);
    setFeedbackSignalCount(data.feedbackSignalCount ?? 0);
  }, [roleId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadRole();
        if (!cancelled) await loadCandidates();
      } catch (e) {
        if (!cancelled)
          setRoleError(
            e instanceof Error ? e.message : "Failed to load workspace."
          );
      }
    })();
    return () => { cancelled = true; };
  }, [loadRole, loadCandidates]);

  async function uploadSingle(
    file: File | null,
    text: string,
    forceNew: boolean
  ): Promise<{ success: boolean; duplicate?: DuplicateState; error?: string }> {
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      if (forceNew) fd.append("forceNew", "true");
      const res = await fetch(`/api/roles/${roleId}/candidates`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.status === 409) {
        return {
          success: false,
          duplicate: {
            existingCandidateId: data.existingCandidateId,
            existingName: data.existingName,
            message: data.message,
            pendingFile: file,
            pendingText: "",
          },
        };
      }
      if (!res.ok) return { success: false, error: String(data.error ?? "Analysis failed.") };
      return { success: true };
    } else {
      const res = await fetch(`/api/roles/${roleId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: text.trim(), forceNew }),
      });
      const data = await res.json();
      if (res.status === 409) {
        return {
          success: false,
          duplicate: {
            existingCandidateId: data.existingCandidateId,
            existingName: data.existingName,
            message: data.message,
            pendingFile: null,
            pendingText: text,
          },
        };
      }
      if (!res.ok) return { success: false, error: String(data.error ?? "Analysis failed.") };
      return { success: true };
    }
  }

  async function handleDuplicateUpdate() {
    if (!duplicate) return;
    setDuplicate(null);
    setUploadBusy(true);
    try {
      let res: Response;
      if (duplicate.pendingFile) {
        const fd = new FormData();
        fd.append("file", duplicate.pendingFile);
        fd.append("reanalyseCandidateId", duplicate.existingCandidateId);
        res = await fetch(`/api/roles/${roleId}/candidates`, {
          method: "POST",
          body: fd,
        });
      } else {
        res = await fetch(`/api/roles/${roleId}/candidates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resumeText: duplicate.pendingText || "",
            reanalyseCandidateId: duplicate.existingCandidateId,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed.");
      await loadCandidates();
      await loadRole();
      setBatchSummary({ successes: 1, failures: [], skippedNonPdf: [] });
    } catch (e) {
      setCandError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleDuplicateAddNew() {
    if (!duplicate) return;
    const pending = duplicate;
    setDuplicate(null);
    setUploadBusy(true);
    try {
      const result = await uploadSingle(pending.pendingFile, pending.pendingText, true);
      if (result.success) {
        await loadCandidates();
        await loadRole();
        setBatchSummary({ successes: 1, failures: [], skippedNonPdf: [] });
      } else {
        setCandError(result.error ?? "Upload failed.");
      }
    } finally {
      setUploadBusy(false);
    }
  }

  async function onSubmitResume(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCandError(null);
    setBatchSummary(null);
    setDuplicate(null);
    const form = e.currentTarget;
    const fileInput = form.querySelector<HTMLInputElement>('input[name="file"]');

    const rawFiles = fileInput?.files ? Array.from(fileInput.files) : [];
    const pdfFiles = rawFiles.filter(
      (f) =>
        f.size > 0 &&
        (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))
    );
    const skippedNonPdf = rawFiles
      .filter(
        (f) =>
          f.size > 0 &&
          f.type !== "application/pdf" &&
          !f.name.toLowerCase().endsWith(".pdf")
      )
      .map((f) => f.name);

    if (pdfFiles.length > 0) {
      setUploadBusy(true);
      const failures: { name: string; error: string }[] = [];
      let successes = 0;

      for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        setUploadProgress({ current: i + 1, total: pdfFiles.length, fileName: file.name });
        const result = await uploadSingle(file, "", false);
        if (result.duplicate) {
          setUploadProgress(null);
          setUploadBusy(false);
          setDuplicate(result.duplicate);
          if (successes > 0) await loadCandidates();
          return;
        }
        if (result.success) {
          successes += 1;
          await loadCandidates();
        } else {
          failures.push({ name: file.name, error: result.error ?? "Failed." });
        }
      }

      setUploadProgress(null);
      setUploadBusy(false);
      setBatchSummary({ successes, failures, skippedNonPdf });
      if (fileInput) fileInput.value = "";
      await loadRole();
      return;
    }

    if (rawFiles.some((f) => f.size > 0) && pdfFiles.length === 0) {
      setCandError("Only PDF files are supported. Remove non-PDF files or use paste for plain text.");
      return;
    }

    setUploadBusy(true);
    setUploadProgress(null);
    try {
      if (pasteText.trim().length >= 40) {
        setUploadProgress({ current: 1, total: 1, fileName: "Pasted resume" });
        const result = await uploadSingle(null, pasteText.trim(), false);
        if (result.duplicate) {
          setDuplicate(result.duplicate);
          return;
        }
        if (!result.success) throw new Error(result.error ?? "Analysis failed.");
        setPasteText("");
        setBatchSummary({ successes: 1, failures: [], skippedNonPdf: [] });
        await loadCandidates();
        await loadRole();
      } else {
        throw new Error("Choose one or more PDF files, or paste resume text (40+ characters).");
      }
    } catch (err) {
      setCandError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUploadProgress(null);
      setUploadBusy(false);
    }
  }

  if (roleError || !role) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-red-600">{roleError ?? "Loading…"}</p>
        <Link href="/" className="mt-4 inline-block text-blue-700">← Back to dashboard</Link>
      </main>
    );
  }

  const b = role.briefing;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">

      {/* Duplicate detection dialog */}
      {duplicate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-950">
              Candidate already exists
            </h3>
            <p className="mt-2 text-sm text-slate-700">{duplicate.message}</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleDuplicateUpdate}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Update existing record
              </button>
              <button
                type="button"
                onClick={handleDuplicateAddNew}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Add as new entry
              </button>
              <button
                type="button"
                onClick={() => setDuplicate(null)}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/" className="text-sm font-medium text-blue-700 hover:text-blue-800">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">
            {role.company?.name ?? "Role"}
          </h1>
          <p className="text-sm text-slate-600">
            Resume Analysis · {feedbackSignalCount} recruiter feedback signal
            {feedbackSignalCount === 1 ? "" : "s"} on this role
            {feedbackSignalCount < 20 ? (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                Role-fit model: Building (needs 20 signals for full calibration label)
              </span>
            ) : (
              <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                Role-fit calibration active
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              const link = window.location.origin + "/apply/" + roleId;
              await navigator.clipboard.writeText(link);
              setCopiedLink(true);
              setTimeout(() => setCopiedLink(false), 2000);
            }}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {copiedLink ? (
              <span className="text-emerald-600">✓ Link copied!</span>
            ) : (
              "Get Application Link"
            )}
          </button>
          <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setTab("candidates")}
              className={`rounded-md px-4 py-2 text-sm font-medium ${tab === "candidates" ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}
            >
              Candidates
            </button>
            <button
              type="button"
              onClick={() => setTab("briefing")}
              className={`rounded-md px-4 py-2 text-sm font-medium ${tab === "briefing" ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}
            >
              Briefing
            </button>
          </div>
        </div>
      </div>

      {tab === "briefing" ? (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-800">Role summary</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{b.roleSummary}</p>
          </section>
          <BriefingList title="Concept definitions" items={b.conceptDefinitions} />
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-800">Ideal profile</h2>
            <p className="mt-2 text-sm text-slate-800">{b.idealProfile}</p>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-800">Candidate pool</h2>
            <p className="mt-2 text-sm text-slate-800">{b.candidatePoolReality}</p>
          </section>
          <BriefingList title="Search — target companies" items={b.searchDirection.targetCompanies} />
          <BriefingList title="Search — alternative titles" items={b.searchDirection.alternativeTitles} />
          <BriefingList title="Search — sourcing channels" items={b.searchDirection.sourcingChannels} />
          <BriefingList title="Key deliverables & metrics" items={b.keyDeliverablesAndMetrics} />
          <BriefingList title="HM meeting prep" items={b.hmMeetingPrep} />
        </div>
      ) : (
        <div className="space-y-8">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Analyse resumes</h2>
            <p className="mt-1 text-sm text-slate-600">
              Upload one or more PDFs in a single batch, or paste one resume as plain text.
              Each file is analysed with Claude using this role&apos;s JD and Phase 1 briefing.
            </p>
            {candError ? <p className="mt-3 text-sm text-red-600">{candError}</p> : null}
            {uploadProgress ? (
              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-medium text-blue-950">
                    Analysing resume {uploadProgress.current} of {uploadProgress.total}…
                  </p>
                  <p className="truncate text-xs text-blue-800 sm:max-w-[50%] sm:text-right" title={uploadProgress.fileName}>
                    {uploadProgress.fileName}
                  </p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300 ease-out"
                    style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-blue-800">
                  Large batches run one at a time so the workspace stays responsive.
                </p>
              </div>
            ) : null}
            {batchSummary && !uploadBusy ? (
              <div className={`mt-4 rounded-xl border p-4 ${batchSummary.failures.length === 0 ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="text-sm text-slate-900">
                    <p className={`font-medium ${batchSummary.failures.length === 0 ? "text-emerald-950" : "text-amber-950"}`}>
                      {batchSummary.successes === 0
                        ? "No resumes completed successfully."
                        : batchSummary.successes === 1
                          ? "1 resume analysed successfully."
                          : `${batchSummary.successes} resumes analysed successfully.`}
                    </p>
                    {batchSummary.skippedNonPdf.length > 0 ? (
                      <p className="mt-2 text-sm text-slate-700">
                        Skipped non-PDF: {batchSummary.skippedNonPdf.join(", ")}
                      </p>
                    ) : null}
                    {batchSummary.failures.length > 0 ? (
                      <ul className="mt-2 list-inside list-disc space-y-1 text-slate-800">
                        {batchSummary.failures.map((f, idx) => (
                          <li key={`${idx}-${f.name}`}>
                            <span className="font-medium">{f.name}</span>: {f.error}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setBatchSummary(null)}
                    className="shrink-0 text-sm font-medium text-slate-600 underline hover:text-slate-900"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}
            <form className="mt-4 space-y-4" onSubmit={onSubmitResume}>
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  PDF resumes <span className="font-normal text-slate-500">(select multiple)</span>
                </label>
                <input
                  name="file"
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  disabled={uploadBusy}
                  className="mt-1 text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50 disabled:opacity-50"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Hold Ctrl/Cmd to select many PDFs. If a candidate already exists, you will be asked whether to update or add new.
                </p>
              </div>
              <div className="my-2 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">Single resume only</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Or paste resume text</label>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={8}
                  disabled={uploadBusy}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50"
                  placeholder="Paste one full resume as plain text (one person only)…"
                />
              </div>
              <button
                type="submit"
                disabled={uploadBusy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {uploadBusy
                  ? uploadProgress
                    ? `Analysing ${uploadProgress.current}/${uploadProgress.total}…`
                    : "Analysing…"
                  : "Run analysis"}
              </button>
            </form>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-950">All candidates</h2>
            {candidates.length === 0 ? (
              <p className="text-sm text-slate-600">No candidates yet. Submit a resume above.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Candidate</th>
                      <th className="px-4 py-3">JD fit</th>
                      <th className="px-4 py-3">Role fit</th>
                      <th className="px-4 py-3">Feedback</th>
                      <th className="px-4 py-3">Key signals</th>
                      <th className="w-12 px-2 py-3" aria-label="Expand" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {candidates.map((c) => {
                      const sig = (c.analysis.keySignals ?? []).slice(0, 2);
                      const isOpen = expandedCandidateId === c.id;
                      const jdBd = normalizeScoreBreakdown(c.analysis.jdFitBreakdown ?? null, c.jd_fit_rationale);
                      const roleBd = normalizeScoreBreakdown(c.analysis.roleFitBreakdown ?? null, c.role_fit_rationale);
                      return (
                        <Fragment key={c.id}>
                          <tr
                            role="button"
                            tabIndex={0}
                            aria-expanded={isOpen}
                            onClick={() => setExpandedCandidateId((prev) => prev === c.id ? null : c.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setExpandedCandidateId((prev) => prev === c.id ? null : c.id);
                              }
                            }}
                            className={`cursor-pointer transition-colors duration-200 hover:bg-slate-50/80 ${isOpen ? "bg-blue-50/60" : ""}`}
                          >
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-900">{c.analysis.fullName}</div>
                              <div className="text-xs text-slate-500">{c.analysis.currentTitle}</div>
                            </td>
                            <td className="px-4 py-3 text-blue-900" onClick={(e) => e.stopPropagation()}>
                              <ScoreWithTooltip variant="jd" score={c.jd_fit_score} breakdown={jdBd} compact />
                            </td>
                            <td className="px-4 py-3 text-emerald-900" onClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                                <ScoreWithTooltip variant="role" score={c.role_fit_score} breakdown={roleBd} compact />
                                {feedbackSignalCount < 20 ? (
                                  <span className="text-[10px] font-normal uppercase text-amber-700">Building</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-3 capitalize text-slate-700">
                              {c.latestFeedback?.feedback_type ?? "—"}
                              {c.latestFeedback?.reject_reason ? ` (${c.latestFeedback.reject_reason})` : ""}
                            </td>
                            <td className="max-w-xs px-4 py-3 text-slate-600">{sig.join(" · ") || "—"}</td>
                            <td className="px-2 py-3 align-middle text-slate-400">
                              <ChevronIcon open={isOpen} />
                            </td>
                          </tr>
                          <tr className="!border-b-0 hover:bg-transparent">
                            <td colSpan={6} className="border-0 p-0">
                              <div
                                className="grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none"
                                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                              >
                                <div className="min-h-0 overflow-hidden">
                                  {isOpen ? (
                                    <div className="border-t border-slate-200 bg-slate-50/80 p-4 sm:p-5">
                                      <CandidateCard
                                        candidate={c}
                                        feedbackSignalCount={feedbackSignalCount}
                                        onAfterFeedback={async () => {
                                          await loadCandidates();
                                          await loadRole();
                                        }}
                                      />
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden={true}
      className={`mx-auto h-5 w-5 shrink-0 transition-transform duration-300 ease-in-out motion-reduce:transition-none ${open ? "-rotate-180" : "rotate-0"}`}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function BriefingList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-800">{title}</h2>
      <ul className="mt-2 space-y-2 text-sm text-slate-800">
        {items.map((item, i) => (
          <li key={`${i}-${item.slice(0, 24)}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}