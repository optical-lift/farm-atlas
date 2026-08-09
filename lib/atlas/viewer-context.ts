import "server-only";

import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import {
  atlasPortalViewerFromSession,
  atlasUniversalViewerFromSession,
  atlasViewerFromSession,
  type AtlasPortalViewer,
  type AtlasUniversalViewer,
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

export async function requireAtlasUniversalViewer(): Promise<AtlasUniversalViewer> {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const viewer = atlasUniversalViewerFromSession(session);
  if (!viewer) redirect("/auth/error?reason=membership_required");

  return viewer;
}
