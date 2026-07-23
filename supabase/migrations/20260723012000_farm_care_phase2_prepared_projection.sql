-- Atlas Farm Care — Phase 2 prepared farm, zone, and object projections
-- One membership-scoped farm query plus focused zone/object drill-downs.
-- No client route should infer physical condition from tasks.

create or replace function atlas.care_state_rank_v1(p_state text)
returns integer
language sql
immutable
set search_path to pg_catalog, atlas
as $function$
  select case p_state
    when 'recovery_needed' then 90
    when 'losing_shape' then 80
    when 'needs_tending' then 70
    when 'stirring' then 60
    when 'decision_needed' then 55
    when 'unknown' then 50
    when 'suppressed' then 30
    when 'resting' then 20
    when 'settled' then 10
    else 0
  end
$function$;

create or replace function atlas.care_state_label_v1(p_state text)
returns text
language sql
immutable
set search_path to pg_catalog, atlas
as $function$
  select case p_state
    when 'settled' then 'Settled'
    when 'stirring' then 'Stirring'
    when 'needs_tending' then 'Needs tending'
    when 'losing_shape' then 'Losing shape'
    when 'recovery_needed' then 'Recovery needed'
    when 'resting' then 'Resting'
    when 'suppressed' then 'Suppressed'
    when 'decision_needed' then 'Decision needed'
    else 'Unknown'
  end
$function$;

create or replace function atlas.care_strategy_label_v1(p_strategy text)
returns text
language sql
immutable
set search_path to pg_catalog, atlas
as $function$
  select case p_strategy
    when 'active_hand_care' then 'Active hand care'
    when 'targeted_recovery' then 'Targeted recovery'
    when 'mow_and_hold' then 'Mow and hold'
    when 'suppressed_by_tarp' then 'Suppressed by tarp'
    when 'mulch_hold' then 'Mulch hold'
    when 'cover_crop_hold' then 'Cover crop hold'
    when 'resting_until_review' then 'Rest until review'
    when 'redesign_pending' then 'Redesign pending'
    when 'removal_pending' then 'Removal pending'
    else 'Strategy unknown'
  end
$function$;

create or replace function atlas.care_trend_label_v1(p_trend text)
returns text
language sql
immutable
set search_path to pg_catalog, atlas
as $function$
  select case p_trend
    when 'improving' then 'Improving'
    when 'stable' then 'Holding'
    when 'rising' then 'Rising'
    else 'Trend unknown'
  end
$function$;

create or replace view atlas.farm_care_released_intervention_v1
with (security_invoker=true)
as
with linked_objects as (
  select
    t.id as task_id,
    array_agg(distinct x.object_id order by x.object_id) filter (where x.object_id is not null) as object_ids
  from atlas.tasks t
  left join atlas.task_objects x on x.task_id=t.id
  group by t.id
),
maintenance_target as (
  select
    t.id as task_id,
    mo.object_id
  from atlas.tasks t
  join atlas.maintenance_objects mo
    on t.generated_from='maintenance_weeding_collection'
   and t.generated_from_id=mo.id
),
prepared as (
  select
    t.farm_id,
    t.id as task_id,
    t.zone_id,
    coalesce(lo.object_ids,
      case when mt.object_id is null then '{}'::uuid[] else array[mt.object_id] end
    ) as object_ids,
    t.title,
    t.status,
    t.due_date,
    t.assigned_membership_id,
    t.planned_occurrence_id,
    t.release_policy_id,
    t.released_at,
    t.release_reason,
    t.unlock_text,
    t.note,
    coalesce(
      case
        when jsonb_typeof(t.metadata->'estimated_minutes')='number'
          then (t.metadata->>'estimated_minutes')::integer
      end,
      case
        when t.metadata->>'effort_band'='light' then 15
        when t.metadata->>'effort_band'='moderate' then 30
        when t.metadata->>'effort_band'='heavy' then 60
      end
    ) as estimated_minutes,
    coalesce(
      nullif(t.metadata->>'display_action',''),
      initcap(replace(coalesce(t.action_key,t.work_class,t.task_type,'Care'),'_',' '))
    ) as action_label,
    coalesce(
      nullif(t.metadata->>'display_subject',''),
      nullif(t.metadata->>'collection_label',''),
      t.title
    ) as subject_label,
    coalesce(
      nullif(t.metadata->>'daily_weeding_lane',''),
      nullif(t.metadata->>'work_route',''),
      'care'
    ) as intervention_lane,
    case
      when jsonb_typeof(t.metadata->'priority_reasons')='array'
        then t.metadata->'priority_reasons'
      else '[]'::jsonb
    end as reason_lines,
    coalesce(
      nullif(t.metadata->>'desired_result',''),
      nullif(t.unlock_text,''),
      nullif(t.metadata->>'display_detail','')
    ) as desired_result,
    coalesce(
      nullif(t.metadata->>'done_definition',''),
      nullif(t.metadata->>'done_means','')
    ) as done_definition,
    t.metadata
  from atlas.tasks t
  left join linked_objects lo on lo.task_id=t.id
  left join maintenance_target mt on mt.task_id=t.id
  where t.status in ('open','blocked')
    and t.released_at is not null
    and t.planned_occurrence_id is not null
    and (
      t.generated_from='maintenance_weeding_collection'
      or coalesce(t.metadata->>'work_collection_key','')='weeding'
      or coalesce(t.metadata->>'maintenance_type','')='weed'
      or coalesce(t.metadata->>'work_route','') in ('weed','weed_and_sow','weed-whack')
      or t.action_key='weed'
      or t.work_class='weeding'
    )
)
select *
from prepared
where cardinality(object_ids)>0;

