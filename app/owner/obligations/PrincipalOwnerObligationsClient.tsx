"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type PortfolioUnit = {
  id: string;
  stableKey: string;
  name: string;
  horizon: string;
};

type OwnerObligation = {
  id: string;
  stable_key: string | null;
  domain: string;
  portfolio_unit_id: string | null;
  title: string;
  description: string | null;
  horizon: string | null;
  becomes_relevant_at: string | null;
  must_begin_by: string | null;
  must_finish_by: string | null;
  fixed_at: string | null;
  expires_at: string | null;
  preferred_window: string | null;
  expected_minutes: number;
  protection_level: string;
  floor_class: number;
  owner_capability: string;
  interruptibility: string;
  delegable: boolean;
  owner_required: boolean;
  consequence_of_delay: string;
  reason_for_floor: string;
  status: string;
};

type ObligationsResponse = {
  ok?: boolean;
  state?: string;
  homeTimezone?: string;
  obligations?: OwnerObligation[];
  portfolioUnits?: PortfolioUnit[];
  error?: string;
};

const floorClasses = [
  { value: 1, label: "1 · Human / safety / fixed-time reality" },
  { value: 2, label: "2 · Closing or irreversible window" },
  { value: 3, label: "3 · Protected rhythm / protected strategy" },
  { value: 4, label: "4 · Owner decision" },
  { value: 5, label: "5 · Planned value creation" },
  { value: 6, label: "6 · Delegated operational exception" },
  { value: 7, label: "7 · Backlog / optional" },
];

const protectionLevels = ["critical", "protected", "standard", "optional"];
const ownerCapabilities = ["think", "decide", "approve", "plan", "review", "create", "communicate", "fund"];
const interruptibilityValues = [
  { value: "interruptible", label: "Interruptible" },
  { value: "low_interruptibility", label: "Low interruptibility" },
  { value: "should_not_interrupt", label: "Should not interrupt" },
];

function label(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "—";
}

