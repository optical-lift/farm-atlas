create table if not exists atlas.task_external_readiness_gates (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  readiness_key text not null,
  readiness_label text not null,
  gate_state text not null default 'waiting' check (gate_state in ('waiting','ready','retired')),
  blocker_text text not null,
  restore_status text not null default 'open',
  restore_visibility_scope text not null default 'assigned_worker',
  restore_due_date date,
  ready_at timestamptz,
  ready_by_user_id uuid,
  evidence_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id)
);

alter table atlas.task_external_readiness_gates enable row level security;
revoke all on atlas.task_external_readiness_gates from public,anon,authenticated;
grant select,insert,update,delete on atlas.task_external_readiness_gates to service_role;

create index if not exists task_external_readiness_gates_waiting_idx
  on atlas.task_external_readiness_gates(farm_id,gate_state)
  where gate_state='waiting';

create or replace function atlas.refresh_task_external_readiness_gate_v1(p_gate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_gate atlas.task_external_readiness_gates%rowtype;
  v_task atlas.tasks%rowtype;
  v_today date;
  v_restore_due date;
  v_occurrence_id uuid;
  v_payload_metadata jsonb;
begin
  select * into v_gate
  from atlas.task_external_readiness_gates gate_row
  where gate_row.id=p_gate_id
  for update;

  if v_gate.id is null then
    raise exception 'External readiness gate not found.' using errcode='P0002';
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=v_gate.task_id
  for update;

  if v_task.id is null then
    update atlas.task_external_readiness_gates
    set gate_state='retired',updated_at=now(),metadata=metadata||jsonb_build_object('retired_reason','task_missing')
    where id=v_gate.id;
    return jsonb_build_object('gateId',v_gate.id,'state','retired','changed',true);
  end if;

  if v_task.status in ('done','skipped') then
    update atlas.task_external_readiness_gates
    set gate_state='retired',updated_at=now(),metadata=metadata||jsonb_build_object('retired_reason','task_terminal')
    where id=v_gate.id;
    return jsonb_build_object('gateId',v_gate.id,'state','retired','changed',true,'taskId',v_task.id);
  end if;

  v_today := (now() at time zone coalesce((select nullif(f.metadata->>'timezone','') from atlas.farms f where f.id=v_gate.farm_id),'America/Chicago'))::date;
  v_occurrence_id := v_task.planned_occurrence_id;

  if v_gate.gate_state='waiting' then
    if v_task.status<>'archived' then
      update atlas.tasks task
      set status='blocked',
          due_date=null,
          visibility_scope='system_internal',
          blocker_text=v_gate.blocker_text,
          metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
            'external_readiness_required',true,
            'external_readiness_gate_id',v_gate.id,
            'external_readiness_key',v_gate.readiness_key,
            'external_readiness_label',v_gate.readiness_label,
            'external_readiness_state','waiting',
            'external_readiness_checked_at',now()
          ),
          updated_at=now()
      where task.id=v_task.id;
    end if;

    if v_occurrence_id is not null then
      update atlas.planned_work_occurrences occurrence
      set state=case when occurrence.state in ('completed','cancelled') then occurrence.state else 'planned' end,
          gate_satisfied_at=case when occurrence.state in ('completed','cancelled') then occurrence.gate_satisfied_at else null end,
          released_at=case when occurrence.state in ('completed','cancelled') then occurrence.released_at else null end,
          released_task_id=case when occurrence.state in ('completed','cancelled') then occurrence.released_task_id else null end,
          task_payload=jsonb_set(
            jsonb_set(
              coalesce(occurrence.task_payload,'{}'::jsonb),
              '{metadata}',
              coalesce(occurrence.task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
                'external_readiness_required',true,
                'external_readiness_gate_id',v_gate.id,
                'external_readiness_key',v_gate.readiness_key,
                'external_readiness_label',v_gate.readiness_label,
                'external_readiness_state','waiting'
              ),
              true
            ),
            '{status}',to_jsonb('open'::text),true
          ),
          metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
            'externalReadinessGateId',v_gate.id,
            'externalReadinessState','waiting',
            'externalReadinessHeldAt',now()
          ),
          updated_at=now()
      where occurrence.id=v_occurrence_id;
    end if;

    return jsonb_build_object('gateId',v_gate.id,'state','waiting','changed',true,'taskId',v_task.id,'occurrenceId',v_occurrence_id);
  end if;

  if v_gate.gate_state='ready' then
    v_restore_due := v_gate.restore_due_date;
    if v_restore_due is null or v_restore_due<v_today then
      if v_task.assigned_membership_id is not null then
        v_restore_due := atlas.worker_day_on_or_after_v1(v_gate.farm_id,v_task.assigned_membership_id,v_today);
      else
        v_restore_due := v_today;
      end if;
    end if;

    update atlas.tasks task
    set status=v_gate.restore_status,
        due_date=v_restore_due,
        visibility_scope=v_gate.restore_visibility_scope,
        blocker_text=null,
        released_at=coalesce(task.released_at,now()),
        release_reason='external_readiness_satisfied',
        metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
          'external_readiness_required',true,
          'external_readiness_gate_id',v_gate.id,
          'external_readiness_key',v_gate.readiness_key,
          'external_readiness_label',v_gate.readiness_label,
          'external_readiness_state','ready',
          'external_readiness_satisfied_at',coalesce(v_gate.ready_at,now()),
          'execution_date',v_restore_due
        ),
        updated_at=now()
    where task.id=v_task.id;

    if v_occurrence_id is not null then
      v_payload_metadata := coalesce((select occurrence.task_payload->'metadata' from atlas.planned_work_occurrences occurrence where occurrence.id=v_occurrence_id),'{}'::jsonb)
        ||jsonb_build_object(
          'external_readiness_required',true,
          'external_readiness_gate_id',v_gate.id,
          'external_readiness_key',v_gate.readiness_key,
          'external_readiness_label',v_gate.readiness_label,
          'external_readiness_state','ready',
          'execution_date',v_restore_due
        );

      update atlas.planned_work_occurrences occurrence
      set state=case when occurrence.state in ('completed','cancelled') then occurrence.state else 'released' end,
          planned_due_date=case when occurrence.state in ('completed','cancelled') then occurrence.planned_due_date else v_restore_due end,
          not_before_date=case when occurrence.state in ('completed','cancelled') then occurrence.not_before_date else least(coalesce(occurrence.not_before_date,v_restore_due),v_restore_due) end,
          gate_satisfied_at=case when occurrence.state in ('completed','cancelled') then occurrence.gate_satisfied_at else coalesce(v_gate.ready_at,now()) end,
          released_at=case when occurrence.state in ('completed','cancelled') then occurrence.released_at else now() end,
          released_task_id=case when occurrence.state in ('completed','cancelled') then occurrence.released_task_id else v_task.id end,
          task_payload=jsonb_set(
            jsonb_set(
              jsonb_set(coalesce(occurrence.task_payload,'{}'::jsonb),'{metadata}',v_payload_metadata,true),
              '{status}',to_jsonb('open'::text),true
            ),
            '{due_date}',to_jsonb(v_restore_due::text),true
          ),
          metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
            'externalReadinessGateId',v_gate.id,
            'externalReadinessState','ready',
            'externalReadinessSatisfiedAt',coalesce(v_gate.ready_at,now())
          ),
          updated_at=now()
      where occurrence.id=v_occurrence_id;
    end if;

    return jsonb_build_object('gateId',v_gate.id,'state','ready','changed',true,'taskId',v_task.id,'occurrenceId',v_occurrence_id,'dueDate',v_restore_due);
  end if;

  return jsonb_build_object('gateId',v_gate.id,'state',v_gate.gate_state,'changed',false,'taskId',v_task.id);
