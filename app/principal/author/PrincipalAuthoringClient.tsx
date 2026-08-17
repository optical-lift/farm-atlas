"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { AtlasPrincipalPortfolioUnit } from "@/lib/atlas/principal-self-context";

type SaveState = {
  kind: "owner_obligation" | "portfolio_thesis" | null;
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

const fieldStyle = {
  display: "grid",
  gap: 6,
} as const;

const labelStyle = {
  fontSize: 12,
  fontWeight: 850,
} as const;

const inputStyle = {
  width: "100%",
  minHeight: 44,
  border: "1px solid rgba(38,38,38,.18)",
  borderRadius: 11,
  background: "#fffdf8",
  color: "#262626",
  padding: "10px 11px",
} as const;

const textareaStyle = {
  ...inputStyle,
  minHeight: 92,
  resize: "vertical" as const,
} as const;

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

async function savePrincipalRecord(kind: "owner_obligation" | "portfolio_thesis", input: Record<string, unknown>) {
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
    throw new Error(message || "Atlas could not save this Principal record.");
  }
}

function ResultBanner({ state, kind }: { state: SaveState; kind: SaveState["kind"] }) {
  if (state.kind !== kind || state.status === "idle") return null;
  const background = state.status === "error" ? "#f7e2dc" : state.status === "saved" ? "#e7ecd0" : "#ece9db";
  return (
    <p role="status" style={{ margin: "12px 0 0", padding: "10px 12px", borderRadius: 10, background, lineHeight: 1.4 }}>
      {state.message}
    </p>
  );
}

