import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RequestBody = { cueId?: unknown };
type RpcError = { code?: string; message?: string };

function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "day-cue-dismiss-v1") {
    return atlasApiError(400, "day_cue_dismiss_intent_required", "A valid Day cue dismissal intent is required.");
  }

  let body: RequestBody;
  try {
    body = await readAtlasJsonBody(request) as RequestBody;
  } catch {
    return atlasApiError(400, "day_cue_dismiss_invalid_json", "The cue dismissal is invalid.");
  }
  if (!validUuid(body.cueId)) return atlasApiError(400, "day_cue_dismiss_id_required", "A valid cue ID is required.");

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const supabase = await createAtlasServerClient();
  const result = await supabase.rpc("worker_dismiss_day_cue_api_v1", { p_cue_id: body.cueId });
  if (result.error) {
    const error = result.error as RpcError;
    if (error.code === "42501") return atlasApiError(403, "day_cue_dismiss_forbidden", error.message || "This cue is not available to this account.");
    return atlasApiError(500, "day_cue_dismiss_failed", "Atlas could not dismiss this cue.");
  }

  return Response.json({ ok: true, ...(result.data as Record<string, unknown>) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
