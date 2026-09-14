import { EB_Garamond, Source_Sans_3 } from "next/font/google";

import AnnaWorkerDayClient from "@/app/anna/AnnaWorkerDayClient";
import EmployerPocket from "@/app/anna/EmployerPocket";
import styles from "@/app/anna/employee-surface.module.css";
import EmployeeBrandHeader from "@/components/employee/EmployeeBrandHeader";
import { getAnnaPilotEditState } from "@/lib/anna-worker-day-pilot";
import {
  canSeeWholeFarm,
  getAtlasSession,
  membershipForFarm,
} from "@/lib/atlas/session";
import {
  ANNA_FARM_MEMBERSHIP_ID,
  ELM_FARM_ID,
  formatElmDay,
  getAnnaWorkerDelivery,
  getWorkerDelivery,
} from "@/lib/worker-delivery";
import { getCurrentWorkerSessionContext } from "@/lib/worker-session";

export const dynamic = "force-dynamic";

const sourceSans = Source_Sans_3({ subsets: ["latin"] });
const ebGaramond = EB_Garamond({ subsets: ["latin"] });

export default async function AnnaPage() {
  const workerContext = await getCurrentWorkerSessionContext();

  let supervisorCanView = false;
  if (!workerContext) {
    const session = await getAtlasSession();
    const farmMembership = session ? membershipForFarm(session, ELM_FARM_ID) : null;
    supervisorCanView = Boolean(
      farmMembership && canSeeWholeFarm(farmMembership.role),
    );
  }

  if (!workerContext && !supervisorCanView) {
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
              <EmployeeBrandHeader organizationName="Atlas" />
            </header>
            <p>Sign in to Atlas to see your work.</p>
          </div>
        </main>
      </>
    );
  }

  const [delivery, pilot] = workerContext
    ? await Promise.all([
        getWorkerDelivery(workerContext),
        getAnnaPilotEditState(),
      ])
    : [await getAnnaWorkerDelivery(), { canEdit: false }];

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

        <EmployerPocket items={[]} />
      </main>
    </>
  );
}
