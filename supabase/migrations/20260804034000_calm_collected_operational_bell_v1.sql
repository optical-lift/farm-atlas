begin;

create or replace function atlas.operational_rhythm_surface_v1(
  p_event_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_event atlas.journal_event_index%rowtype;
  v_rhythm_key text;
  v_task_action text;
  v_task_id uuid;
  v_task atlas.tasks%rowtype;
  v_owner_attention boolean := false;
begin
  select event.* into v_event
  from atlas.journal_event_index event
  where event.id = p_event_id;

  if v_event.id is null
     or v_event.event_kind not in ('rhythm_warning', 'rhythm_due', 'rhythm_failure') then
    return 'not_operational_rhythm';
  end if;

  v_rhythm_key := lower(coalesce(v_event.payload ->> 'rhythmKey', ''));
  v_task_action := lower(coalesce(v_event.payload #>> '{task,action}', ''));
  v_owner_attention :=
    lower(coalesce(v_event.payload ->> 'ownerAttentionRequired', 'false')) = 'true'
    or lower(coalesce(v_event.payload ->> 'needsOwnerDecision', 'false')) = 'true'
    or lower(coalesce(v_event.payload #>> '{task,ownerAttentionRequired}', 'false')) = 'true';

  v_task_id := coalesce(
    v_event.task_id,
    atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'taskId'),
    atlas.rhythm_safe_uuid_v1(v_event.payload #>> '{task,taskId}')
  );

  if v_task_id is not null then
    select task.* into v_task
    from atlas.tasks task
    where task.id = v_task_id;
  end if;

  if v_owner_attention then
    return 'owner_attention';
  end if;

  if v_task.id is not null then
    if v_task.status = 'blocked' then
      return 'owner_attention';
    end if;

    if v_task.status = 'open' then
      if v_task_action like '%awaiting_capacity%'
         or v_task_action in ('planned', 'held', 'held_for_day_budget') then
        return 'queued_work';
      end if;
      return 'selected_work';
    end if;

    return 'resolved';
  end if;

  if v_task_action like '%awaiting_capacity%'
     or v_task_action in ('planned', 'held', 'held_for_day_budget')
     or nullif(v_event.payload ->> 'plannedOccurrenceId', '') is not null then
    return 'queued_work';
  end if;

  if v_rhythm_key in (
    'weed_stewardship',
    'mowing',
    'harvest_watch',
    'germination_watch'
  ) then
    return 'monitoring_queue';
  end if;

  if v_event.importance = 'critical' then
    return 'owner_attention';
  end if;

  return 'exception';
end;
$function$;

create or replace function atlas.bell_event_is_worthy_v1(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select coalesce((
    select case
      when event.event_kind = 'owner_decision' then true
      when event.importance = 'critical' then true
      when event.event_kind = 'rhythm_warning' then false
      when event.event_kind in ('rhythm_due', 'rhythm_failure') then
        atlas.operational_rhythm_surface_v1(event.id) in ('owner_attention', 'exception')
      when event.event_kind in ('unlock', 'production_change') then true
      when event.event_kind = 'task_result'
        and event.source_event in ('reopened', 'blocked') then true
      when event.importance = 'attention' then true
      else false
    end
    from atlas.journal_event_index event
    where event.id = p_event_id
  ), false);
$function$;

create or replace function atlas.bell_event_requires_action_v1(
  p_event_id uuid,
  p_effective_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_event atlas.journal_event_index%rowtype;
  v_surface text;
  v_rhythm_state_id uuid;
  v_rhythm_state atlas.rhythm_state%rowtype;
  v_task_id uuid;
  v_task_status text;
  v_crop_lifecycle text;
begin
  select event.* into v_event
  from atlas.journal_event_index event
  where event.id = p_event_id;

  if v_event.id is null then
    return false;
  end if;

  if v_event.event_kind in ('rhythm_warning', 'rhythm_due', 'rhythm_failure') then
    v_surface := atlas.operational_rhythm_surface_v1(v_event.id);

    if v_surface in ('monitoring_queue', 'queued_work', 'selected_work', 'resolved') then
      return false;
    end if;

    if v_surface = 'owner_attention' then
      return true;
    end if;
  end if;

  if v_event.event_kind in ('rhythm_due', 'rhythm_failure') then
    v_rhythm_state_id := atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'rhythmStateId');
    if v_rhythm_state_id is null then
      return false;
    end if;

    select state.* into v_rhythm_state
    from atlas.rhythm_state state
    where state.id = v_rhythm_state_id;

    if v_rhythm_state.id is null
       or v_rhythm_state.state not in ('due', 'fallen_out_of_rhythm', 'recovering') then
      return false;
    end if;

    v_task_id := coalesce(
      v_rhythm_state.current_task_id,
      v_event.task_id,
      atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'taskId'),
      atlas.rhythm_safe_uuid_v1(v_event.payload #>> '{task,taskId}')
    );

    if v_task_id is not null then
      select task.status into v_task_status
      from atlas.tasks task
      where task.id = v_task_id;

      return v_task_status = 'blocked';
    end if;

    if v_rhythm_state.subject_kind = 'crop_cycle' then
      select cycle.lifecycle_status into v_crop_lifecycle
      from atlas.crop_cycles cycle
      where cycle.id = v_rhythm_state.subject_id;

      return v_crop_lifecycle is not null
        and v_crop_lifecycle not in ('archived', 'cancelled', 'retired', 'superseded');
    end if;

    return true;
  end if;

  v_task_id := coalesce(
    v_event.task_id,
    atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'taskId'),
    atlas.rhythm_safe_uuid_v1(v_event.payload #>> '{task,taskId}')
  );

  if v_task_id is not null then
    select task.status into v_task_status
    from atlas.tasks task
    where task.id = v_task_id;

    if v_task_status in ('open', 'blocked') and (
      v_event.event_kind = 'owner_decision'
      or v_event.importance in ('attention', 'critical')
      or v_event.assigned_user_id = p_effective_user_id
    ) then
      return true;
    end if;
  end if;

  return v_event.event_kind = 'owner_decision'
    or v_event.importance = 'critical';
end;
$function$;

create or replace function atlas.bell_event_why_v2(
  p_event_id uuid,
  p_effective_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_event atlas.journal_event_index%rowtype;
  v_surface text;
begin
  select event.* into v_event
  from atlas.journal_event_index event
  where event.id = p_event_id;

  if v_event.id is null then
    return 'Atlas recorded a meaningful change connected to work visible to this account.';
  end if;

  if v_event.event_kind in ('rhythm_warning', 'rhythm_due', 'rhythm_failure') then
    v_surface := atlas.operational_rhythm_surface_v1(v_event.id);

    if v_surface = 'owner_attention' then
      return 'Atlas handled the routine routing, but this blocked or exceptional condition now needs a human decision.';
    end if;
    if v_surface = 'selected_work' then
      return 'Atlas selected this work for the responsible account, so it belongs in Work rather than Bell.';
    end if;
    if v_surface = 'queued_work' then
      return 'Atlas retained this condition in the ranked operating queue until capacity makes it the next useful move.';
    end if;
    if v_surface = 'monitoring_queue' then
      return 'This clock caused Atlas to reconsider the condition internally; it does not require human attention by itself.';
    end if;
  end if;

  if v_event.source_event in ('harvest_horizon_entry', 'harvest_horizon_digest')
     or v_event.payload ->> 'surface' = 'harvest_horizon'
  then
    return 'One or more crop waves entered the next 21 days, so they now belong in Harvest planning rather than the daily Work list.';
  end if;
  if v_event.event_kind = 'owner_decision' then
    return 'A decision or problem handoff reached the Owner or manager responsible for the next move.';
  end if;
  if v_event.event_kind = 'unlock' then
    return 'A dependency cleared and made a next move available.';
  end if;
  if v_event.event_kind in ('task_result', 'maintenance_result') then
    if v_event.assigned_user_id = p_effective_user_id then
      return 'A result changed work assigned to this account.';
    end if;
    return 'Another player changed work in a farm or project visible to this account.';
  end if;
  if v_event.event_kind = 'production_change' then
    return 'A production state changed in a way Atlas considers meaningful to the selected account.';
  end if;
  return 'Atlas recorded a meaningful exception connected to work visible to this account.';
end;
$function$;

revoke all on function atlas.operational_rhythm_surface_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.operational_rhythm_surface_v1(uuid) to service_role;

comment on function atlas.operational_rhythm_surface_v1(uuid) is
  'Classifies a rhythm event as internal monitoring, queued work, selected work, resolved work, or a true owner exception. Routine operational state stays out of Bell.';
comment on function atlas.bell_event_is_worthy_v1(uuid) is
  'Bell worthiness contract: routine monitoring, queued capacity, and selected work stay on their operational surfaces; Bell receives only human decisions and true exceptions.';
comment on function atlas.bell_event_requires_action_v1(uuid, uuid) is
  'Returns true only when the effective human must intervene. Ordinary maintenance clocks and already-routed work return false.';

commit;
