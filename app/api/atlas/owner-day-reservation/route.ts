import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { resolveOwnerWorkerDayPlanningTarget } from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const operations = new Set(["create", "change", "move", "resize", "remove"]);

function validDateIso(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Mutation": "owner-day-reservation-v1",
    },
  });
}

export async function POST(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  if (request.headers.get("x-atlas-intent") !== "owner-day-reservation-v1") {
    return privateJson({ ok: false, error: "Explicit reservation intent is required." }, 409);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return privateJson({ ok: false, error: "Reservation command body must be valid JSON." }, 400);
  }

  const date = body.date;
  const reservationId = body.reservationId;
  const operation = body.operation;
  if (!validDateIso(date)) return privateJson({ ok: false, error: "date must be YYYY-MM-DD." }, 400);
  if (!isUuid(reservationId)) return privateJson({ ok: false, error: "A valid reservation ID is required." }, 400);
  if (typeof operation !== "string" || !operations.has(operation)) {
    return privateJson({ ok: false, error: "Reservation operation is invalid." }, 400);
  }

  const target = await resolveOwnerWorkerDayPlanningTarget();
  if (!target) return privateJson({ ok: false, error: "Owner worker-day planning access is required." }, 403);

  const command = { ...body };
  delete command.date;
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_command_day_reservation_api_v1", {
    p_farm_id: target.farmId,
    p_membership_id: target.membershipId,
    p_day: date,
    p_command: command,
  });

  if (error) {
    const status = error.code === "42501" ? 403
      : error.code === "22023" ? 400
        : error.code === "55000" ? 409
          : 500;
    console.error("Atlas reservation command failed:", error);
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not update this reservation." : error.message }, status);
  }

  return privateJson({ ok: true, date, reservationId, result: data });
}
