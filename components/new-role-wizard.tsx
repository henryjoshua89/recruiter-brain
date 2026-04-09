"use client";

import { FormEvent, useMemo, useState } from "react";
import type { BriefingSections, InternalContextPayload } from "@/lib/types";

type CompanyRecord = {
  id: string;
  name: string;
  websiteUrl: string;
  publicContext: {
    title?: string;
    metaDescription?: string;
    summary?: string;
    sourceUrl?: string;
  };
};

const stepLabels = [
  "Company Setup",
  "Internal Context",
  "JD Input",
  "Briefing Output",
];

const initialInternalContext: InternalContextPayload = {
  whyRoleOpen: "",
  successIn90Days: "",
  nonNegotiables: "",
  hiringManagerStyle: "",
  teamStructure: "",
  whyLastPersonLeft: "",
};

export default function NewRoleWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [company, setCompany] = useState<CompanyRecord | null>(null);

  const [internalContext, setInternalContext] = useState(initialInternalContext);
  const [jobDescription, setJobDescription] = useState("");

  const [briefing, setBriefing] = useState<BriefingSections | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);

  const canGoToStep2 = !!company?.id;
  const canGoToStep3 =
    canGoToStep2 &&
    internalContext.whyRoleOpen &&
    internalContext.successIn90Days &&
    internalContext.nonNegotiables &&
    internalContext.hiringManagerStyle &&
    internalContext.teamStructure;
  const canGenerate = canGoToStep3 && jobDescription.trim().length > 100;

  const progress = useMemo(() => (currentStep / 4) * 100, [currentStep]);

  async function saveCompany(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/company-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, websiteUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save company.");
      setCompany(data.company);
      setCurrentStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function saveInternalContext(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canGoToStep3) {
      setError("Please complete all required internal context fields.");
      return;
    }
    setCurrentStep(3);
  }

  async function generateBriefing(e: FormEvent) {
    e.preventDefault();
    if (!company?.id) {
      setError("Company must be set up before generating a briefing.");
      return;
    }
    if (!canGenerate) {
      setError(
        "Please provide a full job description (at least 100 characters)."
      );
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/new-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          jobDescription,
          internalContext,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate briefing.");
      setBriefing(data.briefing);
      setRoleId(data.roleId);
      setCurrentStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card-shadow rounded-2xl border border-border bg-surface p-6">
      <div className="mb-6">
        <p className="text-sm text-blue-700">New Role Workflow</p>
        <h2 className="text-2xl font-semibold text-slate-950">
          JD Comprehension Engine
        </h2>
      </div>

      <div className="mb-8">
        <div className="mb-2 flex justify-between text-xs text-slate-600">
          <span>Progress</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-blue-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          {stepLabels.map((label, i) => {
            const stepNum = i + 1;
            const active = stepNum === currentStep;
            const complete = stepNum < currentStep;
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  if (stepNum === 1) setCurrentStep(1);
                  if (stepNum === 2 && canGoToStep2) setCurrentStep(2);
                  if (stepNum === 3 && canGoToStep3) setCurrentStep(3);
                  if (stepNum === 4 && briefing) setCurrentStep(4);
                }}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                  active
                    ? "border-blue-600 bg-blue-600 text-white"
                    : complete
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <div className="font-medium">Step {stepNum}</div>
                <div>{label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {currentStep === 1 ? (
        <form className="space-y-4" onSubmit={saveCompany}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Company Name
            </label>
            <input
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-blue-500"
              placeholder="e.g. Stripe"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Company Website URL
            </label>
            <input
              required
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-blue-500"
              placeholder="e.g. stripe.com"
            />
          </div>

          <button
            disabled={loading}
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Fetching Company Context..." : "Save and Continue"}
          </button>

          {company ? (
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
              <p className="font-medium text-blue-950">Saved Company Context</p>
              <p className="mt-1">{company.publicContext?.summary || "No summary found."}</p>
            </div>
          ) : null}
        </form>
      ) : null}

      {currentStep === 2 ? (
        <form className="space-y-4" onSubmit={saveInternalContext}>
          {[
            {
              key: "whyRoleOpen",
              label: "Why is this role open",
              required: true,
            },
            {
              key: "successIn90Days",
              label: "What does success look like in the first 90 days",
              required: true,
            },
            {
              key: "nonNegotiables",
              label: "Any non-negotiables not in the JD",
              required: true,
            },
            {
              key: "hiringManagerStyle",
              label: "Hiring manager's name and working style",
              required: true,
            },
            {
              key: "teamStructure",
              label: "Team size and structure",
              required: true,
            },
            {
              key: "whyLastPersonLeft",
              label: "Why did the last person in this role leave (optional)",
              required: false,
            },
          ].map((field) => (
            <div key={field.key}>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {field.label}
              </label>
              <textarea
                required={field.required}
                rows={3}
                value={internalContext[field.key as keyof InternalContextPayload] || ""}
                onChange={(e) =>
                  setInternalContext((prev) => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-blue-500"
              />
            </div>
          ))}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Back
            </button>
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Save and Continue
            </button>
          </div>
        </form>
      ) : null}

      {currentStep === 3 ? (
        <form className="space-y-4" onSubmit={generateBriefing}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Paste Full Job Description
            </label>
            <textarea
              required
              rows={14}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-blue-500"
              placeholder="Paste the complete JD here..."
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Generating..." : "Generate Briefing"}
            </button>
          </div>
        </form>
      ) : null}

      {currentStep === 4 && briefing ? (
        <div className="space-y-5">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            Briefing generated and saved to Supabase.
            {roleId ? ` Role ID: ${roleId}` : ""}
          </div>

          <Section title="Role Summary" content={briefing.roleSummary} />
          <SectionList
            title="Concept Definitions"
            items={briefing.conceptDefinitions}
          />
          <Section title="Ideal Profile" content={briefing.idealProfile} />
          <Section
            title="Candidate Pool Reality"
            content={briefing.candidatePoolReality}
          />
          <SectionList
            title="Search Direction - Target Companies"
            items={briefing.searchDirection.targetCompanies}
          />
          <SectionList
            title="Search Direction - Alternative Titles"
            items={briefing.searchDirection.alternativeTitles}
          />
          <SectionList
            title="Search Direction - Recommended Sourcing Channels"
            items={briefing.searchDirection.sourcingChannels}
          />
          <SectionList
            title="Key Deliverables and Metrics"
            items={briefing.keyDeliverablesAndMetrics}
          />
          <SectionList
            title="HM Meeting Prep - 5 Questions"
            items={briefing.hmMeetingPrep}
          />

          <button
            type="button"
            onClick={() => {
              setCurrentStep(1);
              setCompany(null);
              setCompanyName("");
              setWebsiteUrl("");
              setInternalContext(initialInternalContext);
              setJobDescription("");
              setBriefing(null);
              setRoleId(null);
              setError(null);
            }}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Start Another Role
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Section({ title, content }: { title: string; content: string }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-700">
        {title}
      </h3>
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-900">
        {content}
      </p>
    </article>
  );
}

function SectionList({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-700">
        {title}
      </h3>
      <ul className="space-y-2 text-sm text-slate-900">
        {items.map((item) => (
          <li key={item} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}
