import { getOwnerMyWork } from "@/lib/atlas-data/owner-my-work";
import { readOwnerFinishProjectSummary } from "@/lib/atlas-data/owner-finish-project";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import OwnerDashboardClient from "./OwnerDashboardClient";

export const dynamic = "force-dynamic";

export default async function AtlasOwnerPage() {
  const access = await requireAtlasRole(["owner"]);
  const [myWork, finishProject] = await Promise.all([
    getOwnerMyWork(access),
    readOwnerFinishProjectSummary().catch(() => null),
  ]);

  return (
    <OwnerDashboardClient
      myWork={myWork}
      finishProject={finishProject}
    />
  );
}
