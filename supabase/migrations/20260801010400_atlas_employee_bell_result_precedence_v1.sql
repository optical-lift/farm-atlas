begin;

do $migration$
declare
  v_definition text;
  v_old_fragment text := $old$
        nullif(task.metadata ->> 'result_text', ''),
        nullif(task.metadata -> 'detail_lines' ->> -1, ''),
        case
$old$;
  v_new_fragment text := $new$
        nullif(task.metadata ->> 'result_text', ''),
        case
$new$;
  v_old_case_end text := $old_end$
          else null
        end
      ) as result_text,
$old_end$;
  v_new_case_end text := $new_end$
          else null
        end,
        nullif(task.metadata -> 'detail_lines' ->> -1, '')
      ) as result_text,
$new_end$;
  v_first_occurrences integer;
  v_second_occurrences integer;
begin
  if to_regprocedure('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)') is null then
    raise exception 'Expected role-aware atlas.bell_history_v2 before correcting result precedence';
  end if;

  select pg_get_functiondef('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)'::regprocedure)
  into v_definition;

  if v_definition not like '%current_assigned_task_movement_per_task%'
     or v_definition not like '%task.action_key = ''mow''%'
     or v_definition not like '%task.metadata -> ''detail_lines'' ->> -1%' then
    raise exception 'atlas.bell_history_v2 no longer matches the reviewed completion-result contract';
  end if;

  v_first_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old_fragment, ''))
  ) / nullif(length(v_old_fragment), 0);
  v_second_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old_case_end, ''))
  ) / nullif(length(v_old_case_end), 0);

  if v_first_occurrences <> 1 or v_second_occurrences <> 1 then
    raise exception 'Expected one result-precedence fragment and one case ending, found % and %', v_first_occurrences, v_second_occurrences;
  end if;

  v_definition := replace(v_definition, v_old_fragment, v_new_fragment);
  v_definition := replace(v_definition, v_old_case_end, v_new_case_end);
  execute v_definition;
end;
$migration$;

comment on function atlas.bell_history_v2(uuid, uuid, integer, timestamptz) is
  'Role-aware Bell. Management keeps planning queues. Employee follow-through cards prefer explicit downstream unlocks, then explicit or action-derived completion results, and only then a task detail line.';

do $postcondition$
declare
  v_definition text;
  v_case_position integer;
  v_detail_position integer;
begin
  select pg_get_functiondef('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)'::regprocedure)
  into v_definition;

  v_case_position := strpos(v_definition, 'case' || chr(10) || '          when task.action_key = ''mow''');
  v_detail_position := strpos(v_definition, 'nullif(task.metadata -> ''detail_lines'' ->> -1, '''')');

  if v_case_position = 0
     or v_detail_position = 0
     or v_case_position >= v_detail_position
     or v_definition not like '%current_assigned_task_movement_per_task%' then
    raise exception 'Employee Bell result precedence postcondition failed';
  end if;
end;
$postcondition$;

commit;
