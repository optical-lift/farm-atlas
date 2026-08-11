"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type DayWindow = "morning" | "afternoon" | "evening";
type EditTab = "work" | "cues" | "both";
type CandidateKind = "project_pull" | "floating_task";
type PlanSourceKind = "task" | "queue" | "rhythm" | CandidateKind;

type PlanRow = {
  id: string;
  kind: "real" | "automatic" | "suggestion";
  sourceKind: PlanSourceKind;
  sourceId: string;
  taskId?: string | null;
  title: string;
  note?: string | null;
  environment?: string | null;
  location?: string | null;
  expectedActiveMinutes: number;
  dayWindow: DayWindow;
  workOrderNumber: number;
  automatic: boolean;
  requiresOwnerApproval: boolean;
  reason?: string | null;
  commitmentKind?: string | null;
  preferredWindowStart?: string | null;
  preferredWindowEnd?: string | null;
  safeWindowEnd?: string | null;
  timingWarning?: string | null;
};

type WorkerDayPlan = {
  serviceDate: string;
  availableWorkerDay: boolean;
  paidTargetMinutes: number;
  committedPaidMinutes: number;
  automaticPaidMinutes: number;
  remainingPaidMinutes: number;
  realWork: PlanRow[];
  automaticWork: PlanRow[];
  suggestions: PlanRow[];
  warnings: string[];
};

type PlanResponse = {
  ok?: boolean;
  active?: boolean;
  operatorLabel?: string;
  target?: { membershipId?: string; displayName?: string } | null;
  plan?: WorkerDayPlan | null;
  error?: string;
};

type Placement = {
  placementId: string;
  taskId: string;
  serviceDate: string;
  dayWindow: DayWindow;
  sortOrder: number;
  placementSource: "atlas" | "owner";
  placementReason: string | null;
  state: "placed" | "returned_to_atlas";
};

type Cue = {
  cueId: string;
  cueKind: "briefing" | "requirement" | "observation" | "somatic" | "result";
  anchorKind: "first_open" | "before_task" | "after_task" | "at_time";
  anchorTaskId: string | null;
  title: string;
  body: string | null;
  status: string;
  scheduledAt: string | null;
};

type ChoreographyResponse = {
  ok?: boolean;
  active?: boolean;
  choreography?: {
    placements?: Placement[];
    placementOverrides?: Placement[];
    cues?: Cue[];
  } | null;
  error?: string;
};

type DraftPlacement = {
  taskId: string;
  serviceDate: string;
  dayWindow: DayWindow;
  sortOrder: number;
  returnedToAtlas: boolean;
};

type DayEdit = {
  kind: "place" | "rewindow" | "reschedule" | "reorder" | "return_to_atlas";
  taskId: string;
  serviceDate?: string;
  dayWindow?: DayWindow;
  sortOrder?: number;
};

type PendingMove = {
  taskId: string;
  serviceDate: string;
  warning: string;
};

