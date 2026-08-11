import { redirect } from "next/navigation";

import FarmHandQuickWinPrompt from "@/components/atlas/home/FarmHandQuickWinPrompt";
import AtlasHomeServerRefresh from "@/components/atlas/home/AtlasHomeServerRefresh";
import AtlasUniversalHome from "@/components/atlas/home/AtlasUniversalHomeV2";
import { AtlasPwaCoverPrompt } from "@/components/atlas/pwa/AtlasPwaSetup";
import { buildAtlasOwnerDailyHand } from "@/lib/atlas/daily-hand";
import { adaptiveHomeConveyorMoves } from "@/lib/atlas/adaptive-home-conveyor";
import { atlasFarmHandConveyorMoves, atlasFarmHandOutdoorEligibleNow } from "@/lib/atlas/farm-hand-conveyor-window";
import { withAtlasHomeCarryForward } from "@/lib/atlas/home-carry-forward";
import { readAtlasHomeFarmSeasonProfiles } from "@/lib/atlas/home-farm-seasons";
import { readAtlasPersonalDayProgress } from "@/lib/atlas/home-personal-day-progress";
import { readAtlasOperatorHomeTaskOverview } from "@/lib/atlas/home-task-overview";
import {
  effectiveOperatorAccountId,
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasOperatorUniversalHome } from "@/lib/atlas/operator-universal-home";
import { ensureAtlasProjectPullTask } from "@/lib/atlas/project-pull";
import { getAtlasSession } from "@/lib/atlas/session";
import { readAtlasSwitchedFarmHandHomeOverview } from "@/lib/atlas/switched-account-home-overview";
import { readAtlasSetAsideTaskIds } from "@/lib/atlas/task-day-dispositions-server";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";
import { getWorkerDayRoutingState } from "@/lib/atlas-data/worker-day-routing";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";

export const dynamic = "force-dynamic";

