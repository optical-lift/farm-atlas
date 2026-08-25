create or replace function atlas.sales_outreach_inventory_gate_evaluation_v1(
  p_farm_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_available boolean;
  v_timezone text := 'America/Chicago';
  v_today date;
  v_tasks jsonb := '[]'::jsonb;
begin
  if p_farm_id is null then
    raise exception 'Farm is required.' using errcode='22023';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms f
  where f.id=p_farm_id;

  v_today := (now() at time zone coalesce(v_timezone,'America/Chicago'))::date;
  v_available := atlas.has_positive_ready_flower_inventory_v1(p_farm_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'taskId',t.id,
      'taskStatus',t.status,
      'assignedMembershipId',t.assigned_membership_id,
      'parentTaskId',t.parent_task_id,
      'prerequisitesReady',atlas.task_prerequisites_ready_v1(t.id),
      'eligibleForRelease',v_available and t.status='blocked' and atlas.task_prerequisites_ready_v1(t.id)
    ) order by case when t.parent_task_id is null then 0 else 1 end,t.created_at,t.id
  ),'[]'::jsonb)
  into v_tasks
  from atlas.tasks t
  where t.farm_id=p_farm_id
    and coalesce(t.metadata->>'sales_inventory_gate','')='ready_flower_inventory'
    and t.status<>'archived';

  return jsonb_build_object(
    'contractVersion','sales_outreach_inventory_gate_evaluation_v1',
    'farmId',p_farm_id,
    'state',case when v_available then 'ready' else 'waiting_for_inventory' end,
    'inventoryAvailable',v_available,
    'evaluatedDate',v_today,
    'tasks',v_tasks,
    'truthBoundary',jsonb_build_object(
      'readOnly',true,
      'inventoryTruthProvider','atlas.has_positive_ready_flower_inventory_v1',
      'prerequisiteTruthProvider','atlas.task_prerequisites_ready_v1',
      'evaluationDoesNotMutateTask',true,
      'evaluationDoesNotExecuteEffect',true
    )
  );
end;
$function$;

revoke execute on function atlas.sales_outreach_inventory_gate_evaluation_v1(uuid)
from public, anon, authenticated, service_role;

