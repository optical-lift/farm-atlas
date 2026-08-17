import { redirect } from "next/navigation";

import PrincipalCapacityPolicyForm from "@/components/atlas/principal/PrincipalCapacityPolicyForm";
import { readAtlasPrincipalSelfContext } from "@/lib/atlas/principal-self-context";
import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

export default async function PrincipalCapacityPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");
  if (!session.organizationMemberships.some((membership) => membership.role === "owner")) redirect("/");

  const context = await readAtlasPrincipalSelfContext();
  const timezone = context.principal?.homeTimezone || "America/Chicago";

  return <PrincipalCapacityPolicyForm timezone={timezone} />;
}
