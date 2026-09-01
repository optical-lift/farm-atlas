import type { Viewport } from "next";

import { getAtlasSession } from "@/lib/atlas/session";
import OwnerNotebookSpread from "./OwnerNotebookSpread";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default async function AtlasOwnerPage() {
  const session = await getAtlasSession();
  return <OwnerNotebookSpread personName={session?.displayName?.trim() || "Atlas"} />;
}
