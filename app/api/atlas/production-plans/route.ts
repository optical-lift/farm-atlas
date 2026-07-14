import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function loadPlans() {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("production_plans")
    .select("id, stable_key, season_year, plan_label, plan_kind, first_window_start, succession_count, spacing_days, window_length_days, late_window_days, skip_threshold_days, missed_strategy, intended_uses, protect_final_succession, final_biological_sow_date, active, notes, metadata, crop_profiles(crop_label, variety, days_to_germination_min, days_to_germination_max, days_to_harvest_watch_min, days_to_harvest_watch_max), production_successions(id, sequence_number, planned_window_start, planned_window_end, late_window_end, skip_after_date, actual_sow_date, projected_germination_start, projected_germination_end, projected_harvest_start, projected_harvest_end, projected_clear_date, state, crop_cycle_id, sow_task_id, skip_reason, metadata)")
    .eq("active", true)
    .order("season_year", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, plans: await loadPlans() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Production plans failed." }, { status: 500 });
  }
}

type PatchBody = {
  action?: unknown;
  planId?: unknown;
  successionId?: unknown;
  successionCount?: unknown;
  spacingDays?: unknown;
  firstWindowStart?: unknown;
  windowLengthDays?: unknown;
  lateWindowDays?: unknown;
  missedStrategy?: unknown;
  state?: unknown;
  actualSowDate?: unknown;
};

export async function PATCH(request: NextRequest) {
  try {
    const requestOrigin = request.headers.get("origin");
    if (!requestOrigin || requestOrigin !== request.nextUrl.origin || request.headers.get("x-atlas-intent") !== "production-plan-v1") {
      return NextResponse.json({ ok: false, error: "Production changes require a same-origin Atlas request." }, { status: 403 });
    }

    const body = await request.json() as PatchBody;
    const action = clean(body.action);
    const planId = clean(body.planId);
    const successionId = clean(body.successionId);

    if (action === "set_succession_state") {
      const state = clean(body.state);
      const allowed = new Set(["upcoming", "in_window", "late", "skipped", "sown", "germinated", "harvesting", "cleared"]);
      if (!uuidPattern.test(successionId) || !allowed.has(state)) return NextResponse.json({ ok: false, error: "Invalid succession update." }, { status: 400 });
      const actualSowDate = clean(body.actualSowDate) || null;
      if (actualSowDate && !validDate(actualSowDate)) return NextResponse.json({ ok: false, error: "Sow date must use YYYY-MM-DD." }, { status: 400 });
      const { error } = await atlasSupabase.schema("atlas").from("production_successions").update({ state, actual_sow_date: state === "sown" ? actualSowDate : undefined, updated_at: new Date().toISOString() }).eq("id", successionId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, plans: await loadPlans() });
    }

    if (action !== "regenerate" || !uuidPattern.test(planId)) return NextResponse.json({ ok: false, error: "Invalid production-plan action." }, { status: 400 });

    const successionCount = integer(body.successionCount, 0);
    const spacingDays = integer(body.spacingDays, -1);
    const windowLengthDays = integer(body.windowLengthDays, -1);
    const lateWindowDays = integer(body.lateWindowDays, -1);
    const firstWindowStart = clean(body.firstWindowStart);
    const missedStrategy = clean(body.missedStrategy);
    if (successionCount < 1 || successionCount > 60 || spacingDays < 0 || spacingDays > 120 || windowLengthDays < 0 || windowLengthDays > 45 || lateWindowDays < 0 || lateWindowDays > 45 || !validDate(firstWindowStart) || !["skip", "merge", "preserve"].includes(missedStrategy)) {
      return NextResponse.json({ ok: false, error: "Production-plan settings are invalid." }, { status: 400 });
    }

    const { data: plan, error: planError } = await atlasSupabase.schema("atlas").from("production_plans").update({ succession_count: successionCount, spacing_days: spacingDays, first_window_start: firstWindowStart, window_length_days: windowLengthDays, late_window_days: lateWindowDays, missed_strategy: missedStrategy, updated_at: new Date().toISOString() }).eq("id", planId).select("id, crop_profile_id").single();
    if (planError) throw new Error(planError.message);

    const { data: profile, error: profileError } = await atlasSupabase.schema("atlas").from("crop_profiles").select("days_to_germination_min, days_to_germination_max, days_to_harvest_watch_min, days_to_harvest_watch_max").eq("id", plan.crop_profile_id).single();
    if (profileError) throw new Error(profileError.message);

    const { data: existing, error: existingError } = await atlasSupabase.schema("atlas").from("production_successions").select("id, sequence_number, state, actual_sow_date").eq("production_plan_id", planId);
    if (existingError) throw new Error(existingError.message);
    const existingBySequence = new Map((existing ?? []).map((row) => [row.sequence_number, row]));

    const rows = Array.from({ length: successionCount }, (_, index) => {
      const sequence = index + 1;
      const start = addDays(firstWindowStart, index * spacingDays);
      const end = addDays(start, windowLengthDays);
      const lateEnd = addDays(end, lateWindowDays);
      const prior = existingBySequence.get(sequence);
      return {
        production_plan_id: planId,
        sequence_number: sequence,
        planned_window_start: start,
        planned_window_end: end,
        late_window_end: lateEnd,
        skip_after_date: missedStrategy === "skip" && sequence < successionCount ? addDays(firstWindowStart, sequence * spacingDays) : lateEnd,
        projected_germination_start: addDays(start, profile.days_to_germination_min ?? 0),
        projected_germination_end: addDays(start, profile.days_to_germination_max ?? 0),
        projected_harvest_start: addDays(start, profile.days_to_harvest_watch_min ?? 0),
        projected_harvest_end: addDays(start, profile.days_to_harvest_watch_max ?? 0),
        projected_clear_date: addDays(start, 85),
        state: prior?.state ?? "upcoming",
        actual_sow_date: prior?.actual_sow_date ?? null,
        metadata: { generated_from: "production_plan", window_version: 1 },
      };
    });

    const { error: upsertError } = await atlasSupabase.schema("atlas").from("production_successions").upsert(rows, { onConflict: "production_plan_id,sequence_number" });
    if (upsertError) throw new Error(upsertError.message);
    const { error: trimError } = await atlasSupabase.schema("atlas").from("production_successions").delete().eq("production_plan_id", planId).gt("sequence_number", successionCount).is("actual_sow_date", null);
    if (trimError) throw new Error(trimError.message);

    return NextResponse.json({ ok: true, plans: await loadPlans() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Production update failed." }, { status: 500 });
  }
}
