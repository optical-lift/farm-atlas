"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import "./production.css";
import "./production-rules.css";

type Succession = {
  id: string;
  sequence_number: number;
  planned_window_start: string;
  planned_window_end: string;
  late_window_end: string;
  skip_after_date: string;
  actual_sow_date: string | null;
  projected_germination_start: string | null;
  projected_germination_end: string | null;
  projected_harvest_start: string | null;
  projected_harvest_end: string | null;
  projected_clear_date: string | null;
  state: string;
  sow_task_id: string | null;
  crop_cycle_id: string | null;
};

type Plan = {
  id: string;
  stable_key: string;
  season_year: number;
  plan_label: string;
  plan_kind: string;
  first_window_start: string;
  succession_count: number;
  spacing_days: number;
  window_length_days: number;
  late_window_days: number;
  missed_strategy: "skip" | "merge" | "preserve";
  intended_uses: string[];
  protect_final_succession: boolean;
  final_biological_sow_date: string | null;
  notes: string | null;
  metadata?: Record<string, unknown> | null;
  crop_profiles: { crop_label?: string; variety?: string | null } | null;
  production_successions: Succession[];
};

type Rule = {
  id: string;
  stable_key: string;
  rule_label: string;
  crop_profile_id: string | null;
  crop_match: string | null;
  plan_kind: string;
  default_anchor_month_day: string | null;
  default_succession_count: number;
  default_spacing_days: number;
  default_window_length_days: number;
  default_late_window_days: number;
  missed_strategy: "skip" | "merge" | "preserve";
  overlap_policy: "none" | "limited" | "allowed" | "replacement";
  protect_final_succession: boolean;
  final_window_rule: string;
  series_behavior: string;
  operational_summary: string;
  crop_profiles: { id: string; stable_key: string; crop_label: string; variety: string | null; default_planting_method: string | null } | null;
};

