"use client";

import { useMemo, useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskResultInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import styles from "./contractor-service-task-detail.module.css";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type VisitResponse = {
  ok?: boolean;
  result?: {
    serviceDate?: string;
    nextDate?: string;
  };
  error?: string | { message?: string };
  details?: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nextWorkingDay(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + 1);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function requestError(data: VisitResponse) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  return data.error?.message || "Atlas could not save the contractor visit.";
}

function ContractorServiceInstrument({ context }: { context: AssignedTaskResultInstrumentContext }) {
  const { task, assembly, busy, returnHref } = context;
  const today = useMemo(() => todayIso(), []);
  const [differentDay, setDifferentDay] = useState(false);
  const [serviceDate, setServiceDate] = useState(today);
  const [saving, setSaving] = useState<"yes" | "not_yet" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const provider = text(task.metadata?.collection_label)
    || text(task.metadata?.display_subject)
    || "Contractor";
  const question = text(task.metadata?.status_question) || `Did ${provider} come?`;
  const cadenceDays = numberValue(task.metadata?.cadence_days);
  const price = numberValue(task.metadata?.price_per_visit);
  const moveBlocked = busy
    || !assembly
    || assembly.readiness.status === "blocked"
    || assembly.spine.connection === "stops_at_move";

  async function confirmVisit() {
    const actualDate = differentDay ? serviceDate : today;
    if (!actualDate || saving || moveBlocked) return;
    try {
      setSaving("yes");
      setMessage(null);
      const response = await fetch("/api/atlas/contractor-service", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-atlas-intent": "contractor-service-visit-v1",
        },
        cache: "no-store",
        body: JSON.stringify({ taskId: task.task_id, serviceDate: actualDate }),
      });
      const data = await response.json() as VisitResponse;
      if (!response.ok || !data.ok) throw new Error(requestError(data));
      window.location.assign(returnHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save the contractor visit.");
    } finally {
      setSaving(null);
    }
  }

  async function notYet() {
    if (saving || busy) return;
    try {
      setSaving("not_yet");
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "rescheduled",
        targetDate: nextWorkingDay(today),
        reason: `${provider} has not come yet; check again next working day.`,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { contractorServiceStatus: "not_yet" },
      });
      window.location.assign(returnHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not move the contractor check.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section
      className={styles.statusCard}
      aria-label={`${provider} visit status`}
      data-atlas-result-instrument="contractor-service"
    >
      <h2 className={styles.question}>{question}</h2>

      <div className={styles.context}>
        {price !== null ? <span>${price.toLocaleString("en-US")} visit</span> : null}
        {cadenceDays !== null ? <span>Every {cadenceDays} days</span> : null}
        {task.due_date ? <span>Expected {task.due_date}</span> : null}
      </div>

      <div className={styles.dateChoice}>
        <label>
          <input
            type="checkbox"
            checked={differentDay}
            disabled={Boolean(saving) || busy}
            onChange={(event) => setDifferentDay(event.target.checked)}
          />
          <span>They came on a different day</span>
        </label>

        {differentDay ? (
          <label className={styles.dateField}>
            <span>When did they come?</span>
            <input
              type="date"
              value={serviceDate}
              max={today}
              disabled={Boolean(saving) || busy}
              onChange={(event) => setServiceDate(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.yes}
          disabled={moveBlocked || Boolean(saving) || (differentDay && !serviceDate)}
          onClick={() => void confirmVisit()}
        >
          {saving === "yes" ? "Saving…" : "Yes"}
        </button>
        <button
          type="button"
          className={styles.notYet}
          disabled={Boolean(saving) || busy}
          onClick={() => void notYet()}
        >
          {saving === "not_yet" ? "Moving…" : "Not yet"}
        </button>
      </div>

      <p className={styles.helper}>
        If they came today, just tap Yes. If they came earlier, choose the date first so Atlas anchors the next mowing check to the actual visit.
      </p>

      {message ? <p className={styles.message}>{message}</p> : null}
    </section>
  );
}

function resultInstrument(context: AssignedTaskResultInstrumentContext) {
  return <ContractorServiceInstrument context={context} />;
}

export default function ContractorServiceTaskDetail(props: Props) {
  return <AssignedTaskExecutionShell {...props} resultInstrument={resultInstrument} />;
}
