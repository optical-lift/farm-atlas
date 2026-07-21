import CanonicalScheduleView from "@/components/atlas/CanonicalScheduleView";
import { getDaySchedule } from "@/lib/atlas-data/task-schedule";
import { centralDateIso, isIsoDate, prettyFarmDate } from "@/lib/atlas/date";
import { requireAtlasRole } from "@/lib/atlas/role-access";

export const dynamic = "force-dynamic";

const ROUTE_KEYS = new Set([
  "weed",
  "mow",
  "sow",
  "plant",
  "harvest",
  "water",
  "care",
  "maintain",
  "other",
]);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AtlasDayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedDate = firstValue(params.date);
  const dateIso = isIsoDate(requestedDate) ? requestedDate : centralDateIso();
  const requestedRoute = firstValue(params.route);
  const routeFilter = requestedRoute && ROUTE_KEYS.has(requestedRoute) ? requestedRoute : null;
  const access = await requireAtlasRole(["owner", "manager"]);
  const schedule = await getDaySchedule(access, dateIso);

  return (
    <CanonicalScheduleView
      mode="day"
      title={routeFilter ? `${prettyFarmDate(dateIso, true)} · ${requestedRoute}` : prettyFarmDate(dateIso, true)}
      subtitle={prettyFarmDate(dateIso)}
      schedule={schedule}
      role={access.membership.role}
      routeFilter={routeFilter}
    />
  );
}
