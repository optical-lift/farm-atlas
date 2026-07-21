import { createAtlasServerClient } from "@/lib/supabase/server";

type AtlasServerClient = Awaited<ReturnType<typeof createAtlasServerClient>>;

export async function loadProductionPlans(supabase: AtlasServerClient) {
  const { data, error } = await supabase
    .from("production_plans")
    .select("id, stable_key, season_year, plan_label, plan_kind, first_window_start, succession_count, spacing_days, window_length_days, late_window_days, missed_strategy, intended_uses, protect_final_succession, final_biological_sow_date, notes, metadata, crop_profiles(crop_label, variety), production_successions(id, sequence_number, planned_window_start, planned_window_end, late_window_end, skip_after_date, actual_sow_date, projected_germination_start, projected_germination_end, projected_harvest_start, projected_harvest_end, projected_clear_date, state, crop_cycle_id, sow_task_id, metadata)")
    .eq("active", true)
    .order("season_year", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadProductionRules(supabase: AtlasServerClient) {
  const { data, error } = await supabase
    .from("production_rule_templates")
    .select("id, stable_key, rule_label, crop_profile_id, crop_match, plan_kind, default_anchor_month_day, default_succession_count, default_spacing_days, default_window_length_days, default_late_window_days, missed_strategy, overlap_policy, protect_final_succession, final_window_rule, series_behavior, operational_summary, rule_config, metadata, crop_profiles(id, stable_key, crop_label, variety, default_planting_method)")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}
