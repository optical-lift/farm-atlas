"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  addDaysIso,
  centralDateIso,
  postAtlasTaskSetAsideToday,
} from "@/lib/atlas/task-set-aside-client";

type Props = {
  taskId: string;
  returnTo: string;
};

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function TaskSetAsideControl({ taskId, returnTo }: Props) {
  const tomorrow = useMemo(() => addDaysIso(centralDateIso(), 1), []);
  const [target, setTarget] = useState<Element | null>(null);
  const [selectedDate, setSelectedDate] = useState(tomorrow);
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

  async function setAside(requestedReturnDate: string) {
    try {
      setSaving(true);
      setMessage(null);
      const result = await postAtlasTaskSetAsideToday(taskId, requestedReturnDate);
      setMessage(result.message);
      window.setTimeout(() => window.location.assign(returnTo), 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not set this task aside today.");
      setSaving(false);
    }
  }

  if (!target) return null;
  return createPortal(
    <details className="atlas-task-move-drawer">
      <summary>
        <span>Move</span>
        <b aria-hidden="true">⌄</b>
      </summary>
      <div className="atlas-task-move-options">
        <button type="button" disabled={saving} onClick={() => void setAside(tomorrow)}>
          Tomorrow
        </button>
        <label>
          <span>Choose date</span>
          <input
            type="date"
            min={tomorrow}
            value={selectedDate}
            disabled={saving}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="atlas-task-move-date-button"
          disabled={saving || !selectedDate}
          onClick={() => void setAside(selectedDate)}
        >
          {saving ? "Moving" : `Move to ${prettyDate(selectedDate)}`}
        </button>
      </div>
      {message ? <p className="atlas-task-page-message atlas-task-set-aside-message">{message}</p> : null}
    </details>,
    target,
  );
}
