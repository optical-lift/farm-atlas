import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type GerminationAction = "not_yet" | "germinated";

type TaskRow = {
  id: string;
  farm_id: string;
  zone_id: string | null;
  title: string;
  task_type: string;
  status: string;
  due_date: string | null;
  priority: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
};

type Body = {
  taskId?: string;
  taskTitle?: string;
  action?: GerminationAction;
  spacingInches?: number | string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function positiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) return Number(value);
  return null;
}

function positiveSpacing(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number <= 0 || number > 120) return null;
  return Math.round(number * 100) / 100;
}

async function getTask(body: Body) {
  let query = atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id, farm_id, zone_id, title, task_type, status, due_date, priority, note, metadata");

  if (clean(body.taskId)) query = query.eq("id", clean(body.taskId));
  else if (clean(body.taskTitle)) query = query.ilike("title", clean(body.taskTitle));
  else throw new Error("Task id or title is required.");

  const { data, error } = await query.in("status", ["open", "blocked"]).order("due_date", { ascending: true }).limit(1);
  if (error) throw new Error(error.message);
  if (!data?.[0]) throw new Error("Germination check task was not found.");
  return data[0] as TaskRow;
}

async function getObject(taskId: string) {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("task_objects")
    .select("object_id, growing_objects!inner(label, stable_key)")
    .eq("task_id", taskId)
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0] as unknown as { object_id?: string; growing_objects?: { label?: string; stable_key?: string } } | undefined;
  return {
    objectId: row?.object_id ?? null,
    objectLabel: row?.growing_objects?.label ?? "Unassigned growing area",
    objectKey: row?.growing_objects?.stable_key ?? null,
  };
}

async function getProfile(task: TaskRow) {
  const metadata = task.metadata ?? {};
  const profileId = clean(metadata.crop_profile_id);
  const profileKey = clean(metadata.crop_profile_stable_key);
  let query = atlasSupabase
    .schema("atlas")
    .from("crop_profiles")
    .select("id, stable_key, crop_label, variety, days_to_germination_min, days_to_germination_max, days_to_harvest_watch_min, days_to_harvest_watch_max");
  if (profileId) query = query.eq("id", profileId);
  else if (profileKey) query = query.eq("stable_key", profileKey);
  else throw new Error("This germination task is missing its seed profile.");
  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  if (!data?.[0]) throw new Error("Seed profile was not found.");
  return data[0];
}

async function linkObject(taskId: string, objectId: string | null) {
  if (!objectId) return;
  const { error } = await atlasSupabase.schema("atlas").from("task_objects").insert({ task_id: taskId, object_id: objectId, role: "primary_location" });
  if (error && !error.message.toLowerCase().includes("duplicate")) throw new Error(error.message);
}

