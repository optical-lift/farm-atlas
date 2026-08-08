import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

const OUTREACH_RESULTS = new Set([
  "interested",
  "maybe",
  "not_interested",
  "voicemail",
  "no_answer",
  "wrong_contact",
]);

const THURSDAY_SLOTS: Record<string, string> = {
  "09:30": "11:00",
  "11:30": "13:00",
  "13:30": "15:00",
  "15:30": "17:00",
};

type TaskRow = {
  id: string;
  farm_id: string;
  parent_task_id: string | null;
  status: string;
  assigned_membership_id: string | null;
  visibility_scope: string;
  metadata: Record<string, unknown> | null;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalPositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 250 ? parsed : null;
}

function isoDate(value: unknown) {
  const candidate = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function isThursday(dateIso: string) {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay() === 4;
}

function canActOnTask(task: TaskRow, membership: { farmId: string; membershipId: string; role: string }) {
  if (task.farm_id !== membership.farmId) return false;
  if (membership.role === "owner" || membership.role === "manager") return true;
  return task.visibility_scope === "assigned_worker"
    && task.assigned_membership_id === membership.membershipId;
}

async function readTask(taskId: string) {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id,farm_id,parent_task_id,status,assigned_membership_id,visibility_scope,metadata")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as TaskRow | null;
}

async function saveResult(
  task: TaskRow,
  body: Record<string, unknown>,
) {
  if (text(task.metadata?.subtask_kind) !== "network_outreach_contact") {
    return atlasApiError(409, "network_outreach_task_required", "This is not a network outreach contact task.");
  }

  const contactResult = text(body.contactResult);
  if (!OUTREACH_RESULTS.has(contactResult)) {
    return atlasApiError(400, "contact_result_required", "Choose what happened on the call.");
  }

  const reachedName = text(body.reachedName);
  const groupType = text(body.groupType);
  const contactDetails = text(body.contactDetails);
  const followUp = text(body.followUp);
  const notes = text(body.notes);
  const expectedGroupSize = optionalPositiveInteger(body.expectedGroupSize);
  const bookingDate = isoDate(body.bookingDate);
  const bookingStart = text(body.bookingStart);
  const restroomDisclosed = body.restroomDisclosed === true;

  if (body.expectedGroupSize && !expectedGroupSize) {
    return atlasApiError(400, "invalid_group_size", "Expected group size must be a positive whole number.");
  }

  let eventId: string | null = null;
  let bookingEnd = "";

  if (bookingDate || bookingStart) {
    if (!bookingDate || !bookingStart || !THURSDAY_SLOTS[bookingStart]) {
      return atlasApiError(400, "thursday_slot_required", "Choose one of Elm's Thursday visit slots.");
    }
    if (!isThursday(bookingDate)) {
      return atlasApiError(400, "thursday_required", "Church visits can only be booked on a Thursday.");
    }
    if (!restroomDisclosed) {
      return atlasApiError(400, "restroom_disclosure_required", "Confirm the outdoor-only restroom limitation before booking.");
    }

    bookingEnd = THURSDAY_SLOTS[bookingStart];
    const stableKey = `church_group_visit_${task.id.replaceAll("-", "")}`;
    const churchName = text(task.metadata?.church_name) || text(task.metadata?.checklist_label) || "Church group";

    const { data: conflict, error: conflictError } = await atlasSupabase
      .schema("atlas")
      .from("community_events")
      .select("id,title")
      .eq("farm_id", task.farm_id)
      .eq("event_kind", "church_group_visit")
      .eq("event_date", bookingDate)
      .eq("start_local_time", bookingStart)
      .neq("stable_key", stableKey)
      .neq("status", "cancelled")
      .maybeSingle();
    if (conflictError) throw new Error(conflictError.message);
    if (conflict) {
      return atlasApiError(409, "thursday_slot_taken", `${bookingDate} at ${bookingStart} is already booked for another church group.`);
    }

    const { data: program, error: programError } = await atlasSupabase
      .schema("atlas")
      .from("community_programs")
      .select("id")
      .eq("farm_id", task.farm_id)
      .eq("stable_key", "thursdays_at_elm")
      .maybeSingle();
    if (programError) throw new Error(programError.message);
    if (!program?.id) {
      return atlasApiError(409, "thursdays_program_missing", "Thursdays at Elm is not configured for this farm.");
    }

    const eventMetadata = {
      source: "network_outreach",
      source_task_id: task.id,
      source_parent_task_id: task.parent_task_id,
      church_name: churchName,
      group_type: groupType || null,
      contact_name: reachedName || null,
      contact_details: contactDetails || null,
      follow_up: followUp || null,
      expected_group_size: expectedGroupSize,
      outdoor_only: true,
      free_use: true,
      guest_restroom_available: false,
      restroom_disclosed: true,
      notes: notes || null,
    };

    const { data: existingEvent, error: existingError } = await atlasSupabase
      .schema("atlas")
      .from("community_events")
      .select("id")
      .eq("farm_id", task.farm_id)
      .eq("stable_key", stableKey)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (existingEvent?.id) {
      const { data: updated, error: updateError } = await atlasSupabase
        .schema("atlas")
        .from("community_events")
        .update({
          program_id: program.id,
          title: `${churchName} · Elm Farm visit`,
          event_kind: "church_group_visit",
          event_date: bookingDate,
          start_local_time: bookingStart,
          end_local_time: bookingEnd,
          timezone_name: "America/Chicago",
          status: "scheduled",
          visibility_scope: "farm_shared",
          capacity: expectedGroupSize,
          metadata: eventMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingEvent.id)
        .select("id")
        .single();
      if (updateError) throw new Error(updateError.message);
      eventId = updated.id;
    } else {
      const { data: inserted, error: insertError } = await atlasSupabase
        .schema("atlas")
        .from("community_events")
        .insert({
          farm_id: task.farm_id,
          program_id: program.id,
          stable_key: stableKey,
          title: `${churchName} · Elm Farm visit`,
          event_kind: "church_group_visit",
          event_date: bookingDate,
          start_local_time: bookingStart,
          end_local_time: bookingEnd,
          timezone_name: "America/Chicago",
          status: "scheduled",
          visibility_scope: "farm_shared",
          capacity: expectedGroupSize,
          metadata: eventMetadata,
        })
        .select("id")
        .single();
      if (insertError) throw new Error(insertError.message);
      eventId = inserted.id;
    }
  }

  const nextMetadata = {
    ...(task.metadata ?? {}),
    network_outreach_result: {
      contact_result: contactResult,
      reached_name: reachedName || null,
      group_type: groupType || null,
      contact_details: contactDetails || null,
      follow_up: followUp || null,
      notes: notes || null,
      booking_date: bookingDate || null,
      booking_start: bookingStart || null,
      booking_end: bookingEnd || null,
      expected_group_size: expectedGroupSize,
      restroom_disclosed: bookingDate ? restroomDisclosed : null,
      community_event_id: eventId,
      recorded_at: new Date().toISOString(),
    },
  };

  const { error: taskUpdateError } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
    .eq("id", task.id);
  if (taskUpdateError) throw new Error(taskUpdateError.message);

  return privateJson({
    ok: true,
    taskId: task.id,
    eventId,
    booking: bookingDate ? { date: bookingDate, start: bookingStart, end: bookingEnd } : null,
  });
}

async function releaseNextBatch(
  sourceTask: TaskRow,
  nextTaskKey: string,
) {
  if (sourceTask.status !== "done") {
    return atlasApiError(409, "source_batch_not_done", "Finish this outreach batch before releasing the next one.");
  }

  const { data: nextTask, error: nextError } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id,status,metadata")
    .eq("farm_id", sourceTask.farm_id)
    .filter("metadata->>task_key", "eq", nextTaskKey)
    .maybeSingle();
  if (nextError) throw new Error(nextError.message);
  if (!nextTask?.id) {
    return atlasApiError(404, "next_batch_missing", "The next outreach batch was not found.");
  }

  if (nextTask.status !== "open") {
    const now = new Date().toISOString();
    const { error: updateError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .update({
        status: "open",
        blocker_text: null,
        released_at: now,
        release_reason: "previous_network_outreach_batch_complete",
        metadata: {
          ...(nextTask.metadata ?? {}),
          prerequisite_gate_state: "released",
          prerequisite_released_at: now,
          prerequisite_source_task_id: sourceTask.id,
        },
        updated_at: now,
      })
      .eq("id", nextTask.id);
    if (updateError) throw new Error(updateError.message);

    await atlasSupabase.schema("atlas").from("task_transitions").insert({
      farm_id: sourceTask.farm_id,
      task_id: nextTask.id,
      transition: "released",
      previous_status: nextTask.status,
      next_status: "open",
      action_key: "network",
      work_class: "standard",
      reason: "Previous network outreach batch completed",
      payload: {
        source_task_id: sourceTask.id,
        release_source: "network_outreach_sequence",
      },
    });
  }

  return privateJson({ ok: true, nextTaskId: nextTask.id });
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "network-outreach-v1") {
    return atlasApiError(400, "network_outreach_intent_required", "A valid network outreach intent is required.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_network_outreach_request", "The network outreach request is invalid.");
  }

  const taskId = text(body.taskId);
  if (!taskId) return atlasApiError(400, "task_id_required", "A task is required.");

  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager", "farm_hand"] });
  if (!authorized.ok) return authorized.response;

  try {
    const task = await readTask(taskId);
    if (!task) return atlasApiError(404, "task_not_found", "The task was not found.");
    if (!canActOnTask(task, authorized.access.membership)) {
      return atlasApiError(403, "network_outreach_forbidden", "This network outreach task is not assigned to this account.");
    }

    const action = text(body.action);
    if (action === "save_result") return await saveResult(task, body);
    if (action === "release_next_batch") {
      const nextTaskKey = text(body.nextTaskKey);
      if (!nextTaskKey) return atlasApiError(400, "next_batch_required", "A next outreach batch is required.");
      return await releaseNextBatch(task, nextTaskKey);
    }

    return atlasApiError(400, "unsupported_network_outreach_action", "That network outreach action is not supported.");
  } catch (error) {
    console.error("network outreach operation failed", error);
    return atlasApiError(500, "network_outreach_failed", "Atlas could not save this outreach update.");
  }
}
