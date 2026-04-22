"use client";

import Link from "next/link";
import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { normalizeScoreBreakdown } from "@/lib/score-breakdown";
import type { BriefingSections, InternalContextPayload, MarketIntelligence, TalentFlowData } from "@/lib/types";
import type { TalentFlowInsight } from "@/app/api/roles/[roleId]/talent-flow-insights/route";
import CandidateCard, { type CandidateWithFeedback } from "./candidate-card";
import ScoreWithTooltip from "./score-with-tooltip";

type ScoringCalibration = {
  patternSummary: string;
  roleFitScoringGuidance: string;
  feedbackCount: number;
  updatedAt: string;
} | null;

type RoleAnnotation = {
  id: string;
  candidateId: string;
  candidateName: string;
  transcript: string;
  sentiment: string;
  observations: string[];
  concerns: string[];
  strengths: string[];
  suggestedFeedback: string | null;
  createdAt: string;
};

type SignalPrevalence = {
  label: string;
  candidateCount: number;
  percentage: number;
};

type AnnotationInsightsData = {
  totalAnnotations: number;
  annotatedCandidateCount: number;
  sentiments: { positive: number; neutral: number; negative: number };
  topStrengths: SignalPrevalence[];
  topConcerns: SignalPrevalence[];
};

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
  scoringCalibration: ScoringCalibration;
  annotations: RoleAnnotation[];
  annotationInsights: AnnotationInsightsData;
  marketIntelligence: MarketIntelligence | null;
  talentFlowData: TalentFlowData | null;
  talentFlowInsights: { insights: TalentFlowInsight[]; generatedAt: string } | null;
};

type DuplicateState = {
  existingCandidateId: string;
  existingName: string;
  message: string;
  pendingFile: File | null;
  pendingText: string;
};

