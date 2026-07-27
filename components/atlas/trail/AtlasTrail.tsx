import Link from "next/link";

import type { AtlasTrailContext, AtlasTrailNode } from "@/lib/atlas/trail";

function prettyDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function nodeContent(node: AtlasTrailNode) {
  const date = prettyDate(node.occurredOn || node.dueOn);
  return (
    <>
      <i aria-hidden="true" />
      <span>{node.label}</span>
      {date ? <time>{date}</time> : null}
    </>
  );
}

type AtlasTrailProps = {
  context: AtlasTrailContext;
  mode?: "compact" | "full";
  title?: string;
  className?: string;
};

export default function AtlasTrail({
  context,
  mode = "compact",
  title,
  className = "",
}: AtlasTrailProps) {
  const current = context.nodes.find((node) => node.nodeId === context.currentNodeId)
    ?? context.nodes.find((node) => node.status === "current" || node.status === "blocked")
    ?? null;
  const summary = current
    ? `${current.label}${context.nextNode ? ` → ${context.nextNode.label}` : ""}`
    : context.nodes.every((node) => node.status === "complete" || node.status === "skipped")
      ? "Complete"
      : "Current position not resolved";

  return (
    <section
      className={`atlas-trail atlas-trail-${mode}${className ? ` ${className}` : ""}`}
      aria-label={`${context.subject.label} Trail`}
      data-atlas-trail-profile={context.profileKey}
    >
      {title || mode === "full" ? (
        <header className="atlas-trail-head">
          <div>
            <small>{context.profileLabel || "Trail"}</small>
            <strong>{title || context.subject.label}</strong>
          </div>
          <span>{summary}</span>
        </header>
      ) : null}

      <ol className="atlas-trail-track">
        {context.nodes.map((node) => {
          const playable = (node.status === "current" || node.status === "blocked") && Boolean(node.href);
          return (
            <li
              key={node.nodeId}
              data-status={node.status}
              aria-current={node.status === "current" || node.status === "blocked" ? "step" : undefined}
            >
              {playable && node.href ? <Link href={node.href}>{nodeContent(node)}</Link> : nodeContent(node)}
            </li>
          );
        })}
      </ol>

      {mode === "full" && (context.blocker || context.unresolvedEvidenceCount > 0) ? (
        <footer className="atlas-trail-foot">
          {context.blocker ? (
            <span data-kind="blocked"><b>{context.blocker.title}</b>{context.blocker.detail ? ` · ${context.blocker.detail}` : ""}</span>
          ) : null}
          {context.unresolvedEvidenceCount > 0 ? (
            <span data-kind="unresolved">{context.unresolvedEvidenceCount} earlier {context.unresolvedEvidenceCount === 1 ? "node has" : "nodes have"} no accepted evidence yet</span>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
