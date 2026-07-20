import { NextResponse } from "next/server";

import { getAtlasIdentity } from "@/lib/atlas-auth";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type TaskRow = {
  id: string;
  farm_id: string;
  zone_id: string | null;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  note: string | null;
  generated_from: string | null;
  generated_from_id: string | null;
  action_key: string | null;
  work_class: string | null;
  parent_task_id: string | null;
  task_series_key: string | null;
  engine_instance_key: string | null;
  created_at: string;
  updated_at: string;
  metadata: JsonRecord | null;
  zones: { stable_key: string; label: string } | Array<{ stable_key: string; label: string }> | null;
};

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function boolish(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === 1;
}

function isWorkerTask(row: TaskRow, workerKey: string | null) {
  if (!workerKey) return false;
  const metadata = row.metadata ?? {};
  const assignedTo = textValue(metadata.assigned_to);
  const collectionZone = textValue(metadata.collection_zone);
  const normalizedWorker = workerKey.trim().toLowerCase();
  const privateTask =
    boolish(metadata.owner_task) || boolish(metadata.marshall_task) || boolish(metadata.children_task) ||
    ["owner", "marshall", "children", "kids"].includes(assignedTo) ||
    ["owner", "marshall", "children", "kids"].includes(collectionZone);
  return !privateTask && (assignedTo === normalizedWorker || boolish(metadata[`${normalizedWorker}_task`]));
}

function zoneFor(row: TaskRow) {
  return Array.isArray(row.zones) ? row.zones[0] ?? null : row.zones;
}

function toCard(row: TaskRow) {
  const zone = zoneFor(row);
  return {
    farm_key: "elm_farm",
    task_id: row.id,
    title: row.title,
    task_type: row.task_type,
    status: row.status,
    priority: row.priority,
    due_date: row.due_date,
    unlock_text: row.unlock_text,
    blocker_text: row.blocker_text,
    note: row.note,
    generated_from: row.generated_from,
    generated_from_id: row.generated_from_id,
    action_key: row.action_key,
    work_class: row.work_class,
    parent_task_id: row.parent_task_id,
    task_series_key: row.task_series_key,
    engine_instance_key: row.engine_instance_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: row.metadata,
    zone_id: row.zone_id,
    zone_key: zone?.stable_key ?? null,
    zone_label: zone?.label ?? null,
    task_logs: [],
    task_outcomes: [],
    task_transitions: [],
    objects: [],
    resource_requirements: [],
    action_templates: [],
  };
}

export async function GET() {
  const identity = await getAtlasIdentity();
  if (!identity?.profile?.active) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }

  const membership = identity.memberships.find(
    (item) => item.active && item.farm?.stable_key === "elm_farm",
  );
  if (!membership) {
    return NextResponse.json({ ok: false, error: "Farm access is not active." }, { status: 403 });
  }

  const { data: farm, error: farmError } = await atlasSupabase.schema("atlas").from("farms").select("id").eq("stable_key", "elm_farm").single();
  if (farmError || !farm) return NextResponse.json({ ok: false, error: "Elm Farm was not found." }, { status: 500 });

  const fields = "id,farm_id,zone_id,title,task_type,status,priority,due_date,unlock_text,blocker_text,note,generated_from,generated_from_id,action_key,work_class,parent_task_id,task_series_key,engine_instance_key,created_at,updated_at,metadata,zones(stable_key,label)";
  const { data, error } = await atlasSupabase.schema("atlas").from("tasks").select(fields).eq("farm_id", farm.id).neq("status", "archived").order("due_date", { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ ok: false, error: "Atlas task list read failed." }, { status: 500 });

  const allRows = (data ?? []) as unknown as TaskRow[];
  const rows = membership.role === "owner"
    ? allRows
    : allRows.filter((row) => isWorkerTask(row, membership.worker_key));

  return NextResponse.json(
    { ok: true, farmKey: "elm_farm", role: membership.role, taskCards: rows.map(toCard) },
    { headers: { "Cache-Control": "private, max-age=0, must-revalidate", "X-Atlas-Read-Path": "task-list-membership-v1" } },
  );
}
