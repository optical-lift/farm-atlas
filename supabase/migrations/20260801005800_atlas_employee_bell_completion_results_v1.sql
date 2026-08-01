begin;

do $migration$
declare
  v_definition text;
  v_old_fragment text := $old$
      coalesce(
        nullif(task.unlock_text, ''),
        nullif(task.metadata ->> 'desired_result', ''),
        nullif(task.metadata ->> 'done_definition', ''),
        nullif(task.metadata ->> 'completion_result', ''),
        nullif(task.metadata ->> 'result_text', '')
      ) as result_text,
$old$;
  v_new_fragment text := $new$
      coalesce(
        nullif(task.unlock_text, ''),
        nullif(task.metadata ->> 'desired_result', ''),
        nullif(task.metadata ->> 'done_definition', ''),
        nullif(task.metadata ->> 'completion_result', ''),
        nullif(task.metadata ->> 'result_text', ''),
        nullif(task.metadata -> 'detail_lines' ->> -1, ''),
        case
          when task.action_key = 'mow' then
            concat(
              coalesce(nullif(task.metadata ->> 'display_subject', ''), task.title),
              ' restored to ',
              coalesce(nullif(task.metadata ->> 'target_cut_height_inches', ''), 'the recorded target'),
              ' in cut height.'
            )
          when task.action_key = 'weed' then
            concat(
              coalesce(nullif(task.metadata ->> 'display_subject', ''), task.title),
              ' clear and returned to its weeding rhythm.'
            )
          when task.action_key = 'germination_check' then
            concat(
              coalesce(nullif(task.metadata ->> 'display_subject', ''), task.title),
              ' germination status recorded so the crop cycle can advance when ready.'
            )
          when task.action_key = 'support' then
            concat(
              coalesce(nullif(task.metadata ->> 'display_subject', ''), task.title),
              ' installed and supported.'
            )
          when task.action_key = 'put_away' then
            concat(
              coalesce(nullif(task.metadata ->> 'display_subject', ''), task.title),
              ' put away and departure preparation cleared.'
            )
          when task.action_key = 'harvest' then
            concat(
              coalesce(nullif(task.metadata ->> 'display_subject', ''), task.title),
              ' cut back and harvested.'
            )
          when task.action_key = 'clean' then
            concat(
              coalesce(nullif(task.metadata ->> 'display_subject', ''), task.title),
              ' clean and guest-presentable.'
            )
          else null
        end
      ) as result_text,
$new$;
  v_occurrences integer;
begin
  if to_regprocedure('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)') is null then
    raise exception 'Expected role-aware atlas.bell_history_v2 before adding employee completion results';
  end if;

  select pg_get_functiondef('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)'::regprocedure)
  into v_definition;

  if v_definition not like '%current_assigned_task_movement_per_task%'
     or v_definition not like '%event.visibility_scope = ''assigned_worker''%'
     or v_definition not like '%''resultText'', item.result_text%' then
    raise exception 'atlas.bell_history_v2 no longer matches the reviewed employee movement result contract';
  end if;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old_fragment, ''))
  ) / nullif(length(v_old_fragment), 0);

  if v_occurrences <> 1 then
    raise exception 'Expected exactly one employee result-text fragment, found %', v_occurrences;
  end if;

  execute replace(v_definition, v_old_fragment, v_new_fragment);
end;
$migration$;

comment on function atlas.bell_history_v2(uuid, uuid, integer, timestamptz) is
  'Role-aware Bell. Management keeps planning queues. Employee follow-through cards show canonical downstream unlocks when available, otherwise a completion result derived from canonical task action, subject, target, detail, crop-cycle, or maintenance metadata.';

do $postcondition$
declare
  v_definition text;
begin
  select pg_get_functiondef('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)'::regprocedure)
  into v_definition;

  if v_definition not like '%task.metadata -> ''detail_lines'' ->> -1%'
     or v_definition not like '%task.action_key = ''mow''%'
     or v_definition not like '%task.action_key = ''weed''%'
     or v_definition not like '%task.action_key = ''germination_check''%'
     or v_definition not like '%task.action_key = ''support''%'
     or v_definition not like '%task.action_key = ''put_away''%'
     or v_definition not like '%task.action_key = ''harvest''%'
     or v_definition not like '%task.action_key = ''clean''%'
     or v_definition not like '%current_assigned_task_movement_per_task%' then
    raise exception 'Employee Bell completion-result postcondition failed';
  end if;
end;
$postcondition$;

commit;
