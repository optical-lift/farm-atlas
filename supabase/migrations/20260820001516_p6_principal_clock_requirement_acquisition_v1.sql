-- P6 — Clock integration for requirement-derived Owner truth acquisition.
-- The Principal Clock consumes the existing acquisition carrier directly.
-- No duplicate owner_obligation or operational_escalation row is created.

create or replace view atlas.principal_requirement_acquisition_clock_candidates_v1
with (security_invoker = false)
as
select
  pu.owner_id as principal_id,
  'operations'::text as domain,
  'requirement_truth_acquisition'::text as source_type,
  t.id as source_id,
  t.title,
  (case
    when lower(coalesce(t.metadata->>'inherited_urgency','false')) in ('true','yes','1') then 3
    else 6
  end)::smallint as floor_class,
  case
    when req.requirement_onset_date is not null
      then (req.requirement_onset_date::timestamp at time zone coalesce(nullif(pr.home_timezone,''),'America/Chicago'))
    when req.requirement_known_active_by is not null
      then (req.requirement_known_active_by::timestamp at time zone coalesce(nullif(pr.home_timezone,''),'America/Chicago'))
    else acq.released_at
  end as window_start,
  case
    when t.commitment_kind='hard_date' and t.due_date is not null
      then (((t.due_date + 1)::timestamp at time zone coalesce(nullif(pr.home_timezone,''),'America/Chicago')) - interval '1 microsecond')
    else null::timestamptz
  end as window_end,
  null::timestamptz as fixed_start,
  null::timestamptz as must_begin_by,
  case
    when t.commitment_kind='hard_date' and t.due_date is not null
      then (((t.due_date + 1)::timestamp at time zone coalesce(nullif(pr.home_timezone,''),'America/Chicago')) - interval '1 microsecond')
    else null::timestamptz
  end as must_finish_by,
  greatest(coalesce(nullif(capacity.expected_active_minutes,0),15),1)::integer as expected_minutes,
  case
    when lower(coalesce(t.metadata->>'inherited_urgency','false')) in ('true','yes','1') then 'protected'
    else 'standard'
  end::text as protection_level,
  coalesce(nullif(t.metadata->>'principal_interruptibility',''),'low_interruptibility')::text as interruptibility,
  false as delegable,
  true as owner_required,
  coalesce(
    nullif(t.metadata->>'principal_consequence_of_delay',''),
    'The source requirement continues aging while this truth or decision gap remains unresolved.'
  )::text as consequence,
  coalesce(
    nullif(t.metadata->>'principal_reason_for_floor',''),
    'Owner truth acquisition is causally required to unlock an active source requirement.'
  )::text as reason_for_floor,
  pu.id as portfolio_unit_id,
  pu.horizon,
  coalesce(t.metadata,'{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
    'clockCandidateContract','principal_requirement_acquisition_clock_v1',
    'clockCandidateRole','gap_resolution',
    'truthAcquisitionInstanceId',acq.id,
    'sourceRequirementInstanceId',req.id,
    'sourceRequirementAction',req.action_key,
    'requirementOnsetDate',req.requirement_onset_date,
    'requirementKnownActiveBy',req.requirement_known_active_by,
    'requirementTimeClass',req.requirement_time_class,
    'requirementReleasedAt',req.released_at,
    'truthAcquisitionReleasedAt',acq.released_at,
    'carrierTaskId',t.id,
    'carrierTaskDueDate',t.due_date,
    'assignedOwnerMembershipId',t.assigned_membership_id,
    'clockRelevanceTimeSource',case
      when req.requirement_onset_date is not null then 'requirement_onset_date'
      when req.requirement_known_active_by is not null then 'requirement_known_active_by'
      else 'truth_acquisition_released_at'
    end,
    'truthBoundary',jsonb_build_object(
      'taskIsCarrierNotRequirement',true,
      'clockProjectionCreatesNoDuplicateOwnerObligation',true,
      'requirementClockIndependentOfPlacement',true,
      'gapResolutionDoesNotResetRequirementClock',true,
      'knownActiveByIsNotClaimedAsExactOnset',req.requirement_time_class='known_active_by',
      'physicalExecutionMayRemainUnreleased',true
    )
  )) as metadata
