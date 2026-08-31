import type { Viewport } from "next";

import { getAtlasSession } from "@/lib/atlas/session";
import HouseholdCollectionFixture from "./HouseholdCollectionFixture";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default async function HouseholdCollectionPage() {
  const session = await getAtlasSession();
  return <HouseholdCollectionFixture personName={session?.displayName?.trim() || "Atlas"} />;
}
