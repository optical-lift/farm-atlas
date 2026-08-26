"use client";

import Link from "next/link";

import AssignedTaskExecutionShell, {
  type AssignedTaskExecutionShellProps,
} from "@/components/atlas/assigned-task-execution-shell";
import TaskFocusNavigationBoundary from "@/components/atlas/task-focus-navigation-boundary";
import ThinCropCycleTaskCard, { isThinCropCycleTask } from "@/components/atlas/thin-crop-cycle-task-card";
import type { WorkerReadinessPresentation, WorkerReadinessResponse } from "@/lib/atlas/worker-readiness";

type Props = AssignedTaskExecutionShellProps & {
  initialReadiness: WorkerReadinessResponse;
};

const sharedCardCss = `
  .atlas-worker-waiting-card { margin:0; padding:32px 28px 34px; background:#fff; }
  .atlas-worker-waiting-kicker { display:block; margin-bottom:10px; color:#8a6f62; font-size:.68rem; font-weight:950; letter-spacing:.14em; text-transform:uppercase; }
  .atlas-worker-waiting-card h2 { margin:0 0 8px; color:#414352; font-size:1.45rem; line-height:1.08; }
  .atlas-worker-waiting-task { display:block; margin:0 0 20px; color:#6d7080; font-size:.82rem; line-height:1.35; }
  .atlas-worker-waiting-card p { margin:0; color:#514f55; font-size:.96rem; line-height:1.5; }
  .atlas-worker-waiting-card p + p { margin-top:8px; color:#77737a; font-size:.82rem; }
  .atlas-worker-waiting-back { display:inline-flex; margin-top:24px; color:#5e6076; font-size:.78rem; font-weight:850; text-decoration:none; }
  @media (max-width:560px) { .atlas-worker-waiting-card { padding:28px 21px 30px; } }
`;

function WaitingScreen({
  props,
  presentation,
}: {
  props: AssignedTaskExecutionShellProps;
  presentation?: WorkerReadinessPresentation | null;
}) {
  const title = presentation?.title || "Not ready yet";
  const body = presentation?.body || "This job is not executable yet.";
  const detail = presentation?.detail || "Nothing you need to do on this card right now.";

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell" data-atlas-worker-waiting-screen="true">
      <style>{sharedCardCss}</style>
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={props.assignee.listPath} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{props.assignee.label}</span>
          </Link>
          <span className="atlas-weather-line">waiting</span>
          <Link href={props.assignee.listPath} className="atlas-note-plus" aria-label={`Back to ${props.assignee.label} work`}>↩</Link>
        </header>
        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card">
            <section className="atlas-worker-waiting-card" aria-live="polite">
              <span className="atlas-worker-waiting-kicker">Waiting</span>
              <h2>{title}</h2>
              <span className="atlas-worker-waiting-task">{props.task.title}</span>
              <p>{body}</p>
              {detail ? <p>{detail}</p> : null}
              <Link className="atlas-worker-waiting-back" href={props.assignee.listPath}>Back to today’s work</Link>
            </section>
          </article>
        </div>
      </section>
    </main>
  );
}

function ReadinessFailureScreen({ props }: { props: AssignedTaskExecutionShellProps }) {
  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell" data-atlas-worker-readiness-failure="true">
      <style>{sharedCardCss}</style>
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={props.assignee.listPath} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{props.assignee.label}</span>
          </Link>
          <span className="atlas-weather-line">task unavailable</span>
          <Link href={props.assignee.listPath} className="atlas-note-plus" aria-label={`Back to ${props.assignee.label} work`}>↩</Link>
        </header>
        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card">
            <section className="atlas-worker-waiting-card" aria-live="polite">
              <span className="atlas-worker-waiting-kicker">Atlas</span>
              <h2>This task didn’t load</h2>
              <span className="atlas-worker-waiting-task">{props.task.title}</span>
              <p>Go back to today’s work and open the task again.</p>
              <Link className="atlas-worker-waiting-back" href={props.assignee.listPath}>Back to today’s work</Link>
            </section>
          </article>
        </div>
      </section>
    </main>
  );
}

function CanonicalAssignedTaskExecutionSurface({ initialReadiness, ...props }: Props) {
  // Owner-assigned work retains its management surface. Worker-assigned work is
  // rendered only after the server has already resolved the canonical execution warrant.
  const workerFacing = props.assignee.key !== "owner";

  if (!workerFacing) return <AssignedTaskExecutionShell {...props} />;
  if (!initialReadiness.ok || typeof initialReadiness.executable !== "boolean") {
    return <ReadinessFailureScreen props={props} />;
  }
  if (initialReadiness.executable !== true) {
    return <WaitingScreen props={props} presentation={initialReadiness.presentation} />;
  }
  if (isThinCropCycleTask(props.task)) {
    return <ThinCropCycleTaskCard task={props.task} assignee={props.assignee} />;
  }

  return <AssignedTaskExecutionShell {...props} />;
}

export default function WorkerReadyAssignedTaskExecutionShell(props: Props) {
  return (
    <TaskFocusNavigationBoundary fallbackPath={props.assignee.listPath}>
      <CanonicalAssignedTaskExecutionSurface {...props} />
    </TaskFocusNavigationBoundary>
  );
}