from atlas.state_consequence_instances acq
join atlas.state_consequence_instances req
  on req.id=acq.source_requirement_instance_id
 and req.status='open'
 and req.consequence_role='operation_requirement'
join atlas.tasks t
  on t.id=acq.carrier_task_id
 and t.status in ('open','blocked')
 and t.visibility_scope='owner'
join atlas.farm_memberships fm
  on fm.id=t.assigned_membership_id
 and fm.farm_id=acq.farm_id
 and fm.active=true
 and fm.role='owner'
join lateral (
  select u.*
  from atlas.portfolio_units u
  where u.linked_farm_id=acq.farm_id
    and u.archived_at is null
  order by case when u.portfolio_role='current_engine' then 0 else 1 end,u.created_at,u.id
  limit 1
) pu on true
join atlas.principals pr
  on pr.id=pu.owner_id
 and pr.user_id=fm.user_id
 and pr.status='active'
cross join lateral atlas.task_capacity_plan_v1(
  t,
  coalesce(req.requirement_known_active_by,t.due_date,(now() at time zone coalesce(nullif(pr.home_timezone,''),'America/Chicago'))::date)
) capacity
where acq.status='open'
  and acq.consequence_role='truth_acquisition'
  and acq.carrier_task_id is not null;

comment on view atlas.principal_requirement_acquisition_clock_candidates_v1 is
'P6 projection of open Owner-jurisdiction truth-acquisition carriers into Principal Clock. The projection preserves source requirement time and creates no duplicate Owner obligation.';

revoke all on atlas.principal_requirement_acquisition_clock_candidates_v1 from public,anon,authenticated;
grant select on atlas.principal_requirement_acquisition_clock_candidates_v1 to service_role;

create or replace view atlas.principal_clock_candidates_v1 as
 select o.principal_id,
    o.domain,
    'owner_obligation'::text AS source_type,
    o.id AS source_id,
    o.title,
    o.floor_class,
    o.becomes_relevant_at AS window_start,
    COALESCE(o.expires_at, o.must_finish_by) AS window_end,
    o.fixed_at AS fixed_start,
    o.must_begin_by,
    o.must_finish_by,
    o.expected_minutes,
    o.protection_level,
    o.interruptibility,
    o.delegable,
    o.owner_required,
    o.consequence_of_delay AS consequence,
    o.reason_for_floor,
    o.portfolio_unit_id,
    o.horizon,
    o.metadata
   FROM atlas.owner_obligations o
  WHERE o.status = ANY (ARRAY['open'::text, 'in_progress'::text])
UNION ALL
 SELECT h.principal_id,
    'household'::text AS domain,
    'household_event'::text AS source_type,
    e.id AS source_id,
    e.title,
    e.floor_class,
    e.starts_at AS window_start,
    e.ends_at AS window_end,
        CASE
            WHEN e.fixed THEN e.starts_at
            ELSE NULL::timestamp with time zone
        END AS fixed_start,
    NULL::timestamp with time zone AS must_begin_by,
    e.ends_at AS must_finish_by,
    COALESCE(e.expected_minutes, GREATEST(1, round(EXTRACT(epoch FROM e.ends_at - e.starts_at) / 60.0)::integer)) AS expected_minutes,
    e.protection_level,
    e.interruptibility,
    false AS delegable,
    e.principal_required AS owner_required,
    e.consequence,
    e.reason_for_floor,
    NULL::uuid AS portfolio_unit_id,
    NULL::text AS horizon,
    e.metadata
   FROM atlas.household_events e
     JOIN atlas.households h ON h.id = e.household_id
  WHERE e.principal_required
UNION ALL
 SELECT h.principal_id,
    'household'::text AS domain,
    'household_rhythm'::text AS source_type,
    r.id AS source_id,
    r.title,
    r.floor_class,
    r.next_window_start AS window_start,
    r.next_window_end AS window_end,
    NULL::timestamp with time zone AS fixed_start,
    r.next_window_start AS must_begin_by,
    r.next_window_end AS must_finish_by,
    r.expected_minutes,
    r.protection_level,
    r.interruptibility,
    false AS delegable,
    r.principal_required AS owner_required,
    r.consequence,
    r.reason_for_floor,
    NULL::uuid AS portfolio_unit_id,
    NULL::text AS horizon,
    r.metadata
   FROM atlas.household_rhythms r
     JOIN atlas.households h ON h.id = r.household_id
  WHERE r.active AND r.principal_required AND r.next_window_start IS NOT NULL
