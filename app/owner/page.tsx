import { getOwnerDashboard } from "@/lib/atlas-data/owner-dashboard";
import { readOwnerFinishProjectSummary } from "@/lib/atlas-data/owner-finish-project";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import OwnerDashboardClient from "./OwnerDashboardClient";

export const dynamic = "force-dynamic";

export default async function AtlasOwnerPage() {
  const access = await requireAtlasRole(["owner"]);
  const [dashboard, finishProject] = await Promise.all([
    getOwnerDashboard(access),
    readOwnerFinishProjectSummary().catch(() => null),
  ]);

  return <OwnerDashboardClient dashboard={dashboard} finishProject={finishProject} />;
}
