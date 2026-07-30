"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { resolveAtlasTaskProblemHandoff } from "@/lib/atlas/task-problem-handoff-client";
import styles from "./task.module.css";

type Transition = "done" | "blocked" | "rescheduled" | "note";

type ProblemHandoff = {
  id: string;
  issueText: string;
};

function idempotencyKey(taskId: string, transition: Transition) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `owner:${taskId}:${transition}:${nonce}`;
}

export default function OwnerTaskActions({
  taskId,
  status,
  problemHandoff,
}: {
  taskId: string;
  status: string;
  problemHandoff?: ProblemHandoff | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [working, setWorking] = useState<Transition | "send_back" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function sendBackToAnna() {
    setWorking("send_back");
    setError("");
    setMessage("");
    try {
      const result = await resolveAtlasTaskProblemHandoff(taskId, note.trim());
      setMessage(result.message || "Sent back to Anna.");
      window.setTimeout(() => {
        router.push("/owner");
        router.refresh();
      }, 900);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Atlas could not send this task back to Anna.");
      setWorking(null);
    }
  }

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

  if (problemHandoff) {
    return (
      <section className={styles.actions} aria-labelledby="owner-problem-actions-title">
        <h2 id="owner-problem-actions-title">Handle this problem</h2>
        <label>
          <span>What changed or what should Anna know?</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Optional instruction or resolution"
          />
        </label>
        <p>The task keeps its original due date and returns to Anna as soon as you send it back.</p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.success} role="status">{message}</p> : null}
        <div className={styles.actionGrid}>
          <button type="button" onClick={() => void sendBackToAnna()} disabled={working !== null}>
            {working === "send_back" ? "Sending back…" : "Send back to Anna"}
          </button>
        </div>
      </section>
    );
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
