begin;

create or replace function atlas.bell_attention_counts_v1(
  p_farm_id uuid,
  p_effective_membership_id uuid default null
)
returns jsonb
language plpgsql
stable
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
  v_baseline_at timestamptz;
  v_new_attention_count integer := 0;
  v_current_action_count integer := 0;
begin
  select effective_user_id, effective_membership_id, effective_role
  into v_user_id, v_membership_id, v_role
  from atlas.bell_effective_member_v1(p_farm_id, p_effective_membership_id);

  if v_user_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  v_is_management := v_role in ('owner', 'manager');

  select settings.timezone_name
  into v_timezone
  from atlas.farm_task_release_settings settings
  where settings.farm_id = p_farm_id
    and settings.active
  order by settings.updated_at desc
  limit 1;

  v_farm_today := (now() at time zone coalesce(v_timezone, 'America/Chicago'))::date;

  select baseline.monitoring_started_at
  into v_baseline_at
  from atlas.bell_monitoring_baselines baseline
  where baseline.user_id = v_user_id
    and baseline.farm_id = p_farm_id;

  if v_is_management then
    with eligible as (
      select
        event.id,
        event.occurred_at,
        atlas.bell_event_obligation_key_v2(event.id) as obligation_key,
        receipt.read_at,
        atlas.bell_event_requires_action_v1(event.id, v_user_id) as requires_action
      from atlas.journal_event_index event
      left join atlas.bell_event_receipts receipt
        on receipt.journal_event_id = event.id
       and receipt.user_id = v_user_id
      where event.farm_id = p_farm_id
        and event.occurred_at > coalesce(v_baseline_at, '-infinity'::timestamptz)
        and event.occurred_at <= now()
        and atlas.bell_event_is_worthy_v1(event.id)
        and atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id)
    ), latest as (
      select distinct on (eligible.obligation_key) eligible.*
      from eligible
      order by eligible.obligation_key, eligible.occurred_at desc, eligible.id desc
    )
    select
      count(*) filter (where latest.requires_action and latest.read_at is null)::integer,
      count(*) filter (where latest.requires_action)::integer
    into v_new_attention_count, v_current_action_count
    from latest;
  else
    with latest as (
      select distinct on (event.task_id)
        event.id,
        event.occurred_at,
        receipt.read_at
      from atlas.journal_event_index event
      join atlas.tasks task on task.id = event.task_id
      left join atlas.bell_event_receipts receipt
        on receipt.journal_event_id = event.id
       and receipt.user_id = v_user_id
      where event.farm_id = p_farm_id
        and event.occurred_at <= now()
        and event.event_kind = 'task_result'
        and event.source_event = 'rescheduled'
        and event.task_id is not null
        and event.visibility_scope = 'assigned_worker'
        and task.status in ('open', 'blocked')
        and task.due_date is not null
        and task.due_date <= v_farm_today
        and (
          task.assigned_membership_id = v_membership_id
          or task.assigned_user_id = v_user_id
        )
      order by event.task_id, event.occurred_at desc, event.id desc
    )
    select
      count(*) filter (where latest.read_at is null)::integer,
      count(*)::integer
    into v_new_attention_count, v_current_action_count
    from latest;
  end if;

  return jsonb_build_object(
    'newAttentionCount', coalesce(v_new_attention_count, 0),
    'currentActionCount', coalesce(v_current_action_count, 0)
  );
end;
$function$;

