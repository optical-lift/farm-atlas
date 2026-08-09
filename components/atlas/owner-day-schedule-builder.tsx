"use client";

import { createPortal } from "react-dom";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { atlasDayTaskPartnerKey } from "@/lib/atlas/day-route";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import { atlasWorkOrderAnchorForTask, atlasWorkOrderNumber } from "@/lib/atlas/work-order";

type CandidateKind = "project_pull" | "floating_task" | "queue" | "rhythm";
type CandidateWindow = "morning" | "afternoon" | "evening";

type ScheduleCandidate = {
  id: string;
  sourceKind: CandidateKind;
  sourceId: string;
  title: string;
  note: string | null;
  environment: string | null;
  location: string | null;
  expectedActiveMinutes: number;
  approved: boolean;
  conditional: boolean;
  fitsWithinCurrentRemaining: boolean;
  recommended: boolean;
  reason: string | null;
  dayWindow: CandidateWindow;
  workOrderNumber: number;
};

type ScheduleBuilderResponse = {
  ok?: boolean;
  active?: boolean;
  operatorLabel?: string;
  paidTargetMinutes?: number;
  scheduledPaidMinutes?: number;
  approvedConditionalMinutes?: number;
  remainingPaidMinutes?: number;
  candidates?: ScheduleCandidate[];
  error?: string;
};

type TaskPlacement = {
  id: string;
  title: string;
  window: CandidateWindow;
  order: number;
};

type PartnerPlan = Map<string, { window: CandidateWindow; order: number }>;

const windowOrder: Record<CandidateWindow, number> = { morning: 0, afternoon: 1, evening: 2 };
const windowLabels: Record<CandidateWindow, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
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
  if (kind === "project_pull") return "Finish Elm";
  if (kind === "queue") return "Weed Card";
  if (kind === "floating_task") return "Atlas paid work";
  return "Farm rhythm";
}

function environmentLabel(value: string | null) {
  if (!value || value === "either") return null;
  return value === "outdoor" ? "outside" : value;
}

function metadata(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
}

function isChildTask(task: AtlasTaskCard) {
  return Boolean(task.parent_task_id) || metadata(task, "is_child_task") === true || metadata(task, "is_child_task") === "true";
}

function isTimelineTask(task: AtlasTaskCard) {
  return task.status !== "archived" && task.status !== "skipped" && !isChildTask(task);
}

function taskWindow(task: AtlasTaskCard): CandidateWindow {
  const anchor = atlasWorkOrderAnchorForTask(task);
  if (anchor === "top" || anchor === "morning") return "morning";
  if (anchor === "midday" || anchor === "visibility") return "afternoon";
  return "evening";
}

function buildPartnerPlan(tasks: AtlasTaskCard[]): PartnerPlan {
  const candidates = new Map<string, Map<CandidateWindow, { count: number; order: number }>>();
  for (const task of tasks) {
    const key = atlasDayTaskPartnerKey(task);
    if (!key) continue;
    const window = taskWindow(task);
    const order = atlasWorkOrderNumber(task);
    const byWindow = candidates.get(key) ?? new Map<CandidateWindow, { count: number; order: number }>();
    const current = byWindow.get(window);
    byWindow.set(window, { count: (current?.count ?? 0) + 1, order: Math.min(current?.order ?? order, order) });
    candidates.set(key, byWindow);
  }

  const plan: PartnerPlan = new Map();
  for (const [key, byWindow] of candidates) {
    const winner = Array.from(byWindow.entries()).sort((left, right) => {
      if (left[1].count !== right[1].count) return right[1].count - left[1].count;
      const windowDifference = windowOrder[left[0]] - windowOrder[right[0]];
      if (windowDifference) return windowDifference;
      return left[1].order - right[1].order;
    })[0];
    if (winner) plan.set(key, { window: winner[0], order: winner[1].order });
  }
  return plan;
}

