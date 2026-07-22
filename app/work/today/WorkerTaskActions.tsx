"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import styles from "./work.module.css";

type Transition = "done" | "blocked" | "note";

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

    try {
      await postAtlasTaskTransition({
        taskId,
        transition,
        note: note.trim() || null,
        reason: transition === "blocked" ? note.trim() : null,
        payload: { source: "worker_today" },
      });

      setNote("");
      setMessage(
        transition === "done"
          ? "Task completed."
          : transition === "blocked"
            ? "Blocker reported."
            : "Note saved.",
      );
      router.refresh();
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : "Atlas could not save that result.");
    } finally {
      setWorking(null);
    }
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
