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

function nullablePositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nullableNonnegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buyerOutreachError(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "buyer_outreach_forbidden", error.message || "This buyer outreach task is not available to the selected account.");
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "buyer_outreach_not_found", error.message || "The buyer or outreach task was not found.");
  }
  if (error.code === "22023") {
    return atlasApiError(400, "buyer_outreach_rejected", error.message || "That buyer outreach update could not be saved.");
  }
  return atlasApiError(500, "buyer_outreach_failed", error.message || "Atlas could not save this buyer outreach update.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "buyer-outreach-v1") {
    return atlasApiError(400, "buyer_outreach_intent_required", "A valid buyer outreach intent is required.");
  }

  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager", "farm_hand"] });
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_buyer_outreach_request", "The buyer outreach request is invalid.");
  }

  const taskId = text(body.taskId);
  if (!UUID_PATTERN.test(taskId)) {
    return atlasApiError(400, "invalid_buyer_outreach_request", "A valid buyer outreach task is required.");
  }

  const contactResult = text(body.contactResult);
  if (!contactResult) {
    return atlasApiError(400, "contact_result_required", "Choose what happened on the call.");
  }

  const quantity = nullablePositiveInteger(body.quantity);
  if (body.quantity !== null && body.quantity !== undefined && body.quantity !== "" && quantity === null) {
    return atlasApiError(400, "invalid_buyer_quantity", "Quantity must be a positive whole number.");
  }

  const quotedWeeklyPrice = nullableNonnegativeNumber(body.quotedWeeklyPrice);
  if (body.quotedWeeklyPrice !== null && body.quotedWeeklyPrice !== undefined && body.quotedWeeklyPrice !== "" && quotedWeeklyPrice === null) {
    return atlasApiError(400, "invalid_buyer_price", "Weekly price must be zero or greater.");
  }

  const agreedStartDateText = text(body.agreedStartDate);
  if (agreedStartDateText && !DATE_PATTERN.test(agreedStartDateText)) {
    return atlasApiError(400, "invalid_buyer_start_date", "Choose a valid start date.");
  }

  const operatorContext = await readAtlasOwnerOperatorContext();
  const membershipId = effectiveOperatorMembershipId(operatorContext)
    ?? authorized.access.membership.membershipId;
  if (!membershipId || !UUID_PATTERN.test(membershipId)) {
    return atlasApiError(403, "buyer_outreach_membership_required", "An active farm membership is required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .schema("atlas")
    .rpc("record_buyer_outreach_result_v1", {
      p_task_id: taskId,
      p_contact_result: contactResult,
      p_reached_name: nullableText(body.reachedName),
      p_contact_details: nullableText(body.contactDetails),
      p_follow_up: nullableText(body.followUp),
      p_notes: nullableText(body.notes),
      p_quantity: quantity,
      p_quoted_weekly_price: quotedWeeklyPrice,
      p_agreed_start_date: nullableDate(body.agreedStartDate),
      p_effective_membership_id: membershipId,
    });

  if (error) return buyerOutreachError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_buyer_outreach_result", "Atlas returned an invalid buyer outreach result.");
  }

  return privateJson({ ok: true, result: data as Record<string, unknown> });
}
