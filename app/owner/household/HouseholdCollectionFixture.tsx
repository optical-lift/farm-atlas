"use client";

import Link from "next/link";

import type { HouseholdCareSnapshot, HouseholdCareSpace } from "@/lib/atlas/household-care";
import {
  createHouseholdDwelling,
  createHouseholdSpace,
  recordHouseholdCareResult,
  recordHouseholdCondition,
} from "./actions";
import styles from "./household-collection.module.css";

type HouseholdCollectionFixtureProps = {
  personName: string;
  snapshot: HouseholdCareSnapshot | null;
};

const CONDITION_LABELS: Record<string, string> = {
  unknown: "not observed yet",
  holding: "holding well",
  needs_attention: "needs a little attention",
  losing_shape: "losing shape",
  needs_recovery: "needs recovery",
};

const FUNCTION_OPTIONS = [
  ["arrival", "arrival / transition"],
  ["food", "food / kitchen"],
  ["hygiene", "bath / hygiene"],
  ["sleeping", "sleeping / dressing"],
  ["gathering", "living / gathering"],
  ["flexible_secondary", "flexible / secondary"],
] as const;

function ConditionForm({ space }: { space: HouseholdCareSpace }) {
  return (
    <form action={recordHouseholdCondition} className={styles.inlineForm}>
      <input type="hidden" name="spaceId" value={space.id} />
      <select name="conditionState" defaultValue={space.conditionKnown ? space.conditionState : ""} aria-label={`How is ${space.name} holding?`}>
        <option value="" disabled>how is it holding?</option>
        <option value="holding">holding well</option>
        <option value="needs_attention">needs a little attention</option>
        <option value="losing_shape">losing shape</option>
        <option value="needs_recovery">needs recovery</option>
      </select>
      <button type="submit">record</button>
    </form>
  );
}

function ResultForm({ space }: { space: HouseholdCareSpace }) {
  if (!space.conditionKnown || space.conditionState === "holding") return null;
  return (
    <details className={styles.resultDetails}>
      <summary>record what changed</summary>
      <form action={recordHouseholdCareResult} className={styles.stackForm}>
        <input type="hidden" name="spaceId" value={space.id} />
        <select name="resultKind" defaultValue="recovered">
          <option value="recovered">recovered</option>
          <option value="improved_more_remains">improved, more remains</option>
          <option value="condition_differed">condition differed</option>
          <option value="blocked">blocked</option>
          <option value="strategy_should_change">strategy should change</option>
          <option value="plan_changed_not_relevant">plan changed / not relevant</option>
        </select>
        <select name="conditionAfter" defaultValue="holding">
          <option value="holding">holding well now</option>
          <option value="needs_attention">still needs a little attention</option>
          <option value="losing_shape">still losing shape</option>
          <option value="needs_recovery">still needs recovery</option>
        </select>
        <input name="minutes" inputMode="numeric" placeholder="minutes, if known" />
        <button type="submit">save result</button>
      </form>
    </details>
  );
}

