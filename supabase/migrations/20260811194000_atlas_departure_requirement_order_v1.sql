-- Departure requirement ordering v1
-- Keeps the human loading sequence explicit in canonical requirement metadata so
-- generated Before cues do not fall back to database insertion/alphabetical order.

do $$
declare
  v_prepare_id uuid;
  v_harvest_id uuid;
begin
  select id into v_prepare_id
  from atlas.tasks
  where status<>'archived'
    and title='Prepare Karianne’s garden for Thursday bouquet-bar harvest'
  order by created_at desc
  limit 1;

  select id into v_harvest_id
  from atlas.tasks
  where status<>'archived'
    and title='Thursday morning harvest at Karianne’s garden for bouquet bar'
  order by created_at desc
  limit 1;

  if v_prepare_id is not null then
    update atlas.task_resource_requirements req
    set metadata=coalesce(req.metadata,'{}'::jsonb)||jsonb_build_object(
      'cue_order',case resource.stable_key
        when 'general_saw' then 10
        when 'air_compressor' then 20
        when 'regular_metal_rake_wood_handle' then 30
        when 'black_florist_buckets' then 40
        else 999
      end
    ),
    updated_at=now()
    from atlas.resources resource
    where req.resource_id=resource.id
      and req.task_id=v_prepare_id;
  end if;

  if v_harvest_id is not null then
    update atlas.task_resource_requirements req
    set metadata=coalesce(req.metadata,'{}'::jsonb)||jsonb_build_object('cue_order',10),
        updated_at=now()
    from atlas.resources resource
    where req.resource_id=resource.id
      and req.task_id=v_harvest_id
      and resource.stable_key='black_florist_buckets';
  end if;
end;
$$;

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
  )) order by
    coalesce(nullif(req.metadata->>'cue_order','')::integer,9999),
    req.created_at,
    resource.label),'[]'::jsonb)
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
        result_contract=jsonb_build_object('kind','requirement_confirmation_v1','taskId',v_task.id),
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
    jsonb_build_object('kind','requirement_confirmation_v1','taskId',v_task.id),
    'available',
    'block',
    null
  ) returning id into v_cue_id;

  return v_cue_id;
end;
$$;

revoke all on function atlas.refresh_task_departure_requirement_cue_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.refresh_task_departure_requirement_cue_v1(uuid) to service_role;

do $$
declare
  v_task_id uuid;
begin
  for v_task_id in
    select id
    from atlas.tasks
    where status<>'archived'
      and title in (
        'Prepare Karianne’s garden for Thursday bouquet-bar harvest',
        'Thursday morning harvest at Karianne’s garden for bouquet bar'
      )
  loop
    perform atlas.refresh_task_departure_requirement_cue_v1(v_task_id);
  end loop;
end;
$$;
