"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import TendingMiniTrack from "@/components/atlas/tending-mini-track";
import {
  fetchTendingBoard,
  formatTendingEffort,
  tendingBedHref,
  tendingClock,
  tendingDueLabel,
  tendingStepLabel,
  tendingStepsToHarvestLabel,
  tendingTaskHref,
  type TendingBedTrack,
  type TendingBoard,
  type TendingSectionKey,
} from "@/lib/atlas/tending-client";

const SECTIONS: Array<{ key: TendingSectionKey; label: string }> = [
  { key: "harvest_now", label: "Harvest now" },
  { key: "unlock_next", label: "Unlock next" },
  { key: "protect_harvests", label: "Protect harvests" },
  { key: "needs_a_look", label: "Needs a look" },
];

function humanizeZoneKey(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function AreaGateCard({ track }: { track: TendingBedTrack }) {
  const taskHref = tendingTaskHref(track);
  const gate = track.currentGate;
  return (
    <article className="atlas-tending-card">
      <Link href={tendingBedHref(track)} className="atlas-tending-card-head"><strong>{track.bedLabel}</strong></Link>
      <TendingMiniTrack track={track} />
      {taskHref && gate ? (
        <Link href={taskHref} className="atlas-tending-current-gate">
          <div className="atlas-tending-step-meta">
            <small>Next step</small>
            <time>{tendingDueLabel(track.taskDueDate || gate.dueDate)}</time>
          </div>
          <strong>{track.taskTitle || gate.label}</strong>
          <footer>
            <span>{tendingStepLabel(track)}</span>
            <em>unlocks {track.unlockLabel}</em>
          </footer>
        </Link>
      ) : null}
      <div className="atlas-tending-card-data">
        <span>{tendingClock(track)}</span>
        <span>{tendingStepsToHarvestLabel(track)}</span>
        <span>{formatTendingEffort(track.taskEffortMinutes)}</span>
      </div>
      <Link href={tendingBedHref(track)} className="atlas-tending-board-link">Open bed board <span aria-hidden="true">›</span></Link>
    </article>
  );
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
  const zoneLabel = cards[0]?.zoneLabel ?? humanizeZoneKey(params.zoneKey);
  const grouped = useMemo(() => {
    const groups = new Map<TendingSectionKey, TendingBedTrack[]>();
    for (const section of SECTIONS) groups.set(section.key, []);
    for (const card of cards) groups.get(card.sectionKey)?.push(card);
    return groups;
  }, [cards]);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-tending-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/collections/weeding" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Tending</span><span className="atlas-phone-title">Area board</span></Link>
          <span className="atlas-weather-line" aria-hidden="true" />
          <Link href="/collections/weeding" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to Tending">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-tending-body">
          <header className="atlas-tending-page-title atlas-tending-area-title">
            <div>
              <h1>{zoneLabel}</h1>
              <p>{loading ? "Loading open steps…" : `${cards.length} ${cards.length === 1 ? "bed" : "beds"} with a next step`}</p>
            </div>
          </header>

          {loading ? <div className="atlas-task-page-empty">Loading area board…</div> : null}
          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {!loading && !error && cards.length === 0 ? <div className="atlas-task-page-empty">No Tending steps are open in this area.</div> : null}

          {!loading && !error ? SECTIONS.map((section) => {
            const rows = grouped.get(section.key) ?? [];
            if (!rows.length) return null;
            return (
              <section key={section.key} className="atlas-tending-section" data-tending-section={section.key}>
                <header><div><span>{zoneLabel}</span><h2>{section.label}</h2></div><b>{rows.length}</b></header>
                <div className="atlas-tending-card-list">{rows.map((track) => <AreaGateCard key={`${track.bedKey}:${track.releasedTaskId}`} track={track} />)}</div>
              </section>
            );
          }) : null}
        </div>
      </section>
    </main>
  );
}
