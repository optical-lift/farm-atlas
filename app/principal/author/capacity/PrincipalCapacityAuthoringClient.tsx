"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type SaveKind = "capacity_policy" | "household_rhythm";
type SaveState = { kind: SaveKind | null; status: "idle" | "saving" | "saved" | "error"; message: string };

const panelStyle = {
  border: "1px solid rgba(38,38,38,.12)",
  borderRadius: 18,
  background: "rgba(255,255,255,.82)",
  padding: 18,
  boxShadow: "0 10px 32px rgba(47,43,31,.045)",
} as const;
const fieldStyle = { display: "grid", gap: 6 } as const;
const labelStyle = { fontSize: 12, fontWeight: 850 } as const;
const inputStyle = {
  width: "100%",
  minHeight: 44,
  border: "1px solid rgba(38,38,38,.18)",
  borderRadius: 11,
  background: "#fffdf8",
  color: "#262626",
  padding: "10px 11px",
} as const;
const textareaStyle = { ...inputStyle, minHeight: 90, resize: "vertical" as const } as const;

function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}
function optionalText(data: FormData, key: string) {
  return text(data, key) || null;
}
function numberValue(data: FormData, key: string) {
  const value = text(data, key);
  return value === "" ? null : Number(value);
}

async function save(kind: SaveKind, input: Record<string, unknown>) {
  const response = await fetch("/api/atlas/principal/capacity-authoring", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, input }),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; error?: string | { message?: string } } | null;
  if (!response.ok || !body?.ok) {
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new Error(message || "Atlas could not save this Principal capacity record.");
  }
}

function Result({ state, kind }: { state: SaveState; kind: SaveKind }) {
  if (state.kind !== kind || state.status === "idle") return null;
  const background = state.status === "error" ? "#f7e2dc" : state.status === "saved" ? "#e7ecd0" : "#ece9db";
  return <p role="status" style={{ margin: "12px 0 0", padding: "10px 12px", borderRadius: 10, background, lineHeight: 1.45 }}>{state.message}</p>;
}

