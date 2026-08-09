"use client";

import { useCallback, useEffect, useState } from "react";

import OwnerDayScheduleBuilder from "@/components/atlas/owner-day-schedule-builder";
import styles from "./day-trail-summary.module.css";

type DayTrailSummaryProps = {
  completed: number;
  total: number;
  blocked: number;
  loading?: boolean;
  compact?: boolean;
};

type LivingDayPlanResponse = {
  ok?: boolean;
  plan?: {
    resolvedCount?: number;
    denominator?: number;
  };
};

type AuthoritativeProgress = {
  completed: number;
  total: number;
};

function progressPercent(completed: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

function selectedDayIso() {
  if (typeof window === "undefined") return null;
  const requested = new URLSearchParams(window.location.search).get("date");
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested;

  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function DayTrailSummary({ completed, total, blocked, loading = false, compact = false }: DayTrailSummaryProps) {
  const [authoritative, setAuthoritative] = useState<AuthoritativeProgress | null>(null);

  const refreshAuthoritativeProgress = useCallback(async () => {
    if (loading) return;
    const dateIso = selectedDayIso();
    if (!dateIso) return;

    try {
      const response = await fetch(`/api/atlas/living-day-plan?date=${encodeURIComponent(dateIso)}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;

      const body = await response.json() as LivingDayPlanResponse;
      if (!body.ok || !body.plan) return;

      const resolvedCount = finiteNumber(body.plan.resolvedCount);
      const denominator = finiteNumber(body.plan.denominator);
      if (resolvedCount === null || denominator === null || resolvedCount < 0 || denominator < 0) return;

      setAuthoritative({
        completed: Math.min(resolvedCount, denominator),
        total: denominator,
      });
    } catch {
      // Keep the locally supplied progress usable when the authoritative reader is unavailable.
    }
  }, [loading]);

  useEffect(() => {
    void refreshAuthoritativeProgress();
  }, [completed, total, refreshAuthoritativeProgress]);

  useEffect(() => {
    const refresh = () => { void refreshAuthoritativeProgress(); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshAuthoritativeProgress]);

  const progress = authoritative ?? { completed, total };
  const safeTotal = Math.max(0, progress.total);
  const safeCompleted = Math.max(0, Math.min(progress.completed, safeTotal));
  const remaining = Math.max(0, safeTotal - safeCompleted);
  const percent = progressPercent(safeCompleted, safeTotal);
  const valueText = loading
    ? "Loading day progress"
    : safeTotal
      ? `${safeCompleted} of ${safeTotal} finished`
      : "No work planned";

  return (
    <>
      <section className={`${styles.card}${compact ? ` ${styles.compact}` : ""}`} aria-label="Day progress">
        <header>
          <strong>{valueText}</strong>
          {!loading && compact && blocked > 0 ? <span>{blocked} blocked</span> : null}
        </header>

        <div
          className={styles.rail}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={safeTotal || 1}
          aria-valuenow={safeCompleted}
          aria-valuetext={valueText}
        >
          <span className={styles.fill} style={{ width: `${percent}%` }} />
        </div>

        {!compact ? (
          <footer>
            <span>{loading ? "Reading exact-date work" : safeTotal ? `${remaining} remaining` : "The day is clear"}</span>
            {!loading && blocked > 0 ? (
              <span className={styles.blocked}><i aria-hidden="true" />{blocked} blocked</span>
            ) : !loading && safeTotal > 0 ? (
              <span>Path clear</span>
            ) : null}
          </footer>
        ) : null}
      </section>
      {compact ? <OwnerDayScheduleBuilder /> : null}
    </>
  );
}