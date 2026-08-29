"use client";

import { useMemo, useState, type ReactNode } from "react";

import HarvestedOutputSection, { type HarvestedResponse } from "@/app/harvest/HarvestedOutputSection";
import AtlasDock, { type AtlasDockIconKey, type AtlasDockItem } from "@/components/atlas/shell/AtlasDock";
import AtlasMoreDestinationList, { type AtlasMoreDestination } from "@/components/atlas/shell/AtlasMoreDestinationList";
import { AtlasAppShell, AtlasCard, AtlasTopBar } from "@/components/atlas/ui/AtlasPrimitives";
import DesignAtlasCanonicalHome, { type DesignAtlasHomePersona } from "./DesignAtlasCanonicalHome";
import DesignAtlasManagerDay from "./DesignAtlasManagerDay";
import RealClockFixture from "./RealClockFixture";
import RealDayWorkshopFixture from "./RealDayWorkshopFixture";
import styles from "./canonical-atlas-portal.module.css";

type PersonaKey = "principal" | "anna" | "katie" | "marshall";
type ScopeKey = "principal" | "feast" | "elm";
type TabKey = AtlasDockIconKey;

const PERSONAS: Array<{ key: PersonaKey; label: string; role: string; scope: ScopeKey }> = [
  { key: "principal", label: "Principal", role: "Owner / coordination", scope: "principal" },
  { key: "anna", label: "Anna", role: "Farm hand / execution", scope: "elm" },
  { key: "katie", label: "Katie", role: "Commercial / Buyer Desk", scope: "feast" },
  { key: "marshall", label: "Marshall", role: "Shared operations", scope: "elm" },
];

const SCOPE_LABELS: Record<ScopeKey, string> = { principal: "Principal", feast: "Feast Guild", elm: "Elm Farm" };

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

function dockItems(persona: PersonaKey): AtlasDockItem[] {
  const base: AtlasDockItem[] = [
    { key: "home", label: "Home", href: "/" },
    { key: "work", label: "Work", href: "/day" },
    { key: "clock", label: "Clock", href: "/clock" },
  ];
  if (persona === "principal") base.push({ key: "manager", label: "Manager", href: "/manage/day" });
  base.push({ key: "harvest", label: "Harvest", href: "/harvest" });
  base.push({ key: "more", label: "More", href: "/more" });
  return base;
}

function DesignLens({ persona, scope, onPersona, onScope }: { persona: PersonaKey; scope: ScopeKey; onPersona: (value: PersonaKey) => void; onScope: (value: ScopeKey) => void }) {
  return (
    <details className={styles.designLens}>
      <summary><span>DESIGN LENS</span><strong>{PERSONAS.find((item) => item.key === persona)?.label} · {SCOPE_LABELS[scope]}</strong><b aria-hidden="true">⌄</b></summary>
      <div>
        <p>Fixture-only controls. Everything underneath should be canonical Atlas unless the product has no live component yet.</p>
        <label><span>View as</span><div>{PERSONAS.map((item) => <button type="button" data-active={persona === item.key} onClick={() => onPersona(item.key)} key={item.key}>{item.label}</button>)}</div></label>
        <label><span>Scope</span><div>{(["principal", "feast", "elm"] as ScopeKey[]).map((item) => <button type="button" data-active={scope === item} onClick={() => onScope(item)} key={item}>{SCOPE_LABELS[item]}</button>)}</div></label>
      </div>
    </details>
  );
}

