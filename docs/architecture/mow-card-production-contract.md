# Mow Card Production Contract

## Purpose

Move the approved owner Task Card Editor Mow design onto live Task Focus without copying fixture facts into production.

## Approved visual anatomy

The production card keeps the approved recurrence-first structure:

1. Mow family + route + place
2. recurrence trail: last mow / current mow / next mow
3. one mowing-height fact
4. equipment and required-resource branch
5. finish/result controls

The current specimen is visual reference only. Its U-Pick dates, Gas label, and two-battery label are fixtures, not production truth.

## Canonical data mapping

- route → mowing route growing object label
- place → canonical route zone
- last mow → `mowing_area_state.last_mowed_at`
- current mow → represented task due date / current rhythm occurrence
- next mow → only a canonical next-check/recurrence date; never client date arithmetic
- height → route/task canonical target cut height
- equipment → route/task canonical equipment group
- resource rows/status/reason → canonical task execution/readiness resource requirements and state consequences
- blocker → canonical execution warrant, including real prerequisite and repair state
- completion/results → existing governed `/api/atlas/mowing` structured result adapter
- owner directives → existing `MaintenanceDirectiveStrip`

## Current Elm acceptance examples

- U-Pick Walkways + Middle Lane must show the Riding mower branch and remain non-executable while the Cub Cadet resource is `needs_repair`; the physical reason remains visible as canonical state rather than becoming generic Waiting.
- Field Rows · Back Half must show the Battery-powered push mower branch, 3 in height, and preserve its true prerequisite gate. Unknown battery readiness is preparation/verification context and must not be fabricated as charged or broken.

## Interaction boundary

The approved compact `+` issue drawer will not be activated until it is wired to an existing governed resource-state/event mutation. Until that boundary is identified, production keeps the existing structured `Problem found` mowing result path rather than shipping decorative controls.

## Merge sequence for this branch

1. establish tested canonical Mow view model;
2. pre-resolve Mow readiness in the server loader so there is no checking interstitial;
3. port approved Mow layout/CSS around canonical data;
4. preserve the existing mowing result adapter and completion event;
5. verify blocked Riding mower and prerequisite-gated push-mow examples;
6. run full CI/build and preview before requesting production merge.