function dateTimeLabel(value: string | null | undefined, timeZone: string) {
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

export default function PrincipalOwnerObligationsClient() {
  const [obligations, setObligations] = useState<OwnerObligation[]>([]);
  const [portfolioUnits, setPortfolioUnits] = useState<PortfolioUnit[]>([]);
  const [homeTimezone, setHomeTimezone] = useState("America/Chicago");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const openObligations = useMemo(
    () => obligations.filter((obligation) => !["completed", "cancelled"].includes(obligation.status)),
    [obligations],
  );

  async function loadObligations() {
    try {
      setLoading(true);
      const response = await fetch("/api/atlas/principal/owner-obligations", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as ObligationsResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "Owner Obligations could not be loaded.");
      setObligations(body.obligations ?? []);
      setPortfolioUnits(body.portfolioUnits ?? []);
      if (body.homeTimezone) setHomeTimezone(body.homeTimezone);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Owner Obligations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadObligations();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      domain: String(form.get("domain") ?? "").trim(),
      portfolioUnitStableKey: String(form.get("portfolioUnitStableKey") ?? ""),
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      horizon: String(form.get("horizon") ?? ""),
      expectedMinutes: String(form.get("expectedMinutes") ?? ""),
      protectionLevel: String(form.get("protectionLevel") ?? ""),
      floorClass: String(form.get("floorClass") ?? ""),
      ownerCapability: String(form.get("ownerCapability") ?? ""),
      interruptibility: String(form.get("interruptibility") ?? ""),
      consequenceOfDelay: String(form.get("consequenceOfDelay") ?? "").trim(),
      reasonForFloor: String(form.get("reasonForFloor") ?? "").trim(),
      becomesRelevantAt: String(form.get("becomesRelevantAt") ?? ""),
      mustBeginBy: String(form.get("mustBeginBy") ?? ""),
      mustFinishBy: String(form.get("mustFinishBy") ?? ""),
      fixedAt: String(form.get("fixedAt") ?? ""),
      expiresAt: String(form.get("expiresAt") ?? ""),
      preferredWindowStart: String(form.get("preferredWindowStart") ?? ""),
      preferredWindowEnd: String(form.get("preferredWindowEnd") ?? ""),
      delegable: form.get("delegable") === "on",
    };

    try {
      setSaving(true);
      const response = await fetch("/api/atlas/principal/owner-obligations", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Atlas-Intent": "principal-owner-obligation-v1",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as ObligationsResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "Owner Obligation could not be saved.");

      setSuccess("Owner Obligation saved. Its Clock candidacy now comes from the authored timing, protection, consequence, and floor contract.");
      formElement.reset();
      await loadObligations();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Owner Obligation could not be saved.");
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
            <span className="atlas-phone-title">Obligations</span>
          </Link>
          <span className="atlas-weather-line">Owner work</span>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-owner-body">
          <Link href="/owner" className="atlas-route-back">← Principal</Link>

          <section className="atlas-overview-hero atlas-owner-hero">
            <div><strong>Protect work before it becomes late</strong><span>{homeTimezone}</span></div>
            <p>An Owner Obligation is responsibility that belongs to the Principal. It may exist before a conventional due date and may carry different begin, finish, fixed, expiry, and preferred-window boundaries.</p>
          </section>

          <section className="atlas-overview-zone-card atlas-owner-section" data-principal-obligation-authoring="true">
            <summary>
              <div><strong>New Owner Obligation</strong><span>Responsibility + consequence + timing</span></div>
              <b>Author</b>
            </summary>

            <form onSubmit={submit} style={{ display: "grid", gap: 16, padding: "14px 18px 18px" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <strong>Domain</strong>
                <span style={{ fontSize: 12, opacity: .65 }}>Name the responsibility domain in your own vocabulary.</span>
                <input name="domain" required autoComplete="off" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <strong>Portfolio unit</strong>
                <span style={{ fontSize: 12, opacity: .65 }}>Optional. Leave blank when the responsibility is not owned by one portfolio unit.</span>
                <select name="portfolioUnitStableKey" defaultValue="">
                  <option value="">No portfolio unit</option>
                  {portfolioUnits.map((unit) => <option key={unit.id} value={unit.stableKey}>{unit.name} · {unit.horizon}</option>)}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <strong>Title</strong>
                <input name="title" required autoComplete="off" />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <strong>Description</strong>
                <textarea name="description" rows={3} />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Horizon</strong>
                  <select name="horizon" defaultValue="">
                    <option value="">No horizon</option>
                    <option value="H1">H1 · current engine</option>
                    <option value="H2">H2 · emerging engine</option>
                    <option value="H3">H3 · future option</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Expected Owner minutes</strong>
                  <input name="expectedMinutes" type="number" min="1" step="1" required inputMode="numeric" />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Protection level</strong>
                  <select name="protectionLevel" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {protectionLevels.map((value) => <option key={value} value={value}>{label(value)}</option>)}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Floor class</strong>
                  <select name="floorClass" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {floorClasses.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>Owner capability</strong>
                  <select name="ownerCapability" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {ownerCapabilities.map((value) => <option key={value} value={value}>{label(value)}</option>)}
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
                <strong>Consequence of delay</strong>
                <textarea name="consequenceOfDelay" rows={2} required />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <strong>Why has it earned the floor?</strong>
                <textarea name="reasonForFloor" rows={2} required />
              </label>

              <fieldset style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 12, margin: 0 }}>
                <legend style={{ fontWeight: 800, padding: "0 5px" }}>Timing boundaries · optional</legend>
                <p style={{ margin: "0 0 12px", fontSize: 12, opacity: .65 }}>Only record a boundary when reality supplies it. Times are interpreted in {homeTimezone}.</p>
                <div style={{ display: "grid", gap: 12 }}>
                  <label style={{ display: "grid", gap: 5 }}><strong>Becomes relevant at</strong><input name="becomesRelevantAt" type="datetime-local" /></label>
                  <label style={{ display: "grid", gap: 5 }}><strong>Must begin by</strong><input name="mustBeginBy" type="datetime-local" /></label>
                  <label style={{ display: "grid", gap: 5 }}><strong>Must finish by</strong><input name="mustFinishBy" type="datetime-local" /></label>
                  <label style={{ display: "grid", gap: 5 }}><strong>Fixed at</strong><input name="fixedAt" type="datetime-local" /></label>
                  <label style={{ display: "grid", gap: 5 }}><strong>Expires at</strong><input name="expiresAt" type="datetime-local" /></label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <label style={{ display: "grid", gap: 5 }}><strong>Preferred window start</strong><input name="preferredWindowStart" type="datetime-local" /></label>
                    <label style={{ display: "grid", gap: 5 }}><strong>Preferred window end</strong><input name="preferredWindowEnd" type="datetime-local" /></label>
                  </div>
                </div>
              </fieldset>

              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input name="delegable" type="checkbox" />
                <span><strong>Delegable</strong><small style={{ display: "block", marginTop: 2, opacity: .65 }}>Check only if execution may be delegated even though the responsibility remains visible to the Principal.</small></span>
              </label>

              {error ? <p role="alert" style={{ margin: 0, fontWeight: 700 }}>{error}</p> : null}
              {success ? <p role="status" style={{ margin: 0, fontWeight: 700 }}>{success}</p> : null}

              <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Owner Obligation"}</button>
            </form>
          </section>

          <section className="atlas-overview-zone-card atlas-owner-section" data-principal-obligations="true">
            <summary>
              <div><strong>Open Owner Obligations</strong><span>Principal responsibility inventory</span></div>
              <b>{loading ? "…" : openObligations.length}</b>
            </summary>
            <div style={{ display: "grid", gap: 10, padding: "0 14px 14px" }}>
              {loading ? <p className="atlas-task-page-muted">Loading Owner Obligations…</p> : null}
              {!loading && !openObligations.length ? <p className="atlas-task-page-muted">No Owner Obligations have been authored yet.</p> : null}
              {openObligations.map((obligation) => {
                const begin = dateTimeLabel(obligation.must_begin_by, homeTimezone);
                const finish = dateTimeLabel(obligation.must_finish_by, homeTimezone);
                const relevant = dateTimeLabel(obligation.becomes_relevant_at, homeTimezone);
                return (
                  <article key={obligation.id} style={{ border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                      <strong>{obligation.title}</strong>
                      <b>Class {obligation.floor_class}</b>
                    </div>
                    <p style={{ margin: "5px 0 0", opacity: .68, fontSize: 13 }}>{obligation.domain} · {label(obligation.owner_capability)} · {label(obligation.protection_level)} · {obligation.expected_minutes} min</p>
                    {relevant || begin || finish ? <p style={{ margin: "5px 0 0", opacity: .62, fontSize: 12 }}>{relevant ? `Relevant ${relevant}` : ""}{begin ? `${relevant ? " · " : ""}Begin by ${begin}` : ""}{finish ? `${relevant || begin ? " · " : ""}Finish by ${finish}` : ""}</p> : null}
                    <p style={{ margin: "7px 0 0", fontSize: 13 }}><strong>Delay:</strong> {obligation.consequence_of_delay}</p>
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
