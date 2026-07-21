import { NextResponse } from "next/server";

import {
  atlasApiError,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { getTaskSchedule } from "@/lib/atlas-data/task-schedule";

export const dynamic = "force-dynamic";

function booleanParam(value: string | null) {
  return value === "true" || value === "1";
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const farmId = search.get("farmId");
  const startDate = search.get("startDate")?.trim() ?? "";
  const endDate = search.get("endDate")?.trim() ?? "";

  if (!startDate || !endDate) {
    return atlasApiError(
      400,
      "schedule_window_required",
      "Schedule start and end dates are required.",
    );
  }

  const authorized = await requireAtlasApiAccess({ farmId });
  if (!authorized.ok) return authorized.response;

  const targetMembershipId =
    authorized.access.membership.role === "farm_hand"
      ? null
      : search.get("targetMembershipId");

  try {
    const schedule = await getTaskSchedule(authorized.access, {
      startDate,
      endDate,
      includeOverdue: booleanParam(search.get("includeOverdue")),
      includeUndated: booleanParam(search.get("includeUndated")),
      targetMembershipId,
    });

    return NextResponse.json(
      { ok: true, schedule },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ISO date")) {
      return atlasApiError(
        400,
        "invalid_schedule_window",
        "Schedule dates must use YYYY-MM-DD.",
      );
    }

    return atlasApiError(
      500,
      "schedule_read_failed",
      "Atlas could not load the task schedule.",
    );
  }
}