function taskPlacements(tasks: AtlasTaskCard[], dateIso: string) {
  const visible = tasks.filter(isTimelineTask);
  const partners = buildPartnerPlan(visible);
  return visible.map((task): TaskPlacement => {
    const belongsToWorkingDay = Boolean(task.due_date && task.due_date <= dateIso);
    const partner = belongsToWorkingDay ? partners.get(atlasDayTaskPartnerKey(task)) : null;
    return {
      id: task.task_id,
      title: atlasTaskDisplay(task).title,
      window: partner?.window ?? taskWindow(task),
      order: partner?.order ?? atlasWorkOrderNumber(task),
    };
  }).sort((left, right) => {
    const windowDifference = windowOrder[left.window] - windowOrder[right.window];
    if (windowDifference) return windowDifference;
    if (left.order !== right.order) return left.order - right.order;
    return left.title.localeCompare(right.title);
  });
}

function candidateSort(left: ScheduleCandidate, right: ScheduleCandidate) {
  const windowDifference = windowOrder[left.dayWindow] - windowOrder[right.dayWindow];
  if (windowDifference) return windowDifference;
  if (left.workOrderNumber !== right.workOrderNumber) return left.workOrderNumber - right.workOrderNumber;
  return left.title.localeCompare(right.title);
}

function CandidateRow({ candidate, selected, onToggle }: { candidate: ScheduleCandidate; selected: boolean; onToggle: () => void }) {
  const env = environmentLabel(candidate.environment);
  const detail = [sourceLabel(candidate.sourceKind), minutesLabel(candidate.expectedActiveMinutes), env, candidate.location].filter(Boolean).join(" · ");
  const active = candidate.approved || selected;

  return (
    <div className="atlas-day-task-entry atlas-owner-schedule-candidate-entry" data-owner-schedule-candidate={candidate.id}>
      <button
        type="button"
        className={`atlas-day-task-node${active ? " is-complete" : ""}`}
        aria-label={candidate.approved ? `${candidate.title} already approved` : selected ? `Remove ${candidate.title} from schedule draft` : `Add ${candidate.title} to schedule draft`}
        aria-pressed={active}
        disabled={candidate.approved}
        onClick={onToggle}
        style={{ borderColor: "rgba(112, 111, 177, .72)" }}
      ><span aria-hidden="true" /></button>
      <button
        type="button"
        className="atlas-day-task-card atlas-owner-schedule-candidate-card"
        aria-pressed={active}
        disabled={candidate.approved}
        onClick={onToggle}
        style={{
          width: "100%",
          font: "inherit",
          color: "inherit",
          textAlign: "left",
          cursor: candidate.approved ? "default" : "pointer",
          border: active ? "1px solid rgba(112,111,177,.55)" : "1px dashed rgba(112,111,177,.42)",
          background: active ? "rgba(238,236,250,.98)" : "rgba(246,244,252,.86)",
          boxShadow: active ? "0 8px 24px rgba(76,72,130,.08)" : "none",
          opacity: candidate.approved ? .8 : 1,
        }}
      >
        <small className="atlas-day-task-family" style={{ color: "#777bb0" }}>
          {candidate.approved ? "Approved idea" : selected ? "Selected idea" : "Suggested"} · {sourceLabel(candidate.sourceKind)}
        </small>
        <strong>{candidate.title}</strong>
        <span>{detail}</span>
        {candidate.note || candidate.reason ? <em>{candidate.note || candidate.reason}</em> : null}
      </button>
    </div>
  );
}

