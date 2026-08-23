"use client";

import { useEffect, useMemo, useState } from "react";

type Component = {
  key: string;
  kind: string;
  role?: string | null;
  label: string;
  valueText?: string | null;
  valueNumeric?: number | string | null;
  valueBoolean?: boolean | null;
  unit?: string | null;
  required?: boolean;
  sortOrder?: number;
};

type Relation = {
  key: string;
  kind: string;
  from: string;
  to: string;
  condition?: string | null;
  required?: boolean;
  sortOrder?: number;
};

type Structure = {
  contractVersion?: string;
  taskId?: string;
  components?: Component[];
  relations?: Relation[];
};

type Response = {
  ok?: boolean;
  structure?: Structure;
};

type Props = {
  taskId: string;
};

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

function compactValue(component: Component) {
  if (component.valueNumeric !== null && component.valueNumeric !== undefined && component.valueNumeric !== "") {
    return `${component.valueNumeric}${component.unit ? ` ${readable(component.unit)}` : ""}`;
  }
  if (component.valueText?.trim()) {
    const value = component.valueText.trim();
    if (value.toLowerCase() !== component.label.trim().toLowerCase()) return readable(value);
  }
  if (typeof component.valueBoolean === "boolean") return component.valueBoolean ? "Yes" : "No";
  return null;
}

function displayKey(component: Component) {
  return `${component.label.trim().toLowerCase()}|${compactValue(component) ?? ""}`;
}

function relationLabel(relation: Relation) {
  return readable(relation.kind);
}

function shouldShowRelation(relation: Relation) {
  // These relations are already obvious from a compact parts list. Keep only
  // sequence, transformation, destination, state, and conditional connections.
  return !new Set(["at", "for", "from", "adjacent_to"]).has(relation.kind);
}

export default function StructuredTaskExecution({ taskId }: Props) {
  const [structure, setStructure] = useState<Structure | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setStructure(null);
    void fetch(`/api/atlas/task-execution-structure?taskId=${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json() as Response;
        return response.ok && body.ok && body.structure ? body.structure : null;
      })
      .then((next) => {
        if (!controller.signal.aborted) setStructure(next);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!controller.signal.aborted) setStructure(null);
      });
    return () => controller.abort();
  }, [taskId]);

  const components = useMemo(() => {
    const seen = new Set<string>();
    return [...(structure?.components ?? [])]
      .sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100) || a.label.localeCompare(b.label))
      .filter((component) => {
        if (!component.label?.trim()) return false;
        const key = displayKey(component);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [structure]);

  const byKey = useMemo(
    () => new Map((structure?.components ?? []).map((component) => [component.key, component])),
    [structure],
  );

  const relations = useMemo(
    () => [...(structure?.relations ?? [])]
      .sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100) || a.key.localeCompare(b.key))
      .filter(shouldShowRelation),
    [structure],
  );

  if (!components.length) return null;

  return (
    <section className="atlas-structured-work" aria-label="Work parts" data-atlas-structured-work="true">
      <style>{`
        .atlas-structured-work {
          --atlas-task-trail-x:36px;
          position:relative;
          margin:0;
          padding:17px 28px 14px 88px;
          border-top:1px solid rgba(66,65,82,.11);
          background:#fff;
          color:#3d3e50;
        }
        .atlas-structured-work::before {
          content:"";
          position:absolute;
          left:var(--atlas-task-trail-x);
          top:-1px;
          bottom:-1px;
          width:1px;
          background:rgba(86,89,112,.28);
        }
        .atlas-structured-work__label {
          display:block;
          margin-bottom:10px;
          color:#777ca0;
          font-size:.66rem;
          font-weight:950;
          letter-spacing:.11em;
          text-transform:uppercase;
        }
        .atlas-structured-work__parts { display:flex; flex-wrap:wrap; gap:7px; margin:0; padding:0; list-style:none; }
        .atlas-structured-work__part {
          display:inline-flex;
          align-items:baseline;
          gap:6px;
          min-height:32px;
          padding:7px 9px;
          border:1px solid rgba(86,89,112,.17);
          border-radius:10px;
          background:#fbfaf7;
          font-size:.79rem;
          font-weight:780;
          line-height:1.2;
        }
        .atlas-structured-work__part-value { color:#66697b; font-weight:900; }
        .atlas-structured-work__connections { display:grid; gap:5px; margin:12px 0 0; padding:0; list-style:none; }
        .atlas-structured-work__connection { font-size:.76rem; line-height:1.35; color:#5e6070; }
        .atlas-structured-work__connection strong { color:#444654; font-weight:850; }
        .atlas-structured-work__relation { margin:0 5px; color:#898b9b; font-size:.68rem; font-weight:900; text-transform:uppercase; }
        .atlas-structured-work__condition { margin-left:5px; color:#77798a; }
        @media (max-width:560px) {
          .atlas-structured-work { --atlas-task-trail-x:29px; padding:17px 21px 13px 81px; }
        }
      `}</style>
      <span className="atlas-structured-work__label">Parts</span>
      <ul className="atlas-structured-work__parts">
        {components.map((component) => {
          const value = compactValue(component);
          return (
            <li className="atlas-structured-work__part" key={component.key} data-kind={component.kind} data-role={component.role ?? ""}>
              <span>{component.label}</span>
              {value ? <span className="atlas-structured-work__part-value">{value}</span> : null}
            </li>
          );
        })}
      </ul>
      {relations.length ? (
        <ul className="atlas-structured-work__connections" aria-label="Connections">
          {relations.map((relation) => {
            const from = byKey.get(relation.from);
            const to = byKey.get(relation.to);
            const condition = relation.condition ? byKey.get(relation.condition) : null;
            if (!from || !to) return null;
            return (
              <li className="atlas-structured-work__connection" key={relation.key}>
                <strong>{from.label}</strong>
                <span className="atlas-structured-work__relation">{relationLabel(relation)}</span>
                <strong>{to.label}</strong>
                {condition ? <span className="atlas-structured-work__condition">· after {condition.label}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
