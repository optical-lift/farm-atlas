import type { Metadata } from "next";

import DestinationContactCardSpecimen from "./DestinationContactCardSpecimen";
import FarmRoundCardSpecimen from "./FarmRoundCardSpecimen";
import HarvestCardSpecimen from "./HarvestCardSpecimen";
import HarvestDirectionCardSpecimen from "./HarvestDirectionCardSpecimen";
import HarvestPreparationCardSpecimen from "./HarvestPreparationCardSpecimen";
import MowCardSpecimen from "./MowCardSpecimen";
import OneOffFieldWorkCardSpecimen from "./OneOffFieldWorkCardSpecimen";
import { TransplantCardSpecimen } from "./RemainingDominionCardSpecimens";
import SowCardSpecimen from "./SowCardSpecimen";
import VenueCardSpecimen from "./VenueCardSpecimen";
import WeedCardSpecimen from "./WeedCardSpecimen";
import styles from "./task-card-lab.module.css";

export const metadata: Metadata = {
  title: "Task Card Lab · Atlas",
};

const families = [
  "Destination",
  "Venue",
  "Sow",
  "Weed",
  "Mow",
  "Harvest",
  "Transplant",
  "Stewardship",
  "Setup + Protect",
] as const;

function Specimen({ index }: { index: number }) {
  if (index === 0) return <DestinationContactCardSpecimen />;
  if (index === 1) return <VenueCardSpecimen />;
  if (index === 2) return <SowCardSpecimen />;
  if (index === 3) return <WeedCardSpecimen />;
  if (index === 4) return <MowCardSpecimen />;
  if (index === 5) return <><HarvestCardSpecimen /><HarvestDirectionCardSpecimen /><HarvestPreparationCardSpecimen /></>;
  if (index === 6) return <TransplantCardSpecimen />;
  if (index === 7) return <FarmRoundCardSpecimen />;
  return <OneOffFieldWorkCardSpecimen />;
}

export default function TaskCardLabPage() {
  return (
    <main className={styles.page}>
      <header className={styles.labHeader}>
        <span>ATLAS · OWNER DESIGN LAB</span>
        <h1>Task Card Gallery</h1>
        <p>
          Current Dominion shells and crop-cycle variants, fully exposed in one vertical scroll. These are fixture-only CSS mockups: no task feed, no scheduling, no Supabase writes.
        </p>
      </header>

      <nav className={styles.jumpNav} aria-label="Jump to task family">
        {families.map((family, index) => (
          <a key={family} href={`#task-card-${index + 1}`}>{family}</a>
        ))}
      </nav>

      <div className={styles.gallery}>
        {families.map((family, index) => (
          <div id={`task-card-${index + 1}`} key={family} className={styles.cardAnchor}>
            <Specimen index={index} />
          </div>
        ))}
      </div>
    </main>
  );
}
