"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const AtlasTaskPage = dynamic(() => import("../../task/page"), {
  ssr: false,
  loading: () => <div className="atlas-task-page-empty">Opening task…</div>,
});

export default function GenericFocusPage({ taskId }: { taskId: string }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("taskId", taskId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setReady(true);
  }, [taskId]);

  return <div className="atlas-focused-task-only">{ready ? <AtlasTaskPage /> : <div className="atlas-task-page-empty">Opening task…</div>}</div>;
}
