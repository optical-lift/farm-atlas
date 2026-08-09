"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type MowCandidate = {
  id: string;
  title: string;
  location: string | null;
  expectedActiveMinutes: number;
  reason: string | null;
};

type CandidateLike = {
  id?: string;
  sourceKind?: string;
  sourceId?: string;
  title?: string;
  location?: string | null;
  expectedActiveMinutes?: number;
  reason?: string | null;
  dayWindow?: string;
};

type TaskLike = {
  task_id?: string;
  title?: string;
  action_key?: string | null;
  metadata?: Record<string, unknown> | null;
};

type CandidateResponse = {
  ok?: boolean;
  candidates?: CandidateLike[];
};

type TaskCardResponse = {
  ok?: boolean;
  taskCards?: TaskLike[];
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function looksLikeMow(candidate: CandidateLike) {
  return /^mow(?:ing)?\b/i.test(text(candidate.title));
}

function fromCandidate(candidate: CandidateLike): MowCandidate {
  const title = text(candidate.title) || "Mow";
  return {
    id: text(candidate.id) || `mow:${text(candidate.sourceId) || title}`,
    title,
    location: text(candidate.location) || null,
    expectedActiveMinutes: Math.max(1, Math.round(numberValue(candidate.expectedActiveMinutes) || (/follow me/i.test(title) ? 20 : 60))),
    reason: text(candidate.reason) || "Automatic mowing slot. Atlas keeps one mowing area visible for each workday without requiring an Owner tap.",
  };
}

function fromTask(task: TaskLike): MowCandidate {
  const metadata = task.metadata ?? {};
  const rawTitle = text(task.title) || "Mowing";
  const location = text(metadata.display_location) || text(metadata.collection_label) || text(metadata.collection_zone) || null;
  return {
    id: `real-mow-fallback:${text(task.task_id) || rawTitle}`,
    title: rawTitle.replace(/^Mowing\s*[—·:-]\s*/i, "Mow · "),
    location,
    expectedActiveMinutes: Math.max(1, Math.round(numberValue(metadata.estimated_minutes) || (/follow me/i.test(rawTitle) ? 20 : 60))),
    reason: "This workday already has a released mowing task. Atlas is keeping its mowing slot visible even when the dated task feed does not render that card.",
  };
}

function isMowTask(task: TaskLike) {
  const metadata = task.metadata ?? {};
  return text(task.action_key).toLowerCase() === "mow"
    || text(metadata.work_route).toLowerCase() === "mow"
    || text(metadata.work_collection_key).toLowerCase() === "mowing"
    || /^mow(?:ing)?\b/i.test(text(task.title));
}

function minutesLabel(value: number) {
  const minutes = Math.max(0, Math.round(value));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function visibleMowExists(list: HTMLElement) {
  if (list.querySelector('[data-owner-schedule-automatic*="automatic-mow"]')) return true;
  return Array.from(list.querySelectorAll<HTMLElement>(".atlas-day-task-card"))
    .filter((card) => card.dataset.automaticMowFallback !== "true")
    .some((card) => {
      const family = card.querySelector("small")?.textContent ?? "";
      const title = card.querySelector("strong")?.textContent ?? "";
      return /\bmow(?:ing)?\b/i.test(`${family} ${title}`);
    });
}

function FallbackRow({ candidate }: { candidate: MowCandidate }) {
  const detail = [minutesLabel(candidate.expectedActiveMinutes), "outside", candidate.location].filter(Boolean).join(" · ");
  return (
    <div className="atlas-day-task-entry atlas-owner-schedule-automatic-entry" data-automatic-mow-fallback="true">
      <span className="atlas-day-task-node atlas-owner-schedule-automatic-node" aria-hidden="true"><span /></span>
      <div
        className="atlas-day-task-card atlas-owner-schedule-automatic-card"
        data-automatic-mow-fallback="true"
        style={{
          width: "100%",
          border: "1px solid rgba(125,128,172,.24)",
          background: "rgba(250,249,245,.96)",
          boxShadow: "none",
        }}
      >
        <small className="atlas-day-task-family" style={{ color: "#747a9d" }}>Planned · Mow</small>
        <strong>{candidate.title}</strong>
        <span>{detail}</span>
        {candidate.reason ? <em>{candidate.reason}</em> : null}
      </div>
    </div>
  );
}

export default function AutomaticMowFallback() {
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const dateIso = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null;
  const [candidate, setCandidate] = useState<MowCandidate | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setCandidate(null);
    if (!dateIso || window.location.pathname !== "/day") return;
    const controller = new AbortController();

    const fetchJson = async <T,>(url: string): Promise<T | null> => {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return null;
        return await response.json() as T;
      } catch {
        return null;
      }
    };

    void Promise.all([
      fetchJson<CandidateResponse>(`/api/atlas/automatic-day-work?date=${encodeURIComponent(dateIso)}`),
      fetchJson<CandidateResponse>(`/api/atlas/owner-day-projection?date=${encodeURIComponent(dateIso)}`),
      fetchJson<TaskCardResponse>(`/api/atlas/universal-task-cards?dueThrough=${encodeURIComponent(dateIso)}&doneDate=${encodeURIComponent(dateIso)}&exactDate=${encodeURIComponent(dateIso)}`),
    ]).then(([automatic, ownerProjection, taskCards]) => {
      if (controller.signal.aborted) return;
      const automaticMow = automatic?.candidates?.find((row) => looksLikeMow(row));
      if (automaticMow) {
        setCandidate(fromCandidate(automaticMow));
        return;
      }
      const projectedMow = ownerProjection?.candidates?.find((row) => looksLikeMow(row));
      if (projectedMow) {
        setCandidate(fromCandidate(projectedMow));
        return;
      }
      const realMow = taskCards?.taskCards?.find(isMowTask);
      setCandidate(realMow ? fromTask(realMow) : null);
    });

    return () => controller.abort();
  }, [dateIso]);

  useEffect(() => {
    if (!candidate || window.location.pathname !== "/day") {
      host?.remove();
      setHost(null);
      return;
    }

    let disposed = false;
    let frame = 0;
    let currentHost = host;

    const arrange = () => {
      if (disposed) return;
      const list = document.querySelector<HTMLElement>(".atlas-day-mixed-timeline");
      if (!list) return;

      if (visibleMowExists(list)) {
        currentHost?.remove();
        currentHost = null;
        setHost(null);
        return;
      }

      if (!currentHost) {
        currentHost = document.createElement("div");
        currentHost.dataset.automaticMowFallbackHost = "true";
        currentHost.style.display = "contents";
        setHost(currentHost);
      }

      const commitHost = list.querySelector<HTMLElement>('[data-owner-schedule-host="commit"]');
      if (commitHost) {
        if (currentHost.parentNode !== list || currentHost.nextSibling !== commitHost) list.insertBefore(currentHost, commitHost);
      } else if (currentHost.parentNode !== list || currentHost !== list.lastChild) {
        list.appendChild(currentHost);
      }
    };

    const queueArrange = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        arrange();
      });
    };

    queueArrange();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node instanceof HTMLElement && node.dataset.automaticMowFallbackHost))) return;
      queueArrange();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      currentHost?.remove();
    };
  }, [candidate]);

  return candidate && host?.isConnected ? createPortal(<FallbackRow candidate={candidate} />, host) : null;
}
