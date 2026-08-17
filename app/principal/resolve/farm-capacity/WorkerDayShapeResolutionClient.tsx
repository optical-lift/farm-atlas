"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type FarmCapacityExceptionTarget = {
  sourceId: string;
  farmId: string;
  membershipId: string;
  farmName: string;
  workerLabel: string;
  weekStart: string;
  weekEnd: string;
  state: string;
  threshold: string;
  consequence: string;
  ownerDecision: string;
};

type ApiResponse = {
  ok?: boolean;
  error?: { message?: string };
  result?: {
    policyVersion?: number;
    capacitySync?: {
      state?: string;
      action?: string;
      escalationKind?: string;
    } | null;
  };
};

const weekdayOptions = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
] as const;

const cardStyle = {
  border: "1px solid rgba(38,38,38,.12)",
  borderRadius: 18,
  background: "rgba(255,255,255,.78)",
  padding: 18,
  boxShadow: "0 10px 32px rgba(47,43,31,.045)",
} as const;

const fieldStyle = { display: "grid", gap: 6 } as const;
const labelStyle = { fontSize: 11, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" } as const;
const inputStyle = {
  width: "100%",
  border: "1px solid rgba(38,38,38,.18)",
  borderRadius: 12,
  background: "#fffdf8",
  color: "#262626",
  padding: "10px 12px",
  font: "inherit",
} as const;

function pretty(value: string) {
  return value.replaceAll("_", " ");
}

export default function WorkerDayShapeResolutionClient({ target }: { target: FarmCapacityExceptionTarget }) {
  const router = useRouter();
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
  const [localStart, setLocalStart] = useState("");
  const [localEnd, setLocalEnd] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(target.weekStart);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const weekdaySummary = useMemo(
    () => weekdayOptions.filter(([day]) => selectedWeekdays.includes(day)).map(([, label]) => label).join(", "),
    [selectedWeekdays],
  );

  function toggleWeekday(day: number) {
    setSelectedWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setSaved(false);
    try {
      const response = await fetch("/api/atlas/principal/worker-day-shape", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          farmId: target.farmId,
          membershipId: target.membershipId,
          weekdays: selectedWeekdays,
          localStart,
          localEnd,
          effectiveFrom,
          reason,
        }),
      });
      const payload = (await response.json()) as ApiResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message || "Atlas could not save this Farm Hand Day Shape.");
      }

      const sync = payload.result?.capacitySync;
      const nextState = sync?.state ? pretty(sync.state) : "capacity truth saved";
      setMessage(`Saved. Atlas re-evaluated the weekly capacity state: ${nextState}.`);
      setSaved(true);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save this Farm Hand Day Shape.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={cardStyle} aria-label={`Resolve ${target.farmName} Farm Hand capacity truth`}>
      <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .6 }}>
        {target.farmName} · {target.workerLabel} · {target.weekStart}–{target.weekEnd}
      </span>
      <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>Missing Farm Hand capacity truth</h2>
      <p style={{ margin: "9px 0 0", lineHeight: 1.5 }}><strong>Threshold crossed:</strong> {target.threshold}</p>
      <p style={{ margin: "6px 0 0", lineHeight: 1.5 }}><strong>Why it matters:</strong> {target.consequence}</p>
      <p style={{ margin: "6px 0 0", lineHeight: 1.5 }}><strong>Ownership:</strong> {target.ownerDecision}</p>

      <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 18 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={labelStyle}>Real working weekdays</legend>
          <p style={{ margin: "5px 0 9px", fontSize: 13, opacity: .68 }}>Choose only the days this Farm Hand is actually available. Atlas will not assume a six-day week.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {weekdayOptions.map(([day, label]) => {
              const checked = selectedWeekdays.includes(day);
              return (
                <label key={day} style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 10px", border: "1px solid rgba(38,38,38,.14)", borderRadius: 10, background: checked ? "rgba(38,38,38,.08)" : "transparent" }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleWeekday(day)} />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Local start</span>
            <input style={inputStyle} type="time" value={localStart} onChange={(event) => setLocalStart(event.target.value)} required />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Local end</span>
            <input style={inputStyle} type="time" value={localEnd} onChange={(event) => setLocalEnd(event.target.value)} required />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Effective from</span>
            <input style={inputStyle} type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required />
          </label>
        </div>

        <label style={fieldStyle}>
          <span style={labelStyle}>Why this is the real Day Shape</span>
          <textarea
            style={{ ...inputStyle, minHeight: 86, resize: "vertical" }}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Record the human truth Atlas should remember—not a capacity target you want the work to fit inside."
            required
          />
        </label>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button
            type="submit"
            disabled={saving || !selectedWeekdays.length || !localStart || !localEnd || !effectiveFrom || !reason.trim()}
            style={{ border: 0, borderRadius: 12, padding: "11px 16px", fontWeight: 900, background: "#262626", color: "#fffdf8", cursor: "pointer", opacity: saving ? .6 : 1 }}
          >
            {saving ? "Saving…" : "Save capacity truth"}
          </button>
          <span style={{ fontSize: 12, opacity: .65 }}>
            {weekdaySummary || "No weekdays selected"}{localStart && localEnd ? ` · ${localStart}–${localEnd}` : ""}
          </span>
        </div>

        {message ? (
          <p role="status" style={{ margin: 0, padding: "10px 12px", borderRadius: 10, background: saved ? "rgba(49,92,55,.08)" : "rgba(130,54,42,.08)", lineHeight: 1.45 }}>
            {message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
