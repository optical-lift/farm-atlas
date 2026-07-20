"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "./task.module.css";

type Transition = "done" | "blocked" | "rescheduled" | "note";

function idempotencyKey(taskId: string, transition: Transition) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `owner:${taskId}:${transition}:${nonce}`;
}

export default function OwnerTaskActions({
  taskId,
  status,
}: {
  taskId: string;
  status: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [working, setWorking] = useState<Transition | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function apply(transition: Transition) {
    if (transition === "blocked" && !note.trim()) {
      setError("Add the blocker before marking this task blocked.");
      return;
    }

    setWorking(transition);
    setError("");
    setMessage("");

    const response = await fetch(`/api/atlas/owner/tasks/${encodeURIComponent(taskId)}/transition`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "x-atlas-intent": "task-transition-v1",
      },
      body: JSON.stringify({
        transition,
        idempotencyKey: idempotencyKey(taskId, transition),
        note: note.trim() || null,
        reason: transition === "blocked" ? note.trim() : null,
        payload: transition === "rescheduled" ? { scheduleIntent: "next_day" } : {},
      }),
    });

    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(result?.error ?? "Atlas could not apply that action.");
      setWorking(null);
      return;
    }

    if (transition === "done") {
      router.push("/owner");
      router.refresh();
      return;
    }

    setMessage(
      transition === "rescheduled"
        ? "Moved to the next work day."
        : transition === "blocked"
          ? "Blocker saved."
          : "Note saved.",
    );
    setNote("");
    setWorking(null);
    router.refresh();
  }

  if (status === "done") {
    return <p className={styles.complete}>This Owner action is complete.</p>;
  }

  return (
    <section className={styles.actions} aria-labelledby="owner-task-actions-title">
      <h2 id="owner-task-actions-title">Act on this task</h2>
      <label>
        <span>Note or blocker</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          maxLength={4000}
        />
      </label>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}

      <div className={styles.actionGrid}>
        <button type="button" onClick={() => void apply("done")} disabled={working !== null}>
          {working === "done" ? "Completing…" : "Mark done"}
        </button>
        <button type="button" onClick={() => void apply("rescheduled")} disabled={working !== null}>
          {working === "rescheduled" ? "Moving…" : "Move to tomorrow"}
        </button>
        <button type="button" onClick={() => void apply("blocked")} disabled={working !== null}>
          {working === "blocked" ? "Saving…" : "Mark blocked"}
        </button>
        <button type="button" onClick={() => void apply("note")} disabled={working !== null || !note.trim()}>
          {working === "note" ? "Saving…" : "Save note"}
        </button>
      </div>
    </section>
  );
}
