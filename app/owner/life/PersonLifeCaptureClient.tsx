"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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

type CaptureMode = "goal" | "condition_observation";

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

function sourceKey(prefix: string) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`;
}

export default function PersonLifeCaptureClient({ personName }: { personName: string }) {
  const [mode, setMode] = useState<CaptureMode>("goal");
  const [state, setState] = useState<LifeStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = String(form.get("goal") ?? "").trim();
    if (!text) return;

    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/atlas/person-life", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "goal", sourceKey: sourceKey("person-goal"), text }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      setMessage(payload?.error ?? "Atlas could not record that goal.");
      setSaving(false);
      return;
    }
    event.currentTarget.reset();
    setMessage("Recorded as your goal. No plan, rhythm, or task was inferred.");
    setSaving(false);
    await refresh();
  }

  async function submitCondition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const bodyRegion = String(form.get("bodyRegion") ?? "").trim();
    const observation = String(form.get("observation") ?? "").trim();
    if (!bodyRegion || !observation) return;

    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/atlas/person-life", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "condition_observation",
        sourceKey: sourceKey("person-condition"),
        bodyRegion,
        observation,
        observedAt: new Date().toISOString(),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      setMessage(payload?.error ?? "Atlas could not record that observation.");
      setSaving(false);
      return;
    }
    event.currentTarget.reset();
    setMessage("Recorded as an observation. Cause, diagnosis, and action remain unestablished.");
    setSaving(false);
    await refresh();
  }

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
              <p>Tell Atlas only what you know. It will not fill in the missing parts.</p>
            </header>

            <div className={styles.modeTabs} role="tablist" aria-label="Capture type">
              <button type="button" data-active={mode === "goal"} onClick={() => setMode("goal")}>Goal</button>
              <button type="button" data-active={mode === "condition_observation"} onClick={() => setMode("condition_observation")}>Body observation</button>
            </div>

            {mode === "goal" ? (
              <form className={styles.form} onSubmit={submitGoal}>
                <label htmlFor="person-life-goal">What do you want to make true?</label>
                <textarea id="person-life-goal" name="goal" rows={4} placeholder="I want to run a 5K." required />
                <small>Atlas records the end you named. It does not invent the training plan.</small>
                <button type="submit" disabled={saving}>{saving ? "recording…" : "record goal"}</button>
              </form>
            ) : (
              <form className={styles.form} onSubmit={submitCondition}>
                <label htmlFor="person-life-region">Where did you notice it?</label>
                <input id="person-life-region" name="bodyRegion" placeholder="left hip" required />
                <label htmlFor="person-life-observation">What did you notice?</label>
                <textarea id="person-life-observation" name="observation" rows={4} placeholder="felt tight afterward" required />
                <small>Atlas records your observation. It does not infer cause, diagnosis, or treatment.</small>
                <button type="submit" disabled={saving}>{saving ? "recording…" : "record observation"}</button>
              </form>
            )}

            {message ? <p className={styles.message}>{message}</p> : null}
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
