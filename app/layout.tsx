import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import AtlasBellCover from "@/components/atlas/home/AtlasBellCover";
import OwnerDayPlanningDisclosure from "@/components/atlas/owner-day-planning-disclosure";
import AtlasPwaBridge from "@/components/atlas/pwa/AtlasPwaBridge";
import AtlasContextualAppFrame from "@/components/atlas/shell/AtlasContextualAppFrame";
import DependencyReleaseFlash from "@/components/atlas/task/DependencyReleaseFlash";
import AtlasWorkAlongsideOverlay from "@/components/atlas/work-alongside/AtlasWorkAlongsideOverlay";
import { readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { getAtlasSession } from "@/lib/atlas/session";
import WeekDayNavigation from "./WeekDayNavigation";
import HomeTodayCompletePatch from "./HomeTodayCompletePatch";
import HomeQuietTaskHeroPatch from "./HomeQuietTaskHeroPatch";
import WorkerVocabularyCleanupPatch from "./WorkerVocabularyCleanupPatch";
import TaskProgressExactDayPatch from "./TaskProgressExactDayPatch";
import OwnerHomeLinkPatch from "./OwnerHomeLinkPatch";
import HomeSundayNavigationPatch from "./HomeSundayNavigationPatch";
import OwnerTaskReturnPatch from "./OwnerTaskReturnPatch";
import SafeBedCropAccordionPatch from "./SafeBedCropAccordionPatch";
import AttachedTaskHistoryPatch from "./AttachedTaskHistoryPatch";
import AnnaPaidScheduleHomePatch from "./AnnaPaidScheduleHomePatch";
import TaskResultAnchorPatch from "./TaskResultAnchorPatch";
import ProjectTaskDestinationGuard from "./ProjectTaskDestinationGuard";
import UniversalCollectionIdentity from "./UniversalCollectionIdentity";
import DayTaskTitleLinkPatch from "./DayTaskTitleLinkPatch";
import TaskSetAsideDayPatch from "./TaskSetAsideDayPatch";
import DayConsequenceTimelinePatch from "./DayConsequenceTimelinePatch";
import AtlasFarmConditionsHomePatch from "./AtlasFarmConditionsHomePatch";
import AtlasSkyLedgerMaintainer from "./AtlasSkyLedgerMaintainer";
import OwnerOperatorMode from "./OwnerOperatorMode";
import FutureDayProjectionBridge from "./FutureDayProjectionBridge";
import "./globals.css";
import "./atlas-primitives.css";
import "./atlas-trail.css";
import "./home.css";
import "./zones.css";
import "./task-feed.css";
import "./closeout-clean.css";
import "./rhythm-log.css";
import "./log-picker-compact.css";
import "./today-schedule.css";
import "./project-spine.css";
import "./task-page.css";
import "./field-state-capture.css";
import "./day-run-sheet.css";
import "./day-adjacent-navigation.css";
import "./purple-hero-rollback.css";
import "./home-horizontal-dashboard.css";
import "./home-week-day-final-fit.css";
import "./home-hero-less-redundant.css";
import "./home-footer-bars.css";
import "./week-day-navigation.css";
import "./home-today-overview-link.css";
import "./overview.css";
import "./weeding-cycle.css";
import "./farm-care-drilldown.css";
import "./tending.css";
import "./tending-calm.css";
import "./tending-next-bite.css";
import "./tending-compact-track.css";
import "./task-tending-trail.css";
import "./task-dominion-card.css";
import "./task-condition-rail.css";
import "./task-data-cluster.css";
import "./task-unfinished.css";
import "./field-log-documentation.css";
import "./mobile-overflow-guard.css";
import "./task-child-inline-log.css";
import "./germination-check.css";
import "./day-overdue.css";
import "./object-operational-timeline.css";
import "./bed-crop-accordion.css";
import "./attached-task-history.css";
import "./venue-rooms.css";
import "./day-route-v1.css";
import "./day-route-v1-refine.css";
import "./day-timeline-completion-echo.css";
import "./living-journal.css";
import "./journal-page.css";
import "./day-task-only.css";
import "./day-task-title-link.css";
import "./week-route-v1.css";
import "./universal-home-familiar.css";
import "./atlas-shell-responsive.css";
import "./project-task-timeline.css";
import "./tending-task-timeline.css";
import "./home-cover-v1.css";
import "./weed-card-grazer.css";
import "./task-day-set-aside.css";
import "./task-structured-unfinished.css";
import "./day-consequence-timeline.css";
import "./day-overdue-quiet.css";
import "./owner-operator-mode.css";
import "./bell.css";
import "./bell-cover-quiet.css";
import "./pwa.css";
import "./web-push.css";
import "./contextual-app-shell.css";
import "./app-shell-regression-fixes.css";
import "./dependency-release-flash.css";
import "./work-alongside.css";
import "./day-single-scroll.css";
import "./farm-conditions-home.css";
import "./farm-conditions-merged.css";
import "./day-node-clean.css";
import "./future-day-projection.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Atlas · Feast Guild",
  description: "Feast Guild farm portfolio, projects, and field operations",
  applicationName: "Atlas",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Atlas",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/api/pwa/icon?size=192", sizes: "192x192", type: "image/png" },
      { url: "/api/pwa/icon?size=512", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/api/pwa/icon?size=180", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#f7f4e9",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [operatorContext, session] = await Promise.all([
    readAtlasOwnerOperatorContext(),
    getAtlasSession(),
  ]);
  const activeMembership = session?.memberships.find((membership) => membership.farmId === session.activeFarmId)
    ?? session?.memberships[0]
    ?? null;
  const effectiveFarmRole = operatorContext?.isOperating
    ? operatorContext.effective.farmRole
    : activeMembership?.role ?? null;

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AtlasPwaBridge />
        <AtlasSkyLedgerMaintainer farmId={activeMembership?.farmId ?? null} role={activeMembership?.role ?? null} />
        <OwnerOperatorMode context={operatorContext} />
        {/* Legacy contract marker: <AtlasContextualAppFrame /> now receives the effective account role. */}
        <AtlasContextualAppFrame effectiveFarmRole={effectiveFarmRole} />
        <AtlasBellCover />
        <DependencyReleaseFlash />
        <Suspense fallback={null}><AtlasWorkAlongsideOverlay /></Suspense>
        <WeekDayNavigation />
        <HomeTodayCompletePatch />
        <HomeQuietTaskHeroPatch />
        <WorkerVocabularyCleanupPatch />
        <TaskProgressExactDayPatch />
        <OwnerHomeLinkPatch />
        <HomeSundayNavigationPatch />
        <OwnerTaskReturnPatch />
        <SafeBedCropAccordionPatch />
        <AttachedTaskHistoryPatch />
        <AnnaPaidScheduleHomePatch />
        <TaskResultAnchorPatch />
        <ProjectTaskDestinationGuard />
        <UniversalCollectionIdentity />
        <DayTaskTitleLinkPatch />
        <TaskSetAsideDayPatch />
        <DayConsequenceTimelinePatch />
        <AtlasFarmConditionsHomePatch />
        <Suspense fallback={null}><FutureDayProjectionBridge /></Suspense>
        {activeMembership?.role === "owner" ? (
          <Suspense fallback={null}><OwnerDayPlanningDisclosure /></Suspense>
        ) : null}
        {/* Legacy contract marker: <TaskFocusTendingTrail was absorbed into the opened Dominion card. */}
        {children}
      </body>
    </html>
  );
}
