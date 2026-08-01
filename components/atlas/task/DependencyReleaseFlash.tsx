"use client";

import { useEffect, useState } from "react";

import {
  ATLAS_DEPENDENCY_RELEASE_FLASH_KEY,
  type AtlasDependencyReleaseFlash,
} from "@/lib/atlas/task-transition-client";

function readyTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function flashCopy(flash: AtlasDependencyReleaseFlash) {
  if (flash.state === "ready" || flash.state === "released") {
    return {
      eyebrow: "Next work ready",
      title: `${flash.sourceTitle} recorded`,
      body: `${flash.downstreamTitle} is ready now.`,
    };
  }

  const time = readyTime(flash.readyAt);
  return {
    eyebrow: "Clock started",
    title: `${flash.sourceTitle} recorded`,
    body: time
      ? `${flash.downstreamTitle} will be ready at ${time}.`
      : `${flash.downstreamTitle} will release when its wait is complete.`,
  };
}

export default function DependencyReleaseFlash() {
  const [flash, setFlash] = useState<AtlasDependencyReleaseFlash | null>(null);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(ATLAS_DEPENDENCY_RELEASE_FLASH_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(ATLAS_DEPENDENCY_RELEASE_FLASH_KEY);

    try {
      const parsed = JSON.parse(raw) as AtlasDependencyReleaseFlash;
      if (!parsed?.sourceTitle || !parsed?.downstreamTitle) return;
      setFlash(parsed);
      const timeout = window.setTimeout(() => setFlash(null), 9000);
      return () => window.clearTimeout(timeout);
    } catch {
      return;
    }
  }, []);

  if (!flash) return null;
  const copy = flashCopy(flash);

  return (
    <aside className="atlas-dependency-release-flash" role="status" aria-live="polite">
      <div>
        <span>{copy.eyebrow}</span>
        <strong>{copy.title}</strong>
        <p>{copy.body}</p>
      </div>
      <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss dependency update">×</button>
    </aside>
  );
}
