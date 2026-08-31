"use client";

import { useState, type ReactNode } from "react";

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

type BuyerKey = "mama-jeans-east" | "zimmermans" | "ruths";

type BuyerFixture = {
  key: BuyerKey;
  name: string;
  location: string;
  state: string;
  detail: string;
  next: string;
};

const BUYERS: BuyerFixture[] = [
  {
    key: "mama-jeans-east",
    name: "Mama Jean's · East",
    location: "Springfield",
    state: "Prospect",
    detail: "Marshall contacted East location · Katie follow-up",
    next: "Follow up",
  },
  {
    key: "zimmermans",
    name: "Zimmerman's",
    location: "Springfield",
    state: "Warm",
    detail: "Kendall is taking the 5-stem offer to the owner",
    next: "Await owner",
  },
  {
    key: "ruths",
    name: "Ruth's Flowers",
    location: "Springfield",
    state: "Waiting",
    detail: "Sue said she would call back Monday",
    next: "Wait",
  },
];

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

function BuyerRow({ buyer, onOpen }: { buyer: BuyerFixture; onOpen: (buyer: BuyerFixture) => void }) {
  return (
    <button type="button" className={styles.buyerRow} onClick={() => onOpen(buyer)}>
      <div>
        <strong>{buyer.name}</strong>
        <span>{buyer.detail}</span>
      </div>
      <span className={styles.buyerRowState}>{buyer.state}</span>
      <b aria-hidden="true">›</b>
    </button>
  );
}

function RelationshipEvent({
  date,
  actor,
  channel,
  children,
}: {
  date: string;
  actor: string;
  channel: string;
  children: ReactNode;
}) {
  return (
    <article className={styles.relationshipEvent}>
      <div className={styles.relationshipEventMeta}>
        <span>{date}</span>
        <b>{actor}</b>
        <em>{channel}</em>
      </div>
      <p>{children}</p>
    </article>
  );
}

