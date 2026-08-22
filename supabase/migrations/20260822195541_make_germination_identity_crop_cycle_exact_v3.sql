create or replace function atlas.collapse_new_germination_duplicate_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_key text;
  v_cycle_id uuid;
  v_cycle atlas.crop_cycles%rowtype;
  v_canonical atlas.tasks%rowtype;
  v_new_is_canonical boolean := false;
  v_object_id uuid;
  v_source_sowing_task_id uuid;
  v_unique_biological_cycle_count integer := 0;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.status not in ('open','blocked') then return new; end if;
  if not atlas.is_germination_task_v1(new) then return new; end if;

  v_cycle_id := atlas.germination_task_crop_cycle_id_v1(new);

  if v_cycle_id is not null then
    select * into v_cycle from atlas.crop_cycles where id=v_cycle_id;

    if v_cycle.id is not null
       and (v_cycle.germination_checked_date is not null or v_cycle.cycle_state='germinated') then
      perform atlas.archive_resolved_germination_tasks_v1(v_cycle_id,null,'Germination already recorded for crop cycle');
      return new;
    end if;

    select task.* into v_canonical
    from atlas.tasks task
    where task.id<>new.id
      and task.farm_id=new.farm_id
      and task.status in ('open','blocked','done')
      and atlas.is_germination_task_v1(task)
      and atlas.germination_task_crop_cycle_id_v1(task)=v_cycle_id
    order by
      case when task.status='done' then 0 else 1 end,
      case when task.generated_from='crop_cycle_milestone' then 0 else 1 end,
      task.created_at,task.id
    limit 1;

    if v_canonical.id is not null then
      v_new_is_canonical := new.generated_from='crop_cycle_milestone'
        and v_canonical.status in ('open','blocked')
        and v_canonical.generated_from is distinct from 'crop_cycle_milestone';

      if v_new_is_canonical then
        perform atlas.archive_resolved_germination_tasks_v1(v_cycle_id,new.id,'Duplicate germination event for crop cycle');
      else
        update atlas.tasks
        set status='archived',
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'archived_reason',case when v_canonical.status='done' then 'Germination already recorded for crop cycle' else 'Duplicate germination event for crop cycle' end,
              'canonical_crop_cycle_id',v_cycle_id,
              'canonical_germination_task_id',v_canonical.id,
              'germination_resolution_guard','crop_cycle_identity_v2',
              'archived_at',now()
            ),
            updated_at=now()
        where id=new.id;
      end if;
      return new;
    end if;

    if v_cycle.id is not null then
      select count(*) into v_unique_biological_cycle_count
      from atlas.crop_cycles c
      where c.farm_id=v_cycle.farm_id
        and c.object_id=v_cycle.object_id
        and c.crop_profile_id is not distinct from v_cycle.crop_profile_id
        and c.sown_date is not distinct from v_cycle.sown_date
        and c.lifecycle_status='active';

      update atlas.tasks task
      set status='archived',
          metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
            'archived_reason','Superseded by canonical crop-cycle germination task for exact biological subject',
            'canonical_crop_cycle_id',v_cycle.id,
            'canonical_germination_task_id',new.id,
            'germination_resolution_guard','object_source_or_unique_profile_sown_date_v2',
            'archived_at',now()
          ),
          updated_at=now()
      where task.id<>new.id
        and task.farm_id=new.farm_id
        and task.status in ('open','blocked')
        and atlas.is_germination_task_v1(task)
        and atlas.germination_task_crop_cycle_id_v1(task) is null
        and task.metadata->>'object_id'=v_cycle.object_id::text
        and (
          task.metadata->>'source_sowing_task_id'=v_cycle.source_task_id::text
          or (
            v_unique_biological_cycle_count=1
            and task.metadata->>'source_sown_date'=v_cycle.sown_date::text
            and task.metadata->>'crop_profile_id'=v_cycle.crop_profile_id::text
          )
        );
    end if;
    return new;
  end if;

  begin
    v_object_id := nullif(new.metadata->>'object_id','')::uuid;
  exception when others then
    v_object_id := null;
  end;
  begin
    v_source_sowing_task_id := nullif(new.metadata->>'source_sowing_task_id','')::uuid;
  exception when others then
    v_source_sowing_task_id := null;
  end;

  v_key := atlas.germination_variety_key_v1(new.metadata,new.title);

  if v_object_id is null then
    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'germination_variety_key',v_key,
      'germination_resolution_guard','legacy_identity_unresolved_v2',
      'automatic_deduplication_allowed',false
    ),updated_at=now()
    where id=new.id;
    return new;
  end if;

  select task.* into v_canonical
  from atlas.tasks task
  where task.id<>new.id
    and task.farm_id=new.farm_id
    and task.status in ('open','blocked')
    and task.due_date is not distinct from new.due_date
    and atlas.is_germination_task_v1(task)
    and task.metadata->>'object_id'=v_object_id::text
    and atlas.germination_variety_key_v1(task.metadata,task.title)=v_key
    and (
      (v_source_sowing_task_id is not null and task.metadata->>'source_sowing_task_id'=v_source_sowing_task_id::text)
      or atlas.germination_task_crop_cycle_id_v1(task) is not null
    )
  order by
    case when atlas.germination_task_crop_cycle_id_v1(task) is not null then 0 else 1 end,
    case when task.generated_from='crop_cycle_milestone' then 0 else 1 end,
    task.created_at,task.id
  limit 1;

  if v_canonical.id is not null then
    update atlas.tasks
    set status='archived',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'archived_reason','Duplicate germination event for exact destination and source identity',
          'canonical_germination_task_id',v_canonical.id,
          'germination_resolution_guard','legacy_exact_object_source_v2',
          'archived_at',now()
        ),updated_at=now()
    where id=new.id;
  else
    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'germination_variety_key',v_key,
      'collection_member_key','germination:'||v_key||':'||v_object_id::text||':'||coalesce(due_date::text,'open'),
      'germination_resolution_guard','legacy_exact_object_v2'
    ),updated_at=now()
    where id=new.id;
  end if;

  return new;
