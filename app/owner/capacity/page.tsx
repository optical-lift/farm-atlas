import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import PrincipalCapacityClient from "./PrincipalCapacityClient";

export const dynamic = "force-dynamic";

export default async function PrincipalCapacityPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  return <PrincipalCapacityClient />;
}
