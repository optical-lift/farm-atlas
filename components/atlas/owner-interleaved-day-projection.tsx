"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type DayWindow = "morning" | "afternoon" | "evening";
type CommittedItem = { kind: "committed_task"; id: string; taskId: string | null; title: string; dayWindow: DayWindow; sequenceOrder: number };
type PotentialItem = { kind: "potential_task"; id: string; sourceKind: string; sourceId: string; taskId: string | null; title: string; location: string | null; environment: string | null; estimatedMinutes: number | null; dayWindow: DayWindow; sequenceOrder: number; reason: string | null; projectionEligible: boolean };
type CueItem = { kind: "cue"; id: string; cueId: string; cueKind: string; anchorKind: "first_open" | "before_task" | "after_task" | "at_time"; anchorTaskId: string | null; scheduledAt: string | null; title: string; body: string | null; status: string; dayWindow: DayWindow | null; sequenceOrder: number | null; positionResolved: boolean; positionBasis: string };
type SequenceItem = CommittedItem | PotentialItem | CueItem;
type SequenceResponse = { ok?: boolean; active?: boolean; sequence?: { items?: SequenceItem[] } | null };
type ProjectionItem = PotentialItem | CueItem;
type Mount = { item: ProjectionItem; host: HTMLElement };
type EffectivePlacement = { dayWindow: DayWindow; sequenceOrder: number };

const windowRank: Record<DayWindow, number> = { morning: 0, afternoon: 1, evening: 2 };
const potentialEvent = "atlas-owner-day-potential-toggle";
const layoutEvent = "atlas-owner-day-draft-layout";
const resetEvent = "atlas-owner-day-draft-reset";

