"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import "./season-dashboard.css";

type Succession = {
  id: string;
  sequence_number: number;
  planned_window_start: string;
  planned_window_end: string;
  projected_harvest_start: string | null;
  projected_harvest_end: string | null;
  projected_clear_date: string | null;
  actual_sow_date: string | null;
  state: string;
  sow_task_id: string | null;
  crop_cycle_id: string | null;
  metadata?: Record<string, unknown> | null;
};

type Plan = {
  id: string;
  season_year: number;
  plan_label: string;
  succession_count: number;
  spacing_days: number;
  missed_strategy: "skip" | "merge" | "preserve";
  protect_final_succession: boolean;
  final_biological_sow_date: string | null;
  intended_uses: string[];
  crop_profiles: { crop_label?: string; variety?: string | null } | null;
  production_successions: Succession[];
};

function pretty(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000);
}

function cropName(plan: Plan) {
  return plan.crop_profiles?.crop_label || plan.plan_label.replace(/\s+\d{4}\s+production plan$/i, "");
}

function harvestGaps(plan: Plan) {
  const active = plan.production_successions.filter((item) => item.state !== "skipped" && item.projected_harvest_start && item.projected_harvest_end);
  return active.slice(0, -1).map((item, index) => {
    const next = active[index + 1];
    const days = daysBetween(item.projected_harvest_end!, next.projected_harvest_start!);
    return { after: item.sequence_number, before: next.sequence_number, days };
  }).filter((gap) => gap.days > 0);
}

function occupancyLabel(item: Succession) {
  const bed = typeof item.metadata?.bed_label === "string" ? item.metadata.bed_label : null;
  return bed || "Bed not assigned";
}

export default function ProductionDashboardPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const response = await fetch("/api/atlas/production-dashboard", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Production dashboard failed.");
      setPlans(data.plans ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Production dashboard failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const orderedPlans = useMemo(() => plans.map((plan) => ({
    ...plan,
    production_successions: [...(plan.production_successions ?? [])].sort((a, b) => a.sequence_number - b.sequence_number),
  })), [plans]);

  async function patch(body: Record<string, unknown>) {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch("/api/atlas/production-dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-atlas-intent": "production-dashboard-v1" },
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

  return (
    <main className="atlas-season-shell">
      <header className="atlas-season-header">
        <Link href="/production">← Crop plans</Link>
        <div><span>Season dashboard</span><strong>Production sequence, harvest gaps, and bed use</strong></div>
        <em>{saving ? "Saving…" : "Elm Farm"}</em>
      </header>

      {error ? <div className="atlas-season-message error">{error}</div> : null}
      {loading ? <div className="atlas-season-message">Loading season plan…</div> : null}
      {!loading && !orderedPlans.length ? <div className="atlas-season-message">No active crop plans.</div> : null}

      {!loading ? (
        <section className="atlas-season-summary">
          <div><span>Active crop plans</span><strong>{orderedPlans.length}</strong></div>
          <div><span>Planned successions</span><strong>{orderedPlans.reduce((sum, plan) => sum + plan.production_successions.length, 0)}</strong></div>
          <div><span>Unassigned beds</span><strong>{orderedPlans.reduce((sum, plan) => sum + plan.production_successions.filter((item) => !item.metadata?.bed_label).length, 0)}</strong></div>
          <div><span>Projected harvest gaps</span><strong>{orderedPlans.reduce((sum, plan) => sum + harvestGaps(plan).length, 0)}</strong></div>
        </section>
      ) : null}

      {orderedPlans.map((plan) => {
        const gaps = harvestGaps(plan);
        return (
          <section className="atlas-season-plan" key={plan.id}>
            <div className="atlas-season-plan-head">
              <div><span>{plan.season_year} crop lane</span><h1>{cropName(plan)}</h1><p>{plan.spacing_days}-day cadence · {plan.intended_uses.join(" · ") || "mixed use"}</p></div>
              <div className="atlas-season-policy">
                <button type="button" className={plan.missed_strategy === "preserve" ? "selected" : ""} disabled={saving} onClick={() => void patch({ action: "set_plan_policy", planId: plan.id, missedStrategy: "preserve", protectFinalSuccession: false })}>Preserve all successions</button>
                <button type="button" className={plan.protect_final_succession ? "selected" : ""} disabled={saving} onClick={() => void patch({ action: "set_plan_policy", planId: plan.id, missedStrategy: "skip", protectFinalSuccession: true })}>Protect final succession</button>
              </div>
            </div>

            <div className="atlas-season-lane">
              {plan.production_successions.map((item) => (
                <article className={`atlas-season-block state-${item.state}`} key={item.id}>
                  <div><b>S{item.sequence_number}</b><span>{item.state}</span></div>
                  <strong>{pretty(item.planned_window_start)}–{pretty(item.planned_window_end)}</strong>
                  <small>Harvest {pretty(item.projected_harvest_start)}–{pretty(item.projected_harvest_end)}</small>
                  <small>Clear {pretty(item.projected_clear_date)}</small>
                </article>
              ))}
            </div>

            <div className="atlas-season-insights">
              <article>
                <span>Harvest continuity</span>
                <strong>{gaps.length ? `${gaps.length} projected gap${gaps.length === 1 ? "" : "s"}` : "Continuous projected harvest"}</strong>
                {gaps.length ? gaps.map((gap) => <p key={`${gap.after}-${gap.before}`}>{gap.days} days between S{gap.after} and S{gap.before}</p>) : <p>No positive gap between projected harvest windows.</p>}
              </article>
              <article>
                <span>Frost boundary</span>
                <strong>{pretty(plan.final_biological_sow_date)}</strong>
                <p>{plan.protect_final_succession ? "Atlas prioritizes keeping the final viable succession intact." : "Atlas preserves the planned sequence even when earlier windows move."}</p>
              </article>
            </div>

            <div className="atlas-season-table">
              <div className="atlas-season-table-head"><span>Succession</span><span>Move window</span><span>Bed occupancy</span><span>Harvest</span><span>Task</span></div>
              {plan.production_successions.map((item) => (
                <div className="atlas-season-table-row" key={item.id}>
                  <span><b>S{item.sequence_number}</b><small>{item.state}</small></span>
                  <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void patch({ action: "move_succession", successionId: item.id, plannedWindowStart: String(form.get("plannedWindowStart")) }); }}>
                    <input name="plannedWindowStart" type="date" defaultValue={item.planned_window_start} disabled={Boolean(item.actual_sow_date) || saving} />
                    <button type="submit" disabled={Boolean(item.actual_sow_date) || saving}>Move</button>
                  </form>
                  <span><b>{occupancyLabel(item)}</b><small>{pretty(item.planned_window_start)}–{pretty(item.projected_clear_date)}</small></span>
                  <span><b>{pretty(item.projected_harvest_start)}–{pretty(item.projected_harvest_end)}</b><small>{item.crop_cycle_id ? "Live crop cycle" : "Projected"}</small></span>
                  <span>{item.sow_task_id ? <Link href={`/task-focus/${encodeURIComponent(item.sow_task_id)}?returnTo=${encodeURIComponent("/production/dashboard")}`}>Open task</Link> : "No task"}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
