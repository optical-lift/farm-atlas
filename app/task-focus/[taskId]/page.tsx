"use client";

import dynamic from "next/dynamic";
import "./focused-task-only.css";

const AtlasTaskPage = dynamic(() => import("../../task/page"), {
  ssr: false,
  loading: () => <div className="atlas-task-page-empty">Opening task…</div>,
});

export default function TaskFocusPage() {
  return (
    <div className="atlas-focused-task-only">
      <AtlasTaskPage />
    </div>
  );
}
