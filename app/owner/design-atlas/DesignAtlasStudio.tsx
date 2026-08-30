"use client";

import { useState } from "react";

import { AtlasAppShell, AtlasTopBar } from "@/components/atlas/ui/AtlasPrimitives";
import BridgeAtlasFixture from "./BridgeAtlasFixture";
import DesignWorkshop from "./DesignWorkshop";
import styles from "./design-studio.module.css";
import "./workshop-live-overrides.module.css";

type StudioMode = "portal" | "workshop";

export default function DesignAtlasStudio() {
  const [mode, setMode] = useState<StudioMode>("portal");

  if (mode === "portal") {
    return <BridgeAtlasFixture onOpenWorkshop={() => setMode("workshop")} />;
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
        status={<span className="atlas-weather-line">Archive workshop · fixture only</span>}
        action={<button type="button" className="atlas-global-note-plus" onClick={() => setMode("portal")} aria-label="Return to bridge-person Atlas">←</button>}
      />
      <section className={styles.content}><DesignWorkshop /></section>
    </AtlasAppShell>
  );
}
