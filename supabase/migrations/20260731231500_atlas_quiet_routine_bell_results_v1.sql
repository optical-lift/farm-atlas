begin;

do $preflight$
begin
  if to_regprocedure('atlas.bell_event_is_worthy_v1(uuid)') is null then
    raise exception 'Expected atlas.bell_event_is_worthy_v1(uuid) before narrowing Bell result noise';
  end if;
end;
$preflight$;

create or replace function atlas.bell_event_is_worthy_v1(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select coalesce((
    select event.importance in ('attention', 'critical')
      or event.event_kind in (
        'rhythm_warning', 'rhythm_due', 'rhythm_failure',
        'unlock', 'production_change', 'owner_decision'
      )
      or (
        event.event_kind = 'task_result'
        and event.source_event in ('reopened', 'blocked')
      )
    from atlas.journal_event_index event
    where event.id = p_event_id
  ), false);
$function$;

comment on function atlas.bell_event_is_worthy_v1(uuid) is
  'Bell significance gate. Routine done, partial, rescheduled, changed-plan, and maintenance result records remain in the Journal and Trail but do not become Bell notifications. Exceptional blocked/reopened results and attention/critical events remain Bell-worthy.';

do $postcondition$
declare
  v_definition text;
begin
  select pg_get_functiondef('atlas.bell_event_is_worthy_v1(uuid)'::regprocedure)
  into v_definition;

  if v_definition not like '%event.source_event in (''reopened'', ''blocked'')%'
     or v_definition like '%''maintenance_result''%'
     or v_definition like '%''task_result'', ''maintenance_result''%' then
    raise exception 'Bell worthiness postcondition failed';
  end if;
end;
$postcondition$;

commit;
