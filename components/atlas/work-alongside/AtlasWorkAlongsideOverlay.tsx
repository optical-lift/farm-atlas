"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Teammate = {
  membershipId: string;
  workerKey: string | null;
  role: string;
  label: string;
};

type WorkAlongsideWindow = {
  windowId: string;
  teammateMembershipId: string;
  startsOn: string;
  endsOn: string;
  status: string;
};

type WorkAlongsideResponse = {
  ok: boolean;
  farmId?: string;
  viewerMembershipId?: string;
  teammates?: Teammate[];
  windows?: WorkAlongsideWindow[];
  error?: string;
};

type TaskCard = {
  task_id: string;
  metadata?: Record<string, unknown> | null;
};

type TaskCardsResponse = {
  ok: boolean;
  taskCards?: TaskCard[];
};

function localTodayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function taskIdFromCard(card: Element) {
  const link = card.matches("a[href]")
    ? card
    : card.querySelector('a[href*="/task-focus/"]');
  const href = link?.getAttribute("href") ?? "";
  const match = href.match(/\/task-focus\/([^/?#]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function shortDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function applyAssigneeBadges(
  taskCards: TaskCard[],
  viewerMembershipId: string,
  teammateByMembership: Map<string, Teammate>,
) {
  const cardById = new Map(taskCards.map((card) => [card.task_id, card]));
  const visibleCards = document.querySelectorAll<HTMLElement>(
    ".atlas-day-task-card, .atlas-journal-completion-echo-copy",
  );

  visibleCards.forEach((cardElement) => {
    const taskId = taskIdFromCard(cardElement);
    const card = taskId ? cardById.get(taskId) : null;
    const executorMembershipId = clean(card?.metadata?.executor_membership_id);
    const executorWorkerKey = clean(card?.metadata?.executor_worker_key).toLowerCase();
    const executorLabel = clean(card?.metadata?.executor_label);

    const target = cardElement.matches("details")
      ? cardElement.querySelector<HTMLElement>(":scope > summary")
      : cardElement;
    const entry = cardElement.closest<HTMLElement>(".atlas-day-task-entry");

    if (!target || !executorMembershipId) {
      target?.removeAttribute("data-atlas-assignee-label");
      target?.removeAttribute("data-atlas-assignee-key");
      entry?.removeAttribute("data-atlas-assignee-key");
      return;
    }

    const ownTask = executorMembershipId === viewerMembershipId;
    const teammate = teammateByMembership.get(executorMembershipId);
    const label = ownTask ? "You" : teammate?.label || executorLabel || "Teammate";
    const initial = ownTask ? "" : `${label.slice(0, 1).toUpperCase()} `;
    const workerKey = ownTask ? "viewer" : teammate?.workerKey || executorWorkerKey || "teammate";

    target.setAttribute("data-atlas-assignee-label", `${initial}${label}`.trim());
    target.setAttribute("data-atlas-assignee-key", workerKey);
    entry?.setAttribute("data-atlas-assignee-key", workerKey);
  });
}

export default function AtlasWorkAlongsideOverlay() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedDate = searchParams.get("date") || localTodayIso();
  const [surface, setSurface] = useState<WorkAlongsideResponse | null>(null);
  const [taskCards, setTaskCards] = useState<TaskCard[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teammateMembershipId, setTeammateMembershipId] = useState("");
  const [startsOn, setStartsOn] = useState(selectedDate);
  const [endsOn, setEndsOn] = useState(addDaysIso(selectedDate, 3));

  useEffect(() => {
    setStartsOn(selectedDate);
    setEndsOn(addDaysIso(selectedDate, 3));
  }, [selectedDate]);

  useEffect(() => {
    if (pathname !== "/day") return;
    let cancelled = false;

    Promise.all([
      fetch("/api/atlas/work-alongside", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      }).then((response) => response.json() as Promise<WorkAlongsideResponse>),
      fetch(`/api/atlas/universal-task-cards?dueThrough=${encodeURIComponent(selectedDate)}&doneDate=${encodeURIComponent(selectedDate)}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      }).then((response) => response.json() as Promise<TaskCardsResponse>),
    ]).then(([workAlongside, tasks]) => {
      if (cancelled) return;
      setSurface(workAlongside);
      setTaskCards(tasks.ok ? tasks.taskCards ?? [] : []);
      const firstAvailable = workAlongside.teammates?.[0]?.membershipId ?? "";
      setTeammateMembershipId((current) => current || firstAvailable);
    }).catch(() => {
      if (!cancelled) setSurface({ ok: false });
    });

    return () => { cancelled = true; };
  }, [pathname, selectedDate]);

  const teammateByMembership = useMemo(
    () => new Map((surface?.teammates ?? []).map((teammate) => [teammate.membershipId, teammate])),
    [surface?.teammates],
  );

  useEffect(() => {
    if (pathname !== "/day" || !surface?.ok || !surface.viewerMembershipId) return;

    const apply = () => applyAssigneeBadges(taskCards, surface.viewerMembershipId as string, teammateByMembership);
    apply();
    const observer = new MutationObserver(() => window.requestAnimationFrame(apply));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname, surface?.ok, surface?.viewerMembershipId, taskCards, teammateByMembership]);

  const activeWindows = surface?.windows ?? [];
  const activeLabels = [...new Set(activeWindows
    .map((window) => teammateByMembership.get(window.teammateMembershipId)?.label)
    .filter((label): label is string => Boolean(label)))];

  async function addWindow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!surface?.farmId || !teammateMembershipId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/atlas/work-alongside", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          farmId: surface.farmId,
          teammateMembershipId,
          startsOn,
          endsOn,
        }),
      });
      const data = await response.json() as WorkAlongsideResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "The window could not be saved.");
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The window could not be saved.");
      setSaving(false);
    }
  }

  async function removeWindow(windowId: string) {
    if (!surface?.farmId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/atlas/work-alongside", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ farmId: surface.farmId, windowId }),
      });
      const data = await response.json() as WorkAlongsideResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "The window could not be removed.");
      window.location.reload();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "The window could not be removed.");
      setSaving(false);
    }
  }

  if (pathname !== "/day" || !surface?.ok || !surface.viewerMembershipId) return null;

  return (
    <aside className="atlas-work-alongside-overlay" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="atlas-work-alongside-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Work alongside</span>
        <strong>{activeLabels.length ? activeLabels.join(" + ") : "Choose teammate"}</strong>
      </button>

      {open ? (
        <section className="atlas-work-alongside-panel" aria-label="Work alongside settings">
          <header>
            <div><span>Visit mode</span><strong>Share the daily trail</strong></div>
            <button type="button" aria-label="Close work alongside settings" onClick={() => setOpen(false)}>×</button>
          </header>

          {activeWindows.length ? (
            <div className="atlas-work-alongside-windows">
              {activeWindows.map((window) => {
                const teammate = teammateByMembership.get(window.teammateMembershipId);
                return (
                  <div key={window.windowId}>
                    <span><b>{teammate?.label || "Teammate"}</b>{shortDate(window.startsOn)}–{shortDate(window.endsOn)}</span>
                    <button type="button" disabled={saving} onClick={() => void removeWindow(window.windowId)}>Remove</button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <form onSubmit={addWindow}>
            <label>
              <span>Teammate</span>
              <select value={teammateMembershipId} onChange={(event) => setTeammateMembershipId(event.target.value)} required>
                {(surface.teammates ?? []).map((teammate) => (
                  <option key={teammate.membershipId} value={teammate.membershipId}>{teammate.label}</option>
                ))}
              </select>
            </label>
            <div className="atlas-work-alongside-dates">
              <label><span>From</span><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required /></label>
              <label><span>Through</span><input type="date" value={endsOn} min={startsOn} onChange={(event) => setEndsOn(event.target.value)} required /></label>
            </div>
            {error ? <p>{error}</p> : null}
            <button type="submit" disabled={saving || !(surface.teammates ?? []).length}>{saving ? "Saving…" : "Add to my Work feed"}</button>
          </form>
        </section>
      ) : null}
    </aside>
  );
}
