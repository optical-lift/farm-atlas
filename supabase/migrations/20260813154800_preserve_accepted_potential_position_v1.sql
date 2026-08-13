-- Pass 6: an accepted purple potential card becomes its real task without
-- jumping to a different place in the Day after commit.
--
-- The client already renders potential work from the canonical worker-day plan.
-- This replacement keeps the existing commit API/signature, resolves the selected
-- card's position after all white-card draft edits are applied, schedules the real
-- task, then writes an explicit placement for that resulting task in the same
-- PostgreSQL transaction. No second task truth is introduced.

create or replace function atlas.owner_commit_worker_day_choreography_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_edits jsonb default '[]'::jsonb,
  p_selections jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_edit_result jsonb:='{}'::jsonb;
  v_schedule_result jsonb:='{}'::jsonb;
  v_accepted_placement_result jsonb:='{}'::jsonb;
  v_position_plan jsonb:='{}'::jsonb;
  v_selection_positions jsonb:='[]'::jsonb;
  v_generated_placement_edits jsonb:='[]'::jsonb;
  v_edit_count integer;
  v_selection_count integer;
  v_selection jsonb;
  v_position jsonb;
  v_suggestion jsonb;
  v_schedule_row jsonb;
  v_kind text;
  v_source_id uuid;
  v_task_id uuid;
  v_day_window text;
  v_sort_order numeric(12,3);
  v_has_equal_committed_order boolean;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_edits,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_selections,'[]'::jsonb))<>'array' then
    raise exception 'Day edits and selections must be arrays.' using errcode='22023';
  end if;

  v_edit_count:=jsonb_array_length(coalesce(p_edits,'[]'::jsonb));
  v_selection_count:=jsonb_array_length(coalesce(p_selections,'[]'::jsonb));
  if v_edit_count=0 and v_selection_count=0 then
    raise exception 'Choose at least one Day change.' using errcode='22023';
  end if;
  if v_edit_count>100 or v_selection_count>40 then
    raise exception 'Too many Day changes.' using errcode='22023';
  end if;

  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='owner'
      and fm.user_id=auth.uid()
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

  perform pg_advisory_xact_lock(
    hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|'||p_day::text||'|owner_day_atomic_commit_v1',0)
  );

  if v_edit_count>0 then
    v_edit_result:=atlas.owner_apply_worker_day_edits_api_v1(
      p_farm_id,
      p_membership_id,
      p_edits
    );
  end if;

  if v_selection_count>0 then
    v_position_plan:=atlas.owner_worker_day_plan_choreographed_v1(
      p_farm_id,
      p_membership_id,
      p_day
    );

    for v_selection in
      select value from jsonb_array_elements(coalesce(p_selections,'[]'::jsonb))
    loop
      v_kind:=nullif(v_selection->>'sourceKind','');
      begin
        v_source_id:=nullif(v_selection->>'sourceId','')::uuid;
      exception when invalid_text_representation then
        raise exception 'Every schedule selection needs a valid source id.' using errcode='22023';
      end;
      if v_kind not in ('project_pull','floating_task') or v_source_id is null then
        raise exception 'Only current potential work can be accepted from this Day.' using errcode='22023';
      end if;

      select item
      into v_suggestion
      from jsonb_array_elements(coalesce(v_position_plan->'suggestions','[]'::jsonb)) item
      where item->>'sourceKind'=v_kind
        and item->>'sourceId'=v_source_id::text
      limit 1;

      if v_suggestion is null then
        raise exception 'A selected potential card changed before the Day could be committed.' using errcode='55000';
      end if;

      v_day_window:=nullif(v_suggestion->>'dayWindow','');
      if v_day_window not in ('morning','afternoon','evening') then
        raise exception 'A selected potential card no longer has a valid Day window.' using errcode='55000';
      end if;
      begin
        v_sort_order:=nullif(v_suggestion->>'workOrderNumber','')::numeric(12,3);
      exception when invalid_text_representation then
        raise exception 'A selected potential card no longer has a valid Day position.' using errcode='55000';
      end;
      if v_sort_order is null then
        raise exception 'A selected potential card no longer has a valid Day position.' using errcode='55000';
      end if;

      select exists (
        select 1
        from jsonb_array_elements(coalesce(v_position_plan->'realWork','[]'::jsonb)) item
        where item->>'dayWindow'=v_day_window
          and nullif(item->>'workOrderNumber','') is not null
          and (item->>'workOrderNumber')::numeric=v_sort_order
      ) into v_has_equal_committed_order;
      if v_has_equal_committed_order then
        v_sort_order:=v_sort_order+0.001;
      end if;

      v_selection_positions:=v_selection_positions||jsonb_build_array(jsonb_build_object(
        'sourceKind',v_kind,
        'sourceId',v_source_id,
        'dayWindow',v_day_window,
        'sortOrder',v_sort_order
      ));
    end loop;

    v_schedule_result:=atlas.owner_build_worker_day_schedule_api_v2(
      p_farm_id,
      p_membership_id,
      p_day,
      p_selections
    );

    for v_position in
      select value from jsonb_array_elements(v_selection_positions)
    loop
      select item
      into v_schedule_row
      from jsonb_array_elements(coalesce(v_schedule_result->'results','[]'::jsonb)) item
      where item->>'sourceKind'=v_position->>'sourceKind'
        and item->>'sourceId'=v_position->>'sourceId'
      limit 1;

      begin
        v_task_id:=nullif(v_schedule_row->>'taskId','')::uuid;
      exception when invalid_text_representation then
        v_task_id:=null;
      end;
      if v_task_id is null then
        raise exception 'Atlas could not preserve the accepted card identity.' using errcode='55000';
      end if;

      v_generated_placement_edits:=v_generated_placement_edits||jsonb_build_array(jsonb_build_object(
        'kind','place',
        'taskId',v_task_id,
        'serviceDate',p_day,
        'dayWindow',v_position->>'dayWindow',
        'sortOrder',(v_position->>'sortOrder')::numeric
      ));
    end loop;

    if jsonb_array_length(v_generated_placement_edits)>0 then
      v_accepted_placement_result:=atlas.owner_apply_worker_day_edits_api_v1(
        p_farm_id,
        p_membership_id,
        v_generated_placement_edits
      );
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','owner_worker_day_atomic_commit_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_day,
    'editCount',v_edit_count,
    'selectionCount',v_selection_count,
    'edits',v_edit_result,
    'schedule',v_schedule_result,
    'acceptedPlacements',v_accepted_placement_result
  );
end;
$function$;

revoke all on function atlas.owner_commit_worker_day_choreography_api_v1(uuid,uuid,date,jsonb,jsonb) from public,anon;
grant execute on function atlas.owner_commit_worker_day_choreography_api_v1(uuid,uuid,date,jsonb,jsonb) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  reviewed_at
)
values(
  'atlas.owner_commit_worker_day_choreography_api_v1(uuid, uuid, date, jsonb, jsonb)',
  'owner_admin_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'purpose','Commit the Owner Day draft atomically and preserve each accepted potential card position on its resulting real task',
    'boundary','owner-only; accepted project-pull/floating work is converted through the existing canonical schedule builder',
    'identity','schedule results map the accepted source card to one canonical taskId; no shadow task/card is created',
    'position','accepted task receives the selected potential card dayWindow/workOrderNumber after white-card draft edits',
    'rollback','any failed edit, selection, identity mapping, or placement rolls back the entire Day commit',
    'route','/api/atlas/owner-day-commit'
  ),
  now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;
