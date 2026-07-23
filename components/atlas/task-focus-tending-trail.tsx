"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import TendingTaskTrailPanel from "@/components/atlas/tending-task-trail-panel";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type TrailTarget = {
  taskId: string;
  objectKey: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isWeedingTask(task: AtlasTaskCard) {
  const metadata = task.metadata ?? {};
  return task.action_key === "weed"
    || text(metadata.work_collection_key) === "weeding"
    || text(metadata.work_route) === "weed"
    || text(metadata.display_action) === "weed";
}

export default function TaskFocusTendingTrail() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [target, setTarget] = useState<TrailTarget | null>(null);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/task-focus\/([0-9a-f-]{36})\/?$/i);
    const taskId = match?.[1] ?? null;
    if (!taskId) return;

    let active = true;
    let host: HTMLDivElement | null = null;

    const attach = () => {
      const taskCard = document.querySelector<HTMLElement>(".atlas-task-page-active");
      if (!taskCard || host) return false;
      host = document.createElement("div");
      host.className = "atlas-task-tending-trail-host";
      taskCard.prepend(host);
      setMount(host);
      return true;
    };

    if (!attach()) {
      const observer = new MutationObserver(() => {
        if (attach()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(() => observer.disconnect(), 5000);
    }

    void fetch(`/api/atlas/task-cards?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((data: { ok?: boolean; taskCards?: AtlasTaskCard[] }) => {
        const task = data.ok ? data.taskCards?.[0] : null;
        const objectKey = task?.objects?.[0]?.object_key;
        if (active && task && objectKey && isWeedingTask(task)) {
          setTarget({ taskId, objectKey });
        }
      })
      .catch(() => {
        if (active) setTarget(null);
      });

    return () => {
      active = false;
      host?.remove();
      setMount(null);
      setTarget(null);
    };
  }, []);

  if (!mount || !target) return null;
  return createPortal(
    <TendingTaskTrailPanel taskId={target.taskId} objectKey={target.objectKey} />,
    mount,
  );
}
