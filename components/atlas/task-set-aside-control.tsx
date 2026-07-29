"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { postAtlasTaskSetAsideToday } from "@/lib/atlas/task-set-aside-client";

type Props = {
  taskId: string;
  returnTo: string;
};

export default function TaskSetAsideControl({ taskId, returnTo }: Props) {
  const [target, setTarget] = useState<Element | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    function prepare() {
      const footer = document.querySelector(".atlas-task-result-footer");
      if (footer) setTarget(footer);
      document.querySelectorAll<HTMLElement>(".atlas-task-more-outcomes").forEach((details) => {
        details.hidden = true;
      });
    }

    prepare();
    const observer = new MutationObserver(prepare);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function setAside() {
    try {
      setSaving(true);
      setMessage(null);
      const result = await postAtlasTaskSetAsideToday(taskId);
      setMessage(result.message);
      window.setTimeout(() => window.location.assign(returnTo), 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not set this task aside today.");
      setSaving(false);
    }
  }

  if (!target) return null;
  return createPortal(
    <div className="atlas-task-set-aside-control">
      <button type="button" className="atlas-task-set-aside-button" disabled={saving} onClick={() => void setAside()}>
        {saving ? "Setting aside" : "Do tomorrow"}
      </button>
      {message ? <p className="atlas-task-page-message atlas-task-set-aside-message">{message}</p> : null}
    </div>,
    target,
  );
}
