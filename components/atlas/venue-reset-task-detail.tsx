"use client";

import { useEffect, useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import styles from "@/components/atlas/venue-reset-task-detail.module.css";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard, AtlasTaskCardResourceRequirement } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type ChecklistItem = {
  itemId: string;
  itemKey: string;
  sectionKey: string;
  sectionLabel: string;
  label: string;
  sortOrder: number;
  required: boolean;
  checked: boolean;
  checkedAt: string | null;
};

type ExecutionChecklist = {
  taskId: string;
  title: string;
  completionLabel: string;
  items: ChecklistItem[];
  totalCount: number;
  completeCount: number;
  ready: boolean;
};

type ChecklistResponse = {
  ok?: boolean;
  checklist?: ExecutionChecklist;
  error?: string | { message?: string };
  details?: string;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function prettyDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(date);
}

function humanize(value: string | null | undefined) {
  return (value || "reset").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function returnDestination(fallback: string) {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

function completeTaskExit(taskId: string, fallback: string) {
  const returnTo = returnDestination(fallback);
  const event = new CustomEvent("atlas:task-completed", { cancelable: true, detail: { taskId, returnTo } });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) window.location.assign(returnTo);
}

function requestError(data: ChecklistResponse) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  return data.error?.message || "Atlas could not update this reset.";
}

function requestKey(taskId: string, itemKey: string, checked: boolean) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${taskId}:${itemKey}:${checked ? "checked" : "reopened"}:${nonce}`;
}

async function readChecklist(taskId: string) {
  const response = await fetch(`/api/atlas/task-execution-checklist?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await response.json() as ChecklistResponse;
  if (!response.ok || !data.ok || !data.checklist) throw new Error(requestError(data));
  return data.checklist;
}

async function writeChecklistItem(taskId: string, itemKey: string, checked: boolean) {
  const response = await fetch("/api/atlas/task-execution-checklist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "task-execution-checklist-v1",
    },
    cache: "no-store",
    body: JSON.stringify({ taskId, itemKey, checked, idempotencyKey: requestKey(taskId, itemKey, checked) }),
  });
  const data = await response.json() as ChecklistResponse;
  if (!response.ok || !data.ok || !data.checklist) throw new Error(requestError(data));
  return data.checklist;
}

function resourceAmount(resource: AtlasTaskCardResourceRequirement) {
  if (resource.quantity_needed === null || resource.quantity_needed === undefined) return null;
  const quantity = Number(resource.quantity_needed);
  if (!Number.isFinite(quantity)) return null;
  return `${quantity}${resource.unit ? ` ${resource.unit}` : ""}`;
}

