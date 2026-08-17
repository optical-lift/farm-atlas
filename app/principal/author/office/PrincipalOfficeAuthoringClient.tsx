"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type {
  AtlasPrincipalOperatingFunction,
  AtlasPrincipalPortfolioUnit,
} from "@/lib/atlas/principal-self-context";

type OfficeKind =
  | "attention_policy"
  | "operating_function"
  | "great_game_scorecard"
  | "capital_request"
  | "investment_opportunity";

type SaveState = {
  kind: OfficeKind | null;
  status: "idle" | "saving" | "saved" | "error";
  message: string;
};

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

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function numberValue(formData: FormData, key: string) {
  const value = text(formData, key);
  return value ? Number(value) : null;
}

function isoValue(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function lines(formData: FormData, key: string) {
  return text(formData, key)
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function savePrincipalRecord(kind: OfficeKind, input: Record<string, unknown>) {
  const response = await fetch("/api/atlas/principal/authoring", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, input }),
  });

  const body = await response.json().catch(() => null) as {
    ok?: boolean;
    error?: { message?: string } | string;
  } | null;

  if (!response.ok || !body?.ok) {
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new Error(message || "Atlas could not save this Principal Office record.");
  }
}

function ResultBanner({ state, kind }: { state: SaveState; kind: OfficeKind }) {
  if (state.kind !== kind || state.status === "idle") return null;
  const background = state.status === "error" ? "#f7e2dc" : state.status === "saved" ? "#e7ecd0" : "#ece9db";
  return (
    <p role="status" style={{ margin: "12px 0 0", padding: "10px 12px", borderRadius: 10, background, lineHeight: 1.4 }}>
      {state.message}
    </p>
  );
}

function SaveButton({ state, kind, children }: { state: SaveState; kind: OfficeKind; children: string }) {
  return (
    <button
      type="submit"
      disabled={state.status === "saving" && state.kind === kind}
      style={{ marginTop: 16, minHeight: 44, border: 0, borderRadius: 12, padding: "10px 16px", background: "#24251f", color: "#f8f4e8", fontWeight: 900 }}
    >
      {children}
    </button>
  );
}

function UnitSelect({ units, required = false, name = "portfolioUnitStableKey" }: { units: AtlasPrincipalPortfolioUnit[]; required?: boolean; name?: string }) {
  return (
    <select name={name} required={required} defaultValue="" style={inputStyle}>
      <option value="">{required ? "Choose a portfolio unit" : "Whole Principal field / none"}</option>
      {units.map((unit) => (
        <option key={unit.id} value={unit.stableKey}>{unit.horizon ? `${unit.horizon} · ` : ""}{unit.name}</option>
      ))}
    </select>
  );
}

