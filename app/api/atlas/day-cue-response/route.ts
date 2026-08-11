import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RequestBody = { cueId?: unknown; response?: unknown };
type RpcError = { code?: string; message?: string };

function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "day-cue-response-v1") {
    return atlasApiError(400, "day_cue_response_intent_required", "A valid Day cue response intent is required.");
  }

  let body: RequestBody;
  try {
    body = await readAtlasJsonBody(request) as RequestBody;
  } catch {
    return atlasApiError(400, "day_cue_response_invalid_json", "The cue response is invalid.");
  }
  if (!validUuid(body.cueId)) return atlasApiError(400, "day_cue_response_id_required", "A valid cue ID is required.");
  if (body.response !== undefined && (!body.response || typeof body.response !== "object" || Array.isArray(body.response))) {
    return atlasApiError(400, "day_cue_response_invalid", "Cue response data must be an object.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const supabase = await createAtlasServerClient();
  const result = await supabase.rpc("worker_resolve_day_cue_api_v1", {
    p_cue_id: body.cueId,
    p_response: body.response ?? {},
  });
  if (result.error) {
    const error = result.error as RpcError;
    if (error.code === "42501") return atlasApiError(403, "day_cue_response_forbidden", error.message || "This cue is not available to this account.");
    if (error.code === "22023") return atlasApiError(400, "day_cue_response_invalid", error.message || "This cue response is invalid.");
    return atlasApiError(500, "day_cue_response_failed", "Atlas could not record this cue response.");
  }

  return Response.json({ ok: true, ...(result.data as Record<string, unknown>) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
