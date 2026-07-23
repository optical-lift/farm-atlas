-- Phase 3 keeps Farm Care in Atlas's shared operational read surface.
-- This changes only the three prepared read RPCs. Management mutations remain restricted.

do $migration$
declare
  v_signature text;
  v_definition text;
  v_signatures constant text[] := array[
    'atlas.farm_care_summary_v1(uuid,integer)',
    'atlas.farm_care_zone_v1(uuid,text,integer)',
    'atlas.farm_care_object_v1(uuid,text,integer)'
  ];
begin
  foreach v_signature in array v_signatures loop
    select pg_get_functiondef(v_signature::regprocedure)
    into v_definition;

    if position('atlas.can_read_farm_operations(p_farm_id)' in v_definition) = 0 then
      raise exception 'Expected management-only Farm Care read guard was not found in %.', v_signature;
    end if;

    v_definition := replace(
      v_definition,
      'atlas.can_read_farm_operations(p_farm_id)',
      'atlas.is_farm_member(p_farm_id)'
    );

    execute v_definition;
  end loop;
end
$migration$;

revoke all on function atlas.farm_care_summary_v1(uuid,integer) from public, anon;
revoke all on function atlas.farm_care_zone_v1(uuid,text,integer) from public, anon;
revoke all on function atlas.farm_care_object_v1(uuid,text,integer) from public, anon;

grant execute on function atlas.farm_care_summary_v1(uuid,integer) to authenticated;
grant execute on function atlas.farm_care_zone_v1(uuid,text,integer) to authenticated;
grant execute on function atlas.farm_care_object_v1(uuid,text,integer) to authenticated;

comment on function atlas.farm_care_summary_v1(uuid,integer) is
  'Shared active-member Farm Care home query with reconciled farm totals, zone cards, interventions, coverage, effort, and recent wins.';
comment on function atlas.farm_care_zone_v1(uuid,text,integer) is
  'Shared active-member zone drill-down query with object groups, interventions, and bounded history.';
comment on function atlas.farm_care_object_v1(uuid,text,integer) is
  'Shared active-member object drill-down query with contents, state, strategy, evidence, interventions, and bounded history.';
