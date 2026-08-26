"use client";

import { useState, type ReactNode } from "react";

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

      {unfinishedOpen ? (
        <section className="atlas-setup-unfinished">
          <strong>What happened?</strong>
          <div>
            <button type="button" disabled={saving} onClick={() => { const note = window.prompt("What is left?", "")?.trim(); if (note) void transition("partial", note); }}>Partly done</button>
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
        .atlas-setup-waiting > small {
          color:#858bb8; font-size:10px; line-height:1; font-weight:950; letter-spacing:.15em; text-transform:uppercase;
        }
        .atlas-setup-tool-rows { display:grid; }
        .atlas-setup-tool-row { min-height:46px; display:flex; align-items:center; padding:0 18px; border-top:1px solid rgba(223,215,202,.48); }
        .atlas-setup-tool-row strong { color:var(--atlas-text); font-size:14px; line-height:1.15; font-weight:910; }
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
            completionDisabled={saving}
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
