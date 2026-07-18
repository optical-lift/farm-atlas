"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const VISIBLE_TASK_COUNT = 3;

function taskDateValue(task: HTMLElement) {
  const text = task.querySelector("small")?.textContent ?? "";
  const dateText = text.split("·")[0]?.trim();
  if (!dateText || dateText === "not logged") return 0;

  const parsed = Date.parse(`${dateText}, ${new Date().getFullYear()}`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function setExpanded(list: HTMLElement, expanded: boolean) {
  const taskButtons = Array.from(
    list.querySelectorAll<HTMLElement>(":scope > button:not(.atlas-attached-tasks-toggle)"),
  );

  taskButtons.forEach((task, index) => {
    task.hidden = !expanded && index >= VISIBLE_TASK_COUNT;
  });

  const toggle = list.querySelector<HTMLButtonElement>(":scope > .atlas-attached-tasks-toggle");
  if (!toggle) return;

  const hiddenCount = Math.max(0, taskButtons.length - VISIBLE_TASK_COUNT);
  toggle.hidden = hiddenCount === 0;
  toggle.textContent = expanded ? "Show less" : `See ${hiddenCount} more`;
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  list.dataset.tasksExpanded = expanded ? "true" : "false";
}

function prepareTaskList(list: HTMLElement) {
  if (list.dataset.taskHistoryReady === "true") return;

  const tasks = Array.from(list.querySelectorAll<HTMLElement>(":scope > button"));
  if (!tasks.length) return;

  tasks
    .sort((a, b) => taskDateValue(b) - taskDateValue(a))
    .forEach((task) => list.appendChild(task));

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "atlas-attached-tasks-toggle";
  toggle.setAttribute("aria-expanded", "false");
  list.appendChild(toggle);

  list.dataset.taskHistoryReady = "true";
  setExpanded(list, false);
}

function prepareOpenTaskLists() {
  document
    .querySelectorAll<HTMLElement>(".atlas-bed-row-card.open .atlas-bed-task-list")
    .forEach(prepareTaskList);
}

export default function AttachedTaskHistoryPatch() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/zones/")) return;

    window.setTimeout(prepareOpenTaskLists, 0);

    function click(event: MouseEvent) {
      const target = event.target as Element | null;
      const toggle = target?.closest<HTMLButtonElement>(".atlas-attached-tasks-toggle");
      if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        const list = toggle.closest<HTMLElement>(".atlas-bed-task-list");
        if (!list) return;
        setExpanded(list, list.dataset.tasksExpanded !== "true");
        return;
      }

      if (target?.closest(".atlas-bed-row-button")) {
        window.setTimeout(prepareOpenTaskLists, 0);
      }
    }

    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, [pathname]);

  return null;
}
