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
  sectionKey?: string | null;
  sectionLabel?: string | null;
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
  return data.error?.message || "Atlas could not update this venue card.";
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

function stageIndex(stage: VenueStage) {
  return TRAIL.findIndex((candidate) => candidate.key === stage);
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
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Venue details unavailable.");
      });
    return () => { cancelled = true; };
  }, [task.task_id]);

  const station = metadataText(task, "display_location") || task.zone_label || "Venue";
  const information = useMemo(() => stationInformation(task), [task]);
  const cycleStageRaw = metadataText(task, "venue_cycle_stage");
  const cycleStage = cycleStageRaw && TRAIL.some((candidate) => candidate.key === cycleStageRaw)
    ? cycleStageRaw as VenueStage
    : null;
  const interaction = metadataText(task, "venue_interaction_method") || "execution";
  const eventKind = metadataText(task, "community_event_kind");
  const actionItems = useMemo(
    () => (checklist?.items ?? [])
      .filter((item) => item.crossedOut !== true)
      .sort((left, right) => left.sortOrder - right.sortOrder),
    [checklist],
  );
  const sections = useMemo(() => {
    const grouped = new Map<string, { key: string; label: string; items: ChecklistItem[] }>();
    for (const item of actionItems) {
      const key = item.sectionKey || "venue";
      const label = item.sectionLabel || station;
      const current = grouped.get(key);
      if (current) current.items.push(item);
      else grouped.set(key, { key, label, items: [item] });
    }
    return Array.from(grouped.values());
  }, [actionItems, station]);

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
      setMessage(error instanceof Error ? error.message : "Venue update failed.");
      try {
        setChecklist(await readChecklist(task.task_id));
      } catch {
        // Keep the last known state if the authoritative reread also fails.
      }
    } finally {
      setSavingItem(null);
    }
  }

  function methodInstrument(context: AssignedTaskInstrumentContext) {
    const busy = Boolean(savingItem) || context.busy;
    const currentTrailIndex = cycleStage ? stageIndex(cycleStage) : -1;
    const reminderMode = interaction === "resource";
    return (
      <>
        <style>{`
          .atlas-venue-cycle { margin:0 28px 28px; border-top:1px solid rgba(68,65,89,.12); }
          .atlas-venue-cycle__trail { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:5px; padding:18px 0 8px; }
          .atlas-venue-cycle__trail span { min-width:0; padding:8px 7px 7px; border-radius:10px; background:#f3f0ea; color:#8a8790; }
          .atlas-venue-cycle__trail b { display:block; font-size:.72rem; letter-spacing:.08em; text-transform:uppercase; }
          .atlas-venue-cycle__trail small { display:block; margin-top:2px; font-size:.62rem; line-height:1.1; opacity:.72; }
          .atlas-venue-cycle__trail .is-done { background:#eef1df; color:#667043; }
          .atlas-venue-cycle__trail .is-now { background:#e8e3f4; color:#625c91; box-shadow:inset 0 0 0 1px rgba(98,92,145,.12); }
          .atlas-venue-cycle__head { padding:14px 0 12px; }
          .atlas-venue-cycle__head span, .atlas-venue-section__head span { display:block; margin:0; color:#7772ad; font-size:.7rem; font-weight:900; letter-spacing:.13em; text-transform:uppercase; }
          .atlas-venue-cycle__head strong { display:block; margin-top:5px; color:#29293e; font-size:1.13rem; line-height:1.2; }
          .atlas-venue-cycle__head small { display:block; margin-top:5px; color:#7b7881; font-size:.78rem; }
          .atlas-venue-cycle__info { display:flex; flex-wrap:wrap; gap:7px; margin:0 0 17px; padding:0; list-style:none; }
          .atlas-venue-cycle__info li { padding:8px 10px; border-radius:10px; background:#f2efe7; color:#5e5b62; font-size:.8rem; font-weight:700; line-height:1.25; }
          .atlas-venue-cycle__key { display:flex; gap:13px; margin:2px 0 13px; color:#99959f; font-size:.67rem; font-weight:700; }
          .atlas-venue-sections { display:grid; gap:13px; }
          .atlas-venue-section { position:relative; padding:14px 14px 8px; border:1px solid rgba(68,65,89,.12); border-radius:15px; background:#fffdf8; }
          .atlas-venue-section__head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:8px; }
          .atlas-venue-section__head strong { color:#2f2e42; font-size:1rem; }
          .atlas-venue-section__head small { color:#aaa6ae; font-size:.7rem; }
          .atlas-venue-items { display:grid; }
          .atlas-venue-item { width:100%; display:grid; grid-template-columns:25px 1fr auto; align-items:center; gap:10px; min-height:42px; padding:7px 0; border:0; border-top:1px solid rgba(68,65,89,.08); background:transparent; color:#3c3a47; text-align:left; font:inherit; font-weight:720; line-height:1.22; }
          .atlas-venue-item:first-child { border-top:0; }
          .atlas-venue-item:disabled { opacity:.62; }
          .atlas-venue-item.is-checked { color:#858782; text-decoration:line-through; text-decoration-thickness:1px; }
          .atlas-venue-item__mark { width:20px; height:20px; display:grid; place-items:center; border:1.5px solid #b0adb4; border-radius:50%; background:#fff; font-size:.72rem; font-weight:950; }
          .atlas-venue-item.is-checked .atlas-venue-item__mark { border-color:#87945f; background:#e2e9c8; color:#65713f; }
          .atlas-venue-item__required { color:#7772ad; font-size:.62rem; font-weight:900; letter-spacing:.08em; text-transform:uppercase; text-decoration:none; }
          .atlas-venue-cycle__loading, .atlas-venue-cycle__note, .atlas-venue-cycle__message { margin:0; padding:10px 0; color:#777; font-size:.84rem; line-height:1.35; }
          .atlas-venue-cycle__note { padding-top:12px; }
          .atlas-venue-cycle__message { color:#704d43; }
          @media (max-width:560px) { .atlas-venue-cycle { margin-left:21px; margin-right:21px; } .atlas-venue-cycle__trail span { padding-left:5px; padding-right:5px; } }
        `}</style>
        <section className="atlas-venue-cycle" aria-label="Community Thursday venue task" data-atlas-method-instrument="venue-cycle">
          {cycleStage ? (
            <div className="atlas-venue-cycle__trail" aria-label="Community Thursday task trail">
              {TRAIL.map((step, index) => (
                <span key={step.key} className={index < currentTrailIndex ? "is-done" : index === currentTrailIndex ? "is-now" : ""}>
                  <b>{step.label}</b>
                  <small>Community Thursday</small>
                </span>
              ))}
            </div>
          ) : null}
          <header className="atlas-venue-cycle__head">
            <span>Venue</span>
            <strong>{cycleStage ? `${cycleStage[0].toUpperCase()}${cycleStage.slice(1)} Community Thursday` : `Station: ${station}`}</strong>
            {eventKind ? <small>{eventKind === "ticketed_seasonal_evening" ? "Ticketed seasonal evening" : "Free community morning"} · same initial Venue grammar</small> : null}
          </header>
          {information.length ? (
            <ul className="atlas-venue-cycle__info" aria-label="Venue information">
              {information.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
          {reminderMode ? <div className="atlas-venue-cycle__key"><span>tap to cross off</span><span>room + station memory aids</span></div> : null}
          {!checklist ? (
            <p className="atlas-venue-cycle__loading">Loading venue card…</p>
          ) : (
            <div className="atlas-venue-sections">
              {sections.map((section) => (
                <section className="atlas-venue-section" key={section.key} aria-label={section.label}>
                  <header className="atlas-venue-section__head">
                    <strong>{section.label}</strong>
                    <small>{section.items.length} {section.items.length === 1 ? "item" : "items"}</small>
                  </header>
                  <div className="atlas-venue-items">
                    {section.items.map((item) => (
                      <button
                        type="button"
                        className={`atlas-venue-item${item.checked ? " is-checked" : ""}`}
                        key={item.itemKey}
                        aria-pressed={item.checked}
                        disabled={busy}
                        onClick={() => void toggle(item)}
                      >
                        <span className="atlas-venue-item__mark" aria-hidden="true">{item.checked ? "✓" : ""}</span>
                        <span>{item.label}</span>
                        {item.required ? <span className="atlas-venue-item__required">required</span> : null}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {checklist && !checklist.ready ? <p className="atlas-venue-cycle__note">Finish the required action before marking this Venue card ready.</p> : null}
          {message ? <p className="atlas-venue-cycle__message">{message}</p> : null}
        </section>
      </>
    );
  }

  function resultPayload(outcome: AssignedTaskOutcome) {
    return {
      completion_source: outcome === "done" ? "venue_cycle" : "task_card",
      checklistComplete: checklist?.ready === true,
      venueCycleStage: cycleStage,
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
