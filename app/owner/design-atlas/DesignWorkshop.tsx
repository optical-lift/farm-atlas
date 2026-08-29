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
import styles from "./design-workshop.module.css";

type WorkshopTab = "day" | "tasks" | "clock" | "language";
type TaskKey = "destination" | "venue" | "sow" | "weed" | "mow" | "harvest" | "pickup" | "transplant" | "stewardship" | "setup";
type FakeTask = {
  key: TaskKey;
  time: string;
  window: string;
  family: string;
  title: string;
  place: string;
  duration: string;
  state: "done" | "now" | "next" | "later";
  timing: "fixed" | "windowed" | "anchored" | "flexible";
};

const TABS: Array<{ key: WorkshopTab; label: string; detail: string }> = [
  { key: "day", label: "Pretend Day", detail: "Anna-style schedule using real task families" },
  { key: "tasks", label: "Task Templates", detail: "The existing Task Card Editor specimens" },
  { key: "clock", label: "Clock + Day", detail: "Existing execution-neighborhood studies" },
  { key: "language", label: "Visual Language", detail: "Shared Atlas ingredients and states" },
];

const TASKS: FakeTask[] = [
  { key: "stewardship", time: "6:30", window: "Morning", family: "Stewardship", title: "Saturday Farm Round", place: "Elm Farm", duration: "30 min", state: "done", timing: "fixed" },
  { key: "harvest", time: "7:00", window: "Morning", family: "Harvest", title: "Harvest ProCut Orange sunflower", place: "Field Rows", duration: "45 min", state: "done", timing: "windowed" },
  { key: "weed", time: "8:00", window: "Morning", family: "Weed", title: "Weed Field Row 13", place: "Field Rows", duration: "30 min", state: "now", timing: "windowed" },
  { key: "transplant", time: "8:45", window: "Morning", family: "Transplant", title: "Transplant cabbage into MG7", place: "Main Garden", duration: "45 min", state: "next", timing: "windowed" },
  { key: "sow", time: "9:45", window: "Morning", family: "Sow", title: "Sow ProCut White Lite", place: "Barn Beds", duration: "30 min", state: "later", timing: "anchored" },
  { key: "setup", time: "10:30", window: "Morning", family: "Setup + Protect", title: "String the next Barn Bed", place: "Barn Beds", duration: "25 min", state: "later", timing: "flexible" },
  { key: "venue", time: "1:00", window: "Afternoon", family: "Venue", title: "Reset Farmhouse for workshop", place: "Farmhouse", duration: "35 min", state: "later", timing: "fixed" },
  { key: "pickup", time: "2:00", window: "Afternoon", family: "Pickup / Handoff", title: "Stage florist pickups", place: "Flower Room", duration: "30 min", state: "later", timing: "fixed" },
  { key: "destination", time: "3:00", window: "Afternoon", family: "Destination", title: "Deliver sample flowers", place: "Springfield route", duration: "45 min", state: "later", timing: "fixed" },
  { key: "mow", time: "7:15", window: "Evening", family: "Mow", title: "Mow orchard edge", place: "Orchard", duration: "35 min", state: "later", timing: "windowed" },
];

const TASK_LABELS: Record<TaskKey, string> = Object.fromEntries(TASKS.map((task) => [task.key, task.family])) as Record<TaskKey, string>;

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
      <p>Use the fake portal to pressure-test the product. Use this workshop to keep the visual grammar, task families, Clock studies and new component ideas together.</p>
      {children}
    </header>
  );
}

