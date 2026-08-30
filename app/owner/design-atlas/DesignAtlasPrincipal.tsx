"use client";

import type { MouseEvent } from "react";

import PrincipalSurface from "@/components/atlas/principal/PrincipalSurface";
import type { AtlasPrincipalSelfContext } from "@/lib/atlas/principal-self-context";

const CONTEXT: AtlasPrincipalSelfContext = {
  contractVersion: "fixture-v1",
  state: "ready",
  principal: { id: "fixture-principal", stableKey: "principal", name: "Principal", organizationId: "fixture-feast", homeTimezone: "America/Chicago", activeHouseholdId: "fixture-household" },
  household: { id: "fixture-household", principal_id: "fixture-principal", stable_key: "household", name: "Household & Family", timezone: "America/Chicago", status: "active" },
  portfolioUnits: [
    { id: "fixture-elm", stableKey: "elm-farm", name: "Elm Farm", unitKind: "operating_company", linkedFarmId: "fixture-farm", lifecycleState: "operating", portfolioRole: "current_engine", horizon: "H1", archivedAt: null },
    { id: "fixture-waiting", stableKey: "waiting-room", name: "Waiting Room", unitKind: "portfolio_unit", linkedFarmId: null, lifecycleState: "emerging", portfolioRole: "emerging_engine", horizon: "H2", archivedAt: null },
    { id: "fixture-future", stableKey: "farm-3", name: "Farm 3", unitKind: "option", linkedFarmId: null, lifecycleState: "option", portfolioRole: "future_option", horizon: "H3", archivedAt: null },
  ],
  capacityToday: { state: "resolved", capacityKnown: true, discretionaryCapacityMinutes: 165, blockedMinutes: 95, maximumPlannedMinutes: 260, timezone: "America/Chicago" },
  principalClock: { state: "active", serviceDate: "2026-08-29", allocationState: "bounded", floor: { title: "Set September operating calendar", floor_class: 2, timing_state: "current", reason_for_floor: "Public commitments need to be settled before the next booking week opens.", expected_minutes: 35, horizon: "H1" } },
  clockCandidates: [
    { domain: "elm", sourceType: "owner_obligation", sourceId: "fixture-obligation-1", title: "Set September operating calendar", floorClass: 2, windowStart: null, windowEnd: null, fixedStart: null, mustBeginBy: "2026-08-29", mustFinishBy: "2026-08-30", expectedMinutes: 35, protectionLevel: "protected", ownerRequired: true, consequence: "Booking capacity remains ambiguous.", reasonForFloor: "External commitments are waiting on this decision.", portfolioUnitId: "fixture-elm", horizon: "H1" },
    { domain: "commercial", sourceType: "owner_obligation", sourceId: "fixture-obligation-2", title: "Approve standing-order boundary", floorClass: 3, windowStart: null, windowEnd: null, fixedStart: null, mustBeginBy: "2026-09-01", mustFinishBy: null, expectedMinutes: 20, protectionLevel: "normal", ownerRequired: true, consequence: "Commercial cannot release recurring offers.", reasonForFloor: "Buyer Desk needs one governed rule.", portfolioUnitId: "fixture-elm", horizon: "H1" },
  ],
  capabilityHolds: {
    contractVersion: "fixture-v1",
    state: "active",
    count: 2,
    items: [
      { taskId: "fixture-hold-1", title: "Fix raised bed frame", taskType: "repair", actionKey: "repair", status: "open", dueDate: "2026-08-29", portfolioUnitId: "fixture-elm", portfolioUnitName: "Elm Farm", portfolioHorizon: "H1", assignedMembershipId: null, assignedWorkerKey: "marshall", assignedRole: "worker", readinessKey: "person_required", readinessLabel: "Marshall required", blocker: "The wood needs to be cut before the bed can be rebuilt.", holdDimensions: ["people", "travel"], heldSince: "2026-08-29T08:00:00-05:00", lastChangedAt: "2026-08-29T08:00:00-05:00", originalDueDate: "2026-08-29" },
      { taskId: "fixture-hold-2", title: "Install event lighting", taskType: "venue", actionKey: "install", status: "open", dueDate: null, portfolioUnitId: "fixture-elm", portfolioUnitName: "Elm Farm", portfolioHorizon: "H1", assignedMembershipId: null, assignedWorkerKey: "owner", assignedRole: "owner", readinessKey: "materials_required", readinessLabel: "Materials required", blocker: "Hardware is not on site yet.", holdDimensions: ["materials"], heldSince: "2026-08-28T12:00:00-05:00", lastChangedAt: "2026-08-28T12:00:00-05:00", originalDueDate: null },
    ],
  },
  principalOffice: {
    state: "ready",
    attention: [
      { subjectId: "fixture-attention-1", title: "Thursday community rhythm", horizon: "H1", attentionState: "due", attentionDebtDays: 1, protectedOwnerMinutes: 20, reasonForFloor: "The public rhythm needs one owner review before September." },
      { subjectId: "fixture-attention-2", title: "Reusable Atlas onboarding", horizon: "H2", attentionState: "protected", protectedOwnerMinutes: 45, reasonForFloor: "Portability work should not disappear behind farm urgency." },
    ],
    portfolioTheses: [{ id: "fixture-thesis", stableKey: "elm-thesis", portfolioUnitId: "fixture-elm", portfolioUnitStableKey: "elm-farm", portfolioUnitName: "Elm Farm", horizon: "H1", thesisStatement: "Elm compounds production, venue, community, and local commercial capacity into one operating place.", valueCreationLogic: null, mustBecomeTrue: null, capitalRequired: null, nextValueMilestone: "Make the public weekly rhythm consistently bookable.", assumptions: null, reconsiderationConditions: null, reviewCadenceDays: 30, nextReviewAt: "2026-09-15", status: "active", source: "fixture" }],
    operatingFunctions: [{ id: "fixture-function", stableKey: "commercial", name: "Commercial", charter: "Turn published operating capacity into outside commitments without inventing supply.", portfolioUnitId: "fixture-elm", accountablePersonId: null, capacityState: "active", reviewCadenceDays: 7, active: true, source: "fixture" }],
    greatGame: [{ scorecardId: "fixture-score", stableKey: "bookings", name: "Weekly bookings", criticalNumber: null, drivers: null, operatingFunctionId: "fixture-function", functionName: "Commercial", portfolioUnitId: "fixture-elm", portfolioUnitName: "Elm Farm", horizon: "H1", accountableOperatorId: null, asOf: "2026-08-29", actual: null, forecast: null, target: null, trend: "building", nextPlay: "Fill Monday–Wednesday booking inventory.", measurementState: "active" }],
    housePosition: { state: "source_required", source: "not connected in fixture", freshness: "unknown", coverage: { state: "unknown" }, currencySummaries: [], capitalRequests: [], investmentOpportunities: [] },
  },
};

export default function DesignAtlasPrincipal() {
  function holdFixtureNavigation(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("a")) event.preventDefault();
  }

  return <div data-atlas-design-principal="canonical-component" data-live-data-binding="none" data-mutation-capability="none" onClickCapture={holdFixtureNavigation}><PrincipalSurface context={CONTEXT} fixtureOnly /></div>;
}
