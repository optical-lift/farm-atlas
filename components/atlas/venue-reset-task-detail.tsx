"use client";

import { useEffect, useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import TaskPrimaryResultControls from "@/components/atlas/task-primary-result-controls";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = { task: AtlasTaskCard; childTasks: AtlasTaskCard[]; assignee: AtlasAssigneeConfig };
type ChecklistItem = { itemId: string; itemKey: string; sectionKey: string; sectionLabel: string; label: string; sortOrder: number; required: boolean; checked: boolean; checkedAt: string | null; interaction?: string | null };
type ExecutionChecklist = { taskId: string; title: string; completionLabel: string; items: ChecklistItem[]; totalCount: number; completeCount: number; ready: boolean };
type ChecklistResponse = { ok?: boolean; checklist?: ExecutionChecklist; error?: string | { message?: string }; details?: string };

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : ""; }
function textList(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : []; }
function humanize(value: string | null | undefined) { return (value || "reset").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function prettyDate(value: string | null | undefined) { if (!value) return ""; const date = new Date(`${value.slice(0, 10)}T12:00:00Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(date); }
function returnDestination(fallback: string) { const value = new URLSearchParams(window.location.search).get("returnTo"); return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback; }
function completeTaskExit(taskId: string, fallback: string) { const returnTo = returnDestination(fallback); const event = new CustomEvent("atlas:task-completed", { cancelable: true, detail: { taskId, returnTo } }); window.dispatchEvent(event); if (!event.defaultPrevented) window.location.assign(returnTo); }
function requestError(data: ChecklistResponse) { if (data.details) return data.details; if (typeof data.error === "string") return data.error; return data.error?.message || "Atlas could not update this reset."; }
function requestKey(taskId: string, itemKey: string, checked: boolean) { const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; return `${taskId}:${itemKey}:${checked ? "checked" : "reopened"}:${nonce}`; }

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

export default function VenueResetTaskDetail({ task, assignee }: Props) {
  const metadata = task.metadata ?? {};
  const templateKey = text(metadata.execution_checklist_template_key);
  const [checklist, setChecklist] = useState<ExecutionChecklist | null>(null);
  const [checklistFailed, setChecklistFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const location = text(metadata.venue_reset_location_label) || text(metadata.execution_place) || text(metadata.display_location) || text(task.zone_label) || "Elm Farm";
  const subject = text(metadata.display_subject) || location;
  const readyLabel = text(metadata.venue_reset_ready_label) || "Ready";
  const readyResult = text(metadata.venue_reset_ready_result) || text(metadata.execution_done_when) || text(metadata.state_effect) || "Location restored to its ready condition.";
  const resources = task.resource_requirements ?? [];
  const fallbackSteps = useMemo(() => {
    const combined = [...textList(metadata.detail_lines), ...textList(metadata.execution_how)];
    return Array.from(new Set(combined));
  }, [metadata.detail_lines, metadata.execution_how]);

  useEffect(() => {
    if (!templateKey) { setChecklist(null); setChecklistFailed(false); return; }
    let cancelled = false;
    setChecklist(null);
    setChecklistFailed(false);
    void readChecklist(task.task_id)
      .then((value) => { if (!cancelled) setChecklist(value); })
      .catch(() => { if (!cancelled) setChecklistFailed(true); });
    return () => { cancelled = true; };
  }, [task.task_id, templateKey]);

  async function toggle(item: ChecklistItem) {
    const nextChecked = !item.checked;
    try {
      setSaving(item.itemKey);
      setMessage(null);
      setChecklist((current) => current ? { ...current, items: current.items.map((candidate) => candidate.itemKey === item.itemKey ? { ...candidate, checked: nextChecked } : candidate) } : current);
      setChecklist(await writeChecklistItem(task.task_id, item.itemKey, nextChecked));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reset work update failed.");
      try { setChecklist(await readChecklist(task.task_id)); } catch { /* keep last known state */ }
    } finally { setSaving(null); }
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
        payload: { venueResetFamily: true, venueResetVersion: 2, completion_source: kind === "done" ? "venue_reset_card" : "task_card", checklistCompleteBeforeClose: checklist?.ready === true },
      });
      if (kind === "done") completeTaskExit(task.task_id, assignee.listPath);
      else window.location.assign(returnDestination(assignee.listPath));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Reset result failed."); }
    finally { setSaving(null); }
  }

  const busy = Boolean(saving);
  const requiredReady = !templateKey || checklistFailed || checklist?.ready === true;
  const workItems = checklist?.items.slice().sort((a, b) => a.sortOrder - b.sortOrder) ?? [];
  const completion = (
    <div className="atlas-reset-finish">
      <TaskPrimaryResultControls
        busy={busy}
        doneBusy={saving === "done"}
        doneDisabled={!requiredReady}
        unfinishedOpen={unfinishedOpen}
        onToggleUnfinished={() => setUnfinishedOpen((open) => !open)}
        onDone={() => void transition("done")}
      >
        <section className="atlas-task-unfinished-panel atlas-task-result-unfinished">
          <strong>What happened?</strong>
          <div className="atlas-task-unfinished-grid">
            <button type="button" disabled={busy} onClick={() => void transition("partial")}>Partly done</button>
            <button type="button" disabled={busy} onClick={() => void transition("blocked")}>Problem found</button>
          </div>
        </section>
      </TaskPrimaryResultControls>
      {message ? <p className="atlas-reset-message">{message}</p> : null}
    </div>
  );

  return (
    <main className="atlas-reset-shell" data-atlas-venue-reset="v2">
      <style>{`
        .atlas-reset-shell{min-height:100%;padding:18px 14px 120px;background:var(--atlas-app-background,#f4efe6)}
        .atlas-reset-shell>[data-atlas-task-card-frame]{width:min(100%,520px);margin:0 auto}
        .atlas-reset-trail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:12px 7px 16px;border-top:1px solid rgba(215,204,189,.62);border-bottom:1px solid rgba(215,204,189,.62)}
        .atlas-reset-trail span{position:relative;display:grid;gap:3px;justify-items:center;padding-top:22px;text-align:center;color:#9a9a93}
        .atlas-reset-trail span:before{content:"";position:absolute;z-index:2;top:3px;left:50%;width:10px;height:10px;transform:translateX(-50%);border:1.5px solid #a0a199;border-radius:50%;background:#fffefa}
        .atlas-reset-trail span:not(:last-child):after{content:"";position:absolute;top:8px;left:calc(50% + 7px);width:calc(100% - 14px);height:1px;background:rgba(185,183,171,.65)}
        .atlas-reset-trail span:nth-child(-n+2):before{border-color:#8e9279;background:#8e9279}.atlas-reset-trail span:nth-child(-n+2):after{background:rgba(142,146,121,.65)}
        .atlas-reset-trail span:nth-child(3):before{top:1px;width:15px;height:15px;border:2px solid #343542;background:#343542;box-shadow:0 0 0 4px rgba(201,192,198,.32)}
        .atlas-reset-trail b{font-size:9px;line-height:1.05;font-weight:950;color:#85867f}.atlas-reset-trail span:nth-child(3) b{color:var(--atlas-text)}.atlas-reset-trail small{font-size:7px;line-height:1.1;font-weight:760}
        .atlas-reset-key{display:flex;gap:16px;padding:12px 18px;border-bottom:1px solid rgba(215,204,189,.62);color:#8c8d85;font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
        .atlas-reset-stations{display:grid}.atlas-reset-station{position:relative;padding:17px 18px 17px 64px;border-bottom:1px solid rgba(215,204,189,.62);background:#fff}
        .atlas-reset-station:before{content:"";position:absolute;left:31px;top:0;bottom:0;width:1px;background:rgba(133,139,184,.34)}.atlas-reset-station:after{content:"";position:absolute;left:25px;top:27px;width:12px;height:12px;border:2px solid #858bb8;border-radius:50%;background:#fff}
        .atlas-reset-station header{display:grid;gap:3px;margin-bottom:10px}.atlas-reset-station header small{color:#858bb8;font-size:8px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.atlas-reset-station header strong{color:var(--atlas-text);font-size:20px;line-height:1.05;font-weight:950;letter-spacing:-.035em}.atlas-reset-station header span{color:#85867f;font-size:10px;font-weight:800}
        .atlas-reset-rows{display:grid}.atlas-reset-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;min-height:50px;padding:9px 0;border-top:1px solid rgba(215,204,189,.5);color:#343542}.atlas-reset-row:first-child{border-top:0}.atlas-reset-row strong{font-size:13px;line-height:1.2;font-weight:900}.atlas-reset-row small{color:#8b8c84;font-size:9px;font-weight:800}
        button.atlas-reset-row{width:100%;border-left:0;border-right:0;border-bottom:0;background:transparent;text-align:left;font:inherit}.atlas-reset-row[data-checked="true"] strong{text-decoration:line-through;color:#858782}.atlas-reset-row[data-checked="true"] small{color:#87945f}
        .atlas-reset-row.is-information{grid-template-columns:minmax(0,1fr);gap:3px;min-height:0;padding:10px 0;color:#565761}.atlas-reset-row.is-information strong{font-size:12px;font-weight:780}.atlas-reset-row.is-information small{font-size:8px;text-transform:uppercase;letter-spacing:.09em;color:#99988f}
        .atlas-reset-ready{display:grid;gap:4px;padding:16px 18px;background:rgba(214,225,177,.35)}.atlas-reset-ready span{color:#697146;font-size:9px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.atlas-reset-ready strong{color:#515b34;font-size:14px;line-height:1.3}
        .atlas-reset-message{margin:8px 0 0;color:#75594f;font-size:10px;line-height:1.35;font-weight:800}
        @media(max-width:520px){.atlas-reset-shell{padding-left:10px;padding-right:10px}.atlas-reset-station{padding-left:58px;padding-right:16px}.atlas-reset-station:before{left:27px}.atlas-reset-station:after{left:21px}}
      `}</style>
      <AtlasTaskCardFrame
        family="Venue"
        familyDetail="reset"
        title={subject}
        subtitle={humanize(task.action_key)}
        timing={text(metadata.display_due_label) || (task.due_date ? `Due ${prettyDate(task.due_date)}` : undefined)}
        completion={completion}
      >
        <div className="atlas-reset-trail" aria-label={`${subject} reset trail`}>
          <span><b>Location</b><small>{location}</small></span>
          <span><b>Tools</b><small>{resources.length ? `${resources.length} ready` : "none attached"}</small></span>
          <span><b>Reset</b><small>work now</small></span>
          <span><b>Ready</b><small>{readyLabel}</small></span>
        </div>
        <div className="atlas-reset-key"><span>location + tool truth</span><span>reset to ready</span></div>
        <div className="atlas-reset-stations">
          <section className="atlas-reset-station">
            <header><small>Location</small><strong>{location}</strong><span>{text(metadata.collection_zone) || "Elm Farm"}</span></header>
          </section>
          <section className="atlas-reset-station">
            <header><small>Tools</small><strong>{resources.length ? "Resources" : "No tools attached"}</strong></header>
            <div className="atlas-reset-rows">
              {resources.map((resource) => (
                <div className="atlas-reset-row" key={resource.requirement_id}>
                  <strong>{resource.resource_label || resource.resource_key || "Resource"}</strong>
                  <small>{text(resource.note) || humanize(resource.status || resource.resource_status)}</small>
                </div>
              ))}
            </div>
          </section>
          <section className="atlas-reset-station">
            <header><small>Reset work</small><strong>{text(metadata.execution_do) || task.title}</strong></header>
            <div className="atlas-reset-rows">
              {workItems.length ? workItems.map((item) => item.interaction === "information" ? (
                <div className="atlas-reset-row is-information" key={item.itemKey}>
                  <strong>{item.label}</strong><small>method</small>
                </div>
              ) : (
                <button type="button" className="atlas-reset-row" data-checked={item.checked ? "true" : "false"} key={item.itemKey} disabled={busy} onClick={() => void toggle(item)}>
                  <strong>{item.label}</strong><small>{item.checked ? "done" : item.required ? "required" : "tap to cross off"}</small>
                </button>
              )) : fallbackSteps.map((step) => <div className="atlas-reset-row is-information" key={step}><strong>{step}</strong><small>method</small></div>)}
            </div>
          </section>
        </div>
        <section className="atlas-reset-ready"><span>{readyLabel}</span><strong>{readyResult}</strong></section>
      </AtlasTaskCardFrame>
    </main>
  );
}
