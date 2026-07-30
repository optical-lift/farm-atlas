"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchAtlasWalkwayCard, type AtlasWalkwayCard } from "@/lib/atlas/walkway-card-client";

import styles from "./walkway-card-panel.module.css";

function dateText(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

function conditionText(value: string) {
  return value.replaceAll("_", " ");
}

function stateTitle(card: AtlasWalkwayCard) {
  switch (card.derived.state) {
    case "sprayed_waiting_dieback_review":
      return "Sprayed · dieback review has not opened";
    case "spray_dieback_review_due":
      return "Ready for dieback review";
    case "clear_dead_growth_ready":
      return "Dead growth ready to clear";
    case "strategy_review":
      return "Strategy needs review";
    case "clear":
    case "maintained":
      return "Passage is clear";
    default:
      return conditionText(card.derived.state);
  }
}

export function WalkwayCardPanel({ objectKey }: { objectKey: string }) {
  const [card, setCard] = useState<AtlasWalkwayCard | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchAtlasWalkwayCard(objectKey)
      .then((value) => {
        if (!cancelled) setCard(value);
      })
      .catch(() => {
        if (!cancelled) setCard(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [objectKey]);

  if (!loaded || !card) return null;

  const reviewLabel = card.strategy === "spray" ? "7-day review" : "Clock";
  const taskLink = card.currentTaskId ? `/task-focus/${card.currentTaskId}` : null;

  return (
    <section className={styles.panel} aria-label={`${card.objectLabel} Walkway Card`}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Permanent Walkway Card</span>
          <h2>{card.objectLabel}</h2>
        </div>
        <span className={styles.strategy}>{card.strategy}</span>
      </header>

      <div className={styles.state}>
        <span>Current passage state</span>
        <strong>{stateTitle(card)}</strong>
      </div>

      <dl className={styles.clock}>
        <div>
          <dt>Strategy used</dt>
          <dd>{dateText(card.lastStrategyAt)}</dd>
        </div>
        <div>
          <dt>{reviewLabel}</dt>
          <dd>{dateText(card.diebackReviewAt)}</dd>
        </div>
        <div>
          <dt>Observed</dt>
          <dd>{card.observedAt ? `${conditionText(card.observedCondition)} · ${dateText(card.observedAt)}` : "Physical condition not checked"}</dd>
        </div>
      </dl>

      <div className={styles.next}>
        <span className={styles.node} aria-hidden="true">›</span>
        <div>
          <span>Next valid move</span>
          <strong>{card.derived.nextAction}</strong>
        </div>
      </div>

      {taskLink ? (
        <Link className={styles.taskLink} href={taskLink}>
          <span>{card.currentTaskTitle ?? "Open walkway task"}</span>
          <b aria-hidden="true">→</b>
        </Link>
      ) : card.derived.releaseCapacityBlocked ? (
        <div className={styles.queue}>
          <span>{card.currentOccurrenceTitle ?? "The next move is ready"}</span>
          <strong>Waiting for an open hand slot</strong>
        </div>
      ) : card.currentOccurrenceState ? (
        <div className={styles.queue}>
          <span>{card.currentOccurrenceTitle ?? "The next move is prepared"}</span>
          <strong>{conditionText(card.currentOccurrenceState)}</strong>
        </div>
      ) : null}

      <p className={styles.truth}>
        The Clock opens the review. Only a recorded observation can say the growth is dead and release clearing work.
      </p>
    </section>
  );
}
