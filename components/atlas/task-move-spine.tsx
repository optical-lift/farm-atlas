import type {
  TaskMoveAssembly,
  TaskMoveFact,
  TaskMoveRequirement,
} from "@/lib/atlas/task-move-assembly";

type Props = {
  assembly: TaskMoveAssembly;
};

function readable(value: string) {
  return value.replaceAll("_", " ");
}

function quantityLabel(requirement: TaskMoveRequirement) {
  if (requirement.quantity === null) return null;
  return `${requirement.quantity} ${requirement.unit ? readable(requirement.unit) : ""}`.trim();
}

function visibleFacts(facts: TaskMoveFact[]) {
  return facts.filter((fact) => fact.status !== "missing" && fact.label.trim());
}

function issueLabel(status: TaskMoveRequirement["status"]) {
  if (status === "blocked") return "Blocked";
  if (status === "missing") return "Needed";
  if (status === "warning") return "Check";
  return null;
}

function FactLines({ facts }: { facts: TaskMoveFact[] }) {
  const visible = visibleFacts(facts);
  if (!visible.length) return null;
  return (
    <ul className="atlas-human-task-trail__facts">
      {visible.map((fact, index) => (
        <li key={`${fact.label}-${index}`} data-state={fact.status}>
          <span>{fact.label}</span>
          {fact.status === "blocked" ? <small>Blocked</small> : fact.status === "warning" ? <small>Check</small> : null}
        </li>
      ))}
    </ul>
  );
}

function RequirementBranch({ requirement }: { requirement: TaskMoveRequirement }) {
  const amount = quantityLabel(requirement);
  const issue = issueLabel(requirement.status);
  const openQuestions = (requirement.questions ?? []).filter((question) => question.status === "open");
  return (
    <li className="atlas-human-task-trail__requirement" data-state={requirement.status}>
      <span className="atlas-human-task-trail__branch-line" aria-hidden="true">├</span>
      <div>
        <strong>{amount ? `${amount} · ` : ""}{requirement.label}</strong>
        {requirement.note ? <p>{requirement.note}</p> : null}
        {openQuestions.length ? <p>{openQuestions.map((question) => question.label).join(" · ")}</p> : null}
      </div>
      {issue ? <small>{issue}</small> : null}
    </li>
  );
}

