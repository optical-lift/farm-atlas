"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const HOST_ID = "atlas-owner-planning-toggle-host";

function plannerExists() {
  return Boolean(
    document.querySelector('[data-owner-schedule-candidate]')
      || document.querySelector('[data-owner-day-schedule-commit="true"]'),
  );
}

export default function FutureDayProjectionBridge() {
  const pathname = usePathname();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [planningOpen, setPlanningOpen] = useState(false);

  useEffect(() => {
    setPlanningOpen(false);
    document.body.dataset.atlasOwnerPlanningOpen = "false";

    if (pathname !== "/day") {
      document.getElementById(HOST_ID)?.remove();
      setHost(null);
      return;
    }

    let frame = 0;
    let disposed = false;

    function syncToggle() {
      if (disposed) return;
      const timeline = document.querySelector<HTMLElement>(".atlas-day-timeline-group");
      const existing = document.getElementById(HOST_ID);

      if (!timeline || !plannerExists()) {
        existing?.remove();
        setHost(null);
        return;
      }

      const title = timeline.querySelector(":scope > h3");
      let nextHost = existing;
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.id = HOST_ID;
        nextHost.dataset.atlasOwnerPlanningToggleHost = "true";
      }

      if (title) {
        if (nextHost.parentNode !== timeline || nextHost.previousElementSibling !== title) {
          title.insertAdjacentElement("afterend", nextHost);
        }
      } else if (nextHost.parentNode !== timeline) {
        timeline.prepend(nextHost);
      }

      setHost((current) => current === nextHost ? current : nextHost);
    }

    function queueSync() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncToggle();
      });
    }

    queueSync();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node instanceof HTMLElement && node.id === HOST_ID))) return;
      queueSync();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.getElementById(HOST_ID)?.remove();
      delete document.body.dataset.atlasOwnerPlanningOpen;
      setHost(null);
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/day") return;
    document.body.dataset.atlasOwnerPlanningOpen = planningOpen ? "true" : "false";
  }, [pathname, planningOpen]);

  const styles = (
    <style>{`
      body:not([data-atlas-owner-planning-open="true"]) .atlas-owner-schedule-candidate-entry,
      body:not([data-atlas-owner-planning-open="true"]) .atlas-owner-schedule-automatic-entry,
      body:not([data-atlas-owner-planning-open="true"]) [data-owner-day-schedule-commit="true"],
      body:not([data-atlas-owner-planning-open="true"]) [data-owner-schedule-synthetic-window="true"] {
        display: none !important;
      }

      #${HOST_ID} {
        margin: -2px 0 12px 36px;
      }

      .atlas-owner-planning-toggle {
        width: calc(100% - 2px);
        min-height: 38px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid rgba(112, 111, 177, .24);
        border-radius: 12px;
        padding: 8px 11px;
        background: rgba(250, 249, 245, .94);
        color: #5f6282;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .atlas-owner-planning-toggle strong {
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .02em;
      }

      .atlas-owner-planning-toggle span {
        font-size: 16px;
        line-height: 1;
        color: #777bb0;
      }

      body[data-atlas-owner-planning-open="true"] .atlas-owner-planning-toggle {
        border-color: rgba(112, 111, 177, .4);
        background: rgba(244, 241, 250, .8);
      }
    `}</style>
  );

  if (!host) return styles;

  return (
    <>
      {styles}
      {createPortal(
        <button
          type="button"
          className="atlas-owner-planning-toggle"
          aria-expanded={planningOpen}
          onClick={() => setPlanningOpen((open) => !open)}
        >
          <strong>{planningOpen ? "Close planning" : "Plan today"}</strong>
          <span aria-hidden="true">{planningOpen ? "−" : "+"}</span>
        </button>,
        host,
      )}
    </>
  );
}
