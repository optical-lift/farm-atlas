create or replace function atlas.owner_commit_worker_clock_plan_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_changes jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_change jsonb;
  v_task_id uuid;
  v_task atlas.tasks%rowtype;
  v_existing atlas.worker_day_task_placements%rowtype;
  v_after atlas.worker_day_task_placements%rowtype;
  v_plan jsonb;
  v_plan_item jsonb;
  v_set_start boolean;
  v_set_duration boolean;
  v_start_text text;
  v_local_time time without time zone;
  v_start_at timestamptz;
  v_duration integer;
  v_expected_start timestamptz;
  v_expected_duration integer;
  v_day_window text;
  v_sort_order numeric(12,3);
  v_source text;
  v_warning_codes jsonb;
  v_override boolean;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null or p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) < 1 or jsonb_array_length(p_changes) > 100 then
    raise exception 'A service date and 1 to 100 Clock changes are required.' using errcode='22023';
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
  if exists (
    select 1 from jsonb_array_elements(p_changes) c
    group by c->>'taskId' having count(*) > 1
  ) then
    raise exception 'A task can appear only once in a Clock plan commit.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|'||p_day::text||'|clock_plan_v1',0));
  v_plan := atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    begin v_task_id := (v_change->>'taskId')::uuid; exception when others then raise exception 'Every Clock change requires a valid task ID.' using errcode='22023'; end;
    v_set_start := coalesce((v_change->>'setStart')::boolean,false);
    v_set_duration := coalesce((v_change->>'setDuration')::boolean,false);
    if not v_set_start and not v_set_duration then raise exception 'Every Clock change must change start or duration.' using errcode='22023'; end if;
    v_source := coalesce(v_change->>'source','committed');
    if v_source not in ('proposal','committed') then raise exception 'Clock change source is invalid.' using errcode='22023'; end if;
    v_warning_codes := coalesce(v_change->'warningCodes','[]'::jsonb);
    v_override := coalesce((v_change->>'overrideWarnings')::boolean,false);
    if jsonb_typeof(v_warning_codes) <> 'array' then raise exception 'Clock warning codes must be an array.' using errcode='22023'; end if;
    if jsonb_array_length(v_warning_codes) > 0 and not v_override then raise exception 'Timing warnings require explicit Owner override.' using errcode='55000'; end if;

    select * into v_task from atlas.tasks t
    where t.id=v_task_id and t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id;
    if v_task.id is null then raise exception 'The selected task is not assigned to this worker.' using errcode='55000'; end if;
    if lower(coalesce(v_task.status::text,'')) in ('done','completed','archived','skipped') then
      raise exception 'This task is no longer open for Clock planning.' using errcode='55000';
    end if;

    select * into v_existing from atlas.worker_day_task_placements p where p.task_id=v_task_id for update;
    if v_existing.id is not null and (v_existing.state <> 'placed' or v_existing.service_date <> p_day) then
      raise exception 'This task is not placed on the selected worker day.' using errcode='55000';
    end if;

    v_expected_start := null;
    if v_change ? 'expectedStartAt' and jsonb_typeof(v_change->'expectedStartAt') <> 'null' then
      begin v_expected_start := (v_change->>'expectedStartAt')::timestamptz; exception when others then raise exception 'Expected Clock start is invalid.' using errcode='22023'; end;
    end if;
    v_expected_duration := null;
    if v_change ? 'expectedDurationMinutes' and jsonb_typeof(v_change->'expectedDurationMinutes') <> 'null' then
      begin v_expected_duration := (v_change->>'expectedDurationMinutes')::integer; exception when others then raise exception 'Expected Clock duration is invalid.' using errcode='22023'; end;
    end if;
    if v_existing.planned_start_at is distinct from v_expected_start or v_existing.planned_duration_minutes is distinct from v_expected_duration then
      raise exception 'This Clock changed after the draft opened. Refresh and plan again.' using errcode='55000';
    end if;

    v_start_at := v_existing.planned_start_at;
    v_day_window := v_existing.day_window;
    if v_set_start then
      v_start_text := nullif(trim(coalesce(v_change->>'startLocalTime','')),'');
      if v_start_text is null then
        v_start_at := null;
      else
        begin v_local_time := v_start_text::time without time zone; exception when others then raise exception 'Clock time must be a valid Elm Farm local time.' using errcode='22023'; end;
        v_start_at := (p_day::timestamp + v_local_time) at time zone 'America/Chicago';
        v_day_window := case when v_local_time < time '12:00' then 'morning' when v_local_time < time '17:00' then 'afternoon' else 'evening' end;
      end if;
    end if;

    v_duration := v_existing.planned_duration_minutes;
    if v_set_duration then
      if v_change ? 'durationMinutes' and jsonb_typeof(v_change->'durationMinutes') <> 'null' then
        begin v_duration := (v_change->>'durationMinutes')::integer; exception when others then raise exception 'Clock duration is invalid.' using errcode='22023'; end;
        if v_duration < 5 or v_duration > 720 then raise exception 'Clock duration must be between 5 and 720 minutes.' using errcode='22023'; end if;
      else
        v_duration := null;
      end if;
    end if;
    if v_start_at is null then v_duration := null; end if;

    if v_existing.id is null then
      if v_start_at is null then raise exception 'An untimed task already belongs in Unplaced; there is no Clock placement to remove.' using errcode='55000'; end if;
      select item into v_plan_item from jsonb_array_elements(coalesce(v_plan->'realWork','[]'::jsonb)) item where item->>'taskId'=v_task_id::text limit 1;
      if v_plan_item is null then raise exception 'This task is not committed to the selected worker day.' using errcode='55000'; end if;
      begin v_sort_order := coalesce(nullif(v_plan_item->>'workOrderNumber','')::numeric,10000); exception when invalid_text_representation then v_sort_order:=10000; end;
      insert into atlas.worker_day_task_placements(
        organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,placement_source,placement_reason,state,owner_actor_user_id,planned_start_at,planned_duration_minutes
      ) values (
        v_task.organization_id,p_farm_id,p_membership_id,v_task_id,p_day,v_day_window,v_sort_order,'owner','Committed from Owner Clock plan.','placed',auth.uid(),v_start_at,v_duration
      ) returning * into v_after;
    else
      update atlas.worker_day_task_placements p set
        planned_start_at=v_start_at,
        planned_duration_minutes=v_duration,
        day_window=case when v_start_at is null then p.day_window else v_day_window end,
        placement_source='owner',placement_reason=case when v_start_at is null then 'Returned to Clock Unplaced by Owner plan.' else 'Committed from Owner Clock plan.' end,
        owner_actor_user_id=auth.uid(),updated_at=now()
      where p.id=v_existing.id returning * into v_after;
    end if;

    insert into atlas.worker_day_task_placement_events(
      organization_id,farm_id,membership_id,task_id,placement_id,event_kind,from_service_date,to_service_date,from_day_window,to_day_window,from_sort_order,to_sort_order,actor_user_id,metadata
    ) values (
      v_task.organization_id,p_farm_id,p_membership_id,v_task_id,v_after.id,'owner_clock_plan_commit',v_existing.service_date,v_after.service_date,v_existing.day_window,v_after.day_window,v_existing.sort_order,v_after.sort_order,auth.uid(),
      jsonb_build_object('source','clock_plan_v1','draftSource',v_source,'fromPlannedStartAt',v_existing.planned_start_at,'toPlannedStartAt',v_after.planned_start_at,'fromPlannedDurationMinutes',v_existing.planned_duration_minutes,'toPlannedDurationMinutes',v_after.planned_duration_minutes,'warningCodes',v_warning_codes,'warningOverride',v_override)
    );
    v_results := v_results || jsonb_build_array(jsonb_build_object('taskId',v_task_id,'placementId',v_after.id,'plannedStartAt',v_after.planned_start_at,'plannedDurationMinutes',v_after.planned_duration_minutes,'dayWindow',v_after.day_window));
  end loop;

  return jsonb_build_object('contractVersion','owner_worker_clock_plan_commit_v1','farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,'changed',v_results);
end;
$function$;

revoke all on function atlas.owner_commit_worker_clock_plan_api_v1(uuid,uuid,date,jsonb) from public;
grant execute on function atlas.owner_commit_worker_clock_plan_api_v1(uuid,uuid,date,jsonb) to authenticated;
grant execute on function atlas.owner_commit_worker_clock_plan_api_v1(uuid,uuid,date,jsonb) to service_role;

insert into atlas.authenticated_rpc_registry(signature,classification,review_status,authenticated_execute_expected,security_definer_expected,service_execute_expected,evidence)
values ('atlas.owner_commit_worker_clock_plan_api_v1(uuid,uuid,date,jsonb)','owner_admin_endpoint','reviewed',true,true,true,'Atomic Owner-only Clock choreography commit. Updates worker-day placement time/duration only; task truth and due dates remain untouched.')
on conflict (signature) do update set classification=excluded.classification,review_status=excluded.review_status,authenticated_execute_expected=excluded.authenticated_execute_expected,security_definer_expected=excluded.security_definer_expected,service_execute_expected=excluded.service_execute_expected,evidence=excluded.evidence,updated_at=now();
