-- Bell badges represent current obligations, not historical rhythm transitions.

create or replace function atlas.bell_event_requires_action_v1(
  p_event_id uuid,
  p_effective_user_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_event atlas.journal_event_index%rowtype;
  v_rhythm_state_id uuid;
  v_rhythm_state atlas.rhythm_state%rowtype;
  v_task_id uuid;
  v_task_status text;
  v_crop_lifecycle text;
begin
  select event.* into v_event
  from atlas.journal_event_index event
  where event.id = p_event_id;

  if v_event.id is null then
    return false;
  end if;

  if v_event.event_kind in ('rhythm_due', 'rhythm_failure') then
    v_rhythm_state_id := atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'rhythmStateId');
    if v_rhythm_state_id is null then
      return false;
    end if;

    select state.* into v_rhythm_state
    from atlas.rhythm_state state
    where state.id = v_rhythm_state_id;

    if v_rhythm_state.id is null
       or v_rhythm_state.state not in ('due', 'fallen_out_of_rhythm', 'recovering') then
      return false;
    end if;

    -- A rhythm obligation is represented by its current serving task, not the
    -- task that happened to be attached to an older transition event.
    v_task_id := coalesce(
      v_rhythm_state.current_task_id,
      v_event.task_id,
      atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'taskId'),
      atlas.rhythm_safe_uuid_v1(v_event.payload #>> '{task,taskId}')
    );

    if v_task_id is not null then
      select task.status into v_task_status
      from atlas.tasks task
      where task.id = v_task_id;

      return v_task_status in ('open', 'blocked');
    end if;

    -- Capacity-gated rhythms can be genuinely actionable before a task is
    -- released. A retired crop cycle, however, cannot keep a badge alive.
    if v_rhythm_state.subject_kind = 'crop_cycle' then
      select cycle.lifecycle_status into v_crop_lifecycle
      from atlas.crop_cycles cycle
      where cycle.id = v_rhythm_state.subject_id;

      return v_crop_lifecycle is not null
        and v_crop_lifecycle not in ('archived', 'cancelled', 'retired', 'superseded');
    end if;

    return true;
  end if;

  v_task_id := coalesce(
    v_event.task_id,
    atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'taskId'),
    atlas.rhythm_safe_uuid_v1(v_event.payload #>> '{task,taskId}')
  );

  if v_task_id is not null then
    select task.status into v_task_status
    from atlas.tasks task
    where task.id = v_task_id;

    if v_task_status in ('open', 'blocked') and (
      v_event.event_kind = 'owner_decision'
      or v_event.importance in ('attention', 'critical')
      or v_event.assigned_user_id = p_effective_user_id
    ) then
      return true;
    end if;
  end if;

  return false;
end;
$function$;

comment on function atlas.bell_event_requires_action_v1(uuid, uuid) is
  'Returns whether a Bell event still represents a current obligation. Rhythm events follow the current rhythm state and current serving task; closed historical tasks do not keep badges alive.';
