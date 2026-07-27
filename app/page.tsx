import { redirect } from "next/navigation";

import AtlasHomePortal from "@/components/atlas/home/AtlasHomePortal";
import FeastGuildPortfolioHome from "@/components/atlas/portfolio/FeastGuildPortfolioHome";
import { readAtlasPortfolioHome } from "@/lib/atlas/portfolio";
import { getAtlasSession } from "@/lib/atlas/session";
import { atlasPortalViewerFromSession, atlasViewerFromSession } from "@/lib/atlas/viewer";

export const dynamic = "force-dynamic";

type AtlasHomeSearchParams = Record<string, string | string[] | undefined>;

type AtlasHomePageProps = {
  searchParams?: Promise<AtlasHomeSearchParams>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function AtlasHomePage({ searchParams }: AtlasHomePageProps) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const portalViewer = atlasPortalViewerFromSession(session);
  if (portalViewer) {
    const params: AtlasHomeSearchParams = searchParams ? await searchParams : {};
    const portfolio = await readAtlasPortfolioHome(portalViewer.organizationId);

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
