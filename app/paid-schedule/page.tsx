import Link from "next/link";

import PaidScheduleHeader from "./PaidScheduleHeader";
import styles from "./paid-schedule.module.css";
import { requireAtlasViewer } from "@/lib/atlas/viewer-context";

export const dynamic = "force-dynamic";

const profileFacts = [
  { label: "Role", value: "Farm contractor" },
  { label: "Farm", value: "Elm Farm" },
  { label: "Work start", value: "July 6, 2026" },
  { label: "Status", value: "Active" },
];

const scheduleDates = [
  { date: "July 6", label: "Work started", status: "Complete" },
  { date: "July 17", label: "First payment", status: "Paid" },
  { date: "July 27", label: "Lease due", status: "Monday" },
  { date: "July 29", label: "Last workday before travel", status: "Scheduled" },
  { date: "July 30–August 3", label: "Away from farm", status: "Unavailable" },
  { date: "July 31", label: "Payment", status: "Scheduled" },
  { date: "August 4", label: "Returns to farm", status: "Scheduled" },
];

const paymentDates = [
  { date: "July 17, 2026", status: "Paid", kind: "First payment" },
  { date: "July 31, 2026", status: "Scheduled", kind: "Next payment" },
];

export default async function PaidSchedulePage() {
  const viewer = await requireAtlasViewer();

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell" data-atlas-person="anna">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <PaidScheduleHeader farmName={viewer.farmName} />

        <div className={`atlas-task-page-body ${styles.body}`}>
          <Link href="/" className={`atlas-route-back ${styles.back}`}>← Home</Link>

          <section className={styles.hero}>
            <span>Paid schedule</span>
            <h1>Anna</h1>
            <div className={styles.heroFacts}>
              <p><b>Lease</b><strong>Not signed</strong></p>
              <p><b>Due date</b><strong>Monday, July 27</strong></p>
            </div>
          </section>

          <section className={styles.factGrid} aria-label="Anna profile">
            {profileFacts.map((fact) => (
              <article key={fact.label}>
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
              </article>
            ))}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span>Payments</span>
              <strong>2026</strong>
            </div>
            <div className={styles.paymentGrid}>
              {paymentDates.map((payment) => (
                <article key={payment.date}>
                  <span>{payment.kind}</span>
                  <strong>{payment.date}</strong>
                  <em>{payment.status}</em>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span>Schedule</span>
              <strong>July–August</strong>
            </div>
            <div className={styles.timeline}>
              {scheduleDates.map((item) => (
                <article key={`${item.date}-${item.label}`}>
                  <time>{item.date}</time>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.status}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
