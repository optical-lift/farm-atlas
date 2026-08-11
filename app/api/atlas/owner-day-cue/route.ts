import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";
import { resolveOwnerWorkerDayPlanningTarget } from "@/lib/atlas/worker-day-plan-server";

export const dynamic = "force-dynamic";

type RequestBody = { cue?: unknown };
type RpcError = { code?: string; message?: string };

function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function rpcError(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "owner_day_cue_forbidden", error.message || "Owner access is required to edit Day cues.");
  if (error.code === "22023") return atlasApiError(400, "owner_day_cue_invalid", error.message || "This Day cue is invalid.");
  if (error.code === "55000") return atlasApiError(409, "owner_day_cue_changed", error.message || "The cue or its task anchor changed.");
  return atlasApiError(500, "owner_day_cue_failed", "Atlas could not save this Day cue.");
}

async function targetOrResponse() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return { response: authorized.response, target: null };
  const target = await resolveOwnerWorkerDayPlanningTarget();
  if (!target) {
    return {
      response: atlasApiError(409, "owner_day_cue_target_required", "Atlas could not resolve one Farm Hand Day. Choose a worker lens first if this farm has multiple Farm Hands."),
      target: null,
    };
  }
  return { response: null, target };
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "owner-day-cue-v1") {
    return atlasApiError(400, "owner_day_cue_intent_required", "A valid Owner Day cue intent is required.");
  }

  let body: RequestBody;
  try {
    body = await readAtlasJsonBody(request) as RequestBody;
  } catch {
    return atlasApiError(400, "owner_day_cue_invalid_json", "The cue request is invalid.");
  }
  if (!body.cue || typeof body.cue !== "object" || Array.isArray(body.cue)) {
    return atlasApiError(400, "owner_day_cue_required", "Cue details are required.");
  }

  const resolved = await targetOrResponse();
  if (!resolved.target) return resolved.response as Response;

  const supabase = await createAtlasServerClient();
  const result = await supabase.rpc("owner_upsert_worker_day_cue_api_v1", {
    p_farm_id: resolved.target.farmId,
    p_membership_id: resolved.target.membershipId,
    p_cue: body.cue,
  });
  if (result.error) return rpcError(result.error);

  return Response.json({ ok: true, ...(result.data as Record<string, unknown>), targetLabel: resolved.target.displayName }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "owner-day-cue-delete-v1") {
    return atlasApiError(400, "owner_day_cue_delete_intent_required", "A valid cue-delete intent is required.");
  }
  const cueId = new URL(request.url).searchParams.get("cueId");
  if (!validUuid(cueId)) return atlasApiError(400, "owner_day_cue_id_required", "A valid cue ID is required.");

  const resolved = await targetOrResponse();
  if (!resolved.target) return resolved.response as Response;

  const supabase = await createAtlasServerClient();
  const result = await supabase.rpc("owner_delete_worker_day_cue_api_v1", {
    p_farm_id: resolved.target.farmId,
    p_membership_id: resolved.target.membershipId,
    p_cue_id: cueId,
  });
  if (result.error) return rpcError(result.error);

  return Response.json({ ok: true, ...(result.data as Record<string, unknown>) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
