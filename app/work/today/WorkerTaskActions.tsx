"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "./work.module.css";

type Transition = "done" | "blocked" | "note";

function idempotencyKey(taskId: string, transition: Transition) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `worker:${taskId}:${transition}:${nonce}`;
}

export default function WorkerTaskActions({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [working, setWorking] = useState<Transition | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function apply(transition: Transition) {
    if ((transition === "blocked" || transition === "note") && !note.trim()) {
      setError(
        transition === "blocked"
          ? "Describe what is blocking the task."
          : "Write the note before saving it.",
      );
      return;
    }

    setWorking(transition);
    setError("");
    setMessage("");

    const response = await fetch(
      `/api/atlas/work/tasks/${encodeURIComponent(taskId)}/transition`,
      {
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
          payload: {},
        }),
      },
    );

    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(result?.error ?? "Atlas could not save that result.");
      setWorking(null);
      return;
    }

    setNote("");
    setMessage(
      transition === "done"
        ? "Task completed."
        : transition === "blocked"
          ? "Blocker reported."
          : "Note saved.",
    );
    setWorking(null);
    router.refresh();
  }

  return (
    <div className={styles.actions}>
      <textarea
        aria-label="Task note or blocker"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="Add a note or describe a blocker"
      />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}
      <div className={styles.actionGrid}>
        <button type="button" disabled={working !== null} onClick={() => void apply("done")}>
          {working === "done" ? "Completing…" : "Complete"}
        </button>
        <button type="button" disabled={working !== null} onClick={() => void apply("blocked")}>
          {working === "blocked" ? "Reporting…" : "Blocked"}
        </button>
        <button
          type="button"
          disabled={working !== null || !note.trim()}
          onClick={() => void apply("note")}
        >
          {working === "note" ? "Saving…" : "Save note"}
        </button>
      </div>
    </div>
  );
}