function FixtureCard({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return <AtlasCard as="section" className={styles.fixtureCard}><header><span>{kicker}</span><h2>{title}</h2></header>{children}</AtlasCard>;
}

function CommercialHome() {
  return (
    <div className={styles.stack}>
      <AtlasCard variant="purple" className={styles.commercialHero}><span>COMMERCIAL TODAY</span><h1>Move available capacity into commitments.</h1><p>This remains a future-only surface because Atlas does not yet have a live canonical Commercial Home component.</p></AtlasCard>
      <FixtureCard kicker="BUYER PRESSURE" title="This week"><AtlasMoreDestinationList ariaLabel="Pretend commercial pressure" destinations={[{ label: "Ruth’s Flowers", detail: "Sample opportunity · contact today", href: "/owner/design-atlas" }, { label: "Schaffitzel’s Flowers", detail: "Standing-order follow-up waiting", href: "/owner/design-atlas" }, { label: "Friday route", detail: "3 stops · one draft order", href: "/owner/design-atlas" }]} onNavigate={() => undefined} /></FixtureCard>
    </div>
  );
}

function PrincipalWork() {
  const destinations: AtlasMoreDestination[] = [
    { label: "Set September operating calendar", detail: "Principal · current obligation", href: "/owner/design-atlas" },
    { label: "Resolve Buyer Desk offer boundary", detail: "Commercial decision · next", href: "/owner/design-atlas" },
    { label: "Review reusable Atlas onboarding", detail: "Protected strategic work", href: "/owner/design-atlas" },
  ];
  return <div className={styles.stack}><section className="atlas-more-page__intro"><span>WORK</span><h1>Your obligations</h1><p>Owner work stays separate from the team’s execution queue.</p></section><AtlasMoreDestinationList destinations={destinations} onNavigate={() => undefined} ariaLabel="Pretend owner obligations" /></div>;
}

function CommercialWork() {
  return <div className={styles.stack}><section className="atlas-more-page__intro"><span>WORK</span><h1>Buyer Desk</h1><p>Commercial consumes published availability and owns offers, commitments, and fulfillment.</p></section><AtlasMoreDestinationList destinations={[{ label: "Ruth’s Flowers", detail: "Today · sample opportunity", href: "/owner/design-atlas" }, { label: "House of Flowers", detail: "Confirm 3-bundle Friday order", href: "/owner/design-atlas" }, { label: "Friday delivery loop", detail: "3 stops · fulfillment route", href: "/owner/design-atlas" }]} onNavigate={() => undefined} ariaLabel="Pretend Buyer Desk work" /></div>;
}

function HarvestSurface() {
  return <div className={styles.stack} data-atlas-harvest-fixture="canonical-read-only"><section className="atlas-more-page__intro"><span>HARVEST</span><h1>Flower command center</h1><p>This is a real Harvest destination component with fake physical-output truth. The mutation-heavy Workbench stays quarantined until it has its own fixture mode.</p></section><HarvestedOutputSection fixtureOnly fixtureData={HARVEST_FIXTURE} /></div>;
}

function MoreSurface({ persona }: { persona: PersonaKey }) {
  const destinations: AtlasMoreDestination[] = [
    { label: "Zone Registry", detail: "Beds, rooms, gardens and every canonical farm place", href: "/zones" },
    { label: "Projects", detail: "Builds, venue work and multi-step initiatives", href: "/projects" },
    { label: "Production", detail: "Crop cycles and production state", href: "/production" },
    { label: "Seed inventory", detail: "Verified counts, freshness and crop commitments", href: "/inventory/seeds" },
    ...(persona === "principal" ? [{ label: "Tomorrow preflight", detail: "Review each person’s real day, overload and held work", href: "/tomorrow" }, { label: "People + roles", detail: "Farm membership and authority", href: "/owner/members" }, { label: "Design Atlas", detail: "Visual workshop and fake product", href: "/owner/design-atlas" }] : []),
    { label: "Atlas app", detail: "Farm Alerts, installation and connected devices", href: "/install" },
    { label: "Account", detail: "Password and sign-in settings", href: "/settings/password" },
  ];
  return <div className={styles.stack}><section className="atlas-more-page__intro"><span>ELSEWHERE IN ATLAS</span><h1>Controls and deeper views</h1><p>Same destination-list component used by the live More route.</p></section><AtlasMoreDestinationList destinations={destinations} onNavigate={() => undefined} /></div>;
}

function ShellSurface({ persona, scope, tab }: { persona: PersonaKey; scope: ScopeKey; tab: TabKey }) {
  const role = PERSONAS.find((item) => item.key === persona)?.role ?? "Atlas";
  if (tab === "manager") return <DesignAtlasManagerDay />;
  return (
    <AtlasAppShell className={`atlas-home-shell ${styles.shell}`} frameClassName={styles.frame} data-atlas-design-surface={tab}>
      <AtlasTopBar title={SCOPE_LABELS[scope]} status={<span className="atlas-weather-line">{persona === "anna" ? "82° · clear" : role}</span>} />
      <div className={styles.body}>
        {tab === "work" ? persona === "anna" || persona === "marshall" ? <RealDayWorkshopFixture /> : persona === "katie" ? <CommercialWork /> : <PrincipalWork /> : null}
        {tab === "clock" ? <RealClockFixture /> : null}
        {tab === "harvest" ? <HarvestSurface /> : null}
        {tab === "more" ? <MoreSurface persona={persona} /> : null}
      </div>
    </AtlasAppShell>
  );
}

export default function CanonicalAtlasPortal() {
  const [persona, setPersona] = useState<PersonaKey>("anna");
  const [scope, setScope] = useState<ScopeKey>("elm");
  const [tab, setTab] = useState<TabKey>("home");
  const items = useMemo(() => dockItems(persona), [persona]);
  function choosePersona(value: PersonaKey) { const next = PERSONAS.find((item) => item.key === value) ?? PERSONAS[1]; setPersona(value); setScope(next.scope); setTab("home"); }
  function chooseDock(item: AtlasDockItem) { setTab(item.key); }
  const canonicalHomePersona = persona === "katie" ? null : persona as DesignAtlasHomePersona;
  return (
    <div className={styles.root} data-atlas-real-portal="true" data-atlas-design-custody="canonical-components" data-live-data-binding="none" data-mutation-capability="none">
      <DesignLens persona={persona} scope={scope} onPersona={choosePersona} onScope={setScope} />
      {tab === "home" ? canonicalHomePersona ? <DesignAtlasCanonicalHome persona={canonicalHomePersona} /> : <AtlasAppShell className={`atlas-home-shell ${styles.shell}`} frameClassName={styles.frame}><AtlasTopBar title="Feast Guild" status={<span className="atlas-weather-line">Commercial / Buyer Desk</span>} /><div className={styles.body}><CommercialHome /></div></AtlasAppShell> : <ShellSurface persona={persona} scope={scope} tab={tab} />}
      <AtlasDock items={items} active={tab} onNavigate={chooseDock} ariaLabel="Design Atlas canonical destinations" />
    </div>
  );
}
