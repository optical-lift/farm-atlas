import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { buildClockTaskRanges, clockLocalMinuteOfDay } from "@/lib/atlas/clock-layout";
import { atlasFarmDateIso, DEFAULT_ATLAS_FARM_TIME_ZONE } from "@/lib/atlas/farm-day";
import { readWorkerDaySequence } from "@/lib/atlas/worker-day-sequence-server";
import {
  readWorkerActivityDay,
  recordWorkerActivity,
  retractWorkerActivity,
} from "@/lib/atlas-data/worker-activity";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function clockNowSnapshot(sequenceResult: Awaited<ReturnType<typeof readWorkerDaySequence>>) {
  const projection = sequenceResult.projection;
  if (!projection) return { taskId: null, startAt: null, endAt: null, revision: null, membershipId: null };
  const committed = projection.sequence.items.filter((item) => item.kind === "committed_task");
  const ranges = buildClockTaskRanges(committed, { timeZone: DEFAULT_ATLAS_FARM_TIME_ZONE });
  const now = new Date();
  const nowMinute = clockLocalMinuteOfDay(now.toISOString(), DEFAULT_ATLAS_FARM_TIME_ZONE);
  const active = nowMinute === null ? null : ranges.find((range) =>
    Boolean(range.span.minutes)
    && range.startMinute <= nowMinute
    && range.endMinute > nowMinute
    && range.item.status !== "done"
    && range.item.status !== "completed",
  ) ?? null;
  const startAt = active?.item.plannedStartAt ?? null;
  const endAt = startAt && active?.span.minutes
    ? new Date(new Date(startAt).getTime() + active.span.minutes * 60_000).toISOString()
    : null;
  return {
    taskId: active?.item.taskId ?? null,
    startAt,
    endAt,
    revision: projection.revision,
    membershipId: projection.identity.membershipId,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const farmId = url.searchParams.get("farmId");
  const membershipId = url.searchParams.get("membershipId");
  const date = url.searchParams.get("date");
  if (!farmId || !UUID.test(farmId) || !membershipId || !UUID.test(membershipId) || !validDateIso(date)) {
    return atlasApiError(400, "invalid_worker_activity_query", "farmId, membershipId, and a valid date are required.");
  }
  const authorized = await requireAtlasApiAccess({ farmId });
  if (!authorized.ok) return authorized.response;

  try {
    const day = await readWorkerActivityDay({ farmId, membershipId, date: date as string });
    return privateJson({
      ok: true,
      day: {
        date,
        farmId,
        membershipId,
        ...day,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/membership|permission|readable|authorized/i.test(message)) {
      return atlasApiError(403, "worker_activity_not_readable", "This worker day is not readable by the current member.");
    }
    console.error("Atlas worker activity read failed:", error);
    return atlasApiError(500, "worker_activity_read_failed", "Atlas could not load the lived-day activity record.");
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch (error) {
    return atlasApiError(400, "invalid_json_body", error instanceof Error ? error.message : "Invalid Atlas request.");
  }

  const farmId = typeof body.farmId === "string" ? body.farmId : null;
  const logDate = typeof body.logDate === "string" ? body.logDate : null;
  const rawText = typeof body.rawText === "string" ? body.rawText : null;
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : null;
  if (!farmId || !UUID.test(farmId) || !validDateIso(logDate) || !rawText || !idempotencyKey) {
    return atlasApiError(400, "invalid_worker_activity", "A farm, current day, one-sentence work log, and idempotency key are required.");
  }

  const authorized = await requireAtlasApiAccess({ farmId });
  if (!authorized.ok) return authorized.response;

  try {
    const sequenceResult = await readWorkerDaySequence(logDate as string);
    const clock = clockNowSnapshot(sequenceResult);
    if (clock.membershipId && clock.membershipId !== authorized.access.membership.membershipId) {
      return atlasApiError(403, "worker_activity_self_only", "Work logs can only be recorded by the worker whose Day is open.");
    }
    const result = await recordWorkerActivity(authorized.access, {
      logDate: logDate as string,
      rawText,
      idempotencyKey,
      clockNowTaskId: clock.taskId,
      clockNowStartAt: clock.startAt,
      clockNowEndAt: clock.endAt,
      clockProjectionRevision: clock.revision,
    });
    return privateJson({ ok: true, result }, result.replayed ? 200 : 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/required|must|current farm day|outside|idempotency/i.test(message)) {
      return atlasApiError(400, "invalid_worker_activity", message || "Atlas could not validate this work log.");
    }
    console.error("Atlas worker activity write failed:", error);
    return atlasApiError(500, "worker_activity_write_failed", "Atlas could not save this work log. Your sentence has not been discarded.");
  }
}

export async function DELETE(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch (error) {
    return atlasApiError(400, "invalid_json_body", error instanceof Error ? error.message : "Invalid Atlas request.");
  }
  const activityLogId = typeof body.activityLogId === "string" ? body.activityLogId : null;
  if (!activityLogId || !UUID.test(activityLogId)) {
    return atlasApiError(400, "invalid_worker_activity_id", "A valid work-log id is required.");
  }
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  try {
    await retractWorkerActivity(activityLogId);
    return privateJson({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/not found|not editable|permission/i.test(message)) {
      return atlasApiError(403, "worker_activity_not_editable", "This work log cannot be changed by the current member.");
    }
    return atlasApiError(500, "worker_activity_retract_failed", "Atlas could not undo this work log.");
  }
}
