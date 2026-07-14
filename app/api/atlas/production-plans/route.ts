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

type PlanTaskContext = {
  id: string;
  farm_id: string;
  stable_key: string;
  plan_label: string;
  succession_count: number;
  intended_uses: string[] | null;
  crop_profile_id: string;
  crop_profiles: { crop_label?: string | null; variety?: string | null } | null;
};

type SuccessionTaskContext = {
  id: string;
  sequence_number: number;
  planned_window_start: string;
  planned_window_end: string;
  state: string;
  sow_task_id: string | null;
};

async function syncSowingTasks(planId: string) {
  const { data: rawPlan, error: planError } = await atlasSupabase
    .schema("atlas")
    .from("production_plans")
    .select("id, farm_id, stable_key, plan_label, succession_count, intended_uses, crop_profile_id, crop_profiles(crop_label, variety)")
    .eq("id", planId)
    .single();
  if (planError) throw new Error(planError.message);
  const plan = rawPlan as unknown as PlanTaskContext;

  const { data: rawSuccessions, error: successionError } = await atlasSupabase
    .schema("atlas")
    .from("production_successions")
    .select("id, sequence_number, planned_window_start, planned_window_end, state, sow_task_id")
    .eq("production_plan_id", planId)
    .order("sequence_number");
  if (successionError) throw new Error(successionError.message);
  const successions = (rawSuccessions ?? []) as SuccessionTaskContext[];
  const cropLabel = clean(plan.crop_profiles?.crop_label) || plan.plan_label.replace(/\s+\d{4}\s+production plan$/i, "");

  for (const succession of successions) {
    const title = `Sow ${cropLabel} · Succession ${succession.sequence_number} of ${plan.succession_count}`;
    const taskPayload = {
      farm_id: plan.farm_id,
      title,
      task_type: "succession_sowing",
      status: succession.state === "skipped" ? "skipped" : succession.state === "sown" ? "done" : "open",
      priority: "high",
      due_date: succession.planned_window_start,
      generated_from: "production_succession",
      generated_from_id: succession.id,
      action_key: "sow",
      work_class: "Seed Starting / Succession",
      task_series_key: `${plan.stable_key}:sowing`,
      engine_instance_key: `production-succession:${succession.id}`,
      unlock_text: `Protect the ${cropLabel} harvest sequence without merging this succession into the next one.`,
      note: `Operating sowing window: ${succession.planned_window_start} through ${succession.planned_window_end}.`,
      metadata: {
        production_plan_id: plan.id,
        production_succession_id: succession.id,
        succession_number: succession.sequence_number,
        succession_count: plan.succession_count,
        crop_profile_id: plan.crop_profile_id,
        crop_label: cropLabel,
        variety: clean(plan.crop_profiles?.variety) || null,
        sowing_window_start: succession.planned_window_start,
        sowing_window_end: succession.planned_window_end,
        intended_uses: plan.intended_uses ?? [],
        work_route: "sow",
        work_rhythm: "Seed Sowing",
        display_action: "Sow",
        display_subject: `${cropLabel} · Succession ${succession.sequence_number} of ${plan.succession_count}`,
        detail_heading: "Sowing window",
        detail_lines: [`${succession.planned_window_start} through ${succession.planned_window_end}`, "This is a production succession, not a floating deadline."],
      },
      updated_at: new Date().toISOString(),
    };

    let taskId = succession.sow_task_id;
    if (taskId) {
      const { error } = await atlasSupabase.schema("atlas").from("tasks").update(taskPayload).eq("id", taskId);
      if (error) throw new Error(error.message);
    } else {
      const { data: existingTask, error: existingError } = await atlasSupabase
        .schema("atlas")
        .from("tasks")
        .select("id")
        .eq("generated_from", "production_succession")
        .eq("generated_from_id", succession.id)
        .limit(1)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      taskId = clean(existingTask?.id);
      if (taskId) {
        const { error } = await atlasSupabase.schema("atlas").from("tasks").update(taskPayload).eq("id", taskId);
        if (error) throw new Error(error.message);
      } else {
        const { data: createdTask, error } = await atlasSupabase.schema("atlas").from("tasks").insert(taskPayload).select("id").single();
        if (error) throw new Error(error.message);
        taskId = createdTask.id;
      }
      const { error: linkError } = await atlasSupabase.schema("atlas").from("production_successions").update({ sow_task_id: taskId }).eq("id", succession.id);
      if (linkError) throw new Error(linkError.message);
    }
  }
}

