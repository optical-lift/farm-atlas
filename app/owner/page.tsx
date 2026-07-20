import { getOwnerDashboard } from "@/lib/atlas-data/owner-dashboard";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import OwnerDashboardClient from "./OwnerDashboardClient";

export const dynamic = "force-dynamic";

export default async function AtlasOwnerPage() {
  const access = await requireAtlasRole(["owner"]);
  const dashboard = await getOwnerDashboard(access);

  return <OwnerDashboardClient dashboard={dashboard} />;
}
