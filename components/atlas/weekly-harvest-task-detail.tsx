"use client";

import { useEffect, useMemo, useState } from "react";

import AssignedTaskExecutionShell from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type HarvestWave = {
  id: string;
  cropLabel: string;
  bucket: "cutting" | "now" | "week1" | "week2" | "week3";
  evidenceState: "calculated" | "seen" | "confirmed";
  objectLabels: string[];
  windowStart: string;
  windowEnd: string;
  latestStage: string | null;
};

type HarvestFarm = {
  key: string;
  waves: HarvestWave[];
};

type HarvestHorizonResponse = {
  ok?: boolean;
  farms?: HarvestFarm[];
};

function validDate(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function evidenceLabel(wave: HarvestWave) {
  if (wave.evidenceState === "confirmed") return "Harvest confirmed";
  if (wave.evidenceState === "seen") return "Field evidence";
  return "Forecast";
}

function HarvestCandidates({ task }: { task: AtlasTaskCard }) {
  const [data, setData] = useState<HarvestHorizonResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const asOf = validDate(task.due_date) ? `?asOf=${encodeURIComponent(task.due_date!)}` : "";
    void fetch(`/api/atlas/harvest-horizon${asOf}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json() as HarvestHorizonResponse;
        return response.ok && body.ok ? body : null;
      })
      .then((body) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch(() => {
        if (!controller.signal.aborted) setData(null);
      });
    return () => controller.abort();
  }, [task.due_date]);

  const candidates = useMemo(() => {
    const farm = data?.farms?.find((candidate) => candidate.key === task.farm_key);
    return (farm?.waves ?? []).filter((wave) => wave.bucket === "cutting" || wave.bucket === "now");
  }, [data, task.farm_key]);

  if (!candidates.length) return null;

  return (
    <section className="atlas-harvest-candidates" aria-label="Crops Atlas thinks may be ready for harvest">
      <style>{`
        .atlas-harvest-candidates { margin:0 28px 20px; padding:16px 0 0; border-top:1px solid rgba(66,65,82,.11); color:#3d3e50; }
        .atlas-harvest-candidates__heading { display:block; margin-bottom:10px; color:#777ca0; font-size:.66rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-harvest-candidates__list { display:grid; gap:12px; margin:0; padding:0; list-style:none; }
        .atlas-harvest-candidates__row { display:grid; grid-template-columns:42px minmax(0,1fr) auto; gap:7px; align-items:start; color:#555766; }
        .atlas-harvest-candidates__branch { margin-left:-5px; padding-top:3px; color:#9a9cac; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.83rem; line-height:1.25; letter-spacing:-.08em; white-space:pre; }
        .atlas-harvest-candidates__crop { display:block; font-size:.9rem; line-height:1.3; }
        .atlas-harvest-candidates__place { display:block; margin-top:3px; color:#747582; font-size:.75rem; line-height:1.35; }
        .atlas-harvest-candidates__evidence { color:#7a5948; font-size:.68rem; font-weight:900; white-space:nowrap; }
        @media (max-width:560px) {
          .atlas-harvest-candidates { margin:0 21px 18px; }
          .atlas-harvest-candidates__row { grid-template-columns:34px minmax(0,1fr) auto; gap:5px; }
          .atlas-harvest-candidates__branch { margin-left:-9px; }
          .atlas-harvest-candidates__evidence { font-size:.64rem; }
        }
      `}</style>
      <span className="atlas-harvest-candidates__heading">Atlas thinks these may be ready</span>
      <ul className="atlas-harvest-candidates__list">
        {candidates.map((wave, index) => (
          <li className="atlas-harvest-candidates__row" key={wave.id}>
            <span className="atlas-harvest-candidates__branch" aria-hidden="true">{index === candidates.length - 1 ? "└──" : "├──"}</span>
            <div>
              <strong className="atlas-harvest-candidates__crop">{wave.cropLabel}</strong>
              {wave.objectLabels.length ? <span className="atlas-harvest-candidates__place">{wave.objectLabels.join(" · ")}</span> : null}
            </div>
            <small className="atlas-harvest-candidates__evidence">{evidenceLabel(wave)}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function WeeklyHarvestTaskDetail(props: Props) {
  return (
    <AssignedTaskExecutionShell
      {...props}
      methodInstrument={({ task }) => <HarvestCandidates task={task} />}
    />
  );
}
