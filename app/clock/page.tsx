import { Suspense } from "react";

import ClockSurface from "@/components/atlas/clock/clock-surface";

function ClockFallback() {
  return (
    <main className="atlas-phone-shell">
      <section className="atlas-phone" style={{ display: "grid", placeItems: "center", minHeight: "70svh" }}>
        <span>Loading Clock…</span>
      </section>
    </main>
  );
}

export default function ClockPage() {
  return <Suspense fallback={<ClockFallback />}><ClockSurface /></Suspense>;
}