UNION ALL
 SELECT e.principal_id,
    'operations'::text AS domain,
    'operational_escalation'::text AS source_type,
    e.id AS source_id,
    initcap(replace(e.escalation_kind, '_'::text, ' '::text)) AS title,
    e.floor_class,
    e.window_start,
    e.window_end,
    NULL::timestamp with time zone AS fixed_start,
    e.window_start AS must_begin_by,
    e.window_end AS must_finish_by,
    e.expected_owner_minutes AS expected_minutes,
    e.protection_level,
    e.interruptibility,
    false AS delegable,
    true AS owner_required,
    e.consequence,
    e.reason_for_floor,
    e.portfolio_unit_id,
    e.horizon,
    e.metadata || jsonb_build_object('sourceSystem', e.source_system, 'sourceType', e.source_type, 'sourceId', e.source_id, 'thresholdCrossed', e.threshold_crossed, 'ownerDecisionRequired', e.owner_decision_required, 'severity', e.severity, 'options', e.options_json) AS metadata
   FROM atlas.operational_escalations e
  WHERE e.status = ANY (ARRAY['open'::text, 'acknowledged'::text])
UNION ALL
 SELECT b.principal_id,
    'principal_capacity'::text AS domain,
    'capacity_block'::text AS source_type,
    b.id AS source_id,
    b.title,
    b.floor_class,
    b.starts_at AS window_start,
    b.ends_at AS window_end,
    b.starts_at AS fixed_start,
    b.starts_at AS must_begin_by,
    b.ends_at AS must_finish_by,
    GREATEST(1, round(EXTRACT(epoch FROM b.ends_at - b.starts_at) / 60.0)::integer) AS expected_minutes,
    b.protection_level,
    b.interruptibility,
    false AS delegable,
    true AS owner_required,
    b.consequence,
    b.reason_for_floor,
    NULL::uuid AS portfolio_unit_id,
    NULL::text AS horizon,
    b.metadata
   FROM atlas.principal_capacity_blocks b
  WHERE b.blocks_capacity
UNION ALL
 SELECT a.principal_id,
    'attention'::text AS domain,
    'attention_debt'::text AS source_type,
    a.subject_id AS source_id,
    a.title,
    a.floor_class,
    a.next_due_at AS window_start,
    NULL::timestamp with time zone AS window_end,
    NULL::timestamp with time zone AS fixed_start,
    a.next_due_at AS must_begin_by,
    NULL::timestamp with time zone AS must_finish_by,
    a.protected_owner_minutes AS expected_minutes,
    a.protection_level,
    a.interruptibility,
    false AS delegable,
    true AS owner_required,
    a.consequence,
    a.reason_for_floor,
    a.portfolio_unit_id,
    a.horizon,
    a.metadata || jsonb_build_object('attentionState', a.attention_state, 'attentionDebtDays', a.attention_debt_days, 'lastMeaningfulAt', a.last_meaningful_at, 'nextDueAt', a.next_due_at, 'policyId', a.policy_id) AS metadata
   FROM atlas.attention_debt_v1 a
  WHERE a.attention_state = 'needs_attention'::text
UNION ALL
 SELECT c.principal_id,
    c.domain,
    c.source_type,
    c.source_id,
    c.title,
    c.floor_class,
    c.window_start,
    c.window_end,
    c.fixed_start,
    c.must_begin_by,
    c.must_finish_by,
    c.expected_minutes,
    c.protection_level,
    c.interruptibility,
    c.delegable,
    c.owner_required,
    c.consequence,
    c.reason_for_floor,
    c.portfolio_unit_id,
    c.horizon,
    c.metadata
   FROM atlas.principal_requirement_acquisition_clock_candidates_v1 c;

comment on view atlas.principal_clock_candidates_v1 is
'Principal Clock candidate inventory. P6 includes open requirement-derived Owner truth-acquisition carriers directly, without duplicating them as owner obligations.';
