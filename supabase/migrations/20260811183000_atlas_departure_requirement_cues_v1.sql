-- Departure/readiness cue completion v1
-- Promotes buried bring/load prose into canonical task resource requirements and
-- generates Before cues from that resource truth. Requirement answers can block
-- the destination move without manufacturing worker failure history.

create or replace function atlas.apply_worker_day_requirement_confirmation_v1(
  p_cue_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_cue atlas.worker_day_cues%rowtype;
  v_task atlas.tasks%rowtype;
  v_task_id uuid;
  v_choice text;
  v_blocked_by_requirement boolean:=false;
begin
  select * into v_cue from atlas.worker_day_cues where id=p_cue_id for update;
  if v_cue.id is null then
    raise exception 'Cue was not found.' using errcode='P0002';
  end if;

  begin
    v_task_id:=nullif(v_cue.result_contract->>'taskId','')::uuid;
  exception when invalid_text_representation then
    raise exception 'Requirement cue task id is invalid.' using errcode='22023';
  end;

  select * into v_task
  from atlas.tasks task
  where task.id=v_task_id
    and task.farm_id=v_cue.farm_id
    and task.assigned_membership_id=v_cue.membership_id
  for update;
  if v_task.id is null then
    raise exception 'Requirement cue task is outside the worker Day.' using errcode='55000';
  end if;

  v_choice:=lower(coalesce(nullif(btrim(p_response->>'choice'),''),''));
  if v_choice not in ('all_present','missing') then
    raise exception 'Confirm whether the required items are with you.' using errcode='22023';
  end if;

  v_blocked_by_requirement:=coalesce(v_task.metadata->>'day_requirement_blocker','false')='true';

  if v_choice='all_present' then
    update atlas.task_resource_requirements req
    set status='reserved',
        metadata=coalesce(req.metadata,'{}'::jsonb)||jsonb_build_object(
          'loaded_for_task',true,
          'loaded_confirmed_at',now(),
          'loaded_confirmed_by',auth.uid(),
          'loaded_confirmed_cue_id',v_cue.id
        ),
        updated_at=now()
    where req.task_id=v_task.id
      and req.requirement_role in ('required','bring_outside','check_first')
      and req.status<>'used';

    update atlas.tasks
    set status=case when v_blocked_by_requirement then 'open' else status end,
        blocker_text=case when v_blocked_by_requirement then null else blocker_text end,
        metadata=(coalesce(metadata,'{}'::jsonb)-'day_requirement_blocker')||jsonb_build_object(
          'departure_requirements_confirmed',true,
          'departure_requirements_confirmed_at',now(),
          'departure_requirements_cue_id',v_cue.id
        ),
        updated_at=now()
    where id=v_task.id;

    return jsonb_build_object(
      'applied',true,
      'kind','requirement_confirmation_v1',
      'requirements','all_present',
      'blocked',false
    );
  end if;

  update atlas.task_resource_requirements req
  set status='needs_check',
      metadata=coalesce(req.metadata,'{}'::jsonb)||jsonb_build_object(
        'loaded_for_task',false,
        'missing_or_unconfirmed_at',now(),
        'missing_or_unconfirmed_cue_id',v_cue.id
      ),
      updated_at=now()
  where req.task_id=v_task.id
    and req.requirement_role in ('required','bring_outside','check_first')
    and req.status<>'used';

  update atlas.tasks
  set status='blocked',
      blocker_text='One or more required items for the destination move are missing.',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'day_requirement_blocker',true,
        'departure_requirements_confirmed',false,
        'departure_requirement_problem_at',now(),
        'departure_requirements_cue_id',v_cue.id
      ),
      updated_at=now()
  where id=v_task.id;

  return jsonb_build_object(
    'applied',true,
    'kind','requirement_confirmation_v1',
    'requirements','missing',
    'blocked',true
  );
end;
$$;

revoke all on function atlas.apply_worker_day_requirement_confirmation_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function atlas.apply_worker_day_requirement_confirmation_v1(uuid,jsonb) to service_role;

