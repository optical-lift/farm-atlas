create or replace function atlas.sync_bell_repair_events_v1(
  p_farm_id uuid,
  p_as_of_date date default null
) returns jsonb
language plpgsql
volatile security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_date date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_org uuid;
  v_packet_set jsonb;
  v_packet jsonb;
  v_event_key text;
  v_event_id uuid;
  v_existing record;
  v_current_keys text[]:=array[]::text[];
  v_created integer:=0;
  v_changed integer:=0;
  v_unchanged integer:=0;
  v_resolved integer:=0;
  v_reset_receipts integer:=0;
  v_rows integer:=0;
begin
  select f.organization_id into v_org from atlas.farms f where f.id=p_farm_id;
  if v_org is null then raise exception 'Farm not found.' using errcode='22023'; end if;

  v_packet_set:=atlas.bell_repair_packets_v1(p_farm_id,v_date);

  for v_packet in select value from jsonb_array_elements(coalesce(v_packet_set->'packets','[]'::jsonb))
  loop
    v_event_key:='reality_repair:'||coalesce(v_packet->>'repairKey','unclassified');
    v_current_keys:=array_append(v_current_keys,v_event_key);

    select e.id,e.source_event,e.payload->>'fingerprint' as fingerprint
      into v_existing
    from atlas.journal_event_index e
    where e.farm_id=p_farm_id and e.event_key=v_event_key
    limit 1;

    if v_existing.id is not null
       and v_existing.source_event='repair_required'
       and v_existing.fingerprint=coalesce(v_packet->>'fingerprint','') then
      v_unchanged:=v_unchanged+1;
      continue;
    end if;

    v_event_id:=atlas.upsert_journal_event_v1(
      v_org,p_farm_id,v_event_key,'system_event','reality_repair',p_farm_id,'repair_required',
      now(),v_date,coalesce(v_packet->>'title','Repair reality divergence'),
      concat_ws(' ',nullif(v_packet->>'differenceSummary',''),nullif(v_packet->>'consequence','')),
      'management','attention',null,null,null,null,null,null,null,
      v_packet||jsonb_build_object('repairState','open'),
      jsonb_build_object('contractVersion','bell_repair_routing_v1','packetContract',v_packet->>'contractVersion','syncedAt',now()),
      null
    );

    if v_existing.id is null then
      v_created:=v_created+1;
    else
      v_changed:=v_changed+1;
      update atlas.bell_event_receipts r
      set read_at=null,acknowledged_at=null,updated_at=now()
      where r.journal_event_id=v_event_id;
      get diagnostics v_rows=row_count;
      v_reset_receipts:=v_reset_receipts+v_rows;
    end if;
  end loop;

  update atlas.journal_event_index e
  set source_event='repair_resolved',
      importance='normal',
      occurred_at=now(),
      journal_date=v_date,
      payload=coalesce(e.payload,'{}'::jsonb)||jsonb_build_object('repairState','resolved','resolvedAt',now()),
      provenance=coalesce(e.provenance,'{}'::jsonb)||jsonb_build_object('resolvedBy','atlas.sync_bell_repair_events_v1','resolvedAt',now()),
      updated_at=now()
  where e.farm_id=p_farm_id
    and e.source_kind='reality_repair'
    and e.source_event='repair_required'
    and not (e.event_key=any(v_current_keys));
  get diagnostics v_resolved=row_count;

  return jsonb_build_object(
    'contractVersion','sync_bell_repair_events_v1',
    'farmId',p_farm_id,
    'asOfDate',v_date,
    'activeRepairCount',coalesce((v_packet_set->>'packetCount')::integer,0),
    'created',v_created,
    'materiallyChangedOrReopened',v_changed,
    'unchanged',v_unchanged,
    'resolved',v_resolved,
    'receiptStatesReset',v_reset_receipts,
    'truthBoundary',jsonb_build_object(
      'unchangedRepairDoesNotCreateNewBellNoise',true,
      'materialChangeMayReopenUnreadAttention',true,
      'resolvedDivergenceLeavesCurrentAttention',true,
      'syncDoesNotAssignWorkerBlame',true,
      'syncDoesNotCreatePrincipalWork',true
    )
  );
end;
$$;

