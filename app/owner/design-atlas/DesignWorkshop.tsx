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
import FutureClockFixture from "./FutureClockFixture";
import RealClockFixture from "./RealClockFixture";
import RealDayWorkshopFixture from "./RealDayWorkshopFixture";
import styles from "./design-workshop.module.css";

type WorkshopTab = "day" | "tasks" | "clock" | "language";
type TaskKey = "destination" | "venue" | "sow" | "weed" | "mow" | "harvest" | "pickup" | "transplant" | "stewardship" | "setup";
type TaskFamily = { key: TaskKey; family: string };

const TABS: Array<{ key: WorkshopTab; label: string; detail: string }> = [
  { key: "day", label: "Pretend Day", detail: "Live Day skin · fake task truth" },
  { key: "tasks", label: "Task Templates", detail: "The existing Task Card Editor specimens" },
  { key: "clock", label: "Clock + Day", detail: "Shared Study 15 surface + legacy reference" },
  { key: "language", label: "Visual Language", detail: "Shared Atlas ingredients and states" },
];

const TASKS: TaskFamily[] = [
  { key: "destination", family: "Destination" }, { key: "venue", family: "Venue" }, { key: "sow", family: "Sow" },
  { key: "weed", family: "Weed" }, { key: "mow", family: "Mow" }, { key: "harvest", family: "Harvest" },
  { key: "pickup", family: "Pickup / Handoff" }, { key: "transplant", family: "Transplant" },
  { key: "stewardship", family: "Stewardship" }, { key: "setup", family: "Setup + Protect" },
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
  return <header className={styles.workshopHeader}><span>DESIGN ATLAS · VISUAL WORKSHOP</span><h1>One place for the future Atlas.</h1><p>The primary specimens inherit production wherever a canonical component exists. Approved future directions remain explicit future specimens instead of being mistaken for shipped behavior.</p>{children}</header>;
}

function DayStudy() {
  return <div className={styles.dayShell}><section className={styles.sectionLead}><span>LIVE DAY SKIN · FIXTURE TRUTH</span><h2>Anna’s pretend Saturday</h2><p>This is the live Day presentation contract with fake work. Day is still the remaining major route-local custody seam.</p></section><RealDayWorkshopFixture /></div>;
}

function TaskGallery() {
  const [selected, setSelected] = useState<TaskKey>("weed");
  return <div className={styles.galleryShell}><section className={styles.sectionLead}><span>TASK TEMPLATE LIBRARY</span><h2>Dominion families</h2><p>Design Atlas mounts the existing Task Card Editor fixture components directly. The schedule stays compact; opened work carries the rich task language.</p></section><nav className={styles.familyPicker} aria-label="Task specimen family">{TASKS.map((task) => <button type="button" key={task.key} data-active={selected === task.key} onClick={() => setSelected(task.key)}>{task.family}</button>)}</nav><div className={styles.taskSpecimen}><TaskSpecimen taskKey={selected} /></div></div>;
}

function ClockStudies() {
  return (
    <div className={styles.clockStudies}>
      <section className={styles.sectionLead}>
        <span>SHARED WORKER CLOCK · STUDY 15</span>
        <h2>Day owns the whole day. Clock owns the worker’s hands.</h2>
        <p>The lead specimen now mounts the same reusable Worker Clock presentation used by the live worker route: the complete service day stays present as a thin rail, while Clock expands only LAST / NOW / NEXT / THEN and the next hard edge. Reality reflows silently until Atlas genuinely needs a human decision.</p>
      </section>
      <div className={styles.studyBlock}><FutureClockFixture /></div>
      <details className={styles.archiveStudies}>
        <summary><span>LEGACY CLOCK REFERENCE</span><strong>Open the pre-Study-15 timeline implementation</strong><b aria-hidden="true">⌄</b></summary>
        <div><div className={styles.studyBlock}><RealClockFixture /></div></div>
      </details>
      <details className={styles.archiveStudies}>
        <summary><span>EDITOR STRESS TESTS</span><strong>Open normal, reflow, conflict and earlier Clock + Day studies</strong><b aria-hidden="true">⌄</b></summary>
        <div><div className={styles.studyBlock}><ActiveOutcomeStudies /></div><div className={styles.studyBlock}><UnlockMoveStudies /></div><div className={styles.studyBlock}><ClockDayLab /></div></div>
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
  return <div className={styles.languageShell}><section className={styles.sectionLead}><span>VISUAL LANGUAGE</span><h2>The live app is the baseline; governed future direction is the exception.</h2><p>Design Atlas inherits first and invents only where a future product direction is already chosen but not yet implemented.</p></section><section className={styles.tokenGrid}>{ingredients.map((item) => <article key={item.label}><i data-sample={item.sample} /><div><strong>{item.label}</strong><span>{item.detail}</span></div></article>)}</section><section className={styles.languageRules}><article><span>01</span><div><strong>Use canonical primitives first.</strong><p>App shell, top bar, cards, dock and production components are inherited rather than redrawn.</p></div></article><article><span>02</span><div><strong>Future means governed, not imagined.</strong><p>A future specimen must point to an already chosen product direction and stay visibly distinct from shipped behavior.</p></div></article><article><span>03</span><div><strong>Clock gets quieter as Atlas gets smarter.</strong><p>Scheduling intelligence should change choreography before it adds pixels.</p></div></article><article><span>04</span><div><strong>NOW gets ownership.</strong><p>One responsibility dominates; NEXT prevents surprise; distant work stays sparse.</p></div></article><article><span>05</span><div><strong>One truth, many projections.</strong><p>Clock, Day, Task Focus and Manager must never create independent copies of the same work.</p></div></article></section></div>;
}

export default function DesignWorkshop() {
  const [tab, setTab] = useState<WorkshopTab>("day");
  return <div className={styles.workshop} data-design-atlas-workshop="fixture-only"><WorkshopHeader><nav className={styles.workshopTabs} aria-label="Design Atlas workshop sections">{TABS.map((item) => <button type="button" key={item.key} data-active={tab === item.key} onClick={() => setTab(item.key)}><strong>{item.label}</strong><span>{item.detail}</span></button>)}</nav></WorkshopHeader>{tab === "day" ? <DayStudy /> : null}{tab === "tasks" ? <TaskGallery /> : null}{tab === "clock" ? <ClockStudies /> : null}{tab === "language" ? <VisualLanguage /> : null}</div>;
}
