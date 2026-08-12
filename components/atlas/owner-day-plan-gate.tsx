"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import OwnerDayCueEditor from "@/components/atlas/owner-day-cue-editor";
import OwnerDayScheduleBuilder from "@/components/atlas/owner-day-schedule-builder";

type AutomaticWorkRow = {
  id?: string;
  title?: string;
  sourceKind?: string;
  conditional?: boolean;
  reason?: string | null;
  location?: string | null;
};

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
    automaticWork?: AutomaticWorkRow[];
  } | null;
};

type Props = {
  dateIso: string;
};

function validDateIso(value: string | null | undefined) {
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

function dayEditTarget() {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(".atlas-day-task-groups");
}

export default function OwnerDayPlanGate({ dateIso }: Props) {
  const [probe, setProbe] = useState<PlanProbe | null>(null);
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setProbe(null);
    setOpen(false);
    if (!validDateIso(dateIso)) return;

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

  useEffect(() => {
    if (!open) {
      setPortalTarget(null);
      return;
    }

    const target = dayEditTarget();
    if (!target) return;

    target.classList.add("atlas-owner-day-plan-active");
    setPortalTarget(target);
    return () => {
      target.classList.remove("atlas-owner-day-plan-active");
    };
  }, [open]);

  const canPlan = Boolean(probe?.active && probe.plan?.availableWorkerDay !== false && probe.target?.membershipId);
  if (!canPlan) return null;

  const operatorLabel = probe?.operatorLabel || "Farm Hand";
  const targetMinutes = Math.max(0, Number(probe?.plan?.paidTargetMinutes) || 0);
  const knownLoadMinutes = Math.max(0, Number(probe?.plan?.committedPaidMinutes) || 0)
    + Math.max(0, Number(probe?.plan?.automaticPaidMinutes) || 0);
  const overByMinutes = Math.max(knownLoadMinutes - targetMinutes, 0);
  const remainingMinutes = Math.max(targetMinutes - knownLoadMinutes, 0);
  const projectedWeed = (probe?.plan?.automaticWork ?? []).find((item) => (
    item?.sourceKind === "queue"
    && item?.conditional === true
    && typeof item?.title === "string"
    && item.title.trim().length > 0
  ));

  const editBoard = open ? (
    <div className="atlas-owner-day-plan-inline-root" data-owner-day-plan-inline="true">
      <OwnerDayScheduleBuilder />
      <OwnerDayCueEditor />
    </div>
  ) : null;

  return (
    <section className="atlas-owner-day-plan-gate" data-owner-day-plan-gate="true">
      <style>{`
        .atlas-owner-day-plan-active > :not(.atlas-owner-day-plan-inline-root) {
          display: none !important;
        }
        .atlas-owner-day-plan-inline-root {
          display: grid;
          gap: 10px;
        }
        .atlas-owner-day-projection {
          margin: 2px 0 8px;
          padding: 9px 11px;
          border: 1px dashed rgba(112,111,177,.28);
          border-radius: 12px;
          background: rgba(249,248,252,.64);
          color: #5f627e;
        }
        .atlas-owner-day-projection strong {
          display: block;
          font-size: 11.5px;
          line-height: 1.3;
        }
        .atlas-owner-day-projection span {
          display: block;
          margin-top: 2px;
          color: #85879b;
          font-size: 10px;
          line-height: 1.35;
        }
      `}</style>
      {projectedWeed ? (
        <div className="atlas-owner-day-projection" data-owner-projected-weed-card="true">
          <strong>Projected Weed Card · {projectedWeed.title}</strong>
          <span>If the prior workday&apos;s Weed Card clears. This is a projection, not another released task.</span>
        </div>
      ) : null}
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
                <span style={{ display: "block", marginTop: 2, color: "#73758e", fontSize: 10.5 }}>Purple is a draft. {operatorLabel}&apos;s working Day changes only when you commit it.</span>
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
      {open && portalTarget ? createPortal(editBoard, portalTarget) : editBoard}
    </section>
  );
}
