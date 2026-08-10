"use client";

import { useEffect, useMemo, useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { fetchAtlasTaskPlantContents, type AtlasTaskPlantContent } from "@/lib/atlas/task-plant-contents";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

function shortObjectLabel(objectKey: string, objectLabel: string) {
  const keyPatterns: Array<[RegExp, string]> = [
    [/^fr[_-]?(\d+)$/i, "FR"],
    [/^eb(?:_sunflower)?[_-]?(\d+)$/i, "EB"],
    [/^bb[_-]?(\d+)$/i, "BB"],
    [/^bw[_-]?(\d+)$/i, "BW"],
  ];
  for (const [pattern, prefix] of keyPatterns) {
    const match = objectKey.match(pattern);
    if (match) return `${prefix}${match[1]}`;
  }

  const labelPatterns: Array<[RegExp, string]> = [
    [/^Field Row\s+(\d+)$/i, "FR"],
    [/^Entry Billboard Bed\s+(\d+)$/i, "EB"],
    [/^Barn Bed\s+(\d+)$/i, "BB"],
    [/^Berry Walk(?: Flower)? Bed\s+(\d+)$/i, "BW"],
  ];
  for (const [pattern, prefix] of labelPatterns) {
    const match = objectLabel.match(pattern);
    if (match) return `${prefix}${match[1]}`;
  }

  return objectLabel;
}

function taskObject(task: AtlasTaskCard) {
  return task.objects.find((object) => object.object_type === "bed") ?? task.objects[0] ?? null;
}

function WeedFallbackMethodInstrument({ task }: AssignedTaskInstrumentContext) {
  const [contents, setContents] = useState<AtlasTaskPlantContent[]>([]);

  useEffect(() => {
    let active = true;
    void fetchAtlasTaskPlantContents(task.task_id)
      .then((rows) => {
        if (active) setContents(rows);
      })
      .catch(() => {
        if (active) setContents([]);
      });
    return () => {
      active = false;
    };
  }, [task.task_id]);

  const target = taskObject(task);
  const targetLabel = target ? shortObjectLabel(target.object_key, target.object_label) : "this area";
  const plantLabels = useMemo(
    () => Array.from(new Set(contents.map((content) => content.displayLabel).filter(Boolean))),
    [contents],
  );

  if (!target && !plantLabels.length) return null;

  return (
    <section className="atlas-weed-fallback-context" data-atlas-method-instrument="weed-fallback">
      {target ? (
        <div>
          <span>Work area</span>
          <strong>{targetLabel}</strong>
          {target.object_label !== targetLabel ? <small>{target.object_label}</small> : null}
        </div>
      ) : null}
      {plantLabels.length ? (
        <div>
          <span>Plants in this bed</span>
          <p>{plantLabels.join(" · ")}</p>
        </div>
      ) : null}
      <style>{`
        .atlas-weed-fallback-context { display:grid; gap:10px; margin:0 28px 18px; padding:13px 14px; border:1px solid rgba(87,89,116,.14); border-radius:15px; background:#fafafd; }
        .atlas-weed-fallback-context div { display:grid; gap:3px; }
        .atlas-weed-fallback-context span { color:#8588ad; font-size:.66rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-weed-fallback-context strong { color:var(--atlas-text); font-size:1rem; }
        .atlas-weed-fallback-context small,.atlas-weed-fallback-context p { margin:0; color:var(--atlas-muted); font-size:.78rem; font-weight:720; line-height:1.35; }
        @media (max-width:560px) { .atlas-weed-fallback-context { margin:0 21px 18px; } }
      `}</style>
    </section>
  );
}

export default function ConciseWeedTaskDetail(props: Props) {
  return (
    <AssignedTaskExecutionShell
      {...props}
      methodInstrument={WeedFallbackMethodInstrument}
    />
  );
}