end;
$function$;

create or replace function atlas.create_germination_check_after_sowing_done()
returns trigger
language plpgsql
security definer
set search_path to 'atlas','public'
as $function$
declare
  v_profile atlas.crop_profiles%rowtype;
  v_profile_key text;
  v_anchor_date date;
  v_due_date date;
  v_object record;
  v_task_id uuid;
  v_profile_label text;
  v_existing uuid;
  v_cycle_id uuid;
  v_cycle_due date;
begin
  if new.status<>'done' or old.status='done' then return new; end if;
  if coalesce(new.task_type,'') not in ('sowing','seed_sowing')
     and lower(coalesce(new.title,'')) not like '%sow%'
     and lower(coalesce(new.title,'')) not like '%seed%' then return new; end if;

  v_profile_key:=nullif(new.metadata->>'crop_profile_stable_key','');
  if v_profile_key is null then return new; end if;

  select * into v_profile from atlas.crop_profiles where stable_key=v_profile_key limit 1;
  if v_profile.id is null
     or v_profile.days_to_germination_min is null
     or v_profile.days_to_germination_max is null
     or coalesce((v_profile.metadata->>'germination_workflow_enabled')::boolean,false) is not true then
    return new;
  end if;

  v_anchor_date:=coalesce(new.completed_at::date,current_date);
  v_due_date:=v_anchor_date+case when lower(coalesce(v_profile.crop_label,''))='sunflower' then v_profile.days_to_germination_max else v_profile.days_to_germination_min end;
  v_profile_label:=coalesce(nullif(v_profile.variety,''),v_profile.crop_label);

  for v_object in
    select go.id object_id,go.label object_label,go.stable_key object_key
    from atlas.task_objects t_o join atlas.growing_objects go on go.id=t_o.object_id
    where t_o.task_id=new.id
  loop
    v_cycle_id:=null;
    select c.id into v_cycle_id
    from atlas.crop_cycles c
    where c.farm_id=new.farm_id
      and c.source_task_id=new.id
      and c.object_id=v_object.object_id
      and c.crop_profile_id=v_profile.id
      and c.lifecycle_status in ('active','planned')
    order by c.created_at desc
    limit 1;

    if v_cycle_id is not null then
      select t.id into v_existing
      from atlas.tasks t
      join atlas.task_crop_cycles link on link.task_id=t.id and link.crop_cycle_id=v_cycle_id and link.confidence='confirmed'
      where t.status in ('open','blocked') and atlas.is_germination_task_v1(t)
      order by case when t.generated_from='crop_cycle_milestone' then 0 else 1 end,t.created_at
      limit 1;

      if v_existing is null then
        select coalesce(c.expected_germination_start,c.sown_date+greatest(coalesce(v_profile.days_to_germination_min,3),1))
        into v_cycle_due from atlas.crop_cycles c where c.id=v_cycle_id;

        insert into atlas.tasks(
          farm_id,zone_id,title,task_type,action_key,work_class,status,priority,due_date,
          generated_from,generated_from_id,note,metadata
        ) values(
          new.farm_id,
          coalesce(new.zone_id,(select zone_id from atlas.growing_objects where id=v_object.object_id)),
          'Check germination — '||coalesce(v_profile.crop_label,'Crop')||' · '||v_object.object_label,
          'germination_check','germination_check','crop_cycle','open',coalesce(new.priority,'normal'),v_cycle_due,
          'crop_cycle_milestone',v_cycle_id,
          'Observe the canonical crop cycle and record what is physically present.',
          jsonb_build_object(
            'task_key','crop_cycle_germination_'||replace(v_cycle_id::text,'-',''),
            'task_style','germination_check','anna_task',true,'assigned_to','Anna',
            'display_action','Check','display_subject',v_profile_label||' germination','display_detail',v_object.object_label,
            'collection_zone',v_object.object_label,'crop_cycle_id',v_cycle_id,'crop_profile_id',v_profile.id,
            'crop_profile_stable_key',v_profile.stable_key,'crop_label',v_profile.crop_label,'variety',v_profile.variety,
            'object_id',v_object.object_id,'object_key',v_object.object_key,'object_label',v_object.object_label,
            'source_sowing_task_id',new.id,'source_sown_date',v_anchor_date,
            'expected_germination_start',v_anchor_date+v_profile.days_to_germination_min,
            'expected_germination_end',v_anchor_date+v_profile.days_to_germination_max,
            'days_to_germination_min',v_profile.days_to_germination_min,'days_to_germination_max',v_profile.days_to_germination_max,
            'not_yet_reschedules_daily',true,'canonical_crop_cycle_carrier',true
          )
        ) returning id into v_task_id;

        insert into atlas.task_objects(task_id,object_id,role)
        select v_task_id,v_object.object_id,'primary_location'
        where not exists (
          select 1 from atlas.task_objects x
          where x.task_id=v_task_id and x.object_id=v_object.object_id and x.role='primary_location'
        );

        insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
        select v_task_id,v_cycle_id,'affects','confirmed','crop_cycle_germination_creation_v2','{}'::jsonb
        where not exists (
          select 1 from atlas.task_crop_cycles x
          where x.task_id=v_task_id and x.crop_cycle_id=v_cycle_id
        );

        perform atlas.enroll_germination_watch_v1(v_cycle_id,v_task_id);
      else
        perform atlas.enroll_germination_watch_v1(v_cycle_id,v_existing);
      end if;
      continue;
    end if;

    select t.id into v_existing from atlas.tasks t
    where t.generated_from='germination_workflow'
      and t.generated_from_id=new.id
      and t.metadata->>'object_id'=v_object.object_id::text
      and t.status<>'archived' limit 1;

    if v_existing is null then
      insert into atlas.tasks(farm_id,zone_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata)
      values(
        new.farm_id,coalesce(new.zone_id,(select zone_id from atlas.growing_objects where id=v_object.object_id)),
        'Did '||v_profile_label||' germinate? — '||v_object.object_label,
        'germination_check','open',coalesce(new.priority,'normal'),v_due_date,
        'germination_workflow',new.id,
        'Ask only whether germination has appeared. “Not yet” moves this check to tomorrow. Once germination is visible, log stand quality inline.',
        jsonb_build_object(
          'task_key','germination_check_'||replace(new.id::text,'-','')||'_'||replace(v_object.object_id::text,'-',''),
          'task_style','germination_check','anna_task',true,'assigned_to','Anna','work_route','verify','work_rhythm','Germination Check',
          'display_action','Check','display_subject',v_profile_label||' germination','display_detail',v_object.object_label,'collection_zone',v_object.object_label,
          'source_sowing_task_id',new.id,'source_sown_date',v_anchor_date,'crop_profile_id',v_profile.id,'crop_profile_stable_key',v_profile.stable_key,
          'crop_label',v_profile.crop_label,'crop_variety',v_profile.variety,'object_id',v_object.object_id,'object_key',v_object.object_key,'object_label',v_object.object_label,
          'expected_germination_start',v_anchor_date+v_profile.days_to_germination_min,
          'expected_germination_end',v_anchor_date+v_profile.days_to_germination_max,
          'days_to_germination_min',v_profile.days_to_germination_min,'days_to_germination_max',v_profile.days_to_germination_max,
          'germination_check_uses','later_bound_for_sunflowers','days_to_harvest_watch_min',v_profile.days_to_harvest_watch_min,
          'days_to_harvest_watch_max',v_profile.days_to_harvest_watch_max,'not_yet_reschedules_daily',true,
          'legacy_fallback_reason','no_exact_crop_cycle_identity'
        )
      ) returning id into v_task_id;
      insert into atlas.task_objects(task_id,object_id,role)
      select v_task_id,v_object.object_id,'primary_location'
      where not exists (
        select 1 from atlas.task_objects x
        where x.task_id=v_task_id and x.object_id=v_object.object_id and x.role='primary_location'
      );
    end if;
  end loop;
  return new;
