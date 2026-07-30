import { redirect } from "next/navigation";

import AtlasBellCover from "@/components/atlas/home/AtlasBellCover";
import AtlasUniversalHome from "@/components/atlas/home/AtlasUniversalHome";
import {
  effectiveOperatorAccountId,
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasOperatorJournalCover } from "@/lib/atlas/operator-journal-cover";
import { readAtlasOperatorUniversalHome } from "@/lib/atlas/operator-universal-home";
import { getAtlasSession } from "@/lib/atlas/session";
import { readAtlasSetAsideTaskIds } from "@/lib/atlas/task-day-dispositions-server";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";

// readAtlasOperatorUniversalHome delegates to readAtlasUniversalHome outside Owner operator mode.
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

function focusedProjectTaskHref(move: Awaited<ReturnType<typeof readAtlasOperatorUniversalHome>>["moves"][number]) {
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

  const [params, operatorContext] = await Promise.all([
    searchParams ? searchParams : Promise.resolve({} as AtlasHomeSearchParams),
    readAtlasOwnerOperatorContext(),
  ]);
  const selectedFarmKey = firstParam(params.farm);
  const selectedWorkstream = firstParam(params.workstream);
  const preferredFarmId = selectedFarmKey
    ? viewer.farmMemberships.find((membership) => membership.farmKey === selectedFarmKey)?.farmId
      ?? viewer.activeFarmId
    : viewer.activeFarmId;
  const home = await readAtlasOperatorUniversalHome(viewer, {
    preferredFarmId,
    effectiveAccountId: effectiveOperatorAccountId(operatorContext),
    effectiveMembershipId: effectiveOperatorMembershipId(operatorContext),
  });

  let setAsideTaskIds = new Set<string>();
  try {
    setAsideTaskIds = await readAtlasSetAsideTaskIds(home.window.doneDate);
  } catch {
    setAsideTaskIds = new Set<string>();
  }

  const visibleFarms = home.farms.map((farm) => ({
    ...farm,
    taskCards: farm.taskCards.filter((task) => !setAsideTaskIds.has(task.task_id)),
  }));
  const visibleActiveFarm = home.activeFarm
    ? visibleFarms.find((farm) => farm.farmId === home.activeFarm?.farmId) ?? home.activeFarm
    : null;
  const visibleHome = {
    ...home,
    farms: visibleFarms,
    activeFarm: visibleActiveFarm,
    moves: home.moves.filter((move) => {
      if (move.kind !== "farm_task") return true;
      const taskId = move.key.split(":").at(-1) ?? "";
      return !setAsideTaskIds.has(taskId);
    }),
  };

  const coverMoves = await readAtlasOperatorJournalCover(visibleHome);
  const renderedViewer = visibleHome.viewer;
  const organizationMembership = organizationMembershipForViewer(renderedViewer);
  const organizationPortal = Boolean(
    organizationMembership
      && (organizationMembership.role === "owner" || renderedViewer.farmMemberships.length === 0),
  );
  const renderedHome = {
    ...visibleHome,
    title: organizationPortal
      ? home.organizationHome?.organization.name
        || organizationMembership?.organizationName
        || "Feast Guild"
      : visibleHome.title,
    moves: coverMoves.map((move) => ({ ...move, href: focusedProjectTaskHref(move) })),
  };

  return (
    <>
      <AtlasUniversalHome
        home={renderedHome}
        selectedFarmKey={selectedFarmKey}
        selectedWorkstream={selectedWorkstream}
      />
      {renderedHome.activeFarm ? <AtlasBellCover /> : null}
    </>
  );
}