export default function TaskMoveSpine({ assembly }: Props) {
  const stopped = assembly.spine.connection === "stops_at_move";
  const currentFacts = visibleFacts(assembly.spine.current);
  const afterFacts = visibleFacts(assembly.spine.after);
  const moveSite = assembly.spine.move.workSite.status === "missing" ? null : assembly.spine.move.workSite.label;
  const moveSubject = assembly.spine.move.subject.status === "missing" ? null : assembly.spine.move.subject.label;
  const moveAction = assembly.spine.move.action.label || assembly.task.title;
  const dueLabel = assembly.execution.dueLabel?.trim() || null;

  return (
    <section className="atlas-human-task-trail" aria-label="Task trail">
      <style>{`
        .atlas-human-task-trail { margin:0; padding:23px 28px 19px; background:#fff; color:#303145; }
        .atlas-human-task-trail__place { margin:0 0 5px; color:#777ca0; font-size:.7rem; font-weight:900; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-human-task-trail__title { margin:0; font-size:clamp(1.8rem,6vw,2.65rem); line-height:1.02; letter-spacing:-.035em; }
        .atlas-human-task-trail__due { display:inline-block; margin-top:8px; color:#6b6d7b; font-size:.72rem; font-weight:780; }
        .atlas-human-task-trail__line { position:relative; display:grid; gap:0; margin-top:22px; padding-left:26px; }
        .atlas-human-task-trail__line::before { content:""; position:absolute; left:6px; top:11px; bottom:11px; width:1px; background:rgba(86,89,112,.27); }
        .atlas-human-task-trail__step { position:relative; padding:0 0 21px; }
        .atlas-human-task-trail__step:last-child { padding-bottom:0; }
        .atlas-human-task-trail__step[data-reachable="false"] { opacity:.58; }
        .atlas-human-task-trail__step[data-reachable="false"] .atlas-human-task-trail__dot { border-style:dashed; background:#fff; }
        .atlas-human-task-trail__dot { position:absolute; left:-26px; top:3px; width:13px; height:13px; border:2px solid #6d7088; border-radius:50%; background:#6d7088; box-shadow:0 0 0 4px #fff; }
        .atlas-human-task-trail__step[data-kind="finish"] .atlas-human-task-trail__dot { background:#fff; }
        .atlas-human-task-trail__eyebrow { display:block; margin-bottom:3px; color:#898ba0; font-size:.64rem; font-weight:900; letter-spacing:.1em; text-transform:uppercase; }
        .atlas-human-task-trail__step > strong { display:block; font-size:1rem; line-height:1.3; }
        .atlas-human-task-trail__step > p { margin:3px 0 0; color:#606270; font-size:.83rem; line-height:1.4; }
        .atlas-human-task-trail__facts { display:grid; gap:3px; margin:4px 0 0; padding:0; list-style:none; }
        .atlas-human-task-trail__facts li { display:flex; align-items:baseline; gap:8px; color:#4e5060; font-size:.84rem; font-weight:680; line-height:1.35; }
        .atlas-human-task-trail__facts small { color:#8a654d; font-size:.65rem; font-weight:850; }
        .atlas-human-task-trail__requirements { display:grid; gap:5px; margin:9px 0 0 2px; padding:0; list-style:none; }
        .atlas-human-task-trail__requirement { display:grid; grid-template-columns:16px minmax(0,1fr) auto; gap:3px; align-items:start; color:#555766; }
        .atlas-human-task-trail__branch-line { color:#a0a1ae; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
        .atlas-human-task-trail__requirement strong { display:block; font-size:.8rem; line-height:1.35; }
        .atlas-human-task-trail__requirement p { margin:2px 0 0; color:#747582; font-size:.72rem; line-height:1.35; }
        .atlas-human-task-trail__requirement > small { margin-top:1px; color:#7a5948; font-size:.64rem; font-weight:900; }
        .atlas-human-task-trail__requirement[data-state="blocked"] > div > strong,
        .atlas-human-task-trail__requirement[data-state="missing"] > div > strong { color:#704d43; }
        .atlas-human-task-trail__finish { color:#4e5060; }
        @media (max-width:560px) {
          .atlas-human-task-trail { padding:21px 21px 17px; }
          .atlas-human-task-trail__line { margin-top:19px; }
        }
      `}</style>

      {moveSite ? <p className="atlas-human-task-trail__place">{moveSite}</p> : null}
      <h1 className="atlas-human-task-trail__title">{assembly.task.title}</h1>
      {dueLabel ? <span className="atlas-human-task-trail__due">{dueLabel}</span> : null}

      <div className="atlas-human-task-trail__line">
        {currentFacts.length ? (
          <section className="atlas-human-task-trail__step" data-kind="current">
            <span className="atlas-human-task-trail__dot" aria-hidden="true" />
            <span className="atlas-human-task-trail__eyebrow">Right now</span>
            <FactLines facts={currentFacts} />
          </section>
        ) : null}

        <section className="atlas-human-task-trail__step" data-kind="work">
          <span className="atlas-human-task-trail__dot" aria-hidden="true" />
          <span className="atlas-human-task-trail__eyebrow">Do this</span>
          <strong>{moveAction}</strong>
          {moveSubject && moveSubject !== moveAction ? <p>{moveSubject}</p> : null}
          {assembly.requirements.length ? (
            <ul className="atlas-human-task-trail__requirements" aria-label="What this work needs">
              {assembly.requirements.map((requirement) => <RequirementBranch key={requirement.id} requirement={requirement} />)}
            </ul>
          ) : null}
        </section>

        <section
          className="atlas-human-task-trail__step"
          data-kind="finish"
          data-reachable={stopped ? "false" : "true"}
        >
          <span className="atlas-human-task-trail__dot" aria-hidden="true" />
          <span className="atlas-human-task-trail__eyebrow">{stopped ? "Target held" : "Finished"}</span>
          {afterFacts.length ? <FactLines facts={afterFacts} /> : <p className="atlas-human-task-trail__finish">{assembly.execution.doneWhen}</p>}
        </section>
      </div>
    </section>
  );
}