export default function PrincipalOfficeAuthoringClient({
  units,
  functions,
}: {
  units: AtlasPrincipalPortfolioUnit[];
  functions: AtlasPrincipalOperatingFunction[];
}) {
  const router = useRouter();
  const [state, setState] = useState<SaveState>({ kind: null, status: "idle", message: "" });

  async function submit(kind: OfficeKind, input: Record<string, unknown>, form: HTMLFormElement, success: string) {
    setState({ kind, status: "saving", message: "Saving…" });
    try {
      await savePrincipalRecord(kind, input);
      form.reset();
      setState({ kind, status: "saved", message: success });
      router.refresh();
    } catch (error) {
      setState({ kind, status: "error", message: error instanceof Error ? error.message : "Atlas could not save this record." });
    }
  }

  async function submitAttention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submit("attention_policy", {
      subjectTitle: text(data, "subjectTitle"),
      subjectType: text(data, "subjectType"),
      portfolioUnitStableKey: optionalText(data, "portfolioUnitStableKey"),
      cadenceDays: numberValue(data, "cadenceDays"),
      firstDueAt: isoValue(data, "firstDueAt"),
      protectedOwnerMinutes: numberValue(data, "protectedOwnerMinutes"),
      floorClass: numberValue(data, "floorClass"),
      protectionLevel: text(data, "protectionLevel"),
      interruptibility: text(data, "interruptibility"),
      consequence: text(data, "consequence"),
      reasonForFloor: text(data, "reasonForFloor"),
    }, form, "Attention policy saved. Atlas can now remember this quiet responsibility even when nothing is urgent.");
  }

  async function submitFunction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submit("operating_function", {
      name: text(data, "name"),
      charter: text(data, "charter"),
      portfolioUnitStableKey: optionalText(data, "portfolioUnitStableKey"),
      capacityState: optionalText(data, "capacityState"),
      reviewCadenceDays: numberValue(data, "reviewCadenceDays"),
    }, form, "Durable function saved. Hiring or reassignment can now change the carrier without redesigning the function.");
  }

  async function submitScorecard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submit("great_game_scorecard", {
      name: text(data, "name"),
      criticalNumber: text(data, "criticalNumber"),
      drivers: lines(data, "drivers"),
      operatingFunctionStableKey: optionalText(data, "operatingFunctionStableKey"),
      portfolioUnitStableKey: optionalText(data, "portfolioUnitStableKey"),
    }, form, "Great Game scorecard saved. Atlas now has a higher-level operational signal to carry instead of twenty underlying tasks.");
  }

  async function submitCapital(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submit("capital_request", {
      title: text(data, "title"),
      portfolioUnitStableKey: optionalText(data, "portfolioUnitStableKey"),
      amount: numberValue(data, "amount"),
      currency: text(data, "currency"),
      neededBy: isoValue(data, "neededBy"),
      reason: text(data, "reason"),
    }, form, "Capital request saved into House Position stewardship.");
  }

  async function submitOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submit("investment_opportunity", {
      title: text(data, "title"),
      portfolioUnitStableKey: optionalText(data, "portfolioUnitStableKey"),
      readinessState: text(data, "readinessState"),
      capitalRequired: numberValue(data, "capitalRequired"),
      currency: optionalText(data, "currency"),
      nextValueMilestone: optionalText(data, "nextValueMilestone"),
    }, form, "Investment opportunity saved. Atlas can now distinguish investment-ready, unfunded, and not-ready opportunity state.");
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <form onSubmit={submitAttention} style={panelStyle}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .58 }}>Attention Capital</span>
        <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>Protect a quiet responsibility</h2>
        <p style={{ margin: "8px 0 16px", lineHeight: 1.5, opacity: .72 }}>Attention debt is institutional memory, not a guilt score. State the cadence and the consequence so H1 noise cannot erase H2, H3, household, or other quiet domains.</p>
        <div style={{ display: "grid", gap: 13 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Subject type *</span><select name="subjectType" required defaultValue="" style={inputStyle}><option value="" disabled>Choose type</option><option value="portfolio_unit">Portfolio unit</option><option value="household">Household</option><option value="function">Function</option><option value="domain">Domain</option><option value="other">Other</option></select></label>
            <label style={fieldStyle}><span style={labelStyle}>Portfolio unit</span><UnitSelect units={units} /></label>
          </div>
          <label style={fieldStyle}><span style={labelStyle}>Attention subject *</span><input name="subjectTitle" required style={inputStyle} placeholder="Waiting Room landscape planning" /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Review cadence (days) *</span><input name="cadenceDays" type="number" min="1" step="1" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>First due *</span><input name="firstDueAt" type="datetime-local" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Protected Principal minutes *</span><input name="protectedOwnerMinutes" type="number" min="1" step="1" required style={inputStyle} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Protection *</span><select name="protectionLevel" required defaultValue="" style={inputStyle}><option value="" disabled>Choose protection</option><option value="critical">Critical</option><option value="protected">Protected</option><option value="standard">Standard</option><option value="optional">Optional</option></select></label>
            <label style={fieldStyle}><span style={labelStyle}>Floor class *</span><select name="floorClass" required defaultValue="" style={inputStyle}><option value="" disabled>Choose class</option><option value="1">1 · Human / fixed-time</option><option value="2">2 · Closing window</option><option value="3">3 · Protected rhythm / strategy</option><option value="4">4 · Owner decision</option><option value="5">5 · Planned value creation</option><option value="6">6 · Delegated exception</option><option value="7">7 · Backlog / optional</option></select></label>
            <label style={fieldStyle}><span style={labelStyle}>Interruptibility</span><select name="interruptibility" defaultValue="low_interruptibility" style={inputStyle}><option value="interruptible">Interruptible</option><option value="low_interruptibility">Low interruptibility</option><option value="should_not_interrupt">Should not interrupt</option></select></label>
          </div>
          <label style={fieldStyle}><span style={labelStyle}>Consequence if neglected *</span><textarea name="consequence" required style={textareaStyle} /></label>
          <label style={fieldStyle}><span style={labelStyle}>Why it may earn the floor *</span><textarea name="reasonForFloor" required style={textareaStyle} /></label>
        </div>
        <SaveButton state={state} kind="attention_policy">Save Attention Policy</SaveButton>
        <ResultBanner state={state} kind="attention_policy" />
      </form>

      <form onSubmit={submitFunction} style={panelStyle}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .58 }}>Teams / Functions</span>
        <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>Name a durable function</h2>
        <p style={{ margin: "8px 0 16px", lineHeight: 1.5, opacity: .72 }}>The function survives a staffing change. State what the institution needs this function to carry; accountable people can change later.</p>
        <div style={{ display: "grid", gap: 13 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Function name *</span><input name="name" required style={inputStyle} placeholder="Farm Operations" /></label>
            <label style={fieldStyle}><span style={labelStyle}>Portfolio unit</span><UnitSelect units={units} /></label>
          </div>
          <label style={fieldStyle}><span style={labelStyle}>Charter *</span><textarea name="charter" required style={textareaStyle} placeholder="What this function is responsible for preserving and producing." /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Capacity state</span><input name="capacityState" style={inputStyle} placeholder="State it only if known" /></label>
            <label style={fieldStyle}><span style={labelStyle}>Review cadence (days)</span><input name="reviewCadenceDays" type="number" min="1" step="1" style={inputStyle} /></label>
          </div>
        </div>
        <SaveButton state={state} kind="operating_function">Save Durable Function</SaveButton>
        <ResultBanner state={state} kind="operating_function" />
      </form>

      <form onSubmit={submitScorecard} style={panelStyle}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .58 }}>Great Game</span>
        <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>Define an operational scoreboard</h2>
        <p style={{ margin: "8px 0 16px", lineHeight: 1.5, opacity: .72 }}>One Critical Number should tell the Principal more than a pile of underlying tasks. Scope the scorecard to a durable function or portfolio unit.</p>
        <div style={{ display: "grid", gap: 13 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Scorecard name *</span><input name="name" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Critical Number *</span><input name="criticalNumber" required style={inputStyle} placeholder="What single operating number matters?" /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Operating function</span><select name="operatingFunctionStableKey" defaultValue="" style={inputStyle}><option value="">No function selected</option>{functions.map((fn) => <option key={fn.id} value={fn.stableKey}>{fn.name}</option>)}</select></label>
            <label style={fieldStyle}><span style={labelStyle}>Portfolio unit</span><UnitSelect units={units} /></label>
          </div>
          {!functions.length ? <p style={{ margin: 0, padding: "9px 11px", borderRadius: 10, background: "#ece9db", lineHeight: 1.45 }}>No durable functions exist yet. You can scope this scorecard directly to a portfolio unit, or save a function above and return after the page refreshes.</p> : null}
          <label style={fieldStyle}><span style={labelStyle}>Drivers</span><textarea name="drivers" style={textareaStyle} placeholder="One driver per line" /></label>
        </div>
        <SaveButton state={state} kind="great_game_scorecard">Save Scorecard</SaveButton>
        <ResultBanner state={state} kind="great_game_scorecard" />
      </form>

      <form onSubmit={submitCapital} style={panelStyle}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .58 }}>Money / Treasury</span>
        <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>State a capital request</h2>
        <p style={{ margin: "8px 0 16px", lineHeight: 1.5, opacity: .72 }}>A request is not a balance and not an approval. It tells House Position that a real claim on capital exists and why.</p>
        <div style={{ display: "grid", gap: 13 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Request title *</span><input name="title" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Portfolio unit</span><UnitSelect units={units} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Amount *</span><input name="amount" type="number" min="0.01" step="0.01" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Currency *</span><input name="currency" required maxLength={3} style={inputStyle} placeholder="USD" /></label>
            <label style={fieldStyle}><span style={labelStyle}>Needed by</span><input name="neededBy" type="datetime-local" style={inputStyle} /></label>
          </div>
          <label style={fieldStyle}><span style={labelStyle}>Reason *</span><textarea name="reason" required style={textareaStyle} placeholder="What does this capital protect, unlock, or make possible?" /></label>
        </div>
        <SaveButton state={state} kind="capital_request">Save Capital Request</SaveButton>
        <ResultBanner state={state} kind="capital_request" />
      </form>

      <form onSubmit={submitOpportunity} style={panelStyle}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .58 }}>Capital Allocation</span>
        <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>State an investment opportunity</h2>
        <p style={{ margin: "8px 0 16px", lineHeight: 1.5, opacity: .72 }}>House Position must distinguish an opportunity that is investment-ready from one that is merely unfunded or not ready.</p>
        <div style={{ display: "grid", gap: 13 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Opportunity title *</span><input name="title" required style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Portfolio unit</span><UnitSelect units={units} /></label>
          </div>
          <label style={fieldStyle}><span style={labelStyle}>Readiness *</span><select name="readinessState" required defaultValue="" style={inputStyle}><option value="" disabled>Choose readiness</option><option value="investment_ready">Investment ready</option><option value="unfunded">Unfunded</option><option value="not_ready">Not ready</option></select></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}><span style={labelStyle}>Capital required</span><input name="capitalRequired" type="number" min="0.01" step="0.01" style={inputStyle} /></label>
            <label style={fieldStyle}><span style={labelStyle}>Currency if capital stated</span><input name="currency" maxLength={3} style={inputStyle} placeholder="USD" /></label>
          </div>
          <label style={fieldStyle}><span style={labelStyle}>Next value milestone</span><input name="nextValueMilestone" style={inputStyle} /></label>
        </div>
        <SaveButton state={state} kind="investment_opportunity">Save Investment Opportunity</SaveButton>
        <ResultBanner state={state} kind="investment_opportunity" />
      </form>
    </div>
  );
}