end;
$function$;

revoke all on function atlas.refresh_task_external_readiness_gate_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.refresh_task_external_readiness_gate_v1(uuid) to service_role;

create or replace function atlas.sync_task_external_readiness_gate_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_gate_id uuid;
  v_required boolean:=coalesce((new.metadata->>'external_readiness_required')::boolean,false);
  v_state text:=lower(coalesce(nullif(new.metadata->>'external_readiness_state',''),'waiting'));
  v_old_required boolean:=case when tg_op='UPDATE' then coalesce((old.metadata->>'external_readiness_required')::boolean,false) else false end;
  v_old_state text:=case when tg_op='UPDATE' then lower(coalesce(nullif(old.metadata->>'external_readiness_state',''),'waiting')) else null end;
begin
  if not v_required then
    if tg_op='UPDATE' and v_old_required then
      update atlas.task_external_readiness_gates
      set gate_state='retired',updated_at=now(),metadata=metadata||jsonb_build_object('retired_reason','external_readiness_requirement_removed')
      where task_id=new.id and gate_state<>'retired';
    end if;
    return new;
  end if;

  if v_state not in ('waiting','ready') then
    raise exception 'external_readiness_state must be waiting or ready.' using errcode='23514';
  end if;

  insert into atlas.task_external_readiness_gates(
    farm_id,task_id,readiness_key,readiness_label,gate_state,blocker_text,
    restore_status,restore_visibility_scope,restore_due_date,metadata
  ) values (
    new.farm_id,new.id,
    coalesce(nullif(new.metadata->>'external_readiness_key',''),coalesce(nullif(new.metadata->>'task_key',''),new.id::text)||':external-readiness'),
    coalesce(nullif(new.metadata->>'external_readiness_label',''),'External readiness confirmed'),
    v_state,
    coalesce(nullif(new.blocker_text,''),'Waiting for external readiness.'),
    'open',
    case when new.visibility_scope='system_internal' then 'assigned_worker' else new.visibility_scope end,
    new.due_date,
    jsonb_build_object('source','task_external_readiness_metadata')
  )
  on conflict(task_id) do update
  set readiness_key=excluded.readiness_key,
      readiness_label=excluded.readiness_label,
      blocker_text=excluded.blocker_text,
      gate_state=case when atlas.task_external_readiness_gates.gate_state='retired' then excluded.gate_state else atlas.task_external_readiness_gates.gate_state end,
      restore_due_date=coalesce(atlas.task_external_readiness_gates.restore_due_date,excluded.restore_due_date),
      updated_at=now()
  returning id into v_gate_id;

  if tg_op='INSERT' or not v_old_required or v_old_state is distinct from v_state then
    update atlas.task_external_readiness_gates
    set gate_state=v_state,
        ready_at=case when v_state='ready' then coalesce(ready_at,now()) else null end,
        updated_at=now()
    where id=v_gate_id;
    perform atlas.refresh_task_external_readiness_gate_v1(v_gate_id);
  end if;

  return new;