async function createHarvestTask(task: TaskRow, objectId: string | null, objectLabel: string, profile: Awaited<ReturnType<typeof getProfile>>, sourceSownDate: string) {
  const today = todayIso();
  const profileLabel = profile.variety || profile.crop_label;
  const harvestOffset = positiveInteger(profile.days_to_harvest_watch_min);
  const dueDate = harvestOffset ? [addDaysIso(sourceSownDate, harvestOffset), today].sort().reverse()[0] : today;
  const generatedFrom = "germination_harvest_watch";

  const { data: existing, error: existingError } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id")
    .eq("generated_from", generatedFrom)
    .eq("generated_from_id", task.id)
    .neq("status", "archived")
    .limit(1);
  if (existingError) throw new Error(existingError.message);
  if (existing?.[0]?.id) return existing[0].id as string;

  const metadata = {
    task_key: `${generatedFrom}_${task.id}`,
    task_style: "harvest_watch",
    crop_profile_id: profile.id,
    crop_profile_stable_key: profile.stable_key,
    crop: profile.crop_label,
    variety: profile.variety,
    display_action: "Check",
    display_subject: `${profileLabel} harvest readiness`,
    display_detail: objectLabel,
    collection_zone: objectLabel,
    assigned_to: "Anna",
    anna_task: true,
    source_germination_task_id: task.id,
    source_sowing_task_id: clean((task.metadata ?? {}).source_sowing_task_id),
    source_sown_date: sourceSownDate,
  };

  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .insert({
      farm_id: task.farm_id,
      zone_id: task.zone_id,
      title: `Start harvest watch — ${profileLabel} — ${objectLabel}`,
      task_type: "harvest_watch",
      status: "open",
      priority: task.priority ?? "normal",
      due_date: dueDate,
      generated_from: generatedFrom,
      generated_from_id: task.id,
      note: null,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(error?.message || "Harvest watch task creation failed.");
  await linkObject(data.id as string, objectId);
  return data.id as string;
}

export async function GET(request: NextRequest) {
  try {
    const taskId = request.nextUrl.searchParams.get("taskId") ?? undefined;
    const taskTitle = request.nextUrl.searchParams.get("taskTitle") ?? undefined;
    const task = await getTask({ taskId, taskTitle });
    const metadata = task.metadata ?? {};
    if (clean(metadata.task_style) !== "germination_check" && task.task_type !== "germination_check") {
      return NextResponse.json({ ok: true, germinationCheck: false });
    }
    const [profile, object] = await Promise.all([getProfile(task), getObject(task.id)]);
    return NextResponse.json({
      ok: true,
      germinationCheck: true,
      task: {
        id: task.id,
        title: task.title,
        dueDate: task.due_date,
        objectLabel: object.objectLabel,
        cropLabel: profile.crop_label,
        variety: profile.variety,
        expectedMinDays: profile.days_to_germination_min,
        expectedMaxDays: profile.days_to_germination_max,
        notYetCount: positiveInteger(metadata.not_yet_count) ?? 0,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Germination check lookup failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const task = await getTask(body);
    const metadata = task.metadata ?? {};
    const action = body.action;
    if (action !== "not_yet" && action !== "germinated") return NextResponse.json({ ok: false, error: "Action must be not_yet or germinated." }, { status: 400 });

    const [profile, object] = await Promise.all([getProfile(task), getObject(task.id)]);
    const now = new Date().toISOString();
    const today = todayIso();

    if (action === "not_yet") {
      const baseDate = task.due_date && task.due_date > today ? task.due_date : today;
      const nextDate = addDaysIso(baseDate, 1);
      const nextMetadata = {
        ...metadata,
        not_yet_count: (positiveInteger(metadata.not_yet_count) ?? 0) + 1,
        last_not_yet_at: now,
      };
      const { error } = await atlasSupabase.schema("atlas").from("tasks").update({ due_date: nextDate, status: "open", metadata: nextMetadata, updated_at: now }).eq("id", task.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, action, taskId: task.id, nextDate });
    }

    const spacingInches = positiveSpacing(body.spacingInches);
    if (spacingInches === null) {
      return NextResponse.json({ ok: false, error: "Enter the observed inches between seedlings." }, { status: 400 });
    }

    const sourceSowingTaskId = clean(metadata.source_sowing_task_id);
    const sourceSownDate = clean(metadata.source_sown_date) || clean(metadata.trigger_anchor_date) || today;
    const cropName = profile.variety || profile.crop_label;
    const summary = `${cropName} germinated in ${object.objectLabel} · ${spacingInches} inches between seedlings`;
    const nextMetadata = {
      ...metadata,
      observed_spacing_inches: spacingInches,
      spacing_measurement_kind: "average_between_seedlings",
      germination_logged_at: now,
      germination_logged_by: "Anna",
    };

    const { error: taskError } = await atlasSupabase.schema("atlas").from("tasks").update({ status: "done", completed_at: now, metadata: nextMetadata, updated_at: now }).eq("id", task.id);
    if (taskError) throw new Error(taskError.message);

    await atlasSupabase.schema("atlas").from("task_outcome_events").insert({
      farm_id: task.farm_id,
      task_id: task.id,
      outcome: "done",
      lane_key: "maintain",
      work_key: "germination_check",
      note: summary,
      task_title: task.title,
      task_type: task.task_type,
      zone_id: task.zone_id,
      due_date: task.due_date,
      priority: task.priority,
      source: "atlas_germination_workflow",
      metadata: { observed_spacing_inches: spacingInches, object_id: object.objectId, crop_profile_id: profile.id },
    });

    await atlasSupabase.schema("atlas").from("field_logs").insert({
      farm_id: task.farm_id,
      log_date: today,
      action_types: ["germination_check", "spacing_logged"],
      summary_sentence: summary,
      note: null,
      source: "atlas_germination_workflow",
      metadata: {
        task_id: task.id,
        source_sowing_task_id: sourceSowingTaskId || null,
        object_id: object.objectId,
        crop_profile_id: profile.id,
        observed_spacing_inches: spacingInches,
        spacing_measurement_kind: "average_between_seedlings",
      },
    });

    if (object.objectId) {
      const { data: cycleRows } = await atlasSupabase.schema("atlas").from("crop_cycles").select("id, metadata").eq("object_id", object.objectId).eq("crop_profile_id", profile.id).eq("lifecycle_status", "active").order("created_at", { ascending: false }).limit(1);
      if (cycleRows?.[0]?.id) {
        await atlasSupabase.schema("atlas").from("crop_cycles").update({
          germination_checked_date: today,
          cycle_state: "germinated",
          metadata: {
            ...((cycleRows[0].metadata as Record<string, unknown>) ?? {}),
            observed_spacing_inches: spacingInches,
            spacing_measurement_kind: "average_between_seedlings",
          },
          updated_at: now,
        }).eq("id", cycleRows[0].id);
      }
      const { data: stateRows } = await atlasSupabase.schema("atlas").from("object_state").select("metadata").eq("object_id", object.objectId).limit(1);
      await atlasSupabase.schema("atlas").from("object_state").update({
        last_checked_at: today,
        metadata: {
          ...((stateRows?.[0]?.metadata as Record<string, unknown>) ?? {}),
          germination_status: "germinated",
          observed_spacing_inches: spacingInches,
          spacing_measurement_kind: "average_between_seedlings",
          germination_logged_at: now,
        },
        updated_at: now,
      }).eq("object_id", object.objectId);
    }

    const nextTaskId = await createHarvestTask(task, object.objectId, object.objectLabel, profile, sourceSownDate);
    return NextResponse.json({ ok: true, action, taskId: task.id, spacingInches, nextTaskId });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Germination check update failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
