import { redirect } from "next/navigation";

import PrincipalSurface from "@/components/atlas/principal/PrincipalSurface";
import { readAtlasPrincipalSelfContext } from "@/lib/atlas/principal-self-context";
import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

export default async function AtlasPrincipalPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");
  if (!session.organizationMemberships.some((membership) => membership.role === "owner")) redirect("/");
  const context = await readAtlasPrincipalSelfContext();
  return <PrincipalSurface context={context} />;
}
