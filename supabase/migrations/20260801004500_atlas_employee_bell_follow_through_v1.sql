begin;

do $preflight$
declare
  v_definition text;
begin
  if to_regprocedure('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)') is null then
    raise exception 'Expected atlas.bell_history_v2 before building employee follow-through Bell';
  end if;

  select pg_get_functiondef('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)'::regprocedure)
  into v_definition;

  if v_definition not like '%latest_worthy_event_per_obligation%'
     or v_definition not like '%atlas.bell_event_is_worthy_v1(event.id)%'
     or v_definition not like '%effectiveRole%' then
    raise exception 'atlas.bell_history_v2 no longer matches the reviewed Bell v2 contract';
  end if;
end;
$preflight$;

create or replace function atlas.bell_history_v2(
  p_farm_id uuid,
  p_effective_membership_id uuid default null,
  p_limit integer default 40,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_user_id uuid;
  v_membership_id uuid;
  v_role text;
  v_is_management boolean;
  v_timezone text;
  v_farm_today date;
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_before timestamptz := coalesce(p_before, now());
  v_last_visit_at timestamptz;
  v_baseline_at timestamptz;
  v_since_at timestamptz;
  v_items jsonb := '[]'::jsonb;
  v_badge_count integer := 0;
  v_unread_count integer := 0;
  v_while_away_count integer := 0;
  v_baseline_count integer := 0;
  v_baseline_due_count integer := 0;
  v_baseline_failure_count integer := 0;
begin
  select effective_user_id, effective_membership_id, effective_role
  into v_user_id, v_membership_id, v_role
  from atlas.bell_effective_member_v1(p_farm_id, p_effective_membership_id);

  v_is_management := v_role in ('owner', 'manager');

  select settings.timezone_name
  into v_timezone
  from atlas.farm_task_release_settings settings
  where settings.farm_id = p_farm_id
    and settings.active
  order by settings.updated_at desc
  limit 1;

  v_farm_today := (now() at time zone coalesce(v_timezone, 'America/Chicago'))::date;

  insert into atlas.bell_monitoring_baselines (user_id, farm_id, monitoring_started_at, metadata)
  values (v_user_id, p_farm_id, now(), jsonb_build_object(
    'reason', 'First Bell v2 visit established the future-gap monitoring boundary',
    'source', 'bell_history_v2'
  ))
  on conflict (user_id, farm_id) do nothing;

  select baseline.monitoring_started_at into v_baseline_at
  from atlas.bell_monitoring_baselines baseline
  where baseline.user_id = v_user_id and baseline.farm_id = p_farm_id;

  select visit.last_visited_at into v_last_visit_at
  from atlas.bell_visit_state visit
  where visit.user_id = v_user_id and visit.farm_id = p_farm_id;

  v_since_at := greatest(coalesce(v_last_visit_at, v_baseline_at), v_baseline_at);

  with movement_stats as (
    select
      event.task_id,
      count(*)::integer as movement_count
    from atlas.journal_event_index event
    where event.farm_id = p_farm_id
      and event.event_kind = 'task_result'
      and event.source_event = 'rescheduled'
      and event.task_id is not null
    group by event.task_id
  ), management_eligible as (
    select
      event.*,
      receipt.read_at,
      receipt.acknowledged_at,
      atlas.bell_event_requires_action_v1(event.id, v_user_id) as requires_action,
      atlas.bell_event_deep_link_v1(event.id) as deep_link,
      atlas.bell_event_obligation_key_v2(event.id) as obligation_key,
      atlas.bell_event_why_v2(event.id, v_user_id) as why,
      null::integer as movement_count,
      null::date as task_due_date,
      null::text as current_task_title,
      null::text as result_text,
      '[]'::jsonb as unlock_task_titles
    from atlas.journal_event_index event
    left join atlas.bell_event_receipts receipt
      on receipt.journal_event_id = event.id and receipt.user_id = v_user_id
    where v_is_management
      and event.farm_id = p_farm_id
      and event.occurred_at <= v_before
      and atlas.bell_event_is_worthy_v1(event.id)
      and atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id)
  ), employee_movement_eligible as (
    select distinct on (event.task_id)
      event.*,
      receipt.read_at,
      receipt.acknowledged_at,
      true as requires_action,
      atlas.bell_event_deep_link_v1(event.id) as deep_link,
      'movement:' || event.task_id::text as obligation_key,
      'This assigned task has been moved instead of finished and has reached its current work date.'::text as why,
      movement.movement_count,
      task.due_date as task_due_date,
      task.title as current_task_title,
      coalesce(
        nullif(task.unlock_text, ''),
        nullif(task.metadata ->> 'desired_result', ''),
        nullif(task.metadata ->> 'done_definition', ''),
        nullif(task.metadata ->> 'completion_result', ''),
        nullif(task.metadata ->> 'result_text', '')
      ) as result_text,
      coalesce(unlocks.unlock_task_titles, '[]'::jsonb) as unlock_task_titles
    from atlas.journal_event_index event
    join atlas.tasks task
      on task.id = event.task_id
    join movement_stats movement
      on movement.task_id = event.task_id
    left join atlas.bell_event_receipts receipt
      on receipt.journal_event_id = event.id and receipt.user_id = v_user_id
    left join lateral (
      select coalesce(jsonb_agg(to_jsonb(unlock_target.title) order by unlock_target.title), '[]'::jsonb) as unlock_task_titles
      from (
        select distinct dependent.title
        from atlas.maintenance_dependencies dependency
        join atlas.maintenance_objects maintenance
          on maintenance.id = dependency.maintenance_object_id
        join atlas.tasks dependent
          on dependent.id = dependency.dependent_task_id
        where dependency.active
          and dependency.satisfied_at is null
          and dependent.status in ('open', 'blocked')
          and dependent.title !~* '^Checklist\\s*[—-]'
          and (
            maintenance.id = atlas.rhythm_safe_uuid_v1(task.metadata ->> 'maintenance_object_id')
            or maintenance.object_id = event.object_id
            or exists (
              select 1
              from jsonb_array_elements_text(
                case
                  when jsonb_typeof(event.payload #> '{metadata,object_ids}') = 'array'
                    then event.payload #> '{metadata,object_ids}'
                  else '[]'::jsonb
                end
              ) object_ref(value)
              where atlas.rhythm_safe_uuid_v1(object_ref.value) = maintenance.object_id
            )
          )

        union

        select downstream.title
        from atlas.tasks downstream
        where downstream.id in (
          atlas.rhythm_safe_uuid_v1(task.metadata ->> 'downstream_task_id'),
          atlas.rhythm_safe_uuid_v1(task.metadata ->> 'owner_review_task_id')
        )
          and downstream.status in ('open', 'blocked')
      ) unlock_target
    ) unlocks on true
    where not v_is_management
      and event.farm_id = p_farm_id
      and event.occurred_at <= v_before
      and event.event_kind = 'task_result'
      and event.source_event = 'rescheduled'
      and task.status in ('open', 'blocked')
      and task.due_date is not null
      and task.due_date <= v_farm_today
      and (
        task.assigned_membership_id = v_membership_id
        or task.assigned_user_id = v_user_id
      )
      and atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id)
    order by event.task_id, event.occurred_at desc, event.id desc
  ), eligible as (
    select * from management_eligible
    union all
    select * from employee_movement_eligible
  ), latest as (
    select distinct on (eligible.obligation_key) eligible.*
    from eligible
    order by eligible.obligation_key, eligible.occurred_at desc, eligible.id desc
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventId', item.id,
        'eventKey', item.event_key,
        'eventKind', item.event_kind,
        'sourceKind', item.source_kind,
        'sourceId', item.source_id,
        'sourceEvent', item.source_event,
        'title', coalesce(item.current_task_title, item.title),
        'detail', case when v_is_management then item.detail else null end,
        'occurredAt', item.occurred_at,
        'journalDate', item.journal_date,
        'importance', item.importance,
        'symbol', case
          when not v_is_management then '~'
          when item.event_kind = 'rhythm_failure' then '!'
          when item.event_kind = 'rhythm_due' then '!'
          when item.event_kind = 'rhythm_warning' then '~'
          when item.event_kind = 'unlock' then '◆'
          when item.event_kind = 'owner_decision' then '?'
          when item.event_kind = 'task_result' then '✓'
          else '–' end,
        'deepLink', item.deep_link,
        'taskId', item.task_id,
        'objectId', item.object_id,
        'projectId', item.project_id,
        'trailBindingId', item.trail_binding_id,
        'unread', case
          when v_is_management then item.read_at is null and item.occurred_at > v_baseline_at
          else item.read_at is null
        end,
        'acknowledged', case when v_is_management then item.acknowledged_at is not null else false end,
        'requiresAction', item.requires_action,
        'whileAway', item.occurred_at > v_since_at,
        'baseline', case when v_is_management then item.occurred_at <= v_baseline_at else false end,
        'obligationKey', item.obligation_key,
        'section', case
          when not v_is_management then 'needs_you'
          when item.event_kind in ('rhythm_warning', 'rhythm_due', 'rhythm_failure') then 'rhythms'
          when item.requires_action then 'needs_you'
          else 'farm_movement'
        end,
        'why', item.why,
        'payload', coalesce(item.payload, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'movementCount', item.movement_count,
          'taskTitle', item.current_task_title,
          'dueDate', item.task_due_date,
          'farmToday', case when not v_is_management then v_farm_today else null end,
          'resultText', item.result_text,
          'unlockTaskTitles', case when item.unlock_task_titles = '[]'::jsonb then null else item.unlock_task_titles end
        ))
      ) order by item.occurred_at desc, item.id desc)
      from (
        select latest.*
        from latest
        order by
          case when not v_is_management then latest.movement_count end desc nulls last,
          case when not v_is_management then latest.task_due_date end asc nulls last,
          latest.occurred_at desc,
          latest.id desc
        limit v_limit
      ) item
    ), '[]'::jsonb),
    (select count(*)::integer from latest item
      where case
        when v_is_management then item.occurred_at > v_baseline_at and item.read_at is null
        else item.read_at is null
      end),
    (select count(*)::integer from latest item
      where case
        when v_is_management then item.occurred_at > v_baseline_at
          and item.requires_action
          and item.acknowledged_at is null
        else item.requires_action
      end),
    (select count(*)::integer from latest item
      where item.occurred_at > v_since_at and item.requires_action),
    (select count(*)::integer from latest item
      where v_is_management and item.occurred_at <= v_baseline_at and item.requires_action),
    (select count(*)::integer from latest item
      where v_is_management and item.occurred_at <= v_baseline_at and item.requires_action and item.event_kind = 'rhythm_due'),
    (select count(*)::integer from latest item
      where v_is_management and item.occurred_at <= v_baseline_at and item.requires_action and item.event_kind = 'rhythm_failure')
  into v_items, v_unread_count, v_badge_count, v_while_away_count,
       v_baseline_count, v_baseline_due_count, v_baseline_failure_count;

  return jsonb_build_object(
    'contractVersion', 'atlas_bell_v2',
    'farmId', p_farm_id,
    'effectiveUserId', v_user_id,
    'effectiveMembershipId', v_membership_id,
    'effectiveRole', v_role,
    'preparedAt', now(),
    'lastVisitAt', v_last_visit_at,
    'whileAwaySinceAt', v_since_at,
    'whileAwayCount', v_while_away_count,
    'unreadCount', v_unread_count,
    'badgeCount', v_badge_count,
    'baselineSummary', jsonb_build_object(
      'startedAt', v_baseline_at,
      'totalCount', v_baseline_count,
      'dueCount', v_baseline_due_count,
      'failureCount', v_baseline_failure_count,
      'label', case when v_is_management then 'Existing Atlas gaps at monitoring start' else 'Not shown to employees' end
    ),
    'items', v_items,
    'eventTruth', 'journal_event_index',
    'receiptTruth', 'bell_event_receipts',
    'obligationTruth', case when v_is_management then 'latest_worthy_event_per_obligation' else 'current_assigned_task_movement_per_task' end
  );
end;
$function$;

comment on function atlas.bell_history_v2(uuid, uuid, integer, timestamptz) is
  'Role-aware Bell. Owner and manager accounts retain management action queues. Employee accounts receive only assigned open tasks that were canonically rescheduled and have reached their current due date, enriched with movement counts and canonical result or unlock targets.';

do $postcondition$
declare
  v_definition text;
begin
  select pg_get_functiondef('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)'::regprocedure)
  into v_definition;

  if v_definition not like '%v_role in (''owner'', ''manager'')%'
     or v_definition not like '%event.source_event = ''rescheduled''%'
     or v_definition not like '%task.due_date <= v_farm_today%'
     or v_definition not like '%''movementCount'', item.movement_count%'
     or v_definition not like '%''unlockTaskTitles''%'
     or v_definition not like '%current_assigned_task_movement_per_task%'
     or v_definition not like '%task.assigned_membership_id = v_membership_id%'
     or v_definition not like '%task.assigned_user_id = v_user_id%' then
    raise exception 'Employee Bell follow-through postcondition failed';
  end if;
end;
$postcondition$;

commit;
