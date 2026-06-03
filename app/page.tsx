"use client";

import { getAreaInventorySummary } from "../data/atlas/claim-automation";
import { useMemo, useState } from "react";
import Link from "next/link";
import { atlasAreas2026 } from "../data/atlas/atlas-areas-2026";
import { atlasTasksJuneJuly2026 } from "../data/atlas/atlas-tasks-june-july-2026";
import { farms, type FarmId } from "../data/atlas/farms";
import { getActiveFarmId, setActiveFarmId } from "../data/atlas/active-farm";
import type { AtlasAreaId } from "../data/atlas/field-types";

type ZoneCard = {
  id: AtlasAreaId;
  label: string;
  priority: string;
  short: string;
  goal: string;
  beds: string;
  irrigation: string;
  weed: string;
  state: string;
  nextMove: string;
};

const zoneCards: ZoneCard[] = [
  {
    id: "field_rows",
    label: "Field Rows",
    priority: "First priority",
    short: "Best production area. Keep this simple and productive.",
    goal: "2 successions · sell 70%",
    beds: "20",
    irrigation: "hose",
    weed: "low",
    state: "plant",
    nextMove: "sow",
  },
  {
    id: "main_garden",
    label: "Main Garden",
    priority: "Second priority",
    short: "Potager / hospitality courtyard. Paths first.",
    goal: "lock paths · make courtyard readable",
    beds: "paths",
    irrigation: "hand",
    weed: "mud",
    state: "layout",
    nextMove: "stones",
  },
  {
    id: "follow_me_to_flowers",
    label: "Follow Me",
    priority: "Third priority",
    short: "Arrival arches and central guest path.",
    goal: "make arrival path intentional",
    beds: "4 arch",
    irrigation: "hand",
    weed: "lawn",
    state: "raw",
    nextMove: "clear",
  },
  {
    id: "entry_billboard_garden",
    label: "Entry Billboard",
    priority: "Fourth priority",
    short: "Roadside first impression. Finish the blank slate.",
    goal: "announce Elm is alive",
    beds: "open",
    irrigation: "hose",
    weed: "mixed",
    state: "reset",
    nextMove: "clean",
  },
  {
    id: "curve_garden",
    label: "Curve Garden",
    priority: "Fifth priority",
    short: "Mostly planted. Weed and plant arch crops.",
    goal: "finish arches · do not redesign",
    beds: "arches",
    irrigation: "hand",
    weed: "normal",
    state: "started",
    nextMove: "weed",
  },
  {
    id: "barn_beds",
    label: "Barn Beds",
    priority: "Suppression zone",
    short: "Worst Bermuda. Cheap bold sunflower suppression only.",
    goal: "clear Bermuda · look intentional",
    beds: "9",
    irrigation: "?",
    weed: "high",
    state: "suppress",
    nextMove: "sun",
  },
  {
    id: "berry_walk_flower_rows",
    label: "Flower Rows",
    priority: "Suppression + appearance",
    short: "Eight annual beds. Watch Bermuda closely.",
    goal: "reclaim rows · monitor Bermuda",
    beds: "8",
    irrigation: "?",
    weed: "high",
    state: "watch",
    nextMove: "sun",
  },
  {
    id: "berry_walk_original",
    label: "Berry Walk",
    priority: "Observe before reset",
    short: "Salvage poppies, catmint, lambs ear, lemon balm.",
    goal: "save survivors · avoid grief decisions",
    beds: "40×60",
    irrigation: "?",
    weed: "unk",
    state: "save",
    nextMove: "mark",
  },
];

function getArea(id: string) {
  return atlasAreas2026.find((area) => area.id === id);
}

function prettyDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getTaskWord(status: string) {
  if (status === "done") return "done";
  if (status === "blocked") return "blocked";
  if (status === "skipped") return "skipped";
  return "open";
}

