"use client";

import { useEffect, useMemo, useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskInstrumentContext,
  type AssignedTaskOutcome,
} from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = { task: AtlasTaskCard; childTasks: AtlasTaskCard[]; assignee: AtlasAssigneeConfig };
type ChecklistItem = { itemId: string; itemKey: string; sectionKey: string; sectionLabel: string; label: string; sortOrder: number; required: boolean; checked: boolean; checkedAt: string | null };
type ExecutionChecklist = { taskId: string; title: string; completionLabel: string; items: ChecklistItem[]; totalCount: number; completeCount: number; ready: boolean };
type ChecklistResponse = { ok?: boolean; checklist?: ExecutionChecklist; error?: string | { message?: string }; details?: string };

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

function metadataText(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

export default function ExecutionChecklistTaskDetail(props: Props) {
  const { task } = props;
  const [checklist, setChecklist] = useState<ExecutionChecklist | null>(null);
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChecklist(null);
    setMessage(null);
    void readChecklist(task.task_id)
      .then((value) => { if (!cancelled) setChecklist(value); })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Checklist unavailable.");
      });
    return () => { cancelled = true; };
  }, [task.task_id]);

  const sections = useMemo(() => {
    const ordered: Array<{ key: string; label: string; items: ChecklistItem[] }> = [];
    for (const item of checklist?.items ?? []) {
      let section = ordered.find((candidate) => candidate.key === item.sectionKey);
      if (!section) {
        section = { key: item.sectionKey, label: item.sectionLabel, items: [] };
        ordered.push(section);
      }
      section.items.push(item);
    }
    return ordered;
  }, [checklist]);

  async function toggle(item: ChecklistItem) {
    const nextChecked = !item.checked;
    try {
      setSavingItem(item.itemKey);
      setMessage(null);
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
      setMessage(error instanceof Error ? error.message : "Checklist update failed.");
      try {
        setChecklist(await readChecklist(task.task_id));
      } catch {
        // Keep the last known state if the authoritative reread is also unavailable.
      }
    } finally {
      setSavingItem(null);
    }
  }

  const checklistKicker = metadataText(task, "execution_checklist_kicker") || "Checklist";
  const checklistTitle = checklist?.title || metadataText(task, "execution_checklist_title") || task.title;

  function methodInstrument(context: AssignedTaskInstrumentContext) {
    const busy = Boolean(savingItem) || context.busy;
    return (
      <>
        <style>{`
          .atlas-execution-checklist { margin: 0 28px 28px; border: 1px solid rgba(68,65,89,.16); border-radius: 22px; overflow: hidden; background: rgba(255,255,255,.72); }
          .atlas-execution-checklist__head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; padding:20px 24px 16px; border-bottom:1px solid rgba(68,65,89,.12); }
          .atlas-execution-checklist__head span { display:block; color:#7772ad; font-size:.76rem; font-weight:850; letter-spacing:.14em; text-transform:uppercase; }
          .atlas-execution-checklist__head strong { display:block; margin-top:4px; color:#25253d; font-size:1.2rem; line-height:1.1; }
          .atlas-execution-checklist__progress { flex:0 0 auto; color:#686675; font-size:.88rem; font-weight:800; }
          .atlas-execution-checklist__section { padding:18px 18px 8px; }
          .atlas-execution-checklist__section + .atlas-execution-checklist__section { border-top:1px solid rgba(68,65,89,.1); }
          .atlas-execution-checklist__section h2 { margin:0 6px 10px; color:#7772ad; font-size:.74rem; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }
          .atlas-execution-checklist__items { display:grid; gap:8px; }
          .atlas-execution-checklist__item { width:100%; display:grid; grid-template-columns:34px 1fr; align-items:center; gap:12px; padding:13px 14px; border:1px solid rgba(68,65,89,.14); border-radius:15px; background:#fffdf8; color:#2d2d43; text-align:left; font:inherit; font-weight:740; line-height:1.25; }
          .atlas-execution-checklist__item:disabled { opacity:.66; }
          .atlas-execution-checklist__item.is-checked { background:#eef3df; color:#55603a; border-color:rgba(97,112,59,.22); }
          .atlas-execution-checklist__mark { width:30px; height:30px; display:grid; place-items:center; border:2px solid #aaa8b2; border-radius:10px; background:#fff; font-size:1rem; font-weight:950; }
          .atlas-execution-checklist__item.is-checked .atlas-execution-checklist__mark { border-color:#829252; background:#dce8ba; }
          .atlas-execution-checklist__loading, .atlas-execution-checklist__completion-note, .atlas-execution-checklist__message { padding:18px 22px; color:#777; font-size:.88rem; line-height:1.35; }
          .atlas-execution-checklist__message { padding-top:0; color:#704d43; }
          @media (max-width:560px) { .atlas-execution-checklist { margin-left:16px; margin-right:16px; } }
        `}</style>
        <section className="atlas-execution-checklist" aria-label={checklistTitle} data-atlas-method-instrument="execution-checklist">
          <header className="atlas-execution-checklist__head">
            <div><span>{checklistKicker}</span><strong>{checklistTitle}</strong></div>
            <div className="atlas-execution-checklist__progress">
              {checklist ? `${checklist.completeCount} / ${checklist.totalCount}` : "Loading"}
            </div>
          </header>
          {!checklist ? (
            <p className="atlas-execution-checklist__loading">Loading checklist…</p>
          ) : sections.map((section) => (
            <section className="atlas-execution-checklist__section" key={section.key}>
              <h2>{section.label}</h2>
              <div className="atlas-execution-checklist__items">
                {section.items.map((item) => (
                  <button
                    type="button"
                    className={`atlas-execution-checklist__item${item.checked ? " is-checked" : ""}`}
                    key={item.itemKey}
                    aria-pressed={item.checked}
                    disabled={busy}
                    onClick={() => void toggle(item)}
                  >
                    <span className="atlas-execution-checklist__mark" aria-hidden="true">{item.checked ? "✓" : ""}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {checklist && !checklist.ready ? (
            <p className="atlas-execution-checklist__completion-note">Finish the required lines before marking the task done.</p>
          ) : null}
          {message ? <p className="atlas-execution-checklist__message">{message}</p> : null}
        </section>
      </>
    );
  }

  function resultPayload(outcome: AssignedTaskOutcome) {
    return {
      completion_source: outcome === "done" ? "execution_checklist" : "task_card",
      checklistComplete: checklist?.ready === true,
    };
  }

  return (
    <AssignedTaskExecutionShell
      {...props}
      methodInstrument={methodInstrument}
      doneDisabled={checklist?.ready !== true}
      resultPayload={resultPayload}
    />
  );
}
