"use client";

import { useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskResultInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type ReadinessResponse = {
  ok?: boolean;
  error?: string;
};

function savedCount(task: AtlasTaskCard) {
  const value = task.metadata?.transplant_ready_seedlings;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function savedStatus(task: AtlasTaskCard) {
  const value = task.metadata?.transplant_readiness_status;
  return value === "ready" || value === "failed" ? value : null;
}

function TransplantReadinessInstrument({ context }: { context: AssignedTaskResultInstrumentContext }) {
  const existingCount = savedCount(context.task);
  const existingStatus = savedStatus(context.task);
  const [count, setCount] = useState(existingCount === null ? "" : String(existingCount));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<"ready" | "failed" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busy = Boolean(saving) || context.busy;

  async function save(action: "ready" | "failed") {
    if (busy) return;
    const parsedCount = /^\d+$/.test(count.trim()) ? Number(count) : null;
    if (action === "ready" && (!parsedCount || parsedCount < 1)) {
      setMessage("Enter how many seedlings are transplant-ready, or choose All seedlings lost.");
      return;
    }
    if (action === "failed" && !window.confirm("Record that no seedlings survived to transplant-ready?")) return;

    setSaving(action);
    setMessage(null);
    try {
      const response = await fetch("/api/atlas/transplant-readiness", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: context.task.task_id,
          action,
          readyCount: action === "failed" ? 0 : parsedCount,
          note: note.trim() || null,
        }),
      });
      const body = await response.json() as ReadinessResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "Atlas could not save the readiness result.");
      window.location.assign(context.returnHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save the readiness result.");
      setSaving(null);
    }
  }

  return (
    <section
      aria-label="Transplant-ready seedling result"
      data-atlas-result-instrument="transplant-readiness"
      style={{
        margin: "0 0 4px",
        padding: "14px",
        border: "1px solid rgba(91, 95, 126, .18)",
        borderRadius: 18,
        background: "rgba(250, 249, 243, .9)",
      }}
    >
      <span style={{ display: "block", color: "#858bb8", fontSize: 10, fontWeight: 950, letterSpacing: ".13em", textTransform: "uppercase" }}>
        Crop result
      </span>
      <strong style={{ display: "block", marginTop: 4, color: "#303243", fontSize: 16 }}>Transplant-ready seedlings</strong>
      <p style={{ margin: "5px 0 12px", color: "#73746c", fontSize: 12, lineHeight: 1.4 }}>
        Record the number that actually made it to transplant-ready. This can be revised later if the count changes.
      </p>

      {existingStatus ? (
        <p style={{ margin: "0 0 10px", padding: "8px 10px", borderRadius: 11, background: "rgba(232,231,246,.55)", color: "#55576d", fontSize: 11.5, lineHeight: 1.35 }}>
          Saved result: {existingStatus === "failed" ? "all seedlings lost" : `${existingCount ?? 0} transplant-ready`}.
        </p>
      ) : null}

      <label style={{ display: "grid", gap: 5, color: "#56586a", fontSize: 11, fontWeight: 850 }}>
        How many are ready?
        <input
          type="number"
          min="0"
          inputMode="numeric"
          value={count}
          disabled={busy}
          onChange={(event) => setCount(event.target.value.replace(/[^0-9]/g, ""))}
          placeholder="0"
          style={{ width: "100%", minHeight: 46, border: "1px solid rgba(91,95,126,.22)", borderRadius: 12, padding: "9px 11px", background: "#fff", color: "#303243", font: "inherit", fontSize: 18, fontWeight: 850 }}
        />
      </label>

      <label style={{ display: "grid", gap: 5, marginTop: 9, color: "#56586a", fontSize: 11, fontWeight: 850 }}>
        What happened? <span style={{ fontWeight: 600, opacity: .65 }}>(optional)</span>
        <input
          type="text"
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. cabbage moth damage"
          style={{ width: "100%", minHeight: 42, border: "1px solid rgba(91,95,126,.18)", borderRadius: 12, padding: "9px 11px", background: "#fff", color: "#303243", font: "inherit", fontSize: 12 }}
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save("ready")}
          style={{ border: 0, borderRadius: 12, padding: "11px 10px", background: "#e9e73b", color: "#303243", font: "inherit", fontSize: 12, fontWeight: 900 }}
        >
          {saving === "ready" ? "Saving…" : existingStatus ? "Revise count" : "Save ready count"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save("failed")}
          style={{ border: "1px solid rgba(116,73,73,.2)", borderRadius: 12, padding: "11px 10px", background: "rgba(250,244,241,.9)", color: "#704c49", font: "inherit", fontSize: 12, fontWeight: 900 }}
        >
          {saving === "failed" ? "Saving…" : "All seedlings lost"}
        </button>
      </div>

      {message ? <p style={{ margin: "9px 0 0", color: "#6d5350", fontSize: 11.5, lineHeight: 1.35 }}>{message}</p> : null}
    </section>
  );
}

export default function TransplantReadinessTaskDetail(props: Props) {
  return (
    <AssignedTaskExecutionShell
      {...props}
      resultInstrument={(context) => <TransplantReadinessInstrument context={context} />}
    />
  );
}
