"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchTendingTaskContext,
  formatTendingEffort,
  tendingBedHref,
  tendingClock,
  type TendingBedTrack,
} from "@/lib/atlas/tending-client";

export function TendingTaskContext({ taskId }: { taskId: string | null }) {
  const [bed, setBed] = useState<TendingBedTrack | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromTending = params.get("from") === "tending";
    const objectKey = params.get("bedKey");
    if (!fromTending || !taskId || !objectKey) {
      setBed(null);
      return;
    }

    let active = true;
    fetchTendingTaskContext(taskId, objectKey)
      .then((response) => { if (active) setBed(response.bed ?? null); })
      .catch(() => { if (active) setBed(null); });
    return () => { active = false; };
  }, [taskId]);

  if (!bed) return null;

  return (
    <section className="atlas-tending-task-context" aria-label="Tending harvest context">
      <div>
        <span>{bed.zoneLabel}</span>
        <strong>{bed.bedLabel} · {bed.cropLabel}</strong>
      </div>
      <dl>
        <div><dt>Unlocks</dt><dd>{bed.unlockLabel}</dd></div>
        <div><dt>Harvest</dt><dd>{tendingClock(bed)}</dd></div>
        <div><dt>Track</dt><dd>{bed.remainingGateCount} {bed.remainingGateCount === 1 ? "gate" : "gates"} remaining</dd></div>
        <div><dt>Effort</dt><dd>{formatTendingEffort(bed.taskEffortMinutes)}</dd></div>
      </dl>
      <Link href={tendingBedHref(bed)}>Open bed board</Link>
    </section>
  );
}
