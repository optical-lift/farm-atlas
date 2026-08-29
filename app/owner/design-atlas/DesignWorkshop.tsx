"use client";

import { useState, type ReactNode } from "react";

import ActiveOutcomeStudies from "../clock-day-lab/ActiveOutcomeStudies";
import ClockDayLab from "../clock-day-lab/ClockDayLab";
import UnlockMoveStudies from "../clock-day-lab/UnlockMoveStudies";
import DestinationContactCardSpecimen from "../task-card-lab/DestinationContactCardSpecimen";
import FarmRoundCardSpecimen from "../task-card-lab/FarmRoundCardSpecimen";
import HarvestCardSpecimen from "../task-card-lab/HarvestCardSpecimen";
import HarvestDirectionCardSpecimen from "../task-card-lab/HarvestDirectionCardSpecimen";
import HarvestPreparationCardSpecimen from "../task-card-lab/HarvestPreparationCardSpecimen";
import MowCardSpecimen from "../task-card-lab/MowCardSpecimen";
import OneOffFieldWorkCardSpecimen from "../task-card-lab/OneOffFieldWorkCardSpecimen";
import PickupHandoffCardSpecimen from "../task-card-lab/PickupHandoffCardSpecimen";
import { TransplantCardSpecimen } from "../task-card-lab/RemainingDominionCardSpecimens";
import SowCardSpecimen from "../task-card-lab/SowCardSpecimen";
import VenueCardSpecimen from "../task-card-lab/VenueCardSpecimen";
import WeedCardSpecimen from "../task-card-lab/WeedCardSpecimen";
import RealClockFixture from "./RealClockFixture";
import RealDayWorkshopFixture from "./RealDayWorkshopFixture";
import styles from "./design-workshop.module.css";

type WorkshopTab = "day" | "tasks" | "clock" | "language";
type TaskKey = "destination" | "venue" | "sow" | "weed" | "mow" | "harvest" | "pickup" | "transplant" | "stewardship" | "setup";

type TaskFamily = { key: TaskKey; family: string };

const TABS: Array<{ key: WorkshopTab; label: string; detail: string }> = [
  { key: "day", label: "Pretend Day", detail: "Live Day skin · fake task truth" },
  { key: "tasks", label: "Task Templates", detail: "The existing Task Card Editor specimens" },
  { key: "clock", label: "Clock + Day", detail: "Live Clock skin + earlier studies" },
  { key: "language", label: "Visual Language", detail: "Shared Atlas ingredients and states" },
];

const TASKS: TaskFamily[] = [
  { key: "destination", family: "Destination" },
  { key: "venue", family: "Venue" },
  { key: "sow", family: "Sow" },
  { key: "weed", family: "Weed" },
  { key: "mow", family: "Mow" },
  { key: "harvest", family: "Harvest" },
  { key: "pickup", family: "Pickup / Handoff" },
  { key: "transplant", family: "Transplant" },
  { key: "stewardship", family: "Stewardship" },
  { key: "setup", family: "Setup + Protect" },
];

function TaskSpecimen({ taskKey }: { taskKey: TaskKey }) {
  if (taskKey === "destination") return <DestinationContactCardSpecimen />;
  if (taskKey === "venue") return <VenueCardSpecimen />;
  if (taskKey === "sow") return <SowCardSpecimen />;
  if (taskKey === "weed") return <WeedCardSpecimen />;
  if (taskKey === "mow") return <MowCardSpecimen />;
  if (taskKey === "harvest") return <><HarvestCardSpecimen /><HarvestDirectionCardSpecimen /><HarvestPreparationCardSpecimen /></>;
  if (taskKey === "pickup") return <PickupHandoffCardSpecimen />;
  if (taskKey === "transplant") return <TransplantCardSpecimen />;
  if (taskKey === "stewardship") return <FarmRoundCardSpecimen />;
  return <OneOffFieldWorkCardSpecimen />;
}

function WorkshopHeader({ children }: { children?: ReactNode }) {
  return (
    <header className={styles.workshopHeader}>
      <span>DESIGN ATLAS · VISUAL WORKSHOP</span>
      <h1>One place for the future Atlas.</h1>
      <p>The primary specimens now wear the same shell, Day, Clock and task grammar as production Atlas. Earlier studies stay underneath as design archaeology instead of defining the current look.</p>
      {children}
    </header>
  );
}

function DayStudy() {
  return (
    <div className={styles.dayShell}>
      <section className={styles.sectionLead}>
        <span>LIVE DAY SKIN · FIXTURE TRUTH</span>
        <h2>Anna’s pretend Saturday</h2>
        <p>This is the real Day presentation contract with ten fake task families. Tap a row and it opens the actual Task Card Editor specimen.</p>
      </section>
      <RealDayWorkshopFixture />
    </div>
  );
}

