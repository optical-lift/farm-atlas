"use client";

import Link from "next/link";
import { useMemo } from "react";

import {
  formatTendingEffort,
  tendingBedHref,
  tendingClock,
  tendingDueLabel,
  tendingStepLabel,
  tendingStepsToHarvestLabel,
  tendingTaskHref,
  type TendingBedTrack,
  type TendingSectionKey,
} from "@/lib/atlas/tending-client";

type Props = {
  tracks: TendingBedTrack[];
  returnTo: string;
  showZone?: boolean;
  emptyLabel?: string;
};

const SECTIONS: Array<{ key: TendingSectionKey; label: string; detail: string }> = [
  { key: "harvest_now", label: "Harvest now", detail: "Released harvest work" },
  { key: "unlock_next", label: "Unlock next", detail: "Released work that opens the next crop move" },
  { key: "protect_harvests", label: "Protect harvests", detail: "Released care for active crops" },
  { key: "needs_a_look", label: "Needs a look", detail: "Released observation work" },
];

function taskState(track: TendingBedTrack) {
  const status = track.currentGate?.status;
  if (status === "blocked") return "blocked";
  if (status === "complete" || status === "skipped") return "complete";
  return "current";
}

function locationLine(track: TendingBedTrack, showZone: boolean) {
  return showZone
    ? `${track.zoneLabel} · ${track.bedLabel} · ${track.cropLabel}`
    : `${track.bedLabel} · ${track.cropLabel}`;
}

export default function TendingTaskTimeline({
  tracks,
  returnTo,
  showZone = true,
  emptyLabel = "No Tending tasks are released.",
}: Props) {
  const released = useMemo(
    () => tracks.filter((track) => Boolean(track.releasedTaskId && track.currentGate)),
    [tracks],
  );
  const grouped = useMemo(() => {
    const groups = new Map<TendingSectionKey, TendingBedTrack[]>();
    for (const section of SECTIONS) groups.set(section.key, []);
    for (const track of released) groups.get(track.sectionKey)?.push(track);
    return groups;
  }, [released]);

  if (!released.length) return <div className="atlas-task-page-empty">{emptyLabel}</div>;

  return (
    <div className="atlas-tending-task-timelines" aria-label="Tending task collection">
      {SECTIONS.map((section) => {
        const rows = grouped.get(section.key) ?? [];
        if (!rows.length) return null;

        return (
          <section
            key={section.key}
            className="atlas-project-task-collection atlas-tending-task-collection"
            data-tending-section={section.key}
          >
            <div className="atlas-project-task-collection-head atlas-tending-task-collection-head">
              <div>
                <span>{section.detail}</span>
                <h2>{section.label}</h2>
              </div>
              <strong>{rows.length} {rows.length === 1 ? "task" : "tasks"}</strong>
            </div>

            <div className="atlas-day-route-spine atlas-tending-route-spine" aria-label={`${section.label} task timeline`}>
              {rows.map((track) => {
                const state = taskState(track);
                const complete = state === "complete";
                const current = state === "current" || state === "blocked";
                const href = tendingTaskHref(track, returnTo);
                if (!href) return null;

                return (
                  <div
                    key={`${track.bedKey}:${track.releasedTaskId}`}
                    className={`atlas-day-task-entry atlas-tending-task-entry atlas-day-route-${state}${complete ? " atlas-day-complete-entry" : ""}`}
                  >
                    <span className={`atlas-day-task-node atlas-tending-task-node${complete ? " is-complete" : ""}`} aria-hidden="true"><span /></span>
                    <Link
                      className={`atlas-day-task-card atlas-tending-task-card atlas-day-route-${state}${complete ? " complete" : ""}`}
                      href={href}
                      aria-current={current ? "step" : undefined}
                    >
                      <small className="atlas-day-task-family">
                        {state === "blocked" ? `Blocked · ${section.label}` : complete ? `Complete · ${section.label}` : `Current · ${section.label}`}
                      </small>
                      <strong>{track.taskTitle || track.currentGate?.label || "Open Tending task"}</strong>
                      <span>{locationLine(track, showZone)}</span>
                      <em>{tendingDueLabel(track.taskDueDate || track.currentGate?.dueDate)} · {tendingStepLabel(track)} · unlocks {track.unlockLabel}</em>
                      <span className="atlas-day-task-cues">
                        <i>{tendingClock(track)}</i>
                        <i>{tendingStepsToHarvestLabel(track)}</i>
                        <i>{formatTendingEffort(track.taskEffortMinutes)}</i>
                      </span>
                    </Link>
                    <Link className="atlas-tending-task-context-link" href={tendingBedHref(track)}>Open bed context</Link>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
