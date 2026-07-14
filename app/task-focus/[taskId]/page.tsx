"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import "./focused-task-only.css";

const AtlasTaskPage = dynamic(() => import("../../task/page"), {
  ssr: false,
  loading: () => <div className="atlas-task-page-empty">Opening task…</div>,
});

export default function TaskFocusPage() {
  const params = useParams<{ taskId: string }>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const taskId = typeof params.taskId === "string" ? params.taskId : "";
    if (!taskId) return;

    const url = new URL(window.location.href);
    url.searchParams.set("taskId", taskId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setReady(true);
  }, [params.taskId]);

  return (
    <div className="atlas-focused-task-only">
      {ready ? <AtlasTaskPage /> : <div className="atlas-task-page-empty">Opening task…</div>}
    </div>
  );
}
