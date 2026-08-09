import { atlasSupabase } from "@/lib/atlas/supabase-server";

export type OwnerWeekProjectionItem = {
  id: string;
  plannedDate: string;
  sourceKind: "task" | "floating_task" | "project_pull" | "queue" | "rhythm";
  sourceId: string;
  title: string;
  planState: "planned" | "conditional" | "flexible";
  environment: string | null;
  expectedActiveMinutes: number | null;
  reason: string | null;
};

export type OwnerWeekProjectionDay = {
  date: string;
  items: OwnerWeekProjectionItem[];
};

export type OwnerWeekProjection = {
  farmId: string;
  membershipId: string;
  startDate: string;
  endDate: string;
  paidTargetMinutes: number;
  days: OwnerWeekProjectionDay[];
};

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fallbackPaidTarget(role: string | null | undefined) {
  if (role === "farm_hand") return 420;
  if (role === "manager") return 360;
  return 480;
}

async function readProjection(
  farmId: string,
  membershipId: string,
  startDate: string,
  dayCount: number,
  refresh: boolean,
): Promise<OwnerWeekProjection> {
  const safeDayCount = Math.max(1, Math.min(dayCount, 14));
  const endDate = addDays(startDate, safeDayCount - 1);

  if (refresh) {
    const refreshResult = await atlasSupabase.schema("atlas").rpc("refresh_owner_week_projection_v1", {
      p_farm_id: farmId,
      p_membership_id: membershipId,
      p_start_date: startDate,
      p_days: safeDayCount,
    });
    if (refreshResult.error) throw new Error(refreshResult.error.message);
  }

  const [projectionResult, membershipResult, settingsResult] = await Promise.all([
    atlasSupabase
      .schema("atlas")
      .from("owner_week_projection")
      .select("id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason")
      .eq("farm_id", farmId)
      .eq("membership_id", membershipId)
      .gte("planned_date", startDate)
      .lte("planned_date", endDate)
      .order("planned_date", { ascending: true })
      .order("source_kind", { ascending: true })
      .order("title", { ascending: true }),
    atlasSupabase
      .schema("atlas")
      .from("farm_memberships")
      .select("role")
      .eq("farm_id", farmId)
      .eq("id", membershipId)
      .eq("active", true)
      .maybeSingle(),
    atlasSupabase
      .schema("atlas")
      .from("member_capacity_settings")
      .select("regular_target_minutes")
      .eq("farm_id", farmId)
      .eq("membership_id", membershipId)
      .eq("active", true)
      .maybeSingle(),
  ]);

  if (projectionResult.error) throw new Error(projectionResult.error.message);
  if (membershipResult.error) throw new Error(membershipResult.error.message);
  if (settingsResult.error) throw new Error(settingsResult.error.message);

  const rows = (projectionResult.data ?? []) as Array<{
    id: string;
    planned_date: string;
    source_kind: OwnerWeekProjectionItem["sourceKind"];
    source_id: string;
    title: string;
    plan_state: OwnerWeekProjectionItem["planState"];
    environment: string | null;
    expected_active_minutes: number | null;
    reason: string | null;
  }>;

  const paidTargetMinutes = Number(settingsResult.data?.regular_target_minutes)
    || fallbackPaidTarget(membershipResult.data?.role);

  const days: OwnerWeekProjectionDay[] = Array.from({ length: safeDayCount }, (_, index) => {
    const date = addDays(startDate, index);
    return {
      date,
      items: rows
        .filter((row) => row.planned_date === date)
        .map((row) => ({
          id: row.id,
          plannedDate: row.planned_date,
          sourceKind: row.source_kind,
          sourceId: row.source_id,
          title: row.title,
          planState: row.plan_state,
          environment: row.environment,
          expectedActiveMinutes: row.expected_active_minutes,
          reason: row.reason,
        })),
    };
  });

  return { farmId, membershipId, startDate, endDate, paidTargetMinutes, days };
}

export async function readOwnerWeekProjection(
  farmId: string,
  membershipId: string,
  startDate: string,
  dayCount = 7,
): Promise<OwnerWeekProjection> {
  return readProjection(farmId, membershipId, startDate, dayCount, true);
}

/**
 * Read the already-built planning ledger without recomputing it. Future Day
 * views use this path so looking ahead cannot mutate or erase tentative work.
 */
export async function readStoredOwnerWeekProjection(
  farmId: string,
  membershipId: string,
  startDate: string,
  dayCount = 7,
): Promise<OwnerWeekProjection> {
  return readProjection(farmId, membershipId, startDate, dayCount, false);
}