end;
$function$;

revoke all on function atlas.sync_task_external_readiness_gate_v1() from public,anon,authenticated;
grant execute on function atlas.sync_task_external_readiness_gate_v1() to service_role;

drop trigger if exists sync_task_external_readiness_gate_v1 on atlas.tasks;
create trigger sync_task_external_readiness_gate_v1
after insert or update of metadata on atlas.tasks
for each row
execute function atlas.sync_task_external_readiness_gate_v1();

create or replace function atlas.owner_set_external_readiness_v1(
  p_task_id uuid,
  p_state text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_gate_id uuid;
  v_state text:=lower(btrim(coalesce(p_state,'')));
begin
  if v_state not in ('waiting','ready') then
    raise exception 'External readiness state must be waiting or ready.' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then
    raise exception 'Task not found.' using errcode='P0002';
  end if;
  if not atlas.is_farm_owner(v_task.farm_id) then
    raise exception 'Owner membership required.' using errcode='42501';
  end if;
  if not coalesce((v_task.metadata->>'external_readiness_required')::boolean,false) then
    raise exception 'This task does not declare external readiness.' using errcode='22023';
  end if;

  select gate.id into v_gate_id
  from atlas.task_external_readiness_gates gate
  where gate.task_id=v_task.id
  for update;

  if v_gate_id is null then
    insert into atlas.task_external_readiness_gates(
      farm_id,task_id,readiness_key,readiness_label,gate_state,blocker_text,
      restore_status,restore_visibility_scope,restore_due_date,metadata
    ) values (
      v_task.farm_id,v_task.id,
      coalesce(nullif(v_task.metadata->>'external_readiness_key',''),coalesce(nullif(v_task.metadata->>'task_key',''),v_task.id::text)||':external-readiness'),
      coalesce(nullif(v_task.metadata->>'external_readiness_label',''),'External readiness confirmed'),
      v_state,
      coalesce(nullif(v_task.blocker_text,''),'Waiting for external readiness.'),
      'open','assigned_worker',v_task.due_date,jsonb_build_object('source','owner_set_external_readiness_v1')
    ) returning id into v_gate_id;
  end if;

  update atlas.task_external_readiness_gates
  set gate_state=v_state,
      ready_at=case when v_state='ready' then now() else null end,
      ready_by_user_id=case when v_state='ready' then auth.uid() else null end,
      evidence_note=nullif(btrim(coalesce(p_note,'')),''),
      metadata=metadata||jsonb_build_object('last_owner_change_at',now(),'last_owner_state',v_state),
      updated_at=now()
  where id=v_gate_id;

  update atlas.tasks
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('external_readiness_state',v_state),updated_at=now()
  where id=v_task.id;

  return atlas.refresh_task_external_readiness_gate_v1(v_gate_id);
end;
$function$;

revoke all on function atlas.owner_set_external_readiness_v1(uuid,text,text) from public,anon;
grant execute on function atlas.owner_set_external_readiness_v1(uuid,text,text) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values (
  'atlas.owner_set_external_readiness_v1(uuid, text, text)',
  'owner_admin_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object(
    'purpose','Resolve a real-world external readiness gate before worker work is released.',
    'boundary','Farm Owner only; waiting work is system-internal and cannot be completed by the worker.',
    'release','ready restores the same canonical task identity instead of creating a shadow task.'
  ),now(),now()
)
on conflict(signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    evidence=excluded.evidence,
    reviewed_at=now();

do $block$
declare
  v_def text;
  v_patched text;
begin
  select pg_get_functiondef('atlas.work_occurrence_gate_satisfied_v1(uuid,date)'::regprocedure) into v_def;
  v_patched:=replace(
    v_def,
    E'    when exists(select 1 from atlas.task_release_queue_items qi where qi.planned_occurrence_id=occurrence.id and qi.state=''queued'') then exists(',
    E'    when exists(\n      select 1\n      from atlas.task_external_readiness_gates external_gate\n      join atlas.tasks external_task on external_task.id=external_gate.task_id\n      where external_task.planned_occurrence_id=occurrence.id\n        and external_gate.gate_state=''waiting''\n    ) then false\n    when exists(select 1 from atlas.task_release_queue_items qi where qi.planned_occurrence_id=occurrence.id and qi.state=''queued'') then exists('
  );
  if v_patched=v_def then
    raise exception 'work_occurrence_gate_satisfied_v1 insertion point was not found';
  end if;
  execute v_patched;
end;
$block$;

do $block$
declare
  v_task atlas.tasks%rowtype;
  v_gate_id uuid;
begin
  select * into v_task
  from atlas.tasks
  where metadata->>'task_key'='anna_20260807_home_depot_curbside_pickup'
  order by created_at desc
  limit 1;

  if v_task.id is null then
    raise exception 'Home Depot pickup task not found; refusing partial external-readiness migration.';
  end if;
  if not coalesce((v_task.metadata->>'external_readiness_required')::boolean,false) then
    raise exception 'Home Depot task no longer declares external readiness; refusing to infer a blocker.';
  end if;

  insert into atlas.task_external_readiness_gates(
    farm_id,task_id,readiness_key,readiness_label,gate_state,blocker_text,
    restore_status,restore_visibility_scope,restore_due_date,metadata
  ) values (
    v_task.farm_id,v_task.id,
    'home_depot_order_ready_for_pickup',
    coalesce(nullif(v_task.metadata->>'external_readiness_label',''),'Home Depot order ready for pickup'),
    case when lower(coalesce(v_task.metadata->>'external_readiness_state','waiting'))='ready' then 'ready' else 'waiting' end,
    coalesce(nullif(v_task.blocker_text,''),'Home Depot order is not ready for pickup yet.'),
    'open','assigned_worker',v_task.due_date,
    jsonb_build_object('source','home_depot_external_readiness_repair','installed_at',now())
  )
  on conflict(task_id) do update
  set readiness_key=excluded.readiness_key,
      readiness_label=excluded.readiness_label,
      blocker_text=excluded.blocker_text,
      restore_status=excluded.restore_status,
      restore_visibility_scope=excluded.restore_visibility_scope,
      restore_due_date=coalesce(atlas.task_external_readiness_gates.restore_due_date,excluded.restore_due_date),
      metadata=atlas.task_external_readiness_gates.metadata||excluded.metadata,
      updated_at=now()
  returning id into v_gate_id;

  perform atlas.refresh_task_external_readiness_gate_v1(v_gate_id);
end;
$block$;
