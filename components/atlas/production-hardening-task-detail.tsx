"use client";

import { useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskResultInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
import { atlasFarmDateIso } from "@/lib/atlas/farm-day";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type HardeningResponse = {
  ok?: boolean;
  error?: string;
};

function ProductionHardeningInstrument({ context }: { context: AssignedTaskResultInstrumentContext }) {
  const [observedDate, setObservedDate] = useState(atlasFarmDateIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = saving || context.busy;
  const completionBlocked = !context.completion.canComplete;
  const containerKind = typeof context.task.metadata?.container_kind === "string"
    ? context.task.metadata.container_kind
    : "3/4-inch soil blocks";

  async function save() {
    if (busy || completionBlocked) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/atlas/production-hardening", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: context.task.task_id,
          observedDate,
          note: note.trim() || null,
        }),
      });
      const body = await response.json() as HardeningResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "Atlas could not save the hardening result.");
      window.location.assign(context.returnHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save the hardening result.");
      setSaving(false);
    }
  }

  return (
    <section
      aria-label="Production hardening result"
      data-atlas-result-instrument="production-hardening"
      style={{
        margin: "0 0 4px",
        padding: "14px",
        border: "1px solid rgba(91, 95, 126, .18)",
        borderRadius: 18,
        background: "rgba(250, 249, 243, .9)",
      }}
    >
      <span style={{ display: "block", color: "#858bb8", fontSize: 10, fontWeight: 950, letterSpacing: ".13em", textTransform: "uppercase" }}>
        Crop stage
      </span>
      <strong style={{ display: "block", marginTop: 4, color: "#303243", fontSize: 16 }}>Start hardening</strong>
      <p style={{ margin: "5px 0 12px", color: "#73746c", fontSize: 12, lineHeight: 1.45 }}>
        Keep this cohort in the same {containerKind}. Do not pot up. Record when outdoor acclimation actually begins; Atlas will carry the cohort forward to its transplant-readiness check.
      </p>

      <label style={{ display: "grid", gap: 5, color: "#56586a", fontSize: 11, fontWeight: 850 }}>
        Hardening started
        <input
          type="date"
          value={observedDate}
          disabled={busy}
          onChange={(event) => setObservedDate(event.target.value)}
          style={{ width: "100%", minHeight: 44, border: "1px solid rgba(91,95,126,.22)", borderRadius: 12, padding: "9px 11px", background: "#fff", color: "#303243", font: "inherit" }}
        />
      </label>

      <label style={{ display: "grid", gap: 5, marginTop: 9, color: "#56586a", fontSize: 11, fontWeight: 850 }}>
        Condition note <span style={{ fontWeight: 600, opacity: .65 }}>(optional)</span>
        <input
          type="text"
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. all trays healthy"
          style={{ width: "100%", minHeight: 42, border: "1px solid rgba(91,95,126,.18)", borderRadius: 12, padding: "9px 11px", background: "#fff", color: "#303243", font: "inherit", fontSize: 12 }}
        />
      </label>

      <button
        type="button"
        disabled={busy || completionBlocked || !observedDate}
        onClick={() => void save()}
        style={{ width: "100%", marginTop: 12, border: 0, borderRadius: 12, padding: "12px 10px", background: "#e9e73b", color: "#303243", font: "inherit", fontSize: 12, fontWeight: 900 }}
      >
        {saving ? "Saving…" : "Hardening started"}
      </button>

      {message ? <p style={{ margin: "9px 0 0", color: "#6d5350", fontSize: 11.5, lineHeight: 1.35 }}>{message}</p> : null}
    </section>
  );
}

export default function ProductionHardeningTaskDetail(props: Props) {
  return (
    <AssignedTaskExecutionShell
      {...props}
      resultInstrument={(context) => <ProductionHardeningInstrument context={context} />}
    />
  );
}
