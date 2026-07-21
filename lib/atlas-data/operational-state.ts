import { buildFarmOperationalState } from "@/lib/atlas/operational-state-core.js";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type FarmOperationalState = ReturnType<typeof buildFarmOperationalState>;

const OPERATIONAL_STATE_COLUMNS = [
  "farm_id",
  "farm_key",
  "farm_name",
  "zone_id",
  "zone_key",
  "zone_label",
  "zone_sort_order",
  "object_id",
  "object_key",
  "object_label",
  "object_type",
  "object_mode",
  "object_sort_order",
  "length_ft",
  "width_ft",
  "area_sqft",
  "guest_visible",
  "life_status",
  "weed_pressure",
  "water_status",
  "presentability",
  "decision_required",
  "harvest_confidence",
  "last_action_date",
  "last_action_label",
  "current_crop_cycle_id",
  "crop_cycle_key",
  "crop_label",
  "variety",
  "crop_stage",
  "crop_lifecycle_status",
  "sown_date",
  "planted_date",
  "expected_germination_start",
  "expected_germination_end",
  "expected_harvest_watch_start",
  "expected_harvest_watch_end",
  "expected_clear_date",
  "current_stage",
  "next_task_id",
  "next_action",
  "next_task_status",
  "next_action_due",
  "next_work_class",
  "next_task_visibility",
  "assigned_membership_id",
  "blocker",
  "next_maintenance_type",
  "next_maintenance_condition",
  "next_maintenance_date",
  "maintenance_due_count",
  "next_maintenance_due",
  "max_maintenance_priority",
  "max_maintenance_risk",
  "next_action_source",
  "risk_level",
].join(", ");

function requireOperationsAccess(access: AtlasRoleAccess) {
  if (access.membership.role !== "owner" && access.membership.role !== "manager") {
    throw new Error("Owner or Manager membership required.");
  }
}

async function readOperationalRows(access: AtlasRoleAccess, zoneKey?: string) {
  requireOperationsAccess(access);

  const supabase = await createAtlasServerClient();
  let query = supabase
    .from("v_farm_object_operational_state")
    .select(OPERATIONAL_STATE_COLUMNS)
    .eq("farm_id", access.membership.farmId)
    .order("zone_sort_order", { ascending: true })
    .order("object_sort_order", { ascending: true })
    .order("object_label", { ascending: true });

  if (zoneKey) {
    query = query.eq("zone_key", zoneKey);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error("Atlas operational-state read failed.");
  }

  return data ?? [];
}

export async function getFarmOperationalState(
  access: AtlasRoleAccess,
): Promise<FarmOperationalState> {
  return buildFarmOperationalState(await readOperationalRows(access));
}

export async function getZoneOperationalState(
  access: AtlasRoleAccess,
  zoneKey: string,
): Promise<FarmOperationalState> {
  const normalizedZoneKey = zoneKey.trim();
  if (!normalizedZoneKey) {
    throw new Error("Zone key required.");
  }

  return buildFarmOperationalState(
    await readOperationalRows(access, normalizedZoneKey),
  );
}
