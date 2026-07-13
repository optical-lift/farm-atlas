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

export default function TaskLayout({ children }: { children: ReactNode }) {
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("taskId")?.trim();
    if (!taskId) return;

    setRedirecting(true);
    const encoded = encodeURIComponent(taskId);
    window.location.replace(`/task-focus/${encoded}?taskId=${encoded}`);
  }, []);

  if (redirecting) {
    return <div className="atlas-task-page-empty">Opening task…</div>;
  }

  return children;
}
