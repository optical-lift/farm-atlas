import Link from "next/link";

import { getDaySchedule, type TaskScheduleProjection } from "@/lib/atlas-data/task-schedule";
import { getWorkerHand } from "@/lib/atlas-data/worker-hand";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import {
  atlasIsMaintenanceCollectionRoute,
  atlasScheduleRouteKey,
  ATLAS_SCHEDULE_ROUTE_LABELS,
} from "@/lib/atlas/task-route-core.js";
import WorkerTodayBoard, {
  type WorkerCollectionCard,
  type WorkerTodayTask,
} from "./WorkerTodayBoard";
import styles from "./work.module.css";

export const dynamic = "force-dynamic";

type ScheduleTask = TaskScheduleProjection["days"][number]["tasks"][number];

function uniqueTasks(tasks: ScheduleTask[]) {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    if (!task.taskId || seen.has(task.taskId)) return false;
    seen.add(task.taskId);
    return true;
  });
}

function isCollectionTask(task: ScheduleTask) {
  return atlasIsMaintenanceCollectionRoute(atlasScheduleRouteKey(task));
}

function toWorkerTask(task: ScheduleTask): WorkerTodayTask {
  return {
    taskId: task.taskId,
    title: task.title,
    taskType: task.taskType,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    instruction: task.instruction,
    blocker: task.blocker,
    zone: {
      label: task.zone.label,
      key: task.zone.key,
    },
    object: {
      label: task.object.label,
      key: task.object.key,
    },
    totalSteps: task.totalSteps,
    completedSteps: task.completedSteps,
    canAct: task.canAct,
  };
}

function collectionPreview(tasks: ScheduleTask[]) {
  const locations = tasks
    .map((task) => task.object.label || task.zone.label)
    .filter((value): value is string => Boolean(value));
  return [...new Set(locations)].slice(0, 3).join(" · ") || "Open the collection to see the work areas.";
}

function buildCollectionCards(
  today: string,
  scheduled: ScheduleTask[],
  carryover: ScheduleTask[],
): WorkerCollectionCard[] {
  return (["weed", "mow"] as const).flatMap((key) => {
    const todayTasks = scheduled.filter((task) => atlasScheduleRouteKey(task) === key && task.status !== "done");
    const carryoverTasks = carryover.filter((task) => atlasScheduleRouteKey(task) === key && task.status !== "done");
    const all = uniqueTasks([...todayTasks, ...carryoverTasks]);
    if (!all.length) return [];

    return [{
      key,
      label: ATLAS_SCHEDULE_ROUTE_LABELS[key],
      href: key === "mow" ? "/collections/mowing" : "/collections/weeding",
      todayCount: todayTasks.filter((task) => task.dueDate === today).length,
      carryoverCount: carryoverTasks.length,
      blockedCount: all.filter((task) => task.status === "blocked").length,
      preview: collectionPreview(all),
    }];
  });
}

export default async function WorkerTodayPage() {
  const access = await requireAtlasRole(["owner", "manager", "farm_hand"]);
  const hand = await getWorkerHand(access);

  if (!hand.worker) {
    return (
      <main className={styles.page}>
        <section className={styles.shell}>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>{hand.farm.name} · Today</p>
              <h1>Farm work</h1>
            </div>
            <Link className={styles.back} href="/">Farm home</Link>
          </header>
          <section className={styles.emptyState}>
            <h2>No active Farm Hand membership yet</h2>
            <p>
              {hand.unassignedWorkerTaskCount
                ? `${hand.unassignedWorkerTaskCount} open worker tasks are waiting for a real farm membership.`
                : "There is no Farm Hand membership available for this farm."}
            </p>
            {access.membership.role === "owner" ? <Link href="/owner/members">Open People &amp; Access</Link> : null}
          </section>
        </section>
      </main>
    );
  }

  const schedule = await getDaySchedule(access, hand.forDate, hand.worker.membershipId);
  const scheduled = schedule.days[0]?.tasks ?? [];
  const carryover = uniqueTasks([
    ...schedule.carryover.blocked,
    ...schedule.carryover.overdue,
    ...schedule.carryover.undated,
  ]);
  const collections = buildCollectionCards(hand.forDate, scheduled, carryover);

  const todayTasks = scheduled
    .filter((task) => task.status === "open" && !isCollectionTask(task))
    .map(toWorkerTask);
  const blockedTasks = uniqueTasks([
    ...scheduled.filter((task) => task.status === "blocked"),
    ...schedule.carryover.blocked,
  ])
    .filter((task) => !isCollectionTask(task))
    .map(toWorkerTask);
  const carryoverTasks = uniqueTasks([
    ...schedule.carryover.overdue,
    ...schedule.carryover.undated,
  ])
    .filter((task) => task.status === "open" && !isCollectionTask(task))
    .map(toWorkerTask);

  const allOpenToday = scheduled.filter((task) => task.status !== "done");
  const allBlocked = uniqueTasks([
    ...scheduled.filter((task) => task.status === "blocked"),
    ...schedule.carryover.blocked,
  ]);

  return (
    <WorkerTodayBoard
      farmName={hand.farm.name}
      workerName={hand.worker.displayName}
      viewerName={access.session.displayName}
      forDate={hand.forDate}
      canAct={hand.canAct}
      collections={collections}
      todayTasks={todayTasks}
      blockedTasks={blockedTasks}
      carryoverTasks={carryoverTasks}
      summary={{
        todayOpen: allOpenToday.length,
        carryover: carryover.length,
        blocked: allBlocked.length,
        done: scheduled.filter((task) => task.status === "done").length,
      }}
    />
  );
}
