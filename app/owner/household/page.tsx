import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import PrincipalHouseholdRhythmsClient from "./PrincipalHouseholdRhythmsClient";

export const dynamic = "force-dynamic";

export default async function PrincipalHouseholdPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  return <PrincipalHouseholdRhythmsClient />;
}
