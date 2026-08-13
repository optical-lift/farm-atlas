"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type DayWindow = "morning" | "afternoon" | "evening";
type CandidateKind = "project_pull" | "floating_task";
type PlanSourceKind = "task" | "queue" | "rhythm" | CandidateKind;

type PlanRow = {
  id: string;
  kind: "real" | "automatic" | "suggestion";
  sourceKind: PlanSourceKind;
  sourceId: string;
  taskId?: string | null;
  title: string;
  expectedActiveMinutes: number;
  dayWindow: DayWindow;
  workOrderNumber: number;
  preferredWindowStart?: string | null;
  safeWindowEnd?: string | null;
  timingWarning?: string | null;
};

type WorkerDayPlan = {
  serviceDate: string;
  availableWorkerDay: boolean;
  realWork: PlanRow[];
  automaticWork: PlanRow[];
  suggestions: PlanRow[];
};

type PlanResponse = {
  ok?: boolean;
  active?: boolean;
  operatorLabel?: string;
  plan?: WorkerDayPlan | null;
  error?: string;
};

type Placement = {
  taskId: string;
  serviceDate: string;
  dayWindow: DayWindow;
  sortOrder: number;
  state: "placed" | "returned_to_atlas";
};

type ChoreographyResponse = {
  ok?: boolean;
  choreography?: { placementOverrides?: Placement[] } | null;
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

type PendingMove = { taskId: string; serviceDate: string; warning: string };
type InlineMount = { taskId: string; host: HTMLElement };
type PotentialToggleDetail = { sourceKind?: string; sourceId?: string; selected?: boolean };

const windows: Array<{ key: DayWindow; label: string }> = [
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];
const windowRank: Record<DayWindow, number> = { morning: 0, afternoon: 1, evening: 2 };
const potentialEvent = "atlas-owner-day-potential-toggle";
const layoutEvent = "atlas-owner-day-draft-layout";
const resetEvent = "atlas-owner-day-draft-reset";

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function shiftDate(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function placementEqual(left: DraftPlacement | undefined, right: DraftPlacement | undefined) {
  return Boolean(left && right
    && left.serviceDate === right.serviceDate
    && left.dayWindow === right.dayWindow
    && left.sortOrder === right.sortOrder
    && left.returnedToAtlas === right.returnedToAtlas);
}

function candidateKey(sourceKind: string, sourceId: string) {
  return `${sourceKind}:${sourceId}`;
}

function taskEntry(taskId: string) {
  return document.getElementById(`day-task-${taskId}`) as HTMLElement | null;
}

function timelineElement() {
  return document.querySelector<HTMLElement>(".atlas-day-work-order-group.atlas-day-timeline-group .atlas-day-mixed-timeline");
}

function nextWindowMarker(timeline: HTMLElement, dayWindow: DayWindow) {
  return Array.from(timeline.querySelectorAll<HTMLElement>(".atlas-day-window-marker[data-day-window]"))
    .find((marker) => {
      const key = marker.dataset.dayWindow as DayWindow | undefined;
      return key ? windowRank[key] > windowRank[dayWindow] : false;
    }) ?? null;
}

function ensureMovedOffHost(timeline: HTMLElement) {
  let host = timeline.querySelector<HTMLElement>('[data-owner-day-moved-off="true"]');
  if (host) return host;
  host = document.createElement("section");
  host.dataset.ownerDayMovedOff = "true";
  host.style.cssText = "margin:12px 0 2px 25px;padding:8px 0 0;border-top:1px solid rgba(112,111,177,.16);display:grid;gap:7px";
  const heading = document.createElement("strong");
  heading.textContent = "Moved off today";
  heading.style.cssText = "font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#777bb0";
  host.appendChild(heading);
  timeline.appendChild(host);
  return host;
}

function fixedPlacements(rows: PlanRow[]) {
  return rows
    .filter((row) => Boolean(row.taskId))
    .map((row) => ({ taskId: row.taskId as string, dayWindow: row.dayWindow, sortOrder: row.workOrderNumber }));
}

function applyDraftLayout(timeline: HTMLElement, draft: Map<string, DraftPlacement>, dateIso: string, automaticWork: PlanRow[]) {
  const movedOff = ensureMovedOffHost(timeline);
  const inDay = [
    ...Array.from(draft.values())
      .filter((placement) => !placement.returnedToAtlas && placement.serviceDate === dateIso)
      .map((placement) => ({ taskId: placement.taskId, dayWindow: placement.dayWindow, sortOrder: placement.sortOrder, editable: true })),
    ...fixedPlacements(automaticWork).map((placement) => ({ ...placement, editable: false })),
  ].filter((placement, index, rows) => rows.findIndex((candidate) => candidate.taskId === placement.taskId) === index)
    .sort((left, right) => windowRank[left.dayWindow] - windowRank[right.dayWindow] || left.sortOrder - right.sortOrder || left.taskId.localeCompare(right.taskId));

  for (const placement of inDay) {
    const entry = taskEntry(placement.taskId);
    if (!entry || !timeline.contains(entry)) continue;
    entry.dataset.ownerDraftWindow = placement.dayWindow;
    entry.dataset.ownerDraftOrder = String(placement.sortOrder);
    delete entry.dataset.ownerDraftOffToday;
    entry.style.opacity = "";
    const reference = nextWindowMarker(timeline, placement.dayWindow);
    if (reference) timeline.insertBefore(entry, reference); else timeline.insertBefore(entry, movedOff);
  }

  for (const placement of draft.values()) {
    if (!placement.returnedToAtlas && placement.serviceDate === dateIso) continue;
    const entry = taskEntry(placement.taskId);
    if (!entry) continue;
    entry.dataset.ownerDraftOffToday = "true";
    entry.dataset.ownerDraftWindow = placement.dayWindow;
    entry.dataset.ownerDraftOrder = String(placement.sortOrder);
    entry.style.opacity = ".62";
    movedOff.appendChild(entry);
  }

  const hasMoved = Array.from(draft.values()).some((placement) => placement.returnedToAtlas || placement.serviceDate !== dateIso);
  movedOff.style.display = hasMoved ? "grid" : "none";
  window.dispatchEvent(new CustomEvent(layoutEvent));
}

function removeInlineHosts() {
  document.querySelectorAll<HTMLElement>('[data-owner-day-inline-controls="true"]').forEach((host) => host.remove());
}

function removeMovedOffHost() {
  document.querySelector<HTMLElement>('[data-owner-day-moved-off="true"]')?.remove();
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
  const [mounts, setMounts] = useState<InlineMount[]>([]);
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
      fetch(`/api/atlas/worker-day-plan?date=${encodeURIComponent(dateIso)}`, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal }),
      fetch(`/api/atlas/day-choreography?date=${encodeURIComponent(dateIso)}`, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal }),
    ]).then(async ([planRequest, choreographyRequest]) => {
      const [planBody, choreographyBody] = await Promise.all([planRequest.json() as Promise<PlanResponse>, choreographyRequest.json() as Promise<ChoreographyResponse>]);
      if (!planRequest.ok || !planBody.ok) throw new Error(planBody.error || "Worker Day could not be loaded.");
      if (!choreographyRequest.ok || !choreographyBody.ok) throw new Error(choreographyBody.error || "Day choreography could not be loaded.");
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
  const suggestions = useMemo(() => (plan?.suggestions ?? []).filter((row) => row.sourceKind === "project_pull" || row.sourceKind === "floating_task"), [plan]);
  const placementOverrides = useMemo(() => choreographyResponse?.choreography?.placementOverrides ?? [], [choreographyResponse]);
  const rowsByTaskId = useMemo(() => new Map(realWork.map((row) => [row.taskId as string, row])), [realWork]);
  const plannerActive = Boolean(planResponse?.active && plan?.availableWorkerDay && dateIso);

  useEffect(() => {
    if (!dateIso || !plan || !choreographyResponse) return;
    const overrides = new Map(placementOverrides.map((placement) => [placement.taskId, placement]));
    const next = new Map<string, DraftPlacement>();
    for (const row of realWork) {
      const taskId = row.taskId as string;
      const placement = overrides.get(taskId);
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

  useEffect(() => {
    function onPotentialToggle(event: Event) {
      const detail = (event as CustomEvent<PotentialToggleDetail>).detail;
      if (!detail?.sourceKind || !detail.sourceId) return;
      const key = candidateKey(detail.sourceKind, detail.sourceId);
      setSelectedAdds((current) => {
        const next = new Set(current);
        if (detail.selected === false) next.delete(key); else next.add(key);
        return next;
      });
    }
    window.addEventListener(potentialEvent, onPotentialToggle as EventListener);
    return () => window.removeEventListener(potentialEvent, onPotentialToggle as EventListener);
  }, []);

  useEffect(() => {
    if (!plannerActive || !realWork.length) return;
    let frame = 0;
    let disposed = false;
    const mount = () => {
      if (disposed) return;
      const next: InlineMount[] = [];
      for (const row of realWork) {
        const taskId = row.taskId as string;
        const entry = taskEntry(taskId);
        if (!entry) continue;
        let host = entry.querySelector<HTMLElement>(':scope > [data-owner-day-inline-controls="true"]');
        if (!host) {
          host = document.createElement("div");
          host.dataset.ownerDayInlineControls = "true";
          host.style.cssText = "grid-column:2/-1;margin:5px 0 8px;padding-left:2px";
          entry.appendChild(host);
        }
        next.push({ taskId, host });
      }
      setMounts(next);
    };
    const queue = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; mount(); });
    };
    queue();
    const observer = new MutationObserver(queue);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      removeInlineHosts();
    };
  }, [plannerActive, realWork]);

  useEffect(() => {
    if (!plannerActive || !dateIso || !draft.size) return;
    const timeline = timelineElement();
    if (!timeline) return;
    applyDraftLayout(timeline, draft, dateIso, automaticWork);
  }, [automaticWork, dateIso, draft, mounts.length, plannerActive]);

  useEffect(() => {
    if (!plannerActive || !dateIso || !baseline.size) return;
    return () => {
      const timeline = timelineElement();
      if (timeline) applyDraftLayout(timeline, baseline, dateIso, automaticWork);
      removeInlineHosts();
      removeMovedOffHost();
      window.dispatchEvent(new CustomEvent(layoutEvent));
    };
  }, [automaticWork, baseline, dateIso, plannerActive]);

  const changedTaskIds = useMemo(() => Array.from(draft.entries()).filter(([taskId, placement]) => !placementEqual(placement, baseline.get(taskId))).map(([taskId]) => taskId), [baseline, draft]);
  const selectedCandidates = useMemo(() => suggestions.filter((candidate) => selectedAdds.has(candidateKey(candidate.sourceKind, candidate.sourceId))), [selectedAdds, suggestions]);
  const dirtyCount = changedTaskIds.length + selectedCandidates.length;

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
    const lane = Array.from(draft.values()).filter((row) => !row.returnedToAtlas && row.serviceDate === dateIso && row.dayWindow === dayWindow).sort((a, b) => a.sortOrder - b.sortOrder);
    const last = lane.at(-1)?.sortOrder ?? 0;
    setPlacement(taskId, (current) => ({ ...current, serviceDate: dateIso as string, dayWindow, sortOrder: last + 100, returnedToAtlas: false }));
  }

  function bump(taskId: string, direction: -1 | 1) {
    const moving = draft.get(taskId);
    if (!moving || moving.returnedToAtlas || moving.serviceDate !== dateIso) return;
    const lane = Array.from(draft.values()).filter((row) => !row.returnedToAtlas && row.serviceDate === dateIso && row.dayWindow === moving.dayWindow).sort((a, b) => a.sortOrder - b.sortOrder);
    const index = lane.findIndex((row) => row.taskId === taskId);
    const swap = lane[index + direction];
    if (!swap) return;
    setDraft((current) => {
      const next = new Map(current);
      next.set(taskId, { ...moving, sortOrder: swap.sortOrder });
      next.set(swap.taskId, { ...swap, sortOrder: moving.sortOrder });
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
      setPendingMove({ taskId, serviceDate, warning: row.timingWarning || "Moving this may miss the preferred farm window." });
      return;
    }
    applyDateMove(taskId, serviceDate);
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

  function resetDraft() {
    setDraft(new Map(Array.from(baseline.entries()).map(([taskId, placement]) => [taskId, { ...placement }])));
    setSelectedAdds(new Set());
    setPendingMove(null);
    setError(null);
    window.dispatchEvent(new CustomEvent(resetEvent));
  }

  function editsForCommit(): DayEdit[] {
    if (!dateIso) return [];
    return changedTaskIds.map((taskId) => {
      const current = draft.get(taskId) as DraftPlacement;
      const original = baseline.get(taskId) as DraftPlacement;
      if (current.returnedToAtlas) return { kind: "return_to_atlas", taskId, serviceDate: dateIso };
      const kind: DayEdit["kind"] = current.serviceDate !== original.serviceDate ? "reschedule" : current.dayWindow !== original.dayWindow ? "rewindow" : current.sortOrder !== original.sortOrder ? "reorder" : "place";
      return { kind, taskId, serviceDate: current.serviceDate, dayWindow: current.dayWindow, sortOrder: current.sortOrder };
    });
  }

  async function commitChanges() {
    if (!dateIso || saving || pendingMove || !dirtyCount) return;
    setSaving(true);
    setError(null);
    try {
      const request = await fetch("/api/atlas/owner-day-commit", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-atlas-intent": "owner-day-commit-v1" },
        body: JSON.stringify({
          date: dateIso,
          edits: editsForCommit(),
          selections: selectedCandidates.map((candidate) => ({ sourceKind: candidate.sourceKind, sourceId: candidate.sourceId })),
        }),
      });
      const body = await request.json() as { ok?: boolean; error?: string; message?: string };
      if (!request.ok || !body.ok) throw new Error(body.message || body.error || "Atlas could not commit these Day changes.");
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Atlas could not commit these Day changes.");
      setSaving(false);
    }
  }

  if (!plannerActive) {
    if (error) return <p style={{ margin: "8px 0", fontSize: 11 }}>{error}</p>;
    return null;
  }

  return (
    <>
      <section data-owner-day-inline-edit-controller="true" style={{ margin: "0 0 10px", padding: "8px 10px", borderRadius: 12, background: "rgba(246,244,252,.72)", border: "1px solid rgba(112,111,177,.18)", display: "grid", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 10.5, color: "#66698d", fontWeight: 800 }}>{dirtyCount ? `${dirtyCount} draft change${dirtyCount === 1 ? "" : "s"}` : "Edit the cards where they sit."}</span>
          <div style={{ display: "flex", gap: 6 }}>
            {dirtyCount ? <button type="button" onClick={resetDraft} style={{ border: 0, background: "transparent", color: "#66698d", font: "inherit", fontSize: 10, fontWeight: 850 }}>Reset</button> : null}
            <button type="button" disabled={!dirtyCount || saving || Boolean(pendingMove)} onClick={() => void commitChanges()} style={{ border: 0, borderRadius: 9, padding: "6px 9px", background: dirtyCount && !saving && !pendingMove ? "#e9e73b" : "rgba(125,128,172,.13)", color: "#303242", font: "inherit", fontSize: 10.5, fontWeight: 900 }}>
              {saving ? "Committing…" : pendingMove ? "Resolve warning" : dirtyCount ? "Commit day" : "No changes"}
            </button>
          </div>
        </div>
        {error ? <span style={{ fontSize: 10.5, lineHeight: 1.35 }}>{error}</span> : null}
      </section>

      <style>{`
        [data-owner-day-inline-controls="true"] button,[data-owner-day-inline-controls="true"] input{font:inherit}
        [data-owner-day-inline-controls="true"] .atlas-inline-day-controls{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
        [data-owner-day-inline-controls="true"] .atlas-inline-day-controls button,[data-owner-day-inline-controls="true"] .atlas-inline-day-date{border:1px solid rgba(112,111,177,.18);border-radius:8px;padding:4px 6px;background:rgba(247,245,252,.76);color:#60638a;font-size:9px;font-weight:850}
        [data-owner-day-inline-controls="true"] .atlas-inline-day-controls button[aria-pressed="true"]{background:rgba(223,219,244,.92)}
      `}</style>

      {mounts.map(({ taskId, host }) => {
        const placement = draft.get(taskId);
        if (!placement || !host.isConnected) return null;
        const changed = !placementEqual(placement, baseline.get(taskId));
        const moveWarning = pendingMove?.taskId === taskId ? pendingMove : null;
        return createPortal(
          <div data-owner-inline-task-editor={taskId}>
            <div className="atlas-inline-day-controls">
              {windows.map((window) => <button key={window.key} type="button" aria-pressed={!placement.returnedToAtlas && placement.serviceDate === dateIso && placement.dayWindow === window.key} onClick={() => moveWindow(taskId, window.key)}>{window.label}</button>)}
              <button type="button" onClick={() => bump(taskId, -1)} disabled={placement.returnedToAtlas || placement.serviceDate !== dateIso} aria-label="Move earlier">↑</button>
              <button type="button" onClick={() => bump(taskId, 1)} disabled={placement.returnedToAtlas || placement.serviceDate !== dateIso} aria-label="Move later">↓</button>
              <button type="button" onClick={() => requestDateMove(taskId, shiftDate(dateIso as string, 1))}>Tomorrow</button>
              <label className="atlas-inline-day-date">Date <input type="date" value={placement.serviceDate} onChange={(event) => requestDateMove(taskId, event.target.value)} style={{ border: 0, background: "transparent", fontSize: 9, maxWidth: 100 }} /></label>
              <button type="button" onClick={() => setPlacement(taskId, (current) => ({ ...current, returnedToAtlas: true }))}>Return to Atlas</button>
              {changed ? <button type="button" onClick={() => undoTask(taskId)}>Undo</button> : null}
            </div>
            {moveWarning ? (
              <div data-owner-day-timing-warning="true" style={{ marginTop: 5, padding: "7px 8px", borderRadius: 9, background: "rgba(255,247,213,.86)", border: "1px solid rgba(139,119,54,.18)", display: "grid", gap: 5 }}>
                <strong style={{ fontSize: 9.5, lineHeight: 1.3 }}>{moveWarning.warning}</strong>
                <div style={{ display: "flex", gap: 5 }}>
                  <button type="button" onClick={() => setPendingMove(null)} style={{ border: "1px solid rgba(112,111,177,.18)", borderRadius: 7, background: "white", fontSize: 9, padding: "4px 6px" }}>Keep current</button>
                  <button type="button" onClick={() => applyDateMove(moveWarning.taskId, moveWarning.serviceDate)} style={{ border: 0, borderRadius: 7, background: "#e9e73b", fontSize: 9, fontWeight: 900, padding: "4px 6px" }}>Move anyway</button>
                </div>
              </div>
            ) : null}
          </div>,
          host,
          `owner-inline-day:${taskId}`,
        );
      })}
    </>
  );
}
