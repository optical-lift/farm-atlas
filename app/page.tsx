import { redirect } from "next/navigation";

import AtlasHomePortal from "@/components/atlas/home/AtlasHomePortal";
import FeastGuildPortfolioHome from "@/components/atlas/portfolio/FeastGuildPortfolioHome";
import { readAtlasPortfolioHome } from "@/lib/atlas/portfolio";
import { getAtlasSession } from "@/lib/atlas/session";
import { atlasPortalViewerFromSession, atlasViewerFromSession } from "@/lib/atlas/viewer";

export const dynamic = "force-dynamic";

type AtlasHomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function AtlasHomePage({ searchParams }: AtlasHomePageProps) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const portalViewer = atlasPortalViewerFromSession(session);
  if (portalViewer) {
    const [portfolio, params] = await Promise.all([
      readAtlasPortfolioHome(portalViewer.organizationId),
      searchParams ?? Promise.resolve({}),
    ]);

    return (
      <FeastGuildPortfolioHome
        viewer={portalViewer}
        portfolio={portfolio}
        selectedFarm={firstParam(params.farm)}
        selectedWorkstream={firstParam(params.workstream)}
      />
    );
  }

  const viewer = atlasViewerFromSession(session);
  if (!viewer) redirect("/auth/error?reason=membership_required");
  return <AtlasHomePortal viewer={viewer} />;
}