export default function ElmFarmZonePicker() {
  const [activeFarmId, setActiveFarmIdState] = useState<FarmId>(() => getActiveFarmId());
  const [selectedZoneId, setSelectedZoneId] = useState<AtlasAreaId>("field_rows");

  const selectedZone = zoneCards.find((zone) => zone.id === selectedZoneId) ?? zoneCards[0];
  const selectedArea = getArea(selectedZone.id);

const inventorySummary = getAreaInventorySummary(selectedZone.id);

  const selectedTasks = useMemo(() => {
    return atlasTasksJuneJuly2026
      .filter((task) => task.areaId === selectedZoneId)
      .sort((a, b) => {
        if (a.status === "open" && b.status !== "open") return -1;
        if (a.status !== "open" && b.status === "open") return 1;
        return a.date.localeCompare(b.date);
      });
  }, [selectedZoneId]);

  const openCount = selectedTasks.filter((task) => task.status === "open").length;
  const doneCount = selectedTasks.filter((task) => task.status === "done").length;
  const blockedCount = selectedTasks.filter((task) => task.status === "blocked").length;

  function handleFarmChange(farmId: FarmId) {
    setActiveFarmId(farmId);
    setActiveFarmIdState(farmId);
  }

  return (
    <main className="atlas-phone-shell">
      <section className="atlas-phone">
        <header className="atlas-phone-top with-weather">
          <div className="atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>

            <div className="atlas-title-row">
              <span className="atlas-phone-title">Elm Farm</span>

              <select
                className="atlas-farm-inline-select"
                value={activeFarmId}
                aria-label="Change farm"
                onChange={(event) => handleFarmChange(event.target.value as FarmId)}
              >
                {farms.map((farm) => (
                  <option key={farm.id} value={farm.id}>
                    {farm.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="atlas-weather-center">☁ 61°</div>

          <Link className="atlas-plus-square" href={`/field?add=1&area=${selectedZone.id}`} aria-label="Add task">
            +
          </Link>
        </header>

        <div className="atlas-phone-body">
          <section className="atlas-hero-compact atlas-zone-hero">
            <div className="atlas-zone-hero-mainline">
              <div className="atlas-zone-title-block">
                <span className="atlas-soft-label">Inspect zone</span>

                <div className="atlas-zone-name-row">
                  <h1 className="atlas-zone-name">{selectedZone.label}</h1>

                  <select
                    className="atlas-zone-name-select"
                    value={selectedZoneId}
                    aria-label="Choose growing area"
                    onChange={(event) => setSelectedZoneId(event.target.value as AtlasAreaId)}
                  >
                    {zoneCards.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <Link className="atlas-phone-pill primary" href="/field">
                Tasks
              </Link>
            </div>

            <div className="atlas-zone-goal">
              <span>Zone goal</span>
              <strong>{selectedZone.goal}</strong>
            </div>

            <div className="atlas-zone-hero-selected">
              <span>{selectedZone.priority}</span>
              <em>{selectedArea?.currentGoal ?? selectedZone.short}</em>
            </div>

            {selectedArea?.guardrail && (
              <div className="atlas-zone-hero-guardrail">
                {selectedArea.guardrail}
              </div>
            )}

            <div className="atlas-zone-data-grid five-across">
              <div className="atlas-zone-data">
                <span>▦</span>
                <strong>{selectedZone.beds}</strong>
              </div>

              <div className="atlas-zone-data">
                <span>💧</span>
                <strong>{selectedZone.irrigation}</strong>
              </div>

              <div className="atlas-zone-data">
                <span>☘</span>
                <strong>{selectedZone.weed}</strong>
              </div>

              <div className="atlas-zone-data">
                <span>◒</span>
                <strong>{selectedZone.state}</strong>
              </div>

              <div className="atlas-zone-data">
                <span>→</span>
                <strong>{selectedZone.nextMove}</strong>
              </div>
            </div>
          </section>

          <section className="atlas-primary-card">
            <div className="atlas-primary-top">
              <div>
                <span className="atlas-soft-label">Inventory</span>
                <div className="atlas-primary-title">{selectedZone.label}</div>
              </div>

              <span className="atlas-primary-status">{openCount} open</span>
            </div>

<div className="atlas-inventory-grid">
  <div className="atlas-inventory-row">
    <span>Beds planted</span>
    <strong>
      {inventorySummary.plantedBeds} / {selectedZone.beds}
    </strong>
  </div>

  <div className="atlas-inventory-row">
    <span>Crops claimed</span>
    <strong>{inventorySummary.cropsLabel}</strong>
  </div>

  <div className="atlas-inventory-row">
    <span>Next harvest watch</span>
    <strong>{inventorySummary.nextHarvest}</strong>
  </div>

  <div className="atlas-inventory-row money">
    <span>Potential revenue</span>
    <strong>{inventorySummary.revenueLabel}</strong>
  </div>
</div>

            <div className="atlas-zone-mini-stats">
              <span>Open {openCount}</span>
              <span>Done {doneCount}</span>
              <span>Block {blockedCount}</span>
            </div>

            <div className="atlas-icon-actions">
              <Link
                className="atlas-zone-action primary"
                href={`/field?area=${selectedZone.id}`}
              >
                Open area board
              </Link>

              <Link
                className="atlas-zone-action accent"
                href={`/field?add=1&area=${selectedZone.id}`}
              >
                + Task here
              </Link>
            </div>
          </section>

          <section className="atlas-soft-card compact">
            <div className="atlas-soft-head">
              <div>
                <span className="atlas-soft-label">Tasks here</span>
                <div className="atlas-soft-heading">{selectedZone.label}</div>
              </div>

              <span className="atlas-soft-badge">{selectedTasks.length}</span>
            </div>

            <div className="atlas-task-list zone-task-list">
              {selectedTasks.length > 0 ? (
                selectedTasks.map((task) => (
                  <Link
                    key={task.id}
                    className={`atlas-task-row zone-task-row zone-task-row-${task.status}`}
                    href={`/field?area=${selectedZone.id}`}
                  >
                    <div className="atlas-task-row-head">
                      <span className="atlas-soft-label">{prettyDate(task.date)}</span>
                      <span className="atlas-primary-status">{getTaskWord(task.status)}</span>
                    </div>

                    <strong>{task.title}</strong>
                    <small>{task.unlockText}</small>
                  </Link>
                ))
              ) : (
                <div className="atlas-empty">
                  No tasks are attached to this area yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}