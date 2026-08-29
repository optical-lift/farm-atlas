"use client";

import type { MouseEvent } from "react";

import AtlasUniversalHomeV2, { type AtlasHomeDayOverview } from "@/components/atlas/home/AtlasUniversalHomeV2";
import type { AtlasHomeFarmSeasonProfile } from "@/lib/atlas/home-farm-seasons";
import type { AtlasPortfolioAttention } from "@/lib/atlas/portfolio";
import type { AtlasUniversalFarmScope, AtlasUniversalHomeModel, AtlasUniversalMove } from "@/lib/atlas/universal-home";

export type DesignAtlasHomePersona = "principal" | "anna" | "marshall";

const FARM_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000101";
const DATE_ISO = "2026-08-29";

const season: AtlasHomeFarmSeasonProfile = {
  farmId: FARM_ID,
  locationLabel: "Marshfield, MO",
  frostStatus: "known",
  frostBoundaryMonth: 10,
  frostBoundaryDay: 15,
  frostNote: "Fixture-only seasonal boundary.",
};

function farm(persona: DesignAtlasHomePersona): AtlasUniversalFarmScope {
  const owner = persona === "principal";
  return {
    membershipId: `fixture-membership-${persona}`,
    farmId: FARM_ID,
    farmKey: "elm-farm",
    farmName: "Elm Farm",
    farmStatus: "active",
    organizationId: null,
    role: owner ? "owner" : "worker",
    workerKey: persona,
    permissions: {},
    canManageFarm: owner,
    canUseOwnerTools: owner,
    snapshot: {
      totalBeds: 34,
      growingBeds: 21,
      activeSqft: 1944,
      sowingsLogged: 18,
      stemsLogged: 382,
    },
    taskCards: [],
    openTaskCount: owner ? 7 : 8,
    blockedTaskCount: owner ? 2 : 0,
    overdueTaskCount: 0,
    dueTodayCount: owner ? 7 : 8,
    lastMovementAt: `${DATE_ISO}T08:10:00-05:00`,
  };
}

function move(persona: DesignAtlasHomePersona, index: number, title: string, meta: string, state: AtlasUniversalMove["state"] = "ready"): AtlasUniversalMove {
  const farmHand = persona !== "principal";
  return {
    key: `fixture:${persona}:${index}`,
    kind: "farm_task",
    category: farmHand ? "Farm work" : index === 0 ? "Owner" : "Decision",
    title,
    scopeLabel: farmHand ? "Elm Farm" : index === 0 ? "Principal" : "Elm Farm",
    meta,
    detail: farmHand ? "Atlas is holding the rest of the order." : index === 1 ? "A real operating boundary needs owner judgment." : "Protected owner work.",
    href: "/owner/design-atlas",
    date: DATE_ISO,
    state,
    farmId: FARM_ID,
    projectId: index === 1 ? PROJECT_ID : null,
    priority: index + 1,
  };
}

function attention(): AtlasPortfolioAttention[] {
  return [
    {
      attentionId: "fixture-attention-1",
      kind: "decision",
      title: "Thursday capacity needs a final call",
      detail: "Workshop demand is pressing against the protected community-day shape.",
      dueDate: DATE_ISO,
      projectId: PROJECT_ID,
      projectTitle: "Thursday community day",
      farmName: "Elm Farm",
    },
    {
      attentionId: "fixture-attention-2",
      kind: "blocked",
      title: "MG7 transplant timing is tightening",
      detail: "The prerequisite is unresolved while the biological window keeps moving.",
      dueDate: DATE_ISO,
      projectId: `${PROJECT_ID.slice(0, -1)}2`,
      projectTitle: "Main Garden succession",
      farmName: "Elm Farm",
    },
  ];
}

