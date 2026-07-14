"use client";

import { useState } from "react";

type GerminationTask = {
  id: string;
  cropLabel: string;
  variety: string | null;
  objectLabel: string;
};

function returnDestination() {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  return returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
}

export default function GerminationFocusPage({ task }: { task: GerminationTask }) {
  const [standOpen, setStandOpen] = useState(false);
  const [standNote, setStandNote] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(action: "not_yet" | "germinated", standQuality?: "good" | "spotty" | "poor") {
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
      window.setTimeout(() => window.location.assign(returnDestination()), 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Germination update failed.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="atlas-task-page-shell">
      <article className="atlas-task-page-active atlas-task-ticket-card atlas-germination-task">
        <div className="atlas-task-page-kicker"><span>Check germination</span></div>
        <h1>{`${task.cropLabel} · ${task.objectLabel}`.toUpperCase()}</h1>
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
        </section>
      </article>
    </main>
  );
}
