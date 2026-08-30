"use client";

import type { ReactNode } from "react";

import HarvestedOutputSection, { type HarvestedResponse } from "@/app/harvest/HarvestedOutputSection";
import AtlasMoreDestinationList from "@/components/atlas/shell/AtlasMoreDestinationList";
import { AtlasCard, AtlasMetricStrip, AtlasSectionHeading, AtlasStateBadge } from "@/components/atlas/ui/AtlasPrimitives";
import styles from "./canonical-atlas-portal.module.css";

const HARVEST_FIXTURE: HarvestedResponse = {
  ok: true,
  rangeStart: "2026-08-23",
  asOf: "2026-08-29",
  rangeDays: 7,
  farms: [{
    id: "fixture-elm",
    key: "elm-farm",
    name: "Elm Farm",
    totals: { bucketEquivalentFloor: 5.5, lowerBound: true, observationCount: 3 },
    entries: [
      { id: "fixture-harvest-1", cropCycleId: "fixture-sunflower", cropLabel: "Sunflower", variety: "ProCut Orange", observedDate: "2026-08-29", bucketEquivalentFloor: 3, lowerBound: false, moreAvailable: true, observationCount: 1, note: "Field Row 13 · morning cut" },
      { id: "fixture-harvest-2", cropCycleId: "fixture-zinnia", cropLabel: "Zinnia", variety: "Benary's Giant", observedDate: "2026-08-28", bucketEquivalentFloor: 1.5, lowerBound: true, moreAvailable: true, observationCount: 1, note: "Main Garden · at least this much recorded" },
      { id: "fixture-harvest-3", cropCycleId: "fixture-basil", cropLabel: "Lemon basil", variety: null, observedDate: "2026-08-27", bucketEquivalentFloor: 1, lowerBound: false, moreAvailable: false, observationCount: 1, note: "Cut reported complete" },
    ],
  }],
};

function Custody({ state, children }: { state: "canonical" | "future"; children: ReactNode }) {
  return (
    <div className={styles.custody} data-surface-custody={state}>
      <AtlasStateBadge state={state === "canonical" ? "ready" : "review"}>{state === "canonical" ? "CANONICAL" : "FUTURE CANONICAL"}</AtlasStateBadge>
      <span>{children}</span>
    </div>
  );
}

function InventoryLine({ title, detail, quantity }: { title: string; detail: string; quantity: string }) {
  return <article className={styles.inventoryLine}><div><strong>{title}</strong><span>{detail}</span></div><b>{quantity}</b></article>;
}

export function AnnaHarvestSurface() {
  return (
    <div className={styles.stack} data-atlas-harvest-fixture="worker-harvest-v1">
      <section className="atlas-more-page__intro">
        <span>HARVEST</span>
        <h1>Turn field work into Ready truth.</h1>
        <p>Anna records physical output and preparation here. Buyer decisions, prices, routes, and customer claims belong to the Buyer Desk.</p>
      </section>
      <Custody state="future">Worker-only Harvest split from the existing shared Harvest workbench.</Custody>

      <AtlasMetricStrip ariaLabel="Worker harvest fixture summary">
        <span><b>3</b> buckets cut</span>
        <span><b>9</b> bunches Ready</span>
        <span><b>1</b> my handoff</span>
      </AtlasMetricStrip>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="anna-harvest-log">
        <AtlasSectionHeading kicker="Physical output" title="Harvest stems" id="anna-harvest-log" count="Today" />
        <p>Record what was actually cut, from which bed, how much came in, and whether more remains in the field.</p>
        <InventoryLine title="ProCut Orange sunflower" detail="Field Row 13 · more still available" quantity="3 buckets" />
        <button type="button" className={styles.primaryFixtureAction}>Log another cut</button>
      </AtlasCard>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="anna-prep-log">
        <AtlasSectionHeading kicker="Post-harvest" title="Condition + bunch" id="anna-prep-log" count="Ready" />
        <p>Prepared output is where Anna's custody ends. Once the flowers are Ready, Katie can sell or route them without asking Anna to manage commerce.</p>
        <InventoryLine title="Sunflower bunches" detail="5 stems each · prepared today" quantity="9 Ready" />
        <button type="button" className={styles.primaryFixtureAction}>Add finished flowers</button>
      </AtlasCard>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="anna-handoff">
        <AtlasSectionHeading kicker="Assigned to me" title="Handoff" id="anna-handoff" count="1" />
        <InventoryLine title="Springfield distribution" detail="5 posies · delivery already committed by Commercial" quantity="4:30 PM" />
      </AtlasCard>

      <details className={styles.historyDisclosure}>
        <summary><span>RECENT OUTPUT</span><strong>Audit what I already recorded</strong><b aria-hidden="true">⌄</b></summary>
        <div><HarvestedOutputSection fixtureOnly fixtureData={HARVEST_FIXTURE} /></div>
      </details>
    </div>
  );
}

