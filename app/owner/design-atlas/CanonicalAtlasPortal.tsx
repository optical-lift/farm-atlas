"use client";

import { useMemo, useState } from "react";

import AtlasDock, { type AtlasDockIconKey, type AtlasDockItem } from "@/components/atlas/shell/AtlasDock";
import AtlasMoreDestinationList, { type AtlasMoreDestination } from "@/components/atlas/shell/AtlasMoreDestinationList";
import { AtlasAppShell, AtlasTopBar } from "@/components/atlas/ui/AtlasPrimitives";
import DesignAtlasCanonicalHome from "./DesignAtlasCanonicalHome";
import DesignAtlasManagerDay from "./DesignAtlasManagerDay";
import DesignAtlasPrincipal from "./DesignAtlasPrincipal";
import {
  AnnaHarvestSurface,
  KatieBuyerDeskSurface,
  KatieCommercialHome,
  PrincipalFlowerOpsSummary,
} from "./DesignAtlasRoleSurfaces";
import FutureClockFixture from "./FutureClockFixture";
import RealDayWorkshopFixture from "./RealDayWorkshopFixture";
import styles from "./canonical-atlas-portal.module.css";

type PersonaKey = "principal" | "anna" | "katie" | "marshall";
type WorkerPersona = "anna" | "marshall";
type ScopeKey = "principal" | "feast" | "elm";
type TabKey = AtlasDockIconKey;

const PERSONAS: Array<{ key: PersonaKey; label: string; role: string; scope: ScopeKey }> = [
  { key: "principal", label: "Principal", role: "Owner / coordination", scope: "principal" },
  { key: "anna", label: "Anna", role: "Farm hand / execution", scope: "elm" },
  { key: "katie", label: "Katie", role: "Commercial / Buyer Desk", scope: "feast" },
  { key: "marshall", label: "Marshall", role: "Shared operations", scope: "elm" },
];

const SCOPE_LABELS: Record<ScopeKey, string> = {
  principal: "Principal",
  feast: "Feast Guild",
  elm: "Elm Farm",
};

function dockItems(persona: PersonaKey): AtlasDockItem[] {
  if (persona === "principal") {
    return [
      { key: "home", label: "Home", href: "/principal" },
      { key: "work", label: "Farm Ops", href: "/overview/week" },
      { key: "more", label: "More", href: "/more" },
    ];
  }
  if (persona === "katie") {
    return [
      { key: "home", label: "Home", href: "/" },
      { key: "work", label: "Buyer Desk", href: "/owner/design-atlas" },
      { key: "more", label: "More", href: "/more" },
    ];
  }
  if (persona === "marshall") {
    return [
      { key: "home", label: "Home", href: "/" },
      { key: "work", label: "Work", href: "/day" },
      { key: "clock", label: "Clock", href: "/clock" },
      { key: "more", label: "More", href: "/more" },
    ];
  }
  return [
    { key: "home", label: "Home", href: "/" },
    { key: "work", label: "Work", href: "/day" },
    { key: "clock", label: "Clock", href: "/clock" },
    { key: "harvest", label: "Harvest", href: "/harvest" },
    { key: "more", label: "More", href: "/more" },
  ];
}

function DesignLens({
  persona,
  scope,
  onPersona,
  onScope,
}: {
  persona: PersonaKey;
  scope: ScopeKey;
  onPersona: (value: PersonaKey) => void;
  onScope: (value: ScopeKey) => void;
}) {
  return (
    <details className={styles.designLens}>
      <summary>
        <span>DESIGN LENS</span>
        <strong>{PERSONAS.find((item) => item.key === persona)?.label} · {SCOPE_LABELS[scope]}</strong>
        <b aria-hidden="true">⌄</b>
      </summary>
      <div>
        <p>One Atlas product, viewed through different jobs. Canonical means the real reusable component; Future Canonical means the chosen replacement awaiting production adoption.</p>
        <label>
          <span>View as</span>
          <div>{PERSONAS.map((item) => <button type="button" data-active={persona === item.key} onClick={() => onPersona(item.key)} key={item.key}>{item.label}</button>)}</div>
        </label>
        <label>
          <span>Scope</span>
          <div>{(["principal", "feast", "elm"] as ScopeKey[]).map((item) => <button type="button" data-active={scope === item} onClick={() => onScope(item)} key={item}>{SCOPE_LABELS[item]}</button>)}</div>
        </label>
      </div>
    </details>
  );
}

function FarmOpsSurface() {
  return (
    <div className={styles.stack}>
      <section className="atlas-more-page__intro">
        <span>FARM OPS</span>
        <h1>See the operating system without becoming the operator.</h1>
        <p>Principal receives exceptions, capacity pressure, and decisions from the same shared truth Anna, Katie, and Marshall operate.</p>
      </section>
      <PrincipalFlowerOpsSummary />
      <AtlasMoreDestinationList
        destinations={[
          { label: "Current farm week", detail: "Canonical production destination · /overview/week", href: "/overview/week" },
          { label: "Tomorrow preflight", detail: "Review overload, held work, and role boundaries", href: "/tomorrow" },
        ]}
        onNavigate={() => undefined}
        ariaLabel="Principal Farm Ops destinations"
      />
    </div>
  );
}

