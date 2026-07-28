"use client";

import Link from "next/link";

import { atlasTrailCurrentNode, type AtlasTrailContext } from "@/lib/atlas/trail";

type Props = {
  context: AtlasTrailContext;
  label?: string;
  href?: string;
  className?: string;
};

export default function AtlasTrailPosition({
  context,
  label = "Trail position",
  href,
  className = "",
}: Props) {
  const current = atlasTrailCurrentNode(context);
  const currentLabel = current?.label
    || (context.nodes.every((node) => node.status === "complete" || node.status === "skipped")
      ? "Complete"
      : "Current position unresolved");
  const nextLabel = context.nextNode?.label ?? null;
  const status = current?.status ?? (context.unresolvedEvidenceCount > 0 ? "unresolved" : "projected");

  const contents = (
    <>
      <i aria-hidden="true" />
      <span>
        <small>{label}</small>
        <strong>{currentLabel}</strong>
        {nextLabel ? <em>Next: {nextLabel}</em> : null}
      </span>
      {href ? <b aria-hidden="true">→</b> : null}
    </>
  );

  const classes = `atlas-trail-position${className ? ` ${className}` : ""}`;
  return href ? (
    <Link className={classes} href={href} data-status={status}>
      {contents}
    </Link>
  ) : (
    <div className={classes} data-status={status}>
      {contents}
    </div>
  );
}
