"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
type TrendPoint = { week: string; candidates: number; avgScore: number };
type SourceEntry = { source: string; count: number; pct: number };
type MissEntry = { reason: string; count: number; pct: number };
type StrategyEntry = {
  id: string;
  entryType: string;
  body: string;
  createdAt: string;
};
type DashboardData = {
  healthScore: number;
  stats: {
    total: number;
    shortlistCount: number;
    rejectCount: number;
    avgQuality: number;
    shortlistRate: number;
  };
  pipelineTrends: TrendPoint[];
  sourceSplit: SourceEntry[];
  missesLog: MissEntry[];
  strategyLog: StrategyEntry[];
  whatIsWorking: string[];
};

// ── Health Score color ────────────────────────────────────────────────────────
function healthColor(score: number) {
  if (score > 7)
    return {
      ring: "ring-emerald-400",
      text: "text-emerald-700",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      badge: "bg-emerald-100 text-emerald-800",
      label: "Strong",
    };
  if (score >= 4)
    return {
      ring: "ring-amber-400",
      text: "text-amber-700",
      bg: "bg-amber-50",
      border: "border-amber-200",
      badge: "bg-amber-100 text-amber-800",
      label: "Building",
    };
  return {
    ring: "ring-red-400",
    text: "text-red-700",
    bg: "bg-red-50",
    border: "border-red-200",
    badge: "bg-red-100 text-red-800",
    label: "Needs attention",
  };
}

const ENTRY_TYPE_STYLES: Record<
  string,
  { dot: string; badge: string; label: string }