export function KatieCommercialHome() {
  return (
    <div className={styles.stack} data-atlas-commercial-home="future-canonical">
      <AtlasCard variant="purple" className={styles.commercialHero}>
        <span>COMMERCIAL TODAY</span>
        <h1>Move Ready capacity into good commitments.</h1>
        <p>Commercial sees the same physical truth as the farm, but the work here is buyers, orders, routes, and fulfillment.</p>
      </AtlasCard>
      <Custody state="future">Commercial Home assembled from the existing flower commerce domain; production does not yet expose it as Katie's own portal.</Custody>
      <AtlasMetricStrip ariaLabel="Buyer Desk fixture summary">
        <span><b>27</b> Ready units</span>
        <span><b>3</b> commitments</span>
        <span><b>2</b> follow-ups</span>
      </AtlasMetricStrip>
      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="buyer-pressure-title">
        <AtlasSectionHeading kicker="Buyer pressure" title="What needs movement" id="buyer-pressure-title" count="3" />
        <AtlasMoreDestinationList
          ariaLabel="Commercial fixture pressure"
          destinations={[
            { label: "Ruth's Flowers", detail: "Warm relationship · sample follow-up today", href: "/owner/design-atlas" },
            { label: "House of Flowers", detail: "Confirm 3-bunch Friday order", href: "/owner/design-atlas" },
            { label: "Friday route", detail: "3 stops · 6 bunches still in route custody", href: "/owner/design-atlas" },
          ]}
          onNavigate={() => undefined}
        />
      </AtlasCard>
    </div>
  );
}

export function KatieBuyerDeskSurface() {
  return (
    <div className={styles.stack} data-atlas-buyer-desk="future-canonical-v1">
      <section className="atlas-more-page__intro">
        <span>BUYER DESK</span>
        <h1>Sell what exists. Keep custody visible.</h1>
        <p>Published availability comes in from production. Katie owns buyer relationships, claims, routes, and fulfillment from this point forward.</p>
      </section>
      <Custody state="future">This is the target portal split for the commercial machinery already present in Harvest.</Custody>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="available-now-title">
        <AtlasSectionHeading kicker="Unclaimed Ready inventory" title="Available now" id="available-now-title" count="27" />
        <InventoryLine title="ProCut Orange sunflower" detail="9 five-stem bunches · Elm Farm" quantity="9" />
        <InventoryLine title="Benary's Giant zinnia" detail="12 bunches · Elm Farm" quantity="12" />
        <InventoryLine title="Mixed posies" detail="prepared this morning · Elm Farm" quantity="6" />
      </AtlasCard>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="buyers-title">
        <AtlasSectionHeading kicker="Relationships" title="Buyers" id="buyers-title" count="3 active" />
        <AtlasMoreDestinationList
          ariaLabel="Buyer relationship fixture"
          destinations={[
            { label: "Ruth's Flowers", detail: "Warm · last contact this week · follow up today", href: "/owner/design-atlas" },
            { label: "House of Flowers", detail: "Order pending · 3 sunflower bunches", href: "/owner/design-atlas" },
            { label: "Little Clay House", detail: "Standing delivery relationship · next handoff scheduled", href: "/owner/design-atlas" },
          ]}
          onNavigate={() => undefined}
        />
      </AtlasCard>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="commitments-title">
        <AtlasSectionHeading kicker="Orders + fulfillment" title="Committed" id="commitments-title" count="3" />
        <InventoryLine title="House of Flowers" detail="3 sunflower bunches · delivery" quantity="Fri" />
        <InventoryLine title="Little Clay House" detail="5 posies · assigned to Anna" quantity="4:30" />
        <InventoryLine title="Friday sample route" detail="6 bunches · Katie custody · unsold stock returns to Ready" quantity="Route" />
      </AtlasCard>
    </div>
  );
}

export function PrincipalFlowerOpsSummary() {
  return (
    <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="principal-flower-ops-title">
      <AtlasSectionHeading kicker="Flower operations" title="Production → commercial" id="principal-flower-ops-title" count="2 exceptions" />
      <AtlasMetricStrip ariaLabel="Principal flower operation fixture summary">
        <span><b>27</b> Ready</span>
        <span><b>18</b> committed</span>
        <span><b>6</b> on route</span>
      </AtlasMetricStrip>
      <div className={styles.exceptionList}>
        <article><AtlasStateBadge state="attention">DECISION</AtlasStateBadge><div><strong>Friday inventory is under-committed</strong><span>9 Ready units have no customer or route custody.</span></div></article>
        <article><AtlasStateBadge state="review">WATCH</AtlasStateBadge><div><strong>Next Thursday supply is still field-evidence only</strong><span>Commercial can discuss it, but should not promise exact quantity yet.</span></div></article>
      </div>
    </AtlasCard>
  );
}