function BuyerProfileSurface({ buyer, onBack }: { buyer: BuyerFixture; onBack: () => void }) {
  const isMamaJeans = buyer.key === "mama-jeans-east";
  const isZimmermans = buyer.key === "zimmermans";

  return (
    <div className={styles.stack} data-atlas-counterparty-profile="future-canonical-v1">
      <button type="button" className={styles.profileBack} onClick={onBack}>‹ Buyer Desk</button>

      <section className={styles.profileHeader}>
        <span>BUYER PROFILE</span>
        <h1>{buyer.name}</h1>
        <p>{buyer.location} · {buyer.state} relationship</p>
        <div className={styles.profileTags}>
          <span>Buyer</span>
          <span>Springfield distribution</span>
          <span>Assigned to Katie</span>
        </div>
      </section>

      <Custody state="future">Fixture-only profile. It assembles company relationship memory, governed inventory, pricing, and open movement without creating the underlying architecture yet.</Custody>

      <AtlasMetricStrip ariaLabel="Buyer profile fixture summary">
        <span><b>{buyer.state}</b> relationship</span>
        <span><b>Katie</b> current owner</span>
        <span><b>Aug 31</b> last touch</span>
      </AtlasMetricStrip>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="buyer-now-title">
        <AtlasSectionHeading kicker="Current thread" title={buyer.next} id="buyer-now-title" count="Open" />
        {isMamaJeans ? (
          <div className={styles.threadLead}>
            <AtlasStateBadge state="attention">NEEDS OUTCOME</AtlasStateBadge>
            <div>
              <strong>Marshall already contacted the East location.</strong>
              <span>The contact outcome, buyer name, and interest level are not captured yet. Katie should inherit the contact fact without Atlas inventing the missing result.</span>
            </div>
          </div>
        ) : isZimmermans ? (
          <div className={styles.threadLead}>
            <AtlasStateBadge state="review">WAITING</AtlasStateBadge>
            <div>
              <strong>Kendall is taking the offer to the owner.</strong>
              <span>Do not turn this into a new sales task until the agreed waiting state has had time to resolve.</span>
            </div>
          </div>
        ) : (
          <div className={styles.threadLead}>
            <AtlasStateBadge state="review">WAITING</AtlasStateBadge>
            <div>
              <strong>Sue said she would call back Monday.</strong>
              <span>The relationship is waiting on the buyer, not on Katie. Atlas should surface the thread for awareness without mislabeling it as overdue work.</span>
            </div>
          </div>
        )}
        <div className={styles.threadFacts}>
          <span><b>Responsible</b> Katie</span>
          <span><b>Waiting on</b> {isMamaJeans ? "Katie follow-up" : "Buyer"}</span>
          <span><b>Inventory claim</b> None</span>
        </div>
      </AtlasCard>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="buyer-offer-title">
        <AtlasSectionHeading kicker="Offer + capacity" title="What Katie can sell" id="buyer-offer-title" count="27 Ready" />
        <div className={styles.offerBand}>
          <div>
            <span>Current wholesale offer</span>
            <strong>5-stem bouquet</strong>
          </div>
          <b>$4</b>
          <em>Suggested retail $7–8</em>
        </div>
        <InventoryLine title="ProCut Orange sunflower" detail="5-stem bunches · unclaimed Ready inventory" quantity="9" />
        <InventoryLine title="Benary's Giant zinnia" detail="bunches · unclaimed Ready inventory" quantity="12" />
        <InventoryLine title="Mixed posies" detail="prepared this morning · unclaimed Ready inventory" quantity="6" />
        <p className={styles.authorityNote}>Inventory is visible here, not owned here. Nothing is reserved until a buyer actually requests it and the commercial claim is recorded.</p>
      </AtlasCard>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="buyer-moving-title">
        <AtlasSectionHeading kicker="Moving pieces" title="What is still unresolved" id="buyer-moving-title" count="3" />
        <div className={styles.movingList}>
          <article>
            <AtlasStateBadge state={isMamaJeans ? "attention" : "review"}>{isMamaJeans ? "GAP" : "STATE"}</AtlasStateBadge>
            <div><strong>{isMamaJeans ? "Prior call needs a disposition" : "Buyer response is still pending"}</strong><span>{isMamaJeans ? "The company knows a call happened, but not what happened in it." : "The thread should preserve who owes the next movement."}</span></div>
          </article>
          <article>
            <AtlasStateBadge state="ready">OFFER</AtlasStateBadge>
            <div><strong>$4 / 5-stem bouquet</strong><span>Current Springfield wholesale offer · suggested resale $7–8.</span></div>
          </article>
          <article>
            <AtlasStateBadge state="ready">SUPPLY</AtlasStateBadge>
            <div><strong>27 Ready units remain unclaimed</strong><span>Discussable now; future field supply remains non-guaranteed until it becomes Ready.</span></div>
          </article>
        </div>
      </AtlasCard>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="buyer-memory-title">
        <AtlasSectionHeading kicker="Company memory" title="Relationship history" id="buyer-memory-title" count="Across Atlas" />
        <div className={styles.relationshipTimeline}>
          {isMamaJeans ? (
            <>
              <RelationshipEvent date="Aug 31" actor="Marshall" channel="Phone">Called Mama Jean's East location. No disposition is recorded in this fixture.</RelationshipEvent>
              <RelationshipEvent date="Aug 31" actor="Principal" channel="Assignment">Springfield follow-up moved to Katie so the relationship can continue without requiring Marshall's account or memory.</RelationshipEvent>
            </>
          ) : isZimmermans ? (
            <>
              <RelationshipEvent date="Aug 30" actor="Marshall" channel="Phone">Spoke with Kendall, the manager. Offered 5-stem bouquets at $4 wholesale for resale around $7–8.</RelationshipEvent>
              <RelationshipEvent date="Aug 30" actor="Kendall" channel="Outcome">Said he would talk to the owner.</RelationshipEvent>
            </>
          ) : (
            <RelationshipEvent date="Aug 30" actor="Marshall" channel="Phone">Sue was not around. Store said Sue would call back Monday.</RelationshipEvent>
          )}
        </div>
        <p className={styles.authorityNote}>No order, reservation, fulfillment, or payment is implied by relationship history.</p>
      </AtlasCard>

      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="buyer-contact-title">
        <AtlasSectionHeading kicker="Identity" title="Buyer details" id="buyer-contact-title" />
        <div className={styles.identityGrid}>
          <span><b>Business</b>{buyer.name}</span>
          <span><b>Market</b>Springfield</span>
          <span><b>Contact</b>{isZimmermans ? "Kendall · manager" : isMamaJeans ? "Not captured" : "Sue"}</span>
          <span><b>Relationship owner</b>Katie</span>
        </div>
      </AtlasCard>
    </div>
  );
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
        <span><b>3</b> buyer threads</span>
      </AtlasMetricStrip>
      <AtlasCard as="section" className={styles.roleCard} ariaLabelledBy="buyer-pressure-title">
        <AtlasSectionHeading kicker="Buyer pressure" title="What needs movement" id="buyer-pressure-title" count="3" />
        <AtlasMoreDestinationList
          ariaLabel="Commercial fixture pressure"
          destinations={[
            { label: "Mama Jean's · East", detail: "Marshall contacted · Katie follow-up needs outcome", href: "/owner/design-atlas" },
            { label: "Zimmerman's", detail: "Kendall taking offer to owner · waiting", href: "/owner/design-atlas" },
            { label: "Ruth's Flowers", detail: "Sue said she would call back Monday · waiting on buyer", href: "/owner/design-atlas" },
          ]}
          onNavigate={() => undefined}
        />
      </AtlasCard>
    </div>
  );
}

export function KatieBuyerDeskSurface() {
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerFixture | null>(null);

  if (selectedBuyer) {
    return <BuyerProfileSurface buyer={selectedBuyer} onBack={() => setSelectedBuyer(null)} />;
  }

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
        <AtlasSectionHeading kicker="Relationships" title="Buyers" id="buyers-title" count={`${BUYERS.length} active`} />
        <div className={styles.buyerList}>
          {BUYERS.map((buyer) => <BuyerRow buyer={buyer} onOpen={setSelectedBuyer} key={buyer.key} />)}
        </div>
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