export default function RoleWorkspace({ roleId }: { roleId: string }) {
  const [tab, setTab] = useState<"briefing" | "candidates" | "intelligence">("candidates");
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
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareMaxError, setCompareMaxError] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonRec, setComparisonRec] = useState<string | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  // ── Intelligence Journal state ────────────────────────────────────────────
  type IntelEntry = { id: string; entry: string; createdAt: string; updatedAt: string };
  const [intelEntries, setIntelEntries] = useState<IntelEntry[]>([]);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  const [newEntryText, setNewEntryText] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingEntryText, setEditingEntryText] = useState("");
  const [savingEntryId, setSavingEntryId] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  // ── Bulk re-analyse state ─────────────────────────────────────────────────
  const [reanalyseIds, setReanalyseIds] = useState<string[]>([]);
  const [reanalysing, setReanalysing] = useState(false);
  const [reanalyseProgress, setReanalyseProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [reanalyseResults, setReanalyseResults] = useState<{ name: string; oldScore: number; newScore: number; error?: string }[]>([]);
  const [reanalyseError, setReanalyseError] = useState<string | null>(null);

  async function loadIntelligence() {
    setIntelLoading(true);
    setIntelError(null);
    try {
      const res = await fetch(`/api/roles/${roleId}/intelligence`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load intelligence.");
      setIntelEntries(data.entries as IntelEntry[]);
    } catch (e) {
      setIntelError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setIntelLoading(false);
    }
  }

  async function handleAddEntry() {
    const text = newEntryText.trim();
    if (!text) return;
    setAddingEntry(true);
    setIntelError(null);
    try {
      const res = await fetch(`/api/roles/${roleId}/intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add entry.");
      setIntelEntries((prev) => [data.entry as IntelEntry, ...prev]);
      setNewEntryText("");
    } catch (e) {
      setIntelError(e instanceof Error ? e.message : "Failed to add.");
    } finally {
      setAddingEntry(false);
    }
  }

  async function handleSaveEntry(id: string) {
    const text = editingEntryText.trim();
    if (!text) return;
    setSavingEntryId(id);
    setIntelError(null);
    try {
      const res = await fetch(`/api/roles/${roleId}/intelligence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save.");
      setIntelEntries((prev) =>
        prev.map((e) => (e.id === id ? (data.entry as IntelEntry) : e))
      );
      setEditingEntryId(null);
    } catch (e) {
      setIntelError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingEntryId(null);
    }
  }

  async function handleDeleteEntry(id: string) {
    setDeletingEntryId(id);
    setIntelError(null);
    try {
      const res = await fetch(`/api/roles/${roleId}/intelligence/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete.");
      }
      setIntelEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setIntelError(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setDeletingEntryId(null);
    }
  }

  async function handleBulkReanalyse() {
    if (reanalyseIds.length === 0) return;
    setReanalysing(true);
    setReanalyseError(null);
    setReanalyseResults([]);

    const selected = candidates.filter((c) => reanalyseIds.includes(c.id));
    const results: { name: string; oldScore: number; newScore: number; error?: string }[] = [];

    for (let i = 0; i < selected.length; i++) {
      const c = selected[i];
      const name = (c.analysis as { fullName?: string })?.fullName ?? `Candidate ${i + 1}`;
      setReanalyseProgress({ current: i + 1, total: selected.length, name });
      try {
        const fd = new FormData();
        fd.append("reanalyseCandidateId", c.id);
        const res = await fetch(`/api/roles/${roleId}/candidates`, { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok && data.candidate) {
          const newScore = (data.candidate as { role_fit_score?: number }).role_fit_score ?? 0;
          results.push({ name, oldScore: c.role_fit_score ?? 0, newScore });
        } else {
          const errMsg = (data as { error?: string; details?: string }).error
            ?? (data as { details?: string }).details
            ?? `HTTP ${res.status}`;
          results.push({ name, oldScore: c.role_fit_score ?? 0, newScore: -1, error: errMsg });
        }
      } catch (e) {
        results.push({
          name,
          oldScore: c.role_fit_score ?? 0,
          newScore: -1,
          error: e instanceof Error ? e.message : "Network error",
        });
      }
    }

    setReanalyseResults(results);
    setReanalyseProgress(null);
    setReanalysing(false);
    setReanalyseIds([]);
    // Refresh candidates list
    try { await loadCandidates(); } catch { /* non-fatal */ }
  }

  // ── Talent flow insights state ────────────────────────────────────────────
  const [tfInsights, setTfInsights] = useState<TalentFlowInsight[] | null>(null);
  const [tfInsightsLoading, setTfInsightsLoading] = useState(false);
  const [tfInsightsError, setTfInsightsError] = useState<string | null>(null);
  const [tfInsightsGeneratedAt, setTfInsightsGeneratedAt] = useState<string | null>(null);

  // Load intelligence entries when Intelligence tab is first opened
  useEffect(() => {
    if (tab === "intelligence" && intelEntries.length === 0 && !intelLoading) {
      loadIntelligence();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Seed persisted insights when role data arrives
  useEffect(() => {
    if (role?.talentFlowInsights) {
      setTfInsights(role.talentFlowInsights.insights);
      setTfInsightsGeneratedAt(role.talentFlowInsights.generatedAt);
    }
  }, [role?.talentFlowInsights]);

  async function generateTalentFlowInsights() {
    setTfInsightsLoading(true);
    setTfInsightsError(null);
    try {
      const res = await fetch(`/api/roles/${roleId}/talent-flow-insights`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate insights.");
      setTfInsights(data.insights as TalentFlowInsight[]);
      setTfInsightsGeneratedAt(data.generatedAt as string);
    } catch (e) {
      setTfInsightsError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setTfInsightsLoading(false);
    }
  }

  // ── Edit Briefing modal state ─────────────────────────────────────────────
  const [showEditBriefing, setShowEditBriefing] = useState(false);
  const [editStep, setEditStep] = useState(1);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editWebsiteUrl, setEditWebsiteUrl] = useState("");
  const [editCompanyId, setEditCompanyId] = useState("");
  const [editCompanyContextSaved, setEditCompanyContextSaved] = useState(false);
  const [editInternalContext, setEditInternalContext] = useState<InternalContextPayload>({
    whyRoleOpen: "", successIn90Days: "", nonNegotiables: "",
    hiringManagerStyle: "", teamStructure: "", whyLastPersonLeft: "",
  });
  const [editJobDescription, setEditJobDescription] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [regenerateSuccess, setRegenerateSuccess] = useState(false);

  function openEditBriefing() {
    if (!role) return;
    setEditCompanyName(role.company?.name ?? "");
    setEditWebsiteUrl(role.company?.websiteUrl ?? "");
    setEditCompanyId(role.company?.id ?? "");
    setEditCompanyContextSaved(!!role.company?.id);
    const ctx = role.internalContext as InternalContextPayload | null;
    setEditInternalContext({
      whyRoleOpen: ctx?.whyRoleOpen ?? "",
      successIn90Days: ctx?.successIn90Days ?? "",
      nonNegotiables: ctx?.nonNegotiables ?? "",
      hiringManagerStyle: ctx?.hiringManagerStyle ?? "",
      teamStructure: ctx?.teamStructure ?? "",
      whyLastPersonLeft: ctx?.whyLastPersonLeft ?? "",
    });
    setEditJobDescription(role.jobDescription ?? "");
    setEditStep(1);
    setEditError(null);
    setRegenerateSuccess(false);
    setShowEditBriefing(true);
  }

  async function editSaveCompany(e: React.FormEvent) {
    e.preventDefault();
    setEditError(null);
    setEditLoading(true);
    try {
      const res = await fetch("/api/company-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: editCompanyName, websiteUrl: editWebsiteUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save company.");
      setEditCompanyId(data.company.id);
      setEditCompanyContextSaved(true);
      setEditStep(2);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setEditLoading(false);
    }
  }

  async function editRegenerateBriefing(e: React.FormEvent) {
    e.preventDefault();
    setEditError(null);
    setEditLoading(true);
    try {
      const res = await fetch(`/api/roles/${roleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: editCompanyId,
          jobDescription: editJobDescription,
          internalContext: editInternalContext,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Regeneration failed.");
      setRegenerateSuccess(true);
      await loadRole();
      setTimeout(() => {
        setShowEditBriefing(false);
        setRegenerateSuccess(false);
        setTab("briefing");
      }, 1500);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setEditLoading(false);
    }
  }

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
      scoringCalibration: (data.role.scoringCalibration as ScoringCalibration) ?? null,
      annotations: (data.role.annotations as RoleAnnotation[]) ?? [],
      annotationInsights: (data.role.annotationInsights as AnnotationInsightsData) ?? {
        totalAnnotations: 0,
        annotatedCandidateCount: 0,
        sentiments: { positive: 0, neutral: 0, negative: 0 },
        topStrengths: [],
        topConcerns: [],
      },
      marketIntelligence: (data.role.marketIntelligence as MarketIntelligence | null) ?? null,
      talentFlowData: (data.role.talentFlowData as TalentFlowData | null) ?? null,
      talentFlowInsights: (data.role.talentFlowInsights as { insights: TalentFlowInsight[]; generatedAt: string } | null) ?? null,
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

  function toggleCompare(id: string) {
    setCompareMaxError(false);
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) {
        setCompareMaxError(true);
        return prev;
      }
      return [...prev, id];
    });
  }

  async function handleCompareTop() {
    const topIds = [...candidates]
      .sort((a, b) => b.role_fit_score - a.role_fit_score)
      .slice(0, 3)
      .map((c) => c.id);
    setCompareIds(topIds);
    setCompareMaxError(false);
    setComparisonRec(null);
    setComparisonError(null);
    setShowComparison(true);
    setComparisonLoading(true);
    try {
      const res = await fetch(`/api/roles/${roleId}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: topIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Comparison failed.");
      setComparisonRec(data.recommendation);
    } catch (e) {
      setComparisonError(e instanceof Error ? e.message : "Comparison failed.");
    } finally {
      setComparisonLoading(false);
    }
  }

  async function handleCompare() {
    setComparisonRec(null);
    setComparisonError(null);
    setShowComparison(true);
    setComparisonLoading(true);
    try {
      const res = await fetch(`/api/roles/${roleId}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: compareIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Comparison failed.");
      setComparisonRec(data.recommendation);
    } catch (e) {
      setComparisonError(e instanceof Error ? e.message : "Comparison failed.");
    } finally {
      setComparisonLoading(false);
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
            <button
              type="button"
              onClick={() => setTab("intelligence")}
              className={`rounded-md px-4 py-2 text-sm font-medium ${tab === "intelligence" ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}
            >
              Intelligence
            </button>
            <Link
              href={`/roles/${roleId}/dashboard`}
              className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </div>

      {tab === "briefing" ? (
        <div className="space-y-4">
          {/* Edit Briefing button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openEditBriefing}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              ✏️ Edit Briefing
            </button>
          </div>

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

          {/* Talent Flow — two subsections: A) Market Intelligence, B) Your Pipeline */}
          {(role.briefing.talentFlow || role.talentFlowData) ? (
            <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-5 shadow-sm space-y-5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-violet-800">
                  Talent Flow
                </h2>
              </div>

              {/* Subsection A — Market Intelligence (Tavily + Claude) */}
              {role.briefing.talentFlow ? (
                <div>
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                    Market Intelligence
                  </p>
                  <p className="mb-3 text-[11px] text-violet-400">
                    Based on public market data. Updates when briefing is regenerated.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-violet-100 bg-white p-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-violet-700">Feeder companies</p>
                      {role.briefing.talentFlow.feederCompanies.length > 0 ? (
                        <ul className="space-y-1">
                          {role.briefing.talentFlow.feederCompanies.map((co, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700">
                              <span className="mt-0.5 shrink-0 text-violet-400">·</span>{co}
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-xs italic text-slate-400">No data available.</p>}
                    </div>
                    <div className="rounded-lg border border-violet-100 bg-white p-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-violet-700">Typical career path</p>
                      {role.briefing.talentFlow.careerPath
                        ? <p className="text-xs leading-relaxed text-slate-700">{role.briefing.talentFlow.careerPath}</p>
                        : <p className="text-xs italic text-slate-400">No data available.</p>}
                    </div>
                    <div className="rounded-lg border border-violet-100 bg-white p-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-violet-700">Sector movement patterns</p>
                      {role.briefing.talentFlow.sectorPatterns
                        ? <p className="text-xs leading-relaxed text-slate-700">{role.briefing.talentFlow.sectorPatterns}</p>
                        : <p className="text-xs italic text-slate-400">No data available.</p>}
                    </div>
                    <div className="rounded-lg border border-violet-100 bg-white p-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-violet-700">Where to look first</p>
                      {role.briefing.talentFlow.sourcingDirection
                        ? <p className="text-xs leading-relaxed text-slate-700">{role.briefing.talentFlow.sourcingDirection}</p>
                        : <p className="text-xs italic text-slate-400">No data available.</p>}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Subsection B — Pipeline Intelligence (Claude-powered) */}
              {(() => {
                const tfd = role.talentFlowData;
                const companyCount = tfd ? Object.keys(tfd).filter((k) => tfd[k].total > 0).length : 0;
                const hasEnough = companyCount >= 5;

                return (
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                          Pipeline Intelligence
                        </p>
                        {tfInsightsGeneratedAt ? (
                          <p className="mt-0.5 text-[10px] text-violet-400">
                            Generated {new Date(tfInsightsGeneratedAt).toLocaleString("en-IN", {
                              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                            })}
                          </p>
                        ) : null}
                      </div>
                      {hasEnough ? (
                        <button
                          type="button"
                          onClick={generateTalentFlowInsights}
                          disabled={tfInsightsLoading}
                          className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 shadow-sm hover:bg-violet-50 disabled:opacity-60"
                        >
                          {tfInsightsLoading ? (
                            <>
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Analysing…
                            </>
                          ) : tfInsights ? (
                            <>
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
                              </svg>
                              Regenerate
                            </>
                          ) : (
                            <>
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                              Generate Pipeline Insights
                            </>
                          )}
                        </button>
                      ) : null}
                    </div>

                    {!hasEnough ? (
                      <p className="text-xs italic text-slate-400">
                        Review more candidates to unlock pipeline intelligence. You need data from at least 5 company backgrounds.
                      </p>
                    ) : tfInsightsLoading ? (
                      <div className="rounded-lg border border-violet-100 bg-white px-4 py-6 text-center">
                        <p className="text-sm text-violet-600">Analysing your pipeline talent flow…</p>
                        <p className="mt-1 text-xs text-slate-400">This usually takes 5–10 seconds.</p>
                      </div>
                    ) : tfInsightsError ? (
                      <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
                        <p className="text-xs text-red-700">{tfInsightsError}</p>
                      </div>
                    ) : tfInsights ? (
                      <div className="space-y-2">
                        {tfInsights.map((ins, i) => {
                          const borderColor =
                            ins.strength === "high" ? "border-blue-400" :
                            ins.strength === "medium" ? "border-amber-400" :
                            "border-slate-300";
                          const strengthLabel =
                            ins.strength === "high" ? "Strong signal" :
                            ins.strength === "medium" ? "Moderate signal" :
                            "Weak signal";
                          const strengthColor =
                            ins.strength === "high" ? "text-blue-600 bg-blue-50" :
                            ins.strength === "medium" ? "text-amber-600 bg-amber-50" :
                            "text-slate-500 bg-slate-100";

                          const icon = (() => {
                            switch (ins.type) {
                              case "movement_pattern":
                                return (
                                  <svg className="h-4 w-4 shrink-0 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M5 12h14M12 5l7 7-7 7" />
                                  </svg>
                                );
                              case "feeder_archetype":
                                return (
                                  <svg className="h-4 w-4 shrink-0 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
                                  </svg>
                                );
                              case "rejection_signal":
                                return (
                                  <svg className="h-4 w-4 shrink-0 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                                  </svg>
                                );
                              case "surprise_signal":
                                return (
                                  <svg className="h-4 w-4 shrink-0 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 3l1.5 4.5H18l-3.75 2.75 1.5 4.5L12 12l-3.75 2.75 1.5-4.5L6 7.5h4.5z" />
                                  </svg>
                                );
                              case "career_path":
                                return (
                                  <svg className="h-4 w-4 shrink-0 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" />
                                  </svg>
                                );
                              case "sourcing_recommendation":
                                return (
                                  <svg className="h-4 w-4 shrink-0 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
                                  </svg>
                                );
                              case "poaching_pattern":
                                return (
                                  <svg className="h-4 w-4 shrink-0 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 2C8 2 4 5 4 9c0 5.25 8 13 8 13s8-7.75 8-13c0-4-4-7-8-7z" /><circle cx="12" cy="9" r="2.5" />
                                  </svg>
                                );
                            }
                          })();

                          return (
                            <div
                              key={i}
                              className={`flex gap-3 rounded-lg border-l-4 bg-white p-3 shadow-sm ${borderColor}`}
                            >
                              <div className="mt-0.5">{icon}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs leading-relaxed text-slate-800">{ins.insight}</p>
                                <div className="mt-1.5 flex items-center gap-2">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${strengthColor}`}>
                                    {strengthLabel}
                                  </span>
                                  <span className="text-[10px] text-slate-400 capitalize">{ins.type.replace(/_/g, " ")}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        {companyCount} companies tracked across {Object.values(tfd ?? {}).reduce((s, e) => s + e.total, 0)} candidates. Click &ldquo;Generate Pipeline Insights&rdquo; to analyse.
                      </p>
                    )}
                  </div>
                );
              })()}
            </section>
          ) : null}

          {/* Market Intelligence */}
          {role.marketIntelligence ? (
            <section className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-800">
                  Market Intelligence
                </h2>
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                  Live · {new Date(role.marketIntelligence.fetchedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {/* Company intelligence */}
                <div className="rounded-lg border border-indigo-100 bg-white p-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Company signals</p>
                  {role.marketIntelligence.companyIntelligence.answer ? (
                    <p className="text-xs text-slate-700 leading-relaxed">{role.marketIntelligence.companyIntelligence.answer.slice(0, 400)}</p>
                  ) : (
                    <p className="text-xs italic text-slate-400">No data available.</p>
                  )}
                  {role.marketIntelligence.companyIntelligence.snippets.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {role.marketIntelligence.companyIntelligence.snippets.slice(0, 2).map((s, i) => (
                        <li key={i} className="text-[11px] text-slate-500 line-clamp-2">· {s}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {/* Talent pool */}
                <div className="rounded-lg border border-indigo-100 bg-white p-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Talent pool · India</p>
                  {role.marketIntelligence.talentPool.answer ? (
                    <p className="text-xs text-slate-700 leading-relaxed">{role.marketIntelligence.talentPool.answer.slice(0, 400)}</p>
                  ) : (
                    <p className="text-xs italic text-slate-400">No data available.</p>
                  )}
                  {role.marketIntelligence.talentPool.snippets.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {role.marketIntelligence.talentPool.snippets.slice(0, 2).map((s, i) => (
                        <li key={i} className="text-[11px] text-slate-500 line-clamp-2">· {s}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {/* Industry metrics */}
                <div className="rounded-lg border border-indigo-100 bg-white p-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Industry KPIs</p>
                  {role.marketIntelligence.industryMetrics.answer ? (
                    <p className="text-xs text-slate-700 leading-relaxed">{role.marketIntelligence.industryMetrics.answer.slice(0, 400)}</p>
                  ) : (
                    <p className="text-xs italic text-slate-400">No data available.</p>
                  )}
                  {role.marketIntelligence.industryMetrics.snippets.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {role.marketIntelligence.industryMetrics.snippets.slice(0, 2).map((s, i) => (
                        <li key={i} className="text-[11px] text-slate-500 line-clamp-2">· {s}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      ) : tab === "intelligence" ? (
        /* ── Intelligence Journal tab ───────────────────────────────────────── */
        <div className="space-y-6">
          {/* Section 1 — Journal */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Role Intelligence Journal</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Notes that are injected as hard constraints into every resume analysis and briefing regeneration for this role.
                </p>
              </div>
            </div>

            {/* Add new entry */}
            <div className="mt-4 flex flex-col gap-2">
              <textarea
                rows={3}
                value={newEntryText}
                onChange={(e) => setNewEntryText(e.target.value)}
                placeholder="e.g. Only consider candidates with hands-on B2C product experience. No agency or consulting backgrounds."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleAddEntry}
                  disabled={addingEntry || !newEntryText.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {addingEntry ? "Adding…" : "Add Insight"}
                </button>
                {intelError ? (
                  <p className="text-sm text-red-600">{intelError}</p>
                ) : null}
              </div>
            </div>

            {/* Entry list */}
            <div className="mt-5 space-y-3">
              {intelLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
                  Loading…
                </div>
              ) : intelEntries.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No intelligence entries yet. Add the first one above.</p>
              ) : (
                intelEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    {editingEntryId === entry.id ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          rows={3}
                          value={editingEntryText}
                          onChange={(e) => setEditingEntryText(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSaveEntry(entry.id)}
                            disabled={savingEntryId === entry.id}
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingEntryId === entry.id ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingEntryId(null)}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-slate-800 leading-relaxed flex-1">{entry.entry}</p>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEntryId(entry.id);
                              setEditingEntryText(entry.entry);
                            }}
                            className="text-xs font-medium text-slate-500 hover:text-blue-600"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteEntry(entry.id)}
                            disabled={deletingEntryId === entry.id}
                            className="text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-50"
                          >
                            {deletingEntryId === entry.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Section 2 — Bulk Re-analyse */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Bulk Re-analyse Candidates</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Select candidates to re-analyse with the current intelligence entries applied. Scores may change.
            </p>

            {candidates.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400 italic">No candidates yet for this role.</p>
            ) : (
              <>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-3 mb-3">
                    <button
                      type="button"
                      onClick={() =>
                        setReanalyseIds(
                          reanalyseIds.length === candidates.length
                            ? []
                            : candidates.map((c) => c.id)
                        )
                      }
                      className="text-xs font-medium text-blue-600 hover:text-blue-700"
                    >
                      {reanalyseIds.length === candidates.length ? "Deselect all" : "Select all"}
                    </button>
                    <span className="text-xs text-slate-400">{reanalyseIds.length} selected</span>
                  </div>
                  {candidates.map((c) => {
                    const name = (c.analysis as { fullName?: string })?.fullName ?? "Unknown";
                    const checked = reanalyseIds.includes(c.id);
                    const result = reanalyseResults.find((r) => r.name === name);
                    return (
                      <label
                        key={c.id}
                        className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 cursor-pointer hover:bg-slate-100"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setReanalyseIds((prev) =>
                              prev.includes(c.id)
                                ? prev.filter((id) => id !== c.id)
                                : [...prev, c.id]
                            )
                          }
                          disabled={reanalysing}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        <span className="flex-1 text-sm text-slate-800">{name}</span>
                        <span className="text-xs text-slate-500">
                          Score: {c.role_fit_score ?? "—"}
                        </span>
                        {result ? (
                          <span
                            className={`text-xs font-semibold ${
                              result.newScore < 0
                                ? "text-red-500"
                                : result.newScore > result.oldScore
                                ? "text-emerald-600"
                                : result.newScore < result.oldScore
                                ? "text-amber-600"
                                : "text-slate-500"
                            }`}
                          >
                            {result.newScore < 0
                              ? "Error"
                              : result.newScore === result.oldScore
                              ? "Unchanged"
                              : `→ ${result.newScore}`}
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={handleBulkReanalyse}
                    disabled={reanalysing || reanalyseIds.length === 0}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {reanalysing ? "Re-analysing…" : `Re-analyse ${reanalyseIds.length > 0 ? reanalyseIds.length : ""} candidates`}
                  </button>
                  {reanalyseProgress ? (
                    <p className="text-sm text-slate-600">
                      {reanalyseProgress.current}/{reanalyseProgress.total} — {reanalyseProgress.name}
                    </p>
                  ) : null}
                  {reanalyseError ? (
                    <p className="text-sm text-red-600">{reanalyseError}</p>
                  ) : null}
                </div>

                {reanalyseResults.length > 0 && !reanalysing ? (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-medium text-emerald-900 mb-2">Re-analysis complete</p>
                    <ul className="space-y-1">
                      {reanalyseResults.map((r, i) => (
                        <li key={i} className="text-xs text-slate-700 flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{r.name}</span>
                            {r.newScore < 0 ? (
                              <span className="text-red-500 font-medium">failed</span>
                            ) : (
                              <span className={r.newScore > r.oldScore ? "text-emerald-700" : r.newScore < r.oldScore ? "text-amber-700" : "text-slate-500"}>
                                {r.oldScore} → {r.newScore}
                                {r.newScore > r.oldScore ? " ↑" : r.newScore < r.oldScore ? " ↓" : " (same)"}
                              </span>
                            )}
                          </div>
                          {r.error ? (
                            <span className="text-red-500 pl-0">{r.error}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </section>
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-950">All candidates</h2>
              <div className="flex items-center gap-2">
                {compareMaxError ? (
                  <span className="text-xs text-amber-700 font-medium">
                    Maximum 4 candidates can be compared at once.
                  </span>
                ) : null}
                {candidates.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleCompareTop}
                    className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 shadow-sm"
                  >
                    ✦ Compare Top {Math.min(candidates.length, 3)}
                  </button>
                ) : null}
                {compareIds.length >= 2 ? (
                  <button
                    type="button"
                    onClick={handleCompare}
                    className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 shadow-sm"
                  >
                    Compare ({compareIds.length})
                  </button>
                ) : null}
                {compareIds.length === 1 ? (
                  <span className="text-xs text-slate-500">Select 1 more to compare</span>
                ) : null}
                {compareIds.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => { setCompareIds([]); setCompareMaxError(false); }}
                    className="text-xs text-slate-500 underline hover:text-slate-700"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
            {candidates.length === 0 ? (
              <p className="text-sm text-slate-600">No candidates yet. Submit a resume above.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="w-10 px-3 py-3" aria-label="Compare" />
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
                      const isChecked = compareIds.includes(c.id);
                      const jdBd = normalizeScoreBreakdown(c.analysis.jdFitBreakdown ?? null, c.jd_fit_rationale);
                      const roleBd = normalizeScoreBreakdown(c.analysis.roleFitBreakdown ?? null, c.role_fit_rationale);
                      const fbType = c.latestFeedback?.feedback_type;
                      const rowBorderColor =
                        fbType === "shortlist" ? "#10b981"
                        : fbType === "reject" ? "#ef4444"
                        : fbType === "hold" ? "#f59e0b"
                        : "transparent";
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
                            style={{ borderLeft: `4px solid ${rowBorderColor}` }}
                            className={`cursor-pointer transition-colors duration-200 hover:bg-slate-50/80 ${isOpen ? "bg-blue-50/60" : ""} ${fbType === "reject" ? "opacity-75" : ""}`}
                          >
                            <td className="px-3 py-3 align-middle" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleCompare(c.id)}
                                aria-label={`Select ${c.analysis.fullName} for comparison`}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
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
                            <td className="px-4 py-3">
                              <RowFeedbackBadge feedback={c.latestFeedback} />
                            </td>
                            <td className="max-w-xs px-4 py-3 text-slate-600">{sig.join(" · ") || "—"}</td>
                            <td className="px-2 py-3 align-middle text-slate-400">
                              <ChevronIcon open={isOpen} />
                            </td>
                          </tr>
                          <tr className="!border-b-0 hover:bg-transparent">
                            <td colSpan={7} className="border-0 p-0">
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

          {showComparison ? (
            <ComparisonModal
              candidates={candidates.filter((c) => compareIds.includes(c.id))}
              recommendation={comparisonRec}
              loading={comparisonLoading}
              error={comparisonError}
              onClose={() => setShowComparison(false)}
            />
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Learning loop</h2>
            <p className="mt-1 text-sm text-slate-500">
              Insights the system has derived from your feedback on this role.
            </p>
            {feedbackSignalCount < 5 ? (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-5 py-6 text-center">
                <p className="text-sm text-slate-500">
                  Give feedback on 5 or more candidates to activate the learning feed.
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {feedbackSignalCount} of 5 signals collected
                </p>
              </div>
            ) : role.scoringCalibration ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-blue-800">Pattern summary</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{role.scoringCalibration.patternSummary}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-blue-800">Role-fit scoring guidance</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{role.scoringCalibration.roleFitScoringGuidance}</p>
                </div>
                <p className="text-xs text-slate-400">
                  Based on {role.scoringCalibration.feedbackCount} feedback signal{role.scoringCalibration.feedbackCount === 1 ? "" : "s"} · last updated {new Date(role.scoringCalibration.updatedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-5 py-6 text-center">
                <p className="text-sm text-slate-500">
                  Calibration is computing — check back shortly.
                </p>
              </div>
            )}

            {/* Annotation Insights */}
            <div className="mt-6 border-t border-slate-100 pt-6">
              <h3 className="text-sm font-semibold text-slate-950">Annotation insights</h3>
              <p className="mt-0.5 text-xs text-slate-500">From voice notes recorded on candidate cards.</p>
              <AnnotationInsights annotations={role.annotations} insights={role.annotationInsights} />
            </div>
          </section>
        </div>
      )}
      {/* Edit Briefing Modal */}
      {showEditBriefing ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8"
          onClick={() => { if (!editLoading) setShowEditBriefing(false); }}
        >
          <div
            className="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Edit Briefing</h2>
                <p className="text-xs text-slate-500">Step {editStep} of 3</p>
              </div>
              <button
                type="button"
                disabled={editLoading}
                onClick={() => setShowEditBriefing(false)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>

            {/* Progress bar */}
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${(editStep / 3) * 100}%` }}
              />
            </div>

            {editError ? (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {editError}
              </div>
            ) : null}

            {regenerateSuccess ? (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                ✓ Briefing regenerated successfully
              </div>
            ) : null}

            {/* Step 1 — Company */}
            {editStep === 1 ? (
              <form className="space-y-4" onSubmit={editSaveCompany}>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Company name</label>
                  <input
                    required
                    value={editCompanyName}
                    onChange={(e) => setEditCompanyName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Company website URL</label>
                  <input
                    required
                    value={editWebsiteUrl}
                    onChange={(e) => setEditWebsiteUrl(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={editLoading}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {editLoading ? "Fetching…" : "Save & Continue"}
                  </button>
                  {editCompanyContextSaved ? (
                    <button
                      type="button"
                      onClick={() => setEditStep(2)}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Skip (keep existing)
                    </button>
                  ) : null}
                </div>
              </form>
            ) : null}

            {/* Step 2 — Internal Context */}
            {editStep === 2 ? (
              <form
                className="space-y-4"
                onSubmit={(e) => { e.preventDefault(); setEditStep(3); }}
              >
                {([
                  { key: "whyRoleOpen", label: "Why is this role open", required: true },
                  { key: "successIn90Days", label: "Success in the first 90 days", required: true },
                  { key: "nonNegotiables", label: "Non-negotiables not in the JD", required: true },
                  { key: "hiringManagerStyle", label: "Hiring manager name & style", required: true },
                  { key: "teamStructure", label: "Team size and structure", required: true },
                  { key: "whyLastPersonLeft", label: "Why did the last person leave (optional)", required: false },
                ] as { key: keyof InternalContextPayload; label: string; required: boolean }[]).map((field) => (
                  <div key={field.key}>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">{field.label}</label>
                    <textarea
                      required={field.required}
                      rows={2}
                      value={editInternalContext[field.key] ?? ""}
                      onChange={(e) =>
                        setEditInternalContext((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                    />
                  </div>
                ))}
                <div className="flex gap-3">
                  <button type="button" onClick={() => setEditStep(1)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</button>
                  <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Save & Continue</button>
                </div>
              </form>
            ) : null}

            {/* Step 3 — JD + Regenerate */}
            {editStep === 3 ? (
              <form className="space-y-4" onSubmit={editRegenerateBriefing}>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Job description</label>
                  <textarea
                    required
                    rows={14}
                    value={editJobDescription}
                    onChange={(e) => setEditJobDescription(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setEditStep(2)} disabled={editLoading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Back</button>
                  <button
                    type="submit"
                    disabled={editLoading || editJobDescription.trim().length < 50}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {editLoading ? "Regenerating…" : "Regenerate Briefing"}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function AnnotationInsights({
  annotations,
  insights,
}: {
  annotations: RoleAnnotation[];
  insights: AnnotationInsightsData;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  if (insights.totalAnnotations === 0) {
    return (
      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-5 py-6 text-center">
        <p className="text-sm text-slate-500">
          No voice annotations yet. Press{" "}
          <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700">
            Space
          </kbd>{" "}
          on any candidate card to record your first annotation.
        </p>
      </div>
    );
  }

  const { sentiments, topStrengths, topConcerns, totalAnnotations, annotatedCandidateCount } = insights;
  const recent = annotations.slice(0, 3);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700">
          {totalAnnotations} annotation{totalAnnotations !== 1 ? "s" : ""}
          {annotatedCandidateCount > 0 && (
            <span className="ml-1 text-slate-400">
              across {annotatedCandidateCount} candidate{annotatedCandidateCount !== 1 ? "s" : ""}
            </span>
          )}
        </span>
        {sentiments.positive > 0 && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            {sentiments.positive} positive
          </span>
        )}
        {sentiments.neutral > 0 && (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {sentiments.neutral} neutral
          </span>
        )}
        {sentiments.negative > 0 && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
            {sentiments.negative} negative
          </span>
        )}
      </div>

      {/* Strengths + Concerns with prevalence */}
      <div className="grid gap-3 sm:grid-cols-2">
        {topStrengths.length > 0 && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">
              Common strengths
            </h4>
            <ul className="space-y-1.5">
              {topStrengths.map((signal, i) => (
                <li key={i} className="relative overflow-hidden rounded-lg border border-emerald-100 bg-white">
                  <div
                    className="absolute inset-y-0 left-0 rounded-lg bg-emerald-200"
                    style={{ width: `${signal.percentage}%` }}
                    aria-hidden="true"
                  />
                  <div className="relative flex items-center justify-between gap-2 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm text-slate-800">
                      <span className="shrink-0 text-xs text-emerald-500">✓</span>
                      <span className="truncate">{signal.label}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                      {signal.candidateCount} candidate{signal.candidateCount !== 1 ? "s" : ""} · {signal.percentage}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {topConcerns.length > 0 && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
              Common concerns
            </h4>
            <ul className="space-y-1.5">
              {topConcerns.map((signal, i) => (
                <li key={i} className="relative overflow-hidden rounded-lg border border-amber-100 bg-white">
                  <div
                    className="absolute inset-y-0 left-0 rounded-lg bg-amber-200"
                    style={{ width: `${signal.percentage}%` }}
                    aria-hidden="true"
                  />
                  <div className="relative flex items-center justify-between gap-2 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm text-slate-800">
                      <span className="shrink-0 text-xs text-amber-500">!</span>
                      <span className="truncate">{signal.label}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      {signal.candidateCount} candidate{signal.candidateCount !== 1 ? "s" : ""} · {signal.percentage}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Recent transcripts */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Recent annotations
        </h4>
        <ul className="space-y-2">
          {recent.map((ann) => {
            const isOpen = expandedIds.has(ann.id);
            return (
              <li key={ann.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-900">{ann.candidateName}</span>
                    <span className="text-xs text-slate-400">
                      {new Date(ann.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      ann.sentiment === "positive"
                        ? "bg-emerald-100 text-emerald-800"
                        : ann.sentiment === "negative"
                        ? "bg-red-100 text-red-700"
                        : "bg-slate-100 text-slate-600"
                    }`}>
                      {ann.sentiment}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpand(ann.id)}
                    className="shrink-0 text-xs text-slate-500 underline hover:text-slate-700"
                  >
                    {isOpen ? "Collapse" : "Expand"}
                  </button>
                </div>
                <p className={`mt-2 text-sm italic text-slate-700 ${isOpen ? "" : "line-clamp-2"}`}>
                  &ldquo;{ann.transcript}&rdquo;
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ComparisonModal({
  candidates,
  recommendation,
  loading,
  error,
  onClose,
}: {
  candidates: CandidateWithFeedback[];
  recommendation: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const trajectoryBadge = (t: string) => {
    if (t === "ascending") return "bg-emerald-100 text-emerald-800";
    if (t === "descending") return "bg-red-100 text-red-700";
    return "bg-slate-100 text-slate-700";
  };

  const feedbackBadge = (fb: CandidateWithFeedback["latestFeedback"]) => {
    if (!fb) return { label: "No feedback", cls: "bg-slate-100 text-slate-500" };
    if (fb.feedback_type === "shortlist") return { label: "Shortlisted", cls: "bg-emerald-100 text-emerald-800" };
    if (fb.feedback_type === "reject") return { label: `Rejected${fb.reject_reason ? ` (${fb.reject_reason})` : ""}`, cls: "bg-red-100 text-red-700" };
    return { label: "Hold", cls: "bg-amber-100 text-amber-800" };
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/50 px-4 py-10"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Comparing {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Side-by-side breakdown</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        {/* Candidate columns */}
        <div className="overflow-x-auto p-6">
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${candidates.length}, minmax(220px, 1fr))` }}
          >
            {candidates.map((c) => {
              const a = c.analysis;
              const signals = (a.keySignals ?? []).slice(0, 3);
              const gaps = (a.missingForRole ?? []).slice(0, 2);
              const fb = feedbackBadge(c.latestFeedback);
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  {/* Name + title */}
                  <div>
                    <div className="font-semibold text-slate-950">{a.fullName || "Unknown"}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{a.currentTitle}</div>
                  </div>

                  {/* Scores */}
                  <div className="flex gap-2">
                    <div className="flex-1 rounded-lg border border-blue-100 bg-blue-50 px-2 py-2 text-center">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">JD fit</div>
                      <div className="text-xl font-bold text-blue-950">{c.jd_fit_score}</div>
                    </div>
                    <div className="flex-1 rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-2 text-center">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Role fit</div>
                      <div className="text-xl font-bold text-emerald-950">{c.role_fit_score}</div>
                    </div>
                  </div>

                  {/* Experience */}
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <div className="text-xs text-slate-500 mb-1">Experience</div>
                    <div className="font-medium text-slate-900">
                      {a.totalYearsExperience} yrs total · {a.relevantYearsForRole} yrs relevant
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Avg tenure: {a.averageTenureYearsPerRole} yrs/role
                    </div>
                  </div>

                  {/* Trajectory */}
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Career trajectory</div>
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${trajectoryBadge(a.careerTrajectory)}`}>
                      {a.careerTrajectory}
                    </span>
                  </div>

                  {/* Key signals */}
                  <div>
                    <div className="text-xs font-semibold text-blue-800 mb-1.5">Top signals</div>
                    {signals.length > 0 ? (
                      <ul className="space-y-1">
                        {signals.map((s, i) => (
                          <li key={i} className="flex gap-1.5 text-xs text-slate-800">
                            <span className="text-emerald-500 shrink-0">✓</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-400">None recorded</p>
                    )}
                  </div>

                  {/* Gaps */}
                  <div>
                    <div className="text-xs font-semibold text-amber-800 mb-1.5">Top gaps</div>
                    {gaps.length > 0 ? (
                      <ul className="space-y-1">
                        {gaps.map((g, i) => (
                          <li key={i} className="flex gap-1.5 text-xs text-slate-800">
                            <span className="text-red-400 shrink-0">✗</span>
                            <span>{g}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-400">None flagged</p>
                    )}
                  </div>

                  {/* Feedback */}
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Feedback status</div>
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${fb.cls}`}>
                      {fb.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Claude recommendation */}
        <div className="border-t border-slate-200 px-6 py-5">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-slate-950">Claude&apos;s recommendation</h3>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
              AI
            </span>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
              Analysing candidates…
            </div>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : recommendation ? (
            <p className="text-sm leading-relaxed text-slate-800">{recommendation}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RowFeedbackBadge({ feedback }: { feedback: CandidateWithFeedback["latestFeedback"] }) {
  if (!feedback) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
        No signal
      </span>
    );
  }
  if (feedback.feedback_type === "shortlist") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
        Shortlisted
      </span>
    );
  }
  if (feedback.feedback_type === "reject") {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
        Rejected{feedback.reject_reason ? ` (${feedback.reject_reason})` : ""}
      </span>
    );
  }
  if (feedback.feedback_type === "hold") {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
        On Hold
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
      {feedback.feedback_type}
    </span>
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