create or replace view atlas.farm_care_planned_intervention_v1
with (security_invoker=true)
as
select
  o.farm_id,
  o.id as occurrence_id,
  mo.zone_id,
  mo.object_id,
  o.title,
  o.planned_due_date,
  o.not_before_date,
  o.state,
  case
    when jsonb_typeof(o.task_payload->'metadata'->'estimated_minutes')='number'
      then (o.task_payload->'metadata'->>'estimated_minutes')::integer
    when jsonb_typeof(o.task_payload->'estimated_minutes')='number'
      then (o.task_payload->>'estimated_minutes')::integer
    else null
  end as estimated_minutes,
  coalesce(
    nullif(o.task_payload->>'unlock_text',''),
    nullif(o.task_payload->'metadata'->>'desired_result',''),
    nullif(o.task_payload->'metadata'->>'display_detail','')
  ) as desired_result,
  coalesce(
    nullif(o.task_payload->'metadata'->>'done_definition',''),
    nullif(o.task_payload->'metadata'->>'done_means','')
  ) as done_definition,
  'legacy_planned_occurrence'::text as recommendation_source,
  o.occurrence_key,
  o.metadata
from atlas.planned_work_occurrences o
join atlas.maintenance_objects mo
  on o.source_kind='maintenance_weeding_collection'
 and o.source_id=mo.id
where o.state in ('planned','eligible','failed','releasing')
  and o.released_at is null
  and mo.active;

