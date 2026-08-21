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

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function requestError(data: ChecklistResponse) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  return data.error?.message || "Atlas could not update the crop-move checklist.";
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

function cropMoveView(task: AtlasTaskCard) {
  const metadata = task.metadata ?? {};
  const subject = text(metadata.display_subject) || task.title;
  const zone = text(task.zone_label) || text(metadata.collection_zone) || "Elm Farm";
  const isPotUp = task.task_type === "pot_up" || task.action_key === "pot_up";

  if (isPotUp) {
    const trayCount = numberValue(metadata.batch_item_count);
    const total = numberValue(metadata.batch_total_quantity);
    const container = text(metadata.container_kind) || "plug trays";
    return {
      family: "Pot Up",
      familyDetail: "crop move",
      title: text(metadata.execution_do) || task.title,
      subtitle: zone,
      timing: [trayCount ? `${trayCount} trays` : "", total ? `${total} plants` : ""].filter(Boolean).join(" · "),
      sourceTitle: subject,
      sourceDetail: "Seedlings ready to move on",
      destinationTitle: trayCount ? `${trayCount} full ${container}s` : container,
      destinationDetail: total ? `${total} plants total` : text(metadata.state_effect),
    };
  }

  const clumpCount = numberValue(metadata.source_clump_count);
  const source = text(metadata.source_area) || text(metadata.execution_place) || zone;
  return {
    family: "Divide",
    familyDetail: "crop move",
    title: text(metadata.display_action) ? `${text(metadata.display_action)} ${subject}` : task.title,
    subtitle: zone,
    timing: clumpCount ? `${clumpCount} source clumps` : "",
    sourceTitle: source,
    sourceDetail: clumpCount ? `${clumpCount} established clumps` : subject,
    destinationTitle: `${zone} · drifts`,
    destinationDetail: `Re-establish ${subject} as divided drifts`,
  };
}

