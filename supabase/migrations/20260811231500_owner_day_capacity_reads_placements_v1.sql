-- The purple Owner Day commit applies placement edits before newly selected work.
-- Capacity decisions for that same commit must therefore read the choreographed
-- Day, not the older due-date-only base plan. Otherwise a task moved/added by
-- placement can disappear from the server's paid-minute baseline even though it
-- is visibly on the Owner's Day board.

create or replace function atlas.owner_build_worker_day_schedule_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_membership atlas.farm_memberships%rowtype;
  v_plan jsonb;
  v_target integer:=420;
  v_current integer:=0;
  v_automatic integer:=0;
  v_selected integer:=0;
  v_kind text;
  v_id uuid;
  v_minutes integer;
  v_selection jsonb;
  v_results jsonb:='[]'::jsonb;
  v_result jsonb;
  v_item atlas.project_pull_items%rowtype;
  v_task atlas.tasks%rowtype;
  v_day_window text;
  v_sort_order numeric(12,3);
begin
  if p_day is null then raise exception 'A schedule date is required.' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_selections,'[]'::jsonb))<>'array' then raise exception 'Selections must be an array.' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(p_selections,'[]'::jsonb))>40 then raise exception 'Too many schedule selections.' using errcode='22023'; end if;

  select * into v_membership from atlas.farm_memberships
  where id=p_membership_id and farm_id=p_farm_id and active=true;
  if v_membership.id is null or v_membership.role<>'farm_hand' then raise exception 'Active Farm Hand membership required.' using errcode='42501'; end if;

  -- This is deliberately the placement-aware read. In an atomic purple commit,
  -- any rewindow/reschedule/place/Return-to-Atlas edits have already landed in
  -- this transaction before selected work is evaluated.
  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_target:=coalesce((v_plan->>'paidTargetMinutes')::integer,420);
  v_current:=coalesce((v_plan->>'committedPaidMinutes')::integer,0);
  v_automatic:=coalesce((v_plan->>'automaticPaidMinutes')::integer,0);

  for v_selection in select value from jsonb_array_elements(coalesce(p_selections,'[]'::jsonb)) loop
    v_kind:=nullif(v_selection->>'sourceKind','');
    begin v_id:=nullif(v_selection->>'sourceId','')::uuid;
    exception when invalid_text_representation then raise exception 'Every schedule selection needs a valid source id.' using errcode='22023'; end;
    if v_kind is null or v_id is null then raise exception 'Every schedule selection needs a source kind and source id.' using errcode='22023'; end if;

    if v_kind='project_pull' then
      select * into v_item from atlas.project_pull_items item
      where item.id=v_id and item.farm_id=p_farm_id and item.status='available'
        and (item.preferred_membership_id is null or item.preferred_membership_id=p_membership_id)
        and not exists (
          select 1 from atlas.project_pull_item_dependencies dependency
          join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
          where dependency.project_item_id=item.id and prerequisite.status<>dependency.required_status
        );
      if v_item.id is null then raise exception 'A selected Finish Elm card is no longer available.' using errcode='55000'; end if;
      v_minutes:=greatest(coalesce(v_item.expected_active_minutes,0),0);
    elsif v_kind='floating_task' then
      select task.* into v_task
      from atlas.tasks task
      join atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day) candidate on candidate.task_id=task.id
      where task.id=v_id;
      if v_task.id is null then raise exception 'A selected Atlas paid-work card is no longer eligible.' using errcode='55000'; end if;
      select candidate.expected_active_minutes into v_minutes
      from atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day) candidate
      where candidate.task_id=v_id limit 1;
      v_minutes:=greatest(coalesce(v_minutes,0),0);
    else
      raise exception 'Only Owner-choice Finish Elm or floating work may be committed from this board.' using errcode='22023';
    end if;
    v_selected:=v_selected+v_minutes;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|day_choreography_v1',0));
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|'||p_day::text||'|owner_schedule_builder_v2',0));

  for v_selection in select value from jsonb_array_elements(coalesce(p_selections,'[]'::jsonb)) loop
    v_kind:=v_selection->>'sourceKind';
    v_id:=(v_selection->>'sourceId')::uuid;

    if v_kind='project_pull' then
      if v_current+v_automatic+v_selected>v_target then
        v_result:=atlas.pull_project_item_to_today_owner_override_v1(v_id,p_membership_id,p_day,'Approved by Owner in the worker day schedule builder beyond the normal capacity target.');
      else
        v_result:=atlas.pull_project_item_to_today_v1(v_id,p_membership_id,p_day,'Approved by Owner in the worker day schedule builder.');
      end if;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('sourceKind',v_kind,'sourceId',v_id,'state','scheduled','taskId',v_result->>'taskId'));

    elsif v_kind='floating_task' then
      select task.* into v_task
      from atlas.tasks task
      join atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day) candidate on candidate.task_id=task.id
      where task.id=v_id;
      if v_task.id is null then
        raise exception 'A selected Atlas paid-work card changed before the schedule could be built.' using errcode='55000';
      end if;

      v_day_window:=atlas.worker_task_day_window_v1(v_task.action_key,v_task.task_type,v_task.metadata);
      v_sort_order:=atlas.worker_task_order_v1(v_task.action_key,v_task.task_type,v_task.metadata);

      v_result:=atlas.owner_apply_worker_day_edits_api_v1(
        p_farm_id,
        p_membership_id,
        jsonb_build_array(jsonb_build_object(
          'kind','place',
          'taskId',v_task.id,
          'serviceDate',p_day,
          'dayWindow',v_day_window,
          'sortOrder',v_sort_order
        ))
      );

      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'sourceKind',v_kind,
        'sourceId',v_id,
        'state','scheduled',
        'taskId',v_id,
        'placement',v_result
      ));
    end if;
  end loop;

  perform atlas.refresh_owner_week_projection_v1(p_farm_id,p_membership_id,p_day,1);

  return jsonb_build_object(
    'contractVersion','owner_worker_day_schedule_builder_v2',
    'farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,
    'paidTargetMinutes',v_target,
    'alreadyCommittedPaidMinutes',v_current,
    'automaticPaidMinutes',v_automatic,
    'newlyApprovedPaidMinutes',v_selected,
    'projectedPaidMinutes',v_current+v_automatic+v_selected,
    'overTargetMinutes',greatest(v_current+v_automatic+v_selected-v_target,0),
    'results',v_results
  );
end;
$function$;
