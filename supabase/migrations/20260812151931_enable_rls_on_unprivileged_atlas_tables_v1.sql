-- Release hardening for Atlas tables exposed through the PostgREST schema.
-- Production verification before this migration showed that neither anon nor
-- authenticated has SELECT/INSERT/UPDATE/DELETE privileges on these tables,
-- while service_role and postgres both BYPASSRLS. Therefore enabling RLS adds
-- the missing defense-in-depth boundary without inventing client policies or
-- changing an existing direct client access contract.

do $block$
declare
  v_table text;
  v_tables text[]:=array[
    'task_completion_impact_policies',
    'postharvest_containers',
    'production_harvest_lots',
    'production_harvest_stand_entries',
    'production_harvest_container_assignments',
    'postharvest_container_events',
    'production_postharvest_gates',
    'production_harvest_lot_tasks',
    'goals',
    'goal_requirements',
    'goal_evaluations',
    'goal_transitions',
    'goal_task_links',
    'task_prerequisites',
    'owner_week_projection',
    'project_relationships'
  ];
begin
  if not coalesce((select rolbypassrls from pg_roles where rolname='service_role'),false)
     or not coalesce((select rolbypassrls from pg_roles where rolname='postgres'),false) then
    raise exception 'Expected service_role and postgres to bypass RLS; refusing Atlas RLS hardening.';
  end if;

  foreach v_table in array v_tables loop
    if to_regclass(format('atlas.%I',v_table)) is null then
      raise exception 'Expected Atlas table % is missing; refusing partial RLS hardening.',v_table;
    end if;

    if has_table_privilege('anon',format('atlas.%I',v_table),'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated',format('atlas.%I',v_table),'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'Table atlas.% has a direct anon/authenticated privilege; policy classification is required before enabling RLS.',v_table;
    end if;

    execute format('alter table atlas.%I enable row level security',v_table);
  end loop;
end;
$block$;
