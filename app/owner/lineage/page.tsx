import { notFound, redirect } from "next/navigation";

import { readAtlasLineageAudit } from "@/lib/atlas/lineage-audit";
import { getAtlasSession } from "@/lib/atlas/session";
import { atlasPortalViewerFromSession } from "@/lib/atlas/viewer";

import AtlasLineageAuditClient from "./AtlasLineageAuditClient";

export const dynamic = "force-dynamic";

export default async function AtlasOwnerLineagePage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const viewer = atlasPortalViewerFromSession(session);
  if (!viewer || !viewer.canManagePortfolio) notFound();

  const audit = await readAtlasLineageAudit(viewer.organizationId);
  return <AtlasLineageAuditClient initialAudit={audit} />;
}