export default function CropMoveTaskDetail(props: Props) {
  const { task } = props;
  const templateKey = text(task.metadata?.execution_checklist_template_key);
  const hasChecklist = Boolean(templateKey);
  const [checklist, setChecklist] = useState<ExecutionChecklist | null>(null);
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const view = useMemo(() => cropMoveView(task), [task]);

  useEffect(() => {
    if (!hasChecklist) {
      setChecklist(null);
      return;
    }
    let cancelled = false;
    setChecklist(null);
    setMessage(null);
    void readChecklist(task.task_id)
      .then((value) => { if (!cancelled) setChecklist(value); })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Checklist unavailable."); });
    return () => { cancelled = true; };
  }, [hasChecklist, task.task_id]);

  async function toggle(item: ChecklistItem) {
    const nextChecked = !item.checked;
    try {
      setSavingItem(item.itemKey);
      setMessage(null);
      setChecklist((current) => current ? {
        ...current,
        items: current.items.map((candidate) => candidate.itemKey === item.itemKey ? { ...candidate, checked: nextChecked } : candidate),
        completeCount: current.completeCount + (nextChecked ? 1 : -1),
        ready: current.items.every((candidate) => candidate.itemKey === item.itemKey
          ? nextChecked || !candidate.required
          : candidate.checked || !candidate.required),
      } : current);
      setChecklist(await writeChecklistItem(task.task_id, item.itemKey, nextChecked));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checklist update failed.");
      try { setChecklist(await readChecklist(task.task_id)); } catch { /* preserve last known state */ }
    } finally {
      setSavingItem(null);
    }
  }

  function methodInstrument(context: AssignedTaskInstrumentContext) {
    const busy = context.busy || Boolean(savingItem);
    return (
      <>
        <style>{`
          .atlas-crop-move { margin:0 28px 28px; }
          .atlas-crop-move__identity { padding:18px 0 14px; border-top:1px solid rgba(68,65,89,.12); }
          .atlas-crop-move__identity small { display:block; color:#7772ad; font-size:.72rem; font-weight:900; letter-spacing:.13em; text-transform:uppercase; }
          .atlas-crop-move__identity strong { display:block; margin-top:5px; color:#29293e; font-size:1.2rem; line-height:1.2; }
          .atlas-crop-move__identity span { display:block; margin-top:4px; color:#777; font-size:.84rem; font-weight:700; }
          .atlas-crop-move__places { display:grid; grid-template-columns:1fr 34px 1fr; align-items:stretch; gap:8px; }
          .atlas-crop-move__place { padding:16px; border:1px solid rgba(68,65,89,.14); border-radius:16px; background:#fffdf8; }
          .atlas-crop-move__place small { display:block; color:#7772ad; font-size:.68rem; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
          .atlas-crop-move__place strong { display:block; margin-top:5px; color:#2d2d43; font-size:1rem; line-height:1.22; }
          .atlas-crop-move__place span { display:block; margin-top:5px; color:#777; font-size:.79rem; line-height:1.35; }
          .atlas-crop-move__arrow { display:grid; place-items:center; color:#8a8797; font-size:1.2rem; font-weight:900; }
          .atlas-crop-move__checklist { margin-top:16px; border:1px solid rgba(68,65,89,.14); border-radius:16px; overflow:hidden; background:#fff; }
          .atlas-crop-move__checklist header { display:flex; justify-content:space-between; gap:12px; padding:14px 15px; background:#f5f3ed; }
          .atlas-crop-move__checklist header strong { color:#303045; font-size:.9rem; }
          .atlas-crop-move__checklist header span { color:#74717a; font-size:.78rem; font-weight:800; }
          .atlas-crop-move__items { display:grid; gap:7px; padding:10px; }
          .atlas-crop-move__item { width:100%; display:grid; grid-template-columns:28px 1fr; align-items:center; gap:10px; padding:11px 12px; border:1px solid rgba(68,65,89,.12); border-radius:12px; background:#fffdf8; text-align:left; font:inherit; color:#303045; font-weight:740; }
          .atlas-crop-move__item b { width:25px; height:25px; display:grid; place-items:center; border:2px solid #aaa8b2; border-radius:8px; background:#fff; }
          .atlas-crop-move__item.is-checked { background:#eef3df; color:#55603a; }
          .atlas-crop-move__item.is-checked b { border-color:#829252; background:#dce8ba; }
          .atlas-crop-move__message { margin:12px 0 0; color:#704d43; font-size:.83rem; }
          @media (max-width:560px) { .atlas-crop-move { margin-left:20px; margin-right:20px; } .atlas-crop-move__places { grid-template-columns:1fr; } .atlas-crop-move__arrow { min-height:22px; transform:rotate(90deg); } }
        `}</style>
        <section className="atlas-crop-move" data-atlas-method-instrument="crop-move">
          <header className="atlas-crop-move__identity">
            <small>{view.family} · {view.familyDetail}</small>
            <strong>{view.title}</strong>
            <span>{[view.subtitle, view.timing].filter(Boolean).join(" · ")}</span>
          </header>
          <div className="atlas-crop-move__places">
            <section className="atlas-crop-move__place"><small>Source</small><strong>{view.sourceTitle}</strong><span>{view.sourceDetail}</span></section>
            <div className="atlas-crop-move__arrow" aria-hidden="true">→</div>
            <section className="atlas-crop-move__place"><small>Destination</small><strong>{view.destinationTitle}</strong><span>{view.destinationDetail}</span></section>
          </div>
          {hasChecklist ? (
            <section className="atlas-crop-move__checklist" aria-label="Crop move checklist">
              <header><strong>{checklist?.title || "Move checklist"}</strong><span>{checklist ? `${checklist.completeCount} / ${checklist.totalCount}` : "Loading"}</span></header>
              <div className="atlas-crop-move__items">
                {(checklist?.items ?? []).sort((left, right) => left.sortOrder - right.sortOrder).map((item) => (
                  <button type="button" className={`atlas-crop-move__item${item.checked ? " is-checked" : ""}`} key={item.itemKey} disabled={busy} onClick={() => void toggle(item)}>
                    <b aria-hidden="true">{item.checked ? "✓" : ""}</b><span>{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {message ? <p className="atlas-crop-move__message">{message}</p> : null}
        </section>
      </>
    );
  }

  function resultPayload(outcome: AssignedTaskOutcome) {
    return {
      completion_source: outcome === "done" ? "crop_move_card" : "task_card",
      cropMoveFamily: view.family,
      checklistComplete: hasChecklist ? checklist?.ready === true : undefined,
    };
  }

  return <AssignedTaskExecutionShell {...props} methodInstrument={methodInstrument} doneDisabled={hasChecklist && checklist?.ready !== true} resultPayload={resultPayload} />;
}
