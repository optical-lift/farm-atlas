"use client";

import { useState } from "react";

import { AtlasAppShell, AtlasTopBar } from "@/components/atlas/ui/AtlasPrimitives";
import DesignWorkshop from "./DesignWorkshop";
import RealAtlasPortal from "./RealAtlasPortal";
import styles from "./design-studio.module.css";
import "./workshop-live-overrides.module.css";

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
    <AtlasAppShell
      className={`atlas-home-shell ${styles.workshopRoot}`}
      frameClassName={styles.workshopFrame}
      data-atlas-design-workshop-shell="true"
      data-live-data-binding="none"
      data-mutation-capability="none"
    >
      <AtlasTopBar
        title="Design Atlas"
        status={<span className="atlas-weather-line">Workshop · fixture only</span>}
        action={<button type="button" className="atlas-global-note-plus" onClick={() => setMode("portal")} aria-label="Return to fake Atlas portal">◫</button>}
      />
      <section className={styles.content}><DesignWorkshop /></section>
    </AtlasAppShell>
  );
}