create or replace view atlas.farm_care_object_projection_v1
with (security_invoker=true)
as
with maintenance as (
  select
    mo.object_id,
    bool_or(mo.crop_protective or mo.revenue_linked or mo.crop_loss_risk>0) as production_sensitive,
    bool_or(mo.guest_facing or mo.guest_visibility_score>0) as guest_sensitive,
    bool_or(mo.must_precede_task or mo.planting_block_score>0) as access_or_establishment_sensitive,
    bool_or(mo.weed_spread_risk>0) as spread_sensitive,
    max(mo.crop_loss_risk) as crop_loss_risk,
    max(mo.revenue_unlock_score) as revenue_unlock_score,
    max(mo.planting_block_score) as planting_block_score,
    max(mo.guest_visibility_score) as guest_visibility_score,
    max(mo.weed_spread_risk) as weed_spread_risk,
    max(mo.last_completed_at) as maintenance_last_completed_at
  from atlas.maintenance_objects mo
  where mo.active
  group by mo.object_id
),
contents as (
  select
    oc.object_id,
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'contentId',oc.id,
        'label',oc.content_label,
        'type',oc.content_type,
        'variety',oc.variety,
        'status',oc.status,
        'plantedDate',oc.planted_date,
        'confidence',oc.confidence,
        'startMethod',oc.start_method,
        'germinatedDate',oc.germinated_date,
        'bloomStartDate',oc.bloom_start_date,
        'expectedHarvestWatchStart',oc.expected_harvest_watch_start,
        'expectedClearDate',oc.expected_clear_date,
        'nextCropPlanned',oc.next_crop_planned
      ))
      order by oc.created_at,oc.id
    ) filter (where oc.status not in ('archived','abandoned','failed','absent')) as current_contents
  from atlas.object_contents oc
  group by oc.object_id
),
cycles as (
  select
    cc.object_id,
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'cropCycleId',cc.id,
        'cropCycleKey',cc.crop_cycle_key,
        'crop',cc.crop_label,
        'variety',cc.variety,
        'state',cc.cycle_state,
        'lifecycleStatus',cc.lifecycle_status,
        'sownDate',cc.sown_date,
        'plantedDate',cc.planted_date,
        'expectedHarvestWatchStart',cc.expected_harvest_watch_start,
        'expectedClearDate',cc.expected_clear_date
      ))
      order by coalesce(cc.planted_date,cc.sown_date,cc.created_at::date),cc.id
    ) filter (where cc.lifecycle_status in ('active','planned')) as active_crop_cycles
  from atlas.crop_cycles cc
  group by cc.object_id
),
last_care as (
  select object_id,max(completed_at) as last_meaningfully_tended_at
  from atlas.maintenance_history
  where outcome in ('fully_completed','partially_completed')
  group by object_id
),
last_transition as (
  select object_id,max(occurred_at) as last_state_transition_at
  from atlas.care_state_history
  group by object_id
),
released as (
  select
    target.object_id,
    count(*) as released_intervention_count,
    coalesce(sum(r.estimated_minutes),0)::integer as released_effort_minutes,
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'taskId',r.task_id,
        'title',r.title,
        'status',r.status,
        'dueDate',r.due_date,
        'estimatedMinutes',r.estimated_minutes,
        'action',r.action_label,
        'subject',r.subject_label,
        'lane',r.intervention_lane,
        'reasonLines',r.reason_lines,
        'desiredResult',r.desired_result,
        'doneDefinition',r.done_definition,
        'unlocks',r.unlock_text
      ))
      order by r.due_date nulls last,r.title
    ) as released_interventions
  from atlas.farm_care_released_intervention_v1 r
  cross join lateral unnest(r.object_ids) as target(object_id)
  group by target.object_id
),
planned as (
  select
    p.object_id,
    count(*) as planned_recommendation_count,
    coalesce(sum(p.estimated_minutes),0)::integer as planned_effort_minutes,
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'occurrenceId',p.occurrence_id,
        'title',p.title,
        'plannedDueDate',p.planned_due_date,
        'notBeforeDate',p.not_before_date,
        'state',p.state,
        'estimatedMinutes',p.estimated_minutes,
        'desiredResult',p.desired_result,
        'doneDefinition',p.done_definition,
        'source','legacy_planned_occurrence'
      ))
      order by p.planned_due_date nulls last,p.title
    ) as planned_recommendations
  from atlas.farm_care_planned_intervention_v1 p
  group by p.object_id
)
select
  s.farm_id,
  s.zone_id,
  s.zone_key,
  s.zone_label,
  z.zone_type,
  z.mode_bias as zone_mode,
  z.goal_text as zone_purpose,
  coalesce(z.metadata->>'finish_standard',z.goal_text) as intended_finish,
  z.visible_to_guests as zone_visible_to_guests,
  z.sort_order as zone_sort_order,
  s.object_id,
  s.object_key,
  s.object_label,
  s.object_type,
  go.object_mode,
  go.guest_visible,
  go.sort_order as object_sort_order,
  s.care_state,
  atlas.care_state_label_v1(s.care_state) as care_state_label,
  s.care_strategy,
  atlas.care_strategy_label_v1(s.care_strategy) as care_strategy_label,
  s.care_pressure,
  s.care_trend,
  atlas.care_trend_label_v1(s.care_trend) as care_trend_label,
  s.care_freshness,
  case s.care_freshness
    when 'observed' then 'high'
    when 'estimated' then 'medium'
    else 'low'
  end as care_confidence,
  s.care_observed_at,
  s.observation_age_days,
  s.care_review_on,
  s.care_estimated_recovery_minutes,
  s.care_source_kind,
  s.care_strategy_source,
  s.care_reason,
  s.ordinary_weeding_allowed,
  s.care_updated_at,
  coalesce(lc.last_meaningfully_tended_at,
           m.maintenance_last_completed_at,
           os.last_weeded_at::timestamptz) as last_meaningfully_tended_at,
  lt.last_state_transition_at,
  coalesce(c.current_contents,'[]'::jsonb) as current_contents,
  coalesce(cy.active_crop_cycles,'[]'::jsonb) as active_crop_cycles,
  coalesce(m.production_sensitive,false) as production_sensitive,
  coalesce(m.guest_sensitive,false) as guest_sensitive,
  coalesce(m.access_or_establishment_sensitive,false) as access_or_establishment_sensitive,
  coalesce(m.spread_sensitive,false) as spread_sensitive,
  coalesce(m.crop_loss_risk,0) as crop_loss_risk,
  coalesce(m.revenue_unlock_score,0) as revenue_unlock_score,
  coalesce(m.planting_block_score,0) as planting_block_score,
  coalesce(m.guest_visibility_score,0) as guest_visibility_score,
  coalesce(m.weed_spread_risk,0) as weed_spread_risk,
  array_remove(array[
    case when s.care_state in (
      'stirring','needs_tending','losing_shape','recovery_needed'
    ) and coalesce(m.production_sensitive,false) then 'production' end,
    case when s.care_state in (
      'stirring','needs_tending','losing_shape','recovery_needed'
    ) and coalesce(m.guest_sensitive,false) then 'presentation' end,
    case when s.care_state in (
      'stirring','needs_tending','losing_shape','recovery_needed'
    ) and coalesce(m.access_or_establishment_sensitive,false)
      then 'access_or_establishment' end,
    case when s.care_state in (
      'stirring','needs_tending','losing_shape','recovery_needed'
    ) and coalesce(m.spread_sensitive,false) then 'spread' end
  ],null) as risk_labels,
  coalesce(r.released_intervention_count,0) as released_intervention_count,
  coalesce(r.released_effort_minutes,0) as released_effort_minutes,
  coalesce(r.released_interventions,'[]'::jsonb) as released_interventions,
  coalesce(p.planned_recommendation_count,0) as planned_recommendation_count,
  coalesce(p.planned_effort_minutes,0) as planned_effort_minutes,
  coalesce(p.planned_recommendations,'[]'::jsonb) as planned_recommendations,
  case s.care_state
    when 'settled' then 'This place is readable and its current care strategy is holding.'
    when 'stirring' then 'New pressure is beginning, but the place has not lost its intended shape or function.'
    when 'needs_tending' then 'Timely care would prevent this place from escalating.'
    when 'losing_shape' then 'The intended planting, edge, path, or finish is becoming unreadable.'
    when 'recovery_needed' then 'This place needs a deliberate reset to return to its intended state.'
    when 'resting' then 'This place is intentionally resting until its next review.'
    when 'suppressed' then 'Pressure is being held through its current suppression strategy.'
    when 'decision_needed' then 'A manager needs to choose the future care mode or finish standard.'
    else 'Current facts are not strong enough to claim how this place is holding.'
  end as now_summary,
  coalesce(
    nullif((r.released_interventions->0)->>'desiredResult',''),
    nullif((p.planned_recommendations->0)->>'desiredResult',''),
    case s.care_state
      when 'settled' then 'Keep the place readable without creating recovery work.'
      when 'stirring' then 'Interrupt young pressure while the intended planting remains readable.'
      when 'needs_tending' then 'Return the place to a settled state with a modest tending pass.'
      when 'losing_shape' then 'Make the intended planting, edge, path, or function readable again.'
      when 'recovery_needed' then 'Restore the place to its intended physical state.'
      when 'resting' then 'Preserve the resting strategy until the recorded review date.'
      when 'suppressed' then 'Keep pressure controlled through the named holding strategy.'
      when 'decision_needed' then 'Choose and record the next management strategy.'
      else 'Observe the place before prescribing physical work.'
    end
  ) as desired_after_summary,
  coalesce(
    nullif((r.released_interventions->0)->>'doneDefinition',''),
    nullif((p.planned_recommendations->0)->>'doneDefinition',''),
    case s.care_state
      when 'settled' then 'The intended plants, edges, paths, or access remain readable and protected.'
      when 'stirring' then 'Young pressure is interrupted without disturbing intended plants.'
      when 'needs_tending' then 'Material competition is removed and the place reads as intentional again.'
      when 'losing_shape' then 'The intended plants and boundaries are readable; uncertain plants are left for review.'
      when 'recovery_needed' then 'Dominant pressure is removed, the intended shape is restored, and remaining uncertainty is recorded.'
      when 'resting' then 'No ordinary hand-weeding work is created before the next review.'
      when 'suppressed' then 'The holding method remains intact and prevents material spread or access loss.'
      when 'decision_needed' then 'A manager records the chosen mode, strategy, reason, and review date.'
      else 'A current observation records pressure, readability, protected function, and estimated effort.'
    end
  ) as default_done_definition,
  coalesce(
    nullif((r.released_interventions->0)->>'title',''),
    nullif((p.planned_recommendations->0)->>'title',''),
    case s.care_state
      when 'settled' then 'No recovery intervention is currently indicated.'
      when 'resting' then concat('Review the resting strategy',case when s.care_review_on is not null then ' on '||s.care_review_on::text else '' end,'.')
      when 'suppressed' then 'Maintain the named suppression strategy; do not create generic hand-weeding work.'
      when 'decision_needed' then 'Record a management decision before assigning physical care.'
      when 'unknown' then 'Record a current care observation.'
      else 'Prepare the appropriate care intervention from the current observation.'
    end
  ) as next_valid_action
