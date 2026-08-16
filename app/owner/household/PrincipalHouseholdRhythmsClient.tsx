"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type HouseholdRhythm = {
  id: string;
  stable_key: string;
  area: string;
  title: string;
  cadence_rule: string | null;
  next_window_start: string | null;
  next_window_end: string | null;
  expected_minutes: number | null;
  protection_level: string;
  floor_class: number;
  interruptibility: string;
  principal_required: boolean;
  consequence: string | null;
  reason_for_floor: string;
  active: boolean;
  blocks_capacity: boolean;
};

type HouseholdRhythmsResponse = {
  ok?: boolean;
  state?: string;
  householdName?: string;
  homeTimezone?: string;
  rhythms?: HouseholdRhythm[];
  error?: string;
};

const protectionLevels = ["critical", "protected", "standard", "optional"];
const floorClasses = [
  { value: 1, label: "1 · Human / safety / fixed-time reality" },
  { value: 2, label: "2 · Closing or irreversible window" },
  { value: 3, label: "3 · Protected rhythm / protected strategy" },
  { value: 4, label: "4 · Owner decision" },
  { value: 5, label: "5 · Planned value creation" },
  { value: 6, label: "6 · Delegated operational exception" },
  { value: 7, label: "7 · Backlog / optional" },
];
const interruptibilityValues = [
  { value: "interruptible", label: "Interruptible" },
  { value: "low_interruptibility", label: "Low interruptibility" },
  { value: "should_not_interrupt", label: "Should not interrupt" },
];

function label(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "—";
}