create or replace function atlas.bell_event_is_worthy_v1(p_event_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
  select coalesce((
    select case
      when event.source_kind='reality_repair' then event.source_event='repair_required'
      when event.event_kind='owner_decision' then true
      when event.event_kind='rhythm_warning' then false
      when event.event_kind in ('rhythm_due','rhythm_failure') then atlas.operational_rhythm_surface_v1(event.id) in ('owner_attention','exception')
      when event.importance='critical' then true
      when event.event_kind in ('unlock','production_change') then true
      when event.event_kind='task_result' and event.source_event in ('reopened','blocked') then true
      when event.importance='attention' then true
      else false
    end
    from atlas.journal_event_index event where event.id=p_event_id
  ),false);
$$;

create or replace function atlas.bell_event_obligation_key_v2(p_event_id uuid)
returns text
language sql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
  select coalesce((
    select case
      when event.source_kind='reality_repair' then 'repair:'||coalesce(nullif(event.payload->>'repairKey',''),event.event_key,event.id::text)
      when event.event_kind in ('rhythm_warning','rhythm_due','rhythm_failure') then
        'rhythm:'||coalesce(nullif(event.payload->>'rhythmStateId',''),nullif(event.payload->>'rhythm_state_id',''),event.source_id::text,event.id::text)
      when event.task_id is not null then 'task:'||event.task_id::text
      when nullif(event.payload->>'taskId','') is not null then 'task:'||(event.payload->>'taskId')
      when nullif(event.payload#>>'{task,taskId}','') is not null then 'task:'||(event.payload#>>'{task,taskId}')
      when event.object_id is not null then 'object:'||event.object_id::text||':'||event.event_kind
      when event.project_id is not null then 'project:'||event.project_id::text||':'||event.event_kind
      else 'event:'||event.id::text
    end
    from atlas.journal_event_index event where event.id=p_event_id
  ),'event:'||p_event_id::text);
$$;

create or replace function atlas.bell_event_requires_action_v1(p_event_id uuid,p_effective_user_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_event atlas.journal_event_index%rowtype;
  v_surface text;
  v_rhythm_state_id uuid;
  v_rhythm_state atlas.rhythm_state%rowtype;
  v_task_id uuid;
  v_task_status text;
  v_crop_lifecycle text;
begin
  select event.* into v_event from atlas.journal_event_index event where event.id=p_event_id;
  if v_event.id is null then return false; end if;

  if v_event.source_kind='reality_repair' then
    return v_event.source_event='repair_required'
      and coalesce((v_event.payload#>>'{repairRoute,humanActionRequired}')::boolean,false)
      and coalesce(v_event.payload->>'repairState','open')='open';
  end if;

  if v_event.event_kind in ('rhythm_warning','rhythm_due','rhythm_failure') then
    v_surface:=atlas.operational_rhythm_surface_v1(v_event.id);
    if v_surface in ('monitoring_queue','queued_work','selected_work','resolved') then return false; end if;
    if v_surface='owner_attention' then return true; end if;
  end if;

  if v_event.event_kind in ('rhythm_due','rhythm_failure') then
    v_rhythm_state_id:=atlas.rhythm_safe_uuid_v1(v_event.payload->>'rhythmStateId');
    if v_rhythm_state_id is null then return false; end if;
    select state.* into v_rhythm_state from atlas.rhythm_state state where state.id=v_rhythm_state_id;
    if v_rhythm_state.id is null or v_rhythm_state.state not in ('due','fallen_out_of_rhythm','recovering') then return false; end if;
    v_task_id:=coalesce(v_rhythm_state.current_task_id,v_event.task_id,atlas.rhythm_safe_uuid_v1(v_event.payload->>'taskId'),atlas.rhythm_safe_uuid_v1(v_event.payload#>>'{task,taskId}'));
    if v_task_id is not null then
      select task.status into v_task_status from atlas.tasks task where task.id=v_task_id;
      return v_task_status='blocked';
    end if;
    if v_rhythm_state.subject_kind='crop_cycle' then
      select cycle.lifecycle_status into v_crop_lifecycle from atlas.crop_cycles cycle where cycle.id=v_rhythm_state.subject_id;
      return v_crop_lifecycle is not null and v_crop_lifecycle not in ('archived','cancelled','retired','superseded');
    end if;
    return true;
  end if;

  v_task_id:=coalesce(v_event.task_id,atlas.rhythm_safe_uuid_v1(v_event.payload->>'taskId'),atlas.rhythm_safe_uuid_v1(v_event.payload#>>'{task,taskId}'));
  if v_task_id is not null then
    select task.status into v_task_status from atlas.tasks task where task.id=v_task_id;
    if v_task_status in ('open','blocked') and (
      v_event.event_kind='owner_decision' or v_event.importance in ('attention','critical') or v_event.assigned_user_id=p_effective_user_id
    ) then return true; end if;
  end if;
  return v_event.event_kind='owner_decision' or v_event.importance='critical';
end;
$$;

create or replace function atlas.bell_event_why_v2(p_event_id uuid,p_effective_user_id uuid)
returns text
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_event atlas.journal_event_index%rowtype;
  v_surface text;
begin
  select event.* into v_event from atlas.journal_event_index event where event.id=p_event_id;
  if v_event.id is null then return 'Atlas recorded a meaningful change connected to work visible to this account.'; end if;

  if v_event.source_kind='reality_repair' then
    return concat_ws(' ',
      nullif(v_event.payload->>'differenceSummary',''),
      nullif(v_event.payload->>'consequence',''),
      'Repair custody: '||coalesce(v_event.payload#>>'{owningFunction,domain}','Farm Operations')||'.'||coalesce(v_event.payload#>>'{owningFunction,function}','classify_repair_ownership')||'.',
      'This identifies the function responsible for repair; it does not establish worker fault.'
    );
  end if;

  if v_event.event_kind in ('rhythm_warning','rhythm_due','rhythm_failure') then
    v_surface:=atlas.operational_rhythm_surface_v1(v_event.id);
    if v_surface='owner_attention' then return 'Atlas handled the routine routing, but this blocked or exceptional condition now needs a human decision.'; end if;
    if v_surface='selected_work' then return 'Atlas selected this work for the responsible account, so it belongs in Work rather than Bell.'; end if;
    if v_surface='queued_work' then return 'Atlas retained this condition in the ranked operating queue until capacity makes it the next useful move.'; end if;
    if v_surface='monitoring_queue' then return 'This clock caused Atlas to reconsider the condition internally; it does not require human attention by itself.'; end if;
  end if;
  if v_event.source_event in ('harvest_horizon_entry','harvest_horizon_digest') or v_event.payload->>'surface'='harvest_horizon' then
    return 'One or more crop waves entered the next 21 days, so they now belong in Harvest planning rather than the daily Work list.';
  end if;
  if v_event.event_kind='owner_decision' then return 'A decision or problem handoff reached the Owner or manager responsible for the next move.'; end if;
  if v_event.event_kind='unlock' then return 'A dependency cleared and made a next move available.'; end if;
  if v_event.event_kind in ('task_result','maintenance_result') then
    if v_event.assigned_user_id=p_effective_user_id then return 'A result changed work assigned to this account.'; end if;
    return 'Another player changed work in a farm or project visible to this account.';
  end if;
  if v_event.event_kind='production_change' then return 'A production state changed in a way Atlas considers meaningful to the selected account.'; end if;
  return 'Atlas recorded a meaningful exception connected to work visible to this account.';
end;
$$;

do $$
declare v_def text; v_original text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='bell_history_v2'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_effective_membership_id uuid, p_limit integer, p_before timestamp with time zone';
  if v_def is null then raise exception 'bell_history_v2 not found'; end if;
  v_original:=v_def;
  v_def:=replace(v_def,
$needle$when not v_is_management then '~'
          when item.event_kind = 'rhythm_failure' then '!'$needle$,
$replacement$when not v_is_management then '~'
          when item.source_kind = 'reality_repair' then '!'
          when item.event_kind = 'rhythm_failure' then '!'$replacement$);
  if v_def=v_original then raise exception 'Bell v2 symbol insertion point not found'; end if;
  execute v_def;
end $$;

do $$
declare v_def text; v_original text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='bell_history_v4'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_effective_membership_id uuid, p_limit integer, p_before timestamp with time zone';
  if v_def is null then raise exception 'bell_history_v4 not found'; end if;
  v_original:=v_def;
  v_def:=replace(v_def,
$needle$begin
  v_base := atlas.bell_history_v3$needle$,
$replacement$begin
  perform atlas.sync_bell_repair_events_v1(p_farm_id,(now() at time zone 'America/Chicago')::date);

  v_base := atlas.bell_history_v3$replacement$);
  if v_def=v_original then raise exception 'Bell v4 repair sync insertion point not found'; end if;
  execute v_def;
end $$;

revoke all on function atlas.sync_bell_repair_events_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.sync_bell_repair_events_v1(uuid,date) to service_role;

comment on function atlas.sync_bell_repair_events_v1(uuid,date) is
'Phase 13 Bell obligation sync. Upserts one evolving management repair obligation per stable repairKey, leaves unchanged conditions quiet, reopens materially changed conditions, and resolves obligations when the source divergence disappears. It never assigns worker blame or creates Principal work.';