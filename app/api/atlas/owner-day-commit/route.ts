import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { resolveOwnerWorkerDayPlanningTarget } from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type DayEditKind = "place" | "rewindow" | "reschedule" | "reorder" | "return_to_atlas";
type DayWindow = "morning" | "afternoon" | "evening";
type CandidateKind = "project_pull" | "floating_task";
type CueKind = "briefing" | "requirement" | "observation" | "somatic" | "result";
type CueAnchorKind = "first_open" | "before_task" | "after_task" | "at_time";
type CueRecoveryPolicy = "refresh" | "expire" | "persist" | "block";

type DayEdit = {
  kind: DayEditKind;
  taskId: string;
  serviceDate: string;
  dayWindow?: DayWindow;
  sortOrder?: number;
};

type Selection = { sourceKind: CandidateKind; sourceId: string };
type CueUpsertEdit = {
  kind: "upsert";
  cue: {
    cueId?: string;
    serviceDate: string;
    cueKind: CueKind;
    anchorKind: CueAnchorKind;
    anchorTaskId: string | null;
    scheduledAt: string | null;
    availableFrom: string | null;
    expiresAt: string | null;
    title: string;
    body: string | null;
    payload: Record<string, unknown>;
    resultContract?: Record<string, unknown>;
    recoveryPolicy: CueRecoveryPolicy;
  };
};
type CueDeleteEdit = { kind: "delete"; cueId: string };
type CueEdit = CueUpsertEdit | CueDeleteEdit;
type RequestBody = { date?: unknown; edits?: unknown; selections?: unknown; cueEdits?: unknown };
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

function boundedString(value: unknown, max: number, required = false) {
  if (value === null || value === undefined) return required ? null : "";
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if ((required && !clean) || clean.length > max) return null;
  return clean;
}

function plainRecord(value: unknown) {
  if (value === null || value === undefined) return {} as Record<string, unknown>;
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalTimestamp(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 64 || Number.isNaN(new Date(value).getTime())) return undefined;
  return value;
}

function normalizeEdits(value: unknown, fallbackDate: string): DayEdit[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) return null;
  const result: DayEdit[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const kind = String(row.kind) as DayEditKind;
    if (!["place", "rewindow", "reschedule", "reorder", "return_to_atlas"].includes(kind) || !validUuid(row.taskId)) return null;
    const serviceDate = validDateIso(row.serviceDate) ? row.serviceDate : fallbackDate;
    const dayWindow = ["morning", "afternoon", "evening"].includes(String(row.dayWindow)) ? row.dayWindow as DayWindow : undefined;
    const sortOrder = row.sortOrder === undefined ? undefined : Number(row.sortOrder);
    if (sortOrder !== undefined && !Number.isFinite(sortOrder)) return null;
    if (kind !== "return_to_atlas" && !dayWindow) return null;
    result.push({
      kind,
      taskId: row.taskId,
      serviceDate,
      ...(dayWindow ? { dayWindow } : {}),
      ...(sortOrder === undefined ? {} : { sortOrder }),
    });
  }
  return result;
}

function normalizeSelections(value: unknown): Selection[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 40) return null;
  const result: Selection[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const sourceKind = String(row.sourceKind) as CandidateKind;
    if (!["project_pull", "floating_task"].includes(sourceKind) || !validUuid(row.sourceId)) return null;
    result.push({ sourceKind, sourceId: row.sourceId });
  }
  return result;
}

