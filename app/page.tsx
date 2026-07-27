import { redirect } from "next/navigation";

import AtlasUniversalHome from "@/components/atlas/home/AtlasUniversalHome";
import { getAtlasSession } from "@/lib/atlas/session";
import { readAtlasUniversalHome } from "@/lib/atlas/universal-home";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";

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

  const viewer = atlasUniversalViewerFromSession(session);
  if (!viewer) redirect("/auth/error?reason=membership_required");

  const params: AtlasHomeSearchParams = searchParams ? await searchParams : {};
  const selectedFarmKey = firstParam(params.farm);
  const selectedWorkstream = firstParam(params.workstream);
  const preferredFarmId = selectedFarmKey
    ? viewer.farmMemberships.find((membership) => membership.farmKey === selectedFarmKey)?.farmId
      ?? viewer.activeFarmId
    : viewer.activeFarmId;
  const home = await readAtlasUniversalHome(viewer, { preferredFarmId });

  return (
    <AtlasUniversalHome
      home={home}
      selectedFarmKey={selectedFarmKey}
      selectedWorkstream={selectedWorkstream}
    />
  );
}
