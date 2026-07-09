"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchAtlasCloseout, type AtlasCloseoutSummary } from "@/lib/atlas/closeout-client";
import { atlasCleanLabel } from "@/lib/atlas/task-display";

function dateFromIso(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`);
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "unknown";
  const date = dateIso.includes("-") ? dateFromIso(dateIso) : new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CloseoutCard({ summary }: { summary: AtlasCloseoutSummary }) {
  return (
    <article className="atlas-closeout-card tidy">
      <div className="atlas-closeout-card-head">
        <strong>{summary.label}</strong>
        <span>{prettyDate(summary.startDate)}–{prettyDate(summary.endDate)}</span>
      </div>
      <div className="atlas-closeout-pill-row soft">
        <span>{summary.counts.objectEvents} records</span>
        <span>{summary.counts.openTasks} open</span>
        <span>{summary.counts.tasksBlocked} blocked</span>
      </div>
      {summary.carryForward.length > 0 ? (
        <div className="atlas-closeout-section carry">
          <span>Carry forward</span>
          {summary.carryForward.map((line) => <p key={line}>{atlasCleanLabel(line)}</p>)}
        </div>
      ) : null}
    </article>
  );
}

export default function AtlasCloseoutPage() {
  const [summaries, setSummaries] = useState<AtlasCloseoutSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCloseout() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchAtlasCloseout();
        setSummaries(response.summaries ?? []);
      } catch (closeoutError) {
        setError(closeoutError instanceof Error ? closeoutError.message : "Closeout failed to load.");
      } finally {
        setLoading(false);
      }
    }

    void loadCloseout();
  }, []);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Closeout</span>
          </Link>
          <Link href="/" className="atlas-note-plus" aria-label="Back to Atlas home">×</Link>
        </header>

        <div className="atlas-task-page-body">
          <section className="atlas-task-page-section">
            <div className="atlas-task-page-section-head">
              <span>Closeout</span>
              <small>{loading ? "Loading" : `${summaries.length} views`}</small>
            </div>
            {loading ? <div className="atlas-task-page-empty">Loading closeout.</div> : null}
            {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
            {!loading && !error && summaries.length === 0 ? <div className="atlas-task-page-empty">No closeout records yet.</div> : null}
            <div className="atlas-closeout-grid">
              {summaries.map((summary) => <CloseoutCard summary={summary} key={summary.period} />)}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
