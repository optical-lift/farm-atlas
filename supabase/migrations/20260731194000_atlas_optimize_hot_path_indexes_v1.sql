-- Phase 1 stabilization, performance slice 1: remove one structurally
-- duplicate task index and add the seven reviewed single-column indexes that
-- cover high-traffic Atlas foreign-key relationships.
--
-- The migration fails closed if the duplicate indexes are no longer identical,
-- if the removal target backs a constraint, or if any reviewed foreign key has
-- drifted from the production schema that was audited.

do $migration$
declare
  kept_oid oid := to_regclass('atlas.tasks_active_engine_instance_idx');
  dropped_oid oid := to_regclass('atlas.tasks_one_active_engine_instance_uidx');
  expected record;
  target_rel oid;
  target_attnum smallint;
begin
  if kept_oid is null or dropped_oid is null then
    raise exception 'Expected duplicate Atlas task indexes are not both present.';
  end if;

  if exists (select 1 from pg_constraint where conindid = dropped_oid) then
    raise exception 'Atlas duplicate index selected for removal backs a constraint.';
  end if;

  if not exists (
    select 1
    from pg_index kept
    join pg_index duplicate on duplicate.indexrelid = dropped_oid
    where kept.indexrelid = kept_oid
      and kept.indrelid = duplicate.indrelid
      and kept.indisunique = duplicate.indisunique
      and kept.indkey = duplicate.indkey
      and kept.indcollation = duplicate.indcollation
      and kept.indclass = duplicate.indclass
      and kept.indoption = duplicate.indoption
      and pg_get_expr(kept.indexprs, kept.indrelid)
          is not distinct from pg_get_expr(duplicate.indexprs, duplicate.indrelid)
      and pg_get_expr(kept.indpred, kept.indrelid)
          is not distinct from pg_get_expr(duplicate.indpred, duplicate.indrelid)
  ) then
    raise exception 'Atlas task indexes are no longer structurally identical.';
  end if;

  for expected in
    select * from (values
      ('tasks','assigned_membership_id','tasks_assigned_membership_id_fkey','tasks_assigned_membership_id_idx'),
      ('tasks','created_by_user_id','tasks_created_by_user_id_fkey','tasks_created_by_user_id_idx'),
      ('tasks','release_policy_id','tasks_release_policy_id_fkey','tasks_release_policy_id_idx'),
      ('tasks','zone_id','tasks_zone_id_fkey','tasks_zone_id_idx'),
      ('growing_objects','zone_id','growing_objects_zone_id_fkey','growing_objects_zone_id_idx'),
      ('projects','farm_id','projects_farm_id_fkey','projects_farm_id_idx'),
      ('projects','zone_id','projects_zone_id_fkey','projects_zone_id_idx')
    ) as reviewed(table_name,column_name,constraint_name,index_name)
  loop
    target_rel := to_regclass(format('atlas.%I', expected.table_name));
    if target_rel is null then
      raise exception 'Reviewed Atlas table %.% does not exist.', 'atlas', expected.table_name;
    end if;

    select attnum::smallint
    into target_attnum
    from pg_attribute
    where attrelid = target_rel
      and attname = expected.column_name
      and not attisdropped;

    if target_attnum is null then
      raise exception 'Reviewed Atlas column %.% does not exist.', expected.table_name, expected.column_name;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = target_rel
        and conname = expected.constraint_name
        and contype = 'f'
        and conkey = array[target_attnum]::smallint[]
    ) then
      raise exception 'Reviewed Atlas foreign key % no longer matches %.%.',
        expected.constraint_name, expected.table_name, expected.column_name;
    end if;

    if to_regclass(format('atlas.%I', expected.index_name)) is not null then
      raise exception 'Reviewed Atlas index % already exists; migration scope has drifted.', expected.index_name;
    end if;
  end loop;
end
$migration$;

drop index atlas.tasks_one_active_engine_instance_uidx;

create index tasks_assigned_membership_id_idx
  on atlas.tasks (assigned_membership_id);
create index tasks_created_by_user_id_idx
  on atlas.tasks (created_by_user_id);
create index tasks_release_policy_id_idx
  on atlas.tasks (release_policy_id);
create index tasks_zone_id_idx
  on atlas.tasks (zone_id);
create index growing_objects_zone_id_idx
  on atlas.growing_objects (zone_id);
create index projects_farm_id_idx
  on atlas.projects (farm_id);
create index projects_zone_id_idx
  on atlas.projects (zone_id);

do $verification$
declare
  expected record;
  index_oid oid;
  target_rel oid;
  target_attnum smallint;
begin
  if to_regclass('atlas.tasks_one_active_engine_instance_uidx') is not null then
    raise exception 'Redundant Atlas task index still exists.';
  end if;

  if to_regclass('atlas.tasks_active_engine_instance_idx') is null then
    raise exception 'Canonical Atlas active-engine task index was removed.';
  end if;

  for expected in
    select * from (values
      ('tasks','assigned_membership_id','tasks_assigned_membership_id_idx'),
      ('tasks','created_by_user_id','tasks_created_by_user_id_idx'),
      ('tasks','release_policy_id','tasks_release_policy_id_idx'),
      ('tasks','zone_id','tasks_zone_id_idx'),
      ('growing_objects','zone_id','growing_objects_zone_id_idx'),
      ('projects','farm_id','projects_farm_id_idx'),
      ('projects','zone_id','projects_zone_id_idx')
    ) as reviewed(table_name,column_name,index_name)
  loop
    target_rel := to_regclass(format('atlas.%I', expected.table_name));
    index_oid := to_regclass(format('atlas.%I', expected.index_name));

    select attnum::smallint
    into target_attnum
    from pg_attribute
    where attrelid = target_rel
      and attname = expected.column_name
      and not attisdropped;

    if index_oid is null then
      raise exception 'Required Atlas index % was not created.', expected.index_name;
    end if;

    if not exists (
      select 1
      from pg_index
      where indexrelid = index_oid
        and indrelid = target_rel
        and indisvalid
        and indisready
        and indnatts = 1
        and indkey[0] = target_attnum
    ) then
      raise exception 'Atlas index % does not exactly cover %.%.',
        expected.index_name, expected.table_name, expected.column_name;
    end if;
  end loop;
end
$verification$;
