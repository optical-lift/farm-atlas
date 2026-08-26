"use client";

import { type MouseEvent, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallbackPath: string;
};

function safeLocalReturnPath(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//") ? trimmed : null;
}

function sameOriginHistoryAvailable() {
  if (window.history.length <= 1 || !document.referrer) return false;
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function leaveTaskFocus(fallbackPath: string) {
  const requested = safeLocalReturnPath(new URLSearchParams(window.location.search).get("returnTo"));
  if (requested) {
    window.location.assign(requested);
    return;
  }
  if (sameOriginHistoryAvailable()) {
    window.history.back();
    return;
  }
  window.location.assign(fallbackPath);
}

export default function TaskFocusNavigationBoundary({ children, fallbackPath }: Props) {
  function handleNavigationCapture(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest(".atlas-note-plus");
    if (!control || !event.currentTarget.contains(control)) return;
    event.preventDefault();
    event.stopPropagation();
    leaveTaskFocus(fallbackPath);
  }

  return (
    <div
      className="atlas-task-focus-navigation-boundary"
      data-atlas-task-focus-navigation="v1"
      onClickCapture={handleNavigationCapture}
    >
      <style>{`
        .atlas-task-focus-navigation-boundary .atlas-note-plus {
          font-size: 0 !important;
          text-decoration: none !important;
        }
        .atlas-task-focus-navigation-boundary .atlas-note-plus::before {
          content: "×";
          font-size: 1.45rem;
          font-weight: 500;
          line-height: 1;
        }
      `}</style>
      {children}
    </div>
  );
}
