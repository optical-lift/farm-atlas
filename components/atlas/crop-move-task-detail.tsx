"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/components/atlas/crop-move-task-detail.module.css";
import InlineIssueDrawer from "@/components/atlas/inline-issue-drawer";
import TaskBedMap from "@/components/atlas/task-bed-map";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = { task: AtlasTaskCard; childTasks: AtlasTaskCard[]; assignee: AtlasAssigneeConfig };
type ChecklistItem = { itemId: string; itemKey: string; sectionKey: string; sectionLabel: string; label: string; sortOrder: number; required: boolean; checked: boolean; checkedAt: string | null };
type ExecutionChecklist = { taskId: string; title: string; completionLabel: string; items: ChecklistItem[]; totalCount: number; completeCount: number; ready: boolean };
type ChecklistResponse = { ok?: boolean; checklist?: ExecutionChecklist; error?: string | { message?: string }; details?: string };
type TrailStep = { label: string; detail: string; state: "done" | "now" | "later" };

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : ""; }
function numberValue(value: unknown) { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null; }
function stringList(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : []; }
function requestError(data: ChecklistResponse) { if (data.details) return data.details; if (typeof data.error === "string") return data.error; return data.error?.message || "Atlas could not update the crop-move checklist."; }
function requestKey(taskId: string, itemKey: string, checked: boolean) { const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; return `${taskId}:${itemKey}:${checked ? "checked" : "reopened"}:${nonce}`; }
function prettyDate(value: string | null | undefined) { if (!value) return ""; const date = new Date(`${value.slice(0, 10)}T12:00:00Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(date); }
function returnDestination(fallback: string) { const value = new URLSearchParams(window.location.search).get("returnTo"); return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback; }
function completeTaskExit(taskId: string, fallback: string) { const returnTo = returnDestination(fallback); const event = new CustomEvent("atlas:task-completed", { cancelable: true, detail: { taskId, returnTo } }); window.dispatchEvent(event); if (!event.defaultPrevented) window.location.assign(returnTo); }

async function readChecklist(taskId: string) {
  const response = await fetch(`/api/atlas/task-execution-checklist?taskId=${encodeURIComponent(taskId)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = await response.json() as ChecklistResponse;
  if (!response.ok || !data.ok || !data.checklist) throw new Error(requestError(data));
  return data.checklist;
}

async function writeChecklistItem(taskId: string, itemKey: string, checked: boolean) {
  const response = await fetch("/api/atlas/task-execution-checklist", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "x-atlas-intent": "task-execution-checklist-v1" },
    cache: "no-store",
    body: JSON.stringify({ taskId, itemKey, checked, idempotencyKey: requestKey(taskId, itemKey, checked) }),
  });
  const data = await response.json() as ChecklistResponse;
  if (!response.ok || !data.ok || !data.checklist) throw new Error(requestError(data));
  return data.checklist;
}

function cropMoveView(task: AtlasTaskCard) {
  const metadata = task.metadata ?? {};
  const subject = text(metadata.display_subject) || task.title;
  const zone = text(task.zone_label) || text(metadata.collection_zone) || "Elm Farm";
  const isPotUp = task.task_type === "pot_up" || task.action_key === "pot_up";

  if (isPotUp) {
    const trayCount = numberValue(metadata.batch_item_count);
    const total = numberValue(metadata.batch_total_quantity);
    const cellsPerTray = trayCount && total && total % trayCount === 0 ? total / trayCount : null;
    const destinationTitle = trayCount && cellsPerTray ? `${trayCount} full ${cellsPerTray}-cell trays` : trayCount ? `${trayCount} trays` : "Plug trays";
    return {
      family: "Pot Up",
      title: subject,
      subtitle: zone,
      sourceTitle: subject,
      sourceDetail: total ? `${total} seedlings` : "Seedlings",
      sourceFacts: total ? [{ label: "Plants", value: total.toLocaleString() }] : [],
      destinationTitle,
      destinationDetail: text(metadata.state_effect) || stringList(metadata.execution_how)[0] || "Move seedlings into their next containers.",
      destinationFacts: [
        ...(trayCount ? [{ label: "Trays", value: String(trayCount) }] : []),
        ...(cellsPerTray ? [{ label: "Cells / tray", value: String(cellsPerTray) }] : []),
      ],
      sourceIssues: ["Seedling loss", "Root issue", "Fewer seedlings", "Other"],
      destinationIssues: ["Tray unavailable", "Cell count changed", "Space problem", "Other"],
      trail: [
        { label: "Seedlings", detail: "source", state: "done" },
        { label: "Pot Up", detail: "now", state: "now" },
        { label: "Trays", detail: "destination", state: "later" },
        { label: "Establish", detail: "next", state: "later" },
        { label: "Grow On", detail: "later", state: "later" },
      ] as TrailStep[],
    };
  }

  const clumpCount = numberValue(metadata.source_clump_count);
  const source = text(metadata.source_area) || text(metadata.execution_place) || zone;
  return {
    family: "Divide",
    title: subject,
    subtitle: zone,
    sourceTitle: source,
    sourceDetail: clumpCount ? `${clumpCount} established clumps` : subject,
    sourceFacts: clumpCount ? [{ label: "Clumps", value: String(clumpCount) }] : [],
    destinationTitle: `${zone} · drifts`,
    destinationDetail: `Re-establish ${subject} as divided drifts`,
    destinationFacts: [{ label: "Pattern", value: "Drifts" }],
    sourceIssues: ["Root mass issue", "Fewer divisions", "Plant damaged", "Other"],
    destinationIssues: ["Not prepared", "Location changed", "Space changed", "Other"],
    trail: [
      { label: "Established", detail: "source clumps", state: "done" },
      { label: "Divide", detail: "now", state: "now" },
      { label: "Replant", detail: "same move", state: "later" },
      { label: "Regrow", detail: "next", state: "later" },
      { label: "Bloom", detail: "later", state: "later" },
    ] as TrailStep[],
  };
}

