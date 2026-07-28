"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import TendingTaskTimeline from "@/components/atlas/tending/TendingTaskTimeline";
import {
  fetchTendingBoard,
  prettyTendingDate,
  type TendingBoard,
} from "@/lib/atlas/tending-client";

export default function TendingCollectionPage() {
  const [board, setBoard] = useState<TendingBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchTendingBoard();
        if (!response.tending) throw new Error("Tending failed to load.");
        setBoard(response.tending);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Tending failed to load.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const releasedCount = useMemo(
    () => (board?.cards ?? []).filter((track) => Boolean(track.releasedTaskId && track.currentGate)).length,
    [board],
  );

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-tending-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Tending</span>
          </Link>
          <span className="atlas-weather-line" aria-hidden="true" />
          <Link href="/day" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-tending-body">
          <header className="atlas-tending-page-title">
            <div>
              <h1>Tending</h1>
              <p>{loading ? "Loading released tasks…" : `${releasedCount} ${releasedCount === 1 ? "task" : "tasks"} released`}</p>
            </div>
            {!loading && board?.nextHarvestOn ? (
              <span><small>Next harvest</small><strong>{prettyTendingDate(board.nextHarvestOn)}</strong></span>
            ) : null}
          </header>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading Tending…</div> : null}

          {!loading && board ? (
            <TendingTaskTimeline
              tracks={board.cards}
              returnTo="/collections/weeding"
              emptyLabel="No Tending tasks are released. Crop Trails remain visible on their bed pages."
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}
