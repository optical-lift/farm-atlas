"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "./work.module.css";

type RouteEvent = "handoff_complete" | "service_complete" | "failed" | "note";

function idempotencyKey(stopId: string, eventKind: RouteEvent) {
  return `worker-route:${stopId}:${eventKind}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

export default function WorkerRouteStopActions({
  stopId,
  stopKind,
}: {
  stopId: string;
  stopKind: "product_delivery" | "product_pickup" | "service_visit" | "handoff" | "mixed";
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [working, setWorking] = useState<RouteEvent | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const completionEvent: RouteEvent = stopKind === "service_visit" ? "service_complete" : "handoff_complete";
  const completionLabel = stopKind === "service_visit" ? "Service complete" : stopKind === "product_pickup" ? "Picked up" : stopKind === "product_delivery" ? "Delivered" : "Complete stop";

  async function apply(eventKind: RouteEvent) {
    if ((eventKind === "failed" || eventKind === "note") && !note.trim()) {
      setError(eventKind === "failed" ? "Describe the problem before reporting it." : "Write the note before saving it.");
      return;
    }
    setWorking(eventKind);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/atlas/operational-route-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stopId,
          eventKind,
          note: note.trim() || null,
          idempotencyKey: idempotencyKey(stopId, eventKind),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Atlas could not save that route result.");
      setNote("");
      setMessage(eventKind === completionEvent ? "Stop completed." : eventKind === "failed" ? "Problem reported." : "Note saved.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Atlas could not save that route result.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className={styles.actions}>
      <textarea
        aria-label="Route stop note or problem"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Add a note or describe a problem"
      />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}
      <div className={styles.actionGrid}>
        <button type="button" disabled={working !== null} onClick={() => void apply(completionEvent)}>
          {working === completionEvent ? "Saving…" : completionLabel}
        </button>
        <button type="button" disabled={working !== null} onClick={() => void apply("failed")}>
          {working === "failed" ? "Reporting…" : "Problem"}
        </button>
        <button type="button" disabled={working !== null || !note.trim()} onClick={() => void apply("note")}>
          {working === "note" ? "Saving…" : "Save note"}
        </button>
      </div>
    </div>
  );
}