end;
$function$;

update atlas.tasks
set status='open',
    metadata=(coalesce(metadata,'{}'::jsonb)
      - 'archived_reason' - 'canonical_germination_task_id' - 'canonical_crop_cycle_id'
      - 'germination_resolution_guard' - 'archived_at')
      || jsonb_build_object(
        'restored_after_false_cross_bed_dedupe',true,
        'restored_at',now(),
        'restored_by','make_germination_identity_crop_cycle_exact_v3'
      ),
    updated_at=now()
where id in (
  'f1add89e-90e4-459f-8993-0b00eb9f6bc7'::uuid,
  '601a86b8-1a7a-4364-9d8c-bf4c877d33c1'::uuid
);

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'germination_identity_rechecked_at',now(),
      'germination_identity_rechecked_by','make_germination_identity_crop_cycle_exact_v3'
    ),
    updated_at=now()
where id='334761eb-e43e-449c-8678-863084013ac0'::uuid;

with promote(task_id,cycle_id) as (
  values
    ('4b1c1fc2-f40b-4528-a3d3-59aaa5ca4781'::uuid,'a89af374-c713-47ca-8617-905870151d1f'::uuid),
    ('7d66d474-c951-4783-be9e-7cb485dd9bcf'::uuid,'1aae29e3-d1ba-465c-8ecb-3bb574589b96'::uuid),
    ('925475ad-53a6-4bc1-b4db-47e2a102551b'::uuid,'626ddd82-c26b-43d6-b4f7-d63d784f4c38'::uuid)
)
update atlas.tasks t
set action_key='germination_check',
    work_class='crop_cycle',
    generated_from='crop_cycle_milestone',
    generated_from_id=p.cycle_id,
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'crop_cycle_id',p.cycle_id,
      'canonicalized_from_legacy_germination',true,
      'canonicalized_at',now(),
      'canonicalized_by','make_germination_identity_crop_cycle_exact_v3'
    ),
    updated_at=now()
