import type { Viewport } from "next";

import { readOwnerPrincipalDecisionProjection } from "@/lib/atlas/owner-principal-decisions";
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
  const [session, principalDecisions] = await Promise.all([
    getAtlasSession(),
    readOwnerPrincipalDecisionProjection(),
  ]);

  return (
    <OwnerNotebookSpread
      personName={session?.displayName?.trim() || "Atlas"}
      principalDecisions={principalDecisions}
    />
  );
}
