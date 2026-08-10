"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import OwnerDayScheduleBuilder from "@/components/atlas/owner-day-schedule-builder";

type PlanProbe = {
  ok?: boolean;
  active?: boolean;
  operatorLabel?: string;
  plan?: {
    availableWorkerDay?: boolean;
    suggestions?: Array<{ sourceKind?: string }>;
    automaticWork?: unknown[];
  } | null;
};

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export default function OwnerDayPlanGate() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const dateIso = pathname === "/day" && validDateIso(requestedDate) ? requestedDate : null;
  const [probe, setProbe] = useState<PlanProbe | null>(null);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setProbe(null);
    setOpen(false);
    if (!dateIso) return;

    const controller = new AbortController();
    void fetch(`/api/atlas/worker-day-plan?date=${encodeURIComponent(dateIso)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (request) => {
      const body = await request.json() as PlanProbe;
      if (!controller.signal.aborted) setProbe(request.ok && body.ok ? body : null);
    }).catch(() => {
      if (!controller.signal.aborted) setProbe(null);
    });

    return () => controller.abort();
  }, [dateIso]);

  const canPlan = Boolean(probe?.active && probe.plan?.availableWorkerDay !== false);
  const hasPlanningWork = useMemo(() => {
    const suggestions = probe?.plan?.suggestions ?? [];
    const selectable = suggestions.some((row) => row.sourceKind === "project_pull" || row.sourceKind === "floating_task");
    const automatic = (probe?.plan?.automaticWork?.length ?? 0) > 0;
    return selectable || automatic;
  }, [probe]);

  useEffect(() => {
    if (!dateIso || !canPlan || !hasPlanningWork || pathname !== "/day") {
      setHost((current) => {
        current?.remove();
        return null;
      });
      return;
    }

    let disposed = false;
    let frame = 0;

    const mount = () => {
      if (disposed) return;
      const group = document.querySelector<HTMLElement>(".atlas-day-work-order-group.atlas-day-timeline-group");
      const timeline = group?.querySelector<HTMLElement>(".atlas-day-mixed-timeline");
      if (!group || !timeline) return;

      let nextHost = group.querySelector<HTMLElement>('[data-owner-day-plan-gate="true"]');
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.dataset.ownerDayPlanGate = "true";
        group.insertBefore(nextHost, timeline);
      }
      setHost((current) => current === nextHost ? current : nextHost);
    };

    const queueMount = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        mount();
      });
    };

    queueMount();
    const observer = new MutationObserver(queueMount);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      setHost((current) => {
        current?.remove();
        return null;
      });
    };
  }, [canPlan, dateIso, hasPlanningWork, pathname]);

  if (!canPlan || !hasPlanningWork || !host?.isConnected) return null;

  const operatorLabel = probe?.operatorLabel || "Anna";

  return createPortal(
    <>
      <div style={{ margin: "2px 0 12px", display: "grid", gap: 8 }}>
        {!open ? (
          <button
            type="button"
            aria-expanded="false"
            onClick={() => setOpen(true)}
            style={{
              width: "100%",
              border: "1px solid rgba(112,111,177,.28)",
              borderRadius: 14,
              padding: "10px 12px",
              background: "rgba(246,244,252,.72)",
              color: "#555887",
              font: "inherit",
              fontSize: 12,
              fontWeight: 900,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            Plan today
          </button>
        ) : (
          <div style={{ padding: "10px 12px", border: "1px solid rgba(112,111,177,.28)", borderRadius: 14, background: "rgba(246,244,252,.72)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div>
                <strong style={{ display: "block", color: "#3f4267", fontSize: 12.5 }}>Planning {operatorLabel}&apos;s day</strong>
                <span style={{ display: "block", marginTop: 2, color: "#73758e", fontSize: 10.5 }}>Nothing enters the working day until you commit it.</span>
              </div>
              <button
                type="button"
                aria-expanded="true"
                onClick={() => setOpen(false)}
                style={{ border: 0, background: "transparent", color: "#676a96", font: "inherit", fontSize: 11, fontWeight: 900, cursor: "pointer" }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
      {open ? <OwnerDayScheduleBuilder /> : null}
    </>,
    host,
    "owner-day-plan-gate",
  );
}
