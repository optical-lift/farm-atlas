import { getAtlasSession } from "@/lib/atlas/session";
import OwnerPersonAtlasFixture from "./OwnerPersonAtlasFixture";

export const dynamic = "force-dynamic";

export default async function AtlasOwnerPage() {
  const session = await getAtlasSession();
  return <OwnerPersonAtlasFixture personName={session?.displayName?.trim() || "Atlas"} />;
}
