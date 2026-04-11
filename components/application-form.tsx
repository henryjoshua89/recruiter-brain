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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const fd = new FormData(e.currentTarget);
      fd.append("roleId", roleId);

      const res = await fetch("/api/apply", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <svg
            className="h-8 w-8 text-emerald-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-slate-950">
          Application received
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Thanks for applying to{" "}
          <span className="font-medium text-slate-800">{companyName}</span>.
          We&apos;ve got your details and will be in touch if there&apos;s a
          strong match.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold text-slate-950">
        Apply to {companyName}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Fields marked <span className="text-red-500">*</span> are required.
      </p>

      {error && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        {/* Full Name */}
        <div>
          <label
            htmlFor="fullName"
            className="block text-sm font-medium text-slate-700"
          >
            Full name <span className="text-red-500">*</span>
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            required
            autoComplete="name"
            placeholder="Jane Smith"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Email */}
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700"
          >
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="jane@example.com"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Phone */}
        <div>
          <label
            htmlFor="phone"
            className="block text-sm font-medium text-slate-700"
          >
            Phone{" "}
            <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+91 98765 43210"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* LinkedIn */}
        <div>
          <label
            htmlFor="linkedinUrl"
            className="block text-sm font-medium text-slate-700"
          >
            LinkedIn URL{" "}
            <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="linkedinUrl"
            name="linkedinUrl"
            type="url"
            placeholder="https://linkedin.com/in/janesmith"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Resume PDF */}
        <div>
          <label
            htmlFor="file"
            className="block text-sm font-medium text-slate-700"
          >
            Resume (PDF) <span className="text-red-500">*</span>
          </label>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept="application/pdf,.pdf"
            className="mt-1 w-full text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
          />
          <p className="mt-1 text-xs text-slate-400">PDF only · max 12 MB</p>
        </div>

        {/* Cover note */}
        <div>
          <label
            htmlFor="coverNote"
            className="block text-sm font-medium text-slate-700"
          >
            Cover note{" "}
            <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id="coverNote"
            name="coverNote"
            rows={5}
            placeholder="Tell us why you're a great fit for this role…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Portfolio */}
        <div>
          <label
            htmlFor="portfolioUrl"
            className="block text-sm font-medium text-slate-700"
          >
            Portfolio / website{" "}
            <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="portfolioUrl"
            name="portfolioUrl"
            type="url"
            placeholder="https://yoursite.com"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Submitting…" : "Submit application"}
        </button>
      </form>
    </div>
  );
}
