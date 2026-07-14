import { atlasSupabase } from "@/lib/atlas/supabase-server";
import ProductionDashboardClient, { type ProductionDashboardPlan } from "./ProductionDashboardClient";
import "./season-dashboard.css";

export const dynamic = "force-dynamic";

async function loadPlans(): Promise<ProductionDashboardPlan[]> {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("production_plans")
    .select("id, season_year, plan_label, succession_count, spacing_days, missed_strategy, protect_final_succession, final_biological_sow_date, intended_uses, crop_profiles(crop_label, variety), production_successions(id, sequence_number, planned_window_start, planned_window_end, projected_harvest_start, projected_harvest_end, projected_clear_date, actual_sow_date, state, sow_task_id, crop_cycle_id, metadata)")
    .eq("active", true)
    .order("season_year", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProductionDashboardPlan[];
}

export default async function ProductionDashboardPage() {
  const plans = await loadPlans();
  return <ProductionDashboardClient initialPlans={plans} />;
}
