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

function requirementGlyph(status: TaskMoveRequirement["status"]) {
  if (status === "resolved") return "✓";
  if (status === "warning") return "○";
  return "!";
}

function unresolvedCurrentFacts(facts: TaskMoveFact[]) {
  return facts.filter((fact) => fact.label.trim() && fact.status !== "resolved" && fact.status !== "missing");
}

function operationLabel(assembly: TaskMoveAssembly) {
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

export default function TaskMoveSpine({ assembly }: Props) {
  const requirements = assembly.requirements.filter((requirement) => requirement.label.trim());
  const currentIssues = unresolvedCurrentFacts(assembly.spine.current);
  const place = assembly.execution.where?.trim() || assembly.spine.move.workSite.label?.trim() || null;
  const dueLabel = assembly.execution.dueLabel?.trim() || null;
  const action = assembly.execution.what?.trim() || assembly.spine.move.action.label || assembly.task.title;
  const doneWhen = assembly.execution.doneWhen?.trim() || null;
  const mowing = isMowing(assembly);

  return (
    <section className="atlas-worker-move" aria-label="Task move">
      <style>{`
        .atlas-worker-move { margin:0; padding:22px 28px 18px; background:#fff; color:#303145; }
        .atlas-worker-move__eyebrow { margin:0 0 6px; color:#777ca0; font-size:.67rem; font-weight:920; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-move__title { margin:0; font-size:clamp(1.9rem,6vw,2.7rem); line-height:1.02; letter-spacing:-.035em; }
        .atlas-worker-move__due { display:block; margin-top:8px; color:#6b6d7b; font-size:.75rem; font-weight:780; }
        .atlas-worker-move__section { margin-top:22px; }
        .atlas-worker-move__label { display:block; margin-bottom:9px; color:#8589a6; font-size:.64rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-move__needs { display:grid; gap:7px; margin:0; padding:0; list-style:none; }
        .atlas-worker-move__need { display:grid; grid-template-columns:22px minmax(0,1fr); gap:8px; align-items:baseline; color:#505260; }
        .atlas-worker-move__need-mark { font-size:.92rem; font-weight:950; line-height:1; }
        .atlas-worker-move__need[data-state="resolved"] .atlas-worker-move__need-mark { color:#61647d; }
        .atlas-worker-move__need[data-state="warning"] .atlas-worker-move__need-mark { color:#8a654d; }
        .atlas-worker-move__need[data-state="blocked"], .atlas-worker-move__need[data-state="missing"] { color:#704d43; }
        .atlas-worker-move__need strong { font-size:.9rem; line-height:1.3; }
        .atlas-worker-move__issue { display:grid; grid-template-columns:22px minmax(0,1fr); gap:8px; margin:6px 0 0; color:#704d43; font-size:.82rem; font-weight:760; }
        .atlas-worker-move__flow { display:grid; gap:0; margin-top:22px; padding-left:28px; }
        .atlas-worker-move__step { position:relative; padding:0 0 22px; }
        .atlas-worker-move__step:last-child { padding-bottom:0; }
        .atlas-worker-move__step:not(:last-child)::after { content:""; position:absolute; left:-20px; top:18px; bottom:0; width:1px; background:rgba(86,89,112,.28); }
        .atlas-worker-move__dot { position:absolute; left:-28px; top:2px; width:16px; height:16px; display:grid; place-items:center; border:2px solid #6d7088; border-radius:50%; background:#fff; color:#6d7088; font-size:.58rem; font-weight:950; box-shadow:0 0 0 4px #fff; }
        .atlas-worker-move__step[data-kind="action"] .atlas-worker-move__dot { background:#6d7088; }
        .atlas-worker-move__step-label { display:block; margin-bottom:4px; color:#8589a6; font-size:.64rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-move__step strong { display:block; font-size:1.02rem; line-height:1.32; }
        .atlas-worker-move__step p { margin:3px 0 0; color:#666876; font-size:.8rem; font-weight:680; line-height:1.35; }
        @media (max-width:560px) { .atlas-worker-move { padding:20px 21px 16px; } }
      `}</style>

      <p className="atlas-worker-move__eyebrow">
        {[place, operationLabel(assembly)].filter(Boolean).join(" · ")}
      </p>
      <h1 className="atlas-worker-move__title">{workerTitle(assembly)}</h1>
      {dueLabel ? <span className="atlas-worker-move__due">{dueLabel}</span> : null}

      {requirements.length ? (
        <section className="atlas-worker-move__section" aria-label="Needs">
          <span className="atlas-worker-move__label">Needs</span>
          <ul className="atlas-worker-move__needs">
            {requirements.map((requirement) => (
              <li key={requirement.id} className="atlas-worker-move__need" data-state={requirement.status}>
                <span className="atlas-worker-move__need-mark" aria-hidden="true">{requirementGlyph(requirement.status)}</span>
                <strong>{compactRequirementLabel(requirement)}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {currentIssues.map((fact, index) => (
        <p key={`${fact.label}-${index}`} className="atlas-worker-move__issue"><span aria-hidden="true">!</span><span>{fact.label}</span></p>
      ))}

      <div className="atlas-worker-move__flow">
        {mowing ? (
          <section className="atlas-worker-move__step" data-kind="preflight">
            <span className="atlas-worker-move__dot" aria-hidden="true">○</span>
            <span className="atlas-worker-move__step-label">Mowing next</span>
            <strong>Pick up sticks + move hoses first</strong>
          </section>
        ) : null}

        <section className="atlas-worker-move__step" data-kind="action">
          <span className="atlas-worker-move__dot" aria-hidden="true" />
          <span className="atlas-worker-move__step-label">Do this</span>
          <strong>{action}</strong>
        </section>

        {doneWhen ? (
          <section className="atlas-worker-move__step" data-kind="done">
            <span className="atlas-worker-move__dot" aria-hidden="true">○</span>
            <span className="atlas-worker-move__step-label">Done</span>
            <strong>{doneWhen}</strong>
          </section>
        ) : null}
      </div>
    </section>
  );
}
