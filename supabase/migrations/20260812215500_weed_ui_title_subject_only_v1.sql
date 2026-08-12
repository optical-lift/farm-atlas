create or replace function atlas.canonicalize_weed_task_title_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_object_id uuid;
  v_card_id uuid;
  v_maintenance_id uuid;
  v_object_label text;
  v_occurrence_source_kind text;
  v_occurrence_source_id uuid;
begin
  if not (
    lower(coalesce(new.action_key,'')) in ('weed','weeding')
    or lower(coalesce(new.task_type,'')) in ('weed','weeding')
    or lower(coalesce(new.metadata->>'work_route','')) in ('weed','weeding')
    or coalesce(new.metadata->>'maintenance_type','')='weed'
    or coalesce(new.metadata->>'weed_card_managed','false')='true'
    or lower(coalesce(new.title,'')) like 'weed %'
  ) then return new; end if;

  begin v_object_id:=nullif(new.metadata->>'target_object_id','')::uuid; exception when invalid_text_representation then v_object_id:=null; end;
  if v_object_id is null then
    begin v_card_id:=nullif(new.metadata->>'weed_card_id','')::uuid; exception when invalid_text_representation then v_card_id:=null; end;
    if v_card_id is not null then select object_id into v_object_id from atlas.weed_cards where id=v_card_id; end if;
  end if;
  if v_object_id is null then
    begin v_maintenance_id:=nullif(new.metadata->>'maintenance_object_id','')::uuid; exception when invalid_text_representation then v_maintenance_id:=null; end;
    if v_maintenance_id is not null then select object_id into v_object_id from atlas.maintenance_objects where id=v_maintenance_id; end if;
  end if;
  if v_object_id is null and new.generated_from='maintenance_weeding_collection' and new.generated_from_id is not null then
    select object_id into v_object_id from atlas.maintenance_objects where id=new.generated_from_id;
  elsif v_object_id is null and new.generated_from='weed_card' and new.generated_from_id is not null then
    select object_id into v_object_id from atlas.weed_cards where id=new.generated_from_id;
  elsif v_object_id is null and new.generated_from='rhythm_clock' and new.generated_from_id is not null then
    select subject_id into v_object_id from atlas.rhythm_state where id=new.generated_from_id and rhythm_key='weed_stewardship' and subject_kind='growing_object';
  end if;
  if v_object_id is null and new.planned_occurrence_id is not null then
    select source_kind,source_id into v_occurrence_source_kind,v_occurrence_source_id from atlas.planned_work_occurrences where id=new.planned_occurrence_id;
    if v_occurrence_source_kind='maintenance_weeding_collection' then
      select object_id into v_object_id from atlas.maintenance_objects where id=v_occurrence_source_id;
    elsif v_occurrence_source_kind='rhythm_state' then
      select subject_id into v_object_id from atlas.rhythm_state where id=v_occurrence_source_id and rhythm_key='weed_stewardship' and subject_kind='growing_object';
    end if;
  end if;
  if v_object_id is null and new.id is not null then
    select linked.object_id into v_object_id from atlas.task_objects linked where linked.task_id=new.id order by case when linked.role='target' then 0 else 1 end,linked.created_at,linked.id limit 1;
  end if;
  if v_object_id is not null then select label into v_object_label from atlas.growing_objects where id=v_object_id; end if;
  v_object_label:=coalesce(nullif(v_object_label,''),nullif(new.metadata->>'display_subject',''),nullif(new.metadata->>'collection_label',''));
  if v_object_label is not null then
    new.title:='Weed '||v_object_label;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'display_title',v_object_label,
      'display_action','Weed',
      'display_subject',v_object_label,
      'target_object_id',v_object_id,
      'canonical_weed_title',true
    );
  end if;
  return new;
end;
$function$;

update atlas.tasks set updated_at=now() where title='Weed MG11' and status in ('open','blocked');
