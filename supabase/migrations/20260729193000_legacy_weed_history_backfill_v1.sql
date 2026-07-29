-- Carry legacy weeding evidence forward into the persistent Weed Card model.
-- Only cards that are still not clear receive active-pass history.
-- Canonical legacy actual_minutes are preserved. When time was never recorded,
-- the session remains explicitly unquantified instead of inventing a duration.

create temp table legacy_weed_candidates on commit drop as
with cards as (
  select
    wc.id as card_id,
    wc.object_id,
    wc.current_condition,
    wc.target_condition,
    go.stable_key,
    go.label as object_label
  from atlas.weed_cards wc
  join atlas.growing_objects go on go.id = wc.object_id
  where wc.current_condition <> 'clear'
), maintenance_evidence as (
  select
    c.card_id,
    c.object_id,
    c.current_condition,
    c.target_condition,
    c.stable_key,
    c.object_label,
    'maintenance_history'::text as source_kind,
    mh.id as evidence_id,
    mh.source_task_id as task_id,
    timezone('America/Chicago', mh.completed_at)::date as work_date,
    mh.completed_at as evidence_at,
    greatest(0, coalesce(mh.actual_minutes, 0)) as minutes,
    mh.actual_minutes is not null and mh.actual_minutes > 0 as minutes_known,
    case lower(coalesce(mh.condition_before, c.current_condition))
      when 'heavy' then 'heavy'
      when 'high' then 'heavy'
      when 'moderate' then 'medium_pressure'
      when 'medium' then 'medium_pressure'
      when 'medium_pressure' then 'medium_pressure'
      when 'low' then 'row_readable'
      when 'light' then 'row_readable'
      when 'row_readable' then 'row_readable'
      when 'mostly_clear' then 'mostly_clear'
      when 'maintained' then 'clear'
      when 'clear' then 'clear'
      else c.current_condition
    end as condition_before,
    case lower(coalesce(mh.condition_after, c.current_condition))
      when 'heavy' then 'heavy'
      when 'high' then 'heavy'
      when 'moderate' then 'medium_pressure'
      when 'medium' then 'medium_pressure'
      when 'medium_pressure' then 'medium_pressure'
      when 'low' then 'row_readable'
      when 'light' then 'row_readable'
      when 'row_readable' then 'row_readable'
      when 'mostly_clear' then 'mostly_clear'
      when 'maintained' then 'clear'
      when 'clear' then 'clear'
      else c.current_condition
    end as condition_after,
    mh.note,
    mh.outcome as source_outcome,
    null::uuid as actor_user_id,
    t.assigned_membership_id as actor_membership_id
  from cards c
  join atlas.maintenance_history mh on mh.object_id = c.object_id
  left join atlas.tasks t on t.id = mh.source_task_id
  where mh.maintenance_type = 'weed'
    and mh.outcome = 'partially_completed'
), outcome_evidence as (
  select distinct on (c.card_id, toe.id)
    c.card_id,
    c.object_id,
    c.current_condition,
    c.target_condition,
    c.stable_key,
    c.object_label,
    'task_outcome'::text as source_kind,
    toe.id as evidence_id,
    t.id as task_id,
    timezone('America/Chicago', toe.created_at)::date as work_date,
    toe.created_at as evidence_at,
    0 as minutes,
    false as minutes_known,
    c.current_condition as condition_before,
    c.current_condition as condition_after,
    coalesce(toe.note, t.note) as note,
    toe.outcome as source_outcome,
    nullif(tt.payload ->> 'actor_user_id', '')::uuid as actor_user_id,
    coalesce(
      nullif(tt.payload ->> 'actor_membership_id', '')::uuid,
      t.assigned_membership_id
    ) as actor_membership_id
  from cards c
  join atlas.task_objects tos on tos.object_id = c.object_id
  join atlas.tasks t on t.id = tos.task_id
  join atlas.task_outcome_events toe
    on toe.task_id = t.id
   and toe.outcome in ('done', 'partial')
  left join atlas.task_transitions tt on tt.task_outcome_event_id = toe.id
  where (
      coalesce(t.action_key, '') = 'weed'
      or coalesce(t.work_class, '') = 'weeding'
      or t.title ilike 'weed%'
    )
    and not exists (
      select 1
      from atlas.maintenance_history mh
      where mh.object_id = c.object_id
        and mh.source_task_id = t.id
        and mh.maintenance_type = 'weed'
    )
    -- A day-close transition with the target still unmet is not another work session.
    and not (
      coalesce(tt.payload ->> 'day_closed', 'false') = 'true'
      and coalesce(tt.payload ->> 'target_reached', 'false') <> 'true'
    )
    -- A completion that was explicitly reopened is retracted evidence.
    and not (
      toe.outcome = 'done'
      and exists (
        select 1
        from atlas.task_outcome_events reopened
        where reopened.task_id = t.id
          and reopened.outcome = 'reopened'
          and reopened.created_at > toe.created_at
      )
    )
  order by c.card_id, toe.id, tt.created_at desc nulls last
)
select * from maintenance_evidence
union all
select * from outcome_evidence;

-- Start an active pass only where historical evidence exists and the bed is still not clear.
insert into atlas.weed_passes (
  weed_card_id,
  status,
  opened_at,
  starting_condition,
  current_condition,
  target_condition,
  metadata
)
select
  c.card_id,
  'active',
  min(c.evidence_at),
  c.current_condition,
  c.current_condition,
  c.target_condition,
  jsonb_build_object(
    'source', 'legacy_weed_history_backfill_v1',
    'opened_from_legacy_evidence', true
  )
