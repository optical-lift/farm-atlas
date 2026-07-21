import CanonicalScheduleView from "@/components/atlas/CanonicalScheduleView";
import { getTaskSchedule } from "@/lib/atlas-data/task-schedule";
import { addDaysIso, centralDateIso, isIsoDate, prettyFarmDate } from "@/lib/atlas/date";
import { requireAtlasRole } from "@/lib/atlas/role-access";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AtlasWeekOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedDate = firstValue(params.date);
  const startDate = isIsoDate(requestedDate) ? requestedDate : centralDateIso();
  const requestedEnd = firstValue(params.end);
  const maximumEnd = addDaysIso(startDate, 30);
  const endDate = isIsoDate(requestedEnd) && requestedEnd >= startDate && requestedEnd <= maximumEnd
    ? requestedEnd
    : addDaysIso(startDate, 6);

  const access = await requireAtlasRole(["owner", "manager"]);
  const schedule = await getTaskSchedule(access, {
    startDate,
    endDate,
    includeOverdue: true,
    includeUndated: false,
  });

  return (
    <CanonicalScheduleView
      mode="week"
      title={requestedEnd ? "Work Week" : "This Week"}
      subtitle={`${prettyFarmDate(startDate)}–${prettyFarmDate(endDate)}`}
      schedule={schedule}
      role={access.membership.role}
    />
  );
}
