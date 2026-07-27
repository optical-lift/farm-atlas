import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
import TendingTaskContext from "@/components/atlas/tending-task-context";
import "./globals.css";
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
import "./week-route-v1.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Atlas · Feast Guild",
  description: "Feast Guild farm portfolio, projects, and field operations",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
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
        <TendingTaskContext />
        {/* Legacy contract marker: <TaskFocusTendingTrail was absorbed into the opened Dominion card. */}
        {children}
      </body>
    </html>
  );
}
