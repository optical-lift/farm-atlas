"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchAtlasObjectWorkForTask,
  type AtlasObjectWorkItem,
} from "@/lib/atlas/object-work-client";

import styles from "./object-work-task-strip.module.css";

export default function ObjectWorkTaskStrip({ taskId }: { taskId: string }) {
  const [workItem, setWorkItem] = useState<AtlasObjectWorkItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAtlasObjectWorkForTask(taskId)
      .then((item) => { if (active) setWorkItem(item); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Object-work context unavailable."); });
    return () => { active = false; };
  }, [taskId]);

  if (!workItem) return error ? <p className={styles.error}>{error}</p> : null;

  const currentTruth = workItem.currentTruth || "The starting truth was not recorded on this older card.";
  const afterTruth = workItem.afterTruth || workItem.doneDefinition;

  return (
    <section className={styles.strip} aria-label="Prepared task state change">
      <div className={styles.eyebrow}>
        <span>{workItem.actionLabel} · state change</span>
        <Link href={`/objects/${encodeURIComponent(workItem.object.key)}`}>{workItem.object.label} ›</Link>
      </div>

      <div className={styles.transition}>
        <div>
          <small>Current truth</small>
          <strong>{currentTruth}</strong>
        </div>
        <b aria-hidden="true">→</b>
        <div>
          <small>After Done</small>
          <strong>{afterTruth}</strong>
        </div>
      </div>

      {workItem.unlockText ? <p className={styles.unlock}><b>Unlocks or protects:</b> {workItem.unlockText}</p> : null}
      {workItem.cropCycles.length ? (
        <div className={styles.crops}>
          {workItem.cropCycles.map((crop) => <span key={`${crop.id}:${crop.role}`}>{crop.variety ? `${crop.variety} ${crop.label}` : crop.label}</span>)}
        </div>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
