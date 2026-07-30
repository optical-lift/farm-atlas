create or replace function atlas.bell_badge_count_for_user_v1(
  p_farm_id uuid,
  p_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  with boundary as (
    select baseline.monitoring_started_at
    from atlas.bell_monitoring_baselines baseline
    where baseline.farm_id = p_farm_id
      and baseline.user_id = p_user_id
  ), eligible as (
    select
      event.id,
      event.occurred_at,
      atlas.bell_event_obligation_key_v2(event.id) as obligation_key,
      atlas.bell_event_requires_action_v1(event.id, p_user_id) as requires_action
    from atlas.journal_event_index event
    cross join boundary
    where event.farm_id = p_farm_id
      and event.occurred_at > boundary.monitoring_started_at
      and atlas.bell_event_is_worthy_v1(event.id)
      and atlas.notification_can_user_read_event_v1(event.id, p_user_id)
  ), latest as (
    select distinct on (eligible.obligation_key)
      eligible.id,
      eligible.requires_action
    from eligible
    order by eligible.obligation_key, eligible.occurred_at desc, eligible.id desc
  )
  select count(*)::integer
  from latest
  left join atlas.bell_event_receipts receipt
    on receipt.journal_event_id = latest.id
   and receipt.user_id = p_user_id
  where latest.requires_action
    and receipt.acknowledged_at is null;
$$;

grant execute on function atlas.bell_badge_count_for_user_v1(uuid, uuid) to authenticated, service_role;
