import { NextRequest, NextResponse } from "next/server";

import { getAtlasIdentity } from "@/lib/atlas-auth";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type AtlasTaskCardRow = {
  task_id: string;
  metadata: JsonRecord | null;
  [key: string]: unknown;
};

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function boolish(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === 1;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isWorkerTask(card: AtlasTaskCardRow, workerKey: string | null) {
  if (!workerKey) return false;

  const metadata = card.metadata ?? {};
  const assignedTo = textValue(metadata.assigned_to);
  const collectionZone = textValue(metadata.collection_zone);
  const normalizedWorker = workerKey.trim().toLowerCase();

  const privateTask =
    boolish(metadata.owner_task) ||
    boolish(metadata.marshall_task) ||
    boolish(metadata.children_task) ||
    assignedTo === "owner" ||
    assignedTo === "marshall" ||
    assignedTo === "children" ||
    assignedTo === "kids" ||
    collectionZone === "owner" ||
    collectionZone === "marshall" ||
    collectionZone === "children" ||
    collectionZone === "kids";

  if (privateTask) return false;
  return assignedTo === normalizedWorker || boolish(metadata[`${normalizedWorker}_task`]);
}

export async function GET(request: NextRequest) {
  const identity = await getAtlasIdentity();
  if (!identity) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }

  const membership = identity.memberships.find(
    (item) => item.active && item.farm?.stable_key === "elm_farm",
  );
  if (!membership) {
    return NextResponse.json({ ok: false, error: "Farm access is not active." }, { status: 403 });
  }

  const taskId = request.nextUrl.searchParams.get("taskId")?.trim() || null;
  if (taskId && !isUuid(taskId)) {
    return NextResponse.json({ ok: false, error: "A valid task ID is required." }, { status: 400 });
  }

  let query = atlasSupabase
    .schema("atlas")
    .from("v_task_cards")
    .select("*")
    .eq("farm_key", "elm_farm")
    .neq("status", "archived")
    .order("due_date", { ascending: true });

  if (taskId) query = query.eq("task_id", taskId);

  const { data, error } = await query;
  if (error) {
    console.error("Atlas task cards read failed:", error);
    return NextResponse.json({ ok: false, error: "Atlas task cards read failed." }, { status: 500 });
  }

  const rows = (data ?? []) as AtlasTaskCardRow[];
  const taskCards = membership.role === "owner" || membership.role === "manager"
    ? rows
    : rows.filter((card) => isWorkerTask(card, membership.worker_key));

  if (taskId && taskCards.length === 0) {
    return NextResponse.json({ ok: false, error: "Task not found." }, { status: 404 });
  }

  return NextResponse.json(
    {
      ok: true,
      farmKey: "elm_farm",
      role: membership.role,
      taskCards,
    },
    { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
  );
}
