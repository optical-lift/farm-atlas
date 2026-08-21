"use client";

import AssignedTaskExecutionShell, { type AssignedTaskInstrumentContext } from "@/components/atlas/assigned-task-execution-shell";
import TaskRecipeDisclosure from "@/components/atlas/task-recipe-disclosure";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = { task: AtlasTaskCard; childTasks: AtlasTaskCard[]; assignee: AtlasAssigneeConfig };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function familyFor(task: AtlasTaskCard) {
  if (task.action_key === "pressure_wash" || task.task_type === "exterior_cleaning") return "Clean";
  if (task.action_key === "protect" || task.action_key === "spray") return "Protect";
  return "Setup";
}

export default function OneOffFieldWorkTaskDetail(props: Props) {
  const { task } = props;
  const metadata = task.metadata ?? {};
  const family = familyFor(task);
  const title = text(metadata.execution_do) || task.title;
  const place = text(metadata.execution_place) || text(metadata.display_location) || text(task.zone_label) || text(metadata.collection_zone) || "Elm Farm";
  const why = text(metadata.why_now);
  const doneWhen = text(metadata.execution_done_when) || text(metadata.state_effect);
  const method = textList(metadata.execution_how);
  const resources = (task.resource_requirements ?? []).map((requirement) => requirement.resource_label).filter((label): label is string => Boolean(label));

  function methodInstrument(context: AssignedTaskInstrumentContext) {
    return (
      <>
        <style>{`
          .atlas-oneoff-field { margin:0 28px 28px; border-top:1px solid rgba(68,65,89,.12); }
          .atlas-oneoff-field__head { padding:18px 0 14px; }
          .atlas-oneoff-field__head small { display:block; color:#7772ad; font-size:.72rem; font-weight:900; letter-spacing:.13em; text-transform:uppercase; }
          .atlas-oneoff-field__head strong { display:block; margin-top:5px; color:#29293e; font-size:1.18rem; line-height:1.2; }
          .atlas-oneoff-field__head span { display:block; margin-top:5px; color:#777; font-size:.84rem; font-weight:700; }
          .atlas-oneoff-field__reason { margin:0 0 14px; padding:12px 14px; border-radius:14px; background:#f2efe7; color:#5f5c62; font-size:.82rem; line-height:1.42; }
          .atlas-oneoff-field__method { margin:0 0 15px; }
          .atlas-oneoff-field__tools { margin-top:14px; border:1px solid rgba(68,65,89,.13); border-radius:16px; overflow:hidden; background:#fffdf8; }
          .atlas-oneoff-field__tools header { padding:11px 14px; background:#f5f3ed; color:#7772ad; font-size:.69rem; font-weight:900; letter-spacing:.13em; text-transform:uppercase; }
          .atlas-oneoff-field__tools div { display:grid; gap:1px; background:rgba(68,65,89,.08); }
          .atlas-oneoff-field__tools span { padding:12px 14px; background:#fffdf8; color:#303045; font-size:.88rem; font-weight:750; }
          .atlas-oneoff-field__done { margin:14px 0 0; padding:12px 14px; border-left:3px solid #9cac68; background:#f4f6ea; color:#56603e; font-size:.82rem; line-height:1.4; }
          @media (max-width:560px) { .atlas-oneoff-field { margin-left:20px; margin-right:20px; } }
        `}</style>
        <section className="atlas-oneoff-field" data-atlas-method-instrument="one-off-field-work">
          <header className="atlas-oneoff-field__head"><small>{family}</small><strong>{title}</strong><span>{place}</span></header>
          {why ? <p className="atlas-oneoff-field__reason">{why}</p> : null}
          {method.length ? (
            <div className="atlas-oneoff-field__method">
              <TaskRecipeDisclosure>
                {method.map((line) => <p key={line}>{line}</p>)}
              </TaskRecipeDisclosure>
            </div>
          ) : null}
          {resources.length ? <section className="atlas-oneoff-field__tools"><header>Tools</header><div>{resources.map((resource) => <span key={resource}>{resource}</span>)}</div></section> : null}
          {doneWhen ? <p className="atlas-oneoff-field__done"><strong>Done when · </strong>{doneWhen}</p> : null}
        </section>
      </>
    );
  }

  return <AssignedTaskExecutionShell {...props} methodInstrument={methodInstrument} />;
}
