"use client";

import { useEffect } from "react";

export default function GenericFocusPage({ taskId }: { taskId: string }) {
  useEffect(() => {
    const current = new URL(window.location.href);
    const destination = new URL("/task", window.location.origin);
    destination.searchParams.set("taskId", taskId);
    destination.searchParams.set("direct", "1");

    const returnTo = current.searchParams.get("returnTo");
    if (returnTo) destination.searchParams.set("returnTo", returnTo);

    window.location.replace(`${destination.pathname}${destination.search}`);
  }, [taskId]);

  return <div className="atlas-task-page-empty">Opening task…</div>;
}