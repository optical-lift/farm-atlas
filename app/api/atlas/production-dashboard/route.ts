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

function shiftDate(value: string | null, deltaDays: number) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

async function loadPlans() {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("production_plans")
    .select("id, stable_key, season_year, plan_label, plan_kind, first_window_start, succession_count, spacing_days, window_length_days, late_window_days, missed_strategy, intended_uses, protect_final_succession, final_biological_sow_date, notes, metadata, crop_profiles(crop_label, variety), production_successions(id, sequence_number, planned_window_start, planned_window_end, late_window_end, skip_after_date, actual_sow_date, projected_germination_start, projected_germination_end, projected_harvest_start, projected_harvest_end, projected_clear_date, state, crop_cycle_id, sow_task_id, metadata)")
    .eq("active", true)
    .order("season_year", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

type Body = {
  action?: unknown;
  planId?: unknown;
  successionId?: unknown;
  plannedWindowStart?: unknown;
  protectFinalSuccession?: unknown;
  missedStrategy?: unknown;
};

export async function GET() {
  try {
    return NextResponse.json({ ok: true, plans: await loadPlans() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Dashboard failed." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const requestOrigin = request.headers.get("origin");
    if (!requestOrigin || requestOrigin !== request.nextUrl.origin || request.headers.get("x-atlas-intent") !== "production-dashboard-v1") {
      return NextResponse.json({ ok: false, error: "Production changes require a same-origin Atlas request." }, { status: 403 });
    }

    const body = await request.json() as Body;
    const action = clean(body.action);
    const planId = clean(body.planId);
    const successionId = clean(body.successionId);

    if (action === "set_plan_policy") {
      const missedStrategy = clean(body.missedStrategy);
      if (!uuidPattern.test(planId) || !["skip", "merge", "preserve"].includes(missedStrategy) || typeof body.protectFinalSuccession !== "boolean") {
        return NextResponse.json({ ok: false, error: "Invalid production policy." }, { status: 400 });
      }
      const { error } = await atlasSupabase.schema("atlas").from("production_plans").update({
        missed_strategy: missedStrategy,
        protect_final_succession: body.protectFinalSuccession,
        updated_at: new Date().toISOString(),
      }).eq("id", planId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, plans: await loadPlans() });
    }

    if (action === "move_succession") {
      const targetStart = clean(body.plannedWindowStart);
      if (!uuidPattern.test(successionId) || !validDate(targetStart)) return NextResponse.json({ ok: false, error: "Invalid succession move." }, { status: 400 });

      const { data: succession, error: lookupError } = await atlasSupabase.schema("atlas").from("production_successions")
        .select("id, production_plan_id, planned_window_start, planned_window_end, late_window_end, skip_after_date, projected_germination_start, projected_germination_end, projected_harvest_start, projected_harvest_end, projected_clear_date, actual_sow_date, sow_task_id")
        .eq("id", successionId).single();
      if (lookupError) throw new Error(lookupError.message);
      if (succession.actual_sow_date) return NextResponse.json({ ok: false, error: "A sown succession cannot be moved as a plan window." }, { status: 409 });

      const oldStart = new Date(`${succession.planned_window_start}T12:00:00`).getTime();
      const newStart = new Date(`${targetStart}T12:00:00`).getTime();
      const deltaDays = Math.round((newStart - oldStart) / 86400000);
      const payload = {
        planned_window_start: targetStart,
        planned_window_end: shiftDate(succession.planned_window_end, deltaDays),
        late_window_end: shiftDate(succession.late_window_end, deltaDays),
        skip_after_date: shiftDate(succession.skip_after_date, deltaDays),
        projected_germination_start: shiftDate(succession.projected_germination_start, deltaDays),
        projected_germination_end: shiftDate(succession.projected_germination_end, deltaDays),
        projected_harvest_start: shiftDate(succession.projected_harvest_start, deltaDays),
        projected_harvest_end: shiftDate(succession.projected_harvest_end, deltaDays),
        projected_clear_date: shiftDate(succession.projected_clear_date, deltaDays),
        updated_at: new Date().toISOString(),
      };
      const { error: updateError } = await atlasSupabase.schema("atlas").from("production_successions").update(payload).eq("id", successionId);
      if (updateError) throw new Error(updateError.message);

      if (succession.sow_task_id) {
        const { data: task } = await atlasSupabase.schema("atlas").from("tasks").select("metadata").eq("id", succession.sow_task_id).single();
        const metadata = task?.metadata && typeof task.metadata === "object" ? task.metadata as Record<string, unknown> : {};
        const { error: taskError } = await atlasSupabase.schema("atlas").from("tasks").update({
          due_date: targetStart,
          note: `Operating sowing window: ${targetStart} through ${payload.planned_window_end}.`,
          metadata: { ...metadata, sowing_window_start: targetStart, sowing_window_end: payload.planned_window_end },
          updated_at: new Date().toISOString(),
        }).eq("id", succession.sow_task_id);
        if (taskError) throw new Error(taskError.message);
      }
      return NextResponse.json({ ok: true, plans: await loadPlans() });
    }

    return NextResponse.json({ ok: false, error: "Unsupported dashboard action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Dashboard update failed." }, { status: 500 });
  }
}
