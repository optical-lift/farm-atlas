"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AssignedTaskExecutionShellProps, AssignedTaskOutcome } from "@/components/atlas/assigned-task-execution-shell";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import TaskDestinationContact from "@/components/atlas/task-destination-contact";
import { useTaskFocusNavigation } from "@/components/atlas/task-focus-navigation-boundary";
import { taskDestinationContact } from "@/lib/atlas/task-destination-contact";
import { atlasActionForTask } from "@/lib/atlas/task-display";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

function metadataText(task: AssignedTaskExecutionShellProps["task"], key: string) {
  const value = task.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(task: AssignedTaskExecutionShellProps["task"], key: string) {
  const value = task.metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function smartText(value: string) {
  return value.replaceAll("'", "’");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function destinationSubtitle(task: AssignedTaskExecutionShellProps["task"]) {
  const explicit = metadataText(task, "destination_summary") || metadataText(task, "task_card_subtitle");
  if (explicit) return smartText(explicit);

  const action = metadataText(task, "display_action") || atlasActionForTask(task);
  const subject = metadataText(task, "display_subject");
  let value = metadataText(task, "execution_do") || task.title;

  if (action && value.toLowerCase().startsWith(`${action.toLowerCase()} `)) {
    value = value.slice(action.length).trim();
  }
  if (subject) {
    value = value.replace(new RegExp(`\\s+at\\s+${escapeRegExp(subject)}`, "i"), "");
  }

  value = value.trim();
  if (!value) return undefined;
  return smartText(value.charAt(0).toUpperCase() + value.slice(1));
}

function durationLabel(totalMinutes: number | null) {
  if (!totalMinutes || totalMinutes <= 0) return null;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours && minutes) return `${hours} hr ${minutes} min max`;
  if (hours) return `${hours} hr max`;
  return `${minutes} min max`;
}

function destinationTiming(task: AssignedTaskExecutionShellProps["task"]) {
  const explicit = metadataText(task, "destination_timing_label") || metadataText(task, "task_card_timing");
  if (explicit) return explicit;

  const rawWindow = metadataText(task, "day_window") || metadataText(task, "work_window_key") || metadataText(task, "window_key");
  const windowLabel = rawWindow ? rawWindow.charAt(0).toUpperCase() + rawWindow.slice(1) : null;
  const duration = durationLabel(metadataNumber(task, "maximum_total_minutes"));
  return [windowLabel, duration].filter(Boolean).join(" · ") || undefined;
}

export function isDestinationTask(task: AssignedTaskExecutionShellProps["task"]) {
  return taskDestinationContact(task) !== null;
}

export default function DestinationAssignedTaskCard({ task, assignee }: AssignedTaskExecutionShellProps) {
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [saving, setSaving] = useState<AssignedTaskOutcome | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const navigation = useTaskFocusNavigation(assignee.listPath);
  const destination = taskDestinationContact(task);

  useEffect(() => {
    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; label?: string }) => setWeatherLabel(data.ok && data.label ? data.label : "weather unavailable"))
      .catch(() => setWeatherLabel("weather unavailable"));
  }, []);

  async function transition(outcome: AssignedTaskOutcome, note = "") {
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
        },
      });
      if (outcome === "done") navigation.complete(task.task_id);
      else navigation.leave();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(null);
    }
  }

  const family = metadataText(task, "display_action") || atlasActionForTask(task) || "Task";
  const title = smartText(metadataText(task, "display_subject") || task.title);
  const subtitle = destinationSubtitle(task);
  const timing = destinationTiming(task);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell" data-atlas-destination-task-card="true">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={navigation.returnPath} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{assignee.label}</span>
          </Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href={navigation.returnPath} className="atlas-note-plus" aria-label={`Back to ${assignee.label} work`}>↩</Link>
        </header>

        <div className="atlas-task-page-body">
          <AtlasTaskCardFrame
            family={family}
            familyDetail="off-site"
            title={title}
            subtitle={subtitle}
            timing={timing}
            onDone={() => void transition("done")}
            onUnfinished={() => setUnfinishedOpen((open) => !open)}
            completionDisabled={Boolean(saving)}
          >
            <TaskDestinationContact destination={destination} />
          </AtlasTaskCardFrame>

          {unfinishedOpen ? (
            <section className="atlas-task-unfinished-panel atlas-task-result-unfinished" data-atlas-destination-unfinished="true">
              <strong>What happened?</strong>
              <div className="atlas-task-unfinished-grid">
                <button type="button" disabled={Boolean(saving)} onClick={() => void transition("partial", window.prompt("What is left?", "")?.trim() || "Partly done")}>Partly done</button>
                <button type="button" className="blocked" disabled={Boolean(saving)} onClick={() => void transition("blocked", window.prompt("What problem did you find?", "")?.trim() || "Problem found")}>Problem found</button>
              </div>
            </section>
          ) : null}
          {message ? <p className="atlas-task-page-message">{message}</p> : null}
        </div>
      </section>
    </main>
  );
}