from promote p
where t.id=p.task_id and t.status in ('open','blocked');

with promote(task_id,cycle_id) as (
  values
    ('4b1c1fc2-f40b-4528-a3d3-59aaa5ca4781'::uuid,'a89af374-c713-47ca-8617-905870151d1f'::uuid),
    ('7d66d474-c951-4783-be9e-7cb485dd9bcf'::uuid,'1aae29e3-d1ba-465c-8ecb-3bb574589b96'::uuid),
    ('925475ad-53a6-4bc1-b4db-47e2a102551b'::uuid,'626ddd82-c26b-43d6-b4f7-d63d784f4c38'::uuid)
)
insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
select p.task_id,p.cycle_id,'affects','confirmed','legacy_germination_recovery_v3','{}'::jsonb
from promote p
where not exists (
  select 1 from atlas.task_crop_cycles x
  where x.task_id=p.task_id and x.crop_cycle_id=p.cycle_id
);

select atlas.enroll_germination_watch_v1('a89af374-c713-47ca-8617-905870151d1f'::uuid,'4b1c1fc2-f40b-4528-a3d3-59aaa5ca4781'::uuid);
select atlas.enroll_germination_watch_v1('1aae29e3-d1ba-465c-8ecb-3bb574589b96'::uuid,'7d66d474-c951-4783-be9e-7cb485dd9bcf'::uuid);
select atlas.enroll_germination_watch_v1('626ddd82-c26b-43d6-b4f7-d63d784f4c38'::uuid,'925475ad-53a6-4bc1-b4f7-d63d784f4c38'::uuid);
