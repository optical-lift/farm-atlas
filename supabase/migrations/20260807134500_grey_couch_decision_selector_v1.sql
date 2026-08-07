create or replace function atlas.resolve_task_decision_selector_v1(
  p_task_id uuid,
  p_choice text,
  p_effective_membership_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task atlas.tasks%rowtype;
  v_role text;
  v_existing_choice text;
  v_followup_id uuid;
  v_today date := (timezone('America/Chicago', now()))::date;
  v_followup_title text;
  v_followup_note text;
  v_display_action text;
  v_work_route text;
  v_detail_lines jsonb;
begin
  if p_choice not in ('marketplace', 'detached_garage', 'handled_elsewhere') then
    raise exception using errcode = '22023', message = 'That decision option is not available.';
  end if;

  select * into v_task
  from atlas.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Task not found.';
  end if;

  if coalesce(v_task.metadata->>'decision_selector_key', '') <> 'grey_couch_decision_v1' then
    raise exception using errcode = '22023', message = 'This task is not configured for that decision.';
  end if;

  select role into v_role
  from atlas.farm_memberships
  where id = p_effective_membership_id
    and farm_id = v_task.farm_id
    and active = true;

  if v_role is null then
    raise exception using errcode = '42501', message = 'No active farm membership is available.';
  end if;

  if p_effective_membership_id is distinct from v_task.assigned_membership_id
     and v_role not in ('owner', 'manager') then
    raise exception using errcode = '42501', message = 'This decision belongs to another worker.';
  end if;

  v_existing_choice := nullif(v_task.metadata->>'decision_selection', '');
  if v_existing_choice is not null then
    if v_existing_choice <> p_choice then
      raise exception using errcode = '22023', message = 'This couch decision has already been saved.';
    end if;

    select id into v_followup_id
    from atlas.tasks
    where metadata->>'decision_source_task_id' = p_task_id::text
      and metadata->>'decision_choice' = p_choice
    order by created_at desc
    limit 1;

    return jsonb_build_object(
      'ok', true,
      'choice', p_choice,
      'taskId', p_task_id,
      'createdTaskId', v_followup_id,
      'alreadyResolved', true
    );
  end if;

  if p_choice = 'marketplace' then
    v_followup_title := 'List Grey Couch + Kitty Litter Box on FB Marketplace';
    v_followup_note := 'List the grey couch on Facebook Marketplace with the kitty litter box.';
    v_display_action := 'List';
    v_work_route := 'marketplace';
    v_detail_lines := jsonb_build_array(
      'Photograph the grey couch and kitty litter box',
      'Create and publish the FB Marketplace listing'
    );
  elsif p_choice = 'detached_garage' then
    v_followup_title := 'Create Space + Move Grey Couch to Detached Garage';
    v_followup_note := 'Create a space along one wall in the back of the detached garage, then move the grey couch there.';
    v_display_action := 'Move';
    v_work_route := 'relocate';
    v_detail_lines := jsonb_build_array(
      'Create a space along one wall in the back of the detached garage',
      'Move the grey couch into that space'
    );
  end if;

  if p_choice in ('marketplace', 'detached_garage') then
    select id into v_followup_id
    from atlas.tasks
    where metadata->>'decision_source_task_id' = p_task_id::text
      and metadata->>'decision_choice' = p_choice
    order by created_at desc
    limit 1;

    if v_followup_id is null then
      insert into atlas.tasks (
        farm_id,
        organization_id,
        title,
        task_type,
        status,
        priority,
        due_date,
        note,
        metadata,
        action_key,
        work_class,
        visibility_scope,
        assigned_membership_id,
        task_scope,
        origin_kind,
        work_lane,
        commitment_kind,
        effort_units,
        release_reason
      ) values (
        v_task.farm_id,
        v_task.organization_id,
        v_followup_title,
        'general',
        'open',
        'normal',
        v_today,
        v_followup_note,
        jsonb_build_object(
          'task_key', 'anna_grey_couch_decision_' || p_choice || '_' || to_char(v_today, 'YYYYMMDD'),
          'anna_task', true,
          'assigned_to', 'Anna',
          'assignee_key', 'anna',
          'executor_worker_key', 'anna',
          'executor_membership_id', v_task.assigned_membership_id::text,
          'created_source', 'grey_couch_decision_selector_v1',
          'decision_source_task_id', p_task_id::text,
          'decision_choice', p_choice,
          'display_action', v_display_action,
          'display_subject', v_followup_title,
          'display_location', case when p_choice = 'detached_garage' then 'Detached Garage' else 'FB Marketplace' end,
          'collection_zone', case when p_choice = 'detached_garage' then 'Detached Garage' else 'Errand / Listing' end,
          'work_route', v_work_route,
          'detail_lines', v_detail_lines,
          'effort_units', case when p_choice = 'detached_garage' then 2 else 1 end,
          'commitment_kind', 'floating',
          'work_lane', 'discretionary'
        ),
        'general',
        'standard',
        'assigned_worker',
        v_task.assigned_membership_id,
        'farm_operation',
        'owner_assigned',
        'discretionary',
        'floating',
        case when p_choice = 'detached_garage' then 2 else 1 end,
        'grey_couch_decision_selector_v1'
      ) returning id into v_followup_id;
    end if;
  end if;

  update atlas.tasks
  set status = 'done',
      completed_at = now(),
      completed_by = 'decision_selector',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'decision_selection', p_choice,
        'decision_resolved_at', now()::text,
        'decision_created_task_id', v_followup_id
      )
  where id = p_task_id;

  return jsonb_build_object(
    'ok', true,
    'choice', p_choice,
    'taskId', p_task_id,
    'createdTaskId', v_followup_id,
    'alreadyResolved', false
  );
end;
$$;

grant execute on function atlas.resolve_task_decision_selector_v1(uuid, text, uuid) to authenticated, service_role;
