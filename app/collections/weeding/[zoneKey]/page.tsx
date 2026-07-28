"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import TendingTaskTimeline from "@/components/atlas/tending/TendingTaskTimeline";
import {
  fetchTendingBoard,
  type TendingBoard,
} from "@/lib/atlas/tending-client";

function humanizeZoneKey(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function TendingAreaPage() {
  const params = useParams<{ zoneKey: string }>();
  const [board, setBoard] = useState<TendingBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchTendingBoard();
        if (!response.tending) throw new Error("This Tending area failed to load.");
        setBoard(response.tending);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "This Tending area failed to load.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const cards = useMemo(
    () => (board?.cards ?? []).filter((card) => card.zoneKey === params.zoneKey),
    [board, params.zoneKey],
  );
  const releasedCount = useMemo(
    () => cards.filter((track) => Boolean(track.releasedTaskId && track.currentGate)).length,
    [cards],
  );
  const zoneLabel = cards[0]?.zoneLabel ?? humanizeZoneKey(params.zoneKey);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-tending-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/collections/weeding" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Tending</span><span className="atlas-phone-title">Area tasks</span></Link>
          <span className="atlas-weather-line" aria-hidden="true" />
          <Link href="/collections/weeding" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to Tending">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-tending-body">
          <header className="atlas-tending-page-title atlas-tending-area-title">
            <div>
              <h1>{zoneLabel}</h1>
              <p>{loading ? "Loading released tasks…" : `${releasedCount} ${releasedCount === 1 ? "task" : "tasks"} released`}</p>
            </div>
          </header>

          {loading ? <div className="atlas-task-page-empty">Loading area tasks…</div> : null}
          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {!loading && !error ? (
            <TendingTaskTimeline
              tracks={cards}
              returnTo="/collections/weeding"
              showZone={false}
              emptyLabel="No Tending tasks are released in this area."
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}
