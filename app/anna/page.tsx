import { EB_Garamond, Source_Sans_3 } from "next/font/google";

import AnnaWorkJournalController from "@/app/anna/AnnaWorkJournalController";
import EmployeeBrandHeader from "@/components/employee/EmployeeBrandHeader";
import journalStyles from "@/components/employee/EmployeeWorkJournal.module.css";
import { getAnnaPilotEditState } from "@/lib/anna-worker-day-pilot";
import {
  canSeeWholeFarm,
  getAtlasSession,
  membershipForFarm,
} from "@/lib/atlas/session";
import { buildEmployeeWorkJournalFromDelivery } from "@/lib/employee-work-journal-server";
import {
  ELM_FARM_ID,
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
          className={`${journalStyles.surface} ${sourceSans.className}`}
          style={{ "--employee-serif": ebGaramond.style.fontFamily } as React.CSSProperties}
        >
          <div className={journalStyles.page}>
            <header className={journalStyles.header}>
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

  const journal = await buildEmployeeWorkJournalFromDelivery(
    delivery,
    workerContext,
  );
  const journalIssuer =
    journal.institution.operatingUnitName ?? journal.institution.organizationName;
  const identityMeta = [
    journal.institution.operatingUnitName
      ? journal.institution.organizationName
      : null,
    journal.institution.positionTitle,
  ].filter((value): value is string => Boolean(value));

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
        className={`${journalStyles.surface} ${sourceSans.className}`}
        style={{ "--employee-serif": ebGaramond.style.fontFamily } as React.CSSProperties}
      >
        <div className={journalStyles.page}>
          <header className={journalStyles.header}>
            <EmployeeBrandHeader organizationName={journalIssuer} />
            <div className={journalStyles.identityBlock}>
              <p className={journalStyles.journalLabel}>Work Journal</p>
              <h1 className={journalStyles.date}>{journal.dateLabel}</h1>
              {identityMeta.length ? (
                <p className={journalStyles.identityMeta}>{identityMeta.join(" · ")}</p>
              ) : null}
            </div>
          </header>

          <AnnaWorkJournalController journal={journal} canEdit={pilot.canEdit} />
        </div>
      </main>
    </>
  );
}
