"use client";

import { useEffect, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import type { WorkerReadinessResponse } from "@/lib/atlas/worker-readiness";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
  initialReadiness: WorkerReadinessResponse;
  recipeLabel?: string | null;
  recipeTools?: string[];
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
  return typeof value === "string" ? value.trim() : "";
}

function truthy(value: unknown) {
  return value === true || value === "true";
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "";
  const date = new Date(`${dateIso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? dateIso
    : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(date);
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
  return data.error?.message || "Atlas could not update this setup work.";
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
    body: JSON.stringify({
      taskId,
      itemKey,
      checked,
      idempotencyKey: requestKey(taskId, itemKey, checked),
    }),
  });
  const data = await response.json() as ChecklistResponse;
  if (!response.ok || !data.ok || !data.checklist) throw new Error(requestError(data));
  return data.checklist;
}

export default function SiteLayoutTaskDetail({ task, assignee, initialReadiness, recipeLabel, recipeTools = [] }: Props) {
  const metadata = task.metadata ?? {};
  const subject = text(metadata.display_subject) || text(metadata.display_location) || task.title;
  const detail = text(metadata.display_detail);
  const action = text(recipeLabel) || text(metadata.display_action) || "Setup";
  const subtitle = [subject, detail].filter(Boolean).join(" · ") || undefined;
  const taskResourceLabels = (task.resource_requirements ?? [])
    .map((requirement) => requirement.resource_label || requirement.note || "")
    .map((value) => value.trim())
    .filter(Boolean);
  const tools = Array.from(new Set([...recipeTools, ...taskResourceLabels]));
  const materialsNote = text(metadata.materials_note);
  const hasUnitChecklist = truthy(metadata.setup_unit_checklist);
  const workerFacing = assignee.key !== "owner";
  const executable = !workerFacing || initialReadiness.executable === true;
  const waiting = workerFacing && initialReadiness.ok && initialReadiness.executable === false ? initialReadiness.presentation : null;
  const readinessFailed = workerFacing && (!initialReadiness.ok || typeof initialReadiness.executable !== "boolean");
  const [checklist, setChecklist] = useState<ExecutionChecklist | null>(null);
  const [checklistFailed, setChecklistFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!hasUnitChecklist) {
      setChecklist(null);
      setChecklistFailed(false);
      return;
    }
    let cancelled = false;
    setChecklist(null);
    setChecklistFailed(false);
    void readChecklist(task.task_id)
      .then((value) => { if (!cancelled) setChecklist(value); })
      .catch(() => { if (!cancelled) setChecklistFailed(true); });
    return () => { cancelled = true; };
  }, [hasUnitChecklist, task.task_id]);

  async function toggle(item: ChecklistItem) {
    const nextChecked = !item.checked;
    try {
      setSaving(item.itemKey);
      setMessage(null);
      setChecklist((current) => current ? {
        ...current,
        items: current.items.map((candidate) => candidate.itemKey === item.itemKey
          ? { ...candidate, checked: nextChecked }
          : candidate),
      } : current);
      setChecklist(await writeChecklistItem(task.task_id, item.itemKey, nextChecked));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Setup unit update failed.");
      try { setChecklist(await readChecklist(task.task_id)); } catch { /* keep last known state */ }
    } finally {
      setSaving(null);
    }
  }

  async function transition(outcome: "done" | "partial" | "blocked", note?: string) {
    try {
      setSaving(outcome);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: outcome,
        note,
        reason: note,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: {
          workClass: task.work_class,
          assigneeKey: assignee.key,
          setupCardFamily: true,
          setupUnitsComplete: hasUnitChecklist ? checklist?.ready === true : undefined,
        },
      });
      if (outcome === "done") {
        completeTaskExit(task.task_id, assignee.listPath);
        return;
      }
      window.location.assign(returnDestination(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(null);
    }
  }

  const busy = Boolean(saving);
  const unitsReady = !hasUnitChecklist || checklist?.ready === true;
  const completion = executable ? (
    <div className="atlas-setup-finish">
      <div className="atlas-setup-finish-buttons">
        <button
          type="button"
          className="primary"
          disabled={busy || !unitsReady}
          onClick={() => void transition("done")}
        >
          {saving === "done" ? "Saving…" : "Done"}
        </button>
        <button type="button" disabled={busy} onClick={() => setUnfinishedOpen((open) => !open)}>Unfinished</button>
      </div>
      {unfinishedOpen ? (
        <section className="atlas-setup-unfinished">
          <strong>What happened?</strong>
          <div>
            <button type="button" disabled={busy} onClick={() => { const note = window.prompt("What is left?", "")?.trim(); if (note) void transition("partial", note); }}>Partly done</button>
            <button type="button" disabled={busy} onClick={() => { const note = window.prompt("What problem did you find?", "")?.trim(); if (note) void transition("blocked", note); }}>Problem found</button>
          </div>
        </section>
      ) : null}
      {message ? <p className="atlas-setup-message">{message}</p> : null}
    </div>
  ) : false;

  const unitItems = checklist?.items.slice().sort((a, b) => a.sortOrder - b.sortOrder) ?? [];

  return (
    <main className="atlas-setup-shell" data-atlas-site-layout-card="true" data-atlas-setup-display="task-card-lab-v2">
      <style>{`
        .atlas-setup-shell { min-height:100%; padding:18px 14px 120px; background:var(--atlas-app-background,#f4efe6); }
        .atlas-setup-body { width:min(100%,520px); margin:0 auto; }
        .atlas-setup-tools,.atlas-setup-materials,.atlas-setup-units { padding:20px 22px 24px; border-top:1px solid rgba(215,204,189,.62); }
        .atlas-setup-tools > small,.atlas-setup-materials > small,.atlas-setup-units header > small,.atlas-setup-waiting > small {
          display:block; color:#858bb8; font-size:10px; line-height:1; font-weight:950; letter-spacing:.11em; text-transform:uppercase;
        }
        .atlas-setup-tool-list { margin:12px 0 0; padding:0; list-style:none; display:grid; }
        .atlas-setup-tool-list li { min-height:46px; display:flex; align-items:center; border-top:1px solid rgba(139,145,194,.16); color:#454858; font-size:15px; line-height:1.2; font-weight:820; }
        .atlas-setup-tool-list li:first-child { border-top:0; }
        .atlas-setup-materials { display:grid; gap:8px; background:rgba(250,248,239,.54); }
        .atlas-setup-materials p { margin:0; color:#5d5f59; font-size:12px; line-height:1.45; font-weight:760; }
        .atlas-setup-units { display:grid; gap:12px; background:#fff; }
        .atlas-setup-units header { display:flex; align-items:end; justify-content:space-between; gap:12px; }
        .atlas-setup-units header span { color:#86877f; font-size:9px; line-height:1.2; font-weight:820; text-align:right; }
        .atlas-setup-unit-list { display:grid; border-top:1px solid rgba(215,204,189,.55); }
        .atlas-setup-unit { width:100%; min-height:52px; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; padding:10px 2px; border:0; border-bottom:1px solid rgba(215,204,189,.55); background:transparent; color:#343542; text-align:left; font:inherit; }
        .atlas-setup-unit strong { font-size:13px; line-height:1.25; font-weight:900; }
        .atlas-setup-unit span { width:23px; height:23px; display:grid; place-items:center; border:2px solid #9297bf; border-radius:7px; color:transparent; font-size:14px; line-height:1; font-weight:950; }
        .atlas-setup-unit[aria-checked="true"] strong { color:#7d806f; text-decoration:line-through; }
        .atlas-setup-unit[aria-checked="true"] span { border-color:#8e9870; background:#d9e2bb; color:#596139; }
        .atlas-setup-unit:disabled { opacity:.62; }
        .atlas-setup-unit-error { margin:0; color:#7b5549; font-size:11px; line-height:1.4; font-weight:800; }
        .atlas-setup-waiting { display:grid; gap:8px; padding:20px 22px 24px; border-top:1px solid rgba(215,204,189,.62); }
        .atlas-setup-waiting strong { color:#414352; font-size:19px; }
        .atlas-setup-waiting p { margin:0; color:#5f606a; font-size:14px; line-height:1.45; }
        .atlas-setup-finish { display:grid; gap:10px; }
        .atlas-setup-finish-buttons { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
        .atlas-setup-finish button { min-height:48px; border:1px solid rgba(139,145,194,.25); border-radius:15px; background:rgba(255,255,255,.82); color:#676a7d; padding:9px 10px; font:inherit; font-size:13px; font-weight:900; }
        .atlas-setup-finish button.primary { background:rgba(214,225,177,.72); color:#515b34; }
        .atlas-setup-finish button:disabled { opacity:.55; }
        .atlas-setup-unfinished { display:grid; gap:9px; padding:12px; border:1px solid rgba(207,196,179,.72); border-radius:15px; background:rgba(250,248,239,.82); }
        .atlas-setup-unfinished > div { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
        .atlas-setup-message { margin:0; color:#7b5549; font-size:11px; font-weight:800; }
        @media (max-width:520px) { .atlas-setup-shell { padding-left:10px; padding-right:10px; } .atlas-setup-tools,.atlas-setup-materials,.atlas-setup-units,.atlas-setup-waiting { padding-left:18px; padding-right:18px; } }
      `}</style>
      <div className="atlas-setup-body">
        <AtlasTaskCardFrame
          family="Setup"
          title={action}
          subtitle={subtitle}
          timing={task.due_date ? `Today · ${prettyDate(task.due_date)}` : undefined}
          completion={completion}
        >
          {tools.length ? (
            <section className="atlas-setup-tools" aria-label="Tools">
              <small>Tools</small>
              <ul className="atlas-setup-tool-list">{tools.map((tool) => <li key={tool}>{tool}</li>)}</ul>
            </section>
          ) : null}

          {materialsNote ? (
            <section className="atlas-setup-materials" aria-label="Materials note">
              <small>Materials</small>
              <p>{materialsNote}</p>
            </section>
          ) : null}

          {hasUnitChecklist ? (
            <section className="atlas-setup-units" aria-label="Setup units">
              <header>
                <small>{checklist?.title || "Beds"}</small>
                <span>{checklist ? `${checklist.completeCount} of ${checklist.totalCount} strung` : "mark each bed when finished"}</span>
              </header>
              {unitItems.length ? (
                <div className="atlas-setup-unit-list">
                  {unitItems.map((item) => (
                    <button
                      type="button"
                      className="atlas-setup-unit"
                      key={item.itemKey}
                      role="checkbox"
                      aria-checked={item.checked}
                      disabled={busy || !executable}
                      onClick={() => void toggle(item)}
                    >
                      <strong>{item.label}</strong>
                      <span aria-hidden="true">✓</span>
                    </button>
                  ))}
                </div>
              ) : checklistFailed ? (
                <p className="atlas-setup-unit-error">Bed progress could not be loaded. Reopen this task before marking it done.</p>
              ) : (
                <p className="atlas-setup-unit-error">Loading bed progress…</p>
              )}
            </section>
          ) : null}

          {!executable ? (
            <section className="atlas-setup-waiting" aria-live="polite">
              <small>Waiting</small>
              <strong>{readinessFailed ? "This task didn’t load" : waiting?.title || "Not ready yet"}</strong>
              <p>{readinessFailed ? "Go back to the day and open this task again." : waiting?.body || "This work is waiting on another farm condition."}</p>
              {!readinessFailed && waiting?.detail ? <p>{waiting.detail}</p> : null}
            </section>
          ) : null}
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
