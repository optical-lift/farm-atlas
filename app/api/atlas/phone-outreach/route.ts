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
const REACHED_RESULTS = new Set(["agreed", "maybe", "not_interested", "wrong_contact"]);
const ALLOWED_RESULTS = new Set([...REACHED_RESULTS, "voicemail", "no_answer"]);

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

function phoneOutreachError(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "phone_outreach_forbidden", error.message || "This phone outreach task is not available to the selected account.");
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "phone_outreach_not_found", error.message || "The phone outreach task was not found.");
  }
  if (error.code === "22023") {
    return atlasApiError(400, "phone_outreach_rejected", error.message || "That phone outreach result could not be saved.");
  }
  return atlasApiError(500, "phone_outreach_failed", error.message || "Atlas could not save this phone outreach result.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "phone-outreach-v1") {
    return atlasApiError(400, "phone_outreach_intent_required", "A valid phone outreach intent is required.");
  }

  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager", "farm_hand"] });
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_phone_outreach_request", "The phone outreach request is invalid.");
  }

  const taskId = text(body.taskId);
  if (!UUID_PATTERN.test(taskId)) {
    return atlasApiError(400, "invalid_phone_outreach_request", "A valid phone outreach task is required.");
  }

  const contactResult = text(body.contactResult);
  if (!ALLOWED_RESULTS.has(contactResult)) {
    return atlasApiError(400, "invalid_phone_outreach_result", "Choose what happened on the call.");
  }

  const reachedName = text(body.reachedName);
  const notes = text(body.notes);
  if (REACHED_RESULTS.has(contactResult) && !reachedName) {
    return atlasApiError(400, "phone_outreach_person_required", "Add who you talked to.");
  }
  if (REACHED_RESULTS.has(contactResult) && !notes) {
    return atlasApiError(400, "phone_outreach_notes_required", "Add what they said.");
  }

  const operatorContext = await readAtlasOwnerOperatorContext();
  const membershipId = effectiveOperatorMembershipId(operatorContext)
    ?? authorized.access.membership.membershipId;
  if (!membershipId || !UUID_PATTERN.test(membershipId)) {
    return atlasApiError(403, "phone_outreach_membership_required", "An active farm membership is required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .schema("atlas")
    .rpc("record_phone_outreach_result_v1", {
      p_task_id: taskId,
      p_contact_result: contactResult,
      p_reached_name: nullableText(body.reachedName),
      p_notes: nullableText(body.notes),
      p_effective_membership_id: membershipId,
    });

  if (error) return phoneOutreachError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_phone_outreach_result", "Atlas returned an invalid phone outreach result.");
  }

  return privateJson({ ok: true, result: data as Record<string, unknown> });
}
