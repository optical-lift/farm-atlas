import { atlasSupabase } from "@/lib/atlas/supabase-server";

export type OwnerWeekProjectionItem = {
  id: string;
  plannedDate: string;
  sourceKind: "task" | "project_pull" | "queue" | "rhythm";
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
  days: OwnerWeekProjectionDay[];
};

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function readOwnerWeekProjection(
  farmId: string,
  membershipId: string,
  startDate: string,
  dayCount = 7,
): Promise<OwnerWeekProjection> {
  const safeDayCount = Math.max(1, Math.min(dayCount, 14));
  const endDate = addDays(startDate, safeDayCount - 1);

  await atlasSupabase.schema("atlas").rpc("refresh_owner_week_projection_v1", {
    p_farm_id: farmId,
    p_membership_id: membershipId,
    p_start_date: startDate,
    p_days: safeDayCount,
  });

  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("owner_week_projection")
    .select("id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason")
    .eq("farm_id", farmId)
    .eq("membership_id", membershipId)
    .gte("planned_date", startDate)
    .lte("planned_date", endDate)
    .order("planned_date", { ascending: true })
    .order("source_kind", { ascending: true })
    .order("title", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
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

  return { farmId, membershipId, startDate, endDate, days };
}
