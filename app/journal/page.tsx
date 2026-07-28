"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  LivingDayCarried,
  LivingDayCompletionSummary,
  LivingDayGoals,
  LivingDayJournal,
  LivingDayUnlocked,
} from "@/components/atlas/living-day-primitives";
import { fetchAtlasLivingDay } from "@/lib/atlas/living-day-client";
import type { AtlasLivingDay } from "@/lib/atlas/living-day-contract";

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function shiftIsoDate(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function journalHref(dateIso: string) {
  return `/journal?date=${encodeURIComponent(dateIso)}`;
}

function dayHref(dateIso: string) {
  return `/day?date=${encodeURIComponent(dateIso)}&view=work_order`;
}

function AtlasJournalPageContent() {
  const searchParams = useSearchParams();
  const dateIso = searchParams.get("date") || todayIso();
  const [livingDay, setLivingDay] = useState<AtlasLivingDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setLivingDay(await fetchAtlasLivingDay(dateIso));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Journal failed.");
    } finally {
      setLoading(false);
    }
  }, [dateIso]);

  useEffect(() => {
    void load();
  }, [load]);

  const journalEvents = useMemo(
    () => (livingDay?.journal.events ?? []).filter((event) => event.eventKind !== "unlock"),
    [livingDay],
  );
  const previousDate = shiftIsoDate(dateIso, -1);
  const nextDate = shiftIsoDate(dateIso, 1);
  const returnTo = journalHref(dateIso);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Farm Journal</span>
          </Link>
          <span className="atlas-weather-line">{prettyDate(dateIso)}</span>
          <Link href={dayHref(dateIso)} className="atlas-note-plus" aria-label="Open the task list">✓</Link>
        </header>

        <div className="atlas-journal-page-body">
          <section className="atlas-journal-page-intro">
            <span>Journal</span>
            <h1>{prettyDate(dateIso)}</h1>
            <p>Goals, carried consequences, and canonical farm changes live here. The Day page stays a clean task list.</p>
          </section>

          {loading ? <div className="atlas-journal-loading">Loading farm Journal…</div> : null}
          {error ? <div className="atlas-journal-read-error">{error}</div> : null}

          {livingDay ? <LivingDayCarried rhythms={livingDay.carriedRhythms} decisions={livingDay.ownerDecisions} returnTo={returnTo} /> : null}
          {livingDay ? <LivingDayGoals goals={livingDay.goals} returnTo={returnTo} /> : null}
          {livingDay ? <LivingDayJournal events={journalEvents} /> : null}
          {livingDay ? <LivingDayUnlocked unlocks={livingDay.unlockedToday} returnTo={returnTo} /> : null}
          {livingDay?.completionSummary.readyToShow ? <LivingDayCompletionSummary summary={livingDay.completionSummary} /> : null}

          <nav className="atlas-journal-page-actions" aria-label="Browse Journal dates">
            <Link href={journalHref(previousDate)}>← Previous</Link>
            <Link href={dayHref(dateIso)} className="atlas-journal-day-link">Task list</Link>
            <Link href={journalHref(nextDate)}>Next →</Link>
          </nav>
        </div>
      </section>
    </main>
  );
}

function JournalPageFallback() {
  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <div className="atlas-journal-page-body">
          <div className="atlas-journal-loading">Loading farm Journal…</div>
        </div>
      </section>
    </main>
  );
}

export default function AtlasJournalPage() {
  return (
    <Suspense fallback={<JournalPageFallback />}>
      <AtlasJournalPageContent />
    </Suspense>
  );
}
