"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  fetchTendingBoard,
  formatTendingEffort,
  prettyTendingDate,
  tendingBedHref,
  tendingClock,
  tendingTaskHref,
  type TendingBedTrack,
  type TendingBoard,
  type TendingSectionKey,
} from "@/lib/atlas/tending-client";

const SECTIONS: Array<{ key: TendingSectionKey; label: string; detail: string }> = [
  { key: "harvest_now", label: "Harvest now", detail: "Open harvest gates" },
  { key: "unlock_next", label: "Unlock next", detail: "Moves that open a crop track" },
  { key: "protect_harvests", label: "Protect harvests", detail: "Moves that preserve an active crop" },
  { key: "needs_a_look", label: "Needs a look", detail: "Checks that advance the bed" },
];

function GateCard({ track }: { track: TendingBedTrack }) {
  const taskHref = tendingTaskHref(track);
  const bedHref = tendingBedHref(track);
  const gate = track.currentGate;

  return (
    <article className="atlas-tending-card">
      <Link href={bedHref} className="atlas-tending-card-head">
        <span>{track.zoneLabel}</span>
        <strong>{track.bedLabel}</strong>
      </Link>
      {taskHref && gate ? (
        <Link href={taskHref} className="atlas-tending-current-gate">
          <small>Current gate</small>
          <strong>{gate.label.toUpperCase()}</strong>
          <span>unlocks {track.unlockLabel}</span>
        </Link>
      ) : null}
      <div className="atlas-tending-card-data">
        <span>{tendingClock(track)}</span>
        <span>{track.remainingGateCount} {track.remainingGateCount === 1 ? "gate" : "gates"} remaining</span>
        <span>{formatTendingEffort(track.taskEffortMinutes)}</span>
      </div>
      <Link href={bedHref} className="atlas-tending-board-link">Open bed board <span aria-hidden="true">›</span></Link>
    </article>
  );
}

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

  const grouped = useMemo(() => {
    const groups = new Map<TendingSectionKey, TendingBedTrack[]>();
    for (const section of SECTIONS) groups.set(section.key, []);
    for (const card of board?.cards ?? []) groups.get(card.sectionKey)?.push(card);
    return groups;
  }, [board]);

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
          <section className="atlas-overview-hero atlas-tending-hero">
            <div><span>Elm Farm</span><strong>Tending</strong></div>
            <p>{loading ? "Loading open gates…" : `${board?.bedCount ?? 0} beds · ${board?.actionableCount ?? 0} open gates`}</p>
            {!loading && board?.nextHarvestOn ? <footer><span>Next harvest</span><strong>{prettyTendingDate(board.nextHarvestOn)}</strong></footer> : null}
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading Tending…</div> : null}

          {!loading && board && board.cards.length === 0 ? (
            <div className="atlas-task-page-empty">No Tending gates are open.</div>
          ) : null}

          {!loading && board ? SECTIONS.map((section) => {
            const cards = grouped.get(section.key) ?? [];
            if (!cards.length) return null;
            return (
              <section key={section.key} className="atlas-tending-section" data-tending-section={section.key}>
                <header>
                  <div><span>{section.detail}</span><h2>{section.label}</h2></div>
                  <b>{cards.length}</b>
                </header>
                <div className="atlas-tending-card-list">{cards.map((track) => <GateCard key={`${track.bedKey}:${track.releasedTaskId}`} track={track} />)}</div>
              </section>
            );
          }) : null}
        </div>
      </section>
    </main>
  );
}
