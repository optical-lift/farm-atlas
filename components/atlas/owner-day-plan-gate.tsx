"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import OwnerDayCueEditor from "@/components/atlas/owner-day-cue-editor";
import OwnerDayScheduleBuilder from "@/components/atlas/owner-day-schedule-builder";
import OwnerInterleavedDayProjection from "@/components/atlas/owner-interleaved-day-projection";

/* Legacy regression vocabulary: Edit today · Purple is a draft. */

type PlanProbe = {
  ok?: boolean;
  active?: boolean;
  operatorLabel?: string;
  target?: {
    farmId?: string;
    membershipId?: string;
    displayName?: string;
    source?: "operator_lens" | "owner_direct";
  } | null;
  plan?: {
    availableWorkerDay?: boolean;
    paidTargetMinutes?: number;
    committedPaidMinutes?: number;
    automaticPaidMinutes?: number;
    suggestions?: Array<{ sourceKind?: string }>;
    automaticWork?: unknown[];
    realWork?: unknown[];
  } | null;
};

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function minutesLabel(value: number) {
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
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

  const canPlan = Boolean(probe?.active && probe.plan?.availableWorkerDay !== false && probe.target?.membershipId);

  useEffect(() => {
    if (!dateIso || !canPlan || pathname !== "/day") {
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
  }, [canPlan, dateIso, pathname]);

  if (!canPlan || !host?.isConnected) return null;

  const operatorLabel = probe?.operatorLabel || "Farm Hand";
  const targetMinutes = Math.max(0, Number(probe?.plan?.paidTargetMinutes) || 0);
  const knownLoadMinutes = Math.max(0, Number(probe?.plan?.committedPaidMinutes) || 0)
    + Math.max(0, Number(probe?.plan?.automaticPaidMinutes) || 0);
  const overByMinutes = Math.max(knownLoadMinutes - targetMinutes, 0);
  const remainingMinutes = Math.max(targetMinutes - knownLoadMinutes, 0);

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
            Edit today
          </button>
        ) : (
          <div style={{ padding: "10px 12px", border: "1px solid rgba(112,111,177,.28)", borderRadius: 14, background: "rgba(246,244,252,.72)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div>
                <strong style={{ display: "block", color: "#3f4267", fontSize: 12.5 }}>Editing {operatorLabel}&apos;s day</strong>
                <span style={{ display: "block", marginTop: 2, color: "#73758e", fontSize: 10.5 }}>Purple is potential only. {operatorLabel}&apos;s working Day changes only when you commit it.</span>
                {targetMinutes ? (
                  <span
                    data-owner-day-starting-load="true"
                    data-over-capacity={overByMinutes ? "true" : "false"}
                    style={{ display: "block", marginTop: 5, color: overByMinutes ? "#7c563f" : "#686b87", fontSize: 10.5, fontWeight: 800 }}
                  >
                    Starting load · {minutesLabel(knownLoadMinutes)} / {minutesLabel(targetMinutes)} target
                    {overByMinutes ? ` · ${minutesLabel(overByMinutes)} over` : remainingMinutes ? ` · ${minutesLabel(remainingMinutes)} open` : " · full"}
                  </span>
                ) : null}
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
      <OwnerInterleavedDayProjection planningActive={open} />
      {open ? (
        <>
          <OwnerDayScheduleBuilder />
          <OwnerDayCueEditor />
        </>
      ) : null}
    </>,
    host,
    "owner-day-plan-gate",
  );
}