> = {
  note: {
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-700",
    label: "Note",
  },
  decision: {
    dot: "bg-blue-500",
    badge: "bg-blue-100 text-blue-800",
    label: "Decision",
  },
  pivot: {
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-800",
    label: "Pivot",
  },
  milestone: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-800",
    label: "Milestone",
  },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function RoleDashboard({ roleId }: { roleId: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Strategy log entry form
  const [logBody, setLogBody] = useState("");
  const [logType, setLogType] = useState("note");
  const [logSaving, setLogSaving] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const logRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`/api/roles/${roleId}/dashboard`)
      .then((r) => r.json())
      .then((d: DashboardData & { error?: string }) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [roleId]);

  async function saveLogEntry() {
    if (!logBody.trim()) return;
    setLogSaving(true);
    setLogError(null);
    try {
      const res = await fetch(`/api/roles/${roleId}/dashboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_type: logType, body: logBody.trim() }),
      });
      const json = (await res.json()) as {
        entry?: StrategyEntry;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to save.");
      if (json.entry && data) {
        setData({
          ...data,
          strategyLog: [
            {
              id: json.entry.id,
              entryType: json.entry.entryType ?? logType,
              body: json.entry.body,
              createdAt: json.entry.createdAt ?? new Date().toISOString(),
            },
            ...data.strategyLog,
          ],
        });
      }
      setLogBody("");
    } catch (e) {
      setLogError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setLogSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500">Loading dashboard…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-red-600">{error ?? "Failed to load dashboard."}</p>
      </div>
    );
  }

  const hc = healthColor(data.healthScore);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <Link
            href={`/roles/${roleId}`}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
                clipRule="evenodd"
              />
            </svg>
            Back to workspace
          </Link>
          <h1 className="text-sm font-semibold text-slate-900">
            Pipeline Dashboard
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {/* ── Health Score + Stats ───────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {/* Health score */}
          <div
            className={`col-span-2 flex items-center gap-5 rounded-xl border p-5 sm:col-span-1 ${hc.bg} ${hc.border}`}
          >
            <div
              className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-4 ${hc.ring} bg-white`}
            >
              <span className={`text-2xl font-bold tabular-nums ${hc.text}`}>
                {data.healthScore.toFixed(1)}
              </span>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Health Score
              </p>
              <span
                className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${hc.badge}`}
              >
                {hc.label}
              </span>
            </div>
          </div>

          {/* Stat cards */}
          {[
            {
              label: "Total candidates",
              value: data.stats.total,
              sub: null,
            },
            {
              label: "Shortlisted",
              value: data.stats.shortlistCount,
              sub: `${data.stats.shortlistRate}% conversion`,
            },
            {
              label: "Avg role fit",
              value: `${data.stats.avgQuality}/10`,
              sub: `${data.stats.rejectCount} rejected`,
            },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-slate-200 bg-white p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {s.label}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                {s.value}
              </p>
              {s.sub ? (
                <p className="mt-0.5 text-xs text-slate-500">{s.sub}</p>
              ) : null}
            </div>
          ))}
        </section>

        {/* ── Charts row ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Volume trend */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="mb-4 text-sm font-semibold text-slate-800">
              Candidates per week
            </p>
            {data.pipelineTrends.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                No data yet
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.pipelineTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    width={24}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="candidates"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#3b82f6" }}
                    activeDot={{ r: 5 }}
                    name="Candidates"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Quality trend */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="mb-4 text-sm font-semibold text-slate-800">
              Avg role fit score per week
            </p>
            {data.pipelineTrends.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                No data yet
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.pipelineTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={[0, 10]}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    width={24}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgScore"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#10b981" }}
                    activeDot={{ r: 5 }}
                    name="Avg score"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Source split + Misses log ─────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Source bar chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="mb-4 text-sm font-semibold text-slate-800">
              Inbound vs outbound
            </p>
            {data.sourceSplit.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                No data yet
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart
                  data={data.sourceSplit}
                  layout="vertical"
                  margin={{ left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="source"
                    tick={{ fontSize: 11, fill: "#475569" }}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                    }}
                    formatter={(v) => [v, "Candidates"]}
                  />
                  <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} name="Candidates" />
                </BarChart>
              </ResponsiveContainer>
            )}
            {data.sourceSplit.length > 0 ? (
              <div className="mt-3 flex gap-4">
                {data.sourceSplit.map((s) => (
                  <div key={s.source} className="text-xs text-slate-600">
                    <span className="font-semibold">{s.pct}%</span> {s.source.toLowerCase()}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Misses log */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="mb-4 text-sm font-semibold text-slate-800">
              Reject reasons
            </p>
            {data.missesLog.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                No rejections yet
              </p>
            ) : (
              <ul className="space-y-2">
                {data.missesLog.map((m) => (
                  <li
                    key={m.reason}
                    className="relative overflow-hidden rounded-lg border border-red-100 bg-white"
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-lg bg-red-100"
                      style={{ width: `${m.pct}%` }}
                      aria-hidden="true"
                    />
                    <div className="relative flex items-center justify-between px-3 py-2">
                      <span className="text-sm text-slate-800">{m.reason}</span>
                      <span className="shrink-0 text-xs font-semibold text-slate-500">
                        {m.count} · {m.pct}%
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── What is Working ───────────────────────────────────────────── */}
        <section className="rounded-xl border border-blue-100 bg-blue-50 p-5">
          <h2 className="mb-3 text-sm font-semibold text-blue-900">
            What is working · AI summary
          </h2>
          {data.whatIsWorking.length === 0 ? (
            <p className="text-sm text-blue-700/70">
              Upload more candidates and leave feedback to generate insights.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.whatIsWorking.map((bullet, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-blue-900">
                  <span className="mt-0.5 shrink-0 text-blue-400">✓</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Strategy Timeline ─────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">
            Strategy timeline
          </h2>

          {/* Add entry form */}
          <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <select
                value={logType}
                onChange={(e) => setLogType(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700"
              >
                <option value="note">Note</option>
                <option value="decision">Decision</option>
                <option value="pivot">Pivot</option>
                <option value="milestone">Milestone</option>
              </select>
              <span className="text-xs text-slate-400">Log a strategy update</span>
            </div>
            <textarea
              ref={logRef}
              value={logBody}
              onChange={(e) => setLogBody(e.target.value)}
              rows={2}
              placeholder="e.g. Expanding search to include candidates from Tier B companies…"
              className="mt-2 w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            />
            {logError ? (
              <p className="mt-1 text-xs text-red-600">{logError}</p>
            ) : null}
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={saveLogEntry}
                disabled={logSaving || !logBody.trim()}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
              >
                {logSaving ? "Saving…" : "Save entry"}
              </button>
            </div>
          </div>

          {/* Timeline */}
          {data.strategyLog.length === 0 ? (
            <p className="text-center text-xs text-slate-400">
              No entries yet. Log your first strategy note above.
            </p>
          ) : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {data.strategyLog.map((entry) => {
                const style =
                  ENTRY_TYPE_STYLES[entry.entryType] ??
                  ENTRY_TYPE_STYLES["note"];
                return (
                  <li key={entry.id} className="relative">
                    <span
                      className={`absolute -left-[1.4375rem] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${style.dot}`}
                    />
                    <div className="flex flex-wrap items-start gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.badge}`}
                      >
                        {style.label}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(entry.createdAt).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-800">{entry.body}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}
