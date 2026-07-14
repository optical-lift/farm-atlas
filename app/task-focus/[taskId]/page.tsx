"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import GerminationFocusPage from "./GerminationFocusPage";
import "./focused-task-only.css";

const AtlasTaskPage = dynamic(() => import("../../task/page"), {
  ssr: false,
  loading: () => <div className="atlas-task-page-empty">Opening task…</div>,
});

type GerminationTask = {
  id: string;
  cropLabel: string;
  variety: string | null;
  objectLabel: string;
};

type LookupResponse = {
  ok?: boolean;
  germinationCheck?: boolean;
  task?: GerminationTask;
};

export default function TaskFocusPage() {
  const params = useParams<{ taskId: string }>();
  const [mode, setMode] = useState<"loading" | "generic" | "germination">("loading");
  const [germinationTask, setGerminationTask] = useState<GerminationTask | null>(null);

  useEffect(() => {
    const taskId = typeof params.taskId === "string" ? params.taskId : "";
    if (!taskId) return;

    const url = new URL(window.location.href);
    url.searchParams.set("taskId", taskId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

    let stopped = false;
    async function identifyTask() {
      try {
        const response = await fetch(`/api/atlas/germination-check?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const data = (await response.json()) as LookupResponse;
        if (stopped) return;
        if (response.ok && data.ok && data.germinationCheck && data.task) {
          setGerminationTask(data.task);
          setMode("germination");
        } else {
          setMode("generic");
        }
      } catch {
        if (!stopped) setMode("generic");
      }
    }

    void identifyTask();
    return () => {
      stopped = true;
    };
  }, [params.taskId]);

  if (mode === "germination" && germinationTask) {
    return <div className="atlas-focused-task-only"><GerminationFocusPage task={germinationTask} /></div>;
  }

  return (
    <div className="atlas-focused-task-only">
      {mode === "generic" ? <AtlasTaskPage /> : <div className="atlas-task-page-empty">Opening task…</div>}
    </div>
  );
}
