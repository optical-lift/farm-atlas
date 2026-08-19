"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskExecutionShellProps,
} from "@/components/atlas/assigned-task-execution-shell";

type WorkerReadinessPresentation = {
  title: string;
  body: string;
  detail: string | null;
  kind: "prerequisite" | "battery_charge" | "equipment" | "waiting";
};

type ReadinessResponse = {
  ok?: boolean;
  executable?: boolean;
  presentation?: WorkerReadinessPresentation | null;
  error?: string;
};

function WaitingScreen({
  props,
  presentation,
  checking = false,
}: {
  props: AssignedTaskExecutionShellProps;
  presentation?: WorkerReadinessPresentation | null;
  checking?: boolean;
}) {
  const title = checking ? "Checking this job" : presentation?.title || "Not ready yet";
  const body = checking
    ? "Atlas is checking whether everything this job needs is ready."
    : presentation?.body || "Atlas could not confirm that this job is ready to do.";
  const detail = checking
    ? ""
    : presentation?.detail || "Nothing you need to do on this card right now.";

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell" data-atlas-worker-waiting-screen="true">
      <style>{`
        .atlas-worker-waiting-card { margin:0; padding:32px 28px 34px; background:#fff; }
        .atlas-worker-waiting-kicker { display:block; margin-bottom:10px; color:#8a6f62; font-size:.68rem; font-weight:950; letter-spacing:.14em; text-transform:uppercase; }
        .atlas-worker-waiting-card h2 { margin:0 0 8px; color:#414352; font-size:1.45rem; line-height:1.08; }
        .atlas-worker-waiting-task { display:block; margin:0 0 20px; color:#6d7080; font-size:.82rem; line-height:1.35; }
        .atlas-worker-waiting-card p { margin:0; color:#514f55; font-size:.96rem; line-height:1.5; }
        .atlas-worker-waiting-card p + p { margin-top:8px; color:#77737a; font-size:.82rem; }
        .atlas-worker-waiting-back { display:inline-flex; margin-top:24px; color:#5e6076; font-size:.78rem; font-weight:850; text-decoration:none; }
        @media (max-width:560px) { .atlas-worker-waiting-card { padding:28px 21px 30px; } }
      `}</style>
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={props.assignee.listPath} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{props.assignee.label}</span>
          </Link>
          <span className="atlas-weather-line">{checking ? "checking readiness…" : "waiting"}</span>
          <Link href={props.assignee.listPath} className="atlas-note-plus" aria-label={`Back to ${props.assignee.label} work`}>↩</Link>
        </header>
        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card">
            <section className="atlas-worker-waiting-card" aria-live="polite">
              <span className="atlas-worker-waiting-kicker">{checking ? "Atlas" : "Waiting"}</span>
              <h2>{title}</h2>
              <span className="atlas-worker-waiting-task">{props.task.title}</span>
              <p>{body}</p>
              {detail ? <p>{detail}</p> : null}
              {!checking ? <Link className="atlas-worker-waiting-back" href={props.assignee.listPath}>Back to today’s work</Link> : null}
            </section>
          </article>
        </div>
      </section>
    </main>
  );
}

export default function WorkerReadyAssignedTaskExecutionShell(props: AssignedTaskExecutionShellProps) {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [failed, setFailed] = useState(false);

  // Owner pages retain their management surface. This membrane protects assigned
  // execution views from exposing controls before canonical reality says the
  // operation is executable.
  const workerFacing = props.assignee.key !== "owner";

  useEffect(() => {
    if (!workerFacing) return;

    const controller = new AbortController();
    setReadiness(null);
    setFailed(false);

    void (async () => {
      try {
        const response = await fetch(`/api/atlas/task-execution-readiness?taskId=${encodeURIComponent(props.task.task_id)}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body = await response.json() as ReadinessResponse;
        if (controller.signal.aborted) return;
        if (response.ok && body.ok && typeof body.executable === "boolean") setReadiness(body);
        else setFailed(true);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();

    return () => controller.abort();
  }, [props.task.task_id, props.task.status, props.task.updated_at, workerFacing]);

  if (!workerFacing) return <AssignedTaskExecutionShell {...props} />;
  if (!readiness && !failed) return <WaitingScreen props={props} checking />;
  if (failed || readiness?.executable !== true) {
    return <WaitingScreen props={props} presentation={readiness?.presentation} />;
  }

  return <AssignedTaskExecutionShell {...props} />;
}