function datedItems(persona: DesignAtlasHomePersona): AtlasUniversalHomeModel["datedItems"] {
  const days = [
    ["2026-08-24", "complete"],
    ["2026-08-25", "complete"],
    ["2026-08-26", "ready"],
    ["2026-08-26", "ready"],
    ["2026-08-27", "ready"],
    ["2026-08-27", "attention"],
    ["2026-08-28", "ready"],
    ["2026-08-28", "ready"],
    [DATE_ISO, "ready"],
    [DATE_ISO, "ready"],
    [DATE_ISO, "ready"],
  ] as const;
  return days.map(([date, state], index) => ({
    key: `fixture-date:${index}`,
    kind: "farm_task" as const,
    title: `Fixture work ${index + 1}`,
    scopeLabel: persona === "principal" ? "Principal" : "Elm Farm",
    date,
    href: "/owner/design-atlas",
    state,
  }));
}

function model(persona: DesignAtlasHomePersona): AtlasUniversalHomeModel {
  const farmScope = farm(persona);
  const isPrincipal = persona === "principal";
  const moves = isPrincipal
    ? [
        move(persona, 0, "Set September operating calendar", "35 min"),
        move(persona, 1, "Resolve Thursday capacity", "Community day", "attention"),
        move(persona, 2, "Approve standing-order rule", "Buyer Desk · 20 min"),
      ]
    : persona === "anna"
      ? [
          move(persona, 0, "Weed Field Row 13", "Field Rows · Morning"),
          move(persona, 1, "Transplant cabbage into MG7", "Main Garden · Morning"),
        ]
      : [
          move(persona, 0, "Adjust north barn door", "Barn · Project move"),
          move(persona, 1, "Verify clean close", "Barn · Next move"),
        ];
  return {
    title: "Elm Farm",
    viewer: {
      userId: `fixture-user-${persona}`,
      email: null,
      displayName: persona === "principal" ? "Principal" : persona === "anna" ? "Anna" : "Marshall",
      activeFarmId: FARM_ID,
      activeOrganizationId: null,
      farmMemberships: [],
      organizationMemberships: [],
      hasFarmScope: true,
      hasOrganizationScope: false,
      canManageAnyFarm: isPrincipal,
      canUseAnyOwnerTools: isPrincipal,
      canManageAnyPortfolio: isPrincipal,
    },
    activeFarmId: FARM_ID,
    activeFarm: farmScope,
    farms: [farmScope],
    organizationHome: null,
    projects: [],
    projectTasks: [],
    attention: isPrincipal ? attention() : [],
    moves,
    datedItems: datedItems(persona),
    metrics: {
      farmCount: 1,
      projectCount: isPrincipal ? 4 : 0,
      openWorkCount: isPrincipal ? 7 : 8,
      attentionCount: isPrincipal ? 2 : 0,
      movingCount: isPrincipal ? 5 : 8,
    },
    window: { doneDate: DATE_ISO, dueThrough: "2026-09-05" },
  };
}

function overview(persona: DesignAtlasHomePersona): AtlasHomeDayOverview {
  const principal = persona === "principal";
  return {
    prepared: true,
    plannedTotal: principal ? 7 : 8,
    dealtCount: principal ? 3 : 0,
    openCount: principal ? 4 : 8,
    carryForwardCount: 0,
    personalScope: principal,
    farmCount: 1,
    staffLaneCount: principal ? 3 : 1,
  };
}

export default function DesignAtlasCanonicalHome({ persona }: { persona: DesignAtlasHomePersona }) {
  function holdFixtureNavigation(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("a")) event.preventDefault();
  }

  return (
    <div
      data-atlas-design-home="canonical-component"
      data-live-data-binding="none"
      data-mutation-capability="none"
      onClickCapture={holdFixtureNavigation}
    >
      <AtlasUniversalHomeV2
        home={model(persona)}
        dayOverview={overview(persona)}
        farmSeasons={{ [FARM_ID]: season }}
        farmHandMode={persona !== "principal"}
        fixtureOnly
        fixtureWeatherLabel="82° · clear"
      />
    </div>
  );
}
