import { getOwnerDashboard } from "@/lib/atlas-data/owner-dashboard";
import { readOwnerFinishProjectSummary } from "@/lib/atlas-data/owner-finish-project";
import { readOwnerWeekProjection } from "@/lib/atlas-data/owner-week-projection";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import OwnerDashboardClient from "./OwnerDashboardClient";

export const dynamic = "force-dynamic";

export default async function AtlasOwnerPage() {
  const access = await requireAtlasRole(["owner"]);
  const dashboard = await getOwnerDashboard(access);
  const annaMembershipId = "23e98e5e-16ca-40d8-872c-c77e06baa167";
  const farmId = dashboard.farm.id;
  const weekStart = dashboard.generatedForDate;

  const [finishProject, weekProjection] = await Promise.all([
    readOwnerFinishProjectSummary().catch(() => null),
    farmId
      ? readOwnerWeekProjection(farmId, annaMembershipId, weekStart, 7).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <OwnerDashboardClient
      dashboard={dashboard}
      finishProject={finishProject}
      weekProjection={weekProjection}
    />
  );
}
