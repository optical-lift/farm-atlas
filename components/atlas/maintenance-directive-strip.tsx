"use client";

import { useEffect, useState } from "react";

import {
  fetchAtlasMaintenanceDirectivesForTask,
  setAtlasMaintenanceDirectiveStep,
  type AtlasMaintenanceDirective,
} from "@/lib/atlas/maintenance-directives-client";

import styles from "./maintenance-directive-strip.module.css";

function effectLine(directive: AtlasMaintenanceDirective) {
  if (directive.directiveKind === "prerequisite") return "This must be finished before the maintenance card can proceed.";
  if (directive.effectPolicy === "bring_forward_only") return "Completing this instruction does not automatically reset the normal maintenance clock.";
  if (directive.effectPolicy === "inspection_only") return "Record what is physically true; inspection alone does not claim maintenance happened.";
  if (directive.effectPolicy === "full_maintenance") return directive.maintenanceKind === "weed"
    ? "This instruction stays active until the bed is recorded Clear."
    : "This instruction stays active until the route is recorded Mowed fully.";
  return `This instruction stays active until the bed reaches ${directive.targetCondition?.replaceAll("_", " ") || "its target condition"}.`;
}

export default function MaintenanceDirectiveStrip({ taskId }: { taskId: string }) {
  const [directives, setDirectives] = useState<AtlasMaintenanceDirective[]>([]);
  const [savingStepId, setSavingStepId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAtlasMaintenanceDirectivesForTask(taskId)
      .then((data) => { if (active) setDirectives(data); })
      .catch(() => { if (active) setDirectives([]); });
    return () => { active = false; };
  }, [taskId]);

  async function toggleStep(directiveId: string, stepId: string, complete: boolean) {
    try {
      setSavingStepId(stepId);
      setMessage(null);
      const updated = await setAtlasMaintenanceDirectiveStep(stepId, complete);
      setDirectives((current) => current.map((directive) => directive.id === directiveId ? updated : directive));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not update this checklist step.");
    } finally {
      setSavingStepId(null);
    }
  }

  if (!directives.length) return null;

  return (
    <section className={styles.wrap} aria-label="Attached maintenance instructions">
      {directives.map((directive) => (
        <article key={directive.id} className={styles.card} data-kind={directive.directiveKind}>
          <header>
            <span>{directive.directiveKind === "prerequisite" ? "Waiting for prerequisite" : "Owner instruction"}</span>
            <small>{directive.assignee.displayName}</small>
          </header>
          <h2>{directive.title}</h2>
          {directive.instructions ? <p>{directive.instructions}</p> : null}
          {directive.cropCycles.length ? (
            <div className={styles.crops} aria-label="Attached crop cycles">
              {directive.cropCycles.map((crop) => (
                <span key={`${crop.id}:${crop.role}`}>{crop.variety ? `${crop.variety} ${crop.label}` : crop.label}</span>
              ))}
            </div>
          ) : null}
          {directive.steps.length ? (
            <div className={styles.steps} aria-label="Instruction checklist">
              {directive.steps.map((step) => (
                <label key={step.id} data-complete={step.complete}>
                  <input
                    type="checkbox"
                    checked={step.complete}
                    disabled={savingStepId === step.id}
                    onChange={(event) => void toggleStep(directive.id, step.id, event.target.checked)}
                  />
                  <span>{step.title}</span>
                </label>
              ))}
            </div>
          ) : null}
          <footer>{effectLine(directive)}</footer>
        </article>
      ))}
      {message ? <p className={styles.message}>{message}</p> : null}
    </section>
  );
}