from atlas.farm_care_object_state_v1 s
join atlas.growing_objects go on go.id=s.object_id
join atlas.object_state os on os.object_id=s.object_id
left join atlas.zones z on z.id=s.zone_id
left join maintenance m on m.object_id=s.object_id
left join contents c on c.object_id=s.object_id
left join cycles cy on cy.object_id=s.object_id
left join last_care lc on lc.object_id=s.object_id
left join last_transition lt on lt.object_id=s.object_id
left join released r on r.object_id=s.object_id
left join planned p on p.object_id=s.object_id;

create or replace function atlas.farm_care_object_card_v1(p_object_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to pg_catalog, atlas
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
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

create or replace function atlas.farm_care_zone_card_v1(p_zone_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to pg_catalog, atlas
as $function$
with objects as (
  select *
  from atlas.farm_care_object_projection_v1
  where zone_id=p_zone_id
),
counts as (
  select
    count(*)::integer as object_count,
    count(*) filter (where care_state='settled')::integer as settled_count,
    count(*) filter (where care_state='stirring')::integer as stirring_count,
    count(*) filter (where care_state='needs_tending')::integer as needs_tending_count,
    count(*) filter (where care_state='losing_shape')::integer as losing_shape_count,
    count(*) filter (where care_state='recovery_needed')::integer as recovery_needed_count,
    count(*) filter (where care_state='resting')::integer as resting_count,
    count(*) filter (where care_state='suppressed')::integer as suppressed_count,
    count(*) filter (where care_state='decision_needed')::integer as decision_needed_count,
    count(*) filter (where care_state='unknown')::integer as unknown_count,
    count(*) filter (where care_freshness='stale')::integer as stale_count,
    count(*) filter (where care_freshness in ('unknown','stale'))::integer as observation_gap_count,
    count(*) filter (where care_freshness in ('observed','estimated'))::integer as reliable_observation_count,
    coalesce(sum(care_estimated_recovery_minutes) filter (
      where care_state in ('stirring','needs_tending','losing_shape','recovery_needed')
    ),0)::integer as estimated_care_minutes,
    coalesce(sum(care_estimated_recovery_minutes) filter (
      where care_state in ('losing_shape','recovery_needed')
    ),0)::integer as estimated_recovery_minutes,
    count(*) filter (where production_sensitive and care_state in (
      'stirring','needs_tending','losing_shape','recovery_needed'
    ))::integer as production_concern_count,
    count(*) filter (where guest_sensitive and care_state in (
      'stirring','needs_tending','losing_shape','recovery_needed'
    ))::integer as presentation_concern_count,
    count(*) filter (where access_or_establishment_sensitive and care_state in (
      'stirring','needs_tending','losing_shape','recovery_needed'
    ))::integer as access_or_establishment_concern_count,
    count(*) filter (where spread_sensitive and care_state in (
      'stirring','needs_tending','losing_shape','recovery_needed'
    ))::integer as spread_concern_count,
    min(care_observed_at) filter (where care_freshness in ('observed','estimated')) as oldest_reliable_observation,
    sum(released_intervention_count)::integer as released_intervention_count,
    sum(planned_recommendation_count)::integer as planned_recommendation_count
  from objects
),
dominant as (
  select o.*
  from objects o
  order by atlas.care_state_rank_v1(o.care_state) desc,
           coalesce(o.care_estimated_recovery_minutes,0) desc,
           o.object_sort_order,o.object_label
  limit 1
),
strategies as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'strategy',x.care_strategy,
    'label',atlas.care_strategy_label_v1(x.care_strategy),
    'objectCount',x.object_count
  ) order by x.object_count desc,x.care_strategy),'[]'::jsonb) as strategy_summary
  from (
    select care_strategy,count(*)::integer as object_count
    from objects
    group by care_strategy
  ) x
),
trend as (
  select case
    when count(*) filter (where care_trend='rising')>0 then 'rising'
    when count(*) filter (where care_trend='improving')>0 then 'improving'
    when count(*) filter (where care_trend='stable')>0 then 'stable'
    else 'unknown'
  end as zone_trend
  from objects
),
zone_record as (
  select z.*
  from atlas.zones z
  where z.id=p_zone_id
)
select jsonb_strip_nulls(jsonb_build_object(
  'zoneId',z.id,
  'zoneKey',z.stable_key,
  'zoneLabel',z.label,
  'zoneType',z.zone_type,
  'zoneMode',z.mode_bias,
  'purpose',z.goal_text,
  'intendedFinish',coalesce(z.metadata->>'finish_standard',z.goal_text),
  'visibleToGuests',z.visible_to_guests,
  'sortOrder',z.sort_order,
  'careState',d.care_state,
  'careStateLabel',atlas.care_state_label_v1(d.care_state),
  'careTrend',t.zone_trend,
  'careTrendLabel',atlas.care_trend_label_v1(t.zone_trend),
  'objectCount',c.object_count,
  'stateCounts',jsonb_build_object(
    'settled',c.settled_count,
    'stirring',c.stirring_count,
    'needsTending',c.needs_tending_count,
    'losingShape',c.losing_shape_count,
    'recoveryNeeded',c.recovery_needed_count,
    'resting',c.resting_count,
    'suppressed',c.suppressed_count,
    'decisionNeeded',c.decision_needed_count,
    'unknown',c.unknown_count
  ),
  'observationCoverage',jsonb_build_object(
    'reliable',c.reliable_observation_count,
    'stale',c.stale_count,
    'unknownOrStale',c.observation_gap_count,
    'oldestReliableObservation',c.oldest_reliable_observation
  ),
  'estimatedCareMinutes',c.estimated_care_minutes,
  'estimatedRecoveryMinutes',c.estimated_recovery_minutes,
  'risks',jsonb_build_object(
    'production',c.production_concern_count,
    'presentation',c.presentation_concern_count,
    'accessOrEstablishment',c.access_or_establishment_concern_count,
    'spread',c.spread_concern_count
  ),
  'highestConcernObject',case when d.object_id is null then null else jsonb_build_object(
    'objectId',d.object_id,
    'objectKey',d.object_key,
    'objectLabel',d.object_label,
    'careState',d.care_state,
    'careStateLabel',d.care_state_label,
    'estimatedEffortMinutes',d.care_estimated_recovery_minutes,
    'nextValidAction',d.next_valid_action
  ) end,
  'strategySummary',s.strategy_summary,
  'releasedInterventionCount',c.released_intervention_count,
  'plannedRecommendationCount',c.planned_recommendation_count,
  'decisionRequired',c.decision_needed_count>0,
  'nextMove',d.next_valid_action
))
from zone_record z
cross join counts c
left join dominant d on true
cross join strategies s
cross join trend t
$function$;

