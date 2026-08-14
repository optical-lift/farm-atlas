"use client";

import { useEffect, useMemo, useState } from "react";

import { useAtlasRuntimeActions } from "@/components/atlas/runtime/AtlasRuntimeProvider";
import {
  atlasClockDraftReturnedTaskIds,
  atlasClockDraftVisibleTaskIds,
  buildAtlasClockDraftCommitChanges,
  buildAtlasClockPlanDraft,
  evaluateAtlasClockPlanDraft,
  reconcileAtlasClockPlanDraftWithProposal,
  summarizeAtlasClockDraft,
  updateAtlasClockDraftBlock,
  type AtlasClockDraftBlock,
  type AtlasClockDraftDecision,
} from "@/lib/atlas/clock-plan-draft";
import type { AtlasClockProposalPlan } from "@/lib/atlas/clock-proposal";
import type { AtlasClockReservation } from "@/lib/atlas/clock-reservations";
import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";

type CommittedItem = Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;

export function useClockPlanEditor(input: {
  active: boolean;
  dateIso: string;
  committed: CommittedItem[];
  proposal: AtlasClockProposalPlan;
  reservations: AtlasClockReservation[];
  rebuildProposal: () => AtlasClockProposalPlan;
  onCommitted: () => void;
  onError: (message: string | null) => void;
}) {
  const { dispatchClockCommand } = useAtlasRuntimeActions();
  const [rawBlocks, setRawBlocks] = useState<AtlasClockDraftBlock[] | null>(null);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    if (!input.active) {
      setRawBlocks(null);
      return;
    }
    setRawBlocks((current) => current
      ? reconcileAtlasClockPlanDraftWithProposal(current, input.committed, input.proposal)
      : buildAtlasClockPlanDraft(input.committed, input.proposal));
  }, [input.active, input.committed, input.proposal]);

  const blocks = useMemo(() => rawBlocks ? evaluateAtlasClockPlanDraft(rawBlocks, input.reservations) : null, [rawBlocks, input.reservations]);
  const summary = useMemo(() => blocks ? summarizeAtlasClockDraft(blocks, input.reservations) : null, [blocks, input.reservations]);
  const visibleProposalTaskIds = useMemo(() => blocks ? atlasClockDraftVisibleTaskIds(blocks) : new Set<string>(), [blocks]);
  const returnedTaskIds = useMemo(() => blocks ? atlasClockDraftReturnedTaskIds(blocks) : new Set<string>(), [blocks]);

  function mutate(id: string, patch: Parameters<typeof updateAtlasClockDraftBlock>[2]) {
    setRawBlocks((current) => current ? updateAtlasClockDraftBlock(current, id, {
      ...patch,
      overrideWarnings: patch.overrideWarnings ?? false,
    }) : current);
  }

  function move(id: string, startMinute: number) { mutate(id, { startMinute, startTouched: true, overrideWarnings: false }); }
  function resize(id: string, durationMinutes: number) { mutate(id, { durationMinutes, durationTouched: true, overrideWarnings: false }); }
  function decide(id: string, decision: AtlasClockDraftDecision) { mutate(id, { decision, overrideWarnings: false }); }
  function setWarningOverride(id: string, value: boolean) { mutate(id, { overrideWarnings: value }); }
  function unplace(id: string) { mutate(id, { startMinute: null, startTouched: true, durationTouched: true, overrideWarnings: false }); }

  function acceptAll() {
    setRawBlocks((current) => current?.map((block) => block.source === "proposal" && block.decision !== "reject"
      ? { ...block, decision: "accept" as const }
      : block) ?? current);
  }

  function reset() {
    setRawBlocks(buildAtlasClockPlanDraft(input.committed, input.rebuildProposal()));
    input.onError(null);
  }

  async function commit() {
    if (!blocks || !summary) return;
    const changes = buildAtlasClockDraftCommitChanges(blocks, input.reservations);
    if (!changes.length) {
      input.onError("Choose at least one proposed time or move a committed block before committing.");
      return;
    }
    if (summary.unresolvedWarningCount > 0) {
      input.onError("Resolve or explicitly override every timing warning before committing this Clock.");
      return;
    }

    setCommitting(true);
    input.onError(null);
    try {
      await dispatchClockCommand({ kind: "clock_plan_commit", serviceDate: input.dateIso, changes });
      input.onCommitted();
      setRawBlocks(null);
    } catch (failure) {
      input.onError(failure instanceof Error ? failure.message : "Atlas could not commit this Clock plan.");
    } finally {
      setCommitting(false);
    }
  }

  return {
    blocks,
    summary,
    visibleProposalTaskIds,
    returnedTaskIds,
    committing,
    move,
    resize,
    decide,
    setWarningOverride,
    unplace,
    acceptAll,
    reset,
    commit,
  };
}
