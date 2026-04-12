"use client";

import { FormEvent, useState } from "react";

export default function ApplicationForm({
  roleId,
  companyName,
}: {
  roleId: string;
  companyName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.append("roleId", roleId);

    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submission failed.");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="text-4xl mb-4">🎉</div>
        <h2 className="text-xl font-semibold text-emerald-950">
          Application submitted!
        </h2>
        <p className="mt-2 text-sm text-emerald-800">
          Thank you for applying to {companyName}. We will review your
          application and be in touch soon.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950 mb-6">
        Apply for this role
      </h2>
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Full name <span className="text-red-500">*</span>
            </label>
            <input
              name="fullName"
              type="text"
              required
              disabled={busy}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
              placeholder="Your full name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              name="email"
              type="email"
              required
              disabled={busy}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
              placeholder="you@example.com"
            />
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Phone number
            </label>
            <input
              name="phone"
              type="tel"
              disabled={busy}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
              placeholder="+91 98765 43210"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              LinkedIn URL
            </label>
            <input
              name="linkedinUrl"
              type="url"
              disabled={busy}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
              placeholder="https://linkedin.com/in/yourname"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Resume (PDF) <span className="text-red-500">*</span>
          </label>
          <input
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            required
            disabled={busy}
            className="w-full text-sm file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50 disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-slate-500">PDF only, max 12MB</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Cover note{" "}
            <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea
            name="coverNote"
            rows={4}
            disabled={busy}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
            placeholder="Tell us why you are interested in this role and what makes you a great fit..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Portfolio or work sample URL{" "}
            <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            name="portfolioUrl"
            type="url"
            disabled={busy}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
            placeholder="https://github.com/you or https://yourportfolio.com"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {busy ? "Submitting application..." : "Submit application"}
        </button>
        <p className="text-center text-xs text-slate-400">
          Your information is handled securely and will only be used for this
          application.
        </p>
      </form>
    </div>
  );
}