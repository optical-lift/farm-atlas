"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";

type ProjectionItem = {
  id: string;
  title: string;
  planState: "planned" | "conditional" | "flexible";
  sourceKind: "task" | "floating_task" | "project_pull" | "queue" | "rhythm";
  environment: string | null;
  expectedActiveMinutes: number | null;
  reason: string | null;
};

type ProjectionResponse = {
  ok: boolean;
  active: boolean;
  date: string;
  paidTargetMinutes?: number;
  scheduledPaidMinutes?: number;
  tentativePaidMinutes?: number;
  projectedPaidMinutes?: number;
  paidGapMinutes?: number;
  items?: ProjectionItem[];
  error?: string;
};

function sourceLabel(item: ProjectionItem) {
  if (item.sourceKind === "queue") return "Projected Weed Card";
  if (item.sourceKind === "project_pull") return "Projected Finish Elm";
  if (item.sourceKind === "floating_task") return "Projected farm work";
  if (item.sourceKind === "rhythm") return "Projected rhythm";
  return "Projected task";
}

function detailLine(item: ProjectionItem) {
  const parts: string[] = [];
  if (item.expectedActiveMinutes && item.expectedActiveMinutes > 0) parts.push(`${item.expectedActiveMinutes} min`);
  if (item.environment) parts.push(item.environment === "outdoor" ? "outside" : item.environment);
  if (item.planState === "flexible") parts.push("weather-flexible");
  return parts.join(" · ");
}

export default function FutureDayProjectionBridge() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dateIso = searchParams.get("date") ?? "";
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<ProjectionResponse | null>(null);

  useEffect(() => {
    if (pathname !== "/day") {
      setTarget(null);
      return;
    }

    let stopped = false;
    const findTarget = () => {
      if (stopped) return;
      const next = document.querySelector<HTMLElement>(".atlas-day-task-groups");
      if (next) setTarget(next);
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      stopped = true;
      observer.disconnect();
    };
  }, [pathname, dateIso]);

  useEffect(() => {
    if (pathname !== "/day" || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      setData(null);
      return;
    }

    const controller = new AbortController();
    setData(null);
    void fetch(`/api/atlas/owner-day-projection?date=${encodeURIComponent(dateIso)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json() as ProjectionResponse;
        if (!response.ok || !body.ok) throw new Error(body.error || "Projection unavailable.");
        setData(body);
      })
      .catch((error) => {
        if ((error as Error)?.name !== "AbortError") setData(null);
      });

    return () => controller.abort();
  }, [pathname, dateIso]);

  const items = useMemo(() => data?.items?.filter((item) => item.sourceKind !== "task") ?? [], [data]);
  if (!target || !data?.active || !items.length) return null;

  const targetMinutes = Number(data.paidTargetMinutes) || 0;
  const projectedMinutes = Number(data.projectedPaidMinutes) || 0;
  const overTarget = targetMinutes > 0 && projectedMinutes > targetMinutes;

  return createPortal(
    <article className="atlas-day-route-group atlas-future-projection-group" aria-label="Projected future work">
      <div className="atlas-future-projection-head">
        <div>
          <h3>Possible work</h3>
          <p>{items.length} {items.length === 1 ? "projected task" : "projected tasks"} not released yet</p>
        </div>
        {targetMinutes > 0 ? <strong>{projectedMinutes}/{targetMinutes} min visible</strong> : null}
      </div>
      <div className="atlas-future-projection-note">
        Every current future-day possibility is shown here without becoming an early task. Completion gates, weather and the Weed Card queue can move these before the day arrives.
        {overTarget ? " More work is shown than will fit because this view is for seeing the whole current possibility set; Atlas should release only what fits." : ""}
      </div>
      <div className="atlas-future-projection-list">
        {items.map((item) => (
          <div className="atlas-future-projection-card" data-projection-kind={item.sourceKind} key={item.id}>
            <small>{sourceLabel(item)}</small>
            <strong>{item.title}</strong>
            {detailLine(item) ? <span>{detailLine(item)}</span> : null}
            {item.sourceKind === "queue" ? <em>Moves if an earlier Weed Card is still open.</em> : null}
          </div>
        ))}
      </div>
    </article>,
    target,
  );
}
