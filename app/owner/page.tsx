import type { Viewport } from "next";
import { Source_Sans_3 } from "next/font/google";

import { getAtlasSession } from "@/lib/atlas/session";
import OwnerNotebookSpread from "./OwnerNotebookSpread";

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
  themeColor: "#f7f3e9",
};

export default async function AtlasOwnerPage() {
  const session = await getAtlasSession();
  return (
    <div className={atlasStructural.variable}>
      <OwnerNotebookSpread personName={session?.displayName?.trim() || "Atlas"} />
    </div>
  );
}
