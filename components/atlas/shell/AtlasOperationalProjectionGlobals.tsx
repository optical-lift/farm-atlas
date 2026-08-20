"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";

import OwnerDayPlanGate from "@/components/atlas/owner-day-plan-gate";
import DependencyReleaseFlash from "@/components/atlas/task/DependencyReleaseFlash";
import AtlasWorkAlongsideOverlay from "@/components/atlas/work-alongside/AtlasWorkAlongsideOverlay";
import AtlasSkyLedgerMaintainer from "@/app/AtlasSkyLedgerMaintainer";
import GlobalDayCueDelivery from "@/app/GlobalDayCueDelivery";
import type { AtlasFarmRole } from "@/lib/atlas/session";

type Props = {
  farmId: string | null;
  directFarmRole: AtlasFarmRole | null;
  effectiveFarmRole: AtlasFarmRole | null;
};

function isPrincipalProjection(pathname: string) {
  return pathname === "/principal" || pathname.startsWith("/principal/");
}

export default function AtlasOperationalProjectionGlobals({ farmId, directFarmRole, effectiveFarmRole }: Props) {
  const pathname = usePathname();
  if (isPrincipalProjection(pathname)) return null;

  return (
    <>
      <AtlasSkyLedgerMaintainer farmId={farmId} role={directFarmRole} />
      <DependencyReleaseFlash />
      <Suspense fallback={null}><AtlasWorkAlongsideOverlay effectiveFarmRole={effectiveFarmRole} /></Suspense>
      <Suspense fallback={null}><OwnerDayPlanGate /></Suspense>
      <Suspense fallback={null}><GlobalDayCueDelivery /></Suspense>
    </>
  );
}