function TaskGallery() {
  const [selected, setSelected] = useState<TaskKey>("weed");
  return (
    <div className={styles.galleryShell}>
      <section className={styles.sectionLead}>
        <span>TASK TEMPLATE LIBRARY</span>
        <h2>Dominion families</h2>
        <p>Design Atlas mounts the existing Task Card Editor fixture components directly. The schedule stays compact; the opened work carries the rich task language.</p>
      </section>
      <nav className={styles.familyPicker} aria-label="Task specimen family">
        {TASKS.map((task) => <button type="button" key={task.key} data-active={selected === task.key} onClick={() => setSelected(task.key)}>{task.family}</button>)}
      </nav>
      <div className={styles.taskSpecimen}><TaskSpecimen taskKey={selected} /></div>
    </div>
  );
}

function ClockStudies() {
  return (
    <div className={styles.clockStudies}>
      <section className={styles.sectionLead}>
        <span>LIVE CLOCK SKIN · FIXTURE TRUTH</span>
        <h2>The current execution neighborhood</h2>
        <p>The lead specimen uses the production Clock module: its NOW/NEXT cards, hour geometry, timing edges, current-time line, committed blocks and unplaced-work spine.</p>
      </section>
      <div className={styles.studyBlock}><RealClockFixture /></div>
      <details className={styles.archiveStudies}>
        <summary><span>EARLIER DESIGN STUDIES</span><strong>Open Clock + Day archaeology</strong><b aria-hidden="true">⌄</b></summary>
        <div>
          <div className={styles.studyBlock}><ActiveOutcomeStudies /></div>
          <div className={styles.studyBlock}><UnlockMoveStudies /></div>
          <div className={styles.studyBlock}><ClockDayLab /></div>
        </div>
      </details>
    </div>
  );
}

function VisualLanguage() {
  const ingredients = [
    { label: "Paper", detail: "Warm cream canvas + white working surfaces", sample: "paper" },
    { label: "Structure", detail: "Lilac / periwinkle for navigation, rails and context", sample: "structure" },
    { label: "Current", detail: "Yellow-green reserved for useful action, not general decoration", sample: "current" },
    { label: "Ink", detail: "Near-black blue-gray for operational truth", sample: "ink" },
  ];
  return (
    <div className={styles.languageShell}>
      <section className={styles.sectionLead}><span>VISUAL LANGUAGE</span><h2>The live app is now the baseline.</h2><p>Design Atlas should inherit first and invent second. New components should feel native beside Anna’s Home, Day, Clock and Dominion cards before they are promoted into Atlas.</p></section>
      <section className={styles.tokenGrid}>{ingredients.map((item) => <article key={item.label}><i data-sample={item.sample} /><div><strong>{item.label}</strong><span>{item.detail}</span></div></article>)}</section>
      <section className={styles.languageRules}>
        <article><span>01</span><div><strong>Use canonical primitives first.</strong><p>App shell, top bar, cards, dock, Day and Clock visual contracts are inherited rather than redrawn.</p></div></article>
        <article><span>02</span><div><strong>Day surfaces stay thin.</strong><p>Time, place, family and current state. The schedule does not become ten expanded task cards.</p></div></article>
        <article><span>03</span><div><strong>The task opens into the world.</strong><p>Dominion cards carry maps, Trails, resources, desired state and reporting instruments.</p></div></article>
        <article><span>04</span><div><strong>NOW gets one strong signal.</strong><p>Current work gets structural emphasis; everything else stays calm enough to scan.</p></div></article>
        <article><span>05</span><div><strong>Role changes density, not product identity.</strong><p>Principal, Commercial and Shared Operations may expose different truth, but they should still unmistakably be Atlas.</p></div></article>
      </section>
    </div>
  );
}

export default function DesignWorkshop() {
  const [tab, setTab] = useState<WorkshopTab>("day");
  return (
    <div className={styles.workshop} data-design-atlas-workshop="fixture-only">
      <WorkshopHeader>
        <nav className={styles.workshopTabs} aria-label="Design Atlas workshop sections">
          {TABS.map((item) => <button type="button" key={item.key} data-active={tab === item.key} onClick={() => setTab(item.key)}><strong>{item.label}</strong><span>{item.detail}</span></button>)}
        </nav>
      </WorkshopHeader>
      {tab === "day" ? <DayStudy /> : null}
      {tab === "tasks" ? <TaskGallery /> : null}
      {tab === "clock" ? <ClockStudies /> : null}
      {tab === "language" ? <VisualLanguage /> : null}
    </div>
  );
}
