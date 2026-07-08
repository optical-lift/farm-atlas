"use client";

import { useEffect, useMemo, useState } from "react";

import { createAtlasFieldLog } from "@/lib/atlas/field-log-client";
import type { AtlasRegistryObject, AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

export type AtlasFieldLogWorkKey = "weed" | "plant" | "sow" | "water" | "check" | "harvest" | "move" | "maintain" | "observe";

export type AtlasFieldLogSeed = {
  workKey?: AtlasFieldLogWorkKey;
  zoneKeys?: string[];
  objectKeys?: string[];
};

type WorkConfig = {
  key: AtlasFieldLogWorkKey;
  label: string;
  verb: string;
  actionTypes: string[];
};

const workConfigs: WorkConfig[] = [
  { key: "weed", label: "Weed", verb: "weeded", actionTypes: ["weeded"] },
  { key: "plant", label: "Plant", verb: "planted", actionTypes: ["planted"] },
  { key: "sow", label: "Sow", verb: "sowed", actionTypes: ["sowed"] },
  { key: "water", label: "Water", verb: "watered", actionTypes: ["watered"] },
  { key: "check", label: "Check", verb: "checked", actionTypes: ["checked"] },
  { key: "harvest", label: "Harvest", verb: "harvested", actionTypes: ["harvested"] },
  { key: "move", label: "Move", verb: "moved", actionTypes: ["moved"] },
  { key: "maintain", label: "Maintain", verb: "maintained", actionTypes: ["maintained"] },
  { key: "observe", label: "Observe", verb: "observed", actionTypes: ["observed"] },
];

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function cleanList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function phraseList(values: string[]) {
  const clean = cleanList(values);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function compactSpot(label: string) {
  const berry = label.match(/Berry Walk Bed\s*(\d+)/i);
  if (berry) return `BW${berry[1]}`;
  const barn = label.match(/Barn Bed\s*(\d+)/i);
  if (barn) return `BB${barn[1]}`;
  const field = label.match(/Field Row\s*(\d+)/i);
  if (field) return `FR${field[1]}`;
  const entry = label.match(/Entry Billboard(?: Sunflower)? Bed\s*(\d+)/i);
  if (entry) return `EB${entry[1]}`;
  return label;
}

function workConfig(key: AtlasFieldLogWorkKey) {
  return workConfigs.find((config) => config.key === key) ?? workConfigs[workConfigs.length - 1];
}

function zoneLabels(zones: AtlasRegistryZone[], zoneKeys: string[]) {
  return cleanList(zoneKeys.map((key) => zones.find((zone) => zone.stable_key === key)?.label ?? key));
}

function objectLabels(objects: AtlasRegistryObject[], objectKeys: string[]) {
  return cleanList(objectKeys.map((key) => objects.find((object) => object.stable_key === key)?.label ?? key));
}

function visibleObjectsForZones(zones: AtlasRegistryZone[], zoneKeys: string[]) {
  if (zoneKeys.length === 0) return [];
  const selected = new Set(zoneKeys);
  return zones.flatMap((zone) => selected.has(zone.stable_key) ? zone.objects : []);
}

function documentationSentence({
  zones,
  selectedWork,
  zoneKeys,
  objectKeys,
}: {
  zones: AtlasRegistryZone[];
  selectedWork: WorkConfig;
  zoneKeys: string[];
  objectKeys: string[];
}) {
  const visibleObjects = visibleObjectsForZones(zones, zoneKeys);
  const bedPhrase = phraseList(objectLabels(visibleObjects, objectKeys).map(compactSpot));
  const zonePhrase = phraseList(zoneLabels(zones, zoneKeys));

  if (bedPhrase && zonePhrase) return `I touched ${bedPhrase} in ${zonePhrase} and ${selectedWork.verb}.`;
  if (zonePhrase) return `I touched ${zonePhrase} and ${selectedWork.verb}.`;
  return `I touched Whole farm and ${selectedWork.verb}.`;
}

export function DocumentWorkCard({
  title = "Document work here",
  detail = "Record what was touched, where it happened, and what was done.",
  onOpen,
}: {
  title?: string;
  detail?: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="atlas-document-work-card" onClick={onOpen}>
      <span>Field log</span>
      <strong>{title}</strong>
      <em>{detail}</em>
    </button>
  );
}

export function FieldLogDrawer({
  zones,
  seed,
  onClose,
  onSaved,
}: {
  zones: AtlasRegistryZone[];
  seed: AtlasFieldLogSeed;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const [workKey, setWorkKey] = useState<AtlasFieldLogWorkKey>(seed.workKey ?? "observe");
  const [zoneKeys, setZoneKeys] = useState<string[]>(seed.zoneKeys ?? []);
  const [objectKeys, setObjectKeys] = useState<string[]>(seed.objectKeys ?? []);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setWorkKey(seed.workKey ?? "observe");
    setZoneKeys(seed.zoneKeys ?? []);
    setObjectKeys(seed.objectKeys ?? []);
    setNote("");
    setMessage(null);
  }, [seed]);

  const selectedWork = workConfig(workKey);
  const visibleObjects = useMemo(() => visibleObjectsForZones(zones, zoneKeys), [zones, zoneKeys]);
  const summarySentence = documentationSentence({ zones, selectedWork, zoneKeys, objectKeys });
  const selectedZoneSet = new Set(zoneKeys);
  const selectedObjectSet = new Set(objectKeys);

  function toggleZone(key: string) {
    setZoneKeys((current) => {
      if (current.includes(key)) {
        const next = current.filter((candidate) => candidate !== key);
        const zone = zones.find((candidate) => candidate.stable_key === key);
        if (zone) {
          const removedObjects = new Set(zone.objects.map((object) => object.stable_key));
          setObjectKeys((objects) => objects.filter((objectKey) => !removedObjects.has(objectKey)));
        }
        return next;
      }
      return [...current, key];
    });
  }

  function toggleObject(key: string) {
    setObjectKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]);
  }

  async function saveLog() {
    try {
      setSaving(true);
      setMessage(null);
      await createAtlasFieldLog({
        actionTypes: selectedWork.actionTypes,
        summarySentence,
        note: note.trim() || undefined,
        zoneKeys,
        objectKeys,
        createdBy: "atlas_field_log_builder",
      });
      await onSaved?.();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Field log failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true">
      <div className="atlas-task-focus-phone atlas-document-log-phone">
        <div className="atlas-task-focus-topbar">
          <div>
            <strong>Document work</strong>
            <span>{prettyDate(todayIso())}</span>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        <div className="atlas-task-focus-body atlas-log-builder atlas-document-log-builder">
          <section className="atlas-task-focus-purple atlas-log-hero">
            <div className="atlas-task-focus-kicker"><span>Field log</span></div>
            <h2>{selectedWork.label}</h2>
            <p>{summarySentence}</p>
          </section>

          <section className="atlas-task-focus-section atlas-log-compose">
            <div className="atlas-log-sentence">{summarySentence}</div>

            <div className="atlas-log-step">
              <span>Work</span>
              <div className="atlas-log-chip-grid">
                {workConfigs.map((work) => (
                  <button key={work.key} type="button" className={work.key === workKey ? "selected" : ""} onClick={() => setWorkKey(work.key)}>
                    {work.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="atlas-log-step">
              <div className="atlas-log-step-head">
                <span>Zone</span>
                <small>{zoneKeys.length ? `${zoneKeys.length} selected` : "Whole farm"}</small>
              </div>
              <div className="atlas-log-chip-grid compact expanded">
                {zones.map((zone) => (
                  <button key={zone.id} type="button" className={selectedZoneSet.has(zone.stable_key) ? "selected" : ""} onClick={() => toggleZone(zone.stable_key)}>
                    {zone.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="atlas-log-step">
              <div className="atlas-log-step-head">
                <span>Beds / objects</span>
                <small>{objectKeys.length ? `${objectKeys.length} selected` : "optional"}</small>
              </div>
              {visibleObjects.length === 0 ? (
                <p className="atlas-log-muted">Choose a zone to document a specific bed. Leave blank for a whole-farm note.</p>
              ) : (
                <div className="atlas-log-chip-grid compact expanded">
                  {visibleObjects.map((object) => (
                    <button key={object.id} type="button" className={selectedObjectSet.has(object.stable_key) ? "selected" : ""} onClick={() => toggleObject(object.stable_key)}>
                      {compactSpot(object.label)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="atlas-add-form">
              <textarea aria-label="Field note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" />
            </div>

            <button type="button" className="atlas-zone-action accent atlas-document-save-button" disabled={saving} onClick={() => void saveLog()}>
              {saving ? "Saving" : "Save field log"}
            </button>
            {message ? <p className="atlas-task-result-message">{message}</p> : null}
          </section>
        </div>
      </div>
    </section>
  );
}