export default function VenueResetTaskDetail({ task, assignee }: Props) {
  const [checklist, setChecklist] = useState<ExecutionChecklist | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChecklist(null);
    setMessage(null);
    void readChecklist(task.task_id)
      .then((value) => { if (!cancelled) setChecklist(value); })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Reset work unavailable."); });
    return () => { cancelled = true; };
  }, [task.task_id]);

  const items = useMemo(
    () => (checklist?.items ?? []).slice().sort((left, right) => left.sortOrder - right.sortOrder),
    [checklist],
  );
  const resources = task.resource_requirements ?? [];
  const location = text(task.metadata?.venue_reset_location_label) || text(task.zone_label) || "Elm Farm";
  const readyLabel = text(task.metadata?.venue_reset_ready_label) || "Venue ready";
  const readyResult = text(task.metadata?.venue_reset_ready_result) || text(task.metadata?.execution_done_when) || "Location restored to its ready condition.";
  const subject = text(task.metadata?.display_subject) || location;
  const resetWork = text(task.metadata?.execution_do) || task.title;

  async function toggle(item: ChecklistItem) {
    const nextChecked = !item.checked;
    try {
      setSaving(item.itemKey);
      setMessage(null);
      setChecklist((current) => current ? {
        ...current,
        items: current.items.map((candidate) => candidate.itemKey === item.itemKey ? { ...candidate, checked: nextChecked } : candidate),
      } : current);
      setChecklist(await writeChecklistItem(task.task_id, item.itemKey, nextChecked));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reset work update failed.");
      try { setChecklist(await readChecklist(task.task_id)); } catch { /* keep last known state */ }
    } finally {
      setSaving(null);
    }
  }

  async function transition(kind: "done" | "partial" | "blocked") {
    const note = kind === "blocked"
      ? window.prompt("What problem did you find?", "")?.trim()
      : undefined;
    if (kind === "blocked" && !note) return;

    try {
      setSaving(kind);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: kind,
        note,
        reason: note,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: {
          venueResetFamily: true,
          venueResetVersion: 1,
          completion_source: kind === "done" ? "venue_reset_parent_attestation" : "venue_reset_card",
          checklistCompleteBeforeClose: checklist?.ready === true,
        },
      });

      if (kind === "done") completeTaskExit(task.task_id, assignee.listPath);
      else window.location.assign(returnDestination(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reset result failed.");
    } finally {
      setSaving(null);
    }
  }

  const busy = Boolean(saving);
  const completion = (
    <div className={styles.finish}>
      <div className={styles.finishButtons}>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void transition("done")}>Done</button>
        <button type="button" disabled={busy} onClick={() => setUnfinishedOpen((open) => !open)}>Unfinished</button>
      </div>
      {unfinishedOpen ? (
        <div className={styles.unfinished}>
          <strong>What happened?</strong>
          <div className={styles.finishButtons}>
            <button type="button" disabled={busy} onClick={() => void transition("partial")}>Partly done</button>
            <button type="button" disabled={busy} onClick={() => void transition("blocked")}>Problem found</button>
          </div>
        </div>
      ) : null}
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );

  return (
    <main className={styles.shell} data-atlas-venue-reset="v1">
      <AtlasTaskCardFrame
        family="Venue"
        familyDetail="reset"
        title={subject}
        subtitle={humanize(task.action_key)}
        timing={task.due_date ? `Due ${prettyDate(task.due_date)}` : undefined}
        completion={completion}
      >
        <section className={styles.section}>
          <span className={styles.kicker}>Location</span>
          <div className={styles.location}>
            <strong>{location}</strong>
            <span>{humanize(task.action_key)}</span>
          </div>
        </section>

        <section className={styles.section}>
          <span className={styles.kicker}>Resources</span>
          <div className={styles.resources}>
            {resources.length ? resources.map((resource) => (
              <div className={styles.resource} key={resource.requirement_id}>
                <div>
                  <strong>{resource.resource_label || resource.resource_key || "Resource"}</strong>
                  <small>{resource.requirement_role === "required" ? "Required" : humanize(resource.requirement_role)}</small>
                </div>
                <div className={styles.resourceMeta}>
                  {resourceAmount(resource) ? <strong>{resourceAmount(resource)}</strong> : null}
                  <small>{humanize(resource.status || resource.resource_status)}</small>
                </div>
              </div>
            )) : (
              <div className={styles.emptyResource} data-atlas-reset-resource-gap="true">
                <strong>No resources attached</strong>
                <small>Atlas resource set is empty</small>
              </div>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <span className={styles.kicker}>Reset work</span>
          <h3 className={styles.workHeading}>{resetWork}</h3>
          <div className={styles.workRail}>
            {items.map((item) => {
              const id = `venue-reset-${task.task_id}-${item.itemKey}`;
              return (
                <label className={styles.workRow} key={item.itemKey} htmlFor={id}>
                  <input id={id} type="checkbox" checked={item.checked} disabled={busy} onChange={() => void toggle(item)} />
                  <span className={styles.circle} aria-hidden="true" />
                  <strong>{item.label}</strong>
                </label>
              );
            })}
          </div>
        </section>

        <section className={styles.ready} aria-label={readyLabel}>
          <span>{readyLabel}</span>
          <strong>{readyResult}</strong>
        </section>
      </AtlasTaskCardFrame>
    </main>
  );
}
