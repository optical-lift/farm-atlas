create or replace function atlas.bell_history_v3(
  p_farm_id uuid,
  p_effective_membership_id uuid default null::uuid,
  p_limit integer default 40,
  p_before timestamptz default null::timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_base jsonb;
  v_effective_user_id uuid;
  v_effective_membership_id uuid;
  v_effective_role text;
  v_before timestamptz := coalesce(p_before, now());
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_items jsonb := '[]'::jsonb;
  v_notice_unread integer := 0;
  v_while_away_since timestamptz;
  v_baseline_started_at timestamptz;
begin
  select member.effective_user_id, member.effective_membership_id, member.effective_role
  into v_effective_user_id, v_effective_membership_id, v_effective_role
  from atlas.bell_effective_member_v1(p_farm_id, p_effective_membership_id) member;

  if v_effective_user_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  v_base := atlas.bell_history_v2(p_farm_id, p_effective_membership_id, v_limit, p_before);
  v_while_away_since := nullif(v_base ->> 'whileAwaySinceAt', '')::timestamptz;
  v_baseline_started_at := nullif(v_base #>> '{baselineSummary,startedAt}', '')::timestamptz;

  with base_items as (
    select item, item ->> 'eventId' as event_id, (item ->> 'occurredAt')::timestamptz as occurred_at
    from jsonb_array_elements(coalesce(v_base -> 'items', '[]'::jsonb)) item
  ), notice_rows as (
    select
      jsonb_build_object(
        'eventId', event.id,
        'eventKey', event.event_key,
        'eventKind', 'community_event_notice',
        'sourceEvent', event.source_event,
        'occurredAt', event.occurred_at,
        'journalDate', event.journal_date,
        'section', 'farm_movement',
        'symbol', '–',
        'title', event.title,
        'detail', event.detail,
        'importance', event.importance,
        'unread', receipt.read_at is null,
        'acknowledged', receipt.acknowledged_at is not null,
        'requiresAction', false,
        'whileAway', v_while_away_since is not null and event.occurred_at > v_while_away_since,
        'baseline', v_baseline_started_at is not null and event.occurred_at <= v_baseline_started_at,
        'deepLink', coalesce(nullif(event.payload ->> 'deepLink', ''), '/bell'),
        'taskId', null,
        'projectId', null,
        'objectId', null,
        'obligationKey', 'community_event:' || event.source_id::text,
        'why', 'Elm Farm has a scheduled community event tomorrow.',
        'payload', event.payload
      ) as item,
      event.id::text as event_id,
      event.occurred_at
    from atlas.journal_event_index event
    left join atlas.bell_event_receipts receipt
      on receipt.event_id = event.id
     and receipt.user_id = v_effective_user_id
    where event.farm_id = p_farm_id
      and event.source_kind = 'community_event'
      and event.source_event = 'member_reminder'
      and event.occurred_at <= v_before
      and event.visibility_scope = 'farm_shared'
      and exists (
        select 1 from atlas.farm_memberships fm
        where fm.id = v_effective_membership_id
          and fm.farm_id = p_farm_id
          and fm.active = true
      )
  ), combined as (
    select * from base_items
    union all
    select notice.item, notice.event_id, notice.occurred_at from notice_rows notice
  ), deduped as (
    select distinct on (combined.event_id)
      combined.item,
      combined.event_id,
      combined.occurred_at
    from combined
    order by combined.event_id, combined.occurred_at desc
  ), limited as (
    select deduped.item, deduped.occurred_at
    from deduped
    order by deduped.occurred_at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(limited.item order by limited.occurred_at desc), '[]'::jsonb)
  into v_items
  from limited;

  select count(*)::integer
  into v_notice_unread
  from atlas.journal_event_index event
  left join atlas.bell_event_receipts receipt
    on receipt.event_id = event.id
   and receipt.user_id = v_effective_user_id
  where event.farm_id = p_farm_id
    and event.source_kind = 'community_event'
    and event.source_event = 'member_reminder'
    and event.occurred_at <= v_before
    and event.visibility_scope = 'farm_shared'
    and receipt.read_at is null;

  return v_base || jsonb_build_object(
    'contractVersion', 'atlas_bell_v3',
    'items', v_items,
    'unreadCount', coalesce((v_base ->> 'unreadCount')::integer, 0) + v_notice_unread,
    'eventTruth', 'journal_event_index + community_events'
  );
end;
$function$;

revoke all on function atlas.bell_history_v3(uuid, uuid, integer, timestamptz) from public;
revoke execute on function atlas.bell_history_v3(uuid, uuid, integer, timestamptz) from anon;
grant execute on function atlas.bell_history_v3(uuid, uuid, integer, timestamptz) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected,
  service_execute_expected, caller_count, policy_reference_count,
  evidence, registered_at, reviewed_at
)
values (
  'atlas.bell_history_v3(uuid, uuid, integer, timestamp with time zone)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'source', 'community_thursday_event_bell_flow_v1',
    'call_site', 'app/api/atlas/bell/route.ts',
    'authorization', 'active same-farm member; optional owner operator context',
    'reviewed_date', '2026-08-02'
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
    evidence = atlas.authenticated_rpc_registry.evidence || excluded.evidence,
    reviewed_at = excluded.reviewed_at;
