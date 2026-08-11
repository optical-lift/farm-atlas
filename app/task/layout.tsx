"use client";

import { type ReactNode, useEffect, useState } from "react";
import "../task-action-temporary.css";
import "../timing-language.css";
import "../task-collection-focus.css";
import "../task-progress-report.css";
import "../default-task-tools.css";
import "../route-date-groups.css";
import "../route-today-header.css";
import "../task-child-inline-log.css";
import "../task-child-react-only.css";

function canonicalTaskHref(taskId: string, source: URLSearchParams) {
  const target = new URLSearchParams();
  const returnTo = source.get("returnTo")?.trim();
  const correction = source.get("correction")?.trim();

  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    target.set("returnTo", returnTo);
  }
  if (correction === "1") target.set("correction", "1");

  const query = target.toString();
  return `/task-focus/${encodeURIComponent(taskId)}${query ? `?${query}` : ""}${window.location.hash}`;
}

export default function TaskLayout({ children }: { children: ReactNode }) {
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("taskId")?.trim();
    if (!taskId) return;

    setRedirecting(true);
    window.location.replace(canonicalTaskHref(taskId, params));
  }, []);

  if (redirecting) {
    return <div className="atlas-task-page-empty">Opening task…</div>;
  }

  return children;
}
