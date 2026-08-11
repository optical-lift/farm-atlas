import type {
  TaskMoveAssembly,
  TaskMoveFact,
  TaskMoveRequirement,
} from "@/lib/atlas/task-move-assembly";

type Props = {
  assembly: TaskMoveAssembly;
};

type RequirementGroup = {
  key: string;
  label: string;
  requirements: TaskMoveRequirement[];
};

function readable(value: string) {
  return value.replaceAll("_", " ");
}

function requirementLine(requirement: TaskMoveRequirement) {
  if (requirement.quantity === null) return requirement.label;
  if (requirement.kind === "capacity" && requirement.unit) {
    return `${requirement.quantity} ${readable(requirement.unit)}`;
  }
  return `${requirement.quantity} × ${requirement.label}`;
}

function visibleFacts(facts: TaskMoveFact[]) {
  return facts.filter((fact) => fact.status !== "missing" && fact.label.trim());
}

function issueLabel(status: TaskMoveRequirement["status"], requirements: TaskMoveRequirement[]) {
  if (status === "blocked") return "Blocked";
  if (status === "missing") return "Needed";
  if (status === "warning") {
    const unconfirmedCapacity = requirements.some((requirement) => (
      requirement.kind === "capacity"
      && requirement.status === "warning"
      && requirement.capacityStatus !== "confirmed"
    ));
    return unconfirmedCapacity ? "Not yet confirmed" : "Check";
  }
  return null;
}

function requirementGroupLabel(requirement: TaskMoveRequirement) {
  if (requirement.kind === "container") return "Container";
  if (requirement.kind === "medium") return "Medium";
  if (requirement.kind === "capacity" && requirement.capacityRole === "destination") return "Destination capacity";
  if (requirement.kind === "capacity") return "Capacity";
  if (requirement.kind === "source") return "Source";
  if (requirement.kind === "destination") return "Destination";
  if (requirement.kind === "prerequisite") return "Prerequisite";
  if (requirement.kind === "dependency") return "Dependency";
  if (requirement.kind === "method") return "Method";
  if (requirement.resourceCategory?.trim()) return readable(requirement.resourceCategory).replace(/^./, (letter) => letter.toUpperCase());
  return "Requirement";
}

function groupedRequirements(requirements: TaskMoveRequirement[]) {
  const groups = new Map<string, RequirementGroup>();
  for (const requirement of requirements) {
    const label = requirementGroupLabel(requirement);
    const key = `${requirement.kind}:${label.toLowerCase()}`;
    const existing = groups.get(key);
    if (existing) existing.requirements.push(requirement);
    else groups.set(key, { key, label, requirements: [requirement] });
  }
  return [...groups.values()];
}

function groupStatus(requirements: TaskMoveRequirement[]): TaskMoveRequirement["status"] {
  if (requirements.some((requirement) => requirement.status === "blocked")) return "blocked";
  if (requirements.some((requirement) => requirement.status === "missing")) return "missing";
  if (requirements.some((requirement) => requirement.status === "warning")) return "warning";
  return "resolved";
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

function RequirementGroupBranch({ group, final }: { group: RequirementGroup; final: boolean }) {
  const status = groupStatus(group.requirements);
  const issue = issueLabel(status, group.requirements);
  return (
    <li className="atlas-human-task-trail__requirement-group" data-state={status}>
      <span className="atlas-human-task-trail__branch-line" aria-hidden="true">{final ? "└──" : "├──"}</span>
      <div>
        <span className="atlas-human-task-trail__requirement-label">{group.label}</span>
        <ul className="atlas-human-task-trail__requirement-items">
          {group.requirements.map((requirement) => {
            const openQuestions = (requirement.questions ?? []).filter((question) => question.status === "open");
            return (
              <li key={requirement.id} data-state={requirement.status}>
                <strong>{requirementLine(requirement)}</strong>
                {requirement.note ? <p>{requirement.note}</p> : null}
                {openQuestions.length ? <p>{openQuestions.map((question) => question.label).join(" · ")}</p> : null}
              </li>
            );
          })}
        </ul>
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
  const requirementGroups = groupedRequirements(assembly.requirements);

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
        .atlas-human-task-trail__requirement-cluster { position:relative; margin:-5px 0 19px; }
        .atlas-human-task-trail__requirements { display:grid; gap:9px; margin:0; padding:0; list-style:none; }
        .atlas-human-task-trail__requirement-group { display:grid; grid-template-columns:31px minmax(0,1fr) auto; gap:4px; align-items:start; color:#555766; }
        .atlas-human-task-trail__branch-line { margin-left:-20px; color:#a0a1ae; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.78rem; line-height:1.25; letter-spacing:-.08em; }
        .atlas-human-task-trail__requirement-label { display:block; margin-bottom:2px; color:#898ba0; font-size:.6rem; font-weight:900; letter-spacing:.09em; text-transform:uppercase; }
        .atlas-human-task-trail__requirement-items { display:grid; gap:3px; margin:0; padding:0; list-style:none; }
        .atlas-human-task-trail__requirement-items li { color:#555766; }
        .atlas-human-task-trail__requirement-items strong { display:block; font-size:.8rem; line-height:1.35; }
        .atlas-human-task-trail__requirement-items p { margin:2px 0 0; color:#747582; font-size:.72rem; line-height:1.35; }
        .atlas-human-task-trail__requirement-group > small { margin-top:1px; color:#7a5948; font-size:.64rem; font-weight:900; }
        .atlas-human-task-trail__requirement-group[data-state="blocked"] .atlas-human-task-trail__requirement-label,
        .atlas-human-task-trail__requirement-group[data-state="missing"] .atlas-human-task-trail__requirement-label,
        .atlas-human-task-trail__requirement-items li[data-state="blocked"] strong,
        .atlas-human-task-trail__requirement-items li[data-state="missing"] strong { color:#704d43; }
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

        {requirementGroups.length ? (
          <section className="atlas-human-task-trail__requirement-cluster" aria-label="What must be true before this move">
            <ul className="atlas-human-task-trail__requirements" aria-label="What this work needs">
              {requirementGroups.map((group, index) => (
                <RequirementGroupBranch key={group.key} group={group} final={index === requirementGroups.length - 1} />
              ))}
            </ul>
          </section>
        ) : null}

        <section className="atlas-human-task-trail__step" data-kind="work">
          <span className="atlas-human-task-trail__dot" aria-hidden="true" />
          <span className="atlas-human-task-trail__eyebrow">Do this</span>
          <strong>{moveAction}</strong>
          {moveSubject && moveSubject !== moveAction ? <p>{moveSubject}</p> : null}
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
