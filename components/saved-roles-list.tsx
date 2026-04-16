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
  const [deleteTarget, setDeleteTarget] = useState<RoleListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
    return () => { cancelled = true; };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/roles/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Delete failed.");
      }
      setRoles((prev) => prev?.filter((r) => r.id !== deleteTarget.id) ?? prev);
      setDeleteTarget(null);
      showToast("Role deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete role.");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

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
    <>
      {/* Delete confirmation modal */}
      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => { if (!deleting) setDeleteTarget(null); }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-950">Delete this role?</h3>
            <p className="mt-2 text-sm text-slate-700">
              This will permanently delete{" "}
              <span className="font-medium">{deleteTarget.jobDescriptionPreview.slice(0, 60) || "this role"}</span>{" "}
              at <span className="font-medium">{deleteTarget.companyName}</span> including all candidates,
              feedback, and annotations. This cannot be undone.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Success toast */}
      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800 shadow-lg">
          ✓ {toast}
        </div>
      ) : null}

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
            <li key={r.id} className="group relative">
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
                      {r.jobDescriptionPreview}…
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-medium text-blue-700">
                  Open role →
                </span>
              </Link>

              {/* Delete button — visible on hover */}
              <button
                type="button"
                title="Delete role"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeleteTarget(r);
                }}
                className="absolute right-14 top-1/2 -translate-y-1/2 rounded-lg border border-red-200 bg-white p-1.5 text-red-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}
