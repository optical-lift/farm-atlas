"use client";

import dynamic from "next/dynamic";

const AtlasTaskPage = dynamic(() => import("../../task/page"), {
  ssr: false,
  loading: () => <div className="atlas-task-page-empty">Opening task…</div>,
});

export default function TaskFocusPage() {
  return <AtlasTaskPage />;
}
