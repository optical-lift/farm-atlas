import { EB_Garamond, Source_Sans_3 } from "next/font/google";

import AnnaWorkerDayClient from "@/app/anna/AnnaWorkerDayClient";
import EmployerPocket from "@/app/anna/EmployerPocket";
import styles from "@/app/anna/employee-surface.module.css";
import EmployeeBrandHeader from "@/components/employee/EmployeeBrandHeader";
import { getAnnaPilotEditState } from "@/lib/anna-worker-day-pilot";
import {
  formatElmDay,
  getAnnaWorkerDelivery,
  getWorkerDelivery,
} from "@/lib/worker-delivery";
import { getCurrentWorkerSessionContext } from "@/lib/worker-session";

export const dynamic = "force-dynamic";

const sourceSans = Source_Sans_3({ subsets: ["latin"] });
const ebGaramond = EB_Garamond({ subsets: ["latin"] });

const employerPocketItems = [
  {
    label: "Monday",
    title: "Harvest and Springfield delivery",
    detail: "2 DIY buckets and today’s harvested stems · arrive by 5 p.m.",
  },
  {
    label: "Thursday morning",
    title: "Florist route",
    detail: "Weekly Springfield florist deliveries.",
  },
  {
    label: "Thursday evening",
    title: "Thursdays at Elm",
    detail: "Flower harvest and bouquet workshop · 6:30–8:30 p.m.",
  },
];

export default async function AnnaPage() {
  const workerContext = await getCurrentWorkerSessionContext();
  const [delivery, pilot] = await Promise.all([
    workerContext ? getWorkerDelivery(workerContext) : getAnnaWorkerDelivery(),
    getAnnaPilotEditState(),
  ]);

  return (
    <>
      <style>{`
        html, body {
          margin: 0;
          min-height: 100%;
          background: #f4f1ea !important;
        }
      `}</style>

      <main
        className={`${styles.surface} ${sourceSans.className}`}
        style={{ "--employee-serif": ebGaramond.style.fontFamily } as React.CSSProperties}
      >
        <div className={styles.page}>
          <header className={styles.header}>
            <EmployeeBrandHeader organizationName="Elm" />
            <h1 className={styles.date}>{formatElmDay(delivery.date)}</h1>
          </header>

          <AnnaWorkerDayClient
            items={delivery.items}
            extras={delivery.extras}
            canEdit={pilot.canEdit}
          />
        </div>

        <EmployerPocket items={employerPocketItems} />
      </main>
    </>
  );
}
