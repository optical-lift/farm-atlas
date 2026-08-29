"use client";

import { useState } from "react";

import DestinationContactCardSpecimen from "../task-card-lab/DestinationContactCardSpecimen";
import FarmRoundCardSpecimen from "../task-card-lab/FarmRoundCardSpecimen";
import HarvestCardSpecimen from "../task-card-lab/HarvestCardSpecimen";
import MowCardSpecimen from "../task-card-lab/MowCardSpecimen";
import OneOffFieldWorkCardSpecimen from "../task-card-lab/OneOffFieldWorkCardSpecimen";
import PickupHandoffCardSpecimen from "../task-card-lab/PickupHandoffCardSpecimen";
import { TransplantCardSpecimen } from "../task-card-lab/RemainingDominionCardSpecimens";
import SowCardSpecimen from "../task-card-lab/SowCardSpecimen";
import VenueCardSpecimen from "../task-card-lab/VenueCardSpecimen";
import WeedCardSpecimen from "../task-card-lab/WeedCardSpecimen";
import styles from "./real-day-workshop-fixture.module.css";

type TaskKey = "destination" | "venue" | "sow" | "weed" | "mow" | "harvest" | "pickup" | "transplant" | "stewardship" | "setup";
type Task = { key: TaskKey; family: string; title: string; place: string; detail: string; time: string; window: "Morning" | "Afternoon" | "Evening"; state: "done" | "current" | "next" | "later" };

const TASKS: Task[] = [
  { key: "stewardship", family: "Stewardship", title: "Saturday Farm Round", place: "Elm Farm", detail: "Open the farm and record what changed", time: "6:30", window: "Morning", state: "done" },
  { key: "harvest", family: "Harvest", title: "Harvest ProCut Orange sunflower", place: "Field Rows", detail: "Cut market-ready stems", time: "7:00", window: "Morning", state: "done" },
  { key: "weed", family: "Weed", title: "Weed Field Row 13", place: "Field Rows", detail: "Clear the crop row before heat builds", time: "8:00", window: "Morning", state: "current" },
  { key: "transplant", family: "Transplant", title: "Transplant cabbage into MG7", place: "Main Garden", detail: "Bed is ready after current move", time: "8:45", window: "Morning", state: "next" },
  { key: "sow", family: "Sow", title: "Sow ProCut White Lite", place: "Barn Beds", detail: "Next succession", time: "9:45", window: "Morning", state: "later" },
  { key: "setup", family: "Setup + protect", title: "String the next Barn Bed", place: "Barn Beds", detail: "Prepare support before growth needs it", time: "10:30", window: "Morning", state: "later" },
  { key: "venue", family: "Venue", title: "Reset Farmhouse for workshop", place: "Farmhouse", detail: "Arrival state: guest ready", time: "1:00", window: "Afternoon", state: "later" },
  { key: "pickup", family: "Pickup / handoff", title: "Stage florist pickups", place: "Flower Room", detail: "Hold each order in outbound custody", time: "2:00", window: "Afternoon", state: "later" },
  { key: "destination", family: "Destination", title: "Deliver sample flowers", place: "Springfield route", detail: "Commercial handoff", time: "3:00", window: "Afternoon", state: "later" },
  { key: "mow", family: "Mow", title: "Mow orchard edge", place: "Orchard", detail: "Evening outdoor window", time: "7:15", window: "Evening", state: "later" },
];

function TaskSpecimen({ taskKey }: { taskKey: TaskKey }) {
  if (taskKey === "destination") return <DestinationContactCardSpecimen />;
  if (taskKey === "venue") return <VenueCardSpecimen />;
  if (taskKey === "sow") return <SowCardSpecimen />;
  if (taskKey === "weed") return <WeedCardSpecimen />;
  if (taskKey === "mow") return <MowCardSpecimen />;
  if (taskKey === "harvest") return <HarvestCardSpecimen />;
  if (taskKey === "pickup") return <PickupHandoffCardSpecimen />;
  if (taskKey === "transplant") return <TransplantCardSpecimen />;
  if (taskKey === "stewardship") return <FarmRoundCardSpecimen />;
  return <OneOffFieldWorkCardSpecimen />;
}

