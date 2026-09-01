import Link from "next/link";

import type { OwnerPrincipalDecisionProjection } from "@/lib/atlas/owner-principal-decisions";
import OwnerPersonAtlasFixture from "./OwnerPersonAtlasFixture";
import styles from "./owner-notebook-spread.module.css";

type OwnerNotebookSpreadProps = {
  personName: string;
  principalDecisions: OwnerPrincipalDecisionProjection;
};

const INDEX_GROUPS = [
  {
    label: "PERSONAL",
    items: [
      { label: "Life", href: "/owner/life", page: "02" },
      { label: "Household", href: "/owner/household", page: "03" },
      { label: "People", page: "04" },
      { label: "Money", page: "05" },
    ],
  },
  {
    label: "WORK",
    items: [
      { label: "Feast Guild", page: "06" },
      { label: "Elm", page: "07" },
      { label: "Write Now", page: "08" },
      { label: "Optical Lift", page: "09" },
    ],
  },
  {
    label: "REFERENCE",
    items: [
      { label: "Ask Atlas", href: "/owner/ask-atlas", page: "10" },
      { label: "Continuity", href: "/owner/continuity", page: "11" },
    ],
  },
];

export default function OwnerNotebookSpread({ personName, principalDecisions }: OwnerNotebookSpreadProps) {
  return (
    <div className={styles.spread} data-atlas-open-notebook="true">
      <div className={styles.leftPage}>
        <OwnerPersonAtlasFixture personName={personName} principalDecisions={principalDecisions} />
        <footer className={styles.leftFolio} aria-label="Today page 01, active">
          <span>01</span>
          <i aria-hidden="true">•</i>
        </footer>
      </div>

      <aside className={`${styles.facingPage} ${styles.dotPage}`} aria-label="Atlas index facing page">
        <div className={styles.indexBody}>
          <header className={styles.indexHeader}>
            <h1>Index</h1>
          </header>

          {INDEX_GROUPS.map((group) => (
            <section className={styles.indexGroup} key={group.label}>
              <h2>{group.label}</h2>
              <div>
                {group.items.map((item) => {
                  const row = (
                    <>
                      <strong>{item.label}</strong>
                      <i aria-hidden="true" />
                      <span>{item.page}</span>
                    </>
                  );

                  if (item.href) {
                    return (
                      <Link className={styles.indexRow} href={item.href} key={`${group.label}:${item.label}`}>
                        {row}
                      </Link>
                    );
                  }

                  return (
                    <div className={styles.indexRow} data-muted="true" key={`${group.label}:${item.label}`}>
                      {row}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className={styles.facingFolio} aria-label="Index page 00">
          <span>00</span>
        </footer>
      </aside>
    </div>
  );
}
