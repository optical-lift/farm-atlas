import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";
import { resolveOwnerWorkerDayPlanningTarget } from "@/lib/atlas/worker-day-plan-server";

export const dynamic = "force-dynamic";

function validDateIso(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validDuration(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 5 && Number(value) <= 720);
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Mutation": "owner-clock-duration-v1",
    },
  });
}

export async function POST(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  if (request.headers.get("x-atlas-intent") !== "owner-clock-duration-v1") {
    return privateJson({ ok: false, error: "Explicit Clock duration intent is required." }, 409);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return privateJson({ ok: false, error: "Clock duration body must be valid JSON." }, 400);
  }

  const date = body.date;
  const taskId = body.taskId;
  const durationMinutes = body.durationMinutes === "" ? null : body.durationMinutes;
  if (!validDateIso(date)) return privateJson({ ok: false, error: "date must be YYYY-MM-DD." }, 400);
  if (!isUuid(taskId)) return privateJson({ ok: false, error: "A valid task ID is required." }, 400);
  if (!validDuration(durationMinutes)) return privateJson({ ok: false, error: "durationMinutes must be an integer from 5 to 720, or null." }, 400);

  const target = await resolveOwnerWorkerDayPlanningTarget();
  if (!target) return privateJson({ ok: false, error: "Owner worker-day planning access is required." }, 403);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_set_worker_day_task_duration_api_v1", {
    p_farm_id: target.farmId,
    p_membership_id: target.membershipId,
    p_task_id: taskId,
    p_day: date,
    p_duration_minutes: durationMinutes,
  });

  if (error) {
    const status = error.code === "42501" ? 403
      : error.code === "22023" ? 400
        : error.code === "55000" ? 409
          : 500;
    console.error("Atlas Clock duration update failed:", error);
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not update this Clock duration." : error.message }, status);
  }

  return privateJson({ ok: true, date, taskId, placement: data });
}
