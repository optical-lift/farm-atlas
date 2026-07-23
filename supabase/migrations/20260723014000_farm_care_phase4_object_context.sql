-- Phase 4: keep farm and zone identity on every object drill-down response.

create or replace function atlas.farm_care_object_card_v1(p_object_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to pg_catalog, atlas
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'farmId',o.farm_id,
    'zoneId',o.zone_id,
    'zoneKey',o.zone_key,
    'zoneLabel',o.zone_label,
    'zoneType',o.zone_type,
    'zoneMode',o.zone_mode,
    'zonePurpose',o.zone_purpose,
    'intendedFinish',o.intended_finish,
    'zoneVisibleToGuests',o.zone_visible_to_guests,
    'objectId',o.object_id,
    'objectKey',o.object_key,
    'objectLabel',o.object_label,
    'objectType',o.object_type,
    'objectMode',o.object_mode,
    'guestVisible',o.guest_visible,
    'careState',o.care_state,
    'careStateLabel',o.care_state_label,
    'careStrategy',o.care_strategy,
    'careStrategyLabel',o.care_strategy_label,
    'carePressure',o.care_pressure,
    'careTrend',o.care_trend,
    'careTrendLabel',o.care_trend_label,
    'careFreshness',o.care_freshness,
    'careConfidence',o.care_confidence,
    'observedAt',o.care_observed_at,
    'observationAgeDays',o.observation_age_days,
    'reviewOn',o.care_review_on,
    'estimatedEffortMinutes',o.care_estimated_recovery_minutes,
    'lastMeaningfullyTendedAt',o.last_meaningfully_tended_at,
    'lastStateTransitionAt',o.last_state_transition_at,
    'ordinaryWeedingAllowed',o.ordinary_weeding_allowed,
    'contents',o.current_contents,
    'activeCropCycles',o.active_crop_cycles,
    'riskLabels',to_jsonb(o.risk_labels),
    'productionSensitive',o.production_sensitive,
    'guestSensitive',o.guest_sensitive,
    'accessOrEstablishmentSensitive',o.access_or_establishment_sensitive,
    'spreadSensitive',o.spread_sensitive,
    'releasedInterventionCount',o.released_intervention_count,
    'releasedEffortMinutes',o.released_effort_minutes,
    'releasedInterventions',o.released_interventions,
    'plannedRecommendationCount',o.planned_recommendation_count,
    'plannedEffortMinutes',o.planned_effort_minutes,
    'plannedRecommendations',o.planned_recommendations,
    'now',o.now_summary,
    'desiredAfter',o.desired_after_summary,
    'doneDefinition',o.default_done_definition,
    'nextValidAction',o.next_valid_action,
    'evidence',jsonb_strip_nulls(jsonb_build_object(
      'sourceKind',o.care_source_kind,
      'strategySource',o.care_strategy_source,
      'reason',o.care_reason,
      'updatedAt',o.care_updated_at
    ))
  ))
  from atlas.farm_care_object_projection_v1 o
  where o.object_id=p_object_id
$function$;

comment on function atlas.farm_care_object_card_v1(uuid) is
  'Prepared Farm Care object card with parent farm/zone identity, physical state, contents, interventions, and completion language.';
