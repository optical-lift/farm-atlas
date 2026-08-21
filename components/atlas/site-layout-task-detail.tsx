"use client";

import WorkerReadyAssignedTaskExecutionShell from "@/components/atlas/worker-ready-assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { WorkerReadinessResponse } from "@/lib/atlas/worker-readiness";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
  initialReadiness: WorkerReadinessResponse;
};

type LayoutDimensions = {
  bed_width_ft?: unknown;
  walkway_width_ft?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function layoutDimensions(value: unknown): LayoutDimensions {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LayoutDimensions : {};
}

function SiteLayoutSetupPanel({ task }: { task: AtlasTaskCard }) {
  const metadata = task.metadata ?? {};
  const dimensions = layoutDimensions(metadata.layout_dimensions);
  const bedWidth = positiveNumber(dimensions.bed_width_ft);
  const walkwayWidth = positiveNumber(dimensions.walkway_width_ft);
  const materialsNote = text(metadata.materials_note);
  const resources = (task.resource_requirements ?? []).filter((requirement) => requirement.resource_label || requirement.note);
  const hasLayoutFacts = bedWidth !== null || walkwayWidth !== null;

  if (!hasLayoutFacts && !materialsNote && !resources.length) return null;

  return (
    <section className="atlas-site-layout-setup" data-atlas-site-layout-setup="true" aria-label="Setup details">
      <style>{`
        .atlas-site-layout-setup {
          --atlas-task-trail-x:36px;
          position:relative;
          margin:0;
          padding:18px 28px 19px 88px;
          border-top:1px solid rgba(66,65,82,.11);
          color:#3d3e50;
          background:#fff;
        }
        .atlas-site-layout-setup::before {
          content:"";
          position:absolute;
          left:var(--atlas-task-trail-x);
          top:-1px;
          bottom:-1px;
          width:1px;
          background:rgba(86,89,112,.28);
        }
        .atlas-site-layout-setup__kicker {
          display:block;
          margin-bottom:12px;
          color:#777ca0;
          font-size:.66rem;
          font-weight:950;
          letter-spacing:.11em;
          text-transform:uppercase;
        }
        .atlas-site-layout-setup__facts {
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:8px;
          margin:0 0 14px;
        }
        .atlas-site-layout-setup__fact {
          position:relative;
          min-height:54px;
          padding:10px 12px;
          border:1px solid rgba(86,89,112,.14);
          border-radius:12px;
          background:#fbfaf7;
        }
        .atlas-site-layout-setup__fact::before,
        .atlas-site-layout-setup__materials::before {
          content:"";
          position:absolute;
          left:-52px;
          top:20px;
          width:42px;
          height:1px;
          background:rgba(86,89,112,.42);
        }
        .atlas-site-layout-setup__fact small,
        .atlas-site-layout-setup__materials small {
          display:block;
          margin-bottom:3px;
          color:#8589a6;
          font-size:.62rem;
          font-weight:950;
          letter-spacing:.09em;
          text-transform:uppercase;
        }
        .atlas-site-layout-setup__fact strong {
          display:block;
          color:#3f4255;
          font-size:1rem;
          line-height:1.2;
        }
        .atlas-site-layout-setup__materials {
          position:relative;
          padding:3px 0 0;
        }
        .atlas-site-layout-setup__materials p {
          margin:0;
          color:#555866;
          font-size:.84rem;
          font-weight:690;
          line-height:1.42;
        }
        .atlas-site-layout-setup__resource-list {
          display:grid;
          gap:5px;
          margin:6px 0 0;
          padding:0;
          list-style:none;
        }
        .atlas-site-layout-setup__resource-list li {
          display:flex;
          align-items:baseline;
          justify-content:space-between;
          gap:10px;
          color:#4c4f5d;
          font-size:.82rem;
          font-weight:760;
        }
        .atlas-site-layout-setup__resource-list span {
          color:#777b8d;
          font-size:.7rem;
          font-weight:700;
        }
        @media (max-width:560px) {
          .atlas-site-layout-setup { --atlas-task-trail-x:29px; padding:17px 21px 18px 81px; }
          .atlas-site-layout-setup__facts { grid-template-columns:1fr 1fr; }
        }
      `}</style>
      <span className="atlas-site-layout-setup__kicker">Setup</span>
      {hasLayoutFacts ? (
        <div className="atlas-site-layout-setup__facts" aria-label="Layout dimensions">
          {bedWidth !== null ? (
            <div className="atlas-site-layout-setup__fact">
              <small>Bed width</small>
              <strong>{bedWidth} ft</strong>
            </div>
          ) : null}
          {walkwayWidth !== null ? (
            <div className="atlas-site-layout-setup__fact">
              <small>Walkway width</small>
              <strong>{walkwayWidth} ft</strong>
            </div>
          ) : null}
        </div>
      ) : null}
      {materialsNote || resources.length ? (
        <div className="atlas-site-layout-setup__materials">
          <small>Tools + materials</small>
          {materialsNote ? <p>{materialsNote}</p> : null}
          {resources.length ? (
            <ul className="atlas-site-layout-setup__resource-list">
              {resources.map((requirement) => (
                <li key={requirement.requirement_id}>
                  <b>{requirement.resource_label || requirement.note || "Required resource"}</b>
                  <span>{requirement.resource_status || requirement.status || "required"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function SiteLayoutTaskDetail({ initialReadiness, ...props }: Props) {
  return (
    <WorkerReadyAssignedTaskExecutionShell
      {...props}
      initialReadiness={initialReadiness}
      methodInstrument={({ task }) => <SiteLayoutSetupPanel task={task} />}
    />
  );
}
