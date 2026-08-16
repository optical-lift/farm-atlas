import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import PrincipalOwnerObligationsClient from "./PrincipalOwnerObligationsClient";

export const dynamic = "force-dynamic";

export default async function PrincipalOwnerObligationsPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  return <PrincipalOwnerObligationsClient />;
}
