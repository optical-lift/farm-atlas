"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./person-life.module.css";

type LifeDefinition = {
  definitionId: string;
  signalKind: string;
  status: string;
  lifeSignal?: {
    state?: Record<string, unknown>;
    ambiguities?: unknown[];
  };
  latestEvent?: {
    evaluation?: Record<string, unknown>;
  } | null;
};

type ConsequenceInstance = {
  instanceId: string;
  consequenceRole: string;
  actionKey?: string | null;
  carrierState: string;
  placementState: string;
  executionReadiness: string;
  status: string;
};

type ConditionRow = {
  subject_domain: string;
  subject_kind: string;
  subject_id: string;
  condition_state: string;
  disposition: string;
  last_observed_at: string;
  metadata?: Record<string, unknown> | null;
};

type LifeStateResponse = {
  ok: boolean;
  error?: string;
  personLife?: {
    definitions?: LifeDefinition[];
    consequenceInstances?: ConsequenceInstance[];
    truthBoundary?: Record<string, unknown>;
  } | null;
  conditions?: ConditionRow[];
};

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function goalLabel(definition: LifeDefinition) {
  const state = definition.lifeSignal?.state ?? {};
  const explicit = state.explicitUserEnd;
  return typeof explicit === "string" && explicit.trim() ? explicit : "Unnamed personal goal";
}

function goalState(definition: LifeDefinition) {
  const state = definition.latestEvent?.evaluation?.state;
  if (typeof state === "string") return humanize(state);
  return definition.status === "active" ? "defined" : definition.status;
}

export default function PersonLifeCaptureClient({ personName }: { personName: string }) {
  const [state, setState] = useState<LifeStateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/atlas/person-life", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as LifeStateResponse | null;
    setState(payload);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const goals = useMemo(
    () => (state?.personLife?.definitions ?? []).filter((definition) => definition.signalKind === "goal"),
    [state],
  );
  const openConsequences = useMemo(
    () => (state?.personLife?.consequenceInstances ?? []).filter((item) => item.status === "open"),
    [state],
  );
  const conditions = state?.conditions ?? [];

  return (
    <main className={styles.root}>
      <section className={styles.page}>
        <header className={styles.chrome}>
          <div>
            <span>personal atlas</span>
            <strong>{personName}</strong>
          </div>
          <Link href="/owner" aria-label="Return to Today">← today</Link>
        </header>

        <div className={styles.spread}>
          <section className={styles.capturePage}>
            <header className={styles.pageHeader}>
              <span>CAPTURE</span>
              <h1>What changed?</h1>
              <p>Tell Atlas only what you know. Each entry opens the same governed input instrument used elsewhere in Atlas.</p>
            </header>

            <nav className={styles.captureActions} aria-label="Personal Atlas capture instruments">
              <Link href="/owner/input/person-goal">
                <span>Goal</span>
                <strong>What do you want to make true?</strong>
                <small>Records your chosen end. No training plan, rhythm, task, or Clock placement is inferred.</small>
                <b aria-hidden="true">›</b>
              </Link>
              <Link href="/owner/input/body-observation">
                <span>Body observation</span>
                <strong>What did you notice?</strong>
                <small>Records your first-party observation. Cause, diagnosis, consequence, and treatment remain unestablished.</small>
                <b aria-hidden="true">›</b>
              </Link>
            </nav>

            <aside className={styles.captureBoundary}>
              <strong>Capture is evidence, not instruction.</strong>
              <span>Atlas may preserve what you report without silently turning it into something you should do.</span>
            </aside>
          </section>

          <section className={styles.statePage} aria-busy={loading}>
            <header className={styles.pageHeader}>
              <span>KNOWN NOW</span>
              <h2>Your person-owned state</h2>
              <p>Private by default. These are evidence-backed records, not a schedule.</p>
            </header>

            {loading ? <p className={styles.quiet}>Reading Atlas…</p> : null}
            {!loading && state?.error ? <p className={styles.error}>{state.error}</p> : null}

            <section className={styles.stateGroup}>
              <h3>Goals</h3>
              {goals.length ? goals.map((goal) => (
                <article key={goal.definitionId} className={styles.stateRow}>
                  <strong>{goalLabel(goal)}</strong>
                  <span>{goalState(goal)}</span>
                </article>
              )) : <p className={styles.quiet}>No personal goals recorded here yet.</p>}
            </section>

            <section className={styles.stateGroup}>
              <h3>Body observations</h3>
              {conditions.length ? conditions.map((condition) => (
                <article key={`${condition.subject_domain}:${condition.subject_kind}:${condition.subject_id}`} className={styles.stateRow}>
                  <strong>{humanize(condition.subject_id)} · {humanize(condition.condition_state)}</strong>
                  <span>{condition.disposition === "observe" ? "observation only" : humanize(condition.disposition)}</span>
                </article>
              )) : <p className={styles.quiet}>No first-party condition observations recorded here yet.</p>}
            </section>

            <section className={styles.stateGroup}>
              <h3>Open consequences</h3>
              {openConsequences.length ? openConsequences.map((item) => (
                <article key={item.instanceId} className={styles.stateRow}>
                  <strong>{humanize(item.actionKey ?? item.consequenceRole)}</strong>
                  <span>{humanize(item.carrierState)} carrier · {humanize(item.placementState)} placement</span>
                </article>
              )) : <p className={styles.quiet}>Nothing has earned an operational consequence here.</p>}
            </section>

            <footer className={styles.boundary}>
              <strong>Atlas has not been granted Clock authority from this spread.</strong>
              <span>Nothing recorded here becomes a task merely because it exists.</span>
            </footer>
          </section>
        </div>
      </section>
    </main>
  );
}
