create or replace function atlas.reality_repair_clock_tick_v1(
  p_as_of_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_date date := coalesce(p_as_of_date, (now() at time zone 'America/Chicago')::date);
  v_farm record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_synced integer := 0;
  v_failed integer := 0;
begin
  for v_farm in
    select f.id, f.stable_key
    from atlas.farms f
    where f.status = 'active'
    order by f.id
  loop
    begin
      v_result := atlas.sync_bell_repair_events_v1(v_farm.id, v_date);
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'farmId', v_farm.id,
        'farmKey', v_farm.stable_key,
        'state', 'synced',
        'result', v_result
      ));
      v_synced := v_synced + 1;
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'farmId', v_farm.id,
        'farmKey', v_farm.stable_key,
        'state', 'failed',
        'sqlstate', sqlstate,
        'message', sqlerrm
      ));
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'contractVersion', 'reality_repair_clock_tick_v1',
    'asOfDate', v_date,
    'syncedFarmCount', v_synced,
    'failedFarmCount', v_failed,
    'farms', v_results,
    'truthBoundary', jsonb_build_object(
      'canonicalRepairEventsMaintainedOutsideBellRead', true,
      'bellReadDoesNotOwnEventTruth', true,
      'bellReceiptsRemainAttentionMetadata', true
    )
  );
end;
$function$;

revoke all on function atlas.reality_repair_clock_tick_v1(date) from public;
grant execute on function atlas.reality_repair_clock_tick_v1(date) to service_role;

create or replace function atlas.bell_history_v4(
  p_farm_id uuid,
  p_effective_membership_id uuid default null::uuid,
  p_limit integer default 40,
  p_before timestamp with time zone default null::timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_base jsonb;
  v_counts jsonb;
  v_role text;
  v_user_id uuid;
  v_items jsonb;
begin
  v_base := atlas.bell_history_v3(p_farm_id, p_effective_membership_id, p_limit, p_before);

  select effective_role, effective_user_id
  into v_role, v_user_id
  from atlas.bell_effective_member_v1(p_farm_id, p_effective_membership_id);

  if v_role not in ('owner', 'manager') then
    select coalesce(jsonb_agg(item order by (item ->> 'occurredAt')::timestamptz desc), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(coalesce(v_base -> 'items', '[]'::jsonb)) item
    where coalesce(item ->> 'sourceEvent', '') <> 'rescheduled'
       or atlas.bell_employee_reschedule_is_attention_v1(
            nullif(item ->> 'eventId', '')::uuid,
            nullif(item ->> 'taskId', '')::uuid,
            v_user_id
          );

    v_base := v_base || jsonb_build_object(
      'items', v_items,
      'unreadCount', (
        select count(*)::integer
        from jsonb_array_elements(v_items) item
        where coalesce((item ->> 'unread')::boolean, false)
      )
    );
  end if;

  v_counts := atlas.bell_attention_counts_v1(p_farm_id, p_effective_membership_id);

  return v_base || jsonb_build_object(
    'contractVersion', 'atlas_bell_v4',
    'badgeCount', coalesce((v_counts ->> 'newAttentionCount')::integer, 0),
    'newAttentionCount', coalesce((v_counts ->> 'newAttentionCount')::integer, 0),
    'currentActionCount', coalesce((v_counts ->> 'currentActionCount')::integer, 0),
    'badgeMeaning', 'unreviewed_attention',
    'workMeaning', 'current_actionable_work',
    'eventTruthMaintenance', 'canonical_repair_clock_v1'
  );
end;
$function$;

comment on function atlas.bell_history_v4(uuid, uuid, integer, timestamptz) is
  'Read-only Bell projection over canonical journal events plus Bell-specific attention metadata. Repair-event truth is maintained by reality_repair_clock_tick_v1, not by opening Bell.';

do $block$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname = 'atlas-reality-repair-clock-v1';

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'atlas-reality-repair-clock-v1',
    '*/5 * * * *',
    'select atlas.reality_repair_clock_tick_v1();'
  );
end;
$block$;

select atlas.reality_repair_clock_tick_v1((now() at time zone 'America/Chicago')::date);