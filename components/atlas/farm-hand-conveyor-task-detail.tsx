"use client";

import { useState } from "react";

import DominionAssignedTaskDetail from "@/components/atlas/dominion-assigned-task-detail";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { reportAtlasNeedLighterWork } from "@/lib/atlas/worker-support-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

export default function FarmHandConveyorTaskDetail(props: Props) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function needLighterWork() {
    try {
      setSaving(true);
      setMessage("");
      await reportAtlasNeedLighterWork(props.task.task_id);
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not adjust the work stream.");
      setSaving(false);
    }
  }

  return (
    <>
      <DominionAssignedTaskDetail {...props} />
      <aside style={{
        position: "fixed",
        zIndex: 45,
        left: "50%",
        bottom: 14,
        transform: "translateX(-50%)",
        width: "min(430px, calc(100vw - 28px))",
        border: "1px solid rgba(36,35,31,.16)",
        borderRadius: 14,
        padding: 10,
        background: "rgba(247,244,236,.97)",
        boxShadow: "0 10px 32px rgba(30,28,22,.13)",
        backdropFilter: "blur(8px)",
      }}>
        <button
          type="button"
          disabled={saving}
          onClick={() => void needLighterWork()}
          style={{
            width: "100%",
            border: 0,
            borderRadius: 10,
            padding: "11px 14px",
            background: "transparent",
            color: "inherit",
            font: "inherit",
            fontSize: 13,
            fontWeight: 650,
            cursor: saving ? "default" : "pointer",
            opacity: saving ? .5 : .76,
          }}
        >
          {saving ? "Adjusting the work…" : "Need lighter work"}
        </button>
        {message ? <p style={{ margin: "6px 8px 2px", fontSize: 12, color: "#7a2d29" }}>{message}</p> : null}
      </aside>
    </>
  );
}
