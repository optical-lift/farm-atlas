"use client";

import { useEffect, useState } from "react";
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

type HistoryItem = {
  key: string;
  date: string | null;
  action: string;
  sourceTask: string | null;
  details: string[];
};

type LookupResponse = {
  ok?: boolean;
  germinationCheck?: boolean;
  task?: GerminationTask;
  error?: string;
  details?: string;
};

type HistoryResponse = {
  ok?: boolean;
  history?: HistoryItem[];
  error?: string;
  details?: string;
};

function activeTaskCard() {
  return document.querySelector<HTMLElement>(".atlas-task-ticket-card");
}

function activeTaskTitle() {
  return activeTaskCard()?.querySelector("h1")?.textContent?.trim() ?? "";
}

function prettyDate(dateIso: string | null) {
  if (!dateIso) return "Date not recorded";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function hideNormalTaskParts(card: HTMLElement) {
  const actions = card.querySelector<HTMLElement>(".atlas-task-primary-actions");
  const unfinished = card.querySelector<HTMLElement>(".atlas-task-unfinished-panel");
  const detail = card.querySelector<HTMLElement>(".atlas-task-detail-card");
  for (const element of [actions, unfinished, detail]) {
    if (!element) continue;
    element.hidden = true;
    element.style.display = "none";
  }
}

function restoreNormalTaskParts(card: HTMLElement) {
  const actions = card.querySelector<HTMLElement>(".atlas-task-primary-actions");
  const detail = card.querySelector<HTMLElement>(".atlas-task-detail-card");
  for (const element of [actions, detail]) {
    if (!element) continue;
    element.hidden = false;
    element.style.removeProperty("display");
  }
}

export default function GerminationCheckTaskPatch() {
  const [task, setTask] = useState<GerminationTask | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [standNote, setStandNote] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.pathname !== "/task") return;

    let stopped = false;
    let lastLookup = "";

    async function inspect() {
      const card = activeTaskCard();
      if (!card) return;

      const title = activeTaskTitle();
      const looksLikeGermination = title.toLowerCase().includes("germination");
      if (looksLikeGermination) {
        card.classList.add("atlas-germination-task");
        hideNormalTaskParts(card);
      }

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
      const query = taskId ? `taskId=${encodeURIComponent(taskId)}` : title ? `taskTitle=${encodeURIComponent(title)}` : "";
      if (!query) return;

      const lookupSignature = `${query}:${title}`;
      if (lookupSignature === lastLookup) return;
      lastLookup = lookupSignature;

      try {
        const response = await fetch(`/api/atlas/germination-check?${query}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const data = (await response.json()) as LookupResponse;
        if (stopped) return;

        if (response.ok && data.ok && data.germinationCheck && data.task) {
          card.classList.add("atlas-germination-task");
          hideNormalTaskParts(card);

          const historyResponse = await fetch(
            `/api/atlas/germination-history?taskId=${encodeURIComponent(data.task.id)}&objectLabel=${encodeURIComponent(data.task.objectLabel)}`,
            { headers: { Accept: "application/json" }, cache: "no-store" },
          );
          const historyData = (await historyResponse.json()) as HistoryResponse;
          if (stopped) return;

          setHistory(historyResponse.ok && historyData.ok ? historyData.history ?? [] : []);
          setTask(data.task);
          setLogOpen(false);
          setStandNote("");
        } else {
          setTask(null);
          setHistory([]);
          card.classList.remove("atlas-germination-task");
          restoreNormalTaskParts(card);
        }
      } catch {
        if (!looksLikeGermination) restoreNormalTaskParts(card);
      }
    }

    const interval = window.setInterval(() => void inspect(), 500);
    const observer = new MutationObserver(() => void inspect());
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", inspect);
    void inspect();

    return () => {
      stopped = true;
      window.clearInterval(interval);
      observer.disconnect();
      window.removeEventListener("popstate", inspect);
    };
  }, []);

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

      <section className="atlas-germination-memory" aria-label={`${profileLabel} history`}>
        <strong>Crop History</strong>
        {history.length ? (
          <div className="atlas-germination-memory-list">
            {history.map((item) => (
              <article key={item.key} className="atlas-germination-memory-item">
                <time>{prettyDate(item.date)}</time>
                <div>
                  <strong>{item.action}</strong>
                  {item.sourceTask ? <span>From: {item.sourceTask}</span> : null}
                  {item.details.map((detail) => <p key={detail}>{detail}</p>)}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="atlas-germination-memory-empty">Crop history is loading.</p>
        )}
      </section>

      {!logOpen ? (
        <div className="atlas-germination-actions atlas-germination-primary-actions">
          <button type="button" className="good" disabled={Boolean(saving)} onClick={() => setLogOpen(true)}>Germinated</button>
          <button type="button" className="not-yet" disabled={Boolean(saving)} onClick={() => void submit("not_yet")}>
            {saving === "not_yet" ? "Saving…" : "Not yet"}
          </button>
        </div>
      ) : (
        <div className="atlas-germination-inline-log">
          <div className="atlas-germination-check-head">
            <span>INLINE STAND LOG</span>
            <strong>What kind of stand emerged?</strong>
          </div>
          <label className="atlas-germination-note">
            <span>What did you see?</span>
            <textarea value={standNote} onChange={(event) => setStandNote(event.target.value)} placeholder="Optional: where gaps are, how much emerged, washout, deer damage, or anything Anna noticed…" rows={3} />
          </label>
          <div className="atlas-germination-actions atlas-germination-stand-actions">
            <button type="button" className="good" disabled={Boolean(saving)} onClick={() => void submit("germinated", "good")}>{saving === "good" ? "Saving…" : "Good stand"}</button>
            <button type="button" className="spotty" disabled={Boolean(saving)} onClick={() => void submit("germinated", "spotty")}>{saving === "spotty" ? "Saving…" : "Spotty stand"}</button>
            <button type="button" className="poor" disabled={Boolean(saving)} onClick={() => void submit("germinated", "poor")}>{saving === "poor" ? "Saving…" : "Poor stand"}</button>
            <button type="button" className="not-yet" disabled={Boolean(saving)} onClick={() => setLogOpen(false)}>Back</button>
          </div>
        </div>
      )}

      {message ? <p className="atlas-task-page-message">{message}</p> : null}
    </section>,
    host,
  );
}