function MoreSurface({ persona }: { persona: PersonaKey }) {
  const workerDestinations: AtlasMoreDestination[] = [
    { label: "Zone Registry", detail: "Beds, rooms, gardens and every canonical farm place", href: "/zones" },
    { label: "Projects", detail: "Builds, venue work and multi-step initiatives", href: "/projects" },
    { label: "Production", detail: "Crop cycles and production state", href: "/production" },
    { label: "Seed inventory", detail: "Verified counts, freshness and crop commitments", href: "/inventory/seeds" },
  ];
  const commercialDestinations: AtlasMoreDestination[] = [
    { label: "Buyer relationships", detail: "Relationship history, warmth, last contact and next move", href: "/owner/design-atlas" },
    { label: "Fulfillment history", detail: "Orders, routes, handoffs, returns and cancellations", href: "/owner/design-atlas" },
  ];
  const principalDestinations: AtlasMoreDestination[] = [
    { label: "Tomorrow preflight", detail: "Review each person's real day, overload and held work", href: "/tomorrow" },
    { label: "People + roles", detail: "Farm membership and authority", href: "/owner/members" },
    { label: "Design Atlas", detail: "Canonical fake product and visual workshop", href: "/owner/design-atlas" },
  ];
  const destinations: AtlasMoreDestination[] = [
    ...(persona === "principal" ? principalDestinations : persona === "katie" ? commercialDestinations : workerDestinations),
    { label: "Atlas app", detail: "Installation and connected devices", href: "/install" },
    { label: "Account", detail: "Password and sign-in settings", href: "/settings/password" },
  ];
  return (
    <div className={styles.stack}>
      <section className="atlas-more-page__intro">
        <span>ELSEWHERE IN ATLAS</span>
        <h1>Controls and deeper views</h1>
        <p>The shell stays the same; deeper destinations change according to the work this person is actually responsible for.</p>
      </section>
      <AtlasMoreDestinationList destinations={destinations} onNavigate={() => undefined} />
    </div>
  );
}

function WorkerSurface({ persona, tab }: { persona: WorkerPersona; tab: TabKey }) {
  if (tab === "work") return <RealDayWorkshopFixture persona={persona} />;
  if (tab === "clock") return <FutureClockFixture persona={persona} />;
  if (tab === "harvest" && persona === "anna") return <AnnaHarvestSurface />;
  return null;
}

function ShellSurface({ persona, scope, tab }: { persona: PersonaKey; scope: ScopeKey; tab: TabKey }) {
  if (persona === "principal" && tab === "work") {
    return (
      <AtlasAppShell className={`atlas-home-shell ${styles.shell}`} frameClassName={styles.frame}>
        <AtlasTopBar title="Principal" status={<span className="atlas-weather-line">Farm Ops</span>} />
        <div className={styles.body}><FarmOpsSurface /></div>
      </AtlasAppShell>
    );
  }
  if (tab === "manager") return <DesignAtlasManagerDay />;

  const role = PERSONAS.find((item) => item.key === persona)?.role ?? "Atlas";
  const status = tab === "clock" ? "Future Clock · Study 15" : role;
  return (
    <AtlasAppShell className={`atlas-home-shell ${styles.shell}`} frameClassName={styles.frame} data-atlas-design-surface={tab}>
      <AtlasTopBar title={SCOPE_LABELS[scope]} status={<span className="atlas-weather-line">{status}</span>} />
      <div className={styles.body}>
        {persona === "anna" || persona === "marshall" ? <WorkerSurface persona={persona} tab={tab} /> : null}
        {persona === "katie" && tab === "work" ? <KatieBuyerDeskSurface /> : null}
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

  function choosePersona(value: PersonaKey) {
    const next = PERSONAS.find((item) => item.key === value) ?? PERSONAS[1];
    setPersona(value);
    setScope(next.scope);
    setTab("home");
  }

  const home = persona === "principal"
    ? <DesignAtlasPrincipal />
    : persona === "anna" || persona === "marshall"
      ? <DesignAtlasCanonicalHome persona={persona} />
      : (
        <AtlasAppShell className={`atlas-home-shell ${styles.shell}`} frameClassName={styles.frame}>
          <AtlasTopBar title="Feast Guild" status={<span className="atlas-weather-line">Commercial / Buyer Desk</span>} />
          <div className={styles.body}><KatieCommercialHome /></div>
        </AtlasAppShell>
      );

  return (
    <div
      className={styles.root}
      data-atlas-real-portal="true"
      data-atlas-design-custody="canonical-components-and-governed-future"
      data-live-data-binding="none"
      data-mutation-capability="none"
    >
      <DesignLens persona={persona} scope={scope} onPersona={choosePersona} onScope={setScope} />
      {tab === "home" ? home : <ShellSurface persona={persona} scope={scope} tab={tab} />}
      <AtlasDock items={items} active={tab} onNavigate={(item) => setTab(item.key)} ariaLabel="Design Atlas canonical destinations" />
    </div>
  );
}
