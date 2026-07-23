"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  fetchTendingTaskContext,
  formatTendingEffort,
  tendingBedHref,
  tendingClock,
  type TendingBedTrack,
} from "@/lib/atlas/tending-client";

export default function TendingTaskContext() {
  const [bed, setBed] = useState<TendingBedTrack | null>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (window.location.pathname !== "/task") return;
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("taskId");
    const objectKey = params.get("bedKey");
    if (params.get("from") !== "tending" || !taskId || !objectKey) return;

    let active = true;
    let host: HTMLDivElement | null = null;
    const attach = () => {
      const taskBody = document.querySelector<HTMLElement>(".atlas-task-page-body");
      if (!taskBody || host) return false;
      host = document.createElement("div");
      host.className = "atlas-tending-task-context-host";
      taskBody.prepend(host);
      setMount(host);
      return true;
    };

    if (!attach()) {
      const observer = new MutationObserver(() => { if (attach()) observer.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(() => observer.disconnect(), 5000);
    }

    fetchTendingTaskContext(taskId, objectKey)
      .then((response) => { if (active) setBed(response.bed ?? null); })
      .catch(() => { if (active) setBed(null); });

    return () => {
      active = false;
      host?.remove();
      setMount(null);
      setBed(null);
    };
  }, []);

  if (!mount || !bed) return null;

  return createPortal(
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
    </section>,
    mount,
  );
}