create or replace function atlas.refresh_task_departure_requirement_cue_v1(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_items jsonb:='[]'::jsonb;
  v_label text;
  v_body text;
  v_service_date date;
  v_cue_id uuid;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null or v_task.assigned_membership_id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(coalesce(
    nullif(req.metadata->>'cue_label',''),
    case
      when req.quantity_needed is not null and req.quantity_needed<>1 then req.quantity_needed::text||' × '||resource.label
      else resource.label
    end
  )) order by req.created_at,resource.label),'[]'::jsonb)
  into v_items
  from atlas.task_resource_requirements req
  join atlas.resources resource on resource.id=req.resource_id
  where req.task_id=v_task.id
    and req.requirement_role in ('required','bring_outside','check_first')
    and req.status not in ('used','skipped');

  if jsonb_array_length(v_items)=0 then
    return null;
  end if;

  v_label:=coalesce(
    nullif(v_task.metadata->>'departure_label',''),
    nullif(v_task.metadata->>'location_name',''),
    'the destination'
  );
  v_body:='If you’re already in '||v_label||', use the same check: are all of these with you?';
  v_service_date:=greatest(coalesce(v_task.due_date,current_date),current_date);

  select id into v_cue_id
  from atlas.worker_day_cues cue
  where cue.farm_id=v_task.farm_id
    and cue.membership_id=v_task.assigned_membership_id
    and cue.anchor_task_id=v_task.id
    and cue.status not in ('resolved','dismissed')
    and cue.payload->>'stableKey'='departure_requirement:'||v_task.id::text
  order by cue.created_at desc
  limit 1;

  if v_cue_id is not null then
    update atlas.worker_day_cues
    set service_date=v_service_date,
        title='Before you leave for '||v_label,
        body=v_body,
        payload=jsonb_build_object(
          'stableKey','departure_requirement:'||v_task.id::text,
          'items',v_items,
          'choices',jsonb_build_array(
            jsonb_build_object('value','all_present','label','Everything is with me'),
            jsonb_build_object('value','missing','label','Something is missing')
          ),
          'recoveryTitle',v_label||' check',
          'recoveryPrompt','Are these with you in '||v_label||'?'
        ),
        result_contract=jsonb_build_object(
          'kind','requirement_confirmation_v1',
          'taskId',v_task.id
        ),
        recovery_policy='block',
        updated_at=now()
    where id=v_cue_id;
    return v_cue_id;
  end if;

  insert into atlas.worker_day_cues(
    organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,
    title,body,payload,result_contract,status,recovery_policy,created_by_user_id
  ) values (
    v_task.organization_id,
    v_task.farm_id,
    v_task.assigned_membership_id,
    v_service_date,
    'requirement',
    'before_task',
    v_task.id,
    'Before you leave for '||v_label,
    v_body,
    jsonb_build_object(
      'stableKey','departure_requirement:'||v_task.id::text,
      'items',v_items,
      'choices',jsonb_build_array(
        jsonb_build_object('value','all_present','label','Everything is with me'),
        jsonb_build_object('value','missing','label','Something is missing')
      ),
      'recoveryTitle',v_label||' check',
      'recoveryPrompt','Are these with you in '||v_label||'?'
    ),
    jsonb_build_object(
      'kind','requirement_confirmation_v1',
      'taskId',v_task.id
    ),
    'available',
    'block',
    null
  ) returning id into v_cue_id;

  return v_cue_id;
end;
$$;

revoke all on function atlas.refresh_task_departure_requirement_cue_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.refresh_task_departure_requirement_cue_v1(uuid) to service_role;

create or replace function atlas.worker_resolve_day_cue_api_v1(
  p_cue_id uuid,
  p_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_cue atlas.worker_day_cues%rowtype;
  v_contract_result jsonb:='{}'::jsonb;
  v_is_worker boolean:=false;
  v_kind text;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  select cue.* into v_cue
  from atlas.worker_day_cues cue
  join atlas.farm_memberships fm on fm.id=cue.membership_id
  where cue.id=p_cue_id
    and fm.active=true
    and (
      fm.user_id=auth.uid()
      or exists (
        select 1 from atlas.farm_memberships owner_membership
        where owner_membership.farm_id=cue.farm_id
          and owner_membership.active=true
          and owner_membership.role='owner'
          and owner_membership.user_id=auth.uid()
      )
    )
  for update of cue;
  if v_cue.id is null then
    raise exception 'Cue access required.' using errcode='42501';
  end if;

  if v_cue.status='resolved' then
    return jsonb_build_object(
      'contractVersion','worker_day_cue_resolution_v1',
      'cueId',v_cue.id,
      'status',v_cue.status,
      'resolvedAt',v_cue.resolved_at,
      'response',v_cue.response,
      'deduplicated',true
    );
  end if;

  select exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=v_cue.membership_id and fm.active=true and fm.user_id=auth.uid()
  ) into v_is_worker;
  v_kind:=nullif(v_cue.result_contract->>'kind','');

  if coalesce(v_cue.result_contract,'{}'::jsonb)<>'{}'::jsonb then
    if not v_is_worker then
      raise exception 'Only the assigned worker can resolve a farm-state cue.' using errcode='42501';
    end if;
    if v_kind='requirement_confirmation_v1' then
      v_contract_result:=atlas.apply_worker_day_requirement_confirmation_v1(
        v_cue.id,
        coalesce(p_response,'{}'::jsonb)
      );
    else
      v_contract_result:=atlas.apply_worker_day_cue_result_contract_v1(
        v_cue.id,
        coalesce(p_response,'{}'::jsonb)
      );
    end if;
  end if;

  update atlas.worker_day_cues cue
  set response=case
        when jsonb_typeof(coalesce(p_response,'{}'::jsonb))='object' then coalesce(p_response,'{}'::jsonb)
        else '{}'::jsonb
      end,
      status='resolved',
      resolved_at=now(),
      updated_at=now()
  where cue.id=p_cue_id
  returning * into v_cue;

  return jsonb_build_object(
    'contractVersion','worker_day_cue_resolution_v1',
    'cueId',v_cue.id,
    'status',v_cue.status,
    'resolvedAt',v_cue.resolved_at,
    'response',v_cue.response,
    'resultContract',v_contract_result
  );
