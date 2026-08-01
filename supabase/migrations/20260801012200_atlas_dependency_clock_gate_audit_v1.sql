begin;

do $migration$
declare
  v_definition text;
  v_fragment text := $fragment$
      insert into atlas.work_gate_evaluations(
        farm_id, occurrence_id, release_policy_id, outcome, reason, gate_snapshot
      ) values (
        v_clock.farm_id,
        v_occurrence.id,
        v_occurrence.release_policy_id,
        'gate_satisfied',
        'Task dependency clock elapsed.',
        jsonb_build_object(
          'dependency_clock_id', v_clock.id,
          'source_task_id', v_clock.source_task_id,
          'source_transition_id', v_clock.source_transition_id,
          'source_satisfied_at', v_clock.source_satisfied_at,
          'ready_at', v_clock.ready_at,
          'delay_seconds', extract(epoch from v_clock.delay_interval)::integer
        )
      );
$fragment$;
  v_occurrences integer;
begin
  select pg_get_functiondef('atlas.advance_task_dependency_clocks_v1(timestamp with time zone,integer)'::regprocedure)
  into v_definition;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_fragment, ''))
  ) / nullif(length(v_fragment), 0);

  if v_occurrences <> 1 then
    raise exception 'Expected exactly one unsupported dependency gate audit fragment, found %.', v_occurrences;
  end if;

  v_definition := replace(v_definition, v_fragment, '');
  execute v_definition;
end;
$migration$;

comment on function atlas.advance_task_dependency_clocks_v1(timestamptz, integer) is
  'Advances elapsed dependency clocks. Gate readiness is recorded on the occurrence; the allowed released audit is written only when the downstream task actually materializes.';

do $postcondition$
declare
  v_definition text;
begin
  select pg_get_functiondef('atlas.advance_task_dependency_clocks_v1(timestamp with time zone,integer)'::regprocedure)
  into v_definition;

  if v_definition like '%''gate_satisfied''%'
    or v_definition not like '%gate_satisfied_at = v_clock.ready_at%'
  then
    raise exception 'Dependency clock gate audit correction failed.';
  end if;
end;
$postcondition$;

commit;
