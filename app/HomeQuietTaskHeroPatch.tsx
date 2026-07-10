"use client";

import { useEffect } from "react";
import { fetchAtlasTaskCards } from "@/lib/atlas/task-cards-client";

function isQuietTask(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.hide_from_home_hero ?? metadata?.quiet_task;
  return value === true || value === "true" || value === "yes" || value === 1;
}

export default function HomeQuietTaskHeroPatch() {
  useEffect(() => {
    if (window.location.pathname !== "/") return;

    let observer: MutationObserver | null = null;
    let cancelled = false;

    async function apply() {
      try {
        const response = await fetchAtlasTaskCards();
        if (cancelled) return;

        const quietIds = new Set(
          (response.taskCards ?? [])
            .filter((task) => isQuietTask(task.metadata))
            .map((task) => task.task_id),
        );

        const hideQuietHeroCards = () => {
          document.querySelectorAll<HTMLElement>(".atlas-home-task-hero [data-single-task-id]").forEach((node) => {
            const taskId = node.dataset.singleTaskId ?? "";
            node.style.display = quietIds.has(taskId) ? "none" : "";
          });
        };

        hideQuietHeroCards();
        observer = new MutationObserver(hideQuietHeroCards);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      } catch {
        // Quiet-task filtering should never block the home page.
      }
    }

    void apply();

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, []);

  return null;
}
