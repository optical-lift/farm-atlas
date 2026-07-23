"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import TendingMiniTrack from "@/components/atlas/tending-mini-track";
import {
  fetchTendingTaskContext,
  formatTendingEffort,
  tendingBedHref,
  tendingClock,
  tendingDueLabel,
  tendingStepLabel,
  tendingStepsToHarvestLabel,
  type TendingBedTrack,
} from "@/lib/atlas/tending-client";

type Props = {
  taskId: string;
  objectKey: string;
};

export default function TendingTaskTrailPanel({ taskId, objectKey }: Props) {
  const [track, setTrack] = useState<TendingBedTrack | null>(null);

  useEffect(() => {
    let active = true;
    fetchTendingTaskContext(taskId, objectKey)
      .then((response) => {
        if (active) setTrack(response.bed ?? null);
      })
      .catch(() => {
        if (active) setTrack(null);
      });
    return () => {
      active = false;
    };
  }, [objectKey, taskId]);

  if (!track) return null;

  return (
    <section className="atlas-task-tending-trail" aria-label={`${track.bedLabel} path to harvest`}>
      <header>
        <div>
          <small>{track.zoneLabel}</small>
          <strong>{track.bedLabel}</strong>
        </div>
        <span>{track.cropLabel}</span>
      </header>

      <TendingMiniTrack track={track} />

      <div className="atlas-task-tending-now">
        <span>{tendingStepLabel(track)}</span>
        <strong>{tendingDueLabel(track.taskDueDate || track.currentGate?.dueDate)}</strong>
        <em>opens {track.unlockLabel}</em>
      </div>

      <footer>
        <span>{tendingClock(track)}</span>
        <span>{tendingStepsToHarvestLabel(track)}</span>
        <span>{formatTendingEffort(track.taskEffortMinutes)}</span>
        <Link href={tendingBedHref(track)}>Open bed board</Link>
      </footer>
    </section>
  );
}
