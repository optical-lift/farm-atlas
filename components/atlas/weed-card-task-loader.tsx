"use client";

import { useEffect, useState } from "react";

import AssignedTaskExecutionShell from "@/components/atlas/assigned-task-execution-shell";
import WeedCardTaskFocus from "@/components/atlas/weed-card-task-focus";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { AtlasWeedCardContext } from "@/lib/atlas/weed-card-contract";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

export default function WeedCardTaskLoader({ task, childTasks, assignee }: Props) {
  const [card, setCard] = useState<AtlasWeedCardContext | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`/api/atlas/weed-card?taskId=${encodeURIComponent(task.task_id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json() as { ok?: boolean; card?: AtlasWeedCardContext };
        if (!response.ok || !data.ok || !data.card) throw new Error("Weed Card unavailable");
        if (active) setCard(data.card);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [task.task_id]);

  if (card) return <WeedCardTaskFocus task={task} card={card} childTasks={childTasks} assignee={assignee} />;
  if (failed) return <AssignedTaskExecutionShell task={task} childTasks={childTasks} assignee={assignee} />;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-dominion-task-card" aria-busy="true" />
        </div>
      </section>
    </main>
  );
}
