import Link from "next/link";
import { redirect } from "next/navigation";

import {
  AtlasAppShell,
  AtlasCard,
  AtlasMetricStrip,
  AtlasSectionHeading,
  AtlasStateBadge,
  AtlasTopBar,
} from "@/components/atlas/ui/AtlasPrimitives";
import {
  effectiveOperatorAccountId,
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasOperatorUniversalHome } from "@/lib/atlas/operator-universal-home";
import { getAtlasSession } from "@/lib/atlas/session";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";

export const dynamic = "force-dynamic";

type ProjectState = "blocked" | "attention" | "waiting" | "complete" | "quiet" | "moving";

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function prettyDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function projectState(project: Awaited<ReturnType<typeof readAtlasOperatorUniversalHome>>["projects"][number]): ProjectState {
  if (project.blockedTaskCount > 0 || project.health === "blocked") return "blocked";
  if (project.openAttentionCount > 0 || project.health === "at_risk") return "attention";
  if (project.health === "waiting") return "waiting";
  if (project.health === "complete") return "complete";
  if (project.health === "quiet") return "quiet";
  return "moving";
}

function stateLabel(state: ProjectState) {
  if (state === "blocked") return "Blocked";
  if (state === "attention") return "Needs action";
  if (state === "waiting") return "Waiting";
  if (state === "complete") return "Complete";
  if (state === "quiet") return "Quiet";
  return "Moving";
}

