import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const valueText = text(value);
  return valueText || null;
}

function nullableDate(value: unknown) {
  const valueText = text(value);
  return valueText && DATE_PATTERN.test(valueText) ? valueText : null;
}

function nullableTime(value: unknown) {
  const valueText = text(value);
  return valueText && TIME_PATTERN.test(valueText) ? valueText : null;
}

function nullablePositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 250 ? parsed : null;
}

function outreachError(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "network_outreach_forbidden", error.message || "This outreach task is not available to the selected account.");
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "network_outreach_not_found", error.message || "The outreach task was not found.");
  }
  if (error.code === "P0003") {
    return atlasApiError(409, "network_outreach_conflict", error.message || "That Thursday time is already in use.");
  }
  if (error.code === "22023") {
    return atlasApiError(400, "network_outreach_rejected", error.message || "That outreach update could not be saved.");
  }
  return atlasApiError(500, "network_outreach_failed", error.message || "Atlas could not save this outreach update.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "network-outreach-v1") {
    return atlasApiError(400, "network_outreach_intent_required", "A valid network outreach intent is required.");
  }

  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager", "farm_hand"] });
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_network_outreach_request", "The network outreach request is invalid.");
  }

  const taskId = text(body.taskId);
  if (!UUID_PATTERN.test(taskId)) {
    return atlasApiError(400, "invalid_network_outreach_request", "A valid outreach task is required.");
  }

  const operatorContext = await readAtlasOwnerOperatorContext();
  const membershipId = effectiveOperatorMembershipId(operatorContext)
    ?? authorized.access.membership.membershipId;
  if (!membershipId || !UUID_PATTERN.test(membershipId)) {
    return atlasApiError(403, "network_outreach_membership_required", "An active farm membership is required.");
  }

  const supabase = await createAtlasServerClient();
  const action = text(body.action);

  if (action === "save_result") {
    const contactResult = text(body.contactResult);
    if (!contactResult) {
      return atlasApiError(400, "contact_result_required", "Choose what happened on the call.");
    }

    const bookingDateText = text(body.bookingDate);
    const bookingStartText = text(body.bookingStart);
    if (bookingDateText && !DATE_PATTERN.test(bookingDateText)) {
      return atlasApiError(400, "invalid_booking_date", "Choose a valid Thursday date.");
    }
    if (bookingStartText && !TIME_PATTERN.test(bookingStartText)) {
      return atlasApiError(400, "invalid_booking_time", "Choose a valid Thursday time.");
    }

    const expectedGroupSize = nullablePositiveInteger(body.expectedGroupSize);
    if (body.expectedGroupSize !== null && body.expectedGroupSize !== undefined && body.expectedGroupSize !== "" && expectedGroupSize === null) {
      return atlasApiError(400, "invalid_group_size", "Expected group size must be a positive whole number.");
    }

    const { data, error } = await supabase
      .schema("atlas")
      .rpc("record_network_outreach_result_v1", {
        p_task_id: taskId,
        p_contact_result: contactResult,
        p_reached_name: nullableText(body.reachedName),
        p_group_type: nullableText(body.groupType),
        p_contact_details: nullableText(body.contactDetails),
        p_follow_up: nullableText(body.followUp),
        p_booking_date: nullableDate(body.bookingDate),
        p_booking_start: nullableTime(body.bookingStart),
        p_expected_group_size: expectedGroupSize,
        p_restroom_disclosed: body.restroomDisclosed === true,
        p_notes: nullableText(body.notes),
        p_effective_membership_id: membershipId,
      });

    if (error) return outreachError(error);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return atlasApiError(500, "invalid_network_outreach_result", "Atlas returned an invalid outreach result.");
    }
    return privateJson({ ok: true, result: data as Record<string, unknown> });
  }

  if (action === "release_next_batch") {
    const nextTaskKey = text(body.nextTaskKey);
    if (!nextTaskKey) {
      return atlasApiError(400, "next_batch_required", "A next outreach batch is required.");
    }

    const { data, error } = await supabase
      .schema("atlas")
      .rpc("release_network_outreach_batch_v1", {
        p_task_id: taskId,
        p_next_task_key: nextTaskKey,
        p_effective_membership_id: membershipId,
      });

    if (error) return outreachError(error);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return atlasApiError(500, "invalid_network_outreach_release", "Atlas returned an invalid outreach release result.");
    }
    const result = data as Record<string, unknown>;
    return privateJson({
      ok: true,
      result,
      nextTaskId: typeof result.nextTaskId === "string" ? result.nextTaskId : undefined,
    });
  }

  return atlasApiError(400, "unsupported_network_outreach_action", "That network outreach action is not supported.");
}