create or replace function atlas.record_bell_visit_v1(
  p_farm_id uuid,
  p_seen_through timestamptz default null,
  p_effective_membership_id uuid default null
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
  v_baseline_at timestamptz;
  v_seen_through timestamptz := least(coalesce(p_seen_through, now()), now());
  v_previous timestamptz;
  v_reviewed_count integer := 0;
  v_written integer := 0;
begin
  select effective_user_id, effective_membership_id, effective_role
  into v_user_id, v_membership_id, v_role
  from atlas.bell_effective_member_v1(p_farm_id, p_effective_membership_id);

  if v_user_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  v_is_management := v_role in ('owner', 'manager');

  select settings.timezone_name
  into v_timezone
  from atlas.farm_task_release_settings settings
  where settings.farm_id = p_farm_id
    and settings.active
  order by settings.updated_at desc
  limit 1;

  v_farm_today := (now() at time zone coalesce(v_timezone, 'America/Chicago'))::date;

  select baseline.monitoring_started_at
  into v_baseline_at
  from atlas.bell_monitoring_baselines baseline
  where baseline.user_id = v_user_id
    and baseline.farm_id = p_farm_id;

  select last_visited_at
  into v_previous
  from atlas.bell_visit_state
  where user_id = v_user_id
    and farm_id = p_farm_id;

  insert into atlas.bell_visit_state(
    user_id, farm_id, previous_visited_at, last_visited_at, updated_at
  ) values (
    v_user_id, p_farm_id, v_previous, v_seen_through, now()
  )
  on conflict (user_id, farm_id) do update
  set previous_visited_at = atlas.bell_visit_state.last_visited_at,
      last_visited_at = greatest(
        coalesce(atlas.bell_visit_state.last_visited_at, '-infinity'::timestamptz),
        excluded.last_visited_at
      ),
      updated_at = now();

  if v_is_management then
    with eligible as (
      select
        event.id,
        event.occurred_at,
        atlas.bell_event_obligation_key_v2(event.id) as obligation_key
      from atlas.journal_event_index event
      where event.farm_id = p_farm_id
        and event.occurred_at > coalesce(v_baseline_at, '-infinity'::timestamptz)
        and event.occurred_at <= v_seen_through
        and atlas.bell_event_is_worthy_v1(event.id)
        and atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id)
    ), latest as (
      select distinct on (eligible.obligation_key) eligible.*
      from eligible
      order by eligible.obligation_key, eligible.occurred_at desc, eligible.id desc
    )
    insert into atlas.bell_event_receipts(
      journal_event_id, user_id, read_at, acknowledged_at, updated_at
    )
    select latest.id, v_user_id, now(), null, now()
    from latest
    on conflict (journal_event_id, user_id) do update
    set read_at = coalesce(atlas.bell_event_receipts.read_at, excluded.read_at),
        updated_at = now();

    get diagnostics v_written = row_count;
    v_reviewed_count := v_reviewed_count + v_written;
  else
    with latest as (
      select distinct on (event.task_id)
        event.id,
        event.task_id,
        event.occurred_at
      from atlas.journal_event_index event
      join atlas.tasks task on task.id = event.task_id
      where event.farm_id = p_farm_id
        and event.occurred_at <= v_seen_through
        and event.event_kind = 'task_result'
        and event.source_event = 'rescheduled'
        and event.task_id is not null
        and event.visibility_scope = 'assigned_worker'
        and task.status in ('open', 'blocked')
        and task.due_date is not null
        and task.due_date <= v_farm_today
        and (
          task.assigned_membership_id = v_membership_id
          or task.assigned_user_id = v_user_id
        )
      order by event.task_id, event.occurred_at desc, event.id desc
    )
    insert into atlas.bell_event_receipts(
      journal_event_id, user_id, read_at, acknowledged_at, updated_at
    )
    select latest.id, v_user_id, now(), null, now()
    from latest
    on conflict (journal_event_id, user_id) do update
    set read_at = coalesce(atlas.bell_event_receipts.read_at, excluded.read_at),
        updated_at = now();

    get diagnostics v_written = row_count;
    v_reviewed_count := v_reviewed_count + v_written;
  end if;

  insert into atlas.bell_event_receipts(
    journal_event_id, user_id, read_at, acknowledged_at, updated_at
  )
  select event.id, v_user_id, now(), null, now()
  from atlas.journal_event_index event
  where event.farm_id = p_farm_id
    and event.source_kind = 'community_event'
    and event.source_event = 'member_reminder'
    and event.occurred_at <= v_seen_through
    and event.visibility_scope = 'farm_shared'
    and exists (
      select 1
      from atlas.farm_memberships membership
      where membership.id = v_membership_id
        and membership.farm_id = p_farm_id
        and membership.active
    )
  on conflict (journal_event_id, user_id) do update
  set read_at = coalesce(atlas.bell_event_receipts.read_at, excluded.read_at),
      updated_at = now();

  get diagnostics v_written = row_count;
  v_reviewed_count := v_reviewed_count + v_written;

  return jsonb_build_object(
    'userId', v_user_id,
    'farmId', p_farm_id,
    'previousVisitAt', v_previous,
    'lastVisitAt', v_seen_through,
    'reviewedThrough', v_seen_through,
    'reviewedEventCount', v_reviewed_count,
    'badgeMeaning', 'unreviewed_attention'
  );
end;
$function$;

create or replace function atlas.bell_history_v4(
  p_farm_id uuid,
  p_effective_membership_id uuid default null,
  p_limit integer default 40,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_base jsonb;
  v_counts jsonb;
begin
  v_base := atlas.bell_history_v3(
    p_farm_id,
    p_effective_membership_id,
    p_limit,
    p_before
  );

  v_counts := atlas.bell_attention_counts_v1(
    p_farm_id,
    p_effective_membership_id
  );

  return v_base || jsonb_build_object(
    'contractVersion', 'atlas_bell_v4',
    'badgeCount', coalesce((v_counts ->> 'newAttentionCount')::integer, 0),
    'newAttentionCount', coalesce((v_counts ->> 'newAttentionCount')::integer, 0),
    'currentActionCount', coalesce((v_counts ->> 'currentActionCount')::integer, 0),
    'badgeMeaning', 'unreviewed_attention',
    'workMeaning', 'current_actionable_work'
  );
end;
$function$;

revoke all on function atlas.bell_attention_counts_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function atlas.bell_attention_counts_v1(uuid, uuid) to service_role;

revoke all on function atlas.bell_history_v4(uuid, uuid, integer, timestamptz) from public, anon;
grant execute on function atlas.bell_history_v4(uuid, uuid, integer, timestamptz) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  registered_at,
  reviewed_at
) values (
  'atlas.bell_history_v4(uuid, uuid, integer, timestamp with time zone)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'source','bell_review_badge_contract_v1',
    'call_site','Atlas Bell API',
    'authorization','active effective farm membership',
    'badge_contract','unreviewed attention, not unfinished work',
    'reviewed_date','2026-08-03'
  ),
  now(),
  now()
)
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    caller_count = excluded.caller_count,
    policy_reference_count = excluded.policy_reference_count,
    evidence = excluded.evidence,
    reviewed_at = excluded.reviewed_at;

comment on function atlas.bell_attention_counts_v1(uuid, uuid) is
  'Separates new unreviewed attention from current unresolved Bell actions for the effective account.';
comment on function atlas.record_bell_visit_v1(uuid, timestamptz, uuid) is
  'Records a Bell review and marks the latest visible Bell events through that review boundary as read without resolving their underlying work.';
comment on function atlas.bell_history_v4(uuid, uuid, integer, timestamptz) is
  'Bell v4: badgeCount is unreviewed attention. currentActionCount remains the unresolved Bell action workload.';

commit;