create or replace function atlas.farm_care_summary_v1(
  p_farm_id uuid,
  p_history_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_history_days integer := least(greatest(coalesce(p_history_days,30),1),180);
  v_result jsonb;
begin
  if not atlas.can_read_farm_operations(p_farm_id) then
    raise exception 'Active farm membership is required.'
      using errcode='42501';
  end if;

  with objects as (
    select *
    from atlas.farm_care_object_projection_v1
    where farm_id=p_farm_id
  ),
  farm_record as (
    select id,stable_key,name,status
    from atlas.farms
    where id=p_farm_id
  ),
  counts as (
    select
      count(*)::integer as object_count,
      count(*) filter (where care_state='settled')::integer as settled_count,
      count(*) filter (where care_state='stirring')::integer as stirring_count,
      count(*) filter (where care_state='needs_tending')::integer as needs_tending_count,
      count(*) filter (where care_state='losing_shape')::integer as losing_shape_count,
      count(*) filter (where care_state='recovery_needed')::integer as recovery_needed_count,
      count(*) filter (where care_state='resting')::integer as resting_count,
      count(*) filter (where care_state='suppressed')::integer as suppressed_count,
      count(*) filter (where care_state='decision_needed')::integer as decision_needed_count,
      count(*) filter (where care_state='unknown')::integer as unknown_count,
      count(*) filter (where care_freshness='observed')::integer as observed_count,
      count(*) filter (where care_freshness='estimated')::integer as estimated_count,
      count(*) filter (where care_freshness='stale')::integer as stale_count,
      count(*) filter (where care_freshness='unknown')::integer as unknown_freshness_count,
      coalesce(sum(care_estimated_recovery_minutes) filter (
        where care_state in ('stirring','needs_tending')
      ),0)::integer as tending_minutes,
      coalesce(sum(care_estimated_recovery_minutes) filter (
        where care_state in ('losing_shape','recovery_needed')
      ),0)::integer as recovery_minutes,
      count(*) filter (where production_sensitive and care_state in (
        'stirring','needs_tending','losing_shape','recovery_needed'
      ))::integer as production_concern_count,
      count(*) filter (where guest_sensitive and care_state in (
        'stirring','needs_tending','losing_shape','recovery_needed'
      ))::integer as guest_concern_count,
      count(*) filter (where access_or_establishment_sensitive and care_state in (
        'stirring','needs_tending','losing_shape','recovery_needed'
      ))::integer as access_or_establishment_concern_count,
      count(*) filter (where spread_sensitive and care_state in (
        'stirring','needs_tending','losing_shape','recovery_needed'
      ))::integer as spread_concern_count,
      sum(released_intervention_count)::integer as released_intervention_count,
      sum(planned_recommendation_count)::integer as planned_recommendation_object_links
    from objects
  ),
  zones as (
    select
      coalesce(jsonb_agg(atlas.farm_care_zone_card_v1(z.id)
        order by z.sort_order,z.label),'[]'::jsonb) as cards,
      count(*)::integer as zone_count
    from atlas.zones z
    where z.farm_id=p_farm_id
      and exists(select 1 from objects o where o.zone_id=z.id)
  ),
  zone_trends as (
    select
      count(*) filter (where card->>'careTrend'='improving')::integer as improving,
      count(*) filter (where card->>'careTrend'='stable')::integer as holding,
      count(*) filter (where card->>'careTrend'='rising')::integer as rising,
      count(*) filter (where card->>'careTrend'='unknown')::integer as unknown,
      count(*) filter (where card->>'careState' in ('recovery_needed','losing_shape'))::integer as recovery_zones
    from (
      select atlas.farm_care_zone_card_v1(z.id) as card
      from atlas.zones z
      where z.farm_id=p_farm_id
        and exists(select 1 from objects o where o.zone_id=z.id)
    ) x
  ),
  released as (
    select
      count(*)::integer as task_count,
      coalesce(sum(r.estimated_minutes),0)::integer as estimated_minutes,
      coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'taskId',r.task_id,
        'zoneId',r.zone_id,
        'zoneKey',z.stable_key,
        'zoneLabel',z.label,
        'objectIds',to_jsonb(r.object_ids),
        'objectTargets',coalesce(targets.cards,'[]'::jsonb),
        'title',r.title,
        'status',r.status,
        'dueDate',r.due_date,
        'assignedMembershipId',r.assigned_membership_id,
        'estimatedMinutes',r.estimated_minutes,
        'action',r.action_label,
        'subject',r.subject_label,
        'lane',r.intervention_lane,
        'reasonLines',r.reason_lines,
        'desiredResult',r.desired_result,
        'doneDefinition',r.done_definition,
        'unlocks',r.unlock_text,
        'releaseReason',r.release_reason
      )) order by r.due_date nulls last,z.sort_order,r.title),'[]'::jsonb) as cards
    from atlas.farm_care_released_intervention_v1 r
    left join atlas.zones z on z.id=r.zone_id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'objectId',o.object_id,
        'objectKey',o.object_key,
        'objectLabel',o.object_label,
        'careState',o.care_state,
        'careStateLabel',o.care_state_label
      ) order by o.object_sort_order,o.object_label) as cards
      from atlas.farm_care_object_projection_v1 o
      where o.object_id=any(r.object_ids)
    ) targets on true
    where r.farm_id=p_farm_id
  ),
  planned as (
    select count(*)::integer as occurrence_count,
           coalesce(sum(estimated_minutes),0)::integer as estimated_minutes
    from atlas.farm_care_planned_intervention_v1
    where farm_id=p_farm_id
  ),
  recent_wins as (
    select coalesce(jsonb_agg(x.card order by x.occurred_at desc),'[]'::jsonb) as cards
    from (
      select
        h.occurred_at,
        jsonb_strip_nulls(jsonb_build_object(
          'historyId',h.id,
          'occurredAt',h.occurred_at,
          'zoneId',h.zone_id,
          'zoneKey',z.stable_key,
          'zoneLabel',z.label,
          'objectId',h.object_id,
          'objectKey',go.stable_key,
          'objectLabel',go.label,
          'previousState',h.previous_state,
          'previousStateLabel',atlas.care_state_label_v1(h.previous_state),
          'resultingState',h.resulting_state,
          'resultingStateLabel',atlas.care_state_label_v1(h.resulting_state),
          'sourceKind',h.source_kind,
          'reason',h.reason
        )) as card
      from atlas.care_state_history h
      join atlas.growing_objects go on go.id=h.object_id
      left join atlas.zones z on z.id=h.zone_id
      where h.farm_id=p_farm_id
        and h.occurred_at>=now()-make_interval(days=>v_history_days)
        and h.previous_state in ('recovery_needed','losing_shape','needs_tending','stirring')
        and h.resulting_state in ('settled','needs_tending','stirring')
        and atlas.care_state_rank_v1(h.resulting_state)<atlas.care_state_rank_v1(h.previous_state)
      order by h.occurred_at desc
      limit 20
    ) x
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','farm_care_phase2_v1',
    'farm',jsonb_build_object(
      'farmId',f.id,
      'farmKey',f.stable_key,
      'farmName',f.name,
      'status',f.status
    ),
    'generatedAt',now(),
    'summarySentence',case
      when c.object_count=0 then f.name||' has no active maintainable objects.'
      when c.recovery_needed_count+c.losing_shape_count>0 then
        f.name||' has '||(c.recovery_needed_count+c.losing_shape_count)::text||
        ' place'||case when c.recovery_needed_count+c.losing_shape_count=1 then '' else 's' end||
        ' needing recovery or clearer shape, with '||c.unknown_count::text||' still needing observation.'
      when c.unknown_count>0 then
        f.name||' has no verified recovery area, but '||c.unknown_count::text||
        ' place'||case when c.unknown_count=1 then '' else 's' end||' still need current observation.'
      else f.name||' is holding without a verified recovery area.'
    end,
    'objectCount',c.object_count,
    'zoneCount',zs.zone_count,
    'stateCounts',jsonb_build_object(
      'settled',c.settled_count,
      'stirring',c.stirring_count,
      'needsTending',c.needs_tending_count,
      'losingShape',c.losing_shape_count,
      'recoveryNeeded',c.recovery_needed_count,
      'resting',c.resting_count,
      'suppressed',c.suppressed_count,
      'decisionNeeded',c.decision_needed_count,
      'unknown',c.unknown_count
    ),
    'statePercentages',jsonb_build_object(
      'settled',round(100.0*c.settled_count/nullif(c.object_count,0),1),
      'stirring',round(100.0*c.stirring_count/nullif(c.object_count,0),1),
      'needsTending',round(100.0*c.needs_tending_count/nullif(c.object_count,0),1),
      'losingShape',round(100.0*c.losing_shape_count/nullif(c.object_count,0),1),
      'recoveryNeeded',round(100.0*c.recovery_needed_count/nullif(c.object_count,0),1),
      'resting',round(100.0*c.resting_count/nullif(c.object_count,0),1),
      'suppressed',round(100.0*c.suppressed_count/nullif(c.object_count,0),1),
      'decisionNeeded',round(100.0*c.decision_needed_count/nullif(c.object_count,0),1),
      'unknown',round(100.0*c.unknown_count/nullif(c.object_count,0),1)
    ),
    'zoneTrends',jsonb_build_object(
      'improving',zt.improving,
      'holding',zt.holding,
      'rising',zt.rising,
      'unknown',zt.unknown,
      'recoveryZones',zt.recovery_zones
    ),
    'observationCoverage',jsonb_build_object(
      'observed',c.observed_count,
      'estimated',c.estimated_count,
      'stale',c.stale_count,
      'unknown',c.unknown_freshness_count,
      'needsObservation',c.stale_count+c.unknown_freshness_count,
      'coveredPercent',round(100.0*(c.observed_count+c.estimated_count)/nullif(c.object_count,0),1)
    ),
    'effort',jsonb_build_object(
      'tendingMinutes',c.tending_minutes,
      'recoveryMinutes',c.recovery_minutes,
      'knownCareMinutes',c.tending_minutes+c.recovery_minutes,
      'releasedMinutes',r.estimated_minutes,
      'plannedMinutes',p.estimated_minutes
    ),
    'concerns',jsonb_build_object(
      'production',c.production_concern_count,
      'guestPresentation',c.guest_concern_count,
      'accessOrEstablishment',c.access_or_establishment_concern_count,
      'spread',c.spread_concern_count,
      'resting',c.resting_count,
      'suppressed',c.suppressed_count,
      'decisionNeeded',c.decision_needed_count
    ),
    'releasedInterventionCount',r.task_count,
    'releasedInterventions',r.cards,
    'plannedRecommendationCount',p.occurrence_count,
    'plannedRecommendationSource','legacy_planned_occurrence',
    'recentWins',rw.cards,
    'zones',zs.cards
  )) into v_result
  from farm_record f
  cross join counts c
  cross join zones zs
  cross join zone_trends zt
  cross join released r
  cross join planned p
  cross join recent_wins rw;

  if v_result is null then
    raise exception 'Farm % was not found.',p_farm_id using errcode='P0002';
  end if;

  return v_result;
