"use client";

import { useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskResultInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
import { atlasFarmDateIso, atlasShiftFarmDate } from "@/lib/atlas/farm-day";
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

type ReadinessAction = "ready" | "not_ready" | "failed";

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function savedCount(task: AtlasTaskCard) {
  return numberValue(task.metadata?.transplant_ready_seedlings);
}

function savedStatus(task: AtlasTaskCard) {
  const value = task.metadata?.transplant_readiness_status;
  return value === "ready" || value === "failed" ? value : null;
}

function isProductionReadiness(task: AtlasTaskCard) {
  return task.metadata?.continuity_contract === "hardening_to_transplant_readiness_v1"
    || typeof task.metadata?.production_lot_id === "string"
    || typeof task.metadata?.production_tray_batch_id === "string";
}

function TransplantReadinessInstrument({ context }: { context: AssignedTaskResultInstrumentContext }) {
  const productionReadiness = isProductionReadiness(context.task);
  const existingCount = savedCount(context.task);
  const existingStatus = savedStatus(context.task);
  const initialLiving = productionReadiness
    ? numberValue(context.task.metadata?.current_seedlings) ?? existingCount
    : existingCount;
  const initialTrays = numberValue(context.task.metadata?.tray_count);
  const today = atlasFarmDateIso();
  const [count, setCount] = useState(initialLiving === null ? "" : String(initialLiving));
  const [trayCount, setTrayCount] = useState(initialTrays === null ? "" : String(initialTrays));
  const [observedDate, setObservedDate] = useState(today);
  const [nextCheckDate, setNextCheckDate] = useState(atlasShiftFarmDate(today, 2));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<ReadinessAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busy = Boolean(saving) || context.busy;
  const completionBlocked = !context.completion.canComplete;

  async function save(action: ReadinessAction) {
    if (busy || (action !== "not_ready" && completionBlocked)) return;
    const parsedCount = /^\d+$/.test(count.trim()) ? Number(count) : null;
    const parsedTrayCount = /^\d+$/.test(trayCount.trim()) ? Number(trayCount) : null;

    if (action !== "failed" && (!parsedCount || parsedCount < 1)) {
      setMessage(productionReadiness
        ? "Enter how many seedlings are still living, or choose All seedlings lost."
        : "Enter how many seedlings are transplant-ready, or choose All seedlings lost.");
      return;
    }
    if (productionReadiness && action !== "failed" && (!parsedTrayCount || parsedTrayCount < 1)) {
      setMessage("Enter how many trays the living cohort currently occupies.");
      return;
    }
    if (productionReadiness && action === "not_ready" && !nextCheckDate) {
      setMessage("Choose when Atlas should check the cohort again.");
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
          trayCount: productionReadiness ? (action === "failed" ? 0 : parsedTrayCount) : undefined,
          observedDate: productionReadiness ? observedDate : undefined,
          nextCheckDate: productionReadiness && action === "not_ready" ? nextCheckDate : undefined,
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
      data-atlas-production-readiness={productionReadiness ? "true" : "false"}
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
        {productionReadiness
          ? "Count what is actually alive now. If the cohort is not ready, keep it in hardening and give Atlas the next date to check instead of forcing the planting stage."
          : "Record the number that actually made it to transplant-ready. This can be revised later if the count changes."}
      </p>

      {existingStatus ? (
        <p style={{ margin: "0 0 10px", padding: "8px 10px", borderRadius: 11, background: "rgba(232,231,246,.55)", color: "#55576d", fontSize: 11.5, lineHeight: 1.35 }}>
          Saved result: {existingStatus === "failed" ? "all seedlings lost" : `${existingCount ?? 0} transplant-ready`}.
        </p>
      ) : null}

      {productionReadiness ? (
        <label style={{ display: "grid", gap: 5, marginBottom: 9, color: "#56586a", fontSize: 11, fontWeight: 850 }}>
          Observed
          <input
            type="date"
            value={observedDate}
            disabled={busy}
            onChange={(event) => setObservedDate(event.target.value)}
            style={{ width: "100%", minHeight: 42, border: "1px solid rgba(91,95,126,.18)", borderRadius: 12, padding: "9px 11px", background: "#fff", color: "#303243", font: "inherit" }}
          />
        </label>
      ) : null}

      <label style={{ display: "grid", gap: 5, color: "#56586a", fontSize: 11, fontWeight: 850 }}>
        {productionReadiness ? "How many are still living?" : "How many are ready?"}
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

      {productionReadiness ? (
        <label style={{ display: "grid", gap: 5, marginTop: 9, color: "#56586a", fontSize: 11, fontWeight: 850 }}>
          Current trays
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={trayCount}
            disabled={busy}
            onChange={(event) => setTrayCount(event.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0"
            style={{ width: "100%", minHeight: 42, border: "1px solid rgba(91,95,126,.18)", borderRadius: 12, padding: "9px 11px", background: "#fff", color: "#303243", font: "inherit", fontSize: 14, fontWeight: 800 }}
          />
        </label>
      ) : null}

      <label style={{ display: "grid", gap: 5, marginTop: 9, color: "#56586a", fontSize: 11, fontWeight: 850 }}>
        What happened? <span style={{ fontWeight: 600, opacity: .65 }}>(optional)</span>
        <input
          type="text"
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. good roots, still soft growth"
          style={{ width: "100%", minHeight: 42, border: "1px solid rgba(91,95,126,.18)", borderRadius: 12, padding: "9px 11px", background: "#fff", color: "#303243", font: "inherit", fontSize: 12 }}
        />
      </label>

      {productionReadiness ? (
        <label style={{ display: "grid", gap: 5, marginTop: 9, color: "#56586a", fontSize: 11, fontWeight: 850 }}>
          If not ready, check again
          <input
            type="date"
            min={atlasShiftFarmDate(observedDate || today, 1)}
            value={nextCheckDate}
            disabled={busy}
            onChange={(event) => setNextCheckDate(event.target.value)}
            style={{ width: "100%", minHeight: 42, border: "1px solid rgba(91,95,126,.18)", borderRadius: 12, padding: "9px 11px", background: "#fff", color: "#303243", font: "inherit" }}
          />
        </label>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: productionReadiness ? "1fr 1fr" : "1fr 1fr", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          disabled={busy || completionBlocked}
          onClick={() => void save("ready")}
          style={{ border: 0, borderRadius: 12, padding: "11px 10px", background: "#e9e73b", color: "#303243", font: "inherit", fontSize: 12, fontWeight: 900 }}
        >
          {saving === "ready" ? "Saving…" : existingStatus ? "Revise count" : "Ready to plant"}
        </button>
        {productionReadiness ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save("not_ready")}
            style={{ border: "1px solid rgba(91,95,126,.18)", borderRadius: 12, padding: "11px 10px", background: "#fff", color: "#55576d", font: "inherit", fontSize: 12, fontWeight: 900 }}
          >
            {saving === "not_ready" ? "Saving…" : "Not ready yet"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || completionBlocked}
            onClick={() => void save("failed")}
            style={{ border: "1px solid rgba(116,73,73,.2)", borderRadius: 12, padding: "11px 10px", background: "rgba(250,244,241,.9)", color: "#704c49", font: "inherit", fontSize: 12, fontWeight: 900 }}
          >
            {saving === "failed" ? "Saving…" : "All seedlings lost"}
          </button>
        )}
      </div>

      {productionReadiness ? (
        <button
          type="button"
          disabled={busy || completionBlocked}
          onClick={() => void save("failed")}
          style={{ width: "100%", marginTop: 8, border: "1px solid rgba(116,73,73,.2)", borderRadius: 12, padding: "10px", background: "rgba(250,244,241,.9)", color: "#704c49", font: "inherit", fontSize: 11.5, fontWeight: 850 }}
        >
          {saving === "failed" ? "Saving…" : "All seedlings lost"}
        </button>
      ) : null}

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