function minutesLabel(value: number | null) {
  const minutes = Math.max(0, Math.round(value ?? 0));
  if (!minutes) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
function candidateKey(item: PotentialItem) { return `${item.sourceKind}:${item.sourceId}`; }
function clearHosts() { document.querySelectorAll<HTMLElement>('[data-owner-day-sequence-host="true"]').forEach((host) => host.remove()); }
function findTask(timeline: HTMLElement, taskId?: string | null) {
  if (!taskId) return null;
  const target = document.getElementById(`day-task-${taskId}`) as HTMLElement | null;
  return target && timeline.contains(target) && target.dataset.ownerDraftOffToday !== "true" ? target : null;
}
function nextWindow(timeline: HTMLElement, dayWindow: DayWindow) {
  return Array.from(timeline.querySelectorAll<HTMLElement>(".atlas-day-window-marker[data-day-window]"))
    .find((marker) => { const key = marker.dataset.dayWindow as DayWindow | undefined; return key ? windowRank[key] > windowRank[dayWindow] : false; })
    ?? timeline.querySelector<HTMLElement>('[data-owner-day-moved-off="true"]');
}
function effectivePlacement(item: CommittedItem): EffectivePlacement | null {
  if (!item.taskId) return { dayWindow: item.dayWindow, sequenceOrder: item.sequenceOrder };
  const entry = document.getElementById(`day-task-${item.taskId}`) as HTMLElement | null;
  if (entry?.dataset.ownerDraftOffToday === "true") return null;
  const draftWindow = entry?.dataset.ownerDraftWindow as DayWindow | undefined;
  const draftOrder = Number(entry?.dataset.ownerDraftOrder);
  return { dayWindow: draftWindow && draftWindow in windowRank ? draftWindow : item.dayWindow, sequenceOrder: Number.isFinite(draftOrder) ? draftOrder : item.sequenceOrder };
}
function comesAfter(left: EffectivePlacement, right: EffectivePlacement) {
  const windowDifference = windowRank[left.dayWindow] - windowRank[right.dayWindow];
  return windowDifference > 0 || (windowDifference === 0 && left.sequenceOrder > right.sequenceOrder);
}
function isVisibleCue(item: CueItem) { return item.positionResolved && Boolean(item.dayWindow) && !["resolved", "dismissed", "stale"].includes(item.status); }
function visibleSequenceItems(items: SequenceItem[], planningActive: boolean, hiddenPotential: Set<string>) {
  return items.filter((item): item is ProjectionItem => {
    if (item.kind === "cue") return isVisibleCue(item);
    return item.kind === "potential_task" && planningActive && item.projectionEligible && !hiddenPotential.has(candidateKey(item));
  });
}
function referenceForItem(timeline: HTMLElement, item: ProjectionItem, committed: CommittedItem[]) {
  if (item.kind === "cue" && item.anchorTaskId && (item.anchorKind === "before_task" || item.anchorKind === "after_task")) {
    const anchor = findTask(timeline, item.anchorTaskId);
    if (anchor) return { reference: anchor, after: item.anchorKind === "after_task" };
  }
  if (!item.dayWindow || item.sequenceOrder === null) return { reference: null, after: false };
  const target: EffectivePlacement = { dayWindow: item.dayWindow, sequenceOrder: item.sequenceOrder };
  const next = committed
    .map((candidate) => ({ candidate, placement: effectivePlacement(candidate) }))
    .filter((entry): entry is { candidate: CommittedItem; placement: EffectivePlacement } => Boolean(entry.placement && findTask(timeline, entry.candidate.taskId)))
    .filter((entry) => comesAfter(entry.placement, target))
    .sort((left, right) => windowRank[left.placement.dayWindow] - windowRank[right.placement.dayWindow] || left.placement.sequenceOrder - right.placement.sequenceOrder)[0];
  if (next) return { reference: findTask(timeline, next.candidate.taskId), after: false };
  return { reference: nextWindow(timeline, item.dayWindow), after: false };
}
function placeVisibleSequence(timeline: HTMLElement, items: SequenceItem[], planningActive: boolean, hiddenPotential: Set<string>) {
  clearHosts();
  const mounts: Mount[] = [];
  const committed = items.filter((item): item is CommittedItem => item.kind === "committed_task");
  for (const item of visibleSequenceItems(items, planningActive, hiddenPotential)) {
    const { reference, after } = referenceForItem(timeline, item, committed);
    const host = document.createElement("div");
    host.dataset.ownerDaySequenceHost = "true";
    host.dataset.ownerDaySequenceKind = item.kind;
    if (item.kind === "cue" && item.anchorTaskId) host.dataset.ownerDaySequenceAnchorTask = item.anchorTaskId;
    if (item.dayWindow) host.dataset.ownerDaySequenceWindow = item.dayWindow;
    host.className = "atlas-owner-day-sequence-host";
    if (reference && after) reference.insertAdjacentElement("afterend", host); else if (reference) timeline.insertBefore(host, reference); else timeline.appendChild(host);
    mounts.push({ item, host });
  }
  return mounts;
}
function PotentialCard({ item, selected, onSelected, onHide }: { item: PotentialItem; selected: boolean; onSelected: (selected: boolean) => void; onHide: () => void }) {
  const detail = [minutesLabel(item.estimatedMinutes), item.location, item.environment && item.environment !== "either" ? item.environment : null].filter(Boolean).join(" · ");
  return <article className="atlas-owner-potential-day-card" data-owner-potential-day-card="true" data-selected={selected ? "true" : "false"}>
    <span className="atlas-owner-potential-day-node" aria-hidden="true" />
    <small>{selected ? "Will add" : "Potential"} · {item.sourceKind === "project_pull" ? "Finish Elm" : "Atlas work"}</small>
    <strong>{item.title}</strong>
    {detail ? <span>{detail}</span> : null}{item.reason ? <em>{item.reason}</em> : null}
    <div className="atlas-owner-potential-actions"><button type="button" aria-pressed={selected} onClick={() => onSelected(!selected)}>{selected ? "Remove" : "Add"}</button>{!selected ? <button type="button" onClick={onHide}>Not today</button> : null}</div>
  </article>;
}
function cueLabel(item: CueItem) { if (item.anchorKind === "first_open") return "Cue · Start of day"; if (item.anchorKind === "before_task") return "Cue · Before task"; if (item.anchorKind === "after_task") return "Cue · After task"; return "Cue · Timed"; }
function cueTime(value: string | null) { if (!value) return null; const date = new Date(value); if (Number.isNaN(date.getTime())) return null; return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(date); }
function CueMarker({ item }: { item: CueItem }) { const time = item.anchorKind === "at_time" ? cueTime(item.scheduledAt) : null; return <aside className="atlas-owner-day-cue-marker" data-owner-day-sequence-cue="true"><span className="atlas-owner-day-cue-node" aria-hidden="true" /><small>{cueLabel(item)}{time ? ` · ${time}` : ""}</small><strong>{item.title}</strong>{item.body ? <span>{item.body}</span> : null}</aside>; }

export default function OwnerInterleavedDayProjection({ planningActive }: { planningActive: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const dateIso = pathname === "/day" && requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null;
  const [response, setResponse] = useState<SequenceResponse | null>(null);
  const [mounts, setMounts] = useState<Mount[]>([]);
  const [selectedPotential, setSelectedPotential] = useState<Set<string>>(new Set());
  const [hiddenPotential, setHiddenPotential] = useState<Set<string>>(new Set());
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    setResponse(null);
    if (!dateIso) return;
    const controller = new AbortController();
    void fetch(`/api/atlas/worker-day-sequence?date=${encodeURIComponent(dateIso)}`, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (request) => { const body = await request.json() as SequenceResponse; if (!controller.signal.aborted) setResponse(request.ok && body.ok ? body : null); })
      .catch(() => { if (!controller.signal.aborted) setResponse(null); });
    return () => controller.abort();
  }, [dateIso]);

  useEffect(() => {
    const refresh = () => setLayoutVersion((value) => value + 1);
    const reset = () => { setSelectedPotential(new Set()); setHiddenPotential(new Set()); setLayoutVersion((value) => value + 1); };
    window.addEventListener(layoutEvent, refresh); window.addEventListener(resetEvent, reset);
    return () => { window.removeEventListener(layoutEvent, refresh); window.removeEventListener(resetEvent, reset); };
  }, []);
  useEffect(() => { if (!planningActive) { setSelectedPotential(new Set()); setHiddenPotential(new Set()); } }, [planningActive]);

  const items = useMemo(() => response?.sequence?.items ?? [], [response]);
  useEffect(() => {
    clearHosts(); setMounts([]);
    if (!response?.active || !visibleSequenceItems(items, planningActive, hiddenPotential).length) return;
    const timeline = document.querySelector<HTMLElement>(".atlas-day-work-order-group.atlas-day-timeline-group .atlas-day-mixed-timeline");
    if (!timeline) return;
    const frame = window.requestAnimationFrame(() => setMounts(placeVisibleSequence(timeline, items, planningActive, hiddenPotential)));
    return () => { window.cancelAnimationFrame(frame); clearHosts(); };
  }, [hiddenPotential, items, layoutVersion, planningActive, response?.active]);

  function setPotential(item: PotentialItem, selected: boolean) {
    const key = candidateKey(item);
    setSelectedPotential((current) => { const next = new Set(current); if (selected) next.add(key); else next.delete(key); return next; });
    window.dispatchEvent(new CustomEvent(potentialEvent, { detail: { sourceKind: item.sourceKind, sourceId: item.sourceId, selected } }));
  }
  function hidePotential(item: PotentialItem) {
    const key = candidateKey(item);
    setSelectedPotential((current) => { const next = new Set(current); next.delete(key); return next; });
    setHiddenPotential((current) => new Set(current).add(key));
    window.dispatchEvent(new CustomEvent(potentialEvent, { detail: { sourceKind: item.sourceKind, sourceId: item.sourceId, selected: false } }));
  }

  if (!response?.active) return null;
  return <>
    <style>{`
      .atlas-owner-day-sequence-host{position:relative;min-width:0}
      .atlas-owner-potential-day-card{position:relative;margin:2px 0 7px;padding:9px 8px 10px 10px;border:1px dashed rgba(120,124,180,.28);border-radius:13px;background:linear-gradient(90deg,rgba(174,179,212,.20),rgba(246,244,252,.44) 72%,transparent);display:grid;gap:3px;color:#444761}
      .atlas-owner-potential-day-card[data-selected="true"]{border-style:solid;background:linear-gradient(90deg,rgba(174,179,212,.29),rgba(246,244,252,.62) 72%,transparent)}
      .atlas-owner-potential-day-node{position:absolute;top:15px;left:-22px;z-index:3;width:9px;height:9px;border:1.5px dashed rgba(117,121,180,.76);border-radius:999px;background:#f7f4e9;box-shadow:0 0 0 3px #f7f4e9}
      .atlas-owner-potential-day-card small{color:#777dac;font-size:8px;line-height:1;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.atlas-owner-potential-day-card strong{font-size:14px;line-height:1.06;font-weight:950;letter-spacing:-.025em}.atlas-owner-potential-day-card>span:not(.atlas-owner-potential-day-node){color:#74768d;font-size:10px;line-height:1.15;font-weight:800}.atlas-owner-potential-day-card em{color:#76798d;font-size:9px;line-height:1.25;font-style:normal}
      .atlas-owner-potential-actions{display:flex;gap:5px;margin-top:4px}.atlas-owner-potential-actions button{border:1px solid rgba(112,111,177,.2);border-radius:8px;padding:4px 7px;background:rgba(255,255,255,.64);color:#5f628b;font:inherit;font-size:9px;font-weight:850}.atlas-owner-potential-actions button[aria-pressed="true"]{background:rgba(223,219,244,.92)}
      .atlas-owner-day-cue-marker{position:relative;margin:1px 0 8px;padding:7px 8px 9px 10px;border-top:1px solid rgba(95,103,139,.18);border-bottom:1px solid rgba(95,103,139,.12);display:grid;gap:2px;color:#4c5068;background:linear-gradient(90deg,rgba(226,229,239,.46),transparent 78%)}.atlas-owner-day-cue-node{position:absolute;top:12px;left:-21px;z-index:3;width:7px;height:7px;border:1.5px solid rgba(91,99,137,.72);border-radius:999px;background:#f7f4e9;box-shadow:0 0 0 3px #f7f4e9}.atlas-owner-day-cue-marker small{color:#737a9b;font-size:8px;font-weight:950;letter-spacing:.1em;text-transform:uppercase}.atlas-owner-day-cue-marker strong{font-size:12px;line-height:1.1;font-weight:900}.atlas-owner-day-cue-marker>span:not(.atlas-owner-day-cue-node){color:#77798c;font-size:9.5px;line-height:1.2}
    `}</style>
    <span data-owner-day-normal-sequence-cues="true" hidden />
    {mounts.map(({ item, host }) => createPortal(item.kind === "potential_task" ? <PotentialCard item={item} selected={selectedPotential.has(candidateKey(item))} onSelected={(selected) => setPotential(item, selected)} onHide={() => hidePotential(item)} /> : <CueMarker item={item} />, host, `owner-day-sequence:${item.id}`))}
  </>;
}