function CommitSchedule({ operatorLabel, selectedCount, selectedMinutes, committedMinutes, proposedMinutes, targetMinutes, overBy, saving, error, canBuild, onBuild }: {
  operatorLabel: string;
  selectedCount: number;
  selectedMinutes: number;
  committedMinutes: number;
  proposedMinutes: number;
  targetMinutes: number;
  overBy: number;
  saving: boolean;
  error: string | null;
  canBuild: boolean;
  onBuild: () => void;
}) {
  return (
    <section
      data-owner-day-schedule-commit="true"
      aria-label={`Commit ${operatorLabel}'s schedule`}
      style={{
        margin: "22px 0 6px 36px",
        padding: "14px",
        border: "1px solid rgba(125,128,172,.24)",
        borderRadius: 16,
        background: "rgba(244,241,250,.8)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div>
          <span style={{ display: "block", fontSize: 10, fontWeight: 950, letterSpacing: ".12em", textTransform: "uppercase", color: "#7c81b6" }}>Schedule draft</span>
          <strong style={{ display: "block", marginTop: 3, fontSize: 15 }}>Commit {operatorLabel}&apos;s day</strong>
        </div>
        {targetMinutes > 0 ? <strong style={{ fontSize: 12 }}>{minutesLabel(proposedMinutes)} / {minutesLabel(targetMinutes)}</strong> : null}
      </div>
      <p style={{ margin: "7px 0 10px", fontSize: 11.5, lineHeight: 1.4, opacity: .7 }}>
        {selectedCount
          ? `${selectedCount} purple ${selectedCount === 1 ? "task" : "tasks"} selected · ${minutesLabel(selectedMinutes)} added to ${minutesLabel(committedMinutes)} already committed.`
          : `Purple cards are still only ideas. ${minutesLabel(committedMinutes)} is already committed.`}
      </p>
      {overBy > 0 ? <p style={{ margin: "0 0 9px", fontSize: 11.5, lineHeight: 1.4 }}>Remove {minutesLabel(overBy)} before committing this day.</p> : null}
      {error ? <p style={{ margin: "0 0 9px", fontSize: 11.5, lineHeight: 1.4 }}>{error}</p> : null}
      <button
        type="button"
        disabled={!canBuild}
        onClick={onBuild}
        style={{
          width: "100%",
          border: 0,
          borderRadius: 12,
          padding: "11px 12px",
          fontSize: 13,
          fontWeight: 900,
          background: canBuild ? "#e9e73b" : "rgba(125,128,172,.13)",
          color: "#303242",
        }}
      >
        {saving ? "Committing schedule…" : selectedCount ? "Commit schedule" : "Tap purple work above to add it"}
      </button>
    </section>
  );
}

export default function OwnerDayScheduleBuilder() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const dateIso = pathname === "/day" && requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null;
  const [response, setResponse] = useState<ScheduleBuilderResponse | null>(null);
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalEpoch, setPortalEpoch] = useState(0);
  const candidateHosts = useRef(new Map<string, HTMLElement>());
  const commitHost = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setResponse(null);
    setTasks([]);
    setSelected(new Set());
    setError(null);
    if (!dateIso) return;

    const controller = new AbortController();
    const isFutureDay = dateIso > todayIso();
    void Promise.all([
      fetch(`/api/atlas/owner-day-projection?date=${encodeURIComponent(dateIso)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }).then(async (request) => {
        const body = await request.json() as ScheduleBuilderResponse;
        if (!request.ok || !body.ok) throw new Error(body.error || "Schedule ideas could not be loaded.");
        return body;
      }),
      fetchAtlasTaskCards({ viewerScoped: true, dueThrough: dateIso, doneDate: dateIso, exactDate: isFutureDay ? dateIso : undefined }),
    ])
      .then(([body, taskResponse]) => {
        if (controller.signal.aborted) return;
        setResponse(body);
        setTasks(taskResponse.taskCards ?? []);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Schedule ideas could not be loaded.");
      });

    return () => controller.abort();
  }, [dateIso]);

  const candidates = useMemo(() => [...(response?.candidates ?? [])].sort(candidateSort), [response]);
  const placements = useMemo(() => dateIso ? taskPlacements(tasks, dateIso) : [], [dateIso, tasks]);
  const selectedCandidates = useMemo(() => candidates.filter((candidate) => selected.has(candidate.id) && !candidate.approved), [candidates, selected]);
  const selectedMinutes = selectedCandidates.reduce((total, candidate) => total + candidate.expectedActiveMinutes, 0);
  const targetMinutes = Math.max(0, Number(response?.paidTargetMinutes) || 0);
  const scheduledMinutes = Math.max(0, Number(response?.scheduledPaidMinutes) || 0);
  const conditionalMinutes = Math.max(0, Number(response?.approvedConditionalMinutes) || 0);
  const committedMinutes = scheduledMinutes + conditionalMinutes;
  const proposedMinutes = committedMinutes + selectedMinutes;
  const overBy = Math.max(0, proposedMinutes - targetMinutes);
  const operatorLabel = response?.operatorLabel || "Anna";
  const canBuild = Boolean(dateIso && selectedCandidates.length && !saving && overBy === 0);

  useEffect(() => {
    function cleanup() {
      for (const host of candidateHosts.current.values()) host.remove();
      candidateHosts.current.clear();
      commitHost.current?.remove();
      commitHost.current = null;
      document.querySelectorAll('[data-owner-schedule-synthetic-window="true"]').forEach((node) => node.remove());
    }

    if (!response?.active || !candidates.length || pathname !== "/day") {
      cleanup();
      return cleanup;
    }

    let scheduledFrame = 0;
    let disposed = false;

    function ensureSyntheticMarker(list: HTMLElement, window: CandidateWindow) {
      const existing = list.querySelector<HTMLElement>(`.atlas-day-window-marker[data-day-window="${window}"]`);
      if (existing) return existing;
      const marker = document.createElement("div");
      marker.className = "atlas-day-window-marker atlas-owner-schedule-window-marker";
      marker.dataset.dayWindow = window;
      marker.dataset.ownerScheduleSyntheticWindow = "true";
      const label = document.createElement("span");
      label.textContent = windowLabels[window];
      const detail = document.createElement("em");
      detail.textContent = "suggested work";
      marker.append(label, detail);

      const laterWindows = (Object.keys(windowOrder) as CandidateWindow[])
        .filter((candidateWindow) => windowOrder[candidateWindow] > windowOrder[window])
        .sort((left, right) => windowOrder[left] - windowOrder[right]);
      const nextMarker = laterWindows
        .map((candidateWindow) => list.querySelector<HTMLElement>(`.atlas-day-window-marker[data-day-window="${candidateWindow}"]`))
        .find(Boolean) ?? null;
      if (nextMarker) list.insertBefore(marker, nextMarker);
      else if (commitHost.current?.parentNode === list) list.insertBefore(marker, commitHost.current);
      else list.appendChild(marker);
      return marker;
    }

    function arrange() {
      if (disposed) return;
      const list = document.querySelector<HTMLElement>(".atlas-day-mixed-timeline");
      if (!list) return;
      let targetsChanged = false;

      if (!commitHost.current) {
        const host = document.createElement("div");
        host.dataset.ownerScheduleHost = "commit";
        host.style.display = "contents";
        commitHost.current = host;
        targetsChanged = true;
      }
      if (commitHost.current.parentNode !== list || commitHost.current !== list.lastChild) list.appendChild(commitHost.current);

      const liveIds = new Set(candidates.map((candidate) => candidate.id));
      for (const [id, host] of candidateHosts.current) {
        if (!liveIds.has(id)) {
          host.remove();
          candidateHosts.current.delete(id);
          targetsChanged = true;
        }
      }
      for (const candidate of candidates) {
        if (!candidateHosts.current.has(candidate.id)) {
          const host = document.createElement("div");
          host.dataset.ownerScheduleHost = candidate.id;
          host.style.display = "contents";
          candidateHosts.current.set(candidate.id, host);
          targetsChanged = true;
        }
      }

      const candidateWindows = new Set(candidates.map((candidate) => candidate.dayWindow));
      for (const window of candidateWindows) ensureSyntheticMarker(list, window);

      for (const window of ["morning", "afternoon", "evening"] as CandidateWindow[]) {
        const rows = [
          ...placements.filter((row) => row.window === window).map((row) => ({ kind: "task" as const, id: row.id, order: row.order, title: row.title })),
          ...candidates.filter((candidate) => candidate.dayWindow === window).map((candidate) => ({ kind: "candidate" as const, id: candidate.id, order: candidate.workOrderNumber, title: candidate.title })),
        ].sort((left, right) => left.order !== right.order ? left.order - right.order : left.title.localeCompare(right.title));

        const laterMarker = list.querySelector<HTMLElement>(`.atlas-day-window-marker[data-day-window="${window === "morning" ? "afternoon" : window === "afternoon" ? "evening" : "__none__"}"]`);
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index];
          if (row.kind !== "candidate") continue;
          const host = candidateHosts.current.get(row.id);
          if (!host) continue;

          let reference: Element | null = null;
          for (let nextIndex = index + 1; nextIndex < rows.length; nextIndex += 1) {
            const next = rows[nextIndex];
            if (next.kind === "candidate") {
              const nextHost = candidateHosts.current.get(next.id);
              if (nextHost?.parentNode === list) { reference = nextHost; break; }
            } else {
              const taskNode = document.getElementById(`day-task-${next.id}`);
              const taskEntry = taskNode?.closest(".atlas-day-task-entry") ?? taskNode;
              if (taskEntry && list.contains(taskEntry)) { reference = taskEntry; break; }
            }
          }
          if (!reference) reference = laterMarker ?? commitHost.current;
          if (reference && (host.parentNode !== list || host.nextSibling !== reference)) list.insertBefore(host, reference);
        }
      }

      if (targetsChanged) setPortalEpoch((value) => value + 1);
    }

    function queueArrange() {
      if (scheduledFrame) return;
      scheduledFrame = window.requestAnimationFrame(() => {
        scheduledFrame = 0;
        arrange();
      });
    }

    queueArrange();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node instanceof HTMLElement && node.dataset.ownerScheduleHost))) return;
      queueArrange();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", queueArrange);

    return () => {
      disposed = true;
      if (scheduledFrame) window.cancelAnimationFrame(scheduledFrame);
      observer.disconnect();
      window.removeEventListener("resize", queueArrange);
      cleanup();
    };
  }, [candidates, placements, pathname, response?.active]);

  function toggle(candidate: ScheduleCandidate) {
    if (candidate.approved) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
    setError(null);
  }

  async function buildSchedule() {
    if (!canBuild || !dateIso) return;
    setSaving(true);
    setError(null);
    try {
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
      if (!request.ok || !body.ok) throw new Error(body.message || body.error || "Atlas could not build the schedule.");
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Atlas could not build the schedule.");
      setSaving(false);
    }
  }

  if (!response?.active || !candidates.length) return null;

  return (
    <Fragment key={portalEpoch}>
      {candidates.map((candidate) => {
        const host = candidateHosts.current.get(candidate.id);
        if (!host?.isConnected) return null;
        return createPortal(
          <CandidateRow candidate={candidate} selected={selected.has(candidate.id)} onToggle={() => toggle(candidate)} />,
          host,
          candidate.id,
        );
      })}
      {commitHost.current?.isConnected ? createPortal(
        <CommitSchedule
          operatorLabel={operatorLabel}
          selectedCount={selectedCandidates.length}
          selectedMinutes={selectedMinutes}
          committedMinutes={committedMinutes}
          proposedMinutes={proposedMinutes}
          targetMinutes={targetMinutes}
          overBy={overBy}
          saving={saving}
          error={error}
          canBuild={canBuild}
          onBuild={() => void buildSchedule()}
        />,
        commitHost.current,
        "owner-schedule-commit",
      ) : null}
    </Fragment>
  );
}
