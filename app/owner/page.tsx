import type { Viewport } from "next";
import { Source_Sans_3 } from "next/font/google";

import { getAtlasSession } from "@/lib/atlas/session";
import OwnerPortalBrandMockup from "./OwnerPortalBrandMockup";

export const dynamic = "force-dynamic";

const atlasStructural = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-atlas-structural",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default async function AtlasOwnerPage() {
  const session = await getAtlasSession();
  return (
    <div className={atlasStructural.variable}>
      <OwnerPortalBrandMockup personName={session?.displayName?.trim() || "Atlas"} />
    </div>
  );
}