async function markSuccessionSown(successionId: string, actualSowDate: string) {
  const { data: raw, error } = await atlasSupabase
    .schema("atlas")
    .from("production_successions")
    .select("id, sequence_number, sow_task_id, production_plan_id, production_plans(id, farm_id, stable_key, plan_label, crop_profile_id, metadata, crop_profiles(crop_label, variety, days_to_germination_min, days_to_germination_max, days_to_harvest_watch_min, days_to_harvest_watch_max))")
    .eq("id", successionId)
    .single();
  if (error) throw new Error(error.message);

  const row = raw as unknown as {
    id: string;
    sequence_number: number;
    sow_task_id: string | null;
    production_plan_id: string;
    production_plans: {
      farm_id: string;
      stable_key: string;
      plan_label: string;
      crop_profile_id: string;
      metadata: Record<string, unknown> | null;
      crop_profiles: {
        crop_label?: string | null;
        variety?: string | null;
        days_to_germination_min?: number | null;
        days_to_germination_max?: number | null;
        days_to_harvest_watch_min?: number | null;
        days_to_harvest_watch_max?: number | null;
      } | null;
    };
  };
  const plan = row.production_plans;
  const profile = plan.crop_profiles;
  const cropLabel = clean(profile?.crop_label) || plan.plan_label;
  const cycleKey = `${plan.stable_key}:s${row.sequence_number}`;
  const germinationStart = addDays(actualSowDate, profile?.days_to_germination_min ?? 0);
  const germinationEnd = addDays(actualSowDate, profile?.days_to_germination_max ?? 0);
  const harvestStart = addDays(actualSowDate, profile?.days_to_harvest_watch_min ?? 0);
  const harvestEnd = addDays(actualSowDate, profile?.days_to_harvest_watch_max ?? 0);
  const clearDate = addDays(actualSowDate, 85);

  const { data: existingCycle, error: cycleLookupError } = await atlasSupabase
    .schema("atlas")
    .from("crop_cycles")
    .select("id, planting_claim_id")
    .eq("farm_id", plan.farm_id)
    .eq("crop_cycle_key", cycleKey)
    .limit(1)
    .maybeSingle();
  if (cycleLookupError) throw new Error(cycleLookupError.message);

  let plantingClaimId = clean(existingCycle?.planting_claim_id);
  if (!plantingClaimId) {
    const { data: claim, error: claimError } = await atlasSupabase.schema("atlas").from("planting_claims").insert({
      farm_id: plan.farm_id,
      crop_profile_id: plan.crop_profile_id,
      crop_label: cropLabel,
      variety: clean(profile?.variety) || null,
      planted_date: actualSowDate,
      planting_method: "direct_sow",
      status: "planted",
      confidence: "high",
      expected_germination_start: germinationStart,
      expected_germination_end: germinationEnd,
      expected_harvest_watch_start: harvestStart,
      expected_harvest_watch_end: harvestEnd,
      expected_clear_date: clearDate,
      note: `${plan.plan_label} · Succession ${row.sequence_number}`,
      metadata: { production_plan_id: row.production_plan_id, production_succession_id: row.id, source: "production_calendar" },
    }).select("id").single();
    if (claimError) throw new Error(claimError.message);
    plantingClaimId = claim.id;
  }

  const cyclePayload = {
    farm_id: plan.farm_id,
    planting_claim_id: plantingClaimId,
    crop_profile_id: plan.crop_profile_id,
    crop_cycle_key: cycleKey,
    crop_label: cropLabel,
    variety: clean(profile?.variety) || null,
    cycle_state: "sown",
    lifecycle_status: "active",
    sown_date: actualSowDate,
    planted_date: actualSowDate,
    expected_germination_start: germinationStart,
    expected_germination_end: germinationEnd,
    expected_harvest_watch_start: harvestStart,
    expected_harvest_watch_end: harvestEnd,
    expected_clear_date: clearDate,
    source_task_id: row.sow_task_id,
    note: `${plan.plan_label} · Succession ${row.sequence_number}`,
    metadata: { production_plan_id: row.production_plan_id, production_succession_id: row.id, source: "production_calendar" },
    updated_at: new Date().toISOString(),
  };
  const { data: cycle, error: cycleError } = await atlasSupabase.schema("atlas").from("crop_cycles").upsert(cyclePayload, { onConflict: "farm_id,crop_cycle_key" }).select("id").single();
  if (cycleError) throw new Error(cycleError.message);

  const { error: successionError } = await atlasSupabase.schema("atlas").from("production_successions").update({
    state: "sown",
    actual_sow_date: actualSowDate,
    crop_cycle_id: cycle.id,
    projected_germination_start: germinationStart,
    projected_germination_end: germinationEnd,
    projected_harvest_start: harvestStart,
    projected_harvest_end: harvestEnd,
    projected_clear_date: clearDate,
    updated_at: new Date().toISOString(),
  }).eq("id", successionId);
  if (successionError) throw new Error(successionError.message);

  if (row.sow_task_id) {
    const { error: taskError } = await atlasSupabase.schema("atlas").from("tasks").update({ status: "done", completed_at: new Date().toISOString(), completed_by: "production_calendar", updated_at: new Date().toISOString() }).eq("id", row.sow_task_id);
    if (taskError) throw new Error(taskError.message);
  }
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

      if (state === "sown") {
        if (!actualSowDate) return NextResponse.json({ ok: false, error: "A sow date is required." }, { status: 400 });
        await markSuccessionSown(successionId, actualSowDate);
      } else {
        const { data: succession, error: lookupError } = await atlasSupabase.schema("atlas").from("production_successions").select("sow_task_id").eq("id", successionId).single();
        if (lookupError) throw new Error(lookupError.message);
        const { error } = await atlasSupabase.schema("atlas").from("production_successions").update({ state, skip_reason: state === "skipped" ? "Skipped from production calendar" : null, updated_at: new Date().toISOString() }).eq("id", successionId);
        if (error) throw new Error(error.message);
        if (state === "skipped" && succession.sow_task_id) {
          const { error: taskError } = await atlasSupabase.schema("atlas").from("tasks").update({ status: "skipped", updated_at: new Date().toISOString() }).eq("id", succession.sow_task_id);
          if (taskError) throw new Error(taskError.message);
        }
      }
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
        metadata: { generated_from: "production_plan", window_version: 2 },
      };
    });

    const { error: upsertError } = await atlasSupabase.schema("atlas").from("production_successions").upsert(rows, { onConflict: "production_plan_id,sequence_number" });
    if (upsertError) throw new Error(upsertError.message);

    const removed = (existing ?? []).filter((row) => row.sequence_number > successionCount && !row.actual_sow_date);
    if (removed.length) {
      const removedIds = removed.map((row) => row.id);
      const { error: archiveError } = await atlasSupabase.schema("atlas").from("tasks").update({ status: "archived", updated_at: new Date().toISOString() }).eq("generated_from", "production_succession").in("generated_from_id", removedIds);
      if (archiveError) throw new Error(archiveError.message);
    }
    const { error: trimError } = await atlasSupabase.schema("atlas").from("production_successions").delete().eq("production_plan_id", planId).gt("sequence_number", successionCount).is("actual_sow_date", null);
    if (trimError) throw new Error(trimError.message);

    await syncSowingTasks(planId);
    return NextResponse.json({ ok: true, plans: await loadPlans() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Production update failed." }, { status: 500 });
  }
}
