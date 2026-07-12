"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type GerminationTask = {
  id: string;
  title: string;
  dueDate: string | null;
  objectLabel: string;
  cropLabel: string;
  variety: string | null;
  expectedMinDays: number | null;
  expectedMaxDays: number | null;
  notYetCount: number;
};

type LookupResponse = {
  ok?: boolean;
  germinationCheck?: boolean;
  task?: GerminationTask;
  error?: string;
  details?: string;
};

function activeTaskCard() {
  return document.querySelector<HTMLElement>(".atlas-task-ticket-card");
}

function activeTaskTitle() {
  return activeTaskCard()?.querySelector("h1")?.textContent?.trim() ?? "";
}

export default function GerminationCheckTaskPatch() {
  const [task, setTask] = useState<GerminationTask | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [standNote, setStandNote] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const lookupKey = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("taskId") || activeTaskTitle();
  }, [host]);

  useEffect(() => {
    if (window.location.pathname !== "/task") return;

    let stopped = false;
    let timer: number | null = null;

    async function inspect() {
      const card = activeTaskCard();
      if (!card) return;

      let mount = card.querySelector<HTMLElement>("[data-germination-check-host]");
      if (!mount) {
        mount = document.createElement("div");
        mount.dataset.germinationCheckHost = "true";
        const actions = card.querySelector(".atlas-task-primary-actions");
        if (actions) card.insertBefore(mount, actions);
        else card.appendChild(mount);
      }
      if (!stopped) setHost(mount);

      const params = new URLSearchParams(window.location.search);
      const taskId = params.get("taskId");
      const title = activeTaskTitle();
      const query = taskId ? `taskId=${encodeURIComponent(taskId)}` : title ? `taskTitle=${encodeURIComponent(title)}` : "";
      if (!query) return;

      try {
        const response = await fetch(`/api/atlas/germination-check?${query}`, { headers: { Accept: "application/json" }, cache: "no-store" });
        const data = (await response.json()) as LookupResponse;
        if (stopped) return;
        if (response.ok && data.ok && data.germinationCheck && data.task) {
          setTask(data.task);
          card.classList.add("atlas-germination-task");
          card.querySelector<HTMLElement>(".atlas-task-primary-actions")?.setAttribute("hidden", "true");
          card.querySelector<HTMLElement>(".atlas-task-unfinished-panel")?.setAttribute("hidden", "true");
        } else {
          setTask(null);
          card.classList.remove("atlas-germination-task");
          card.querySelector<HTMLElement>(".atlas-task-primary-actions")?.removeAttribute("hidden");
        }
      } catch {
        // Leave the normal task card untouched when lookup is unavailable.
      }
    }

    const queue = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void inspect(), 80);
    };

    const observer = new MutationObserver(queue);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", queue);
    queue();

    return () => {
      stopped = true;
      observer.disconnect();
      window.removeEventListener("popstate", queue);
      if (timer) window.clearTimeout(timer);
    };
  }, [lookupKey]);

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

      if (action === "not_yet") {
        setMessage(`Not yet logged. Check again ${data.nextDate ?? "tomorrow"}.`);
        window.setTimeout(() => window.location.assign("/"), 550);
      } else {
        setMessage(standQuality === "good" ? "Good stand logged. Harvest watch created." : "Stand logged. Patch task created now.");
        window.setTimeout(() => window.location.assign("/"), 650);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Germination update failed.");
    } finally {
      setSaving(null);
    }
  }

  if (!host || !task) return null;

  const profileLabel = task.variety || task.cropLabel;
  const windowLabel = task.expectedMinDays && task.expectedMaxDays
    ? `${task.expectedMinDays}–${task.expectedMaxDays} days expected`
    : "Expected germination window";

  return createPortal(
    <section className="atlas-germination-check-panel">
      <div className="atlas-germination-check-head">
        <span>GERMINATION CHECK</span>
        <strong>Did {profileLabel} germinate?</strong>
        <small>{task.objectLabel} · {windowLabel}</small>
      </div>

      <label className="atlas-germination-note">
        <span>Inline stand log</span>
        <textarea
          value={standNote}
          onChange={(event) => setStandNote(event.target.value)}
          placeholder="Optional: where gaps are, how much of the row emerged, deer or washout damage…"
          rows={3}
        />
      </label>

      <div className="atlas-germination-actions">
        <button type="button" className="not-yet" disabled={Boolean(saving)} onClick={() => void submit("not_yet")}>
          {saving === "not_yet" ? "Saving…" : "Not yet"}
        </button>
        <button type="button" className="good" disabled={Boolean(saving)} onClick={() => void submit("germinated", "good")}>
          {saving === "good" ? "Saving…" : "Yes — good stand"}
        </button>
        <button type="button" className="spotty" disabled={Boolean(saving)} onClick={() => void submit("germinated", "spotty")}>
          {saving === "spotty" ? "Saving…" : "Yes — spotty stand"}
        </button>
        <button type="button" className="poor" disabled={Boolean(saving)} onClick={() => void submit("germinated", "poor")}>
          {saving === "poor" ? "Saving…" : "Yes — poor stand"}
        </button>
      </div>

      {task.notYetCount > 0 ? <p className="atlas-germination-history">Checked “not yet” {task.notYetCount} time{task.notYetCount === 1 ? "" : "s"}.</p> : null}
      {message ? <p className="atlas-task-page-message">{message}</p> : null}
    </section>,
    host,
  );
}
