import Link from "next/link";

import OwnerPersonAtlasFixture from "./OwnerPersonAtlasFixture";
import styles from "./owner-notebook-spread.module.css";

type OwnerNotebookSpreadProps = {
  personName: string;
};

const INDEX_GROUPS = [
  {
    label: "PERSONAL",
    items: [
      { label: "Life", href: "/owner/life" },
      { label: "Household", href: "/owner/household" },
      { label: "People" },
      { label: "Money" },
    ],
  },
  {
    label: "WORK",
    items: [
      { label: "Feast Guild" },
      { label: "Elm" },
      { label: "Write Now" },
      { label: "Optical Lift" },
    ],
  },
  {
    label: "REFERENCE",
    items: [
      { label: "Ask Atlas", href: "/owner/ask-atlas" },
      { label: "Continuity", href: "/owner/continuity" },
    ],
  },
];

export default function OwnerNotebookSpread({ personName }: OwnerNotebookSpreadProps) {
  return (
    <div className={styles.spread} data-atlas-open-notebook="true">
      <div className={styles.leftPage}>
        <OwnerPersonAtlasFixture personName={personName} />
      </div>

      <aside className={`${styles.facingPage} ${styles.dotPage}`} aria-label="Atlas index facing page">
        <header className={styles.facingTop}>
          <div>
            <span>index</span>
            <strong>{personName}</strong>
          </div>
        </header>

        <div className={styles.indexBody}>
          <header className={styles.indexHeader}>
            <h1>Index</h1>
            <span>spreads</span>
            <i aria-hidden="true" />
          </header>

          {INDEX_GROUPS.map((group) => (
            <section className={styles.indexGroup} key={group.label}>
              <h2>{group.label}</h2>
              <div>
                {group.items.map((item) => {
                  if (item.href) {
                    return (
                      <Link className={styles.indexRow} href={item.href} key={`${group.label}:${item.label}`}>
                        <strong>{item.label}</strong>
                        <span aria-hidden="true">›</span>
                      </Link>
                    );
                  }

                  return (
                    <div className={styles.indexRow} data-muted="true" key={`${group.label}:${item.label}`}>
                      <strong>{item.label}</strong>
                      <span aria-hidden="true">·</span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className={styles.facingFooter}>
          <span>index</span>
          <span>00</span>
        </footer>
      </aside>
    </div>
  );
}
