import { redirect } from "next/navigation";

import AtlasUniversalHome from "@/components/atlas/home/AtlasUniversalHome";
import { readAtlasJournalCover } from "@/lib/atlas/journal-cover-home";
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

function organizationMembershipForViewer(
  viewer: NonNullable<ReturnType<typeof atlasUniversalViewerFromSession>>,
) {
  return viewer.organizationMemberships.find(
    (membership) => membership.organizationId === viewer.activeOrganizationId,
  ) ?? viewer.organizationMemberships[0] ?? null;
}

function focusedProjectTaskHref(move: Awaited<ReturnType<typeof readAtlasUniversalHome>>["moves"][number]) {
  if (move.kind !== "project_task" || !move.projectId) return move.href;
  const taskId = move.key.split(":").at(-1);
  if (!taskId) return move.href;
  return `/project/${encodeURIComponent(move.projectId)}?taskId=${encodeURIComponent(taskId)}#project-work`;
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
  const coverMoves = await readAtlasJournalCover(home);
  const organizationMembership = organizationMembershipForViewer(viewer);
  const organizationPortal = Boolean(
    organizationMembership
      && (organizationMembership.role === "owner" || viewer.farmMemberships.length === 0),
  );
  const renderedHome = {
    ...home,
    title: organizationPortal
      ? home.organizationHome?.organization.name
        || organizationMembership?.organizationName
        || "Feast Guild"
      : home.title,
    moves: coverMoves.map((move) => ({ ...move, href: focusedProjectTaskHref(move) })),
  };

  return (
    <AtlasUniversalHome
      home={renderedHome}
      selectedFarmKey={selectedFarmKey}
      selectedWorkstream={selectedWorkstream}
    />
  );
}
