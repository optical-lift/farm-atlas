import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";
import { resolveOwnerWorkerDayPlanningTarget } from "@/lib/atlas/worker-day-plan-server";

export const dynamic = "force-dynamic";

type DayEditKind = "place" | "rewindow" | "reschedule" | "reorder" | "return_to_atlas";
type DayWindow = "morning" | "afternoon" | "evening";

type DayEdit = {
  kind: DayEditKind;
  taskId: string;
  serviceDate: string;
  dayWindow?: DayWindow;
  sortOrder?: number;
};

type RequestBody = { edits?: unknown };
type RpcError = { code?: string; message?: string };

function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validDateIso(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function normalizeEdits(value: unknown): DayEdit[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const result: DayEdit[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const kind = row.kind;
    const taskId = row.taskId;
    if (!["place","rewindow","reschedule","reorder","return_to_atlas"].includes(String(kind)) || !validUuid(taskId)) return null;
    if (!validDateIso(row.serviceDate)) return null;
    const dayWindow = ["morning","afternoon","evening"].includes(String(row.dayWindow)) ? row.dayWindow as DayWindow : undefined;
    const sortOrder = row.sortOrder === undefined ? undefined : Number(row.sortOrder);
    if (sortOrder !== undefined && !Number.isFinite(sortOrder)) return null;
    if (kind !== "return_to_atlas" && !dayWindow) return null;
    result.push({
      kind: kind as DayEditKind,
      taskId,
      serviceDate: row.serviceDate,
      ...(dayWindow ? { dayWindow } : {}),
      ...(sortOrder === undefined ? {} : { sortOrder }),
    });
  }
  return result;
}

function rpcError(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "owner_day_edit_forbidden", error.message || "Owner access is required to edit this Day.");
  if (error.code === "22023") return atlasApiError(400, "owner_day_edit_invalid", error.message || "One of the Day edits is invalid.");
  if (error.code === "55000") return atlasApiError(409, "owner_day_edit_changed", error.message || "A task changed before Atlas could apply the Day edit.");
  return atlasApiError(500, "owner_day_edit_failed", "Atlas could not apply these Day edits.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "owner-day-edit-v1") {
    return atlasApiError(400, "owner_day_edit_intent_required", "A valid Owner Day edit intent is required.");
  }

  let body: RequestBody;
  try {
    body = await readAtlasJsonBody(request) as RequestBody;
  } catch {
    return atlasApiError(400, "owner_day_edit_invalid_json", "The Day edit request is invalid.");
  }

  const edits = normalizeEdits(body.edits);
  if (!edits) return atlasApiError(400, "owner_day_edit_required", "Choose at least one valid Day change.");

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const target = await resolveOwnerWorkerDayPlanningTarget();
  if (!target) {
    return atlasApiError(409, "owner_day_edit_target_required", "Atlas could not resolve one Farm Hand Day to edit. Choose a worker lens first if this farm has multiple Farm Hands.");
  }

  const supabase = await createAtlasServerClient();
  const response = await supabase.rpc("owner_apply_worker_day_edits_api_v1", {
    p_farm_id: target.farmId,
    p_membership_id: target.membershipId,
    p_edits: edits,
  });
  if (response.error) return rpcError(response.error);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return atlasApiError(500, "owner_day_edit_invalid_result", "Atlas returned an invalid Day edit result.");
  }

  return Response.json({
    ...(response.data as Record<string, unknown>),
    ok: true,
    targetSource: target.source,
    targetMembershipId: target.membershipId,
    targetLabel: target.displayName,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