export default function CropMoveTaskDetail({ task, assignee }: Props) {
  const templateKey = text(task.metadata?.execution_checklist_template_key);
  const hasChecklist = Boolean(templateKey);
  const [checklist, setChecklist] = useState<ExecutionChecklist | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const view = useMemo(() => cropMoveView(task), [task]);

  useEffect(() => {
    if (!hasChecklist) { setChecklist(null); return; }
    let cancelled = false;
    setChecklist(null);
    setMessage(null);
    void readChecklist(task.task_id).then((value) => { if (!cancelled) setChecklist(value); }).catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Checklist unavailable."); });
    return () => { cancelled = true; };
  }, [hasChecklist, task.task_id]);

  async function toggle(item: ChecklistItem) {
    const nextChecked = !item.checked;
    try {
      setSaving(item.itemKey);
      setMessage(null);
      setChecklist((current) => current ? { ...current, items: current.items.map((candidate) => candidate.itemKey === item.itemKey ? { ...candidate, checked: nextChecked } : candidate) } : current);
      setChecklist(await writeChecklistItem(task.task_id, item.itemKey, nextChecked));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checklist update failed.");
      try { setChecklist(await readChecklist(task.task_id)); } catch { /* preserve last known state */ }
    } finally { setSaving(null); }
  }

  async function logIssue(place: "source" | "destination", issue: string) {
    try {
      setSaving(`${place}:${issue}`);
      setMessage(null);
      await postAtlasTaskTransition({ taskId: task.task_id, transition: "note", note: `${place === "source" ? "Source" : "Destination"} issue: ${issue}`, payload: { cropMoveIssuePlace: place, cropMoveIssue: issue } });
      setMessage(`${issue} logged.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Atlas could not log this issue."); }
    finally { setSaving(null); }
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
        payload: { completion_source: kind === "done" ? "crop_move_parent_attestation" : "task_card", cropMoveFamily: view.family, checklistCompleteBeforeClose: hasChecklist ? checklist?.ready === true : undefined },
      });
      if (kind === "done") completeTaskExit(task.task_id, assignee.listPath);
      else window.location.assign(returnDestination(assignee.listPath));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Task update failed."); }
    finally { setSaving(null); }
  }

  const busy = Boolean(saving);
  const completion = (
    <div className={styles.finish}>
      <div className={styles.finishButtons}>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void transition("done")}>Done</button>
        <button type="button" disabled={busy} onClick={() => setUnfinishedOpen((open) => !open)}>Unfinished</button>
      </div>
      {unfinishedOpen ? <div className={styles.unfinished}><strong>What happened?</strong><div className={styles.finishButtons}><button type="button" disabled={busy} onClick={() => void transition("partial")}>Partly done</button><button type="button" disabled={busy} onClick={() => void transition("blocked")}>Problem found</button></div></div> : null}
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );

  return (
    <main className={styles.shell} data-atlas-crop-move="editor-parity-v3">
      <AtlasTaskCardFrame family={view.family} familyDetail="crop move" title={view.title} subtitle={view.subtitle} timing={task.due_date ? `Due ${prettyDate(task.due_date)}` : undefined} completion={completion}>
        <div className={styles.trail} aria-label={`${view.family} crop move trail`}>
          {view.trail.map((step) => <span key={step.label} className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : undefined}><b>{step.label}</b><small>{step.detail}</small></span>)}
        </div>
        <section className={styles.moveSection}>
          <div className={styles.movePlace}>
            <div className={styles.placeHeading}>
              <div><small>Source</small><strong>{view.sourceTitle}</strong><span>{view.sourceDetail}</span></div>
              <InlineIssueDrawer label="Report source issue">
                {view.sourceIssues.map((issue) => <button type="button" key={issue} disabled={busy} onClick={() => void logIssue("source", issue)}>{issue}</button>)}
              </InlineIssueDrawer>
            </div>
            {view.sourceFacts.length ? <div className={styles.placeFacts}>{view.sourceFacts.map((fact) => <div key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong></div>)}</div> : null}
          </div>
          <div className={styles.moveLine} aria-hidden="true">→</div>
          <div className={styles.movePlace}>
            <div className={styles.placeHeading}>
              <div><small>Destination</small><strong>{view.destinationTitle}</strong><span>{view.destinationDetail}</span></div>
              <InlineIssueDrawer label="Report destination issue">
                {view.destinationIssues.map((issue) => <button type="button" key={issue} disabled={busy} onClick={() => void logIssue("destination", issue)}>{issue}</button>)}
              </InlineIssueDrawer>
            </div>
            {view.destinationFacts.length ? <div className={styles.placeFacts}>{view.destinationFacts.map((fact) => <div key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong></div>)}</div> : null}
          </div>
        </section>
        <TaskBedMap taskId={task.task_id} detail="crop move target" />
        {hasChecklist ? <section className={styles.checklist}><header><span>{checklist?.title || "Checklist"}</span><small>{checklist ? `${checklist.completeCount}/${checklist.totalCount}` : "loading"}</small></header>{(checklist?.items ?? []).sort((a,b) => a.sortOrder-b.sortOrder).map((item) => { const id=`crop-move-${task.task_id}-${item.itemKey}`; return <label className={styles.checkRow} key={item.itemKey} htmlFor={id}><input id={id} type="checkbox" checked={item.checked} disabled={busy} onChange={() => void toggle(item)} /><span className={styles.checkCircle} aria-hidden="true"/><strong>{item.label}</strong></label>; })}</section> : null}
      </AtlasTaskCardFrame>
    </main>
  );
}
