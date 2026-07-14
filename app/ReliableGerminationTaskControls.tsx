"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

type GerminationTask = {
  id: string;
  cropLabel: string;
  variety: string | null;
  objectLabel: string;
};

type LookupResponse = {
  ok?: boolean;
  germinationCheck?: boolean;
  task?: GerminationTask;
  error?: string;
  details?: string;
};

function taskIdFromLocation() {
  const queryId = new URLSearchParams(window.location.search).get("taskId");
  if (queryId) return queryId;
  const match = window.location.pathname.match(/^\/task-focus\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function hideGenericControls(card: HTMLElement) {
  const selectors = [
    ".atlas-task-primary-actions",
    ".atlas-task-unfinished-panel",
    ".atlas-task-detail-card",
    ".atlas-task-record-card",
    ".atlas-task-page-kicker small",
    ".atlas-task-page-time-row",
  ];
  for (const selector of selectors) {
    const element = card.querySelector<HTMLElement>(selector);
    if (!element) continue;
    element.hidden = true;
    element.style.display = "none";
  }
}

function restoreGenericControls(card: HTMLElement) {
  const selectors = [
    ".atlas-task-primary-actions",
    ".atlas-task-detail-card",
    ".atlas-task-record-card",
    ".atlas-task-page-kicker small",
    ".atlas-task-page-time-row",
  ];
  for (const selector of selectors) {
    const element = card.querySelector<HTMLElement>(selector);
    if (!element) continue;
    element.hidden = false;
    element.style.removeProperty("display");
  }
}

function applyGerminationCard(card: HTMLElement, task: GerminationTask) {
  hideGenericControls(card);
  const kicker = card.querySelector<HTMLElement>(".atlas-task-page-kicker span");
  const title = card.querySelector<HTMLElement>("h1");
  if (kicker) kicker.textContent = "Check germination";
  if (title) title.textContent = `${task.cropLabel} · ${task.objectLabel}`.toUpperCase();
}

export default function ReliableGerminationTaskControls() {
  const pathname = usePathname();
  const [task, setTask] = useState<GerminationTask | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [standOpen, setStandOpen] = useState(false);
  const [standNote, setStandNote] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const isTaskRoute = pathname === "/task" || pathname.startsWith("/task-focus/");
    if (!isTaskRoute) return;

    let stopped = false;
    let lookupStarted = false;
    let recognizedTask: GerminationTask | null = null;

    async function mount() {
      if (stopped) return;
      const card = document.querySelector<HTMLElement>(".atlas-task-ticket-card");
      const taskId = taskIdFromLocation();
      if (!card || !taskId) return;

      let nextHost = card.querySelector<HTMLElement>("[data-reliable-germination-host]");
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.dataset.reliableGerminationHost = "true";
        const actions = card.querySelector(".atlas-task-primary-actions");
        if (actions) card.insertBefore(nextHost, actions);
        else card.appendChild(nextHost);
      }
      setHost(nextHost);

      if (recognizedTask) {
        applyGerminationCard(card, recognizedTask);
        return;
      }

      if (lookupStarted) return;
      lookupStarted = true;

      try {
        const response = await fetch(`/api/atlas/germination-check?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const data = (await response.json()) as LookupResponse;
        if (stopped) return;

        if (!response.ok || !data.ok || !data.germinationCheck || !data.task) {
          restoreGenericControls(card);
          return;
        }

        recognizedTask = data.task;
        applyGerminationCard(card, data.task);
        setTask(data.task);
      } catch (error) {
        restoreGenericControls(card);
        setMessage(error instanceof Error ? error.message : "Germination controls failed to load.");
      }
    }

    const interval = window.setInterval(() => void mount(), 250);
    const observer = new MutationObserver(() => void mount());
    observer.observe(document.body, { childList: true, subtree: true });
    void mount();

    return () => {
      stopped = true;
      window.clearInterval(interval);
      observer.disconnect();
    };
  }, [pathname]);

  async function submit(action: "not_yet" | "germinated", standQuality?: "good" | "spotty" | "poor") {
    if (!task) return;
    try {
      setSaving(standQuality || action);
      setMessage(null);
      const response = await fetch("/api/atlas/germination-check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ taskId: task.id, action, standQuality, standNote }),
      });
      const data = (await response.json()) as { ok?: boolean; nextDate?: string; error?: string; details?: string };
      if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Germination update failed.");

      setMessage(action === "not_yet" ? `Not yet logged. Check again ${data.nextDate ?? "tomorrow"}.` : "Germination logged.");
      window.setTimeout(() => window.location.assign("/"), 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Germination update failed.");
    } finally {
      setSaving(null);
    }
  }

  if (!host || !task) return null;

  return createPortal(
    <section className="atlas-germination-check-panel">
      <div className="atlas-germination-check-head">
        <span>{task.variety || task.cropLabel}</span>
        <strong>{task.objectLabel}</strong>
      </div>

      {!standOpen ? (
        <div className="atlas-germination-actions atlas-germination-primary-actions">
          <button type="button" className="good" disabled={Boolean(saving)} onClick={() => setStandOpen(true)}>Germinated</button>
          <button type="button" className="not-yet" disabled={Boolean(saving)} onClick={() => void submit("not_yet")}>
            {saving === "not_yet" ? "Saving…" : "Not yet"}
          </button>
        </div>
      ) : (
        <div className="atlas-germination-inline-log">
          <div className="atlas-germination-check-head">
            <span>Stand</span>
            <strong>How did it come up?</strong>
          </div>
          <label className="atlas-germination-note">
            <span>Optional note</span>
            <textarea value={standNote} onChange={(event) => setStandNote(event.target.value)} rows={3} />
          </label>
          <div className="atlas-germination-actions atlas-germination-stand-actions">
            <button type="button" className="good" disabled={Boolean(saving)} onClick={() => void submit("germinated", "good")}>{saving === "good" ? "Saving…" : "Good stand"}</button>
            <button type="button" className="spotty" disabled={Boolean(saving)} onClick={() => void submit("germinated", "spotty")}>{saving === "spotty" ? "Saving…" : "Spotty stand"}</button>
            <button type="button" className="poor" disabled={Boolean(saving)} onClick={() => void submit("germinated", "poor")}>{saving === "poor" ? "Saving…" : "Poor stand"}</button>
            <button type="button" className="not-yet" disabled={Boolean(saving)} onClick={() => setStandOpen(false)}>Back</button>
          </div>
        </div>
      )}

      {message ? <p className="atlas-task-page-message">{message}</p> : null}
    </section>,
    host,
  );
}