type AtlasHomeSearchParams = Record<string, string | string[] | undefined>;
type AtlasHomePageProps = { searchParams?: Promise<AtlasHomeSearchParams> };

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function organizationMembershipForViewer(viewer: NonNullable<ReturnType<typeof atlasUniversalViewerFromSession>>) {
  return viewer.organizationMemberships.find((membership) => membership.organizationId === viewer.activeOrganizationId)
    ?? viewer.organizationMemberships[0]
    ?? null;
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
  const preferredFarmId = selectedFarmKey
    ? viewer.farmMemberships.find((membership) => membership.farmKey === selectedFarmKey)?.farmId ?? viewer.activeFarmId
    : viewer.activeFarmId;
  const selectedMembershipId = effectiveOperatorMembershipId(operatorContext);
  let home = await readAtlasOperatorUniversalHome(viewer, {
    preferredFarmId,
    effectiveAccountId: effectiveOperatorAccountId(operatorContext),
    effectiveMembershipId: selectedMembershipId,
  });

  const actualFarmHandMembership = !operatorContext?.isOperating
    ? viewer.farmMemberships.find((membership) => membership.farmId === home.activeFarm?.farmId && membership.role === "farm_hand") ?? null
    : null;
  const farmHandMode = Boolean(actualFarmHandMembership);

  if (farmHandMode && actualFarmHandMembership && home.activeFarm?.farmId) {
    try {
      const allowOutdoor = await atlasFarmHandOutdoorEligibleNow();
      await ensureAtlasProjectPullTask(home.activeFarm.farmId, actualFarmHandMembership.membershipId, home.window.doneDate, { allowOutdoor });
      home = await readAtlasOperatorUniversalHome(viewer, {
        preferredFarmId,
        effectiveAccountId: effectiveOperatorAccountId(operatorContext),
        effectiveMembershipId: selectedMembershipId,
      });
    } catch {
      // Ordinary Living Day work remains available if project dealing cannot run.
    }
  }

  let setAsideTaskIds = new Set<string>();
  try {
    setAsideTaskIds = await readAtlasSetAsideTaskIds(home.window.doneDate);
  } catch {
    setAsideTaskIds = new Set<string>();
  }

  const visibleFarms = home.farms.map((farm) => ({ ...farm, taskCards: farm.taskCards.filter((task) => !setAsideTaskIds.has(task.task_id)) }));
  const quietTaskIds = new Set(
    visibleFarms.flatMap((farm) => farm.taskCards
      .filter((task) => {
        const value = task.metadata?.hide_from_home_hero ?? task.metadata?.quiet_task;
        return value === true || value === "true" || value === "yes" || value === 1;
      })
      .map((task) => task.task_id)),
  );
  const visibleActiveFarm = home.activeFarm ? visibleFarms.find((farm) => farm.farmId === home.activeFarm?.farmId) ?? home.activeFarm : null;
  const visibleHome = {
    ...home,
    farms: visibleFarms,
    activeFarm: visibleActiveFarm,
    moves: home.moves.filter((move) => move.kind !== "farm_task" || !setAsideTaskIds.has(move.key.split(":").at(-1) ?? "")),
  };
  const switchedFarmHand = Boolean(operatorContext?.isOperating && operatorContext.effective.farmRole === "farm_hand" && selectedMembershipId);
  const [baseTaskOverview, farmSeasons, personalDayProgress] = await Promise.all([
    switchedFarmHand && selectedMembershipId
      ? readAtlasSwitchedFarmHandHomeOverview(visibleHome, selectedMembershipId)
      : readAtlasOperatorHomeTaskOverview(visibleHome),
    readAtlasHomeFarmSeasonProfiles(visibleFarms.map((farm) => farm.farmId)),
    switchedFarmHand ? Promise.resolve(null) : readAtlasPersonalDayProgress(visibleHome),
  ]);
  const reconciledTaskOverview = personalDayProgress && baseTaskOverview.summary.personalScope
    ? { ...baseTaskOverview, summary: { ...baseTaskOverview.summary, plannedTotal: personalDayProgress.plannedTotal, dealtCount: personalDayProgress.dealtCount, openCount: personalDayProgress.openCount, carryForwardCount: Math.max(baseTaskOverview.summary.carryForwardCount, personalDayProgress.carryForwardCount) } }
    : baseTaskOverview;
  const carriedTaskOverview = withAtlasHomeCarryForward(visibleHome, reconciledTaskOverview);
  const staffMoves = carriedTaskOverview.moves.filter((move) => move.kind === "collection");
  const ownerDailyHand = switchedFarmHand || farmHandMode ? null : buildAtlasOwnerDailyHand(visibleHome, staffMoves.length ? 3 : 4);
  const taskOverview = ownerDailyHand
    ? { ...carriedTaskOverview, moves: [...ownerDailyHand, ...staffMoves].slice(0, 4), summary: { ...carriedTaskOverview.summary, prepared: true } }
    : carriedTaskOverview;
  const visibleTaskOverview = {
    ...taskOverview,
    moves: taskOverview.moves.filter((move) => {
      if (move.kind !== "farm_task") return true;
      const taskId = move.key.split(":").at(-1) ?? "";
      return !quietTaskIds.has(taskId);
    }),
  };
  const renderedViewer = visibleHome.viewer;
  const organizationMembership = organizationMembershipForViewer(renderedViewer);
  const organizationPortal = Boolean(organizationMembership && (organizationMembership.role === "owner" || renderedViewer.farmMemberships.length === 0));
  const renderedFarmHandMode = farmHandMode || switchedFarmHand;
  const unconstrainedRenderedHome = {
    ...visibleHome,
    title: organizationPortal ? home.organizationHome?.organization.name || organizationMembership?.organizationName || "Feast Guild" : visibleHome.title,
    moves: visibleTaskOverview.moves,
    datedItems: visibleTaskOverview.datedItems,
  };

  let renderedHome = unconstrainedRenderedHome;
  if (renderedFarmHandMode) {
    let routingState = null;
    if (actualFarmHandMembership) {
      const roleAccess = {
        membership: {
          farmId: actualFarmHandMembership.farmId,
          membershipId: actualFarmHandMembership.membershipId,
          role: "farm_hand",
        },
      } as unknown as AtlasRoleAccess;
      try {
        routingState = await getWorkerDayRoutingState(roleAccess);
      } catch {
        routingState = null;
      }
    }

    // First rank the legitimate day by Anna's routing state. Then let weather/time
    // constrain that ranked list. The final work-window pass must be authoritative:
    // when a scarce morning outdoor window exists, it can promote the best outdoor
    // obligation instead of having adaptive ranking undo the timing signal afterward.
    const adaptiveRanked = {
      ...unconstrainedRenderedHome,
      moves: adaptiveHomeConveyorMoves(unconstrainedRenderedHome, routingState),
    };
    renderedHome = {
      ...adaptiveRanked,
      moves: await atlasFarmHandConveyorMoves(adaptiveRanked),
    };
  }

  return (
    <>
      <AtlasHomeServerRefresh />
      {/* Legacy route contract only: <AtlasAroundRoutes canManage={false} /> has been absorbed into the app dock and compact Home lenses. */}
      <AtlasUniversalHome home={renderedHome} dayOverview={visibleTaskOverview.summary} farmSeasons={farmSeasons} farmHandMode={renderedFarmHandMode} />
      <FarmHandQuickWinPrompt home={renderedHome} active={renderedFarmHandMode} />
      <AtlasPwaCoverPrompt />
    </>
  );
}
