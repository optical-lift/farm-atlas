begin;

create index if not exists task_dependency_clocks_farm_id_idx
  on atlas.task_dependency_clocks(farm_id);

create index if not exists task_dependency_clocks_source_task_id_idx
  on atlas.task_dependency_clocks(source_task_id);

create index if not exists task_dependency_clocks_source_transition_id_idx
  on atlas.task_dependency_clocks(source_transition_id);

drop index if exists atlas.task_dependency_clocks_downstream_task_idx;
create index task_dependency_clocks_downstream_task_idx
  on atlas.task_dependency_clocks(downstream_task_id);

do $postcondition$
declare
  v_missing text[];
begin
  select array_agg(column_name order by column_name)
  into v_missing
  from (
    values
      ('farm_id'),
      ('source_task_id'),
      ('source_transition_id'),
      ('downstream_occurrence_id'),
      ('downstream_task_id')
  ) expected(column_name)
  where not exists (
    select 1
    from pg_index index_row
    join pg_class index_relation on index_relation.oid = index_row.indexrelid
    join pg_class table_relation on table_relation.oid = index_row.indrelid
    join pg_namespace namespace on namespace.oid = table_relation.relnamespace
    join pg_attribute attribute
      on attribute.attrelid = table_relation.oid
     and attribute.attnum = index_row.indkey[0]
    where namespace.nspname = 'atlas'
      and table_relation.relname = 'task_dependency_clocks'
      and index_row.indisvalid
      and index_row.indpred is null
      and attribute.attname = expected.column_name
  );

  if coalesce(cardinality(v_missing), 0) <> 0 then
    raise exception 'Dependency clock FK index postcondition failed for columns: %', v_missing;
  end if;
end;
$postcondition$;

comment on index atlas.task_dependency_clocks_farm_id_idx is
  'Supports farm-scoped dependency-clock cleanup and the farm foreign key.';
comment on index atlas.task_dependency_clocks_source_task_id_idx is
  'Supports full source-task foreign-key coverage; the partial active-state index remains for clock starts.';
comment on index atlas.task_dependency_clocks_source_transition_id_idx is
  'Supports transition deletion and dependency-clock trace lookup.';
comment on index atlas.task_dependency_clocks_downstream_task_idx is
  'Supports full downstream-task foreign-key coverage and terminal-state closure.';

commit;
