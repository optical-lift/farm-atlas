import "server-only";

import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import { atlasViewerFromSession, type AtlasViewer } from "@/lib/atlas/viewer";

export async function requireAtlasViewer(): Promise<AtlasViewer> {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const viewer = atlasViewerFromSession(session);
  if (!viewer) redirect("/auth/error");

  return viewer;
}