end
$function$;

create or replace function atlas.farm_care_zone_v1(
  p_farm_id uuid,
  p_zone_key text,
  p_history_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_zone atlas.zones%rowtype;
  v_limit integer := least(greatest(coalesce(p_history_limit,20),1),100);
  v_result jsonb;
begin
  if not atlas.can_read_farm_operations(p_farm_id) then
    raise exception 'Active farm membership is required.'
      using errcode='42501';
  end if;

  select * into v_zone
  from atlas.zones
  where farm_id=p_farm_id
    and stable_key=p_zone_key;

  if not found then
    raise exception 'Zone % was not found for farm %.',p_zone_key,p_farm_id
      using errcode='P0002';
  end if;

  with objects as (
    select *
    from atlas.farm_care_object_projection_v1
    where farm_id=p_farm_id
      and zone_id=v_zone.id
  ),
  object_groups as (
    select coalesce(jsonb_object_agg(x.care_state,x.cards),'{}'::jsonb) as groups
    from (
      select
        care_state,
        jsonb_agg(atlas.farm_care_object_card_v1(object_id)
          order by object_sort_order,object_label) as cards
      from objects
      group by care_state
    ) x
  ),
  released as (
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'taskId',r.task_id,
      'title',r.title,
      'status',r.status,
      'dueDate',r.due_date,
      'objectIds',to_jsonb(r.object_ids),
      'estimatedMinutes',r.estimated_minutes,
      'action',r.action_label,
      'subject',r.subject_label,
      'lane',r.intervention_lane,
      'reasonLines',r.reason_lines,
      'desiredResult',r.desired_result,
      'doneDefinition',r.done_definition,
      'unlocks',r.unlock_text
    )) order by r.due_date nulls last,r.title),'[]'::jsonb) as cards
    from atlas.farm_care_released_intervention_v1 r
    where r.farm_id=p_farm_id
      and r.zone_id=v_zone.id
  ),
  planned as (
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'occurrenceId',p.occurrence_id,
      'objectId',p.object_id,
      'title',p.title,
      'plannedDueDate',p.planned_due_date,
      'notBeforeDate',p.not_before_date,
      'state',p.state,
      'estimatedMinutes',p.estimated_minutes,
      'desiredResult',p.desired_result,
      'doneDefinition',p.done_definition,
      'source','legacy_planned_occurrence'
    )) order by p.planned_due_date nulls last,p.title),'[]'::jsonb) as cards
    from atlas.farm_care_planned_intervention_v1 p
    where p.farm_id=p_farm_id
      and p.zone_id=v_zone.id
  ),
  history as (
    select coalesce(jsonb_agg(x.card order by x.occurred_at desc),'[]'::jsonb) as cards
    from (
      select
        h.occurred_at,
        jsonb_strip_nulls(jsonb_build_object(
          'historyId',h.id,
          'occurredAt',h.occurred_at,
          'objectId',h.object_id,
          'objectKey',go.stable_key,
          'objectLabel',go.label,
          'previousState',h.previous_state,
          'previousStateLabel',atlas.care_state_label_v1(h.previous_state),
          'resultingState',h.resulting_state,
          'resultingStateLabel',atlas.care_state_label_v1(h.resulting_state),
          'sourceKind',h.source_kind,
          'reason',h.reason
        )) as card
      from atlas.care_state_history h
      join atlas.growing_objects go on go.id=h.object_id
      where h.farm_id=p_farm_id
        and h.zone_id=v_zone.id
      order by h.occurred_at desc
      limit v_limit
    ) x
  )
  select atlas.farm_care_zone_card_v1(v_zone.id)
    || jsonb_build_object(
      'objectGroups',og.groups,
      'releasedInterventions',r.cards,
      'plannedRecommendations',p.cards,
      'history',h.cards
    )
  into v_result
  from object_groups og
  cross join released r
  cross join planned p
  cross join history h;

  return coalesce(v_result,atlas.farm_care_zone_card_v1(v_zone.id));
