begin;

create index if not exists maintenance_directives_organization_id_idx
  on atlas.maintenance_directives(organization_id);

create index if not exists maintenance_directives_created_by_user_id_idx
  on atlas.maintenance_directives(created_by_user_id);

create index if not exists maintenance_directives_completed_by_user_id_idx
  on atlas.maintenance_directives(completed_by_user_id);

create index if not exists maintenance_directive_steps_completed_by_user_id_idx
  on atlas.maintenance_directive_steps(completed_by_user_id);

do $postcondition$
declare
  v_missing text[];
begin
  with expected(table_name, column_name) as (
    values
      ('maintenance_directives', 'organization_id'),
      ('maintenance_directives', 'farm_id'),
      ('maintenance_directives', 'object_id'),
      ('maintenance_directives', 'weed_card_id'),
      ('maintenance_directives', 'rhythm_state_id'),
      ('maintenance_directives', 'assigned_membership_id'),
      ('maintenance_directives', 'serving_task_id'),
      ('maintenance_directives', 'prerequisite_task_id'),
      ('maintenance_directives', 'created_by_user_id'),
      ('maintenance_directives', 'completed_by_user_id'),
      ('maintenance_directive_steps', 'directive_id'),
      ('maintenance_directive_steps', 'completed_by_user_id'),
      ('maintenance_directive_crop_cycles', 'directive_id'),
      ('maintenance_directive_crop_cycles', 'crop_cycle_id')
  )
  select array_agg(expected.table_name || '.' || expected.column_name order by expected.table_name, expected.column_name)
  into v_missing
  from expected
  where not exists (
    select 1
    from pg_index index_row
    join pg_class table_relation on table_relation.oid = index_row.indrelid
    join pg_namespace namespace on namespace.oid = table_relation.relnamespace
    join pg_attribute attribute
      on attribute.attrelid = table_relation.oid
     and attribute.attnum = index_row.indkey[0]
    where namespace.nspname = 'atlas'
      and table_relation.relname = expected.table_name
      and attribute.attname = expected.column_name
      and index_row.indisvalid
      and index_row.indpred is null
  );

  if coalesce(cardinality(v_missing), 0) <> 0 then
    raise exception 'Maintenance directive FK index postcondition failed: %', v_missing;
  end if;
end;
$postcondition$;

comment on index atlas.maintenance_directives_organization_id_idx is
  'Supports organization deletion checks for object-first maintenance directives.';
comment on index atlas.maintenance_directives_created_by_user_id_idx is
  'Supports creator-account deletion and directive provenance lookup.';
comment on index atlas.maintenance_directives_completed_by_user_id_idx is
  'Supports completion-account deletion and directive completion audit.';
comment on index atlas.maintenance_directive_steps_completed_by_user_id_idx is
  'Supports checklist-completer deletion and checklist audit.';

commit;
