import Link from "next/link";

import type { WorkerTaskBlockedPresentation } from "@/lib/atlas/worker-task-readiness";

export type WorkerTaskBlockedStateProps = {
  title: string;
  location?: string | null;
  returnHref: string;
  presentation: WorkerTaskBlockedPresentation;
};

export default function WorkerTaskBlockedState({
  title,
  location,
  returnHref,
  presentation,
}: WorkerTaskBlockedStateProps) {
  if (!presentation.blocked) return null;

  return (
    <main
      className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-worker-blocked-page"
      data-atlas-worker-hard-block="true"
    >
      <style>{`
        .atlas-worker-blocked-page {
          min-height:100dvh;
          background:#f7f4ed;
          color:#36373f;
        }
        .atlas-worker-blocked-wrap {
          width:min(100%, 520px);
          min-height:100dvh;
          margin:0 auto;
          padding:22px 20px 34px;
          display:flex;
          flex-direction:column;
        }
        .atlas-worker-blocked-back {
          width:max-content;
          margin:0 0 30px;
          color:#666a73;
          font-size:.82rem;
          font-weight:750;
          text-decoration:none;
        }
        .atlas-worker-blocked-task-label {
          margin:0 0 7px;
          color:#8a8c94;
          font-size:.65rem;
          font-weight:900;
          letter-spacing:.12em;
          text-transform:uppercase;
        }
        .atlas-worker-blocked-title {
          margin:0;
          max-width:390px;
          color:#34353b;
          font-family:Georgia, 'Times New Roman', serif;
          font-size:clamp(1.75rem, 8vw, 2.35rem);
          font-weight:500;
          line-height:1.02;
          letter-spacing:-.035em;
        }
        .atlas-worker-blocked-location {
          margin:9px 0 0;
          color:#777982;
          font-size:.82rem;
          line-height:1.4;
        }
        .atlas-worker-blocked-state {
          margin-top:48px;
          padding:25px 24px 27px;
          border:1px solid rgba(73,75,84,.12);
          border-radius:22px;
          background:rgba(255,255,255,.72);
          box-shadow:0 8px 28px rgba(45,47,54,.045);
        }
        .atlas-worker-blocked-mark {
          width:34px;
          height:34px;
          margin:0 0 18px;
          display:grid;
          place-items:center;
          border-radius:50%;
          background:#ece9df;
          color:#6e706f;
          font-size:1rem;
          font-weight:800;
        }
        .atlas-worker-blocked-heading {
          margin:0;
          color:#404148;
          font-size:1.06rem;
          font-weight:850;
          letter-spacing:-.015em;
        }
        .atlas-worker-blocked-reason {
          margin:8px 0 0;
          color:#555861;
          font-size:.94rem;
          line-height:1.48;
        }
        .atlas-worker-blocked-next {
          margin:18px 0 0;
          padding-top:18px;
          border-top:1px solid rgba(73,75,84,.1);
          color:#72747b;
          font-size:.83rem;
          line-height:1.5;
        }
        .atlas-worker-blocked-spacer { flex:1; min-height:52px; }
        .atlas-worker-blocked-footer {
          margin-top:26px;
          color:#98999e;
          font-size:.68rem;
          line-height:1.4;
          text-align:center;
        }
      `}</style>

      <div className="atlas-worker-blocked-wrap">
        <Link href={returnHref} className="atlas-worker-blocked-back">← Back</Link>

        <p className="atlas-worker-blocked-task-label">Task</p>
        <h1 className="atlas-worker-blocked-title">{title}</h1>
        {location ? <p className="atlas-worker-blocked-location">{location}</p> : null}

        <section className="atlas-worker-blocked-state" aria-live="polite">
          <div className="atlas-worker-blocked-mark" aria-hidden="true">—</div>
          <h2 className="atlas-worker-blocked-heading">{presentation.heading}</h2>
          <p className="atlas-worker-blocked-reason">{presentation.reason}</p>
          <p className="atlas-worker-blocked-next">{presentation.nextStep}</p>
        </section>

        <div className="atlas-worker-blocked-spacer" />
        <p className="atlas-worker-blocked-footer">No action is needed from you on this task right now.</p>
      </div>
    </main>
  );
}