const windows: Array<{ key: DayWindow; label: string }> = [
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function shiftDate(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function minutesLabel(value: number) {
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function sourceLabel(kind: CandidateKind) {
  return kind === "project_pull" ? "Finish Elm" : "Atlas work";
}

function cueAnchorLabel(cue: Cue) {
  if (cue.anchorKind === "first_open") return "Morning login";
  if (cue.anchorKind === "before_task") return "Before task";
  if (cue.anchorKind === "after_task") return "After task";
  return "Timed cue";
}

function cueMark(kind: Cue["cueKind"]) {
  if (kind === "somatic") return "♡";
  if (kind === "observation") return "?";
  if (kind === "requirement") return "!";
  return "◇";
}

function placementEqual(left: DraftPlacement | undefined, right: DraftPlacement | undefined) {
  return Boolean(left && right
    && left.serviceDate === right.serviceDate
    && left.dayWindow === right.dayWindow
    && left.sortOrder === right.sortOrder
    && left.returnedToAtlas === right.returnedToAtlas);
}

function cardDetail(row: PlanRow) {
  return [
    row.expectedActiveMinutes ? minutesLabel(row.expectedActiveMinutes) : null,
    row.location,
    row.environment && row.environment !== "either" ? row.environment : null,
  ].filter(Boolean).join(" · ");
}

export default function OwnerDayScheduleBuilder() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const dateIso = pathname === "/day" && validDateIso(requestedDate) ? requestedDate as string : null;

  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [choreographyResponse, setChoreographyResponse] = useState<ChoreographyResponse | null>(null);
  const [baseline, setBaseline] = useState<Map<string, DraftPlacement>>(new Map());
  const [draft, setDraft] = useState<Map<string, DraftPlacement>>(new Map());
  const [selectedAdds, setSelectedAdds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<EditTab>("work");
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlanResponse(null);
    setChoreographyResponse(null);
    setBaseline(new Map());
    setDraft(new Map());
    setSelectedAdds(new Set());
    setPendingMove(null);
    setError(null);
    if (!dateIso) return;

    const controller = new AbortController();
    void Promise.all([
      fetch(`/api/atlas/worker-day-plan?date=${encodeURIComponent(dateIso)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }),
      fetch(`/api/atlas/day-choreography?date=${encodeURIComponent(dateIso)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }),
    ]).then(async ([planRequest, choreographyRequest]) => {
      const [planBody, choreographyBody] = await Promise.all([
        planRequest.json() as Promise<PlanResponse>,
        choreographyRequest.json() as Promise<ChoreographyResponse>,
      ]);
      if (!planRequest.ok || !planBody.ok) throw new Error(planBody.error || "Worker Day could not be loaded.");
      if (!choreographyRequest.ok || !choreographyBody.ok) throw new Error(choreographyBody.error || "Day cues could not be loaded.");
      if (controller.signal.aborted) return;
      setPlanResponse(planBody);
      setChoreographyResponse(choreographyBody);
    }).catch((loadError) => {
      if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Owner Day Edit could not be loaded.");
    });
    return () => controller.abort();
  }, [dateIso]);

  const plan = planResponse?.plan ?? null;
  const realWork = useMemo(() => (plan?.realWork ?? []).filter((row) => Boolean(row.taskId)), [plan]);
  const automaticWork = useMemo(() => plan?.automaticWork ?? [], [plan]);
  const suggestions = useMemo(
    () => (plan?.suggestions ?? []).filter((row) => row.sourceKind === "project_pull" || row.sourceKind === "floating_task"),
    [plan],
  );
  const cues = useMemo(() => choreographyResponse?.choreography?.cues ?? [], [choreographyResponse]);
  const placementOverrides = useMemo(() => choreographyResponse?.choreography?.placementOverrides ?? [], [choreographyResponse]);

  useEffect(() => {
    if (!dateIso || !plan || !choreographyResponse) return;
    const placements = new Map(placementOverrides.map((placement) => [placement.taskId, placement]));
    const next = new Map<string, DraftPlacement>();
    for (const row of realWork) {
      const taskId = row.taskId as string;
      const placement = placements.get(taskId);
      next.set(taskId, {
        taskId,
        serviceDate: placement?.state === "placed" ? placement.serviceDate : dateIso,
        dayWindow: placement?.state === "placed" ? placement.dayWindow : row.dayWindow,
        sortOrder: placement?.state === "placed" ? placement.sortOrder : row.workOrderNumber,
        returnedToAtlas: placement?.state === "returned_to_atlas",
      });
    }
    setBaseline(new Map(next));
    setDraft(new Map(next));
  }, [choreographyResponse, dateIso, plan, placementOverrides, realWork]);

  const rowsByTaskId = useMemo(() => new Map(realWork.map((row) => [row.taskId as string, row])), [realWork]);
  const operatorLabel = planResponse?.operatorLabel || "Farm Hand";
  const plannerActive = Boolean(planResponse?.active && plan?.availableWorkerDay && dateIso);
  const selectedCandidates = useMemo(() => suggestions.filter((candidate) => selectedAdds.has(candidate.id)), [selectedAdds, suggestions]);

  const changedTaskIds = useMemo(() => {
    const changed: string[] = [];
    for (const [taskId, placement] of draft) {
      if (!placementEqual(placement, baseline.get(taskId))) changed.push(taskId);
    }
    return changed;
  }, [baseline, draft]);

  function setPlacement(taskId: string, updater: (current: DraftPlacement) => DraftPlacement) {
    setDraft((current) => {
      const existing = current.get(taskId);
      if (!existing) return current;
      const next = new Map(current);
      next.set(taskId, updater(existing));
      return next;
    });
    setError(null);
  }

  function moveWindow(taskId: string, dayWindow: DayWindow) {
    const laneRows = [...draft.values()]
      .filter((row) => !row.returnedToAtlas && row.serviceDate === dateIso && row.dayWindow === dayWindow)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const last = laneRows.at(-1)?.sortOrder ?? 0;
    setPlacement(taskId, (current) => ({
      ...current,
      serviceDate: dateIso as string,
      dayWindow,
      sortOrder: last + 100,
      returnedToAtlas: false,
    }));
  }

  function reorderBefore(taskId: string, beforeTaskId: string) {
    if (taskId === beforeTaskId) return;
    const moving = draft.get(taskId);
    const target = draft.get(beforeTaskId);
    if (!moving || !target || target.returnedToAtlas || target.serviceDate !== dateIso) return;
    const lane = [...draft.values()]
      .filter((row) => !row.returnedToAtlas && row.serviceDate === dateIso && row.dayWindow === target.dayWindow && row.taskId !== taskId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const targetIndex = lane.findIndex((row) => row.taskId === beforeTaskId);
    const previous = targetIndex > 0 ? lane[targetIndex - 1].sortOrder : target.sortOrder - 200;
    const nextOrder = previous + ((target.sortOrder - previous) / 2);
    setPlacement(taskId, (current) => ({
      ...current,
      serviceDate: dateIso as string,
      dayWindow: target.dayWindow,
      sortOrder: nextOrder,
      returnedToAtlas: false,
    }));
  }

  function bump(taskId: string, direction: -1 | 1) {
    const moving = draft.get(taskId);
    if (!moving) return;
    const lane = [...draft.values()]
      .filter((row) => !row.returnedToAtlas && row.serviceDate === moving.serviceDate && row.dayWindow === moving.dayWindow)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const index = lane.findIndex((row) => row.taskId === taskId);
    const swap = lane[index + direction];
    if (!swap) return;
    const movingOrder = moving.sortOrder;
    setDraft((current) => {
      const next = new Map(current);
      next.set(taskId, { ...moving, sortOrder: swap.sortOrder });
      next.set(swap.taskId, { ...swap, sortOrder: movingOrder });
      return next;
    });
  }

  function applyDateMove(taskId: string, serviceDate: string) {
    setPendingMove((current) => current?.taskId === taskId ? null : current);
    setPlacement(taskId, (current) => ({ ...current, serviceDate, returnedToAtlas: false }));
  }

  function requestDateMove(taskId: string, serviceDate: string) {
    if (!validDateIso(serviceDate)) return;
    const row = rowsByTaskId.get(taskId);
    const crossesEnd = Boolean(row?.safeWindowEnd && serviceDate > row.safeWindowEnd);
    const crossesStart = Boolean(row?.preferredWindowStart && serviceDate < row.preferredWindowStart);
    if (row && (crossesEnd || crossesStart)) {
      setPendingMove({
        taskId,
        serviceDate,
        warning: row.timingWarning || "Moving this may miss the preferred farm window.",
      });
      return;
    }
    applyDateMove(taskId, serviceDate);
  }

  function sendTomorrow(taskId: string) {
    if (!dateIso) return;
    requestDateMove(taskId, shiftDate(dateIso, 1));
  }

  function sendNextWeek(taskId: string) {
    if (!dateIso) return;
    requestDateMove(taskId, shiftDate(dateIso, 7));
  }

  function chooseDate(taskId: string, serviceDate: string) {
    requestDateMove(taskId, serviceDate);
  }

  function returnToAtlas(taskId: string) {
    setPendingMove((current) => current?.taskId === taskId ? null : current);
    setPlacement(taskId, (current) => ({ ...current, returnedToAtlas: true }));
  }

  function undoTask(taskId: string) {
    const original = baseline.get(taskId);
    if (!original) return;
    setPendingMove((current) => current?.taskId === taskId ? null : current);
    setDraft((current) => {
      const next = new Map(current);
      next.set(taskId, { ...original });
      return next;
    });
  }

  function toggleSuggestion(candidate: PlanRow) {
    setSelectedAdds((current) => {
      const next = new Set(current);
      if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id);
      return next;
    });
  }

  function editsForCommit(): DayEdit[] {
    if (!dateIso) return [];
    return changedTaskIds.map((taskId) => {
      const current = draft.get(taskId) as DraftPlacement;
      const original = baseline.get(taskId) as DraftPlacement;
      if (current.returnedToAtlas) return { kind: "return_to_atlas", taskId };
      const kind: DayEdit["kind"] = current.serviceDate !== original.serviceDate
        ? "reschedule"
        : current.dayWindow !== original.dayWindow
          ? "rewindow"
          : current.sortOrder !== original.sortOrder
            ? "reorder"
            : "place";
      return {
        kind,
        taskId,
        serviceDate: current.serviceDate,
        dayWindow: current.dayWindow,
        sortOrder: current.sortOrder,
      };
    });
  }

  async function commitChanges() {
    if (!dateIso || saving || pendingMove || (!changedTaskIds.length && !selectedCandidates.length)) return;
    setSaving(true);
    setError(null);
    try {
      const edits = editsForCommit();
      if (edits.length) {
        const request = await fetch("/api/atlas/owner-day-edit", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-atlas-intent": "owner-day-edit-v1",
          },
          body: JSON.stringify({ edits }),
        });
        const body = await request.json() as { ok?: boolean; error?: string; message?: string };
        if (!request.ok || !body.ok) throw new Error(body.message || body.error || "Atlas could not re-plan the Day.");
      }

      if (selectedCandidates.length) {
        const request = await fetch("/api/atlas/owner-day-schedule", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-atlas-intent": "owner-day-schedule-v1",
          },
          body: JSON.stringify({
            date: dateIso,
            selections: selectedCandidates.map((candidate) => ({ sourceKind: candidate.sourceKind, sourceId: candidate.sourceId })),
          }),
        });
        const body = await request.json() as { ok?: boolean; error?: string; message?: string };
        if (!request.ok || !body.ok) throw new Error(body.message || body.error || "Atlas could not add the selected work.");
      }

      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Atlas could not commit these Day changes.");
      setSaving(false);
    }
  }

  if (!plannerActive) {
    if (error) return <p style={{ margin: "10px 0", fontSize: 12 }}>{error}</p>;
    return null;
  }

  const dayRows = [...draft.values()]
    .filter((row) => !row.returnedToAtlas && row.serviceDate === dateIso)
    .sort((a, b) => a.dayWindow.localeCompare(b.dayWindow) || a.sortOrder - b.sortOrder);
  const movedOff = [...draft.values()].filter((row) => row.returnedToAtlas || row.serviceDate !== dateIso);
  const showWork = tab === "work" || tab === "both";
  const showCues = tab === "cues" || tab === "both";
  const dirtyCount = changedTaskIds.length + selectedCandidates.length;

  function cuesForTask(taskId: string, anchorKind: Cue["anchorKind"]) {
    return cues.filter((cue) => cue.anchorTaskId === taskId && cue.anchorKind === anchorKind);
  }

  return (
    <section
      data-owner-day-edit-board="true"
      style={{
        margin: "0 0 18px",
        padding: "12px",
        border: "1px solid rgba(112,111,177,.28)",
        borderRadius: 16,
        background: "rgba(247,245,252,.9)",
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <strong style={{ display: "block", fontSize: 13 }}>Choreograph {operatorLabel}&apos;s day</strong>
          <span style={{ fontSize: 10.5, opacity: .66 }}>Purple is your draft. Nothing below is worker history until you commit it.</span>
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 850, color: "#6e70a4" }}>{dirtyCount ? `${dirtyCount} change${dirtyCount === 1 ? "" : "s"}` : "No changes"}</span>
      </div>

      <div role="tablist" aria-label="Owner Day edit layers" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
        {(["work", "cues", "both"] as EditTab[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            style={{
              border: "1px solid rgba(112,111,177,.24)",
              borderRadius: 10,
              padding: "7px 8px",
              background: tab === value ? "rgba(229,226,246,.95)" : "rgba(255,255,255,.55)",
              color: "#555887",
              font: "inherit",
              fontSize: 11,
              fontWeight: 850,
            }}
          >
            {value === "work" ? "Work" : value === "cues" ? "Cues" : "Both"}
          </button>
        ))}
      </div>

      {showCues ? (
        <div style={{ display: "grid", gap: 6 }}>
          {cues.filter((cue) => cue.anchorKind === "first_open" || cue.anchorKind === "at_time").map((cue) => (
            <div key={cue.cueId} style={{ padding: "8px 10px", borderRadius: 12, background: "rgba(255,255,255,.58)", border: "1px solid rgba(112,111,177,.14)" }}>
              <small style={{ display: "block", fontSize: 9.5, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", color: "#777bb0" }}>{cueMark(cue.cueKind)} {cueAnchorLabel(cue)}</small>
              <strong style={{ display: "block", marginTop: 2, fontSize: 12 }}>{cue.title}</strong>
              {cue.body ? <span style={{ display: "block", marginTop: 2, fontSize: 10.5, opacity: .68 }}>{cue.body}</span> : null}
            </div>
          ))}
          {!cues.length && tab === "cues" ? <span style={{ fontSize: 11, opacity: .62 }}>No Day cues are attached yet.</span> : null}
        </div>
      ) : null}

      {showWork ? windows.map((window) => {
        const lane = dayRows.filter((placement) => placement.dayWindow === window.key);
        const automatic = automaticWork.filter((row) => row.dayWindow === window.key);
        return (
          <section
            key={window.key}
            data-owner-day-window={window.key}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (draggingTaskId) moveWindow(draggingTaskId, window.key);
              setDraggingTaskId(null);
            }}
            style={{ display: "grid", gap: 7 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <strong style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#777bb0" }}>{window.label}</strong>
              <span style={{ fontSize: 9.5, opacity: .58 }}>drop here to move</span>
            </div>

            {lane.map((placement) => {
              const row = rowsByTaskId.get(placement.taskId);
              if (!row) return null;
              const changed = !placementEqual(placement, baseline.get(placement.taskId));
              const beforeCues = showCues ? cuesForTask(placement.taskId, "before_task") : [];
              const afterCues = showCues ? cuesForTask(placement.taskId, "after_task") : [];
              const moveWarning = pendingMove?.taskId === placement.taskId ? pendingMove : null;
              return (
                <div key={placement.taskId} style={{ display: "grid", gap: 5 }}>
                  {beforeCues.map((cue) => (
                    <div key={cue.cueId} style={{ marginLeft: 12, padding: "6px 9px", borderLeft: "2px solid rgba(112,111,177,.4)", fontSize: 10.5 }}>
                      <strong>{cueMark(cue.cueKind)} Before · {cue.title}</strong>
                    </div>
                  ))}
                  <article
                    draggable
                    onDragStart={() => setDraggingTaskId(placement.taskId)}
                    onDragEnd={() => setDraggingTaskId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (draggingTaskId) reorderBefore(draggingTaskId, placement.taskId);
                      setDraggingTaskId(null);
                    }}
                    style={{
                      padding: "9px 10px",
                      borderRadius: 13,
                      border: changed ? "1px solid rgba(112,111,177,.58)" : "1px solid rgba(112,111,177,.28)",
                      background: changed ? "rgba(234,231,249,.98)" : "rgba(244,242,251,.88)",
                      boxShadow: changed ? "0 7px 18px rgba(75,70,128,.07)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span aria-hidden="true" title="Drag task" style={{ fontSize: 16, lineHeight: 1, color: "#8a89af", cursor: "grab", paddingTop: 2 }}>⋮⋮</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ display: "block", fontSize: 12.5 }}>{row.title}</strong>
                        {cardDetail(row) ? <span style={{ display: "block", marginTop: 2, fontSize: 10.5, opacity: .62 }}>{cardDetail(row)}</span> : null}
                      </div>
                      {changed ? <button type="button" onClick={() => undoTask(placement.taskId)} style={{ border: 0, background: "transparent", font: "inherit", fontSize: 9.5, fontWeight: 850, color: "#6e70a4" }}>Undo</button> : null}
                    </div>

                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {windows.map((choice) => (
                        <button
                          key={choice.key}
                          type="button"
                          aria-pressed={placement.dayWindow === choice.key}
                          onClick={() => moveWindow(placement.taskId, choice.key)}
                          style={{ border: "1px solid rgba(112,111,177,.22)", borderRadius: 9, padding: "5px 7px", background: placement.dayWindow === choice.key ? "rgba(218,214,242,.9)" : "rgba(255,255,255,.56)", font: "inherit", fontSize: 9.5, fontWeight: 800 }}
                        >{choice.label}</button>
                      ))}
                      <button type="button" onClick={() => bump(placement.taskId, -1)} style={{ border: "1px solid rgba(112,111,177,.22)", borderRadius: 9, padding: "5px 7px", background: "rgba(255,255,255,.56)", font: "inherit", fontSize: 9.5, fontWeight: 800 }}>↑</button>
                      <button type="button" onClick={() => bump(placement.taskId, 1)} style={{ border: "1px solid rgba(112,111,177,.22)", borderRadius: 9, padding: "5px 7px", background: "rgba(255,255,255,.56)", font: "inherit", fontSize: 9.5, fontWeight: 800 }}>↓</button>
                      <button type="button" onClick={() => sendTomorrow(placement.taskId)} style={{ border: "1px solid rgba(112,111,177,.22)", borderRadius: 9, padding: "5px 7px", background: "rgba(255,255,255,.56)", font: "inherit", fontSize: 9.5, fontWeight: 800 }}>Tomorrow</button>
                      <button type="button" onClick={() => sendNextWeek(placement.taskId)} style={{ border: "1px solid rgba(112,111,177,.22)", borderRadius: 9, padding: "5px 7px", background: "rgba(255,255,255,.56)", font: "inherit", fontSize: 9.5, fontWeight: 800 }}>Next week</button>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid rgba(112,111,177,.22)", borderRadius: 9, padding: "3px 5px", background: "rgba(255,255,255,.56)", fontSize: 9.5, fontWeight: 800 }}>
                        Date
                        <input type="date" value={placement.serviceDate} onChange={(event) => chooseDate(placement.taskId, event.target.value)} style={{ border: 0, background: "transparent", font: "inherit", fontSize: 9.5, maxWidth: 112 }} />
                      </label>
                      <button type="button" onClick={() => returnToAtlas(placement.taskId)} style={{ border: "1px solid rgba(112,111,177,.22)", borderRadius: 9, padding: "5px 7px", background: "rgba(255,255,255,.56)", font: "inherit", fontSize: 9.5, fontWeight: 850, color: "#555887" }}>Return to Atlas</button>
                    </div>

                    {moveWarning ? (
                      <div data-owner-day-timing-warning="true" style={{ marginTop: 8, padding: "8px 9px", borderRadius: 10, background: "rgba(255,247,213,.78)", border: "1px solid rgba(139,119,54,.18)", display: "grid", gap: 6 }}>
                        <strong style={{ fontSize: 10.5, lineHeight: 1.35 }}>{moveWarning.warning}</strong>
                        <span style={{ fontSize: 9.5, opacity: .7 }}>Requested date · {moveWarning.serviceDate}</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" onClick={() => setPendingMove(null)} style={{ border: "1px solid rgba(112,111,177,.2)", borderRadius: 8, padding: "5px 7px", background: "rgba(255,255,255,.7)", font: "inherit", fontSize: 9.5, fontWeight: 850 }}>Keep today</button>
                          <button type="button" onClick={() => applyDateMove(moveWarning.taskId, moveWarning.serviceDate)} style={{ border: 0, borderRadius: 8, padding: "5px 7px", background: "#e9e73b", font: "inherit", fontSize: 9.5, fontWeight: 900 }}>Move anyway</button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                  {afterCues.map((cue) => (
                    <div key={cue.cueId} style={{ marginLeft: 12, padding: "6px 9px", borderLeft: "2px solid rgba(112,111,177,.4)", fontSize: 10.5 }}>
                      <strong>{cueMark(cue.cueKind)} After · {cue.title}</strong>
                    </div>
                  ))}
                </div>
              );
            })}

            {automatic.map((row) => (
              <article key={row.id} style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid rgba(125,128,172,.16)", background: "rgba(250,249,245,.8)" }}>
                <small style={{ display: "block", fontSize: 9.5, fontWeight: 850, color: "#777b9c" }}>Atlas automatic</small>
                <strong style={{ display: "block", marginTop: 2, fontSize: 12 }}>{row.title}</strong>
              </article>
            ))}

            {!lane.length && !automatic.length ? <div style={{ minHeight: 34, border: "1px dashed rgba(112,111,177,.22)", borderRadius: 11, display: "grid", placeItems: "center", fontSize: 10, opacity: .52 }}>Drop work here</div> : null}
          </section>
        );
      }) : null}

      {showWork && movedOff.length ? (
        <section style={{ display: "grid", gap: 6 }}>
          <strong style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "#777bb0" }}>Moved off today</strong>
          {movedOff.map((placement) => {
            const row = rowsByTaskId.get(placement.taskId);
            if (!row) return null;
            return (
              <div key={placement.taskId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 9px", borderRadius: 11, background: "rgba(238,235,249,.72)", fontSize: 10.5 }}>
                <span><strong>{row.title}</strong><br />{placement.returnedToAtlas ? "Returned to Atlas" : `Moved to ${placement.serviceDate}`}</span>
                <button type="button" onClick={() => undoTask(placement.taskId)} style={{ border: 0, background: "transparent", font: "inherit", fontSize: 10, fontWeight: 850, color: "#656899" }}>Undo</button>
              </div>
            );
          })}
        </section>
      ) : null}

      {showWork && suggestions.length ? (
        <section style={{ display: "grid", gap: 6 }}>
          <strong style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "#777bb0" }}>Available to add</strong>
          {suggestions.map((candidate) => {
            const selected = selectedAdds.has(candidate.id);
            return (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleSuggestion(candidate)}
                style={{ width: "100%", textAlign: "left", border: selected ? "1px solid rgba(112,111,177,.58)" : "1px dashed rgba(112,111,177,.34)", borderRadius: 12, padding: "8px 10px", background: selected ? "rgba(232,228,248,.98)" : "rgba(248,246,252,.78)", font: "inherit", color: "inherit" }}
              >
                <small style={{ display: "block", color: "#777bb0", fontSize: 9.5, fontWeight: 850 }}>{selected ? "Selected" : "Available"} · {sourceLabel(candidate.sourceKind as CandidateKind)}</small>
                <strong style={{ display: "block", marginTop: 2, fontSize: 12 }}>{candidate.title}</strong>
                {cardDetail(candidate) ? <span style={{ display: "block", marginTop: 2, fontSize: 10.5, opacity: .62 }}>{cardDetail(candidate)}</span> : null}
              </button>
            );
          })}
        </section>
      ) : null}

      {error ? <p style={{ margin: 0, fontSize: 11, lineHeight: 1.4 }}>{error}</p> : null}

      <button
        type="button"
        disabled={!dirtyCount || saving || Boolean(pendingMove)}
        onClick={() => void commitChanges()}
        style={{
          width: "100%",
          border: 0,
          borderRadius: 12,
          padding: "10px 12px",
          background: dirtyCount && !saving && !pendingMove ? "#e9e73b" : "rgba(125,128,172,.13)",
          color: "#303242",
          font: "inherit",
          fontSize: 12.5,
          fontWeight: 900,
        }}
      >
        {saving ? "Committing changes…" : pendingMove ? "Resolve move warning" : dirtyCount ? `Commit ${dirtyCount} change${dirtyCount === 1 ? "" : "s"}` : "No Day changes"}
      </button>
    </section>
  );
}