end
$function$;

create or replace function atlas.farm_care_object_v1(
  p_farm_id uuid,
  p_object_key text,
  p_history_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_object atlas.growing_objects%rowtype;
  v_limit integer := least(greatest(coalesce(p_history_limit,20),1),100);
  v_result jsonb;
begin
  if not atlas.can_read_farm_operations(p_farm_id) then
    raise exception 'Active farm membership is required.'
      using errcode='42501';
  end if;

  select * into v_object
  from atlas.growing_objects go
  where go.farm_id=p_farm_id
    and go.stable_key=p_object_key
    and exists(
      select 1
      from atlas.maintenance_objects mo
      where mo.object_id=go.id
        and mo.active
    );

  if not found then
    raise exception 'Maintainable object % was not found for farm %.',
      p_object_key,p_farm_id
      using errcode='P0002';
  end if;

  with latest_observation as (
    select jsonb_strip_nulls(jsonb_build_object(
      'observationId',o.id,
      'observedAt',o.observed_at,
      'pressure',o.pressure_band,
      'intendedShapeReadable',o.intended_shape_readable,
      'functionProtected',o.function_protected,
      'recoveryRequired',o.recovery_required,
      'estimatedEffortMinutes',o.estimated_recovery_minutes,
      'note',o.note,
      'sourceKind',o.source_kind
    )) as observation
    from atlas.care_observations o
    where o.farm_id=p_farm_id
      and o.object_id=v_object.id
    order by o.observed_at desc,o.id desc
    limit 1
  ),
  history as (
    select coalesce(jsonb_agg(x.card order by x.occurred_at desc),'[]'::jsonb) as events
    from (
      select
        h.occurred_at,
        jsonb_strip_nulls(jsonb_build_object(
          'historyId',h.id,
          'occurredAt',h.occurred_at,
          'previousState',h.previous_state,
          'previousStateLabel',atlas.care_state_label_v1(h.previous_state),
          'resultingState',h.resulting_state,
          'resultingStateLabel',atlas.care_state_label_v1(h.resulting_state),
          'previousStrategy',h.previous_strategy,
          'previousStrategyLabel',atlas.care_strategy_label_v1(h.previous_strategy),
          'resultingStrategy',h.resulting_strategy,
          'resultingStrategyLabel',atlas.care_strategy_label_v1(h.resulting_strategy),
          'previousPressure',h.previous_pressure,
          'resultingPressure',h.resulting_pressure,
          'previousTrend',h.previous_trend,
          'resultingTrend',h.resulting_trend,
          'sourceKind',h.source_kind,
          'reason',h.reason
        )) as card
      from atlas.care_state_history h
      where h.farm_id=p_farm_id
        and h.object_id=v_object.id
      order by h.occurred_at desc
      limit v_limit
    ) x
  ),
  results as (
    select coalesce(jsonb_agg(x.card order by x.completed_at desc),'[]'::jsonb) as events
    from (
      select
        mh.completed_at,
        jsonb_strip_nulls(jsonb_build_object(
          'maintenanceHistoryId',mh.id,
          'completedAt',mh.completed_at,
          'outcome',mh.outcome,
          'conditionBefore',mh.condition_before,
          'conditionAfter',mh.condition_after,
          'estimatedMinutesBefore',mh.estimated_minutes_before,
          'actualMinutes',mh.actual_minutes,
          'remainingMinutesAfter',mh.remaining_minutes_after,
          'sourceTaskId',mh.source_task_id,
          'note',mh.note
        )) as card
      from atlas.maintenance_history mh
      where mh.farm_id=p_farm_id
        and mh.object_id=v_object.id
      order by mh.completed_at desc
      limit v_limit
    ) x
  )
  select
    atlas.farm_care_object_card_v1(v_object.id)
    || jsonb_build_object(
      'latestObservation',(select observation from latest_observation),
      'history',(select events from history),
      'results',(select events from results)
    )
  into v_result;

  return v_result;
end
$function$;

comment on view atlas.farm_care_object_projection_v1 is
  'Phase 2 prepared object answer layer: identity, contents, state, risk, effort, interventions, completion language, and next valid action.';
comment on view atlas.farm_care_released_intervention_v1 is
  'Released executable care work grouped for Farm Care presentation; never a source of physical condition.';
comment on view atlas.farm_care_planned_intervention_v1 is
  'Legacy planned maintenance occurrences exposed honestly until the Phase 5 intervention engine replaces them.';
comment on function atlas.farm_care_summary_v1(uuid,integer) is
  'One membership-scoped Farm Care home query with reconciled farm totals, zone cards, interventions, coverage, effort, and recent wins.';
comment on function atlas.farm_care_zone_v1(uuid,text,integer) is
  'One membership-scoped zone drill-down query with object groups, interventions, and bounded history.';
comment on function atlas.farm_care_object_v1(uuid,text,integer) is
  'One membership-scoped object drill-down query with contents, state, strategy, evidence, interventions, and bounded history.';

revoke all on atlas.farm_care_released_intervention_v1 from public,anon,authenticated;
revoke all on atlas.farm_care_planned_intervention_v1 from public,anon,authenticated;
revoke all on atlas.farm_care_object_projection_v1 from public,anon,authenticated;

revoke all on function atlas.care_state_rank_v1(text) from public;
revoke all on function atlas.care_state_label_v1(text) from public;
revoke all on function atlas.care_strategy_label_v1(text) from public;
revoke all on function atlas.care_trend_label_v1(text) from public;
revoke all on function atlas.farm_care_object_card_v1(uuid) from public;
revoke all on function atlas.farm_care_zone_card_v1(uuid) from public;
revoke all on function atlas.farm_care_summary_v1(uuid,integer) from public;
revoke all on function atlas.farm_care_zone_v1(uuid,text,integer) from public;
revoke all on function atlas.farm_care_object_v1(uuid,text,integer) from public;

grant execute on function atlas.farm_care_summary_v1(uuid,integer) to authenticated;
grant execute on function atlas.farm_care_zone_v1(uuid,text,integer) to authenticated;
grant execute on function atlas.farm_care_object_v1(uuid,text,integer) to authenticated;
