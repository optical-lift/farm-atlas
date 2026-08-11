-- Day choreography plan overlay v1
-- Keeps the existing farm scheduling engine, then applies explicit Owner Day placement
-- without rewriting canonical task due dates.

create or replace function atlas.owner_worker_day_plan_choreographed_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb;
  v_real jsonb:='[]'::jsonb;
  v_placed jsonb:='[]'::jsonb;
  v_suggestions jsonb:='[]'::jsonb;
  v_committed integer:=0;
  v_automatic integer:=0;
  v_target integer:=420;
begin
  v_plan:=atlas.owner_worker_day_plan_v1(p_farm_id,p_membership_id,p_day);
  if coalesce((v_plan->>'availableWorkerDay')::boolean,false)=false then
    return v_plan;
  end if;

  -- An explicit future placement suppresses the task before that day. A placement
  -- on this day owns its window/order. A placement from a day that has already
  -- passed stops suppressing carry-forward, so an unfinished task can become real
  -- overdue work instead of disappearing forever.
  select coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_real
  from jsonb_array_elements(coalesce(v_plan->'realWork','[]'::jsonb)) item
  where not exists (
    select 1
    from atlas.worker_day_task_placements placement
    where placement.farm_id=p_farm_id
      and placement.membership_id=p_membership_id
      and placement.task_id=(item->>'taskId')::uuid
      and (
        (placement.state='placed' and placement.service_date>=p_day)
        or (placement.state='returned_to_atlas' and placement.service_date=p_day)
      )
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id','task:'||task.id::text,
    'kind','real',
    'sourceKind','task',
    'sourceId',task.id,
    'taskId',task.id,
    'title',task.title,
    'status',task.status,
    'expectedActiveMinutes',capacity.expected_active_minutes,
    'dayWindow',placement.day_window,
    'workOrderNumber',placement.sort_order,
    'location',coalesce(nullif(task.metadata->>'display_location',''),nullif(task.metadata->>'collection_zone',''),nullif(task.metadata->>'collection_label','')),
    'automatic',false,
    'requiresOwnerApproval',false,
    'placementSource',placement.placement_source,
    'placementReason',placement.placement_reason
  ) order by
    case placement.day_window when 'morning' then 0 when 'afternoon' then 1 else 2 end,
    placement.sort_order,task.title,task.id),'[]'::jsonb)
  into v_placed
  from atlas.worker_day_task_placements placement
  join atlas.tasks task on task.id=placement.task_id
  cross join lateral atlas.task_capacity_plan_v1(task,p_day) capacity
  where placement.farm_id=p_farm_id
    and placement.membership_id=p_membership_id
    and placement.service_date=p_day
    and placement.state='placed'
    and task.assigned_membership_id=p_membership_id
    and task.status in ('open','blocked')
    and task.parent_task_id is null
    and nullif(task.metadata->>'parent_task_id','') is null
    and coalesce((task.metadata->>'is_child_task')::boolean,false)=false;

  -- The base real rows whose placement is today were suppressed above, so this
  -- concatenation cannot duplicate them.
  v_real:=v_real||v_placed;

  -- Once Owner has explicitly placed a floating task, do not offer the same task
  -- again as purple work while that placement is still in the future/today.
  select coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_suggestions
  from jsonb_array_elements(coalesce(v_plan->'suggestions','[]'::jsonb)) item
  where not (
    item->>'sourceKind'='floating_task'
    and exists (
      select 1
      from atlas.worker_day_task_placements placement
      where placement.farm_id=p_farm_id
        and placement.membership_id=p_membership_id
        and placement.task_id=(item->>'sourceId')::uuid
        and placement.state='placed'
        and placement.service_date>=p_day
    )
  );

  select coalesce(sum(coalesce((item->>'expectedActiveMinutes')::numeric,0)),0)::integer
  into v_committed
  from jsonb_array_elements(v_real) item;

  v_automatic:=coalesce((v_plan->>'automaticPaidMinutes')::integer,0);
  v_target:=coalesce((v_plan->>'paidTargetMinutes')::integer,420);

  v_plan:=jsonb_set(v_plan,'{realWork}',v_real,true);
  v_plan:=jsonb_set(v_plan,'{suggestions}',v_suggestions,true);
  v_plan:=jsonb_set(v_plan,'{committedPaidMinutes}',to_jsonb(v_committed),true);
  v_plan:=jsonb_set(v_plan,'{remainingPaidMinutes}',to_jsonb(greatest(v_target-v_committed-v_automatic,0)),true);
  v_plan:=jsonb_set(v_plan,'{contractVersion}',to_jsonb('owner_worker_day_plan_choreographed_v1'::text),true);
  return v_plan;
end;
$$;

create or replace function atlas.owner_worker_day_plan_choreographed_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.user_id=auth.uid()
      and fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='owner'
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id
      and fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  return atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
end;
$$;

grant execute on function atlas.owner_worker_day_plan_choreographed_api_v1(uuid,uuid,date) to authenticated;