function pretty(dateIso: string | null | undefined) {
  if (!dateIso) return "Not set";
  const date = new Date(`${dateIso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateIso : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function defaultAnchor(rule: Rule, year: number) {
  return rule.default_anchor_month_day ? `${year}-${rule.default_anchor_month_day}` : "";
}

function operationalStatus(succession: Succession, plan: Plan) {
  if (["skipped", "sown", "germinated", "harvesting", "cleared"].includes(succession.state)) return succession.state;
  const today = todayIso();
  if (today < succession.planned_window_start) {
    const days = Math.ceil((new Date(`${succession.planned_window_start}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
    return `Window opens in ${days} day${days === 1 ? "" : "s"}`;
  }
  if (today <= succession.planned_window_end) {
    const days = Math.ceil((new Date(`${succession.planned_window_end}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
    return days <= 2 ? "Closing soon" : `In window · ${days} days remain`;
  }
  if (today >= succession.skip_after_date && plan.missed_strategy === "skip") return succession.sequence_number === plan.succession_count ? "Final succession—frost deadline applies" : `Skip succession ${succession.sequence_number} and protect succession ${succession.sequence_number + 1}`;
  return `Late for succession ${succession.sequence_number}`;
}

export default function ProductionCalendarPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planningYear = 2027;

  async function load() {
    try {
      setLoading(true);
      const [planResponse, ruleResponse] = await Promise.all([
        fetch("/api/atlas/production-plans", { cache: "no-store" }),
        fetch("/api/atlas/production-rules", { cache: "no-store" }),
      ]);
      const [planData, ruleData] = await Promise.all([planResponse.json(), ruleResponse.json()]);
      if (!planResponse.ok || !planData.ok) throw new Error(planData.error || "Production plans failed.");
      if (!ruleResponse.ok || !ruleData.ok) throw new Error(ruleData.error || "Production rules failed.");
      setPlans(planData.plans ?? []);
      setRules(ruleData.rules ?? []);
      setSelectedRuleId((current) => current || ruleData.rules?.find((rule: Rule) => rule.crop_profile_id)?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Production plans failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const orderedPlans = useMemo(() => plans.map((plan) => ({ ...plan, production_successions: [...(plan.production_successions ?? [])].sort((a, b) => a.sequence_number - b.sequence_number) })), [plans]);
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId) ?? null;

  async function patch(body: Record<string, unknown>) {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch("/api/atlas/production-plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-atlas-intent": "production-plan-v1" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Production update failed.");
      setPlans(data.plans ?? []);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Production update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function createFromRule(form: HTMLFormElement) {
    try {
      setSaving(true);
      setError(null);
      const data = new FormData(form);
      const response = await fetch("/api/atlas/production-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-atlas-intent": "production-rule-v1" },
        body: JSON.stringify({
          ruleId: String(data.get("ruleId")),
          cropProfileId: selectedRule?.crop_profile_id,
          seasonYear: Number(data.get("seasonYear")),
          firstWindowStart: String(data.get("firstWindowStart")),
          finalBiologicalSowDate: String(data.get("finalBiologicalSowDate") || ""),
          intendedUses: String(data.get("intendedUses") || "").split(",").map((item) => item.trim()).filter(Boolean),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Production plan creation failed.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Production plan creation failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="atlas-production-shell">
      <header className="atlas-production-header">
        <Link href="/">← Atlas</Link>
        <div><span>Production calendar</span><strong>Crop plans, not floating deadlines</strong></div>
        <em>{saving ? "Saving…" : "Elm Farm"}</em>
      </header>

      {error ? <div className="atlas-production-error">{error}</div> : null}
      {loading ? <div className="atlas-production-empty">Loading crop plans…</div> : null}

      {!loading ? (
        <section className="atlas-production-rule-library">
          <div className="atlas-production-rule-head">
            <div><span>Crop-specific instructions</span><h1>Production rule library</h1><p>Each crop keeps its own cadence, overlap behavior, missed-sowing rule, and series identity.</p></div>
          </div>
          <div className="atlas-production-rule-grid">
            {rules.map((rule) => (
              <button type="button" key={rule.id} className={selectedRuleId === rule.id ? "selected" : ""} onClick={() => setSelectedRuleId(rule.id)}>
                <strong>{rule.rule_label}</strong>
                <span>{rule.default_succession_count} succession{rule.default_succession_count === 1 ? "" : "s"} · {rule.default_spacing_days ? `every ${rule.default_spacing_days} days` : "one block"}</span>
                <em>{rule.operational_summary}</em>
                <small>{rule.overlap_policy} overlap · {rule.missed_strategy} missed succession</small>
              </button>
            ))}
          </div>
          {selectedRule ? (
            <form className="atlas-production-rule-create" onSubmit={(event) => { event.preventDefault(); void createFromRule(event.currentTarget); }}>
              <input type="hidden" name="ruleId" value={selectedRule.id} />
              <label>Rule<strong>{selectedRule.rule_label}</strong></label>
              <label>Crop<strong>{selectedRule.crop_profiles ? `${selectedRule.crop_profiles.crop_label}${selectedRule.crop_profiles.variety ? ` · ${selectedRule.crop_profiles.variety}` : ""}` : "Choose a genetic series later"}</strong></label>
              <label>Season year<input name="seasonYear" type="number" min="2026" max="2100" defaultValue={planningYear} /></label>
              <label>First window<input name="firstWindowStart" type="date" required defaultValue={defaultAnchor(selectedRule, planningYear)} /></label>
              <label>Final biological sow date<input name="finalBiologicalSowDate" type="date" defaultValue={selectedRule.final_window_rule === "frost_constrained" ? `${planningYear}-08-22` : ""} /></label>
              <label>Intended uses<input name="intendedUses" placeholder="florist, bouquet, grocery" defaultValue={selectedRule.stable_key.includes("sunflower") ? "florist, grocery, bouquet" : "florist, bouquet"} /></label>
              <button type="submit" disabled={saving || !selectedRule.crop_profile_id || !selectedRule.default_anchor_month_day}>{selectedRule.crop_profile_id && selectedRule.default_anchor_month_day ? "Create crop plan from rule" : "Series/date selection required"}</button>
            </form>
          ) : null}
        </section>
      ) : null}

      {!loading && !orderedPlans.length ? <div className="atlas-production-empty">No production plans yet.</div> : null}

      {orderedPlans.map((plan) => {
        const crop = plan.crop_profiles?.crop_label || plan.plan_label;
        return (
          <section className="atlas-production-plan" key={plan.id}>
            <div className="atlas-production-plan-head">
              <div><span>{plan.season_year} production plan</span><h1>{crop}</h1><p>{plan.notes}</p></div>
              <div className="atlas-production-use-list">{plan.intended_uses.map((use) => <b key={use}>{use}</b>)}</div>
            </div>

            <form className="atlas-production-controls" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void patch({
                action: "regenerate",
                planId: plan.id,
                successionCount: Number(form.get("successionCount")),
                spacingDays: Number(form.get("spacingDays")),
                firstWindowStart: String(form.get("firstWindowStart")),
                windowLengthDays: Number(form.get("windowLengthDays")),
                lateWindowDays: Number(form.get("lateWindowDays")),
                missedStrategy: String(form.get("missedStrategy")),
              });
            }}>
              <label>First window<input name="firstWindowStart" type="date" defaultValue={plan.first_window_start} /></label>
              <label>Successions<input name="successionCount" type="number" min="1" max="60" defaultValue={plan.succession_count} /></label>
              <label>Spacing days<input name="spacingDays" type="number" min="0" max="120" defaultValue={plan.spacing_days} /></label>
              <label>Window days<input name="windowLengthDays" type="number" min="0" max="45" defaultValue={plan.window_length_days} /></label>
              <label>Late days<input name="lateWindowDays" type="number" min="0" max="45" defaultValue={plan.late_window_days} /></label>
              <label>Missed succession<select name="missedStrategy" defaultValue={plan.missed_strategy}><option value="skip">Skip</option><option value="merge">Merge</option><option value="preserve">Preserve</option></select></label>
              <button type="submit" disabled={saving}>Regenerate later windows</button>
            </form>

            <div className="atlas-production-sequence" aria-label={`${crop} succession sequence`}>
              {plan.production_successions.map((succession) => <div className={`atlas-production-node state-${succession.state}`} key={succession.id}><b>S{succession.sequence_number}</b><span>{succession.state === "upcoming" ? operationalStatus(succession, plan) : succession.state}</span></div>)}
            </div>

            <div className="atlas-production-successions">
              {plan.production_successions.map((succession, index) => {
                const next = plan.production_successions[index + 1];
                return (
                  <article className="atlas-production-card" key={succession.id}>
                    <div className="atlas-production-card-title"><div><span>{crop}</span><h2>Succession {succession.sequence_number} of {plan.succession_count}</h2></div><b>{operationalStatus(succession, plan)}</b></div>
                    <dl>
                      <div><dt>Sowing window</dt><dd>{pretty(succession.planned_window_start)}–{pretty(succession.planned_window_end)}</dd></div>
                      <div><dt>Late window</dt><dd>Through {pretty(succession.late_window_end)}</dd></div>
                      <div><dt>Next succession</dt><dd>{next ? `${pretty(next.planned_window_start)}–${pretty(next.planned_window_end)}` : "None"}</dd></div>
                      <div><dt>Frost boundary</dt><dd>{plan.final_biological_sow_date ? `Final biologically viable sowing: ${pretty(plan.final_biological_sow_date)}` : "Not set"}</dd></div>
                    </dl>
                    <div className="atlas-production-projections">
                      <span>Germination <b>{pretty(succession.projected_germination_start)}–{pretty(succession.projected_germination_end)}</b></span>
                      <span>Harvest <b>{pretty(succession.projected_harvest_start)}–{pretty(succession.projected_harvest_end)}</b></span>
                      <span>Clear bed <b>{pretty(succession.projected_clear_date)}</b></span>
                    </div>
                    <div className="atlas-production-actions">
                      {succession.sow_task_id ? <Link href={`/task-focus/${encodeURIComponent(succession.sow_task_id)}?returnTo=${encodeURIComponent("/production")}`}>Open sowing task</Link> : null}
                      <button type="button" disabled={saving || succession.state === "sown"} onClick={() => void patch({ action: "set_succession_state", successionId: succession.id, state: "skipped" })}>Skip</button>
                      <button type="button" disabled={saving || succession.state === "sown"} onClick={() => void patch({ action: "set_succession_state", successionId: succession.id, state: "sown", actualSowDate: todayIso() })}>{succession.state === "sown" ? "Sown" : "Mark sown today"}</button>
                    </div>
                    {succession.crop_cycle_id ? <p className="atlas-production-linked-state">Linked to a live crop cycle.</p> : null}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </main>
  );
}
