"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AtlasCard, AtlasSectionHeading } from "@/components/atlas/ui/AtlasPrimitives";
import "./pipeline.css";

type SourceKind = "worker_assertion" | "owner_assertion" | "manager_assertion" | "system_continuation" | "system_window";
type Confidence = "possible" | "likely" | "confident";

type ComingItem = {
  cropCycleId: string;
  cropLabel: string;
  baseCropLabel: string;
  variety: string | null;
  objectLabel: string;
  objectKey: string | null;
  expectedDate: string;
  sourceKind: SourceKind;
  confidence: Confidence;
  note: string | null;
  estimatedQuantity: number | null;
  unit: string | null;
  harvestPattern: string | null;
  cropFamily: string | null;
  lastHarvestDate: string | null;
  harvestStartedDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  overdue: boolean;
  humanExpectationId: string | null;
};

type ComingFarm = { id: string; key: string; name: string; items: ComingItem[] };
type ComingResponse = {
  ok?: boolean;
  error?: string;
  asOf?: string;
  horizonEnd?: string;
  farms?: ComingFarm[];
};

type Draft = {
  farmId: string;
  cropCycleId: string;
  expectedDate: string;
  estimatedQuantity: string;
  unit: string;
  confidence: Confidence;
  note: string;
};

const STAGES = ["COMING", "CUT", "PREP", "READY", "CLAIMED", "OUT"] as const;

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function pretty(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function sourceLabel(source: SourceKind) {
  if (source === "worker_assertion") return "Worker field note";
  if (source === "owner_assertion") return "Owner expectation";
  if (source === "manager_assertion") return "Manager expectation";
  if (source === "system_continuation") return "Atlas · next cut after harvest";
  return "Atlas · crop window";
}

function confidenceLabel(confidence: Confidence) {
  if (confidence === "confident") return "Confident";
  if (confidence === "likely") return "Likely";
  return "Possible";
}

function groupLabel(dateIso: string, asOf: string) {
  if (dateIso < asOf) return "OVERDUE";
  if (dateIso === asOf) return "TODAY";
  if (dateIso === addDays(asOf, 1)) return "TOMORROW";
  return "UPCOMING";
}

function quantityLabel(item: ComingItem) {
  if (item.estimatedQuantity === null || !item.unit) return null;
  return `${item.estimatedQuantity} ${item.unit.replaceAll("_", " ")}`;
}

export default function HarvestPipelineSection() {
  const [data, setData] = useState<ComingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ farmId: "", cropCycleId: "", expectedDate: "", estimatedQuantity: "", unit: "", confidence: "likely", note: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pendingKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/atlas/harvest-coming", { cache: "no-store" });
      const payload = await response.json() as ComingResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Coming harvests could not be loaded.");
      setData(payload);
      const firstFarm = payload.farms?.[0];
      const firstItem = firstFarm?.items[0];
      setDraft((current) => ({
        ...current,
        farmId: current.farmId || firstFarm?.id || "",
        cropCycleId: current.cropCycleId || firstItem?.cropCycleId || "",
        expectedDate: current.expectedDate || (payload.asOf ? addDays(payload.asOf, 1) : ""),
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Coming harvests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const allItems = useMemo(() => (data?.farms ?? []).flatMap((farm) => farm.items.map((item) => ({ farm, item }))), [data]);
  const selected = allItems.find(({ item }) => item.cropCycleId === draft.cropCycleId) ?? null;

  const groups = useMemo(() => {
    if (!data?.asOf) return [];
    const map = new Map<string, Array<{ farm: ComingFarm; item: ComingItem }>>();
    for (const entry of allItems) {
      const label = groupLabel(entry.item.expectedDate, data.asOf);
      map.set(label, [...(map.get(label) ?? []), entry]);
    }
    return ["OVERDUE", "TODAY", "TOMORROW", "UPCOMING"]
      .map((label) => ({ label, entries: map.get(label) ?? [] }))
      .filter((group) => group.entries.length);
  }, [allItems, data?.asOf]);

  function selectCycle(cropCycleId: string) {
    const next = allItems.find(({ item }) => item.cropCycleId === cropCycleId);
    setDraft((current) => ({ ...current, cropCycleId, farmId: next?.farm.id || current.farmId }));
    pendingKey.current = null;
  }

  function setDate(expectedDate: string) {
    setDraft((current) => ({ ...current, expectedDate }));
    pendingKey.current = null;
  }

  async function saveExpectation() {
    if (!selected || !draft.expectedDate) return;
    const quantity = draft.estimatedQuantity.trim() ? Number(draft.estimatedQuantity) : null;
    const idempotencyKey = pendingKey.current ?? `harvest-expectation:${selected.item.cropCycleId}:${crypto.randomUUID()}`;
    pendingKey.current = idempotencyKey;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/harvest-expectation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          farmId: selected.farm.id,
          cropCycleId: selected.item.cropCycleId,
          expectedDate: draft.expectedDate,
          estimatedQuantity: quantity,
          unit: quantity === null ? null : (draft.unit.trim() || null),
          confidence: draft.confidence,
          note: draft.note.trim() || null,
          idempotencyKey,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Expected harvest could not be saved.");
      pendingKey.current = null;
      setMessage(`Expected harvest saved for ${selected.item.cropLabel} · ${selected.item.objectLabel}.`);
      setComposerOpen(false);
      setDraft((current) => ({ ...current, estimatedQuantity: "", unit: "", confidence: "likely", note: "" }));
      await load();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "Expected harvest could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const canSave = Boolean(selected && draft.expectedDate && (!draft.estimatedQuantity.trim() || (Number(draft.estimatedQuantity) > 0 && draft.unit.trim())));

  return (
    <section className="atlas-harvest-pipeline" aria-labelledby="atlas-harvest-pipeline-title">
      <nav className="atlas-harvest-stage-rail" aria-label="Harvest pipeline stages">
        {STAGES.map((stage, index) => (
          <span key={stage} data-stage={stage.toLowerCase()} data-active={index === 0 ? "true" : "false"}>
            <b>{index + 1}</b>{stage}
          </span>
        ))}
      </nav>

      <AtlasCard as="section" className="atlas-harvest-coming" ariaLabelledBy="atlas-harvest-pipeline-title">
        <header className="atlas-harvest-coming__header">
          <div>
            <AtlasSectionHeading kicker="Coming" title="Next harvests" id="atlas-harvest-pipeline-title" />
            <p>What Atlas or the field expects to be cut next. This is not harvested inventory yet.</p>
          </div>
          <button type="button" className="atlas-harvest-add" aria-expanded={composerOpen} onClick={() => setComposerOpen((open) => !open)}>
            + Add harvest
          </button>
        </header>

        {composerOpen ? (
          <div className="atlas-harvest-expectation-composer">
            <label className="atlas-harvest-expectation-composer__crop">
              <span>Crop + bed</span>
              <select value={draft.cropCycleId} onChange={(event) => selectCycle(event.target.value)}>
                {allItems.map(({ farm, item }) => (
                  <option key={item.cropCycleId} value={item.cropCycleId}>{item.cropLabel} · {item.objectLabel}{(data?.farms?.length ?? 0) > 1 ? ` · ${farm.name}` : ""}</option>
                ))}
              </select>
            </label>

            <div className="atlas-harvest-date-choices" aria-label="Expected harvest date shortcuts">
              {data?.asOf ? <button type="button" data-selected={draft.expectedDate === data.asOf ? "true" : "false"} onClick={() => setDate(data.asOf!)}>Today</button> : null}
              {data?.asOf ? <button type="button" data-selected={draft.expectedDate === addDays(data.asOf, 1) ? "true" : "false"} onClick={() => setDate(addDays(data.asOf!, 1))}>Tomorrow</button> : null}
              <label><span>Date</span><input type="date" value={draft.expectedDate} min={data?.asOf} max={data?.horizonEnd} onChange={(event) => setDate(event.target.value)} /></label>
            </div>

            <div className="atlas-harvest-expectation-composer__optional">
              <label><span>Rough amount <em>optional</em></span><input inputMode="decimal" value={draft.estimatedQuantity} onChange={(event) => { setDraft((current) => ({ ...current, estimatedQuantity: event.target.value })); pendingKey.current = null; }} placeholder="e.g. 1" /></label>
              <label><span>Unit</span><input value={draft.unit} onChange={(event) => { setDraft((current) => ({ ...current, unit: event.target.value })); pendingKey.current = null; }} placeholder="bucket" disabled={!draft.estimatedQuantity.trim()} /></label>
              <label><span>Confidence</span><select value={draft.confidence} onChange={(event) => { setDraft((current) => ({ ...current, confidence: event.target.value as Confidence })); pendingKey.current = null; }}><option value="possible">Possible</option><option value="likely">Likely</option><option value="confident">Confident</option></select></label>
            </div>

            <label className="atlas-harvest-expectation-composer__note"><span>Field note <em>optional</em></span><input value={draft.note} onChange={(event) => { setDraft((current) => ({ ...current, note: event.target.value })); pendingKey.current = null; }} placeholder="Pretty good Teddy harvest again" /></label>

            <div className="atlas-harvest-expectation-composer__footer">
              <button type="button" onClick={() => setComposerOpen(false)}>Cancel</button>
              <button type="button" disabled={!canSave || saving} onClick={() => void saveExpectation()}>{saving ? "Saving…" : "Add to Coming"}</button>
            </div>
          </div>
        ) : null}

        {message ? <output className="atlas-harvest-coming__message" aria-live="polite">{message}</output> : null}
        {error ? <div className="atlas-harvest-coming__state atlas-harvest-coming__state--error"><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div> : null}
        {loading && !data ? <div className="atlas-harvest-coming__state">Reading next harvests…</div> : null}
        {data && !allItems.length ? <div className="atlas-harvest-coming__state">Nothing is currently expected inside the next 60 days.</div> : null}

        <div className="atlas-harvest-coming__groups">
          {groups.map((group) => (
            <section key={group.label} className="atlas-harvest-coming-group" data-group={group.label.toLowerCase()}>
              <header><span>{group.label}</span><b>{group.entries.length}</b></header>
              <div>
                {group.entries.map(({ farm, item }) => (
                  <article className="atlas-harvest-coming-row" key={item.cropCycleId} data-source={item.sourceKind}>
                    <div className="atlas-harvest-coming-row__identity">
                      <small>{sourceLabel(item.sourceKind)}</small>
                      <h3>{item.cropLabel}</h3>
                      <p>{item.objectLabel}{(data?.farms?.length ?? 0) > 1 ? ` · ${farm.name}` : ""}</p>
                      {item.note ? <q>{item.note}</q> : null}
                    </div>
                    <div className="atlas-harvest-coming-row__when">
                      <strong>{pretty(item.expectedDate)}</strong>
                      <span>{confidenceLabel(item.confidence)}</span>
                      {quantityLabel(item) ? <b>{quantityLabel(item)}</b> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </AtlasCard>
    </section>
  );
}
