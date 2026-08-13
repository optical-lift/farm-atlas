"use client";

import type { ReactNode } from "react";

type Props = {
  busy?: boolean;
  doneLabel?: string;
  doneBusyLabel?: string;
  doneBusy?: boolean;
  doneDisabled?: boolean;
  unfinishedOpen: boolean;
  onToggleUnfinished: () => void;
  onDone: () => void;
  children?: ReactNode;
};

export default function TaskPrimaryResultControls({
  busy = false,
  doneLabel = "Done",
  doneBusyLabel = "Finishing",
  doneBusy = false,
  doneDisabled = false,
  unfinishedOpen,
  onToggleUnfinished,
  onDone,
  children,
}: Props) {
  return (
    <>
      <div className="atlas-task-result-actions atlas-task-result-actions-simple">
        <button
          type="button"
          className={doneDisabled ? "done is-readiness-warning" : "done"}
          disabled={busy}
          data-atlas-readiness-guard={doneDisabled ? "soft" : "clear"}
          onClick={onDone}
        >
          {doneBusy ? doneBusyLabel : doneLabel}
        </button>
        <button
          type="button"
          className={unfinishedOpen ? "unfinished is-open" : "unfinished"}
          aria-expanded={unfinishedOpen}
          disabled={busy}
          onClick={onToggleUnfinished}
        >
          Unfinished
        </button>
      </div>
      {unfinishedOpen ? children : null}
    </>
  );
}
