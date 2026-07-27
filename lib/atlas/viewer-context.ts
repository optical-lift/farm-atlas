import "server-only";

import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import {
  atlasPortalViewerFromSession,
  atlasViewerFromSession,
  type AtlasPortalViewer,
  type AtlasViewer,
} from "@/lib/atlas/viewer";

export async function requireAtlasViewer(): Promise<AtlasViewer> {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const viewer = atlasViewerFromSession(session);
  if (!viewer) redirect("/auth/error?reason=farm_membership_required");

  return viewer;
}

export async function requireAtlasPortalViewer(): Promise<AtlasPortalViewer> {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const viewer = atlasPortalViewerFromSession(session);
  if (!viewer) redirect("/auth/error?reason=portfolio_membership_required");

  return viewer;
}
