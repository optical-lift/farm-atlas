"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import AtlasTrail from "@/components/atlas/trail/AtlasTrail";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { taskConditionRailModel } from "@/lib/atlas/task-condition-rail";
import { taskDominionModel } from "@/lib/atlas/task-dominion";
import {
  fetchTendingTaskContext,
  tendingBedHref,
  type TendingBedTrack,
} from "@/lib/atlas/tending-client";
import { atlasTrailFromTendingTrack } from "@/lib/atlas/trail";

type Props = {
  task: AtlasTaskCard;
  instruction: string;
  showCondition?: boolean;
};

type ExternalTaskLink = {
  url: string;
  label: string;
};

function trailObjectKey(task: AtlasTaskCard) {
  return task.objects.find((object) => object.object_type === "bed")?.object_key
    ?? task.objects[0]?.object_key
    ?? null;
}

function externalTaskLink(task: AtlasTaskCard): ExternalTaskLink | null {
  const value = task.metadata?.external_url ?? task.metadata?.video_url;
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    const savedLabel = task.metadata?.link_label;
    const label = hostname === "instagram.com" || hostname.endsWith(".instagram.com")
      ? "Open in Instagram"
      : typeof savedLabel === "string" && savedLabel.trim()
        ? savedLabel.trim()
        : "Open link";

    return { url: url.toString(), label };
  } catch {
    return null;
  }
}

export default function TaskDominionTrail({ task, instruction, showCondition = true }: Props) {
  const objectKey = trailObjectKey(task);
  const [track, setTrack] = useState<TendingBedTrack | null>(null);

  useEffect(() => {
    if (!objectKey) {
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
  }, [objectKey, task.task_id]);

  const model = useMemo(() => taskDominionModel(task, track, instruction), [instruction, task, track]);
  const condition = useMemo(() => taskConditionRailModel(task), [task]);
  const trail = useMemo(() => track ? atlasTrailFromTendingTrack(track) : null, [track]);
  const externalLink = useMemo(() => externalTaskLink(task), [task]);

  return (
    <section className="atlas-task-dominion" aria-label={`${model.placeLabel} task`}>
      <header className="atlas-task-dominion-place">
        <div>
          <small>{model.zoneLabel}</small>
          <strong>{model.placeLabel}</strong>
        </div>
        <span>{model.subjectLabel}</span>
      </header>

      {trail ? (
        <AtlasTrail context={trail} mode="compact" />
      ) : (
        <div className="atlas-task-dominion-no-trail" aria-label="No linked Trail">
          <span aria-hidden="true" />
          <i aria-hidden="true" />
          <span aria-hidden="true" />
        </div>
      )}

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

      {showCondition && condition.meaningful ? (
        <section
          className="atlas-task-condition-rail"
          aria-label={`${condition.label}: now ${condition.points[condition.currentIndex]}, target ${condition.points[condition.targetIndex]}`}
        >
          <small>{condition.label}</small>
          <ol>
            {condition.points.map((point, index) => {
              const isCurrent = index === condition.currentIndex;
              const isTarget = index === condition.targetIndex;
              const marker = isCurrent && isTarget ? "Now · Target" : isCurrent ? "Now" : isTarget ? "Target" : "";
              return (
                <li className={`${isCurrent ? "is-current " : ""}${isTarget ? "is-target" : ""}`.trim()} key={`${point}:${index}`}>
                  <i aria-hidden="true" />
                  <strong>{point}</strong>
                  <span>{marker}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {model.facts.length || track || externalLink ? (
        <footer className="atlas-task-dominion-facts">
          {model.facts.map((fact) => (
            <span key={`${fact.label}:${fact.value}`}><small>{fact.label}</small>{fact.value}</span>
          ))}
          {track ? <Link href={tendingBedHref(track)}>Open bed board</Link> : null}
          {externalLink ? <a href={externalLink.url} rel="external">{externalLink.label}</a> : null}
        </footer>
      ) : null}
    </section>
  );
}
