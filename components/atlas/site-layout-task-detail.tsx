"use client";

import { useState } from "react";

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
};

type LayoutDimensions = {
  bed_width_ft?: unknown;
  walkway_width_ft?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function layoutDimensions(value: unknown): LayoutDimensions {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LayoutDimensions : {};
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

export default function SiteLayoutTaskDetail({ task, assignee, initialReadiness }: Props) {
  const metadata = task.metadata ?? {};
  const dimensions = layoutDimensions(metadata.layout_dimensions);
  const bedWidth = positiveNumber(dimensions.bed_width_ft);
  const walkwayWidth = positiveNumber(dimensions.walkway_width_ft);
  const materialsNote = text(metadata.materials_note);
  const steps = stringList(metadata.execution_how);
  const resources = (task.resource_requirements ?? []).filter((requirement) => requirement.resource_label || requirement.note);
  const subject = text(metadata.display_subject) || text(metadata.display_location) || task.title;
  const zone = text(metadata.collection_zone) || text(metadata.display_location) || undefined;
  const action = text(metadata.display_action) || "Measure + stake/string";
  const workerFacing = assignee.key !== "owner";
  const executable = !workerFacing || initialReadiness.executable === true;
  const waiting = workerFacing && initialReadiness.ok && initialReadiness.executable === false ? initialReadiness.presentation : null;
  const readinessFailed = workerFacing && (!initialReadiness.ok || typeof initialReadiness.executable !== "boolean");
  const [saving, setSaving] = useState(false);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  const completion = executable ? (
    <div className="atlas-setup-finish">
      <div className="atlas-setup-finish-buttons">
        <button type="button" className="primary" disabled={saving} onClick={() => void transition("done")}>{saving ? "Saving…" : "Done"}</button>
        <button type="button" disabled={saving} onClick={() => setUnfinishedOpen((open) => !open)}>Unfinished</button>
      </div>
      {unfinishedOpen ? (
        <section className="atlas-setup-unfinished">
          <strong>What happened?</strong>
          <div>
            <button type="button" disabled={saving} onClick={() => { const note = window.prompt("What is left?", "")?.trim(); if (note) void transition("partial", note); }}>Partly done</button>
            <button type="button" disabled={saving} onClick={() => { const note = window.prompt("What problem did you find?", "")?.trim(); if (note) void transition("blocked", note); }}>Problem found</button>
          </div>
        </section>
      ) : null}
      {message ? <p className="atlas-setup-message">{message}</p> : null}
    </div>
  ) : undefined;

  return (
    <main className="atlas-setup-shell" data-atlas-site-layout-card="true">
      <style>{`
        .atlas-setup-shell { min-height:100%; padding:18px 14px 120px; background:var(--atlas-app-background,#f4efe6); }
        .atlas-setup-body { width:min(100%,520px); margin:0 auto; }
        .atlas-setup-section { display:grid; gap:12px; padding:20px 22px; border-bottom:1px solid rgba(215,204,189,.62); }
        .atlas-setup-section > header span, .atlas-setup-materials > small, .atlas-setup-waiting > small {
          color:#858bb8; font-size:10px; line-height:1; font-weight:950; letter-spacing:.11em; text-transform:uppercase;
        }
        .atlas-setup-steps { margin:0; padding:0; list-style:none; display:grid; gap:0; }
        .atlas-setup-steps li { position:relative; min-height:48px; padding:5px 0 14px 40px; color:#505363; font-size:15px; line-height:1.35; font-weight:760; }
        .atlas-setup-steps li::before { content:""; position:absolute; left:2px; top:14px; width:25px; height:1px; background:rgba(86,89,112,.42); }
        .atlas-setup-facts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
        .atlas-setup-fact { min-height:64px; display:grid; gap:6px; align-content:center; padding:11px 12px; border:1px solid rgba(139,145,194,.2); border-radius:14px; background:rgba(248,246,238,.58); }
        .atlas-setup-fact small { color:#858bb8; font-size:9px; font-weight:950; letter-spacing:.1em; text-transform:uppercase; }
        .atlas-setup-fact strong { color:var(--atlas-text); font-size:18px; line-height:1.05; font-weight:950; }
        .atlas-setup-materials { display:grid; gap:7px; }
        .atlas-setup-materials p { margin:0; color:#555866; font-size:14px; line-height:1.45; font-weight:690; }
        .atlas-setup-resource-list { display:grid; gap:6px; margin:3px 0 0; padding:0; list-style:none; }
        .atlas-setup-resource-list li { display:flex; align-items:baseline; justify-content:space-between; gap:10px; padding:8px 10px; border-radius:10px; background:rgba(248,246,238,.58); color:#4c4f5d; font-size:13px; font-weight:760; }
        .atlas-setup-resource-list span { color:#777b8d; font-size:11px; }
        .atlas-setup-waiting { display:grid; gap:8px; padding:20px 22px 24px; }
        .atlas-setup-waiting strong { color:#414352; font-size:19px; }
        .atlas-setup-waiting p { margin:0; color:#5f606a; font-size:14px; line-height:1.45; }
        .atlas-setup-finish { display:grid; gap:10px; }
        .atlas-setup-finish-buttons { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
        .atlas-setup-finish button { min-height:48px; border:1px solid rgba(139,145,194,.25); border-radius:15px; background:rgba(255,255,255,.82); color:#676a7d; padding:9px 10px; font:inherit; font-size:13px; font-weight:900; }
        .atlas-setup-finish button.primary { background:rgba(214,225,177,.72); color:#515b34; }
        .atlas-setup-unfinished { display:grid; gap:9px; padding:12px; border:1px solid rgba(207,196,179,.72); border-radius:15px; background:rgba(250,248,239,.82); }
        .atlas-setup-unfinished > div { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
        .atlas-setup-message { margin:0; color:#7b5549; font-size:11px; font-weight:800; }
        @media (max-width:520px) { .atlas-setup-shell { padding-left:10px; padding-right:10px; } .atlas-setup-section,.atlas-setup-waiting { padding-left:18px; padding-right:18px; } }
      `}</style>
      <div className="atlas-setup-body">
        <AtlasTaskCardFrame
          family="Setup"
          familyDetail={action}
          title={subject}
          subtitle={zone}
          timing={task.due_date ? `Today · ${prettyDate(task.due_date)}` : undefined}
          completion={completion}
        >
          {steps.length ? (
            <section className="atlas-setup-section">
              <header><span>Steps</span></header>
              <ol className="atlas-setup-steps">{steps.map((step) => <li key={step}>{step}</li>)}</ol>
            </section>
          ) : null}

          {bedWidth !== null || walkwayWidth !== null || materialsNote || resources.length ? (
            <section className="atlas-setup-section" aria-label="Setup details">
              <header><span>Setup</span></header>
              {bedWidth !== null || walkwayWidth !== null ? (
                <div className="atlas-setup-facts">
                  {bedWidth !== null ? <div className="atlas-setup-fact"><small>Bed width</small><strong>{bedWidth} ft</strong></div> : null}
                  {walkwayWidth !== null ? <div className="atlas-setup-fact"><small>Walkway width</small><strong>{walkwayWidth} ft</strong></div> : null}
                </div>
              ) : null}
              {materialsNote || resources.length ? (
                <div className="atlas-setup-materials">
                  <small>Tools + materials</small>
                  {materialsNote ? <p>{materialsNote}</p> : null}
                  {resources.length ? (
                    <ul className="atlas-setup-resource-list">
                      {resources.map((requirement) => (
                        <li key={requirement.requirement_id}><b>{requirement.resource_label || requirement.note || "Required resource"}</b><span>{requirement.resource_status || requirement.status || "required"}</span></li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
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