end;
$$;

grant execute on function atlas.worker_resolve_day_cue_api_v1(uuid,jsonb) to authenticated;

-- Task Focus gets the same recovery rule as first-open Day cues. Old unanswered
-- requirements can reappear as current reality questions; they do not become
-- historical claims that the worker failed to prepare.
create or replace function atlas.worker_task_day_cues_api_v1(
  p_task_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_source text;
  v_cues jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A Day date is required.' using errcode='22023';
  end if;

  select task.* into v_task from atlas.tasks task where task.id=p_task_id;
  if v_task.id is null or v_task.assigned_membership_id is null then
    raise exception 'Assigned task required.' using errcode='55000';
  end if;
  select fm.* into v_membership
  from atlas.farm_memberships fm
  where fm.id=v_task.assigned_membership_id
    and fm.farm_id=v_task.farm_id
    and fm.active=true;
  if v_membership.id is null then
    raise exception 'Active assignee required.' using errcode='55000';
  end if;

  if v_membership.user_id=auth.uid() then
    v_source:='worker_self';
  elsif exists(
    select 1 from atlas.farm_memberships owner_membership
    where owner_membership.farm_id=v_task.farm_id
      and owner_membership.active=true
      and owner_membership.role='owner'
      and owner_membership.user_id=auth.uid()
  ) then
    v_source:='owner_view';
  else
    raise exception 'Task cue access required.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cueId',cue.id,
    'serviceDate',cue.service_date,
    'cueKind',cue.cue_kind,
    'anchorKind',cue.anchor_kind,
    'anchorTaskId',cue.anchor_task_id,
    'title',case
      when cue.service_date<p_day then coalesce(nullif(cue.payload->>'recoveryTitle',''),cue.title)
      else cue.title
    end,
    'body',case
      when cue.service_date<p_day then coalesce(nullif(cue.payload->>'recoveryPrompt',''),cue.body)
      else cue.body
    end,
    'payload',cue.payload,
    'status',case when cue.service_date<p_day then 'stale' else cue.status end,
    'recoveryPolicy',cue.recovery_policy,
    'availableFrom',cue.available_from,
    'expiresAt',cue.expires_at,
    'response',cue.response,
    'resolvedAt',cue.resolved_at
  ) order by
    case cue.anchor_kind when 'before_task' then 0 else 1 end,
    cue.service_date,
    cue.created_at,
    cue.id),'[]'::jsonb)
  into v_cues
  from atlas.worker_day_cues cue
  where cue.anchor_task_id=p_task_id
    and cue.membership_id=v_membership.id
    and cue.anchor_kind in ('before_task','after_task')
    and cue.status not in ('resolved','dismissed')
    and (
      cue.service_date=p_day
      or (
        cue.service_date<p_day
        and cue.recovery_policy in ('refresh','persist','block')
        and (cue.available_from is null or cue.available_from<=now())
      )
    );

  return jsonb_build_object(
    'contractVersion','worker_task_day_cues_v1',
    'taskId',p_task_id,
    'serviceDate',p_day,
    'targetSource',v_source,
    'cues',v_cues
  );
end;
$$;

revoke all on function atlas.worker_task_day_cues_api_v1(uuid,date) from public,anon;
grant execute on function atlas.worker_task_day_cues_api_v1(uuid,date) to authenticated,service_role;

-- Lebanon acceptance data: resources are canonical once, then each task carries
-- only its own required quantity and role.
do $$
declare
  v_prepare atlas.tasks%rowtype;
  v_harvest atlas.tasks%rowtype;
  v_saw uuid;
  v_compressor uuid;
  v_rake uuid;
  v_buckets uuid;
