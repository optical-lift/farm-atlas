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

type WorkerPersona = "anna" | "marshall";
type TaskKey = "destination" | "venue" | "sow" | "weed" | "mow" | "harvest" | "pickup" | "transplant" | "stewardship" | "setup";
type Task = {
  id: string;
  key: TaskKey;
  family: string;
  title: string;
  place: string;
  detail: string;
  time: string;
  window: "Morning" | "Afternoon" | "Evening";
  state: "done" | "current" | "next" | "later";
};

const ANNA_TASKS: Task[] = [
  { id: "anna-farm-round", key: "stewardship", family: "Stewardship", title: "Saturday Farm Round", place: "Elm Farm", detail: "Open the farm and record what changed", time: "6:30", window: "Morning", state: "done" },
  { id: "anna-harvest-sunflower", key: "harvest", family: "Harvest", title: "Harvest ProCut Orange sunflower", place: "Field Rows", detail: "Cut market-ready stems", time: "7:00", window: "Morning", state: "done" },
  { id: "anna-weed-row-13", key: "weed", family: "Weed", title: "Weed Field Row 13", place: "Field Rows", detail: "Clear the crop row before heat builds", time: "8:00", window: "Morning", state: "current" },
  { id: "anna-transplant-mg7", key: "transplant", family: "Transplant", title: "Transplant cabbage into MG7", place: "Main Garden", detail: "Bed is ready after current move", time: "8:45", window: "Morning", state: "next" },
  { id: "anna-sow-white-lite", key: "sow", family: "Sow", title: "Sow ProCut White Lite", place: "Barn Beds", detail: "Next succession", time: "9:45", window: "Morning", state: "later" },
  { id: "anna-string-barn-bed", key: "setup", family: "Setup + protect", title: "String the next Barn Bed", place: "Barn Beds", detail: "Prepare support before growth needs it", time: "10:30", window: "Morning", state: "later" },
  { id: "anna-reset-farmhouse", key: "venue", family: "Venue", title: "Reset Farmhouse for workshop", place: "Farmhouse", detail: "Arrival state: guest ready", time: "1:00", window: "Afternoon", state: "later" },
  { id: "anna-stage-florist-pickup", key: "pickup", family: "Pickup / handoff", title: "Stage florist pickups", place: "Flower Room", detail: "Hold each order in outbound custody", time: "2:00", window: "Afternoon", state: "later" },
  { id: "anna-deliver-samples", key: "destination", family: "Destination", title: "Deliver sample flowers", place: "Springfield route", detail: "Commercial handoff", time: "3:00", window: "Afternoon", state: "later" },
  { id: "anna-mow-orchard", key: "mow", family: "Mow", title: "Mow orchard edge", place: "Orchard", detail: "Evening outdoor window", time: "7:15", window: "Evening", state: "later" },
];

const MARSHALL_TASKS: Task[] = [
  { id: "marshall-property-round", key: "stewardship", family: "Stewardship", title: "Saturday property round", place: "Elm Farm", detail: "Check structures, water, access, and anything physically changed", time: "7:00", window: "Morning", state: "done" },
  { id: "marshall-mow-orchard", key: "mow", family: "Mow", title: "Mow orchard edge", place: "Orchard", detail: "Use the cool outdoor window first", time: "8:00", window: "Morning", state: "current" },
  { id: "marshall-adjust-barn-door", key: "setup", family: "Repair", title: "Adjust north barn door", place: "Barn", detail: "Door is rubbing but all tools are on site", time: "9:00", window: "Morning", state: "next" },
  { id: "marshall-clear-berry-fence", key: "weed", family: "Grounds", title: "Clear Berry Walk fence line", place: "Berry Walk", detail: "Restore access before the next mowing pass", time: "10:00", window: "Morning", state: "later" },
  { id: "marshall-check-pavilion-lights", key: "venue", family: "Venue", title: "Check pavilion lights", place: "Pavilion", detail: "Verify guest-facing fixtures before Thursday", time: "1:00", window: "Afternoon", state: "later" },
  { id: "marshall-unload-compost", key: "pickup", family: "Material handoff", title: "Unload compost delivery", place: "Barn drive", detail: "Put material into the designated holding zone", time: "2:15", window: "Afternoon", state: "later" },
  { id: "marshall-pickup-hardware", key: "destination", family: "Pickup", title: "Pick up hinge hardware", place: "Marshfield", detail: "Fixed store stop before the late repair window", time: "3:15", window: "Afternoon", state: "later" },
  { id: "marshall-replace-gate-latch", key: "setup", family: "Repair", title: "Replace west gate latch", place: "Entry", detail: "Finish with the hardware picked up this afternoon", time: "6:30", window: "Evening", state: "later" },
];

