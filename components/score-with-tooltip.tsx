"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { ScoreBreakdown } from "@/lib/types";

type Variant = "jd" | "role";

const emptySubscribe = () => () => {};

function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export default function ScoreWithTooltip({
  variant,
  score,
  breakdown,
  compact,
}: {
  variant: Variant;
  score: number;
  breakdown: ScoreBreakdown;
  compact?: boolean;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const mounted = useIsClient();
  const [visible, setVisible] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = variant === "jd" ? "JD fit score" : "Role fit score";
  const accent =
    variant === "jd"
      ? "border-blue-200 text-blue-950"
      : "border-emerald-200 text-emerald-950";

  const clearHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHide();
    hideTimerRef.current = setTimeout(() => {
      setFadeIn(false);
      setTimeout(() => setVisible(false), 200);
    }, 120);
  }, [clearHide]);

  const show = useCallback(() => {
    clearHide();
    setVisible(true);
    requestAnimationFrame(() => setFadeIn(true));
  }, [clearHide]);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    const tip = tooltipRef.current;
    if (!el || !tip) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const tipRect = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(margin, Math.min(left, vw - tipRect.width - margin));

    let top = rect.bottom + margin;
    if (top + tipRect.height > vh - margin) {
      top = rect.top - tipRect.height - margin;
    }
    top = Math.max(margin, top);

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    updatePosition();
    const id = requestAnimationFrame(() => updatePosition());
    return () => cancelAnimationFrame(id);
  }, [visible, updatePosition]);

  useEffect(() => {
    if (!visible) return;
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [visible, updatePosition]);

  useEffect(() => () => clearHide(), [clearHide]);

  const tooltip =
    mounted && visible ? (
      <div
        ref={tooltipRef}
        role="tooltip"
        className={`fixed z-[9999] w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200 bg-white p-4 text-left text-sm shadow-lg transition-opacity duration-200 ease-out ${
          fadeIn ? "opacity-100" : "opacity-0"
        }`}
        style={{ pointerEvents: fadeIn ? "auto" : "none" }}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
      >
        <p className={`border-b pb-2 text-xs font-semibold uppercase tracking-wide ${accent}`}>
          {title} — how we scored
        </p>
        <div className="mt-3 space-y-3 text-slate-800">
          <div>
            <p className="text-xs font-semibold text-emerald-800">
              What worked in their favour
            </p>
            <ul className="mt-1 list-inside list-disc space-y-1 text-xs leading-relaxed">
              {breakdown.strengths.slice(0, 3).map((s, i) => (
                <li key={`s-${i}`}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-amber-900">
              What pulled the score down
            </p>
            <ul className="mt-1 list-inside list-disc space-y-1 text-xs leading-relaxed">
              {breakdown.weaknesses.slice(0, 3).map((w, i) => (
                <li key={`w-${i}`}>{w}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-600">
              Biggest factor in this score
            </p>
            <p className="mt-1 text-xs font-medium leading-relaxed text-slate-900">
              {breakdown.biggestFactor}
            </p>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={`inline-flex cursor-help underline decoration-dotted decoration-slate-400 underline-offset-2 transition-colors hover:decoration-slate-600 ${
          compact ? "font-semibold" : "text-xl font-semibold"
        } ${variant === "jd" ? "text-blue-950" : "text-emerald-950"}`}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        tabIndex={0}
        onFocus={show}
        onBlur={scheduleHide}
      >
        {score}/10
      </span>
      {mounted && tooltip ? createPortal(tooltip, document.body) : null}
    </>
  );
}
