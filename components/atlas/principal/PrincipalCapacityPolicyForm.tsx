"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type CapacityPolicy = {
  id: string;
  stableKey: string;
  name: string;
  weekdays: number[];
  localStart: string;
  localEnd: string;
  defaultDiscretionaryMinutes: number;
  maximumPlannedMinutes: number;
  effectiveFrom: string;
  effectiveThrough: string | null;
  active: boolean;
};

type CapacityState = {
  state?: string;
  capacityKnown?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  elapsedMinutes?: number | null;
  blockedMinutes?: number | null;
  availableElapsedMinutes?: number | null;
  discretionaryCapacityMinutes?: number | null;
  maximumPlannedMinutes?: number | null;
  reason?: string | null;
};

type CapacityReadResponse = {
  ok?: boolean;
  policies?: CapacityPolicy[];
  capacityToday?: CapacityState | null;
  error?: string;
};

type CapacityWriteResponse = {
  ok?: boolean;
  capacityOnEffectiveFrom?: CapacityState | null;
  error?: string;
};

type Props = {
  timezone: string;
};

const dayOptions = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function dateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function minutesLabel(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "unknown";
  const minutes = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export default function PrincipalCapacityPolicyForm({ timezone }: Props) {
  const today = useMemo(() => dateInTimezone(timezone), [timezone]);
  const [stableKey, setStableKey] = useState("principal-baseline");
  const [name, setName] = useState("Principal baseline");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [localStart, setLocalStart] = useState("");
  const [localEnd, setLocalEnd] = useState("");
  const [defaultMinutes, setDefaultMinutes] = useState("");
  const [maximumMinutes, setMaximumMinutes] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [effectiveThrough, setEffectiveThrough] = useState("");
  const [capacityToday, setCapacityToday] = useState<CapacityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/atlas/principal/capacity-policy", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const body = await response.json() as CapacityReadResponse;
        if (!response.ok || !body.ok) throw new Error(body.error || "Principal Capacity could not be loaded.");
        if (!active) return;

        setCapacityToday(body.capacityToday ?? null);
        const policy = body.policies?.[0] ?? null;
        if (policy) {
          setStableKey(policy.stableKey);
          setName(policy.name);
          setWeekdays(policy.weekdays ?? []);
          setLocalStart(policy.localStart || "");
          setLocalEnd(policy.localEnd || "");
          setDefaultMinutes(String(policy.defaultDiscretionaryMinutes ?? ""));
          setMaximumMinutes(String(policy.maximumPlannedMinutes ?? ""));
          setEffectiveFrom(policy.effectiveFrom || today);
          setEffectiveThrough(policy.effectiveThrough || "");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Principal Capacity could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [today]);

  function toggleDay(value: number) {
    setWeekdays((current) => current.includes(value)
      ? current.filter((day) => day !== value)
      : [...current, value]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!weekdays.length) {
      setError("Choose at least one day. Atlas will not infer your workweek.");
      return;
    }

    const discretionary = Number(defaultMinutes);
    const maximum = Number(maximumMinutes);
    if (!Number.isInteger(discretionary) || !Number.isInteger(maximum)) {
      setError("Discretionary and maximum planned minutes must be whole numbers.");
      return;
    }

    try {
      setSaving(true);
      const response = await fetch("/api/atlas/principal/capacity-policy", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          stableKey,
          name,
          weekdays,
          localStart,
          localEnd,
          defaultDiscretionaryMinutes: discretionary,
          maximumPlannedMinutes: maximum,
          effectiveFrom,
          effectiveThrough: effectiveThrough || null,
          metadata: { authoredFrom: "principal-capacity-page-v1" },
        }),
      });
      const body = await response.json() as CapacityWriteResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "Principal Capacity could not be saved.");
      setCapacityToday(body.capacityOnEffectiveFrom ?? null);
      setMessage("Principal Capacity saved. The Clock can now use this envelope on matching effective days.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Principal Capacity could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f5f1e8", color: "#262626", padding: "24px 16px 48px" }}>
      <div style={{ width: "min(760px, 100%)", margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ borderRadius: 18, background: "#24251f", color: "#f8f4e8", padding: 20 }}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .7 }}>Atlas · Principal Capacity</span>
          <h1 style={{ margin: "6px 0 0", fontSize: 34 }}>Define the day Atlas is allowed to use</h1>
          <p style={{ margin: "10px 0 0", lineHeight: 1.55, opacity: .78 }}>
            This is an outer capacity envelope, not a work quota. Household and fixed commitments subtract from it before Principal Clock can place discretionary work.
          </p>
          <Link href="/principal" style={{ display: "inline-block", marginTop: 14, color: "inherit" }}>← Principal home</Link>
        </header>

        <section style={{ border: "1px solid rgba(38,38,38,.12)", borderRadius: 18, background: "rgba(255,255,255,.76)", padding: 18 }}>
          <strong>Current truth</strong>
          {loading ? <p>Loading authored capacity.</p> : capacityToday?.capacityKnown ? (
            <p style={{ lineHeight: 1.55 }}>
              Today resolves to {minutesLabel(capacityToday.discretionaryCapacityMinutes)} discretionary, {minutesLabel(capacityToday.maximumPlannedMinutes)} maximum planned, with {minutesLabel(capacityToday.blockedMinutes)} already blocked.
            </p>
          ) : (
            <p style={{ lineHeight: 1.55 }}>
              Capacity is still unanchored for today. {capacityToday?.reason || "No effective Principal Capacity policy defines this day."}
            </p>
          )}
        </section>

        <form onSubmit={submit} style={{ border: "1px solid rgba(38,38,38,.12)", borderRadius: 18, background: "rgba(255,255,255,.76)", padding: 18, display: "grid", gap: 18 }}>
          <div>
            <label htmlFor="capacity-name" style={{ display: "block", fontWeight: 800 }}>Policy name</label>
            <input id="capacity-name" value={name} onChange={(event) => setName(event.target.value)} required style={{ width: "100%", marginTop: 6, padding: 10 }} />
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 800 }}>Days this envelope applies</legend>
            <p style={{ margin: "4px 0 10px", fontSize: 13, opacity: .68 }}>No days are assumed when a policy has not been authored.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {dayOptions.map((day) => (
                <label key={day.value} style={{ border: "1px solid rgba(38,38,38,.18)", borderRadius: 999, padding: "8px 11px", cursor: "pointer" }}>
                  <input type="checkbox" checked={weekdays.includes(day.value)} onChange={() => toggleDay(day.value)} style={{ marginRight: 6 }} />
                  {day.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label style={{ fontWeight: 800 }}>Local start
              <input type="time" value={localStart} onChange={(event) => setLocalStart(event.target.value)} required style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} />
            </label>
            <label style={{ fontWeight: 800 }}>Local end
              <input type="time" value={localEnd} onChange={(event) => setLocalEnd(event.target.value)} required style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} />
            </label>
          </div>
          <p style={{ margin: "-10px 0 0", fontSize: 13, opacity: .68 }}>Times are interpreted in {timezone}.</p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={{ fontWeight: 800 }}>Ordinary discretionary minutes
              <input type="number" min="0" step="1" value={defaultMinutes} onChange={(event) => setDefaultMinutes(event.target.value)} required style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} />
              <small style={{ display: "block", marginTop: 5, fontWeight: 400, opacity: .65 }}>How much Principal work Atlas may ordinarily plan inside the available envelope.</small>
            </label>
            <label style={{ fontWeight: 800 }}>Maximum planned minutes
              <input type="number" min="0" step="1" value={maximumMinutes} onChange={(event) => setMaximumMinutes(event.target.value)} required style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} />
              <small style={{ display: "block", marginTop: 5, fontWeight: 400, opacity: .65 }}>Hard ceiling after fixed/household blocks are subtracted.</small>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label style={{ fontWeight: 800 }}>Effective from
              <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} />
            </label>
            <label style={{ fontWeight: 800 }}>Effective through <span style={{ fontWeight: 400, opacity: .6 }}>(optional)</span>
              <input type="date" value={effectiveThrough} onChange={(event) => setEffectiveThrough(event.target.value)} style={{ display: "block", width: "100%", marginTop: 6, padding: 10 }} />
            </label>
          </div>

          {error ? <div role="alert" style={{ borderRadius: 12, padding: 12, background: "#fff3f0" }}>{error}</div> : null}
          {message ? <div role="status" style={{ borderRadius: 12, padding: 12, background: "#eff7ef" }}>{message}</div> : null}

          <button type="submit" disabled={saving || loading} style={{ border: 0, borderRadius: 999, background: "#24251f", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: saving ? "wait" : "pointer" }}>
            {saving ? "Saving…" : "Save Principal Capacity"}
          </button>
        </form>
      </div>
    </main>
  );
}
