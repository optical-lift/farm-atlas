import CanonicalScheduleView from "@/components/atlas/CanonicalScheduleView";
import { getMonthSchedule } from "@/lib/atlas-data/task-schedule";
import { centralDateIso, isIsoDate, monthBoundsIso, prettyFarmDate } from "@/lib/atlas/date";
import { requireAtlasRole } from "@/lib/atlas/role-access";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function monthTitle(dateIso: string) {
  return new Date(`${dateIso}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

export default async function AtlasMonthOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedDate = firstValue(params.date);
  const anchorDate = isIsoDate(requestedDate) ? requestedDate : centralDateIso();
  const bounds = monthBoundsIso(anchorDate);
  const access = await requireAtlasRole(["owner", "manager"]);
  const schedule = await getMonthSchedule(access, bounds.start, bounds.end);

  return (
    <CanonicalScheduleView
      mode="month"
      title={monthTitle(anchorDate)}
      subtitle={`${prettyFarmDate(bounds.start)}–${prettyFarmDate(bounds.end)}`}
      schedule={schedule}
      role={access.membership.role}
    />
  );
}
