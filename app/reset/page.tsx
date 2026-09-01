import { redirect } from "next/navigation";

import AtlasProductReset from "@/app/AtlasProductReset";
import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

export default async function AtlasResetPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");
  if (session.email?.toLowerCase() !== "lexprjct@gmail.com") {
    redirect("/auth/error?reason=access_decommissioned");
  }

  return <AtlasProductReset />;
}
