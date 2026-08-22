-- PostgreSQL cannot revoke the global PUBLIC function default for only one schema
-- with ALTER DEFAULT PRIVILEGES. Enforce the Atlas-only invariant at DDL time
-- instead: every CREATE OR REPLACE FUNCTION in atlas loses PUBLIC EXECUTE.
-- Deliberate role-specific grants remain untouched and can be issued afterward.

create or replace function atlas.enforce_atlas_function_private_default_v1()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  command record;
begin
  for command in select * from pg_event_trigger_ddl_commands()
  loop
    if command.schema_name = 'atlas' and command.object_type = 'function' then
      execute format('revoke execute on function %s from public', command.object_identity);
    end if;
  end loop;
end;
$function$;

revoke all on function atlas.enforce_atlas_function_private_default_v1() from public, anon, authenticated;

drop event trigger if exists atlas_private_function_default_v1;
create event trigger atlas_private_function_default_v1
on ddl_command_end
when tag in ('CREATE FUNCTION')
execute function atlas.enforce_atlas_function_private_default_v1();

comment on function atlas.enforce_atlas_function_private_default_v1()
is 'DDL guard: strips inherited PUBLIC EXECUTE from every Atlas function creation/replacement without removing deliberate role-specific grants.';