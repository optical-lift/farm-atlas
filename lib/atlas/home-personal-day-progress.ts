import "server-only";

import type { AtlasUniversalHomeModel } from "@/lib/atlas/universal-home";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasPersonalDayProgress = {
  dealtCount: number;
  openCount: number;
  plannedTotal: number;
  carryForwardCount: number;
};

type PersonalTaskRow = {
  id: string;
  farm_id: string | null;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  updated_at: string | null;
  assigned_membership_id: string | null;
  assigned_user_id: string | null;
  parent_task_id: string | null;
  metadata: unknown;
};

function normalized(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replaceAll(" ", "_")
    : "";
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metadataStrings(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  }
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "true" || value === "yes";
}

function isDisplayTask(row: PersonalTaskRow) {
  const metadata = metadataRecord(row.metadata);
  return !row.parent_task_id
    && !truthy(metadata.is_child_task)
    && !truthy(metadata.hide_from_home_hero)
    && !truthy(metadata.quiet_task)
    && normalized(metadata.checklist_status) !== "archived";
}

function chicagoDateIso(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function isPersonalTask(
  row: PersonalTaskRow,
  viewerUserId: string,
  membershipIds: Set<string>,
  workerKeys: Set<string>,
) {
  if (row.assigned_user_id === viewerUserId) return true;
  if (row.assigned_membership_id && membershipIds.has(row.assigned_membership_id)) return true;

  const metadata = metadataRecord(row.metadata);
  if (metadataStrings(metadata, "shared_with_membership_ids").some((id) => membershipIds.has(id))) {
    return true;
  }
  if (metadataStrings(metadata, "shared_with_worker_keys").some((key) => workerKeys.has(normalized(key)))) {
    return true;
  }

  const assignee = normalized(
    metadata.assignee_key
      ?? metadata.assigned_to
      ?? metadata.work_route,
  );
  return Boolean(assignee && workerKeys.has(assignee));
}

/**
 * Portfolio Home intentionally removes completed cards from the active task feed.
 * Read today's personal completion evidence separately so the purple hero retains
 * a stable denominator after work is finished.
 */
export async function readAtlasPersonalDayProgress(
  home: AtlasUniversalHomeModel,
): Promise<AtlasPersonalDayProgress | null> {
  const farmIds = [...new Set(home.farms.map((farm) => farm.farmId).filter(Boolean))];
  if (farmIds.length === 0) return null;

  const membershipIds = new Set<string>();
  const workerKeys = new Set<string>();
  home.viewer.farmMemberships.forEach((membership) => {
    membershipIds.add(membership.membershipId);
    if (membership.workerKey) workerKeys.add(normalized(membership.workerKey));
    if (membership.role === "owner") workerKeys.add("owner");
  });

  try {
    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase
      .from("tasks")
      .select("id,farm_id,status,due_date,completed_at,updated_at,assigned_membership_id,assigned_user_id,parent_task_id,metadata")
      .in("farm_id", farmIds)
      .in("status", ["open", "blocked", "done"])
      .lte("due_date", home.window.doneDate);

    if (error) throw error;

    const seen = new Set<string>();
    let dealtCount = 0;
    let openCount = 0;
    let carryForwardCount = 0;

    for (const rawRow of data ?? []) {
      const row = rawRow as PersonalTaskRow;
      if (seen.has(row.id) || !isDisplayTask(row)) continue;
      if (!isPersonalTask(row, home.viewer.userId, membershipIds, workerKeys)) continue;
      seen.add(row.id);

      if ((row.status === "open" || row.status === "blocked") && row.due_date === home.window.doneDate) {
        openCount += 1;
      } else if ((row.status === "open" || row.status === "blocked") && row.due_date && row.due_date < home.window.doneDate) {
        carryForwardCount += 1;
      } else if (
        row.status === "done"
        && row.due_date === home.window.doneDate
        && chicagoDateIso(row.completed_at ?? row.updated_at) === home.window.doneDate
      ) {
        dealtCount += 1;
      }
    }

    return {
      dealtCount,
      openCount,
      plannedTotal: dealtCount + openCount,
      carryForwardCount,
    };
  } catch {
    return null;
  }
}
