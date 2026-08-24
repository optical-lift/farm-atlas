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
  recipeLabel?: string | null;
  recipeTools?: string[];
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
  ) : false;

  return (
    <main className="atlas-setup-shell" data-atlas-site-layout-card="true" data-atlas-setup-display="task-card-lab-v1">
      <style>{`
        .atlas-setup-shell { min-height:100%; padding:18px 14px 120px; background:var(--atlas-app-background,#f4efe6); }
        .atlas-setup-body { width:min(100%,520px); margin:0 auto; }
        .atlas-setup-tools { padding:20px 22px 24px; border-top:1px solid rgba(215,204,189,.62); }
        .atlas-setup-tools > small, .atlas-setup-waiting > small {
          display:block; color:#858bb8; font-size:10px; line-height:1; font-weight:950; letter-spacing:.11em; text-transform:uppercase;
        }
        .atlas-setup-tool-list { margin:12px 0 0; padding:0; list-style:none; display:grid; }
        .atlas-setup-tool-list li { min-height:46px; display:flex; align-items:center; border-top:1px solid rgba(139,145,194,.16); color:#454858; font-size:15px; line-height:1.2; font-weight:820; }
        .atlas-setup-tool-list li:first-child { border-top:0; }
        .atlas-setup-waiting { display:grid; gap:8px; padding:20px 22px 24px; border-top:1px solid rgba(215,204,189,.62); }
        .atlas-setup-waiting strong { color:#414352; font-size:19px; }
        .atlas-setup-waiting p { margin:0; color:#5f606a; font-size:14px; line-height:1.45; }
        .atlas-setup-finish { display:grid; gap:10px; }
        .atlas-setup-finish-buttons { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
        .atlas-setup-finish button { min-height:48px; border:1px solid rgba(139,145,194,.25); border-radius:15px; background:rgba(255,255,255,.82); color:#676a7d; padding:9px 10px; font:inherit; font-size:13px; font-weight:900; }
        .atlas-setup-finish button.primary { background:rgba(214,225,177,.72); color:#515b34; }
        .atlas-setup-unfinished { display:grid; gap:9px; padding:12px; border:1px solid rgba(207,196,179,.72); border-radius:15px; background:rgba(250,248,239,.82); }
        .atlas-setup-unfinished > div { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
        .atlas-setup-message { margin:0; color:#7b5549; font-size:11px; font-weight:800; }
        @media (max-width:520px) { .atlas-setup-shell { padding-left:10px; padding-right:10px; } .atlas-setup-tools,.atlas-setup-waiting { padding-left:18px; padding-right:18px; } }
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
