import { redirect } from "next/navigation";

import { readPrincipalSelfContext } from "@/lib/atlas-data/principal-context";
import { getAtlasSession } from "@/lib/atlas/session";
import PrincipalDashboard from "./PrincipalDashboard";

export const dynamic = "force-dynamic";

export default async function AtlasOwnerPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const context = await readPrincipalSelfContext();
  return <PrincipalDashboard context={context} />;
}