-- Replace the first-pass mutation with one crucial semantic: Return to Atlas is
-- anchored to the Day the Owner removed it from, not to the task's old due date.
-- That suppresses the task for this Day only; on a later workday the normal farm
-- engine may offer/carry it again.
create or replace function atlas.owner_apply_worker_day_edits_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_edits jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_edit jsonb;
  v_kind text;
  v_task_id uuid;
  v_service_date date;
  v_day_window text;
  v_sort_order numeric(12,3);
  v_task atlas.tasks%rowtype;
  v_existing atlas.worker_day_task_placements%rowtype;
  v_placement atlas.worker_day_task_placements%rowtype;
  v_event_kind text;
  v_results jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  if jsonb_typeof(coalesce(p_edits,'[]'::jsonb))<>'array' then
    raise exception 'Edits must be an array.' using errcode='22023';
  end if;
  if jsonb_array_length(coalesce(p_edits,'[]'::jsonb))>100 then
    raise exception 'Too many day edits.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|day_choreography_v1',0));

  for v_edit in select value from jsonb_array_elements(coalesce(p_edits,'[]'::jsonb)) loop
    v_kind:=nullif(v_edit->>'kind','');
    begin
      v_task_id:=nullif(v_edit->>'taskId','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Every day edit needs a valid task id.' using errcode='22023';
    end;
    if v_kind not in ('place','rewindow','reschedule','reorder','return_to_atlas') or v_task_id is null then
      raise exception 'Unsupported day edit.' using errcode='22023';
    end if;

    begin
      v_service_date:=nullif(v_edit->>'serviceDate','')::date;
    exception when others then
      raise exception 'A valid service date is required.' using errcode='22023';
    end;
    if v_service_date is null then
      raise exception 'A service date is required for every Day edit.' using errcode='22023';
    end if;

    select * into v_task from atlas.tasks task
    where task.id=v_task_id and task.farm_id=p_farm_id and task.assigned_membership_id=p_membership_id;
    if v_task.id is null then
      raise exception 'The selected task is not assigned to this worker.' using errcode='55000';
    end if;

    select * into v_existing from atlas.worker_day_task_placements placement where placement.task_id=v_task_id;

    if v_kind='return_to_atlas' then
      if v_existing.id is null then
        insert into atlas.worker_day_task_placements(
          organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,
          placement_source,placement_reason,state,owner_actor_user_id
        ) values (
          v_task.organization_id,p_farm_id,p_membership_id,v_task_id,v_service_date,
          coalesce(nullif(v_edit->>'dayWindow',''),'morning'),
          coalesce(nullif(v_edit->>'sortOrder','')::numeric,10000),
          'owner','Returned to Atlas by Owner.','returned_to_atlas',auth.uid()
        ) returning * into v_placement;
      else
        update atlas.worker_day_task_placements placement
        set service_date=v_service_date,
            state='returned_to_atlas',
            placement_source='owner',
            placement_reason='Returned to Atlas by Owner.',
            owner_actor_user_id=auth.uid(),
            updated_at=now()
        where placement.id=v_existing.id returning * into v_placement;
      end if;
      v_event_kind:='owner_returned_to_atlas';
    else
      v_day_window:=coalesce(nullif(v_edit->>'dayWindow',''),v_existing.day_window,'morning');
      if v_day_window not in ('morning','afternoon','evening') then
        raise exception 'A valid day window is required.' using errcode='22023';
      end if;
      begin
        v_sort_order:=coalesce(nullif(v_edit->>'sortOrder','')::numeric,v_existing.sort_order,10000);
      exception when invalid_text_representation then
        raise exception 'sortOrder must be numeric.' using errcode='22023';
      end;

      if v_existing.id is null then
        insert into atlas.worker_day_task_placements(
          organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,
          placement_source,placement_reason,state,owner_actor_user_id
        ) values (
          v_task.organization_id,p_farm_id,p_membership_id,v_task_id,v_service_date,v_day_window,v_sort_order,
          'owner','Placed by Owner Day Edit.','placed',auth.uid()
        ) returning * into v_placement;
        v_event_kind:='owner_added';
      else
        update atlas.worker_day_task_placements placement
        set service_date=v_service_date,day_window=v_day_window,sort_order=v_sort_order,
            placement_source='owner',placement_reason='Adjusted by Owner Day Edit.',state='placed',
            owner_actor_user_id=auth.uid(),updated_at=now()
        where placement.id=v_existing.id returning * into v_placement;
        v_event_kind:=case
          when v_kind='rewindow' then 'owner_rewindowed'
          when v_kind='reschedule' then 'owner_rescheduled'
          when v_kind='reorder' then 'owner_reordered'
          else 'owner_added'
        end;
      end if;
    end if;

    insert into atlas.worker_day_task_placement_events(
      organization_id,farm_id,membership_id,task_id,placement_id,event_kind,
      from_service_date,to_service_date,from_day_window,to_day_window,from_sort_order,to_sort_order,
      actor_user_id,metadata
    ) values (
      v_task.organization_id,p_farm_id,p_membership_id,v_task_id,v_placement.id,v_event_kind,
      v_existing.service_date,case when v_placement.state='placed' then v_placement.service_date else null end,
      v_existing.day_window,case when v_placement.state='placed' then v_placement.day_window else null end,
      v_existing.sort_order,case when v_placement.state='placed' then v_placement.sort_order else null end,
      auth.uid(),jsonb_build_object('editKind',v_kind,'removedFromDay',case when v_kind='return_to_atlas' then v_service_date else null end)
    );

    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'taskId',v_task_id,
      'editKind',v_kind,
      'state',v_placement.state,
      'serviceDate',case when v_placement.state='placed' then v_placement.service_date else null end,
      'removedFromDay',case when v_placement.state='returned_to_atlas' then v_placement.service_date else null end,
      'dayWindow',case when v_placement.state='placed' then v_placement.day_window else null end,
      'sortOrder',case when v_placement.state='placed' then v_placement.sort_order else null end
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','owner_worker_day_edit_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'results',v_results
  );
end;
$$;

grant execute on function atlas.owner_apply_worker_day_edits_api_v1(uuid,uuid,jsonb) to authenticated;