begin
  select * into v_prepare
  from atlas.tasks task
  where task.status<>'archived'
    and task.title='Prepare Karianne’s garden for Thursday bouquet-bar harvest'
  order by task.created_at desc
  limit 1;

  if v_prepare.id is null then
    return;
  end if;

  select * into v_harvest
  from atlas.tasks task
  where task.status<>'archived'
    and task.title='Thursday morning harvest at Karianne’s garden for bouquet bar'
    and task.farm_id=v_prepare.farm_id
  order by task.created_at desc
  limit 1;

  insert into atlas.resources(
    farm_id,stable_key,label,resource_type,resource_category,status,quantity,unit,metadata
  ) values (
    v_prepare.farm_id,'general_saw','Saw','tool','travel_work','available',1,'tool',
    jsonb_build_object('created_source','day_choreography_lebanon_requirements_v1')
  )
  on conflict(farm_id,stable_key) do update
    set label=excluded.label,updated_at=now()
  returning id into v_saw;

  insert into atlas.resources(
    farm_id,stable_key,label,resource_type,resource_category,status,quantity,unit,metadata
  ) values (
    v_prepare.farm_id,'air_compressor','Air compressor','equipment','travel_work','available',1,'unit',
    jsonb_build_object('created_source','day_choreography_lebanon_requirements_v1')
  )
  on conflict(farm_id,stable_key) do update
    set label=excluded.label,updated_at=now()
  returning id into v_compressor;

  insert into atlas.resources(
    farm_id,stable_key,label,resource_type,resource_category,status,quantity,unit,metadata
  ) values (
    v_prepare.farm_id,'regular_metal_rake_wood_handle','Metal rake with wood handle','tool','travel_work','available',1,'tool',
    jsonb_build_object('created_source','day_choreography_lebanon_requirements_v1')
  )
  on conflict(farm_id,stable_key) do update
    set label=excluded.label,updated_at=now()
  returning id into v_rake;

  insert into atlas.resources(
    farm_id,stable_key,label,resource_type,resource_category,status,quantity,unit,metadata
  ) values (
    v_prepare.farm_id,'black_florist_buckets','Black florist buckets','container','postharvest','available',12,'buckets',
    jsonb_build_object('created_source','day_choreography_lebanon_requirements_v1')
  )
  on conflict(farm_id,stable_key) do update
    set label=excluded.label,updated_at=now()
  returning id into v_buckets;

  insert into atlas.task_resource_requirements(
    task_id,resource_id,requirement_role,requirement_source,quantity_needed,unit,status,move_role,metadata
  )
  select v_prepare.id,v_saw,'required','manual',1,'tool','needed','tool',jsonb_build_object('cue_label','Saw')
  where not exists(
    select 1 from atlas.task_resource_requirements r
    where r.task_id=v_prepare.id and r.resource_id=v_saw and r.move_role='tool'
  );

  insert into atlas.task_resource_requirements(
    task_id,resource_id,requirement_role,requirement_source,quantity_needed,unit,status,move_role,metadata
  )
  select v_prepare.id,v_compressor,'required','manual',1,'unit','needed','equipment',jsonb_build_object('cue_label','Air compressor')
  where not exists(
    select 1 from atlas.task_resource_requirements r
    where r.task_id=v_prepare.id and r.resource_id=v_compressor and r.move_role='equipment'
  );

  insert into atlas.task_resource_requirements(
    task_id,resource_id,requirement_role,requirement_source,quantity_needed,unit,status,move_role,metadata
  )
  select v_prepare.id,v_rake,'required','manual',1,'tool','needed','tool',jsonb_build_object('cue_label','Metal rake with wood handle')
  where not exists(
    select 1 from atlas.task_resource_requirements r
    where r.task_id=v_prepare.id and r.resource_id=v_rake and r.move_role='tool'
  );

  insert into atlas.task_resource_requirements(
    task_id,resource_id,requirement_role,requirement_source,quantity_needed,unit,status,move_role,metadata
  )
  select v_prepare.id,v_buckets,'required','manual',5,'buckets','needed','container',jsonb_build_object('cue_label','5 black florist buckets')
  where not exists(
    select 1 from atlas.task_resource_requirements r
    where r.task_id=v_prepare.id and r.resource_id=v_buckets and r.move_role='container'
  );

  update atlas.tasks
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'departure_label','Lebanon',
        'departure_requirements_source','task_resource_requirements'
      ),
      updated_at=now()
  where id=v_prepare.id;

  perform atlas.refresh_task_departure_requirement_cue_v1(v_prepare.id);

  if v_harvest.id is not null then
    insert into atlas.task_resource_requirements(
      task_id,resource_id,requirement_role,requirement_source,quantity_needed,unit,status,move_role,metadata
    )
    select v_harvest.id,v_buckets,'required','manual',7,'buckets','needed','container',jsonb_build_object('cue_label','7 black florist buckets')
    where not exists(
      select 1 from atlas.task_resource_requirements r
      where r.task_id=v_harvest.id and r.resource_id=v_buckets and r.move_role='container'
    );

    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'departure_label','Lebanon',
          'departure_requirements_source','task_resource_requirements'
        ),
        updated_at=now()
    where id=v_harvest.id;

    perform atlas.refresh_task_departure_requirement_cue_v1(v_harvest.id);
  end if;
end;
$$;