function FakeDay() {
  const [openTask, setOpenTask] = useState<TaskKey | null>(null);
  const active = TASKS.find((task) => task.state === "now") ?? TASKS[0];
  const next = TASKS.find((task) => task.state === "next") ?? TASKS[1];

  return (
    <div className={styles.dayShell}>
      <section className={styles.annaDayHeader}>
        <div>
          <span>SATURDAY · AUG 29</span>
          <h2>Your day</h2>
          <small>Fixture day · every task family is represented once</small>
        </div>
        <div className={styles.shiftChip}><small>CLOCKED IN</small><strong>2h 42m</strong><span>22h 30m this week</span></div>
      </section>

      <section className={styles.nowNext}>
        <article data-state="now"><span>NOW</span><strong>{active.title}</strong><small>{active.place} · {active.duration}</small><button type="button" onClick={() => setOpenTask(active.key)}>Open task ›</button></article>
        <article data-state="next"><span>NEXT</span><strong>{next.title}</strong><small>{next.place} · {next.duration}</small><button type="button" onClick={() => setOpenTask(next.key)}>Preview ›</button></article>
      </section>

      <section className={styles.dayTimeline}>
        <header><div><span>DAY FEED</span><h3>Pretend schedule</h3></div><small>Tap any task to open its real template</small></header>
        <div className={styles.timelineRows}>
          {TASKS.map((task) => (
            <button type="button" className={styles.timelineTask} data-state={task.state} data-timing={task.timing} key={task.key} onClick={() => setOpenTask(task.key)}>
              <time>{task.time}</time>
              <i aria-hidden="true" />
              <div>
                <span>{task.window} · {task.family}</span>
                <strong>{task.title}</strong>
                <small>{task.place} · {task.duration}</small>
              </div>
              <b>{task.state === "done" ? "DONE" : task.state === "now" ? "NOW" : task.state === "next" ? "NEXT" : "›"}</b>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.dayFooterStudy}>
        <div><small>TODAY</small><strong>10</strong><span>task families</span></div>
        <div><small>CURRENT</small><strong>Weed</strong><span>execution warrant</span></div>
        <div><small>NEXT HARD EDGE</small><strong>1:00</strong><span>venue reset</span></div>
      </section>

      {openTask ? (
        <div className={styles.taskOverlay} role="dialog" aria-modal="true" aria-label={`${TASK_LABELS[openTask]} task specimen`}>
          <div className={styles.taskSheet}>
            <header className={styles.taskSheetHeader}>
              <div><span>REAL TEMPLATE · FAKE DATA</span><strong>{TASK_LABELS[openTask]}</strong><small>This is the existing Task Card Editor specimen inside the pretend day.</small></div>
              <button type="button" onClick={() => setOpenTask(null)} aria-label="Close task specimen">×</button>
            </header>
            <div className={styles.taskSpecimen}><TaskSpecimen taskKey={openTask} /></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskGallery() {
  const [selected, setSelected] = useState<TaskKey>("weed");
  return (
    <div className={styles.galleryShell}>
      <section className={styles.sectionLead}>
        <span>TASK TEMPLATE LIBRARY</span>
        <h2>Approved-looking Dominion families</h2>
        <p>These are not redrawn approximations. Design Atlas mounts the same fixture components currently used by the Task Card Editor.</p>
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
        <span>CLOCK + DAY LIBRARY</span>
        <h2>Execution-neighborhood studies</h2>
        <p>The existing Clock + Day concepts now live inside Design Atlas too. We can keep refining them here without losing the original fixture studies.</p>
      </section>
      <div className={styles.studyBlock}><ActiveOutcomeStudies /></div>
      <div className={styles.studyBlock}><UnlockMoveStudies /></div>
      <div className={styles.studyBlock}><ClockDayLab /></div>
    </div>
  );
}

function VisualLanguage() {
  const ingredients = [
    { label: "Paper", detail: "Warm cream canvas + white working surfaces", sample: "paper" },
    { label: "Structure", detail: "Lilac / periwinkle for navigation, rails and context", sample: "structure" },
    { label: "Current", detail: "Yellow-green reserved for the next useful action", sample: "current" },
    { label: "Ink", detail: "Near-black blue-gray for readable operational truth", sample: "ink" },
  ];
  return (
    <div className={styles.languageShell}>
      <section className={styles.sectionLead}><span>VISUAL LANGUAGE</span><h2>Anna’s portal is the visual baseline.</h2><p>The long-run Atlas should feel like one calm operating instrument: compact day-level surfaces first, richer Dominion cards only when a person enters the work.</p></section>
      <section className={styles.tokenGrid}>{ingredients.map((item) => <article key={item.label}><i data-sample={item.sample} /><div><strong>{item.label}</strong><span>{item.detail}</span></div></article>)}</section>
      <section className={styles.languageRules}>
        <article><span>01</span><div><strong>Day surfaces stay thin.</strong><p>Time, place, family, current state. The schedule should not become ten expanded task cards.</p></div></article>
        <article><span>02</span><div><strong>The task opens into the world.</strong><p>Dominion cards carry maps, Trails, resources, desired state and reporting instruments.</p></div></article>
        <article><span>03</span><div><strong>NOW gets the strongest signal.</strong><p>Workers should be able to glance once and know what Atlas is asking them to steward.</p></div></article>
        <article><span>04</span><div><strong>One visual grammar crosses roles.</strong><p>Principal, Commercial and Shared Operations can change information density without becoming different products.</p></div></article>
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
      {tab === "day" ? <FakeDay /> : null}
      {tab === "tasks" ? <TaskGallery /> : null}
      {tab === "clock" ? <ClockStudies /> : null}
      {tab === "language" ? <VisualLanguage /> : null}
    </div>
  );
}
