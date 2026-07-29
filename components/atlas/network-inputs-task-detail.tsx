"use client";

import { useEffect, useMemo, useRef } from "react";

import DominionAssignedTaskDetail from "@/components/atlas/dominion-assigned-task-detail";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

function currentChecklistDone(task: AtlasTaskCard) {
  const checklistStatus = task.metadata?.checklist_status;
  return task.status === "done" || checklistStatus === "done";
}

function visibleToggleButton(item: Element, done: boolean) {
  const wanted = done ? "reopen" : "mark done";
  const buttons = Array.from(item.querySelectorAll<HTMLButtonElement>(".atlas-plant-check__actions button"));
  return buttons.find((button) => button.textContent?.trim().toLowerCase() === wanted)
    ?? buttons.at(-1)
    ?? null;
}

export default function NetworkInputsTaskDetail({ task, childTasks, assignee }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const currentChildren = useMemo(() => childTasks.map((child) => {
    if (currentChecklistDone(child)) return child;

    return {
      ...child,
      // Historical completion events remain useful evidence, but they must not
      // paint a currently-open checklist row as complete.
      task_outcomes: child.task_outcomes.filter((outcome) => outcome.outcome !== "done"),
    };
  }), [childTasks]);

  useEffect(() => {
    const rootElement = rootRef.current as HTMLDivElement;
    if (!rootElement) return;

    function enhanceMarks() {
      rootElement.querySelectorAll<HTMLElement>(".atlas-plant-check__mark").forEach((mark) => {
        const item = mark.closest(".atlas-plant-check__item");
        const done = Boolean(item?.classList.contains("is-done"));
        mark.setAttribute("role", "button");
        mark.setAttribute("tabindex", "0");
        mark.setAttribute("aria-pressed", String(done));
        mark.setAttribute("aria-label", done ? "Reopen subtask" : "Mark subtask complete");
      });
    }

    function activateMark(mark: HTMLElement) {
      const item = mark.closest(".atlas-plant-check__item");
      if (!item) return;
      const done = item.classList.contains("is-done");
      visibleToggleButton(item, done)?.click();
    }

    function onClick(event: MouseEvent) {
      const target = event.target as Element | null;
      const mark = target?.closest<HTMLElement>(".atlas-plant-check__mark");
      if (!mark || !rootElement.contains(mark)) return;
      event.preventDefault();
      activateMark(mark);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target as Element | null;
      const mark = target?.closest<HTMLElement>(".atlas-plant-check__mark");
      if (!mark || !rootElement.contains(mark)) return;
      event.preventDefault();
      activateMark(mark);
    }

    enhanceMarks();
    const observer = new MutationObserver(enhanceMarks);
    observer.observe(rootElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    rootElement.addEventListener("click", onClick);
    rootElement.addEventListener("keydown", onKeyDown);

    return () => {
      observer.disconnect();
      rootElement.removeEventListener("click", onClick);
      rootElement.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div ref={rootRef} className="atlas-network-input-task">
      <style>{`
        .atlas-network-input-task .atlas-plant-check__item {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) !important;
        }
        .atlas-network-input-task .atlas-plant-check__content {
          grid-column: 1 !important;
          width: 100% !important;
          padding-right: 18px !important;
        }
        .atlas-network-input-task .atlas-plant-check__mark {
          cursor: pointer !important;
          pointer-events: auto !important;
          touch-action: manipulation;
        }
        .atlas-network-input-task .atlas-plant-check__mark:focus-visible {
          outline: 3px solid rgba(85, 90, 134, .38);
          outline-offset: 4px;
        }
        .atlas-network-input-task .atlas-plant-check__actions,
        .atlas-network-input-task .atlas-plant-check__actions.has-two-actions {
          position: static !important;
          inset: auto !important;
          grid-column: 1 !important;
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: wrap !important;
          align-items: center !important;
          justify-content: flex-start !important;
          gap: 8px !important;
          width: auto !important;
          height: auto !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 18px 18px 112px !important;
          opacity: 1 !important;
          visibility: visible !important;
          pointer-events: auto !important;
          transform: none !important;
        }
        .atlas-network-input-task .atlas-plant-check__actions button {
          position: static !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: auto !important;
          min-width: 108px !important;
          min-height: 44px !important;
          margin: 0 !important;
          padding: 9px 13px !important;
          border-radius: 999px !important;
          opacity: 1 !important;
          visibility: visible !important;
          pointer-events: auto !important;
          transform: none !important;
          font-size: .82rem !important;
          font-weight: 800 !important;
          line-height: 1.1 !important;
          white-space: normal !important;
          touch-action: manipulation;
        }
        .atlas-network-input-task .atlas-plant-check__actions button::after {
          content: none !important;
          display: none !important;
        }
        @media (max-width: 430px) {
          .atlas-network-input-task .atlas-plant-check__actions,
          .atlas-network-input-task .atlas-plant-check__actions.has-two-actions {
            padding-left: 96px !important;
          }
        }
      `}</style>
      <DominionAssignedTaskDetail task={task} childTasks={currentChildren} assignee={assignee} />
    </div>
  );
}