export default function HouseholdCollectionFixture({ personName, snapshot }: HouseholdCollectionFixtureProps) {
  const dwellings = snapshot?.dwellings ?? [];
  const spaces = dwellings.flatMap((dwelling) => dwelling.spaces.filter((space) => space.active));
  const attention = snapshot?.currentAttention ?? [];
  const currentZone = attention[0] ?? null;

  return (
    <main className={styles.root} data-atlas-household-collection="true">
      <section className={styles.page}>
        <header className={styles.topChrome}>
          <Link href="/owner" className={styles.back} aria-label="Return to Today">←</Link>
          <div><span>source</span><strong>{personName}</strong></div>
          <Link href="/owner" className={styles.indexLink}>today</Link>
        </header>

        <article className={styles.collectionPage}>
          <header className={styles.collectionHeader}>
            <div><span>household source</span><h1>{snapshot?.household.name || "Household"}</h1></div>
            <small>private system</small>
          </header>

          {!snapshot ? (
            <section className={styles.onboarding}>
              <span>household unavailable</span>
              <h2>Atlas could not open your household.</h2>
              <p>This page only reads a signed-in Principal household. No household facts were invented.</p>
            </section>
          ) : dwellings.length === 0 ? (
            <section className={styles.onboarding}>
              <span>home · 1 of 3</span>
              <h2>Teach Atlas your home.</h2>
              <p>Start with the dwelling itself. Rooms come next; cleaning lists do not.</p>
              <form action={createHouseholdDwelling} className={styles.startForm}>
                <label htmlFor="dwelling-name">What do you call the place you live?</label>
                <input id="dwelling-name" name="name" autoComplete="off" placeholder="Home" required />
                <button type="submit">begin home map</button>
              </form>
            </section>
          ) : (
            <div className={styles.sections}>
              <section className={styles.section}>
                <h2>{spaces.length === 0 ? "home · 2 of 3" : "home map"}</h2>
                <div className={styles.rows}>
                  {dwellings.map((dwelling) => (
                    <div className={styles.row} data-tone="active" key={dwelling.id}>
                      <b aria-hidden="true">⌂</b>
                      <div><strong>{dwelling.name}</strong><span>{dwelling.spaces.length} mapped {dwelling.spaces.length === 1 ? "space" : "spaces"}</span></div>
                    </div>
                  ))}
                </div>
                <form action={createHouseholdSpace} className={styles.spaceForm}>
                  <input type="hidden" name="dwellingId" value={dwellings[0].id} />
                  <label>What space should Atlas know next?</label>
                  <input name="name" placeholder="Kitchen, front porch, upstairs bath…" required />
                  <div className={styles.formGrid}>
                    <select name="functionalTag" defaultValue="">
                      <option value="" disabled>what is it mainly for?</option>
                      {FUNCTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <input name="floorLevel" placeholder="floor, if useful" />
                  </div>
                  <input type="hidden" name="spaceType" value="room" />
                  <button type="submit">add space</button>
                </form>
                {spaces.length === 0 ? <p className={styles.hint}>Add spaces one at a time. Atlas assigns the five-zone rhythm from what each space is for—not from its floor or its name.</p> : null}
              </section>

              {spaces.length > 0 ? (
                <section className={styles.section}>
                  <h2>how the home is holding</h2>
                  <div className={styles.careRows}>
                    {spaces.map((space) => (
                      <div className={styles.careRow} key={space.id}>
                        <div className={styles.spaceTitle}>
                          <strong>{space.name}</strong>
                          <span>{CONDITION_LABELS[space.conditionState] || space.conditionState}{space.floorLevel ? ` · ${space.floorLevel}` : ""}</span>
                        </div>
                        <ConditionForm space={space} />
                        <ResultForm space={space} />
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className={styles.section}>
                <h2>this week</h2>
                {currentZone ? (
                  <div className={styles.rows}>
                    <div className={styles.row} data-tone="active">
                      <b aria-hidden="true">{currentZone.zoneNumber}</b>
                      <div>
                        <strong>{currentZone.zoneName}</strong>
                        <span>{currentZone.expectedMinutes} minutes of protected attention · no chore is created by the clock</span>
                      </div>
                    </div>
                    {attention.filter((item) => item.spaceId).map((item) => (
                      <div className={styles.row} key={`${item.zoneId}:${item.spaceId}`}>
                        <b aria-hidden="true">·</b>
                        <div><strong>{item.spaceName}</strong><span>{CONDITION_LABELS[item.conditionState] || item.conditionState}</span></div>
                      </div>
                    ))}
                  </div>
                ) : <p className={styles.hint}>The five-zone rhythm is protected, but no current attention window is available yet.</p>}
              </section>
            </div>
          )}
        </article>

        <nav className={styles.pageNav} aria-label="Household source navigation">
          <button type="button" disabled aria-hidden="true">‹</button>
          <span className={styles.thread}>{spaces.length ? "source · feeds Today" : "teach Atlas · then observe"}</span>
          <strong>08</strong>
          <button type="button" disabled aria-hidden="true">›</button>
        </nav>
      </section>
    </main>
  );
}
