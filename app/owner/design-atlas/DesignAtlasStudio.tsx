"use client";

import Link from "next/link";
import { useState } from "react";

import DesignWorkshop from "./DesignWorkshop";
import RealAtlasPortal from "./RealAtlasPortal";
import styles from "./design-studio.module.css";

type StudioMode = "portal" | "workshop";

export default function DesignAtlasStudio() {
  const [mode, setMode] = useState<StudioMode>("portal");

  if (mode === "portal") {
    return (
      <>
        <RealAtlasPortal />
        <button className={styles.openWorkshop} type="button" onClick={() => setMode("workshop")}>
          <span>DESIGN ATLAS</span>
          <strong>Workshop</strong>
        </button>
      </>
    );
  }

  return (
    <main className={styles.workshopRoot} data-atlas-design-studio="fixture-only">
      <header className={styles.header}>
        <div className={styles.brand}><span>A</span><div><strong>Atlas</strong><small>DESIGN WORKSHOP</small></div></div>
        <div className={styles.center}><strong>Design Atlas</strong><small>Visual source of truth · fixture only</small></div>
        <div className={styles.actions}>
          <button type="button" onClick={() => setMode("portal")}><span>◫</span><strong>Portal</strong></button>
          <Link href="/more" aria-label="Exit Design Atlas">×</Link>
        </div>
      </header>
      <section className={styles.modeRail}>
        <button type="button" onClick={() => setMode("portal")}><span>REAL FAKE APP</span><strong>Portal</strong><small>Pressure-test navigation and role lenses</small></button>
        <button type="button" data-active="true"><span>DESIGN LIBRARY</span><strong>Workshop</strong><small>Keep visual studies and components together</small></button>
      </section>
      <section className={styles.content}><DesignWorkshop /></section>
    </main>
  );
}
