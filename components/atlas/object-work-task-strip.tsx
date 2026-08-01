"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchAtlasObjectWorkForTask,
  setAtlasObjectWorkStep,
  type AtlasObjectWorkItem,
} from "@/lib/atlas/object-work-client";

import styles from "./object-work-task-strip.module.css";

export default function ObjectWorkTaskStrip({ taskId }: { taskId: string }) {
  const [workItem, setWorkItem] = useState<AtlasObjectWorkItem | null>(null);
  const [savingStep, setSavingStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAtlasObjectWorkForTask(taskId)
      .then((item) => { if (active) setWorkItem(item); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Object-work context unavailable."); });
    return () => { active = false; };
  }, [taskId]);

  async function toggle(stepId: string, complete: boolean) {
    try {
      setSavingStep(stepId);
      setError(null);
      setWorkItem(await setAtlasObjectWorkStep(stepId, complete));
    } catch (stepError) {
      setError(stepError instanceof Error ? stepError.message : "Checklist update failed.");
    } finally {
      setSavingStep(null);
    }
  }

  if (!workItem) return error ? <p className={styles.error}>{error}</p> : null;

  return (
    <section className={styles.strip} aria-label="Object-first work instructions">
      <div className={styles.eyebrow}>
        <span>{workItem.actionLabel} · decided from place</span>
        <Link href={`/objects/${encodeURIComponent(workItem.object.key)}`}>{workItem.object.label} ›</Link>
      </div>
      {workItem.instructions ? <p className={styles.instruction}>{workItem.instructions}</p> : null}
      <div className={styles.result}>
        <small>Done means</small>
        <strong>{workItem.doneDefinition}</strong>
      </div>
      {workItem.unlockText ? <p className={styles.unlock}><b>Unlocks or protects:</b> {workItem.unlockText}</p> : null}
      {workItem.cropCycles.length ? (
        <div className={styles.crops}>
          {workItem.cropCycles.map((crop) => <span key={`${crop.id}:${crop.role}`}>{crop.variety ? `${crop.variety} ${crop.label}` : crop.label}</span>)}
        </div>
      ) : null}
      {workItem.steps.length ? (
        <div className={styles.steps}>
          {workItem.steps.map((step) => (
            <button key={step.id} type="button" data-complete={step.complete} disabled={savingStep === step.id} onClick={() => void toggle(step.id, !step.complete)}>
              <b aria-hidden="true">{step.complete ? "✓" : ""}</b>
              <span>{step.title}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
