import type {
  TaskMoveAssembly,
  TaskMoveFact,
  TaskMoveRequirement,
} from "@/lib/atlas/task-move-assembly";

type Props = {
  assembly: TaskMoveAssembly;
};

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
  return readable(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactRequirementLabel(requirement: TaskMoveRequirement) {
  const quantity = requirement.quantity;
  const label = requirement.label.trim();
  const normalized = label.toLowerCase();

  if (requirement.kind === "capacity") {
    if (normalized.includes("lit tray position")) {
      return quantity === null ? "Lit tray spots" : `${quantity} lit tray spots`;
    }
    if (quantity !== null && requirement.unit) return `${quantity} ${readable(requirement.unit)}`;
  }

  if (quantity === null) return label;
  return `${quantity} × ${label}`;
}

function unresolvedCurrentFacts(facts: TaskMoveFact[]) {
  return facts.filter((fact) => fact.label.trim() && fact.status !== "resolved" && fact.status !== "missing");
}

function operationLabel(assembly: TaskMoveAssembly) {
  if (assembly.task.operationFamily?.trim()) return assembly.task.operationFamily.trim();
  if (assembly.task.displayAction?.trim()) return assembly.task.displayAction.trim();
  const type = assembly.task.taskType?.trim();
  if (type) return titleCase(type);
  return titleCase(assembly.task.route);
}

function workerTitle(assembly: TaskMoveAssembly) {
  const subject = assembly.spine.move.subject;
  if (subject.status !== "missing" && subject.label.trim()) return subject.label.trim();
  return assembly.task.title;
}

function isMowing(assembly: TaskMoveAssembly) {
  return assembly.task.route === "mow" || assembly.task.taskType.toLowerCase() === "mowing";
}

function normalizeCompare(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function requirementIsWorkerDuplicate(requirement: TaskMoveRequirement, assembly: TaskMoveAssembly) {
  const label = normalizeCompare(requirement.label);
  if (!label) return true;
  const subject = normalizeCompare(workerTitle(assembly));
  const linked = assembly.linkedObjects.some((object) => normalizeCompare(object.label) === label);
  return label === subject || linked;
}

function requirementSection(requirement: TaskMoveRequirement) {
  if (requirement.kind === "container") return requirement.label.toLowerCase().includes("tray") ? "Trays" : "Container";
  if (requirement.kind === "medium") return "Medium";
  if (requirement.kind === "capacity") return "Space";
  if (requirement.kind === "source") return "From";
  if (requirement.kind === "destination") return "To";
  if (requirement.kind === "dependency" || requirement.kind === "prerequisite") return "Before";
  if (requirement.kind === "method") return "Method";
  return "Bring";
}

function groupedRequirements(assembly: TaskMoveAssembly) {
  const groups = new Map<string, TaskMoveRequirement[]>();
  assembly.requirements
    .filter((requirement) => requirement.label.trim())
    .filter((requirement) => !requirementIsWorkerDuplicate(requirement, assembly))
    .forEach((requirement) => {
      const key = requirementSection(requirement);
      groups.set(key, [...(groups.get(key) ?? []), requirement]);
    });
  return [...groups.entries()];
}

function groupStatus(requirements: TaskMoveRequirement[]): TaskMoveRequirement["status"] {
  if (requirements.some((requirement) => requirement.status === "blocked")) return "blocked";
  if (requirements.some((requirement) => requirement.status === "missing")) return "missing";
  if (requirements.some((requirement) => requirement.status === "warning")) return "warning";
  return "resolved";
}

function requirementStatusLabel(requirements: TaskMoveRequirement[]) {
  const status = groupStatus(requirements);
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

function targetObject(assembly: TaskMoveAssembly) {
  return assembly.linkedObjects.find((object) => object.role === "target")
    ?? assembly.linkedObjects.find((object) => object.objectType === "bed")
    ?? assembly.linkedObjects[0]
    ?? null;
}

function simpleActionDetail(assembly: TaskMoveAssembly, action: string) {
  const title = workerTitle(assembly);
  const displayAction = assembly.task.displayAction?.trim() || operationLabel(assembly);
  const normalized = normalizeCompare(action);
  const titleNormalized = normalizeCompare(title);
  const actionNormalized = normalizeCompare(displayAction);

  if (normalized === titleNormalized || normalized === `${actionNormalized} ${titleNormalized}`.trim()) return null;
  if (action.toLowerCase().startsWith(`${displayAction.toLowerCase()} `)) {
    const remainder = action.slice(displayAction.length).trim();
    if (remainder && normalizeCompare(remainder) !== titleNormalized) return remainder;
  }
  return action;
}

export default function TaskMoveSpine({ assembly }: Props) {
  const requirementGroups = groupedRequirements(assembly);
  const currentIssues = unresolvedCurrentFacts(assembly.spine.current);
  const place = assembly.execution.where?.trim() || assembly.spine.move.workSite.label?.trim() || null;
  const dueLabel = assembly.execution.dueLabel?.trim() || null;
  const action = assembly.execution.what?.trim() || assembly.spine.move.action.label || assembly.task.title;
  const actionDetail = simpleActionDetail(assembly, action);
  const actionLabel = assembly.task.displayAction?.trim() || operationLabel(assembly);
  const mowing = isMowing(assembly);
  const object = targetObject(assembly);
  const showObject = Boolean(object && (assembly.task.route === "weed" || assembly.task.route === "mow"));

  return (
    <section className="atlas-worker-move" aria-label="Task move">
      <style>{`
        .atlas-worker-move { margin:0; padding:22px 28px 18px; background:#fff; color:#303145; }
        .atlas-worker-move__eyebrow { margin:0 0 6px; color:#777ca0; font-size:.67rem; font-weight:920; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-move__title { margin:0; font-size:clamp(1.9rem,6vw,2.7rem); line-height:1.02; letter-spacing:-.035em; }
        .atlas-worker-move__due { display:block; margin-top:8px; color:#6b6d7b; font-size:.75rem; font-weight:780; }
        .atlas-worker-move__section { margin-top:20px; }
        .atlas-worker-move__label { display:block; margin-bottom:8px; color:#8589a6; font-size:.64rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-move__value { display:block; font-size:.96rem; line-height:1.3; }
        .atlas-worker-move__requirements { display:grid; gap:12px; margin:22px 0 0; padding:0; list-style:none; }
        .atlas-worker-move__requirement { display:grid; grid-template-columns:42px minmax(0,1fr) auto; gap:7px; align-items:start; color:#555766; }
        .atlas-worker-move__branch { margin-left:-5px; padding-top:3px; color:#9a9cac; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.83rem; line-height:1.25; letter-spacing:-.08em; white-space:pre; }
        .atlas-worker-move__requirement-label { display:block; margin-bottom:3px; color:#8589a6; font-size:.62rem; font-weight:950; letter-spacing:.1em; text-transform:uppercase; }
        .atlas-worker-move__requirement-items { display:grid; gap:3px; margin:0; padding:0; list-style:none; }
        .atlas-worker-move__requirement-items strong { display:block; font-size:.88rem; line-height:1.32; }
        .atlas-worker-move__requirement-status { margin-top:0; color:#7a5948; font-size:.68rem; font-weight:900; white-space:nowrap; }
        .atlas-worker-move__requirement[data-state="blocked"] .atlas-worker-move__requirement-label,
        .atlas-worker-move__requirement[data-state="missing"] .atlas-worker-move__requirement-label,
        .atlas-worker-move__requirement[data-state="blocked"] .atlas-worker-move__requirement-items,
        .atlas-worker-move__requirement[data-state="missing"] .atlas-worker-move__requirement-items { color:#704d43; }
        .atlas-worker-move__issue { display:grid; grid-template-columns:22px minmax(0,1fr); gap:8px; margin:10px 0 0; color:#704d43; font-size:.82rem; font-weight:760; }
        .atlas-worker-move__flow { display:grid; gap:0; margin-top:22px; padding-left:28px; }
        .atlas-worker-move__step { position:relative; padding:0 0 22px; }
        .atlas-worker-move__step:last-child { padding-bottom:0; }
        .atlas-worker-move__step:not(:last-child)::after { content:""; position:absolute; left:-20px; top:18px; bottom:0; width:1px; background:rgba(86,89,112,.28); }
        .atlas-worker-move__dot { position:absolute; left:-28px; top:2px; width:16px; height:16px; display:grid; place-items:center; border:2px solid #6d7088; border-radius:50%; background:#fff; color:#6d7088; font-size:.58rem; font-weight:950; box-shadow:0 0 0 4px #fff; }
        .atlas-worker-move__step[data-kind="action"] .atlas-worker-move__dot { background:#6d7088; }
        .atlas-worker-move__step-label { display:block; margin-bottom:4px; color:#8589a6; font-size:.64rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-move__step strong { display:block; font-size:1.02rem; line-height:1.32; }
        @media (max-width:560px) {
          .atlas-worker-move { padding:20px 21px 16px; }
          .atlas-worker-move__requirement { grid-template-columns:34px minmax(0,1fr) auto; gap:5px; }
          .atlas-worker-move__branch { margin-left:-9px; }
          .atlas-worker-move__requirement-status { font-size:.64rem; }
        }
      `}</style>

      <p className="atlas-worker-move__eyebrow">
        {[place, operationLabel(assembly)].filter(Boolean).join(" · ")}
      </p>
      <h1 className="atlas-worker-move__title">{workerTitle(assembly)}</h1>
      {dueLabel ? <span className="atlas-worker-move__due">{dueLabel}</span> : null}

      {showObject && object ? (
        <section className="atlas-worker-move__section" aria-label={titleCase(object.objectType)}>
          <span className="atlas-worker-move__label">{titleCase(object.objectType)}</span>
          <strong className="atlas-worker-move__value">{object.label}</strong>
        </section>
      ) : null}

      {requirementGroups.length ? (
        <ul className="atlas-worker-move__requirements" aria-label="What this work needs">
          {requirementGroups.map(([label, requirements], index) => {
            const status = groupStatus(requirements);
            const statusLabel = requirementStatusLabel(requirements);
            const final = index === requirementGroups.length - 1;
            return (
              <li key={label} className="atlas-worker-move__requirement" data-state={status}>
                <span className="atlas-worker-move__branch" aria-hidden="true">{final ? "└──" : "├──"}</span>
                <div>
                  <span className="atlas-worker-move__requirement-label">{label}</span>
                  <ul className="atlas-worker-move__requirement-items">
                    {requirements.map((requirement) => (
                      <li key={requirement.id}><strong>{compactRequirementLabel(requirement)}</strong></li>
                    ))}
                  </ul>
                </div>
                {statusLabel ? <small className="atlas-worker-move__requirement-status">{statusLabel}</small> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {currentIssues.map((fact, index) => (
        <p key={`${fact.label}-${index}`} className="atlas-worker-move__issue"><span aria-hidden="true">!</span><span>{fact.label}</span></p>
      ))}

      {mowing || actionDetail ? (
        <div className="atlas-worker-move__flow">
          {mowing ? (
            <section className="atlas-worker-move__step" data-kind="preflight">
              <span className="atlas-worker-move__dot" aria-hidden="true">○</span>
              <span className="atlas-worker-move__step-label">Mowing next</span>
              <strong>Pick up sticks + move hoses first</strong>
            </section>
          ) : null}

          {actionDetail ? (
            <section className="atlas-worker-move__step" data-kind="action">
              <span className="atlas-worker-move__dot" aria-hidden="true" />
              <span className="atlas-worker-move__step-label">{actionLabel}</span>
              <strong>{actionDetail}</strong>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
