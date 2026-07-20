import { redirect } from "next/navigation";

import { getAtlasIdentity } from "@/lib/atlas-auth";
import OwnerDashboardClient from "./OwnerDashboardClient";

export default async function AtlasOwnerPage() {
  const identity = await getAtlasIdentity();
  const isOwner = identity?.memberships.some(
    (membership) => membership.active && membership.role === "owner" && membership.farm?.stable_key === "elm_farm",
  );

  if (!isOwner) redirect("/");
  return <OwnerDashboardClient />;
}
