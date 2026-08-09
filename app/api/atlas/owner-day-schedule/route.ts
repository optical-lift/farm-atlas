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
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Selection = {
  sourceKind: "project_pull" | "floating_task" | "queue";
  sourceId: string;
};

type RequestBody = {
  date?: unknown;
  selections?: unknown;
};

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function validDateIso(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeSelections(value: unknown): Selection[] | null {
  if (!Array.isArray(value) || value.length > 40) return null;
  const normalized: Selection[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    const sourceKind = record.sourceKind;
    const sourceId = record.sourceId;
    if (!["project_pull", "floating_task", "queue"].includes(String(sourceKind)) || !validUuid(sourceId)) return null;
    normalized.push({ sourceKind: sourceKind as Selection["sourceKind"], sourceId });
  }
  return normalized;
}

function rpcError(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "owner_schedule_forbidden", error.message || "This worker schedule cannot be changed by the selected account.");
  if (error.code === "22023") return atlasApiError(400, "owner_schedule_invalid", error.message || "The selected schedule is invalid.");
  if (error.code === "55000") return atlasApiError(409, "owner_schedule_changed", error.message || "One of the selected cards changed before Atlas could build the schedule.");
  return atlasApiError(500, "owner_schedule_failed", "Atlas could not build this worker schedule.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "owner-day-schedule-v1") {
    return atlasApiError(400, "owner_schedule_intent_required", "A valid Owner schedule intent is required.");
  }

  let body: RequestBody;
  try {
    body = await readAtlasJsonBody(request) as RequestBody;
  } catch {
    return atlasApiError(400, "owner_schedule_invalid_json", "The schedule request is invalid.");
  }

  if (!validDateIso(body.date)) {
    return atlasApiError(400, "owner_schedule_date_required", "A valid YYYY-MM-DD schedule date is required.");
  }
  const selections = normalizeSelections(body.selections);
  if (!selections || !selections.length) {
    return atlasApiError(400, "owner_schedule_selections_required", "Choose at least one work card before building the schedule.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const operatorContext = await readAtlasOwnerOperatorContext();
  const effectiveMembershipId = effectiveOperatorMembershipId(operatorContext);
  const effective = operatorContext?.effective ?? null;
  if (
    !operatorContext?.isOperating
    || !effectiveMembershipId
    || !effective?.farmId
    || effective.farmRole !== "farm_hand"
  ) {
    return atlasApiError(403, "owner_schedule_operator_required", "Open a Farm Hand account in Owner operator mode before building that worker's schedule.");
  }

  const response = await atlasSupabase.schema("atlas").rpc("owner_build_worker_day_schedule_v1", {
    p_farm_id: effective.farmId,
    p_membership_id: effectiveMembershipId,
    p_day: body.date,
    p_selections: selections,
  });

  if (response.error) return rpcError(response.error);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return atlasApiError(500, "owner_schedule_invalid_result", "Atlas returned an invalid schedule result.");
  }

  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: true,
    effectiveMembershipId,
  });
}
