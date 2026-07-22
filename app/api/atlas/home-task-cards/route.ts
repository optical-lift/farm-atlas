import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// The shared home, day, week, and month surfaces all use this membership-scoped reader.
type RpcError = { code?: string };
type AtlasTaskCardRow = { task_id: string; [key: string]: unknown };

function centralDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "home-membership-v2",
    },
  });
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const workerKey = authorized.access.membership.workerKey?.trim().toLowerCase() || null;
  if (!workerKey) {
    return privateJson({ ok: false, error: "The signed-in farm membership does not have an Atlas worker identity." }, 409);
  }

  const url = new URL(request.url);
  const requestedDueThrough = url.searchParams.get("dueThrough");
  const requestedDoneDate = url.searchParams.get("doneDate");

  if (requestedDueThrough && !validDateIso(requestedDueThrough)) {
    return privateJson({ ok: false, error: "dueThrough must be a valid YYYY-MM-DD date." }, 400);
  }
  if (requestedDoneDate && !validDateIso(requestedDoneDate)) {
    return privateJson({ ok: false, error: "doneDate must be a valid YYYY-MM-DD date." }, 400);
  }

  const today = centralDateIso();
  const rangeEnd = requestedDueThrough ?? addDaysIso(today, 35);
  const doneDate = requestedDoneDate ?? today;
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("home_task_cards_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_worker_key: workerKey,
    p_due_through: rangeEnd,
    p_done_date: doneDate,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "Farm access is not active." }, 403);
    }
    if (rpcError.code === "P0002") {
      return privateJson({ ok: false, error: "The signed-in Atlas worker identity was not found." }, 404);
    }
    console.error("Atlas homepage task read failed:", error);
    return privateJson({ ok: false, error: "Atlas homepage task read failed." }, 500);
  }

  return privateJson({
    ok: true,
    farmKey: authorized.access.membership.farmKey ?? "elm_farm",
    role: authorized.access.membership.role,
    viewer: {
      membershipId: authorized.access.membership.membershipId,
      workerKey,
      role: authorized.access.membership.role,
    },
    taskCards: (data ?? []) as AtlasTaskCardRow[],
    window: { today, rangeEnd, doneDate },
  });
}
