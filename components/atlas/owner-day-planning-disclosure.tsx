"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

const OWNER_PLANNER_SELECTOR =
  ".atlas-owner-schedule-candidate-entry, .atlas-owner-schedule-automatic-entry";
const PLANNER_HOST_ID = "atlas-owner-planning-toggle-host";

export default function OwnerDayPlanningDisclosure() {
  const pathname = usePathname();
  const [planningOpen, setPlanningOpen] = useState(false);
  const [controlHost, setControlHost] = useState<HTMLElement | null>(null);
  const [plannerAvailable, setPlannerAvailable] = useState(false);

  useEffect(() => {
    if (pathname !== "/day") {
      setPlanningOpen(false);
      setControlHost(null);
      setPlannerAvailable(false);
      return;
    }

    const syncPlannerControl = () => {
      const plannerAvailableNow = Boolean(document.querySelector(OWNER_PLANNER_SELECTOR));
      const timelineGroup = document.querySelector<HTMLElement>(".atlas-day-timeline-group");
      setPlannerAvailable(plannerAvailableNow);

      if (!plannerAvailableNow || !timelineGroup) {
        document.getElementById(PLANNER_HOST_ID)?.remove();
        setControlHost(null);
        return;
      }

      let host = document.getElementById(PLANNER_HOST_ID);
      if (!host) {
        host = document.createElement("div");
        host.id = PLANNER_HOST_ID;
        host.setAttribute("data-atlas-owner-planning-control", "true");

        const heading = timelineGroup.querySelector("h3");
        if (heading?.nextSibling) {
          timelineGroup.insertBefore(host, heading.nextSibling);
        } else if (heading) {
          heading.after(host);
        } else {
          timelineGroup.prepend(host);
        }
      }

      setControlHost(host);
    };

    syncPlannerControl();
    const observer = new MutationObserver(syncPlannerControl);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.getElementById(PLANNER_HOST_ID)?.remove();
      setControlHost(null);
      setPlannerAvailable(false);
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/day") return;

    document.body.dataset.atlasOwnerPlanningOpen = planningOpen ? "true" : "false";
    return () => {
      delete document.body.dataset.atlasOwnerPlanningOpen;
    };
  }, [pathname, planningOpen]);

  return (
    <>
      <style jsx global>{`
        body:not([data-atlas-owner-planning-open="true"])
          .atlas-owner-schedule-candidate-entry,
        body:not([data-atlas-owner-planning-open="true"])
          .atlas-owner-schedule-automatic-entry,
        body:not([data-atlas-owner-planning-open="true"])
          [data-owner-day-schedule-commit="true"],
        body:not([data-atlas-owner-planning-open="true"])
          [data-owner-schedule-synthetic-window="true"] {
          display: none !important;
        }

        [data-atlas-owner-planning-control="true"] {
          margin: 2px 0 14px 36px;
        }

        .atlas-owner-planning-toggle {
          width: calc(100% - 8px);
          min-height: 42px;
          border: 1px solid #d7c8f8;
          border-radius: 14px;
          background: #fbf9ff;
          color: #6246a8;
          padding: 9px 12px;
          font: inherit;
          font-size: 13px;
          font-weight: 800;
          text-align: left;
          cursor: pointer;
          box-shadow: 0 1px 2px rgb(60 35 105 / 7%);
        }

        .atlas-owner-planning-toggle:hover {
          background: #f7f2ff;
          border-color: #c8b2f2;
        }

        .atlas-owner-planning-toggle:focus-visible {
          outline: 3px solid rgb(113 76 181 / 24%);
          outline-offset: 2px;
        }
      `}</style>

      {plannerAvailable && controlHost
        ? createPortal(
            <button
              type="button"
              className="atlas-owner-planning-toggle"
              aria-expanded={planningOpen}
              onClick={() => setPlanningOpen((open) => !open)}
            >
              {planningOpen ? "Close planning" : "+ Plan today"}
            </button>,
            controlHost,
          )
        : null}
    </>
  );
}