const weekdays = [
  [0, "Sun"], [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"],
] as const;

export default function PrincipalCapacityAuthoringClient({ householdName, householdTimezone }: { householdName: string; householdTimezone: string }) {
  const router = useRouter();
  const [state, setState] = useState<SaveState>({ kind: null, status: "idle", message: "" });

  async function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const selectedWeekdays = data.getAll("weekdays").map((value) => Number(value));
    setState({ kind: "capacity_policy", status: "saving", message: "Saving Principal capacity policy…" });
    try {
      await save("capacity_policy", {
        name: text(data, "name"),
        weekdays: selectedWeekdays,
        localStart: text(data, "localStart"),
        localEnd: text(data, "localEnd"),
        defaultDiscretionaryMinutes: numberValue(data, "defaultDiscretionaryMinutes"),
        maximumPlannedMinutes: numberValue(data, "maximumPlannedMinutes"),
        effectiveFrom: text(data, "effectiveFrom"),
        effectiveThrough: optionalText(data, "effectiveThrough"),
      });
      setState({ kind: "capacity_policy", status: "saved", message: "Capacity policy saved. Atlas can now distinguish available Principal time from an empty calendar." });
      router.refresh();
    } catch (error) {
      setState({ kind: "capacity_policy", status: "error", message: error instanceof Error ? error.message : "Capacity policy could not be saved." });
    }
  }

  async function submitRhythm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState({ kind: "household_rhythm", status: "saving", message: "Saving household rhythm…" });
    try {
      await save("household_rhythm", {
        title: text(data, "title"),
        area: text(data, "area"),
        cadenceRule: text(data, "cadenceRule"),
        nextWindowStartLocal: text(data, "nextWindowStartLocal"),
        nextWindowEndLocal: text(data, "nextWindowEndLocal"),
        expectedMinutes: numberValue(data, "expectedMinutes"),
        protectionLevel: text(data, "protectionLevel"),
        floorClass: numberValue(data, "floorClass"),
        interruptibility: text(data, "interruptibility"),
        consequence: text(data, "consequence"),
        reasonForFloor: text(data, "reasonForFloor"),
        blocksCapacity: data.get("blocksCapacity") === "on",
      });
      form.reset();
      setState({ kind: "household_rhythm", status: "saved", message: "Household rhythm saved. Recurring windows will advance automatically in the household timezone and can constrain Principal capacity." });
      router.refresh();
    } catch (error) {
      setState({ kind: "household_rhythm", status: "error", message: error instanceof Error ? error.message : "Household rhythm could not be saved." });
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <form onSubmit={submitPolicy} style={panelStyle}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .58 }}>Principal Capacity</span>
        <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>Define the day Atlas is allowed to allocate</h2>
        <p style={{ margin: "8px 0 16px", lineHeight: 1.55, opacity: .72 }}>
          This is not a productivity target. It is the outer boundary of available Principal time before household blocks, fixed commitments, and protected rhythms subtract from it. Times are interpreted in {householdTimezone}.
        </p>
        <div style={{ display: "grid", gap: 13 }}>
          <label style={fieldStyle}><span style={labelStyle}>Policy name *</span><input name="name" required style={inputStyle} placeholder="Normal weekday capacity" /></label>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ ...labelStyle, marginBottom: 8 }}>Days this policy applies *</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {weekdays.map(([value, label]) => (
                <label key={value} style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 38, padding: "7px 10px", border: "1px solid rgba(38,38,38,.14)", borderRadius: 10, background: "#fffdf8" }}>
                  <input type="checkbox" name="weekdays" value={value} /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Local day starts *</span><input name="localStart" type="time" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Local day ends *</span><input name="localEnd" type="time" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Discretionary minutes *</span><input name="defaultDiscretionaryMinutes" type="number" min="0" step="1" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Maximum planned minutes *</span><input name="maximumPlannedMinutes" type="number" min="0" step="1" required style={inputStyle} /></label>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, opacity: .65 }}>
            Discretionary minutes are how much of the remaining window Atlas may normally allocate. Maximum planned minutes are the hard ceiling even on an unusually open day.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Effective from *</span><input name="effectiveFrom" type="date" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Effective through</span><input name="effectiveThrough" type="date" style={inputStyle} /></label>
          </div>
        </div>
        <button type="submit" disabled={state.status === "saving" && state.kind === "capacity_policy"} style={{ marginTop: 16, minHeight: 44, border: 0, borderRadius: 12, padding: "10px 16px", background: "#24251f", color: "#f8f4e8", fontWeight: 900 }}>Save Capacity Policy</button>
        <Result state={state} kind="capacity_policy" />
      </form>

      <form onSubmit={submitRhythm} style={panelStyle}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .58 }}>Household &amp; Family</span>
        <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>Give household reality a protected rhythm</h2>
        <p style={{ margin: "8px 0 16px", lineHeight: 1.55, opacity: .72 }}>
          {householdName} is a Principal domain, not a farm interruption. The first window anchors the rhythm in {householdTimezone}; daily, weekly, and five-week cadences advance automatically without requiring Atlas to be opened.
        </p>
        <div style={{ display: "grid", gap: 13 }}>
          <label style={fieldStyle}><span style={labelStyle}>Rhythm title *</span><input name="title" required style={inputStyle} placeholder="Weekly kitchen reset" /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Household area *</span>
              <select name="area" required defaultValue="" style={inputStyle}>
                <option value="" disabled>Choose household area</option>
                <option value="Whole household / people">Whole household / people</option>
                <option value="Zone 1 — Entry / porch / arrival / dining areas">Zone 1 — Entry / porch / arrival / dining</option>
                <option value="Zone 2 — Kitchen / pantry / food-storage areas">Zone 2 — Kitchen / pantry / food storage</option>
                <option value="Zone 3 — Main bathroom + rotating secondary room">Zone 3 — Main bathroom + secondary room</option>
                <option value="Zone 4 — Primary bedroom / closet / attached bath">Zone 4 — Primary bedroom / closet / bath</option>
                <option value="Zone 5 — Living / family room">Zone 5 — Living / family room</option>
                <option value="Other household area">Other household area</option>
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Cadence *</span>
              <select name="cadenceRule" required defaultValue="" style={inputStyle}>
                <option value="" disabled>Choose cadence</option>
                <option value="once">One time</option>
                <option value="daily">Daily maintenance</option>
                <option value="weekly">Weekly recurring care</option>
                <option value="every_5_weeks">Every 5 weeks · rotating-zone cadence</option>
              </select>
            </label>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, opacity: .65 }}>
            For the five-zone household system, author each zone as its own every-five-weeks rhythm and place its first window in the week that zone should own. Atlas then preserves the rotation automatically.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>First window starts *</span><input name="nextWindowStartLocal" type="datetime-local" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>First window ends *</span><input name="nextWindowEndLocal" type="datetime-local" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Expected minutes *</span><input name="expectedMinutes" type="number" min="1" step="1" required style={inputStyle} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Protection *</span><select name="protectionLevel" required defaultValue="protected" style={inputStyle}><option value="critical">Critical</option><option value="protected">Protected</option><option value="standard">Standard</option><option value="optional">Optional</option></select></label>
            <label style={fieldStyle}><span style={labelStyle}>Floor class *</span><select name="floorClass" required defaultValue="3" style={inputStyle}><option value="1">1 · Human / fixed-time</option><option value="2">2 · Closing window</option><option value="3">3 · Protected rhythm / strategy</option><option value="4">4 · Owner decision</option><option value="5">5 · Planned value creation</option><option value="6">6 · Delegated exception</option><option value="7">7 · Backlog / optional</option></select></label>
            <label style={fieldStyle}><span style={labelStyle}>Interruptibility *</span><select name="interruptibility" required defaultValue="low_interruptibility" style={inputStyle}><option value="interruptible">Interruptible</option><option value="low_interruptibility">Low interruptibility</option><option value="should_not_interrupt">Should not interrupt</option></select></label>
          </div>
          <label style={fieldStyle}><span style={labelStyle}>Consequence if this disappears *</span><textarea name="consequence" required style={textareaStyle} placeholder="What human, household, readiness, or future condition deteriorates when this rhythm is repeatedly displaced?" /></label>
          <label style={fieldStyle}><span style={labelStyle}>Why it may earn the Principal floor *</span><textarea name="reasonForFloor" required style={textareaStyle} placeholder="Why is this protected household reality allowed to compete with portfolio work?" /></label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input name="blocksCapacity" type="checkbox" defaultChecked /> This window consumes Principal capacity</label>
        </div>
        <button type="submit" disabled={state.status === "saving" && state.kind === "household_rhythm"} style={{ marginTop: 16, minHeight: 44, border: 0, borderRadius: 12, padding: "10px 16px", background: "#24251f", color: "#f8f4e8", fontWeight: 900 }}>Save Household Rhythm</button>
        <Result state={state} kind="household_rhythm" />
      </form>
    </div>
  );
}
