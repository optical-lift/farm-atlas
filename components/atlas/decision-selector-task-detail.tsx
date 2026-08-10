"use client";

import { useMemo, useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskResultInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import styles from "./decision-selector-task-detail.module.css";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type DecisionOption = {
  key: string;
  label: string;
};

type DecisionResponse = {
  ok?: boolean;
  result?: {
    createdTaskId?: string | null;
  };
  error?: string | { message?: string };
  details?: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function decisionOptions(task: AtlasTaskCard): DecisionOption[] {
  const raw = task.metadata?.decision_options;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const key = text(record.key);
      const label = text(record.label);
      return key && label ? { key, label } : null;
    })
    .filter((item): item is DecisionOption => Boolean(item));
}

function requestError(data: DecisionResponse) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  return data.error?.message || "Atlas could not save this decision.";
}

function DecisionSelectorInstrument({ context }: { context: AssignedTaskResultInstrumentContext }) {
  const { task, busy, returnHref } = context;
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const question = text(task.metadata?.decision_question) || "What should happen next?";
  const options = useMemo(() => decisionOptions(task), [task]);
  const disabled = saving || busy;

  async function saveDecision() {
    if (!selected || disabled) return;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/task-decision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-atlas-intent": "task-decision-v1",
        },
        cache: "no-store",
        body: JSON.stringify({ taskId: task.task_id, choice: selected }),
      });
      const data = await response.json() as DecisionResponse;
      if (!response.ok || !data.ok) throw new Error(requestError(data));
      window.location.assign(returnHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save this decision.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.decisionCard} aria-label="Decision" data-atlas-result-instrument="decision-selector">
      <h2 className={styles.question}>{question}</h2>
      <fieldset className={styles.options} aria-label={question}>
        {options.map((option) => (
          <label
            key={option.key}
            className={`${styles.option}${selected === option.key ? ` ${styles.optionSelected}` : ""}`}
          >
            <input
              className={styles.radio}
              type="radio"
              name="atlas-task-decision"
              value={option.key}
              checked={selected === option.key}
              disabled={disabled}
              onChange={() => setSelected(option.key)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        className={styles.saveButton}
        disabled={!selected || disabled}
        onClick={() => void saveDecision()}
      >
        {saving ? "Saving decision…" : "Save decision"}
      </button>

      {message ? <p className={styles.message}>{message}</p> : null}
    </section>
  );
}

function resultInstrument(context: AssignedTaskResultInstrumentContext) {
  return <DecisionSelectorInstrument context={context} />;
}

export default function DecisionSelectorTaskDetail(props: Props) {
  return <AssignedTaskExecutionShell {...props} resultInstrument={resultInstrument} />;
}
