"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type CapacityPolicy = {
  id: string;
  stable_key: string;
  name: string;
  weekdays: number[];
  local_start: string;
  local_end: string;
  default_discretionary_minutes: number;
  maximum_planned_minutes: number;
  effective_from: string;
  effective_through: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type CapacityPolicyResponse = {
  ok?: boolean;
  state?: string;
  policies?: CapacityPolicy[];
  error?: string;
};

const weekdayOptions = [
  { value: 0, short: "Sun", label: "Sunday" },
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
];

function timeLabel(value: string) {
  if (!value) return "—";
  const [hoursRaw, minutes = "00"] = value.slice(0, 5).split(":");
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours)) return value.slice(0, 5);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes} ${suffix}`;
}

function dateLabel(value: string | null) {
  if (!value) return "open-ended";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function weekdayLabel(days: number[]) {
  const normalized = new Set(days.map(Number));
  if (normalized.size === 7) return "Every day";
  return weekdayOptions.filter((day) => normalized.has(day.value)).map((day) => day.short).join(" · ") || "No days";
}

export default function PrincipalCapacityClient() {
  const [policies, setPolicies] = useState<CapacityPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  const activePolicies = useMemo(() => policies.filter((policy) => policy.active !== false), [policies]);

  async function loadPolicies() {
    try {
      setLoading(true);
      const response = await fetch("/api/atlas/principal/capacity-policy", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as CapacityPolicyResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "Principal Capacity policies could not be loaded.");
      setPolicies(body.policies ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Principal Capacity policies could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPolicies();
  }, []);

  function toggleDay(day: number) {
    setSelectedDays((current) => current.includes(day)
      ? current.filter((value) => value !== day)
      : [...current, day].sort((a, b) => a - b));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? "").trim(),
      weekdays: selectedDays,
      localStart: String(form.get("localStart") ?? ""),
      localEnd: String(form.get("localEnd") ?? ""),
      defaultDiscretionaryMinutes: String(form.get("defaultDiscretionaryMinutes") ?? ""),
      maximumPlannedMinutes: String(form.get("maximumPlannedMinutes") ?? ""),
      effectiveFrom: String(form.get("effectiveFrom") ?? ""),
      effectiveThrough: String(form.get("effectiveThrough") ?? ""),
    };

    try {
      setSaving(true);
      const response = await fetch("/api/atlas/principal/capacity-policy", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Atlas-Intent": "principal-capacity-policy-v1",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as CapacityPolicyResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "Principal Capacity policy could not be saved.");

      setSuccess("Principal Capacity policy saved. Atlas can now resolve capacity on matching effective days.");
      event.currentTarget.reset();
      setSelectedDays([]);
      await loadPolicies();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Principal Capacity policy could not be saved.");
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
            <span className="atlas-phone-title">Capacity</span>
          </Link>
          <span className="atlas-weather-line">Owner-authored</span>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-owner-body">
          <Link href="/owner" className="atlas-route-back">← Principal</Link>

          <section className="atlas-overview-hero atlas-owner-hero">
            <div><strong>Define the container</strong><span>Atlas will not guess your day.</span></div>
            <p>Capacity tells the Principal Clock what portion of a local day may be planned. It does not create farm work or decide what deserves the floor.</p>
          </section>

          <section className="atlas-overview-zone-card atlas-owner-section" data-principal-capacity-authoring="true">
            <summary>
              <div><strong>New capacity policy</strong><span>All fields are explicit</span></div>
              <b>Author</b>
            </summary>

            <form onSubmit={submit} style={{ display: "grid", gap: 16, padding: "14px 18px 18px" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <strong>Policy name</strong>
                <span style={{ fontSize: 12, opacity: .65 }}>Use a name that tells you what reality this policy represents.</span>
                <input name="name" required placeholder="e.g. Regular home week" autoComplete="off" />
              </label>

              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ fontWeight: 800, marginBottom: 8 }}>Days this policy applies</legend>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                  {weekdayOptions.map((day) => {
                    const checked = selectedDays.includes(day.value);
                    return (
                      <label key={day.value} style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid rgba(0,0,0,.1)", borderRadius: 12, padding: "9px 10px", cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleDay(day.value)} aria-label={day.label} />
                        <span>{day.short}</span>
                      </label>
                    );
                  })}
                </div>
                {!selectedDays.length ? <span style={{ display: "block", marginTop: 7, fontSize: 12, opacity: .62 }}>No days selected yet.</span> : null}
              </fieldset>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Local start</strong>
                  <input name="localStart" type="time" required />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Local end</strong>
                  <input name="localEnd" type="time" required />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Discretionary minutes</strong>
                  <span style={{ fontSize: 12, opacity: .65 }}>The ordinary planning budget inside the day.</span>
                  <input name="defaultDiscretionaryMinutes" type="number" min="0" step="1" required inputMode="numeric" />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Maximum planned minutes</strong>
                  <span style={{ fontSize: 12, opacity: .65 }}>A hard ceiling; must be at least discretionary minutes.</span>
                  <input name="maximumPlannedMinutes" type="number" min="0" step="1" required inputMode="numeric" />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Effective from</strong>
                  <input name="effectiveFrom" type="date" required />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Effective through</strong>
                  <span style={{ fontSize: 12, opacity: .65 }}>Optional.</span>
                  <input name="effectiveThrough" type="date" />
                </label>
              </div>

              {error ? <p role="alert" style={{ margin: 0, fontWeight: 700 }}>{error}</p> : null}
              {success ? <p role="status" style={{ margin: 0, fontWeight: 700 }}>{success}</p> : null}

              <button type="submit" disabled={saving || selectedDays.length === 0}>
                {saving ? "Saving…" : "Save Principal Capacity policy"}
              </button>
            </form>
          </section>

          <section className="atlas-overview-zone-card atlas-owner-section" data-principal-capacity-policies="true">
            <summary>
              <div><strong>Recorded policies</strong><span>Principal-authored capacity truth</span></div>
              <b>{loading ? "…" : activePolicies.length}</b>
            </summary>
            <div style={{ display: "grid", gap: 10, padding: "0 14px 14px" }}>
              {loading ? <p className="atlas-task-page-muted">Loading capacity policies…</p> : null}
              {!loading && !activePolicies.length ? <p className="atlas-task-page-muted">No Principal Capacity policy has been authored yet.</p> : null}
              {activePolicies.map((policy) => (
                <article key={policy.id} style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <strong>{policy.name}</strong>
                    <span style={{ fontSize: 12, opacity: .62 }}>{weekdayLabel(policy.weekdays)}</span>
                  </div>
                  <p style={{ margin: "5px 0 0", opacity: .7, fontSize: 13 }}>
                    {timeLabel(policy.local_start)}–{timeLabel(policy.local_end)} · {policy.default_discretionary_minutes} discretionary min · {policy.maximum_planned_minutes} max min
                  </p>
                  <p style={{ margin: "4px 0 0", opacity: .58, fontSize: 12 }}>
                    {dateLabel(policy.effective_from)} → {dateLabel(policy.effective_through)}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
