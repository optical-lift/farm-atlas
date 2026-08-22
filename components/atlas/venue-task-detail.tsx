"use client";

import { useEffect, useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import rail from "@/components/atlas/task-card-venue-rail.module.css";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type ChecklistItem = {
  itemId: string;
  itemKey: string;
  sectionKey?: string | null;
  sectionLabel?: string | null;
  label: string;
  sortOrder: number;
  required: boolean;
  checked: boolean;
  checkedAt: string | null;
  crossedOut?: boolean;
  interaction?: string | null;
  stationLocation?: string | null;
  restockLabel?: string | null;
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

type VenueStage = "tidy" | "prep" | "host" | "reset";

const TRAIL: Array<{ key: VenueStage; label: string }> = [
  { key: "tidy", label: "Tidy" },
  { key: "prep", label: "Prep" },
  { key: "host", label: "Host" },
  { key: "reset", label: "Reset" },
];

function requestError(data: ChecklistResponse) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  return data.error?.message || "Atlas could not update this Venue card.";
}

function requestKey(taskId: string, itemKey: string, checked: boolean) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${taskId}:${itemKey}:${checked ? "checked" : "reopened"}:${nonce}`;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function prettyDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(date);
}

function returnDestination(fallback: string) {
  const query = new URLSearchParams(window.location.search).get("returnTo");
  return query && query.startsWith("/") && !query.startsWith("//") ? query : fallback;
}

function completeTaskExit(taskId: string, fallback: string) {
  const returnTo = returnDestination(fallback);
  const event = new CustomEvent("atlas:task-completed", { cancelable: true, detail: { taskId, returnTo } });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) window.location.assign(returnTo);
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

function stageIndex(stage: VenueStage) {
  return TRAIL.findIndex((candidate) => candidate.key === stage);
}

export default function VenueTaskDetail({ task, assignee }: Props) {
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
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Venue details unavailable."); });
    return () => { cancelled = true; };
  }, [task.task_id]);

  const cycleStageRaw = text(task.metadata?.venue_cycle_stage);
  const cycleStage = cycleStageRaw && TRAIL.some((candidate) => candidate.key === cycleStageRaw)
    ? cycleStageRaw as VenueStage
    : "prep";
  const currentTrailIndex = stageIndex(cycleStage);
  const eventKind = text(task.metadata?.community_event_kind);
  const eventLabel = eventKind === "ticketed_seasonal_evening" ? "Ticketed seasonal evening" : "Free community morning";
  const items = useMemo(
    () => (checklist?.items ?? []).filter((item) => item.crossedOut !== true).sort((a, b) => a.sortOrder - b.sortOrder),
    [checklist],
  );
  const sections = useMemo(() => {
    const grouped = new Map<string, { key: string; label: string; location: string | null; items: ChecklistItem[] }>();
    for (const item of items) {
      const key = item.sectionKey || "venue";
      const label = item.sectionLabel || "Venue";
      const existing = grouped.get(key);
      if (existing) existing.items.push(item);
      else grouped.set(key, { key, label, location: item.stationLocation || null, items: [item] });
    }
    return Array.from(grouped.values());
  }, [items]);

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
      setMessage(error instanceof Error ? error.message : "Venue update failed.");
      try { setChecklist(await readChecklist(task.task_id)); } catch { /* keep last known state */ }
    } finally {
      setSaving(null);
    }
  }

  async function restock(item: ChecklistItem) {
    if (!item.restockLabel) return;
    try {
      setSaving(`restock:${item.itemKey}`);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "note",
        note: `Venue restock request: ${item.restockLabel}`,
        payload: { venueRestockRequest: item.restockLabel, venueChecklistItemKey: item.itemKey },
      });
      setMessage(`${item.restockLabel} restock requested.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not log the restock request.");
    } finally {
      setSaving(null);
    }
  }

  async function transition(kind: "done" | "partial" | "blocked") {
    const note = kind === "done" ? "" : window.prompt(kind === "partial" ? "What is left?" : "What problem did you find?", "")?.trim();
    if (kind !== "done" && !note) return;
    try {
      setSaving(kind);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: kind,
        note: note || undefined,
        reason: note || undefined,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { venueCycleStage: cycleStage, venueCardFamily: true },
      });
      if (kind === "done") completeTaskExit(task.task_id, assignee.listPath);
      else window.location.assign(returnDestination(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Venue result failed.");
    } finally {
      setSaving(null);
    }
  }

  const busy = Boolean(saving);
  const doneDisabled = !checklist || !checklist.ready;
  const completion = (
    <div className={rail.finish}>
      <div>
        <button type="button" className={rail.primaryFinish} disabled={busy || doneDisabled} onClick={() => void transition("done")}>Done</button>
        <button type="button" disabled={busy} onClick={() => setUnfinishedOpen((open) => !open)}>Unfinished</button>
      </div>
      {unfinishedOpen ? (
        <div className={rail.unfinished}>
          <strong>What happened?</strong>
          <div>
            <button type="button" disabled={busy} onClick={() => void transition("partial")}>Partly done</button>
            <button type="button" disabled={busy} onClick={() => void transition("blocked")}>Problem found</button>
          </div>
        </div>
      ) : null}
      {doneDisabled && checklist ? <small>Finish the required action before closing this Venue card.</small> : null}
      {message ? <p className={rail.message}>{message}</p> : null}
    </div>
  );

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "18px 14px 40px" }} data-atlas-venue-card="editor-parity-v2">
      <AtlasTaskCardFrame
        family="Venue"
        familyDetail={cycleStage}
        title="Community Thursday"
        subtitle={eventLabel}
        timing={task.due_date ? `Due ${prettyDate(task.due_date)}` : undefined}
        completion={completion}
      >
        <div className={rail.trail} aria-label="Community Thursday task trail">
          {TRAIL.map((step, index) => (
            <span key={step.key} className={index < currentTrailIndex ? rail.trailDone : index === currentTrailIndex ? rail.trailNow : rail.trailLocked}>
              <b>{step.label}</b>
              <small>Community Thursday</small>
            </span>
          ))}
        </div>

        {cycleStage === "host" ? (
          <section className={rail.hostChecklist} aria-label="Open the event checklist">
            <header><span>Checklist</span><small>{checklist ? `${checklist.completeCount}/${checklist.totalCount}` : "loading"}</small></header>
            <div className={rail.classicChecklist}>
              {items.map((item) => (
                <label className={rail.classicCheckItem} key={item.itemKey}>
                  <input type="checkbox" checked={item.checked} disabled={busy} onChange={() => void toggle(item)} />
                  <span className={rail.classicCircle} aria-hidden="true" />
                  <strong>{item.label}</strong>
                </label>
              ))}
            </div>
          </section>
        ) : (
          <>
            <div className={rail.rowKey}>
              <span>tap to cross off</span>
              <span><b>+</b> request restock</span>
            </div>
            <div className={rail.stations}>
              {sections.map((section) => (
                <section className={`${rail.station} ${rail.localStation}`} key={section.key}>
                  <header className={rail.stationHeader}>
                    <div>
                      <h3>{section.label}</h3>
                      {section.location ? <span>{section.location}</span> : null}
                    </div>
                  </header>
                  <div className={rail.resourceList}>
                    {section.items.map((item) => {
                      const id = `venue-${task.task_id}-${item.itemKey}`;
                      return (
                        <div className={`${rail.reminderRow} ${rail.localReminderRow}`} key={item.itemKey}>
                          <input id={id} className={rail.reminderToggle} type="checkbox" checked={item.checked} disabled={busy} onChange={() => void toggle(item)} />
                          <label className={rail.reminderCheck} data-required={item.required ? "true" : "false"} htmlFor={id}><strong>{item.label}</strong></label>
                          {item.restockLabel ? (
                            <details className={rail.restockDrawer}>
                              <summary aria-label={`Request ${item.restockLabel} restock`}><span>+</span></summary>
                              <div className={rail.restockPanel}>
                                <button type="button" disabled={busy} onClick={() => void restock(item)}>Request restock</button>
                                <small>{item.restockLabel}</small>
                              </div>
                            </details>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </AtlasTaskCardFrame>
    </main>
  );
}
