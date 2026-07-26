"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasRouteKeyForTask } from "@/lib/atlas/task-display";
import { taskDominionModel } from "@/lib/atlas/task-dominion";
import {
  fetchTendingTaskContext,
  tendingBedHref,
  type TendingBedTrack,
} from "@/lib/atlas/tending-client";

type Props = {
  task: AtlasTaskCard;
  instruction: string;
};

function trailObjectKey(task: AtlasTaskCard) {
  return task.objects.find((object) => object.object_type === "bed")?.object_key
    ?? task.objects[0]?.object_key
    ?? null;
}

export default function TaskDominionTrail({ task, instruction }: Props) {
  const route = atlasRouteKeyForTask(task);
  const objectKey = trailObjectKey(task);
  const [track, setTrack] = useState<TendingBedTrack | null>(null);

  useEffect(() => {
    if (route !== "weed" || !objectKey) {
      setTrack(null);
      return;
    }

    let active = true;
    fetchTendingTaskContext(task.task_id, objectKey)
      .then((response) => {
        if (active) setTrack(response.bed ?? null);
      })
      .catch(() => {
        if (active) setTrack(null);
      });

    return () => {
      active = false;
    };
  }, [objectKey, route, task.task_id]);

  const model = useMemo(() => taskDominionModel(task, track, instruction), [instruction, task, track]);

  return (
    <section className="atlas-task-dominion" aria-label={`${model.placeLabel} task Trail`}>
      <header className="atlas-task-dominion-place">
        <div>
          <small>{model.zoneLabel}</small>
          <strong>{model.placeLabel}</strong>
        </div>
        <span>{model.subjectLabel}</span>
      </header>

      <ol className="atlas-task-dominion-track" aria-label={`What came before and what follows ${model.actionLabel}`}>
        {model.steps.map((step) => (
          <li
            className={`step-${step.status}`}
            aria-current={step.status === "current" || step.status === "blocked" ? "step" : undefined}
            key={step.key}
          >
            <i aria-hidden="true" />
            <span>{step.label}</span>
          </li>
        ))}
      </ol>

      <section className="atlas-task-dominion-move">
        <div className="atlas-task-dominion-kicker">
          <span>Current move</span>
          <small>{model.familyLabel}</small>
        </div>
        <h1>{model.instruction}</h1>
        <div className="atlas-task-dominion-time">
          <span>{model.actionLabel}</span>
          <span>{model.dueLabel}</span>
        </div>
      </section>

      <div className="atlas-task-dominion-cause">
        <section>
          <small>Why now</small>
          <p>{model.whyNow}</p>
        </section>
        <section>
          <small>This move changes</small>
          <p>{model.stateEffect}</p>
        </section>
      </div>

      {model.facts.length || track ? (
        <footer className="atlas-task-dominion-facts">
          {model.facts.map((fact) => (
            <span key={`${fact.label}:${fact.value}`}><small>{fact.label}</small>{fact.value}</span>
          ))}
          {track ? <Link href={tendingBedHref(track)}>Open bed board</Link> : null}
        </footer>
      ) : null}
    </section>
  );
}