from legacy_weed_candidates c
where not exists (
  select 1
  from atlas.weed_passes p
  where p.weed_card_id = c.card_id
    and p.status = 'active'
)
group by c.card_id, c.current_condition, c.target_condition;

-- Link the FR4/FR5 pilot sessions (and any equivalent existing session) back to
-- their original maintenance-history row instead of duplicating the work.
update atlas.weed_sessions ws
set metadata = ws.metadata || jsonb_build_object(
      'maintenance_history_id', c.evidence_id,
      'legacy_evidence_at', c.evidence_at,
      'legacy_history_linked', true
    )
from legacy_weed_candidates c
where c.source_kind = 'maintenance_history'
  and ws.weed_card_id = c.card_id
  and ws.task_id is not distinct from c.task_id
  and ws.work_date = c.work_date
  and ws.minutes_known = c.minutes_known
  and ws.minutes = c.minutes;

insert into atlas.weed_sessions (
  weed_card_id,
  weed_pass_id,
  task_id,
  work_date,
  minutes,
  minutes_known,
  condition_before,
  condition_after,
  note,
  actor_user_id,
  actor_membership_id,
  idempotency_key,
  metadata,
  recorded_at
)
select
  c.card_id,
  p.id,
  c.task_id,
  c.work_date,
  c.minutes,
  c.minutes_known,
  c.condition_before,
  c.condition_after,
  coalesce(
    nullif(btrim(c.note), ''),
    case
      when c.minutes_known then 'Historical weed work'
      else 'Historical weed work · time unrecorded'
    end
  ),
  c.actor_user_id,
  c.actor_membership_id,
  case
    when c.source_kind = 'maintenance_history'
      then 'backfill:maintenance_history:' || c.evidence_id::text
    else 'backfill:task_outcome:' || c.evidence_id::text || ':' || c.card_id::text
  end,
  jsonb_strip_nulls(jsonb_build_object(
    'source', 'legacy_weed_history_backfill_v1',
    'source_kind', c.source_kind,
    'maintenance_history_id',
      case when c.source_kind = 'maintenance_history' then c.evidence_id end,
    'task_outcome_event_id',
      case when c.source_kind = 'task_outcome' then c.evidence_id end,
    'source_outcome', c.source_outcome,
    'legacy_evidence_at', c.evidence_at,
    'minutes_unrecorded', not c.minutes_known
  )),
  c.evidence_at
from legacy_weed_candidates c
join atlas.weed_passes p
  on p.weed_card_id = c.card_id
 and p.status = 'active'
where not exists (
  select 1
  from atlas.weed_sessions ws
  where ws.weed_card_id = c.card_id
    and (
      (
        c.source_kind = 'maintenance_history'
        and (
          ws.metadata ->> 'maintenance_history_id' = c.evidence_id::text
          or (
            ws.task_id is not distinct from c.task_id
            and ws.work_date = c.work_date
            and ws.minutes_known = c.minutes_known
            and ws.minutes = c.minutes
          )
        )
      )
      or (
        c.source_kind = 'task_outcome'
        and (
          ws.metadata ->> 'task_outcome_event_id' = c.evidence_id::text
          or (ws.task_id = c.task_id and ws.work_date = c.work_date)
        )
      )
    )
)
on conflict (idempotency_key) do nothing;

-- The active pass total is always the sum of its append-only sessions.
update atlas.weed_passes p
set total_minutes = s.total_minutes,
    metadata = p.metadata || jsonb_build_object(
      'legacy_history_backfilled', true,
      'legacy_session_count', s.session_count,
      'legacy_known_minutes', s.total_minutes,
      'legacy_unknown_time_sessions', s.unknown_sessions
    ),
    updated_at = now()
from (
  select
    ws.weed_pass_id,
    sum(ws.minutes)::integer as total_minutes,
    count(*)::integer as session_count,
    count(*) filter (where not ws.minutes_known)::integer as unknown_sessions
  from atlas.weed_sessions ws
  group by ws.weed_pass_id
) s
where p.id = s.weed_pass_id
  and p.status = 'active';

update atlas.weed_cards c
set last_session_at = s.last_session_at,
    metadata = c.metadata || jsonb_build_object('legacy_history_backfilled', true),
    updated_at = now()
from (
  select weed_card_id, max(recorded_at) as last_session_at
  from atlas.weed_sessions
  group by weed_card_id
) s
where c.id = s.weed_card_id
  and c.current_condition <> 'clear';

-- Keep broad legacy outcomes visible as unresolved evidence when no physical
-- object was ever linked. They cannot be safely allocated across beds.
with unresolved as (
  select
    t.id as task_id,
    count(*)::integer as outcome_count
  from atlas.tasks t
  join atlas.task_outcome_events toe
    on toe.task_id = t.id
   and toe.outcome in ('done', 'partial')
  left join atlas.task_objects tos on tos.task_id = t.id
  where (
      coalesce(t.action_key, '') = 'weed'
      or coalesce(t.work_class, '') = 'weeding'
      or t.title ilike 'weed%'
    )
  group by t.id
  having count(tos.object_id) = 0
)
update atlas.tasks t
set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'legacy_weed_history_unmapped', true,
      'legacy_weed_history_unmapped_reason', 'no_object_link',
      'legacy_weed_history_unmapped_outcomes', u.outcome_count
    ),
    updated_at = now()
from unresolved u
where t.id = u.task_id;
