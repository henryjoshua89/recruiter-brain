"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type RoleListItem = {
  id: string;
  createdAt: string;
  companyName: string;
  candidateCount: number;
  jobDescriptionPreview: string;
};

export default function SavedRolesList() {
  const [roles, setRoles] = useState<RoleListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/roles");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load roles.");
        if (!cancelled) setRoles(data.roles ?? []);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load roles.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section className="card-shadow mb-8 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        {error}
      </section>
    );
  }

  if (roles === null) {
    return (
      <section className="card-shadow mb-8 rounded-2xl border border-border bg-surface p-6 text-sm text-slate-600">
        Loading saved roles…
      </section>
    );
  }

  if (roles.length === 0) {
    return (
      <section className="card-shadow mb-8 rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-slate-950">Saved roles</h2>
        <p className="mt-2 text-sm text-slate-600">
          No roles yet. Complete the intake below to create your first briefing,
          then open it here for resume analysis.
        </p>
      </section>
    );
  }

  return (
    <section className="card-shadow mb-8 rounded-2xl border border-border bg-surface p-6">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Saved roles</h2>
          <p className="text-sm text-slate-600">
            Phase 1 briefings — open a role for the Candidates workspace.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {roles.map((r) => (
          <li key={r.id}>
            <Link
              href={`/roles/${r.id}`}
              className="flex flex-col gap-2 px-4 py-4 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-slate-950">{r.companyName}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {new Date(r.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}{" "}
                  · {r.candidateCount} candidate
                  {r.candidateCount === 1 ? "" : "s"}
                </p>
                {r.jobDescriptionPreview ? (
                  <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                    {r.jobDescriptionPreview}
                    …
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 text-sm font-medium text-blue-700">
                Open role →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