function normalizeCueEdits(value: unknown, serviceDate: string): CueEdit[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 40) return null;
  const result: CueEdit[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const kind = String(row.kind);
    if (kind === "delete") {
      if (!validUuid(row.cueId)) return null;
      result.push({ kind: "delete", cueId: row.cueId });
      continue;
    }
    if (kind !== "upsert" || !row.cue || typeof row.cue !== "object" || Array.isArray(row.cue)) return null;

    const cue = row.cue as Record<string, unknown>;
    if (cue.cueId !== undefined && cue.cueId !== null && !validUuid(cue.cueId)) return null;
    const cueKind = String(cue.cueKind) as CueKind;
    const anchorKind = String(cue.anchorKind) as CueAnchorKind;
    const recoveryPolicy = String(cue.recoveryPolicy || "refresh") as CueRecoveryPolicy;
    if (!["briefing", "requirement", "observation", "somatic", "result"].includes(cueKind)) return null;
    if (!["first_open", "before_task", "after_task", "at_time"].includes(anchorKind)) return null;
    if (!["refresh", "expire", "persist", "block"].includes(recoveryPolicy)) return null;
    if (cue.anchorTaskId !== undefined && cue.anchorTaskId !== null && !validUuid(cue.anchorTaskId)) return null;

    const title = boundedString(cue.title, 160, true);
    const body = boundedString(cue.body, 1000, false);
    const payload = plainRecord(cue.payload);
    const hasResultContract = Object.prototype.hasOwnProperty.call(cue, "resultContract");
    const resultContract = hasResultContract ? plainRecord(cue.resultContract) : undefined;
    const scheduledAt = optionalTimestamp(cue.scheduledAt);
    const availableFrom = optionalTimestamp(cue.availableFrom);
    const expiresAt = optionalTimestamp(cue.expiresAt);
    if (title === null || body === null || payload === null || resultContract === null || scheduledAt === undefined || availableFrom === undefined || expiresAt === undefined) return null;

    result.push({
      kind: "upsert",
      cue: {
        ...(cue.cueId ? { cueId: cue.cueId as string } : {}),
        serviceDate,
        cueKind,
        anchorKind,
        anchorTaskId: cue.anchorTaskId ? cue.anchorTaskId as string : null,
        scheduledAt,
        availableFrom,
        expiresAt,
        title,
        body: body || null,
        payload,
        ...(hasResultContract ? { resultContract: resultContract as Record<string, unknown> } : {}),
        recoveryPolicy,
      },
    });
  }
  return result;
}

function rpcError(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "owner_day_commit_forbidden", error.message || "Owner access is required to commit this Day.");
  if (error.code === "22023") return atlasApiError(400, "owner_day_commit_invalid", error.message || "One of the Day changes is invalid.");
  if (error.code === "55000") return atlasApiError(409, "owner_day_commit_changed", error.message || "The farm changed before Atlas could commit this Day. Nothing from this draft was saved.");
  return atlasApiError(500, "owner_day_commit_failed", "Atlas could not commit this Day. Nothing from this draft was saved.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "owner-day-commit-v2") {
    return atlasApiError(400, "owner_day_commit_intent_required", "A valid Owner Day commit intent is required.");
  }

  let body: RequestBody;
  try {
    body = await readAtlasJsonBody(request) as RequestBody;
  } catch {
    return atlasApiError(400, "owner_day_commit_invalid_json", "The Day commit request is invalid.");
  }

  if (!validDateIso(body.date)) return atlasApiError(400, "owner_day_commit_date_required", "A valid YYYY-MM-DD Day date is required.");
  const edits = normalizeEdits(body.edits, body.date);
  const selections = normalizeSelections(body.selections);
  const cueEdits = normalizeCueEdits(body.cueEdits, body.date);
  if (!edits || !selections || !cueEdits) return atlasApiError(400, "owner_day_commit_invalid", "One of the Day changes is invalid.");
  if (!edits.length && !selections.length && !cueEdits.length) return atlasApiError(400, "owner_day_commit_empty", "Choose at least one Day change.");

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const target = await resolveOwnerWorkerDayPlanningTarget();
  if (!target) {
    return atlasApiError(409, "owner_day_commit_target_required", "Atlas could not resolve one Farm Hand Day to edit. Choose a worker lens first if this farm has multiple Farm Hands.");
  }

  const supabase = await createAtlasServerClient();
  const response = await supabase.rpc("owner_commit_worker_day_choreography_api_v2", {
    p_farm_id: target.farmId,
    p_membership_id: target.membershipId,
    p_day: body.date,
    p_edits: edits,
    p_selections: selections,
    p_cue_edits: cueEdits,
  });
  if (response.error) return rpcError(response.error);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return atlasApiError(500, "owner_day_commit_invalid_result", "Atlas returned an invalid Day commit result.");
  }

  return Response.json({
    ...(response.data as Record<string, unknown>),
    ok: true,
    targetSource: target.source,
    targetMembershipId: target.membershipId,
    targetLabel: target.displayName,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
