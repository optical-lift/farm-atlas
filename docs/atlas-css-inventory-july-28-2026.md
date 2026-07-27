# Atlas CSS Inventory — Universal Build 1

This inventory supports the global Atlas dashboard and Trail rebuild. Retirement follows migration: no stylesheet is removed until its live behavior has a shared replacement.

## Global foundation

| File | Classification | Universal target |
| --- | --- | --- |
| `app/globals.css` | Retain + migrate | Base palette, document reset, shell compatibility. Tokens progressively move into the global system. |
| `app/atlas-primitives.css` | New shared foundation | Spacing, radius, typography, shadows, motion, state colors, shell, card, top-bar, metric, badge, heading, and footer primitives. |
| `app/home.css` | Migrate | Home-only arrangements remain temporarily; universal frames move to primitives. |
| `app/mobile-overflow-guard.css` | Retain | Cross-surface mobile safety. |

## Home and calendar layers

| File | Classification | Universal target |
| --- | --- | --- |
| `app/purple-hero-rollback.css` | Retire after dashboard migration | Fold surviving Now-panel rules into shared dashboard components. |
| `app/home-horizontal-dashboard.css` | Migrate, then retire | Keep only temporary farm-home arrangement until `AtlasDashboard`. |
| `app/home-week-day-final-fit.css` | Migrate | Move shared overview geometry into `AtlasOverviewPair`. |
| `app/home-hero-less-redundant.css` | Retire | Content correction should live in components/read models, not patches. |
| `app/home-footer-bars.css` | Migrate, then retire | `AtlasFooterActions` is the shared frame. |
| `app/home-today-overview-link.css` | Migrate | Universal navigation behavior remains. |
| `app/week-day-navigation.css` | Retain feature-specific | Week navigation is a legitimate calendar feature. |
| `app/overview.css` | Migrate | Week and month surfaces will consume universal dated moves. |
| `app/day-run-sheet.css` | Migrate | Day becomes a universal move hand. |
| `app/day-adjacent-navigation.css` | Retain feature-specific | Date navigation is not a universal card frame. |
| `app/day-overdue.css` | Migrate | Overdue becomes shared move state. |
| `app/day-route-v1.css` | Migrate | Preserve exact-day route behavior. |
| `app/day-route-v1-refine.css` | Consolidate | Merge surviving rules into the Day feature after universal move migration. |
| `app/day-timeline-completion-echo.css` | Retain feature-specific | Completion echo remains a Day behavior. |
| `app/week-route-v1.css` | Retain feature-specific | Week route arrangement remains feature-specific. |
| `app/today-schedule.css` | Consolidate | Fold surviving schedule rules into Day/overview components. |

## Task, Trail, and result layers

| File | Classification | Universal target |
| --- | --- | --- |
| `app/task-page.css` | Migrate | Full move detail uses shared shell/card/result primitives. |
| `app/task-dominion-card.css` | Retain as reference, then migrate | Source for universal full-card and Trail extraction. |
| `app/task-tending-trail.css` | Migrate, then retire | Replace with `AtlasTrail` variants. |
| `app/tending-compact-track.css` | Migrate, then retire | Replace duplicate lineage geometry with `AtlasTrail`. |
| `app/task-condition-rail.css` | Retain feature-specific | Condition rail remains task-family content. |
| `app/task-data-cluster.css` | Consolidate | Shared facts use universal card primitives; family facts remain feature-specific. |
| `app/task-unfinished.css` | Retain feature-specific | Result outcome behavior remains. |
| `app/task-child-inline-log.css` | Retain feature-specific | Child-result interaction remains. |
| `app/attached-task-history.css` | Migrate | History becomes evidence presentation under universal Trail/detail. |
| `app/object-operational-timeline.css` | Migrate, then retire | Replace duplicate object lineage with `AtlasTrail`. |
| `app/germination-check.css` | Retain feature-specific | Crop-family result facts remain specialized. |
| `app/field-state-capture.css` | Retain feature-specific | Structured field evidence form. |
| `app/field-log-documentation.css` | Retain feature-specific | Quick Log/documentation workflow. |

## Farm collections and domain surfaces

| File | Classification | Universal target |
| --- | --- | --- |
| `app/zones.css` | Migrate | Zone and object cards receive shared card/state/Trail primitives. |
| `app/task-feed.css` | Migrate | Lists use `AtlasMoveCard`. |
| `app/closeout-clean.css` | Retain feature-specific | Closeout content inside shared frames. |
| `app/rhythm-log.css` | Retain feature-specific | Rhythm/evidence interaction. |
| `app/log-picker-compact.css` | Retain feature-specific | Input control arrangement. |
| `app/project-spine.css` | Migrate, then retire | Projects move to universal Trail. |
| `app/weeding-cycle.css` | Retain feature-specific | Weed family facts and result behavior. |
| `app/farm-care-drilldown.css` | Migrate | Farm Care moves use shared card/state/Trail. |
| `app/tending.css` | Migrate | Collection arrangement stays; cards and Trail become shared. |
| `app/tending-calm.css` | Consolidate | Keep calm presentation through tokens/primitives. |
| `app/tending-next-bite.css` | Retain feature-specific | Current actionable bite remains Tending behavior. |
| `app/bed-crop-accordion.css` | Retain feature-specific | Bed crop disclosure behavior. |
| `app/venue-rooms.css` | Migrate | Room cards and readiness Trail use shared primitives. |

## CSS modules

| File | Classification | Universal target |
| --- | --- | --- |
| `components/atlas/portfolio/portfolio.module.css` | Migrate | Portfolio remains a lens; shell, card, badge, metrics, headings, and footer are no longer module-owned. |
| `components/atlas/portfolio/project.module.css` | Migrate | Project-specific content remains; shell and Trail become universal. |

## Build 1 boundary

Build 1 introduces and consumes the shared primitive components without changing the root membership fork or canonical data behavior. The remaining styles are intentionally left in place until each surface is migrated and visually verified.
