import ManagerDaySurface, { atlasManagerDayTaskSort } from "@/components/atlas/manage/ManagerDaySurface";
import { requireAtlasEffectiveManagementAccess } from "@/lib/atlas/effective-management-access";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type FarmDayPageProps = { searchParams: Promise<{ date?: string | string[] }> };

function centralDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validDateIso(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export default async function FarmDayPage({ searchParams }: FarmDayPageProps) {
  const access = await requireAtlasEffectiveManagementAccess();
  const params = await searchParams;
  const requestedDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const dateIso = validDateIso(requestedDate) ? requestedDate : centralDateIso();
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("farm_day_task_cards_v1", { p_farm_id: access.farmId, p_work_date: dateIso });
  const tasks = error ? [] : ((data ?? []) as AtlasTaskCard[]).sort(atlasManagerDayTaskSort);
  return <ManagerDaySurface farmName={access.farmName} dateIso={dateIso} tasks={tasks} error={Boolean(error)} />;
}