create or replace function atlas.apply_sales_outreach_inventory_gate_effect_v1(
  p_farm_id uuid,
  p_evaluation jsonb,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_state text;
  v_today date;
  v_task jsonb;
  v_task_id uuid;
  v_membership_id uuid;
  v_release_date date;
  v_released integer := 0;
  v_held integer := 0;
begin
  if p_evaluation is null or jsonb_typeof(p_evaluation)<>'object' then
    raise exception 'Sales inventory effect requires an evaluation object.' using errcode='22023';
  end if;
  if p_evaluation->>'contractVersion'<>'sales_outreach_inventory_gate_evaluation_v1' then
    raise exception 'Sales inventory effect requires the canonical evaluation contract.' using errcode='23514';
  end if;
  if p_evaluation->>'farmId' is distinct from p_farm_id::text then
    raise exception 'Sales inventory evaluation does not belong to this farm.' using errcode='23514';
  end if;
  if jsonb_typeof(p_evaluation->'tasks')<>'array' then
    raise exception 'Sales inventory evaluation requires a task projection set.' using errcode='23514';
  end if;

  v_state := p_evaluation->>'state';
  if v_state not in ('waiting_for_inventory','ready') then
    raise exception 'Sales inventory evaluation state is invalid.' using errcode='23514';
  end if;

  begin
    v_today := (p_evaluation->>'evaluatedDate')::date;
  exception when others then
    raise exception 'Sales inventory evaluation date is invalid.' using errcode='23514';
  end;

  for v_task in select value from jsonb_array_elements(p_evaluation->'tasks') loop
    begin
      v_task_id := nullif(v_task->>'taskId','')::uuid;
    exception when others then
      raise exception 'Sales inventory evaluation task id is invalid.' using errcode='23514';
    end;
    if v_task_id is null then
      raise exception 'Sales inventory evaluation task id is required.' using errcode='23514';
    end if;

    if v_state='waiting_for_inventory' then
      update atlas.tasks t
      set status=case when t.status='done' then t.status else 'blocked' end,
          due_date=case when t.status='done' then t.due_date else null end,
          blocker_text=case when t.status='done' then t.blocker_text else 'Waiting for ready flower inventory before florist sales outreach is released.' end,
          visibility_scope=case when t.status='done' then t.visibility_scope else 'system_internal' end,
          metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
            'sales_inventory_gate','ready_flower_inventory',
            'sales_inventory_gate_state','waiting_for_inventory',
            'outreach_release_state','waiting_for_inventory',
            'sales_inventory_effect_contract','sales_outreach_inventory_gate_effect_v1'
          ),
          updated_at=p_as_of
      where t.id=v_task_id
        and t.farm_id=p_farm_id
        and coalesce(t.metadata->>'sales_inventory_gate','')='ready_flower_inventory'
        and t.status<>'archived';
      if found then v_held:=v_held+1; end if;
      continue;
    end if;

    if coalesce((v_task->>'eligibleForRelease')::boolean,false) then
      begin
        v_membership_id:=nullif(v_task->>'assignedMembershipId','')::uuid;
      exception when others then
        v_membership_id:=null;
      end;
      v_release_date:=case
        when v_membership_id is null then v_today
        else atlas.worker_day_on_or_after_v1(p_farm_id,v_membership_id,v_today)
      end;

      update atlas.tasks t
      set status='open',
          due_date=v_release_date,
          blocker_text=null,
          visibility_scope='assigned_worker',
          released_at=coalesce(released_at,p_as_of),
          release_reason='sales_inventory_gate_satisfied',
          metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
            'sales_inventory_gate','ready_flower_inventory',
            'sales_inventory_gate_state','released',
            'sales_inventory_gate_satisfied_at',p_as_of,
            'outreach_release_state','released',
            'execution_date',v_release_date,
            'sales_inventory_effect_contract','sales_outreach_inventory_gate_effect_v1'
          ),
          updated_at=p_as_of
      where t.id=v_task_id
        and t.farm_id=p_farm_id
        and t.status='blocked'
        and coalesce(t.metadata->>'sales_inventory_gate','')='ready_flower_inventory';
      if found then v_released:=v_released+1; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'contractVersion','sales_outreach_inventory_gate_effect_v1',
    'farmId',p_farm_id,
    'state',v_state,
    'inventoryAvailable',v_state='ready',
    'releasedCount',v_released,
    'heldCount',v_held
  );
end;
$function$;

revoke execute on function atlas.apply_sales_outreach_inventory_gate_effect_v1(uuid,jsonb,timestamptz)
from public, anon, authenticated, service_role;

create or replace function atlas.reconcile_sales_outreach_inventory_gate_v1(
  p_farm_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_evaluation jsonb;
begin
  v_evaluation:=atlas.sales_outreach_inventory_gate_evaluation_v1(p_farm_id);
  return atlas.apply_sales_outreach_inventory_gate_effect_v1(p_farm_id,v_evaluation,now());
end;
$function$;

create or replace function atlas.sync_outreach_worker_visibility_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $function$
declare
  v_gate_state text;
begin
  if coalesce(new.metadata->>'outreach_queue_key','')='anna_outreach_conveyor' then
    v_gate_state:=coalesce(new.metadata->>'sales_inventory_gate_state','');

    if v_gate_state='waiting_for_inventory' then
      new.status:='blocked';
      new.due_date:=null;
      new.blocker_text:='Waiting for ready flower inventory before florist sales outreach is released.';
      new.visibility_scope:='system_internal';
      new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
        'outreach_release_state','waiting_for_inventory'
      );
    elsif v_gate_state='released'
       and new.status='open'
       and new.due_date is not null then
      new.visibility_scope:='assigned_worker';
    elsif new.status='blocked'
       and new.due_date is null
       and coalesce(new.metadata->>'outreach_release_state','') in ('queued','waiting_for_inventory') then
      new.visibility_scope:='system_internal';
    end if;
  end if;
  return new;
end;
$function$;
