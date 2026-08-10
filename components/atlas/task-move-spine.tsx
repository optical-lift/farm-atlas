import type {
  TaskMoveAssembly,
  TaskMoveFact,
  TaskMoveRequirement,
  TaskMoveResolution,
} from "@/lib/atlas/task-move-assembly";

type Props = {
  assembly: TaskMoveAssembly;
};

const STATUS_LABEL: Record<TaskMoveResolution, string> = {
  resolved: "Ready",
  warning: "Check",
  missing: "Missing",
  blocked: "Blocked",
};

function strongestStatus(statuses: TaskMoveResolution[]): TaskMoveResolution {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("missing")) return "missing";
  if (statuses.includes("warning")) return "warning";
  return "resolved";
}

function readable(value: string) {
  return value.replaceAll("_", " ");
}

function quantityLabel(requirement: TaskMoveRequirement) {
  if (requirement.quantity === null) return null;
  return `${requirement.quantity} ${requirement.unit ? readable(requirement.unit) : ""}`.trim();
}

function FactList({ facts }: { facts: TaskMoveFact[] }) {
  return (
    <ul className="atlas-task-move-spine__facts">
      {facts.map((fact, index) => (
        <li key={`${fact.label}-${index}`} data-state={fact.status}>
          <span className="atlas-task-move-spine__fact-mark" aria-hidden="true" />
          <span>{fact.label}</span>
          {fact.status !== "resolved" ? (
            <small>{STATUS_LABEL[fact.status]}</small>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RequirementBranch({ requirement }: { requirement: TaskMoveRequirement }) {
  const openQuestions = (requirement.questions ?? []).filter((question) => question.status === "open");
  const amount = quantityLabel(requirement);

  return (
    <li className="atlas-task-move-spine__branch" data-state={requirement.status}>
      <div className="atlas-task-move-spine__branch-head">
        <span className="atlas-task-move-spine__branch-kind">{readable(requirement.kind)}</span>
        <span className="atlas-task-move-spine__status">{STATUS_LABEL[requirement.status]}</span>
      </div>
      {amount ? <b className="atlas-task-move-spine__amount">{amount}</b> : null}
      <strong>{requirement.label}</strong>
      {requirement.note ? <p>{requirement.note}</p> : null}
      {openQuestions.length ? (
        <details>
          <summary>{openQuestions.length === 1 ? "1 thing still unknown" : `${openQuestions.length} things still unknown`}</summary>
          <ul>
            {openQuestions.map((question) => <li key={question.id}>{question.label}</li>)}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

export default function TaskMoveSpine({ assembly }: Props) {
  const stopped = assembly.spine.connection === "stops_at_move";
  const currentStatus = strongestStatus(assembly.spine.current.map((fact) => fact.status));
  const moveFacts = [assembly.spine.move.action, assembly.spine.move.subject, assembly.spine.move.workSite];
  const moveStatus = strongestStatus(moveFacts.map((fact) => fact.status));
  const afterStatus = strongestStatus(assembly.spine.after.map((fact) => fact.status));
  const readinessLabel = assembly.readiness.status === "ready"
    ? "Ready to do"
    : assembly.readiness.status === "warning"
      ? "Check before doing"
      : "Blocked before the move";

  return (
    <section className="atlas-task-move-spine" aria-label="Task move">
      <style>{`
        .atlas-task-move-spine { margin:0; padding:26px 28px 24px; background:#fff; color:#303145; }
        .atlas-task-move-spine__top { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:24px; }
        .atlas-task-move-spine__kicker { margin:0 0 5px; color:#777ca8; font-size:.72rem; font-weight:900; letter-spacing:.15em; text-transform:uppercase; }
        .atlas-task-move-spine__title { margin:0; font-size:clamp(1.7rem,6vw,2.65rem); line-height:1; letter-spacing:-.035em; }
        .atlas-task-move-spine__readiness { flex:0 0 auto; padding:7px 10px; border:1px solid rgba(75,76,101,.15); border-radius:999px; background:#f7f7fb; color:#55576d; font-size:.76rem; font-weight:850; }
        .atlas-task-move-spine__readiness[data-state="blocked"] { border-style:dashed; background:#fff7f3; color:#7c4536; }
        .atlas-task-move-spine__readiness[data-state="warning"] { background:#fffbea; color:#716328; }
        .atlas-task-move-spine__track { display:grid; grid-template-columns:minmax(0,1fr) 34px minmax(0,1.15fr) 34px minmax(0,1fr); align-items:stretch; }
        .atlas-task-move-spine__node { min-width:0; padding:17px 16px 16px; border:1px solid rgba(69,70,94,.14); border-radius:17px; background:#fbfbfd; }
        .atlas-task-move-spine__node[data-state="missing"] { border-style:dashed; background:#fff; }
        .atlas-task-move-spine__node[data-state="warning"] { background:#fffdf3; }
        .atlas-task-move-spine__node[data-state="blocked"] { border-style:dashed; background:#fff8f5; }
        .atlas-task-move-spine__node[data-reachable="false"] { opacity:.64; }
        .atlas-task-move-spine__node-label { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0 0 12px; color:#777ca8; font-size:.68rem; font-weight:950; letter-spacing:.14em; text-transform:uppercase; }
        .atlas-task-move-spine__node-label small { color:#777887; font-size:.66rem; letter-spacing:0; text-transform:none; }
        .atlas-task-move-spine__move-action { display:block; margin:0 0 5px; font-size:1.18rem; line-height:1.2; }
        .atlas-task-move-spine__move-subject { margin:0; color:#3b3c4c; font-size:1rem; font-weight:720; line-height:1.35; }
        .atlas-task-move-spine__move-site { margin:10px 0 0; color:#6b6c79; font-size:.84rem; line-height:1.35; }
        .atlas-task-move-spine__facts { display:grid; gap:9px; margin:0; padding:0; list-style:none; }
        .atlas-task-move-spine__facts li { display:grid; grid-template-columns:10px minmax(0,1fr) auto; gap:8px; align-items:start; font-size:.9rem; font-weight:690; line-height:1.35; }
        .atlas-task-move-spine__facts small { color:#777887; font-size:.68rem; font-weight:800; }
        .atlas-task-move-spine__fact-mark { width:8px; height:8px; margin-top:3px; border:2px solid #8f91a7; border-radius:50%; background:#8f91a7; }
        .atlas-task-move-spine__facts li[data-state="missing"] .atlas-task-move-spine__fact-mark { background:transparent; border-style:dashed; }
        .atlas-task-move-spine__facts li[data-state="warning"] .atlas-task-move-spine__fact-mark { background:#fff; }
        .atlas-task-move-spine__facts li[data-state="blocked"] .atlas-task-move-spine__fact-mark { border-radius:2px; background:#745046; border-color:#745046; }
        .atlas-task-move-spine__connector { display:flex; align-items:center; justify-content:center; color:#9092a4; font-size:1.25rem; font-weight:900; }
        .atlas-task-move-spine__connector[data-state="blocked"] { flex-direction:column; gap:3px; color:#7c4536; }
        .atlas-task-move-spine__connector small { font-size:.56rem; font-weight:850; letter-spacing:.03em; text-transform:uppercase; writing-mode:vertical-rl; }
        .atlas-task-move-spine__branches { position:relative; margin:22px 0 0; padding-top:20px; }
        .atlas-task-move-spine__branches::before { content:""; position:absolute; top:0; left:50%; width:1px; height:14px; background:rgba(103,105,133,.32); }
        .atlas-task-move-spine__branches-title { margin:0 0 11px; text-align:center; color:#777ca8; font-size:.69rem; font-weight:950; letter-spacing:.13em; text-transform:uppercase; }
        .atlas-task-move-spine__branch-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; margin:0; padding:0; list-style:none; }
        .atlas-task-move-spine__branch { min-width:0; padding:13px 14px; border:1px solid rgba(69,70,94,.13); border-radius:14px; background:#fbfbfd; }
        .atlas-task-move-spine__branch[data-state="missing"] { border-style:dashed; background:#fff; }
        .atlas-task-move-spine__branch[data-state="warning"] { background:#fffdf3; }
        .atlas-task-move-spine__branch[data-state="blocked"] { border-style:dashed; background:#fff8f5; }
        .atlas-task-move-spine__branch-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:7px; }
        .atlas-task-move-spine__branch-kind { color:#7d80a0; font-size:.64rem; font-weight:900; letter-spacing:.1em; text-transform:uppercase; }
        .atlas-task-move-spine__status { color:#696a79; font-size:.67rem; font-weight:850; }
        .atlas-task-move-spine__amount { display:block; margin-bottom:2px; color:#555773; font-size:.78rem; font-weight:900; }
        .atlas-task-move-spine__branch > strong { display:block; font-size:.91rem; line-height:1.3; }
        .atlas-task-move-spine__branch > p { margin:6px 0 0; color:#696a75; font-size:.76rem; line-height:1.4; }
        .atlas-task-move-spine__branch details { margin-top:8px; }
        .atlas-task-move-spine__branch summary { cursor:pointer; color:#6c6d7d; font-size:.72rem; font-weight:850; }
        .atlas-task-move-spine__branch details ul { margin:6px 0 0; padding-left:17px; color:#666774; font-size:.72rem; line-height:1.4; }
        @media (max-width:680px) {
          .atlas-task-move-spine { padding:23px 21px 21px; }
          .atlas-task-move-spine__top { display:block; }
          .atlas-task-move-spine__readiness { display:inline-block; margin-top:12px; }
          .atlas-task-move-spine__track { grid-template-columns:1fr; }
          .atlas-task-move-spine__connector { min-height:28px; transform:rotate(90deg); }
          .atlas-task-move-spine__connector[data-state="blocked"] { flex-direction:row; transform:none; }
          .atlas-task-move-spine__connector small { writing-mode:horizontal-tb; }
          .atlas-task-move-spine__branch-grid { grid-template-columns:1fr; }
        }
      `}</style>

      <header className="atlas-task-move-spine__top">
        <div>
          <p className="atlas-task-move-spine__kicker">Task move</p>
          <h1 className="atlas-task-move-spine__title">{assembly.task.title}</h1>
        </div>
        <span className="atlas-task-move-spine__readiness" data-state={assembly.readiness.status}>{readinessLabel}</span>
      </header>

      <div className="atlas-task-move-spine__track">
        <section className="atlas-task-move-spine__node" data-state={currentStatus} aria-label="Current state">
          <div className="atlas-task-move-spine__node-label"><span>Current</span><small>{STATUS_LABEL[currentStatus]}</small></div>
          <FactList facts={assembly.spine.current} />
        </section>

        <div className="atlas-task-move-spine__connector" aria-hidden="true">→</div>

        <section className="atlas-task-move-spine__node" data-state={moveStatus} aria-label="Move">
          <div className="atlas-task-move-spine__node-label"><span>Move</span><small>{STATUS_LABEL[moveStatus]}</small></div>
          <strong className="atlas-task-move-spine__move-action">{assembly.spine.move.action.label}</strong>
          <p className="atlas-task-move-spine__move-subject">{assembly.spine.move.subject.label}</p>
          <p className="atlas-task-move-spine__move-site">{assembly.spine.move.workSite.label}</p>
        </section>

        <div className="atlas-task-move-spine__connector" data-state={stopped ? "blocked" : "resolved"} aria-hidden="true">
          <span>{stopped ? "⊣" : "→"}</span>
          {stopped ? <small>stop</small> : null}
        </div>

        <section
          className="atlas-task-move-spine__node"
          data-state={afterStatus}
          data-reachable={stopped ? "false" : "true"}
          aria-label="After state"
        >
          <div className="atlas-task-move-spine__node-label">
            <span>After</span>
            <small>{stopped ? "Target held" : STATUS_LABEL[afterStatus]}</small>
          </div>
          <FactList facts={assembly.spine.after} />
        </section>
      </div>

      {assembly.requirements.length ? (
        <section className="atlas-task-move-spine__branches" aria-label="Requirements for this move">
          <h2 className="atlas-task-move-spine__branches-title">Needed for this move</h2>
          <ul className="atlas-task-move-spine__branch-grid">
            {assembly.requirements.map((requirement) => (
              <RequirementBranch key={requirement.id} requirement={requirement} />
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
