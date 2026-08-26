"use client";

import { useEffect, useState, type ReactNode } from "react";

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

function requestError(data: ChecklistResponse) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  return data.error?.message || "Atlas could not update the checklist.";
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
  const workerFacing = assignee.key !== "owner";
  const executable = !workerFacing || initialReadiness.executable === true;
  const waiting = workerFacing && initialReadiness.ok && initialReadiness.executable === false ? initialReadiness.presentation : null;
  const readinessFailed = workerFacing && (!initialReadiness.ok || typeof initialReadiness.executable !== "boolean");
  const hasSetupChecklist = metadata.setup_unit_checklist === true || metadata.setup_unit_checklist === "true";
  const partialPrompt = text(metadata.setup_unit_partial_prompt) || "What is left?";
  const [saving, setSaving] = useState(false);
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ExecutionChecklist | null>(null);
  const [checklistMessage, setChecklistMessage] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hasSetupChecklist) {
      setChecklist(null);
      setChecklistMessage(null);
      return () => { cancelled = true; };
    }

    setChecklist(null);
    setChecklistMessage(null);
    void readChecklist(task.task_id)
      .then((value) => { if (!cancelled) setChecklist(value); })
      .catch((error) => {
        if (!cancelled) setChecklistMessage(error instanceof Error ? error.message : "Checklist unavailable.");
      });
    return () => { cancelled = true; };
  }, [hasSetupChecklist, task.task_id]);

  async function toggleChecklistItem(item: ChecklistItem) {
    const nextChecked = !item.checked;
    try {
      setSavingItem(item.itemKey);
      setChecklistMessage(null);
      setChecklist((current) => current ? {
        ...current,
        items: current.items.map((candidate) => candidate.itemKey === item.itemKey
          ? { ...candidate, checked: nextChecked }
          : candidate),
        completeCount: current.completeCount + (nextChecked ? 1 : -1),
        ready: current.items.every((candidate) => candidate.itemKey === item.itemKey
          ? nextChecked || !candidate.required
          : candidate.checked || !candidate.required),
      } : current);
      setChecklist(await writeChecklistItem(task.task_id, item.itemKey, nextChecked));
    } catch (error) {
      setChecklistMessage(error instanceof Error ? error.message : "Checklist update failed.");
      try {
        setChecklist(await readChecklist(task.task_id));
      } catch {
        // Keep the last known state if the authoritative reread is also unavailable.
      }
    } finally {
      setSavingItem(null);
    }
  }

  async function transition(outcome: "done" | "partial" | "blocked", note?: string) {
    try {
      setSaving(true);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: outcome,
        note,
        reason: note,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { workClass: task.work_class, assigneeKey: assignee.key, setupCardFamily: true },
      });
      if (outcome === "done") {
        completeTaskExit(task.task_id, assignee.listPath);
        return;
      }
      window.location.assign(returnDestination(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(false);
    }
  }

  const checklistProgress = checklist
    ? (checklist.ready ? checklist.completionLabel : `${checklist.completeCount} / ${checklist.totalCount}`)
    : "Loading";

  const cardBody: ReactNode = (
    <>
      {tools.length ? (
        <section className="atlas-setup-tools" aria-label="Tools">
          <header><span>Tools</span></header>
          <div className="atlas-setup-tool-rows">
            {tools.map((tool) => <div className="atlas-setup-tool-row" key={tool}><strong>{tool}</strong></div>)}
          </div>
        </section>
      ) : null}

      {hasSetupChecklist ? (
        <section className="atlas-setup-checklist" aria-label={checklist?.title || text(metadata.execution_checklist_title) || "Checklist"}>
          <header className="atlas-setup-checklist-key">
            <span>{checklist?.title || text(metadata.execution_checklist_title) || "Checklist"}</span>
            <small>{checklistProgress}</small>
          </header>
          <div className="atlas-setup-checklist-rows">
            {checklist?.items.map((item) => (
              <button
                type="button"
                className={`atlas-setup-checklist-row${item.checked ? " is-checked" : ""}`}
                key={item.itemKey}
                aria-pressed={item.checked}
                disabled={saving || Boolean(savingItem) || !executable}
                onClick={() => void toggleChecklistItem(item)}
              >
                <strong>{item.label}</strong>
                <span className="atlas-setup-checklist-mark" aria-hidden="true">{item.checked ? "✓" : ""}</span>
              </button>
            ))}
            {checklist && checklist.totalCount === 0 ? <p className="atlas-setup-checklist-empty">No checklist rows are available.</p> : null}
          </div>
          {checklistMessage ? <p className="atlas-setup-checklist-message">{checklistMessage}</p> : null}
        </section>
      ) : null}

      {unfinishedOpen ? (
        <section className="atlas-setup-unfinished">
          <strong>What happened?</strong>
          <div>
            <button type="button" disabled={saving} onClick={() => { const note = window.prompt(partialPrompt, "")?.trim(); if (note) void transition("partial", note); }}>Partly done</button>
            <button type="button" disabled={saving} onClick={() => { const note = window.prompt("What problem did you find?", "")?.trim(); if (note) void transition("blocked", note); }}>Problem found</button>
          </div>
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

      {message ? <p className="atlas-setup-message">{message}</p> : null}
    </>
  );

  return (
    <main className="atlas-setup-shell" data-atlas-site-layout-card="true" data-atlas-setup-display="task-card-lab-v2">
      <style>{`
        .atlas-setup-shell { min-height:100%; padding:18px 14px 120px; background:var(--atlas-app-background,#f4efe6); }
        .atlas-setup-body { width:min(100%,520px); margin:0 auto; }
        .atlas-setup-tools { display:grid; border-top:1px solid rgba(215,204,189,.62); border-bottom:1px solid rgba(215,204,189,.62); }
        .atlas-setup-tools > header { padding:14px 18px 9px; }
        .atlas-setup-tools > header span,
        .atlas-setup-checklist-key > span,
        .atlas-setup-waiting > small {
          color:#858bb8; font-size:10px; line-height:1; font-weight:950; letter-spacing:.15em; text-transform:uppercase;
        }
        .atlas-setup-tool-rows { display:grid; }
        .atlas-setup-tool-row { min-height:46px; display:flex; align-items:center; padding:0 18px; border-top:1px solid rgba(223,215,202,.48); }
        .atlas-setup-tool-row strong { color:var(--atlas-text); font-size:14px; line-height:1.15; font-weight:910; }
        .atlas-setup-checklist { display:grid; border-bottom:1px solid rgba(215,204,189,.62); }
        .atlas-setup-checklist-key { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 18px 9px; }
        .atlas-setup-checklist-key small { color:#85867f; font-size:10px; line-height:1; font-weight:850; }
        .atlas-setup-checklist-rows { display:grid; }
        .atlas-setup-checklist-row { width:100%; min-height:50px; display:flex; align-items:center; justify-content:space-between; gap:14px; border:0; border-top:1px solid rgba(223,215,202,.48); background:rgba(255,255,255,.42); padding:8px 18px; color:var(--atlas-text); text-align:left; font:inherit; cursor:pointer; }
        .atlas-setup-checklist-row strong { min-width:0; font-size:14px; line-height:1.15; font-weight:910; }
        .atlas-setup-checklist-row:disabled { cursor:default; opacity:.62; }
        .atlas-setup-checklist-row.is-checked { background:rgba(214,225,177,.28); }
        .atlas-setup-checklist-row.is-checked strong { color:#85867f; text-decoration-line:line-through; text-decoration-thickness:1.4px; }
        .atlas-setup-checklist-mark { flex:0 0 auto; width:24px; height:24px; display:grid; place-items:center; box-sizing:border-box; border:2px solid rgba(139,145,194,.42); border-radius:7px; background:#fff; color:#515b34; font-size:14px; line-height:1; font-weight:950; }
        .atlas-setup-checklist-row.is-checked .atlas-setup-checklist-mark { border-color:rgba(112,124,72,.34); background:rgba(214,225,177,.82); }
        .atlas-setup-checklist-empty { margin:0; padding:14px 18px 18px; color:#777970; font-size:12px; line-height:1.35; }
        .atlas-setup-checklist-message { margin:0; padding:0 18px 14px; color:#7b5549; font-size:11px; font-weight:800; }
        .atlas-setup-waiting { display:grid; gap:8px; padding:18px; border-bottom:1px solid rgba(215,204,189,.62); }
        .atlas-setup-waiting > small { display:block; }
        .atlas-setup-waiting strong { color:#414352; font-size:19px; }
        .atlas-setup-waiting p { margin:0; color:#5f606a; font-size:14px; line-height:1.45; }
        .atlas-setup-unfinished { display:grid; gap:9px; margin:0 18px 14px; padding:12px; border:1px solid rgba(207,196,179,.72); border-radius:15px; background:rgba(250,248,239,.82); }
        .atlas-setup-unfinished > strong { color:#4e504d; font-size:12px; }
        .atlas-setup-unfinished > div { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
        .atlas-setup-unfinished button { min-height:48px; border:1px solid rgba(139,145,194,.25); border-radius:15px; background:rgba(255,255,255,.82); color:#676a7d; padding:9px 10px; font:inherit; font-size:11px; line-height:1.1; font-weight:900; }
        .atlas-setup-message { margin:0; padding:0 18px 14px; color:#7b5549; font-size:11px; font-weight:800; }
        @media (max-width:520px) { .atlas-setup-shell { padding-left:10px; padding-right:10px; } }
      `}</style>
      <div className="atlas-setup-body">
        {executable ? (
          <AtlasTaskCardFrame
            family="Setup"
            title={action}
            subtitle={subtitle}
            onDone={() => void transition("done")}
            onUnfinished={() => setUnfinishedOpen((open) => !open)}
            completionDisabled={saving || Boolean(savingItem)}
          >
            {cardBody}
          </AtlasTaskCardFrame>
        ) : (
          <AtlasTaskCardFrame family="Setup" title={action} subtitle={subtitle} completion={false}>
            {cardBody}
          </AtlasTaskCardFrame>
        )}
      </div>
    </main>
  );
}
