"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type HardStopCue = {
  taskId: string;
  title: string;
  displaySubject: string;
  dueDate: string | null;
  state: "active" | "missed";
  kind: "sowing" | "hard_date";
  headline: string;
  body: string;
  biologicalCutoffToday: boolean;
  deepLink: string;
};

type HardStopResponse = {
  ok?: boolean;
  cue?: HardStopCue | null;
};

type Props = {
  dateIso: string;
};

export default function HardStopDayBanner({ dateIso }: Props) {
  const [cue, setCue] = useState<HardStopCue | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCue(null);

    void fetch(`/api/atlas/hard-stop-cue?date=${encodeURIComponent(dateIso)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json() as HardStopResponse;
      if (!controller.signal.aborted) setCue(response.ok && body.ok ? body.cue ?? null : null);
    }).catch(() => {
      if (!controller.signal.aborted) setCue(null);
    });

    return () => controller.abort();
  }, [dateIso]);

  if (!cue) return null;

  return (
    <Link
      href={cue.deepLink}
      className="atlas-hard-stop-day-banner"
      data-hard-stop-state={cue.state}
      data-hard-stop-kind={cue.kind}
    >
      <style>{`
        .atlas-hard-stop-day-banner {
          display: grid;
          gap: 3px;
          margin: 0 0 10px;
          padding: 13px 14px;
          border: 1px solid rgba(95,74,61,.3);
          border-radius: 14px;
          background: #fbf7f1;
          color: #443d38;
          text-decoration: none;
          box-shadow: 0 5px 16px rgba(56,44,37,.055);
        }
        .atlas-hard-stop-day-banner[data-hard-stop-state="missed"] {
          border-style: dashed;
          background: #faf7f4;
        }
        .atlas-hard-stop-day-banner__eyebrow {
          color: #8b5d45;
          font-size: .67rem;
          font-weight: 950;
          letter-spacing: .11em;
          text-transform: uppercase;
        }
        .atlas-hard-stop-day-banner strong {
          font-size: 1rem;
          line-height: 1.22;
        }
        .atlas-hard-stop-day-banner p {
          margin: 1px 0 0;
          color: #69605a;
          font-size: .78rem;
          line-height: 1.38;
        }
        .atlas-hard-stop-day-banner__open {
          margin-top: 3px;
          color: #6f4f3e;
          font-size: .72rem;
          font-weight: 900;
        }
      `}</style>
      <span className="atlas-hard-stop-day-banner__eyebrow">{cue.headline}</span>
      <strong>{cue.displaySubject}</strong>
      <p>{cue.body}</p>
      <span className="atlas-hard-stop-day-banner__open">Open task →</span>
    </Link>
  );
}