function tasksFor(persona: WorkerPersona) {
  return persona === "marshall" ? MARSHALL_TASKS : ANNA_TASKS;
}

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

function Row({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const complete = task.state === "done";
  const current = task.state === "current";
  const routeClass = current ? " atlas-day-route-current" : task.state === "next" ? " atlas-day-route-next" : "";
  return (
    <div className={`atlas-day-task-entry${complete ? " atlas-day-complete-entry" : ""}${routeClass}`}>
      <button type="button" className={`atlas-day-task-node${complete ? " is-complete" : ""}`} aria-label={complete ? `Completed ${task.title}` : `Pretend complete ${task.title}`}><span aria-hidden="true" /></button>
      <details className={`atlas-day-task-card atlas-journal-task-row${complete ? " complete" : ""}${routeClass}`} aria-current={current ? "step" : undefined}>
        <summary onClick={(event) => { event.preventDefault(); onOpen(task.id); }}>
          {!complete ? <small className="atlas-day-task-family">{current ? `Current · ${task.family}` : task.family}</small> : null}
          <strong>{task.title}</strong>
          <span>{complete ? "Complete" : `${task.time} · ${task.place}`}</span>
          <em>{task.detail}</em>
          {!complete ? <span className="atlas-day-task-cues"><i>{task.window}</i>{task.state === "next" ? <i>Next</i> : null}</span> : null}
          <b className="atlas-journal-row-caret" aria-hidden="true">⌄</b>
        </summary>
      </details>
    </div>
  );
}

export default function RealDayWorkshopFixture({ persona = "anna" }: { persona?: WorkerPersona }) {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const tasks = tasksFor(persona);
  const groups = ["Morning", "Afternoon", "Evening"] as const;
  const selected = openTaskId ? tasks.find((task) => task.id === openTaskId) ?? null : null;
  const doneCount = tasks.filter((task) => task.state === "done").length;
  const openCount = tasks.length - doneCount;
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const workerName = persona === "marshall" ? "Marshall" : "Anna";

  return (
    <div className={styles.fixture} data-atlas-day-fixture="real-skin" data-atlas-day-persona={persona}>
      <div className="atlas-task-page-body">
        <section className="atlas-task-page-section atlas-route-collection atlas-day-browse">
          <div className="atlas-day-browse-head">
            <button type="button" className="atlas-route-back atlas-day-back">← Week</button>
            <div className="atlas-day-browse-title-row"><span>Sat · Aug 29</span><strong>{openCount} open · {doneCount} done</strong></div>
            <p>{workerName}'s fake work using the live Day presentation contract</p>
          </div>
          <article className="atlas-day-command-header" data-day-denominator={`${doneCount}/${tasks.length}`}>
            <div className="atlas-day-command-topline">
              <div className="atlas-day-command-date"><strong>Saturday, Aug 29</strong><span>{openCount} still in today</span></div>
              <div className="atlas-day-filter-pill atlas-day-view-toggle"><button type="button" className="selected">Timeline</button><button type="button">Zone</button></div>
            </div>
            <div className={styles.progress}><div><span>{doneCount} of {tasks.length} dealt with</span><b>{progress}%</b></div><i><span style={{ width: `${progress}%` }} /></i></div>
          </article>
          <div className="atlas-day-task-groups">
            <article className="atlas-day-route-group atlas-day-work-order-group atlas-day-timeline-group">
              <h3>Work the day</h3>
              <div className="atlas-day-work-order-list atlas-day-route-spine atlas-day-mixed-timeline">
                {groups.map((group) => {
                  const grouped = tasks.filter((task) => task.window === group);
                  if (!grouped.length) return null;
                  return <section className={styles.window} key={group}><header><span>{group}</span><small>{grouped.length} moves</small></header>{grouped.map((task) => <Row task={task} onOpen={setOpenTaskId} key={task.id} />)}</section>;
                })}
              </div>
            </article>
          </div>
          <nav className="atlas-day-adjacent-nav" aria-label="Pretend adjacent days"><button type="button"><span aria-hidden="true">←</span><em>Yesterday</em></button><button type="button"><em>Tomorrow</em><span aria-hidden="true">→</span></button></nav>
        </section>
      </div>
      {openTaskId && selected ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`${selected.family} task specimen`}>
          <div className={styles.sheet}>
            <header><div><span>REAL TASK TEMPLATE · FAKE DATA</span><strong>{selected.title}</strong><small>Opened from the live Day visual contract.</small></div><button type="button" onClick={() => setOpenTaskId(null)} aria-label="Close task specimen">×</button></header>
            <div className={styles.specimen}><TaskSpecimen taskKey={selected.key} /></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