function dateTimeLabel(value: string | null, timeZone: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PrincipalHouseholdRhythmsClient() {
  const [rhythms, setRhythms] = useState<HouseholdRhythm[]>([]);
  const [householdName, setHouseholdName] = useState("Household");
  const [homeTimezone, setHomeTimezone] = useState("America/Chicago");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const activeRhythms = useMemo(() => rhythms.filter((rhythm) => rhythm.active !== false), [rhythms]);

  async function loadRhythms() {
    try {
      setLoading(true);
      const response = await fetch("/api/atlas/principal/household-rhythms", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as HouseholdRhythmsResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "Household rhythms could not be loaded.");
      setRhythms(body.rhythms ?? []);
      if (body.householdName) setHouseholdName(body.householdName);
      if (body.homeTimezone) setHomeTimezone(body.homeTimezone);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Household rhythms could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRhythms();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      area: String(form.get("area") ?? "").trim(),
      title: String(form.get("title") ?? "").trim(),
      cadenceRule: String(form.get("cadenceRule") ?? "").trim(),
      expectedMinutes: String(form.get("expectedMinutes") ?? ""),
      protectionLevel: String(form.get("protectionLevel") ?? ""),
      floorClass: String(form.get("floorClass") ?? ""),
      interruptibility: String(form.get("interruptibility") ?? ""),
      consequence: String(form.get("consequence") ?? "").trim(),
      reasonForFloor: String(form.get("reasonForFloor") ?? "").trim(),
      nextWindowStart: String(form.get("nextWindowStart") ?? ""),
      nextWindowEnd: String(form.get("nextWindowEnd") ?? ""),
      principalRequired: form.get("principalRequired") === "on",
      blocksCapacity: form.get("blocksCapacity") === "on",
    };

    try {
      setSaving(true);
      const response = await fetch("/api/atlas/principal/household-rhythms", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Atlas-Intent": "principal-household-rhythm-v1",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as HouseholdRhythmsResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "Household rhythm could not be saved.");

      setSuccess("Household rhythm saved. Capacity blocking and Principal Clock candidacy will follow the two choices you authored below.");
      formElement.reset();
      await loadRhythms();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Household rhythm could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-owner-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/owner" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Principal</span>
            <span className="atlas-phone-title">Household</span>
          </Link>
          <span className="atlas-weather-line">{householdName}</span>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-owner-body">
          <Link href="/owner" className="atlas-route-back">← Principal</Link>

          <section className="atlas-overview-hero atlas-owner-hero">
            <div><strong>Household is a Principal domain</strong><span>{homeTimezone}</span></div>
            <p>A household rhythm may reserve real capacity without becoming farm work. It becomes a Principal Clock claim only when the Principal is actually required.</p>
          </section>

          <section className="atlas-overview-zone-card atlas-owner-section" data-principal-household-rhythm-authoring="true">
            <summary>
              <div><strong>New Household rhythm</strong><span>Capacity and candidacy stay separate</span></div>
              <b>Author</b>
            </summary>

            <form onSubmit={submit} style={{ display: "grid", gap: 16, padding: "14px 18px 18px" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <strong>Household area</strong>
                <span style={{ fontSize: 12, opacity: .65 }}>Use your own household vocabulary.</span>
                <input name="area" required autoComplete="off" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <strong>Rhythm title</strong>
                <input name="title" required autoComplete="off" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <strong>Cadence rule / pattern</strong>
                <span style={{ fontSize: 12, opacity: .65 }}>Optional descriptive pattern. The recorded next window below is what can currently block capacity.</span>
                <textarea name="cadenceRule" rows={2} />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Expected minutes</strong>
                  <input name="expectedMinutes" type="number" min="1" step="1" required inputMode="numeric" />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Protection level</strong>
                  <select name="protectionLevel" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {protectionLevels.map((value) => <option key={value} value={value}>{label(value)}</option>)}
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Floor class</strong>
                  <select name="floorClass" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {floorClasses.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Interruptibility</strong>
                  <select name="interruptibility" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {interruptibilityValues.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                  </select>
                </label>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <strong>Consequence if this rhythm is missed</strong>
                <textarea name="consequence" rows={2} />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <strong>Why this floor class?</strong>
                <textarea name="reasonForFloor" rows={2} required />
              </label>

              <fieldset style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 12, margin: 0 }}>
                <legend style={{ fontWeight: 800, padding: "0 5px" }}>Next real window · optional</legend>
                <p style={{ margin: "0 0 12px", fontSize: 12, opacity: .65 }}>Only an actual recorded start + end can subtract time from current Principal Capacity. Times are interpreted in {homeTimezone}.</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 5 }}><strong>Window start</strong><input name="nextWindowStart" type="datetime-local" /></label>
                  <label style={{ display: "grid", gap: 5 }}><strong>Window end</strong><input name="nextWindowEnd" type="datetime-local" /></label>
                </div>
              </fieldset>

              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input name="blocksCapacity" type="checkbox" />
                  <span><strong>Blocks Principal capacity</strong><small style={{ display: "block", marginTop: 2, opacity: .65 }}>Check only when this household window consumes real Principal availability. This does not make it farm work.</small></span>
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input name="principalRequired" type="checkbox" />
                  <span><strong>Principal required</strong><small style={{ display: "block", marginTop: 2, opacity: .65 }}>Check only when your presence/action is required. This is what allows the rhythm to become a Principal Clock candidate.</small></span>
                </label>
              </div>

              {error ? <p role="alert" style={{ margin: 0, fontWeight: 700 }}>{error}</p> : null}
              {success ? <p role="status" style={{ margin: 0, fontWeight: 700 }}>{success}</p> : null}

              <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Household rhythm"}</button>
            </form>
          </section>

          <section className="atlas-overview-zone-card atlas-owner-section" data-principal-household-rhythms="true">
            <summary>
              <div><strong>Recorded Household rhythms</strong><span>Not farm tasks</span></div>
              <b>{loading ? "…" : activeRhythms.length}</b>
            </summary>
            <div style={{ display: "grid", gap: 10, padding: "0 14px 14px" }}>
              {loading ? <p className="atlas-task-page-muted">Loading Household rhythms…</p> : null}
              {!loading && !activeRhythms.length ? <p className="atlas-task-page-muted">No Household rhythms have been authored yet.</p> : null}
              {activeRhythms.map((rhythm) => {
                const start = dateTimeLabel(rhythm.next_window_start, homeTimezone);
                const end = dateTimeLabel(rhythm.next_window_end, homeTimezone);
                return (
                  <article key={rhythm.id} style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                      <strong>{rhythm.title}</strong>
                      <b>Class {rhythm.floor_class}</b>
                    </div>
                    <p style={{ margin: "5px 0 0", opacity: .68, fontSize: 13 }}>{rhythm.area} · {label(rhythm.protection_level)} · {rhythm.expected_minutes ?? "—"} min</p>
                    <p style={{ margin: "5px 0 0", opacity: .62, fontSize: 12 }}>{rhythm.blocks_capacity ? "Blocks capacity" : "Does not block capacity"} · {rhythm.principal_required ? "Principal required" : "Principal not required"}</p>
                    {start && end ? <p style={{ margin: "5px 0 0", opacity: .62, fontSize: 12 }}>Next: {start} → {end}</p> : null}
                    {rhythm.cadence_rule ? <p style={{ margin: "6px 0 0", fontSize: 13 }}>Pattern: {rhythm.cadence_rule}</p> : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