function Row({ task, onOpen }: { task: Task; onOpen: (key: TaskKey) => void }) {
  const complete = task.state === "done";
  const current = task.state === "current";
  const routeClass = current ? " atlas-day-route-current" : task.state === "next" ? " atlas-day-route-next" : "";
  return <div className={`atlas-day-task-entry${complete ? " atlas-day-complete-entry" : ""}${routeClass}`}>
    <button type="button" className={`atlas-day-task-node${complete ? " is-complete" : ""}`} aria-label={complete ? `Completed ${task.title}` : `Pretend complete ${task.title}`}><span aria-hidden="true"/></button>
    <details className={`atlas-day-task-card atlas-journal-task-row${complete ? " complete" : ""}${routeClass}`} aria-current={current ? "step" : undefined}>
      <summary onClick={(event) => { event.preventDefault(); onOpen(task.key); }}>
        {!complete ? <small className="atlas-day-task-family">{current ? `Current · ${task.family}` : task.family}</small> : null}
        <strong>{task.title}</strong>
        <span>{complete ? "Complete" : `${task.time} · ${task.place}`}</span>
        <em>{task.detail}</em>
        {!complete ? <span className="atlas-day-task-cues"><i>{task.window}</i>{task.state === "next" ? <i>Next</i> : null}</span> : null}
        <b className="atlas-journal-row-caret" aria-hidden="true">⌄</b>
      </summary>
    </details>
  </div>;
}

export default function RealDayWorkshopFixture() {
  const [openTask, setOpenTask] = useState<TaskKey | null>(null);
  const groups = ["Morning", "Afternoon", "Evening"] as const;
  const selected = openTask ? TASKS.find((task) => task.key === openTask) ?? null : null;
  return <div className={styles.fixture} data-atlas-day-fixture="real-skin">
    <div className="atlas-task-page-body">
      <section className="atlas-task-page-section atlas-route-collection atlas-day-browse">
        <div className="atlas-day-browse-head"><button type="button" className="atlas-route-back atlas-day-back">← Week</button><div className="atlas-day-browse-title-row"><span>Sat · Aug 29</span><strong>8 open · 2 done</strong></div><p>10 fake tasks using the live Day presentation</p></div>
        <article className="atlas-day-command-header" data-day-denominator="2/10">
          <div className="atlas-day-command-topline"><div className="atlas-day-command-date"><strong>Saturday, Aug 29</strong><span>8 still in today</span></div><div className="atlas-day-filter-pill atlas-day-view-toggle"><button type="button" className="selected">Timeline</button><button type="button">Zone</button></div></div>
          <div className={styles.progress}><div><span>2 of 10 dealt with</span><b>20%</b></div><i><span style={{ width: "20%" }}/></i></div>
        </article>
        <div className="atlas-day-task-groups">
          <article className="atlas-day-route-group atlas-day-work-order-group atlas-day-timeline-group">
            <h3>Work the day</h3>
            <div className="atlas-day-work-order-list atlas-day-route-spine atlas-day-mixed-timeline">
              {groups.map((group) => <section className={styles.window} key={group}><header><span>{group}</span><small>{TASKS.filter((task) => task.window === group).length} moves</small></header>{TASKS.filter((task) => task.window === group).map((task) => <Row task={task} onOpen={setOpenTask} key={task.key}/>)}</section>)}
            </div>
          </article>
        </div>
        <nav className="atlas-day-adjacent-nav" aria-label="Pretend adjacent days"><button type="button"><span aria-hidden="true">←</span><em>Yesterday</em></button><button type="button"><em>Tomorrow</em><span aria-hidden="true">→</span></button></nav>
      </section>
    </div>
    {openTask && selected ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`${selected.family} task specimen`}><div className={styles.sheet}><header><div><span>REAL TASK TEMPLATE · FAKE DATA</span><strong>{selected.title}</strong><small>Opened from the live Day visual contract.</small></div><button type="button" onClick={() => setOpenTask(null)} aria-label="Close task specimen">×</button></header><div className={styles.specimen}><TaskSpecimen taskKey={openTask}/></div></div></div> : null}
  </div>;
}
