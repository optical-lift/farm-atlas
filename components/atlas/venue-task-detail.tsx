"use client";

import { useEffect, useMemo, useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskInstrumentContext,
  type AssignedTaskOutcome,
} from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type ChecklistItem = {
  itemId: string;
  itemKey: string;
  label: string;
  sortOrder: number;
  required: boolean;
  checked: boolean;
  checkedAt: string | null;
  crossedOut?: boolean;
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

function requestError(data: ChecklistResponse) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  return data.error?.message || "Atlas could not update this station.";
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

function stationInformation(task: AtlasTaskCard) {
  const value = task.metadata?.free_thursday_service_rule;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  const rule = value as Record<string, unknown>;
  const information: string[] = [];
  if (typeof rule.coffee === "string" && rule.coffee.trim()) information.push(rule.coffee.trim());
  if (typeof rule.mugs === "string" && rule.mugs.trim()) information.push(rule.mugs.trim());
  if (rule.coldBrew === false) information.push("No cold brew");
  return information;
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

export default function VenueTaskDetail(props: Props) {
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
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Station details unavailable.");
      });
    return () => { cancelled = true; };
  }, [task.task_id]);

  const station = metadataText(task, "display_location") || task.zone_label || "Venue";
  const information = useMemo(() => stationInformation(task), [task]);
  const actionItems = useMemo(
    () => (checklist?.items ?? [])
      .filter((item) => item.crossedOut !== true)
      .sort((left, right) => left.sortOrder - right.sortOrder),
    [checklist],
  );

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
          ? nextChecked || !candidate.required || candidate.crossedOut === true
          : candidate.checked || !candidate.required || candidate.crossedOut === true),
      } : current);
      setChecklist(await writeChecklistItem(task.task_id, item.itemKey, nextChecked));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Station update failed.");
      try {
        setChecklist(await readChecklist(task.task_id));
      } catch {
        // Keep the last known station state if the authoritative reread also fails.
      }
    } finally {
      setSavingItem(null);
    }
  }

  function methodInstrument(context: AssignedTaskInstrumentContext) {
    const busy = Boolean(savingItem) || context.busy;
    return (
      <>
        <style>{`
          .atlas-venue-station { margin:0 28px 28px; border-top:1px solid rgba(68,65,89,.12); }
          .atlas-venue-station__head { padding:20px 0 14px; }
          .atlas-venue-station__head span, .atlas-venue-station__actions h2 { display:block; margin:0; color:#7772ad; font-size:.72rem; font-weight:900; letter-spacing:.13em; text-transform:uppercase; }
          .atlas-venue-station__head strong { display:block; margin-top:5px; color:#29293e; font-size:1.16rem; line-height:1.2; }
          .atlas-venue-station__info { display:flex; flex-wrap:wrap; gap:7px; margin:0 0 18px; padding:0; list-style:none; }
          .atlas-venue-station__info li { padding:8px 10px; border-radius:10px; background:#f2efe7; color:#5e5b62; font-size:.8rem; font-weight:700; line-height:1.25; }
          .atlas-venue-station__actions h2 { margin-bottom:9px; }
          .atlas-venue-station__items { display:grid; gap:8px; }
          .atlas-venue-station__item { width:100%; display:grid; grid-template-columns:32px 1fr; align-items:center; gap:11px; padding:12px 13px; border:1px solid rgba(68,65,89,.14); border-radius:14px; background:#fffdf8; color:#2d2d43; text-align:left; font:inherit; font-weight:740; line-height:1.25; }
          .atlas-venue-station__item:disabled { opacity:.66; }
          .atlas-venue-station__item.is-checked { background:#eef3df; color:#55603a; border-color:rgba(97,112,59,.22); }
          .atlas-venue-station__mark { width:28px; height:28px; display:grid; place-items:center; border:2px solid #aaa8b2; border-radius:9px; background:#fff; font-size:.95rem; font-weight:950; }
          .atlas-venue-station__item.is-checked .atlas-venue-station__mark { border-color:#829252; background:#dce8ba; }
          .atlas-venue-station__loading, .atlas-venue-station__note, .atlas-venue-station__message { margin:0; padding:10px 0; color:#777; font-size:.84rem; line-height:1.35; }
          .atlas-venue-station__note { padding-top:12px; }
          .atlas-venue-station__message { color:#704d43; }
          @media (max-width:560px) { .atlas-venue-station { margin-left:21px; margin-right:21px; } }
        `}</style>
        <section className="atlas-venue-station" aria-label={`Venue station: ${station}`} data-atlas-method-instrument="venue-station">
          <header className="atlas-venue-station__head">
            <span>Venue</span>
            <strong>Station: {station}</strong>
          </header>
          {information.length ? (
            <ul className="atlas-venue-station__info" aria-label="Station information">
              {information.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
          {!checklist ? (
            <p className="atlas-venue-station__loading">Loading station…</p>
          ) : (
            <section className="atlas-venue-station__actions" aria-label="Things to do">
              <h2>Do</h2>
              <div className="atlas-venue-station__items">
                {actionItems.map((item) => (
                  <button
                    type="button"
                    className={`atlas-venue-station__item${item.checked ? " is-checked" : ""}`}
                    key={item.itemKey}
                    aria-pressed={item.checked}
                    disabled={busy}
                    onClick={() => void toggle(item)}
                  >
                    <span className="atlas-venue-station__mark" aria-hidden="true">{item.checked ? "✓" : ""}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {checklist && !checklist.ready ? <p className="atlas-venue-station__note">Finish these before marking the station ready.</p> : null}
          {message ? <p className="atlas-venue-station__message">{message}</p> : null}
        </section>
      </>
    );
  }

  function resultPayload(outcome: AssignedTaskOutcome) {
    return {
      completion_source: outcome === "done" ? "venue_station" : "task_card",
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
