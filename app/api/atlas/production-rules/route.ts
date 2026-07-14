import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

async function loadRules() {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("production_rule_templates")
    .select("id, stable_key, rule_label, crop_profile_id, crop_match, plan_kind, default_anchor_month_day, default_succession_count, default_spacing_days, default_window_length_days, default_late_window_days, missed_strategy, overlap_policy, protect_final_succession, final_window_rule, series_behavior, operational_summary, rule_config, crop_profiles(id, stable_key, crop_label, variety, default_planting_method)")
    .eq("active", true)
    .order("rule_label");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, rules: await loadRules() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Production rules failed." }, { status: 500 });
  }
}

type CreateBody = {
  ruleId?: unknown;
  cropProfileId?: unknown;
  seasonYear?: unknown;
  firstWindowStart?: unknown;
  finalBiologicalSowDate?: unknown;
  intendedUses?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const requestOrigin = request.headers.get("origin");
    if (!requestOrigin || requestOrigin !== request.nextUrl.origin || request.headers.get("x-atlas-intent") !== "production-rule-v1") {
      return NextResponse.json({ ok: false, error: "Production rule changes require a same-origin Atlas request." }, { status: 403 });
    }

    const body = await request.json() as CreateBody;
    const ruleId = clean(body.ruleId);
    const requestedProfileId = clean(body.cropProfileId);
    const firstWindowStart = clean(body.firstWindowStart);
    const finalBiologicalSowDate = clean(body.finalBiologicalSowDate) || null;
    const seasonYear = typeof body.seasonYear === "number" && Number.isInteger(body.seasonYear) ? body.seasonYear : 0;
    const intendedUses = Array.isArray(body.intendedUses) ? body.intendedUses.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

    if (!uuidPattern.test(ruleId) || seasonYear < 2026 || seasonYear > 2100 || !validDate(firstWindowStart) || (finalBiologicalSowDate && !validDate(finalBiologicalSowDate))) {
      return NextResponse.json({ ok: false, error: "Production rule plan settings are invalid." }, { status: 400 });
    }

    const { data: rawRule, error: ruleError } = await atlasSupabase
      .schema("atlas")
      .from("production_rule_templates")
      .select("id, stable_key, rule_label, crop_profile_id, plan_kind, default_succession_count, default_spacing_days, default_window_length_days, default_late_window_days, missed_strategy, protect_final_succession, operational_summary, rule_config")
      .eq("id", ruleId)
      .eq("active", true)
      .single();
    if (ruleError) throw new Error(ruleError.message);

    const cropProfileId = requestedProfileId || clean(rawRule.crop_profile_id);
    if (!uuidPattern.test(cropProfileId)) return NextResponse.json({ ok: false, error: "This rule requires a crop profile." }, { status: 400 });

    const { data: profile, error: profileError } = await atlasSupabase
      .schema("atlas")
      .from("crop_profiles")
      .select("id, stable_key, crop_label, variety, days_to_germination_min, days_to_germination_max, days_to_harvest_watch_min, days_to_harvest_watch_max, metadata")
      .eq("id", cropProfileId)
      .single();
    if (profileError) throw new Error(profileError.message);

    const { data: farm, error: farmError } = await atlasSupabase.schema("atlas").from("farms").select("id").eq("stable_key", "elm_farm").single();
    if (farmError) throw new Error(farmError.message);

    const stableKey = `${profile.stable_key}_${seasonYear}_production`;
    const planPayload = {
      farm_id: farm.id,
      crop_profile_id: profile.id,
      rule_template_id: rawRule.id,
      stable_key: stableKey,
      season_year: seasonYear,
      plan_label: `${profile.crop_label} ${seasonYear} production plan`,
      plan_kind: rawRule.plan_kind,
      first_window_start: firstWindowStart,
      succession_count: rawRule.default_succession_count,
      spacing_days: rawRule.default_spacing_days,
      window_length_days: rawRule.default_window_length_days,
      late_window_days: rawRule.default_late_window_days,
      skip_threshold_days: 0,
      missed_strategy: rawRule.missed_strategy,
      intended_uses: intendedUses,
      protect_final_succession: rawRule.protect_final_succession,
      final_biological_sow_date: finalBiologicalSowDate,
      active: true,
      notes: rawRule.operational_summary,
      metadata: { production_rule_key: rawRule.stable_key, rule_config: rawRule.rule_config, created_from: "production_rule_library" },
      updated_at: new Date().toISOString(),
    };

    const { data: plan, error: planError } = await atlasSupabase
      .schema("atlas")
      .from("production_plans")
      .upsert(planPayload, { onConflict: "farm_id,stable_key,season_year" })
      .select("id")
      .single();
    if (planError) throw new Error(planError.message);

    const clearOffset = typeof rawRule.rule_config?.clear_bed_offset_days === "number" ? rawRule.rule_config.clear_bed_offset_days : 85;
    const rows = Array.from({ length: rawRule.default_succession_count }, (_, index) => {
      const sequence = index + 1;
      const start = addDays(firstWindowStart, index * rawRule.default_spacing_days);
      const end = addDays(start, rawRule.default_window_length_days);
      const lateEnd = addDays(end, rawRule.default_late_window_days);
      const nextStart = addDays(firstWindowStart, sequence * rawRule.default_spacing_days);
      return {
        production_plan_id: plan.id,
        sequence_number: sequence,
        planned_window_start: start,
        planned_window_end: end,
        late_window_end: lateEnd,
        skip_after_date: rawRule.missed_strategy === "skip" && sequence < rawRule.default_succession_count ? nextStart : lateEnd,
        projected_germination_start: addDays(start, profile.days_to_germination_min ?? 0),
        projected_germination_end: addDays(start, profile.days_to_germination_max ?? 0),
        projected_harvest_start: profile.days_to_harvest_watch_min == null ? null : addDays(start, profile.days_to_harvest_watch_min),
        projected_harvest_end: profile.days_to_harvest_watch_max == null ? null : addDays(start, profile.days_to_harvest_watch_max),
        projected_clear_date: addDays(start, clearOffset),
        state: "upcoming",
        metadata: { generated_from: "production_rule", production_rule_key: rawRule.stable_key, overlap_policy: rawRule.rule_config?.overlap_policy ?? null },
      };
    });

    const { data: successions, error: successionError } = await atlasSupabase
      .schema("atlas")
      .from("production_successions")
      .upsert(rows, { onConflict: "production_plan_id,sequence_number" })
      .select("id, sequence_number, planned_window_start, planned_window_end");
    if (successionError) throw new Error(successionError.message);

    for (const succession of successions ?? []) {
      const title = `Sow ${profile.crop_label} · Succession ${succession.sequence_number} of ${rawRule.default_succession_count}`;
      const taskPayload = {
        farm_id: farm.id,
        title,
        task_type: "succession_sowing",
        status: "open",
        priority: "high",
        due_date: succession.planned_window_start,
        generated_from: "production_succession",
        generated_from_id: succession.id,
        action_key: "sow",
        work_class: "Seed Starting / Succession",
        task_series_key: `${stableKey}:sowing`,
        engine_instance_key: `production-succession:${succession.id}`,
        unlock_text: rawRule.operational_summary,
        note: `Operating sowing window: ${succession.planned_window_start} through ${succession.planned_window_end}.`,
        metadata: {
          production_plan_id: plan.id,
          production_succession_id: succession.id,
          production_rule_key: rawRule.stable_key,
          succession_number: succession.sequence_number,
          succession_count: rawRule.default_succession_count,
          crop_profile_id: profile.id,
          crop_label: profile.crop_label,
          variety: profile.variety,
          sowing_window_start: succession.planned_window_start,
          sowing_window_end: succession.planned_window_end,
          intended_uses: intendedUses,
          work_route: "sow",
          work_rhythm: "Seed Sowing",
          display_action: "Sow",
          display_subject: `${profile.crop_label} · Succession ${succession.sequence_number} of ${rawRule.default_succession_count}`,
          detail_heading: "Sowing window",
          detail_lines: [rawRule.operational_summary, `${succession.planned_window_start} through ${succession.planned_window_end}`],
        },
        updated_at: new Date().toISOString(),
      };
      const { data: task, error: taskError } = await atlasSupabase.schema("atlas").from("tasks").upsert(taskPayload, { onConflict: "engine_instance_key" }).select("id").single();
      if (taskError) throw new Error(taskError.message);
      const { error: linkError } = await atlasSupabase.schema("atlas").from("production_successions").update({ sow_task_id: task.id }).eq("id", succession.id);
      if (linkError) throw new Error(linkError.message);
    }

    return NextResponse.json({ ok: true, planId: plan.id, rules: await loadRules() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Production rule plan creation failed." }, { status: 500 });
  }
}
