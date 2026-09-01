import type { Viewport } from "next";

import type { OwnerPrincipalDecisionProjection } from "@/lib/atlas/owner-principal-decisions";
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

const NO_SESSION_DECISIONS: OwnerPrincipalDecisionProjection = {
  state: "principal_required",
  coverageState: "principal_required",
  coverageMode: "no_session",
  completeFieldClaim: false,
  items: [],
};

export default async function AtlasOwnerPage() {
  const session = await getAtlasSession();
  const principalDecisions = session
    ? await readOwnerPrincipalDecisionProjection()
    : NO_SESSION_DECISIONS;

  return (
    <OwnerNotebookSpread
      personName={session?.displayName?.trim() || "Atlas"}
      principalDecisions={principalDecisions}
    />
  );
}