export default async function AtlasProjectsPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const viewer = atlasUniversalViewerFromSession(session);
  if (!viewer) redirect("/auth/error?reason=membership_required");

  const operatorContext = await readAtlasOwnerOperatorContext();
  const home = await readAtlasOperatorUniversalHome(viewer, {
    preferredFarmId: viewer.activeFarmId,
    effectiveAccountId: effectiveOperatorAccountId(operatorContext),
    effectiveMembershipId: effectiveOperatorMembershipId(operatorContext),
  });

  const projects = [...home.projects].sort((left, right) => {
    const rank: Record<ProjectState, number> = {
      blocked: 0,
      attention: 1,
      moving: 2,
      waiting: 3,
      quiet: 4,
      complete: 5,
    };
    return rank[projectState(left)] - rank[projectState(right)]
      || (left.targetDate ?? "9999-12-31").localeCompare(right.targetDate ?? "9999-12-31")
      || left.title.localeCompare(right.title);
  });
  const blockedProjects = projects.filter((project) => projectState(project) === "blocked").length;
  const attentionProjects = projects.filter((project) => projectState(project) === "attention").length;
  const primaryAttention = home.attention.slice(0, 6);
  const remainingAttention = home.attention.slice(6);

  return (
    <>
      <style>{`
        .atlas-projects-page { background: #fbf9f1; }
        .atlas-projects-body { padding: 14px; display: grid; gap: 14px; }
        .atlas-projects-summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .atlas-projects-section { padding: 16px; display: grid; gap: 12px; }
        .atlas-projects-list, .atlas-project-attention-list { display: grid; gap: 9px; }
        .atlas-project-card, .atlas-project-attention-card {
          min-width: 0;
          border: 1px solid rgba(88, 87, 111, 0.12);
          border-radius: 16px;
          background: #fffdf7;
          color: #303243;
          padding: 13px;
          text-decoration: none;
          box-shadow: 0 4px 12px rgba(47, 48, 66, 0.035);
        }
        .atlas-project-card > div:first-child { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .atlas-project-card > div:first-child > span,
        .atlas-project-attention-card > span {
          min-width: 0;
          color: #8881b7;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .atlas-project-card > strong,
        .atlas-project-attention-card > strong { display: block; margin-top: 8px; font-size: 16px; line-height: 1.08; }
        .atlas-project-card > p,
        .atlas-project-attention-card > p { margin: 6px 0 0; color: #72736d; font-size: 11px; line-height: 1.35; font-weight: 700; }
        .atlas-project-card > small,
        .atlas-project-attention-card > small { display: block; margin-top: 9px; color: #686a64; font-size: 9px; font-weight: 850; }
        .atlas-project-attention-card { border-left: 4px solid #d9b5a9; }
        .atlas-projects-more { border-top: 1px solid rgba(88, 87, 111, 0.1); padding-top: 10px; }
        .atlas-projects-more summary { color: #5e5985; cursor: pointer; font-size: 10px; font-weight: 900; }
        .atlas-projects-empty { margin: 0; color: #72736d; font-size: 12px; font-weight: 750; }
        @media (max-width: 380px) {
          .atlas-projects-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>
      <AtlasAppShell className="atlas-projects-shell" frameClassName="atlas-projects-page">
        <AtlasTopBar title="Projects" />
        <div className="atlas-projects-body">
          <AtlasMetricStrip className="atlas-projects-summary" ariaLabel="Project totals">
            <span><b>{projects.length}</b> projects</span>
            <span><b>{home.metrics.openWorkCount}</b> open</span>
            <span><b>{blockedProjects}</b> blocked</span>
            <span><b>{attentionProjects}</b> attention</span>
          </AtlasMetricStrip>

          {home.attention.length ? (
            <AtlasCard as="section" className="atlas-projects-section" ariaLabelledBy="atlas-project-needs-title">
              <AtlasSectionHeading title="Needs action" count={home.attention.length} id="atlas-project-needs-title" />
              <div className="atlas-project-attention-list">
                {primaryAttention.map((item, index) => (
                  <Link key={`${item.attentionId ?? item.projectId}-${index}`} href={`/project/${encodeURIComponent(item.projectId)}`} className="atlas-project-attention-card">
                    <span>{item.farmName || "Feast Guild"} · {titleCase(item.kind)}</span>
                    <strong>{item.title}</strong>
                    <p>{item.detail || item.projectTitle}</p>
                    <small>{item.projectTitle}{item.dueDate ? ` · due ${prettyDate(item.dueDate)}` : ""}</small>
                  </Link>
                ))}
              </div>
              {remainingAttention.length ? (
                <details className="atlas-projects-more">
                  <summary>Show {remainingAttention.length} more</summary>
                  <div className="atlas-project-attention-list">
                    {remainingAttention.map((item, index) => (
                      <Link key={`${item.attentionId ?? item.projectId}-more-${index}`} href={`/project/${encodeURIComponent(item.projectId)}`} className="atlas-project-attention-card">
                        <span>{item.farmName || "Feast Guild"} · {titleCase(item.kind)}</span>
                        <strong>{item.title}</strong>
                        <p>{item.detail || item.projectTitle}</p>
                        <small>{item.projectTitle}{item.dueDate ? ` · due ${prettyDate(item.dueDate)}` : ""}</small>
                      </Link>
                    ))}
                  </div>
                </details>
              ) : null}
            </AtlasCard>
          ) : null}

          <AtlasCard as="section" className="atlas-projects-section" ariaLabelledBy="atlas-project-list-title">
            <AtlasSectionHeading title="Projects" count={projects.length} id="atlas-project-list-title" />
            {projects.length ? (
              <div className="atlas-projects-list">
                {projects.map((project) => {
                  const state = projectState(project);
                  return (
                    <Link key={project.projectId} href={`/project/${encodeURIComponent(project.projectId)}`} className="atlas-project-card">
                      <div>
                        <span>{project.farmName || "Feast Guild"} · {titleCase(project.workstream)}</span>
                        <AtlasStateBadge state={state}>{stateLabel(state)}</AtlasStateBadge>
                      </div>
                      <strong>{project.title}</strong>
                      <p>{project.currentMilestone || project.outcome || "Open the project."}</p>
                      <small>
                        {project.openTaskCount} open
                        {project.blockedTaskCount ? ` · ${project.blockedTaskCount} blocked` : ""}
                        {project.openAttentionCount ? ` · ${project.openAttentionCount} need action` : ""}
                        {project.targetDate ? ` · due ${prettyDate(project.targetDate)}` : ""}
                      </small>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="atlas-projects-empty">No projects are visible in this account view.</p>
            )}
          </AtlasCard>
        </div>
      </AtlasAppShell>
    </>
  );
}