export default function PrincipalAuthoringClient({ units }: { units: AtlasPrincipalPortfolioUnit[] }) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<SaveState>({ kind: null, status: "idle", message: "" });

  async function submitOwnerObligation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSaveState({ kind: "owner_obligation", status: "saving", message: "Saving Owner Obligation…" });

    try {
      await savePrincipalRecord("owner_obligation", {
        title: text(formData, "title"),
        domain: text(formData, "domain"),
        portfolioUnitStableKey: optionalText(formData, "portfolioUnitStableKey"),
        description: optionalText(formData, "description"),
        horizon: optionalText(formData, "horizon"),
        expectedMinutes: numberValue(formData, "expectedMinutes"),
        protectionLevel: text(formData, "protectionLevel"),
        floorClass: numberValue(formData, "floorClass"),
        ownerCapability: text(formData, "ownerCapability"),
        interruptibility: text(formData, "interruptibility"),
        consequenceOfDelay: text(formData, "consequenceOfDelay"),
        reasonForFloor: text(formData, "reasonForFloor"),
        becomesRelevantAt: isoValue(formData, "becomesRelevantAt"),
        mustBeginBy: isoValue(formData, "mustBeginBy"),
        mustFinishBy: isoValue(formData, "mustFinishBy"),
      });
      form.reset();
      setSaveState({ kind: "owner_obligation", status: "saved", message: "Owner Obligation saved. Atlas can now carry it into Principal Clock arbitration." });
      router.refresh();
    } catch (error) {
      setSaveState({ kind: "owner_obligation", status: "error", message: error instanceof Error ? error.message : "Owner Obligation could not be saved." });
    }
  }

  async function submitPortfolioThesis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSaveState({ kind: "portfolio_thesis", status: "saving", message: "Saving portfolio thesis…" });

    try {
      await savePrincipalRecord("portfolio_thesis", {
        portfolioUnitStableKey: text(formData, "portfolioUnitStableKey"),
        thesisStatement: text(formData, "thesisStatement"),
        valueCreationLogic: optionalText(formData, "valueCreationLogic"),
        mustBecomeTrue: lines(formData, "mustBecomeTrue"),
        nextValueMilestone: optionalText(formData, "nextValueMilestone"),
        assumptions: lines(formData, "assumptions"),
        reconsiderationConditions: lines(formData, "reconsiderationConditions"),
        reviewCadenceDays: numberValue(formData, "reviewCadenceDays"),
        nextReviewAt: isoValue(formData, "nextReviewAt"),
        status: "draft",
      });
      setSaveState({ kind: "portfolio_thesis", status: "saved", message: "Draft thesis saved. Atlas can now remember why this unit belongs and what must become true." });
      router.refresh();
    } catch (error) {
      setSaveState({ kind: "portfolio_thesis", status: "error", message: error instanceof Error ? error.message : "Portfolio thesis could not be saved." });
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <form onSubmit={submitOwnerObligation} style={panelStyle}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .58 }}>Owner Obligation</span>
        <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>Give Atlas something only ownership can carry</h2>
        <p style={{ margin: "8px 0 16px", lineHeight: 1.5, opacity: .72 }}>
          This is strategic ownership work, not a delegated task. Atlas needs enough truth to know when it becomes relevant and why it is allowed to compete for Principal time.
        </p>

        <div style={{ display: "grid", gap: 13 }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Title *</span>
            <input name="title" required style={inputStyle} placeholder="Plan Elm 2027 crop rotation" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Domain *</span>
              <select name="domain" required defaultValue="" style={inputStyle}>
                <option value="" disabled>Choose the responsibility domain</option>
                <option value="household">Household &amp; Family</option>
                <option value="portfolio">Feast Guild / Portfolio</option>
                <option value="treasury">Money / Treasury</option>
                <option value="teams">Teams / Functions</option>
                <option value="principal">Principal / Life</option>
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Portfolio unit</span>
              <select name="portfolioUnitStableKey" defaultValue="" style={inputStyle}>
                <option value="">Whole Principal field / none</option>
                {units.map((unit) => <option key={unit.id} value={unit.stableKey}>{unit.horizon ? `${unit.horizon} · ` : ""}{unit.name}</option>)}
              </select>
            </label>
          </div>

          <label style={fieldStyle}>
            <span style={labelStyle}>Description</span>
            <textarea name="description" style={textareaStyle} placeholder="What ownership actually needs to think through, decide, prepare, create, fund, or communicate." />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Horizon</span>
              <select name="horizon" defaultValue="" style={inputStyle}>
                <option value="">No horizon</option>
                <option value="H1">H1 · current engine</option>
                <option value="H2">H2 · emerging engine</option>
                <option value="H3">H3 · future option</option>
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Expected Principal minutes *</span>
              <input name="expectedMinutes" type="number" min="1" step="1" required style={inputStyle} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Owner capability *</span>
              <select name="ownerCapability" required defaultValue="" style={inputStyle}>
                <option value="" disabled>What only ownership must do</option>
                <option value="think">Think</option>
                <option value="decide">Decide</option>
                <option value="approve">Approve</option>
                <option value="plan">Plan</option>
                <option value="review">Review</option>
                <option value="create">Create</option>
                <option value="communicate">Communicate</option>
                <option value="fund">Fund</option>
              </select>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Protection level *</span>
              <select name="protectionLevel" required defaultValue="" style={inputStyle}>
                <option value="" disabled>Choose protection</option>
                <option value="critical">Critical</option>
                <option value="protected">Protected</option>
                <option value="standard">Standard</option>
                <option value="optional">Optional</option>
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Floor class *</span>
              <select name="floorClass" required defaultValue="" style={inputStyle}>
                <option value="" disabled>Why it may get the floor</option>
                <option value="1">1 · Human / safety / fixed-time reality</option>
                <option value="2">2 · Closing or irreversible window</option>
                <option value="3">3 · Protected rhythm / strategy</option>
                <option value="4">4 · Owner decision</option>
                <option value="5">5 · Planned value creation</option>
                <option value="6">6 · Delegated operational exception</option>
                <option value="7">7 · Backlog / optional</option>
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Interruptibility *</span>
              <select name="interruptibility" required defaultValue="low_interruptibility" style={inputStyle}>
                <option value="interruptible">Interruptible</option>
                <option value="low_interruptibility">Low interruptibility</option>
                <option value="should_not_interrupt">Should not interrupt</option>
              </select>
            </label>
          </div>

          <label style={fieldStyle}>
            <span style={labelStyle}>Consequence of delay *</span>
            <textarea name="consequenceOfDelay" required style={textareaStyle} placeholder="What future option, capacity, value, relationship, or window is damaged if this is delayed?" />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Reason it may earn the floor *</span>
            <textarea name="reasonForFloor" required style={textareaStyle} placeholder="Why should Atlas permit this to speak to the Principal instead of leaving it contained?" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Becomes relevant</span>
              <input name="becomesRelevantAt" type="datetime-local" style={inputStyle} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Must begin by</span>
              <input name="mustBeginBy" type="datetime-local" style={inputStyle} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Must finish by</span>
              <input name="mustFinishBy" type="datetime-local" style={inputStyle} />
            </label>
          </div>
        </div>

        <button type="submit" disabled={saveState.status === "saving"} style={{ marginTop: 16, minHeight: 44, border: 0, borderRadius: 12, padding: "10px 16px", background: "#24251f", color: "#f8f4e8", fontWeight: 900 }}>
          Save Owner Obligation
        </button>
        <ResultBanner state={saveState} kind="owner_obligation" />
      </form>

      <form onSubmit={submitPortfolioThesis} style={panelStyle}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .58 }}>Portfolio Thesis</span>
        <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>Tell Atlas why a unit belongs</h2>
        <p style={{ margin: "8px 0 16px", lineHeight: 1.5, opacity: .72 }}>
          Atlas will store this as a draft until the thesis is actually stated. It will not infer a portfolio thesis from task volume, revenue, or how noisy a farm happens to be.
        </p>

        <div style={{ display: "grid", gap: 13 }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Portfolio unit *</span>
            <select name="portfolioUnitStableKey" required defaultValue="" style={inputStyle}>
              <option value="" disabled>Choose the unit</option>
              {units.map((unit) => <option key={unit.id} value={unit.stableKey}>{unit.horizon ? `${unit.horizon} · ` : ""}{unit.name}</option>)}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Thesis statement *</span>
            <textarea name="thesisStatement" required style={textareaStyle} placeholder="Why does this belong in the portfolio?" />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>How it creates value</span>
            <textarea name="valueCreationLogic" style={textareaStyle} placeholder="What is the value-creation logic if the thesis is right?" />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>What must become true</span>
            <textarea name="mustBecomeTrue" style={textareaStyle} placeholder="One condition per line" />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Next value milestone</span>
            <input name="nextValueMilestone" style={inputStyle} placeholder="The next observable thing that would make this unit more valuable or more proven" />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Assumptions</span>
              <textarea name="assumptions" style={textareaStyle} placeholder="One assumption per line" />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Reconsideration / exit conditions</span>
              <textarea name="reconsiderationConditions" style={textareaStyle} placeholder="One condition per line" />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Review cadence (days)</span>
              <input name="reviewCadenceDays" type="number" min="1" step="1" style={inputStyle} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Next review</span>
              <input name="nextReviewAt" type="datetime-local" style={inputStyle} />
            </label>
          </div>
        </div>

        <button type="submit" disabled={saveState.status === "saving"} style={{ marginTop: 16, minHeight: 44, border: 0, borderRadius: 12, padding: "10px 16px", background: "#24251f", color: "#f8f4e8", fontWeight: 900 }}>
          Save Draft Thesis
        </button>
        <ResultBanner state={saveState} kind="portfolio_thesis" />
      </form>
    </div>
  );
}
