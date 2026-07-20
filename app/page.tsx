import { redirect } from "next/navigation";

import { getAtlasIdentity } from "@/lib/atlas-auth";

export const dynamic = "force-dynamic";

export default async function AtlasRootPage() {
  const identity = await getAtlasIdentity();

  if (!identity) redirect("/login");

  const elmMembership = identity.memberships.find(
    (membership) => membership.active && membership.farm?.stable_key === "elm_farm",
  );

  if (!elmMembership) redirect("/login");
  if (elmMembership.role === "owner") redirect("/owner");
  if (elmMembership.role === "manager") redirect("/marshall");

  redirect(`/day?date=${new Date().toISOString().slice(0, 10)}`);
}
