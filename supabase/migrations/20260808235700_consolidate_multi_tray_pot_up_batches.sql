-- One crop + one operation + one day is one worker-facing task; trays are checklist items.
do $batch_cleanup$
declare
  g record; parent_task atlas.tasks%rowtype; member_task record;
  item_count integer; total_quantity integer; total_effort numeric; template_key text;
begin
  for g in
    with grouped as (
      select task.farm_id,task.metadata->>'schedule_batch_key' as batch_key,task.due_date,task.action_key,
             task.metadata->>'display_subject' as subject,count(*) as member_count
      from atlas.tasks task
      where task.status in ('open','blocked') and task.action_key='pot_up'
        and nullif(task.metadata->>'schedule_batch_key','') is not null
        and nullif(task.metadata->>'display_subject','') is not null
      group by task.farm_id,task.metadata->>'schedule_batch_key',task.due_date,task.action_key,task.metadata->>'display_subject'
      having count(*)>1
    )
    select grouped.* from grouped
    where not exists(
      select 1 from atlas.task_transitions transition
      join atlas.tasks transitioned_task on transitioned_task.id=transition.task_id
      where transitioned_task.farm_id=grouped.farm_id
        and transitioned_task.metadata->>'schedule_batch_key'=grouped.batch_key
        and transitioned_task.due_date is not distinct from grouped.due_date
        and transitioned_task.action_key=grouped.action_key
        and transitioned_task.metadata->>'display_subject'=grouped.subject)
  loop
    select task.* into parent_task from atlas.tasks task
    where task.farm_id=g.farm_id and task.status in ('open','blocked')
      and task.metadata->>'schedule_batch_key'=g.batch_key and task.due_date is not distinct from g.due_date
      and task.action_key=g.action_key and task.metadata->>'display_subject'=g.subject
    order by coalesce(nullif(task.metadata->>'tray_number','')::integer,9999),task.created_at,task.id limit 1;

    select count(*),coalesce(sum(coalesce(nullif(task.metadata->>'target_quantity','')::integer,0)),0),
           coalesce(sum(coalesce(task.effort_units,nullif(task.metadata->>'effort_units','')::numeric,1)),0)
    into item_count,total_quantity,total_effort
    from atlas.tasks task
    where task.farm_id=g.farm_id and task.status in ('open','blocked')
      and task.metadata->>'schedule_batch_key'=g.batch_key and task.due_date is not distinct from g.due_date
      and task.action_key=g.action_key and task.metadata->>'display_subject'=g.subject;

    template_key:='batch_pot_up_'||replace(g.due_date::text,'-','')||'_'||substr(md5(g.batch_key||':'||g.subject),1,12);

    for member_task in
      select task.* from atlas.tasks task
      where task.farm_id=g.farm_id and task.status in ('open','blocked')
        and task.metadata->>'schedule_batch_key'=g.batch_key and task.due_date is not distinct from g.due_date
        and task.action_key=g.action_key and task.metadata->>'display_subject'=g.subject
      order by coalesce(nullif(task.metadata->>'tray_number','')::integer,9999),task.created_at,task.id
    loop
      insert into atlas.task_execution_checklist_items(farm_id,task_id,item_key,section_key,section_label,item_label,sort_order,required,checked,metadata)
      values(g.farm_id,parent_task.id,
        'tray_'||coalesce(nullif(member_task.metadata->>'tray_number',''),substr(member_task.id::text,1,8)),
        'trays','Trays',
        case when nullif(member_task.metadata->>'tray_number','') is not null
          then 'Tray '||(member_task.metadata->>'tray_number')||case when nullif(member_task.metadata->>'target_quantity','') is not null then ' · '||(member_task.metadata->>'target_quantity') else '' end
          else member_task.title end,
        coalesce(nullif(member_task.metadata->>'tray_number','')::integer,9999),true,false,
        jsonb_build_object('source_task_id',member_task.id,'source_planned_occurrence_id',member_task.planned_occurrence_id,
          'target_quantity',nullif(member_task.metadata->>'target_quantity','')::integer,
          'quantity_unit',coalesce(nullif(member_task.metadata->>'quantity_unit',''),'plants'),'tray_number',nullif(member_task.metadata->>'tray_number','')::integer))
      on conflict(task_id,item_key) do update set item_label=excluded.item_label,sort_order=excluded.sort_order,required=true,
        metadata=atlas.task_execution_checklist_items.metadata||excluded.metadata,updated_at=now();

      insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role)
      select parent_task.id,link.crop_cycle_id,link.role from atlas.task_crop_cycles link
      where link.task_id=member_task.id
        and not exists(select 1 from atlas.task_crop_cycles existing where existing.task_id=parent_task.id and existing.crop_cycle_id=link.crop_cycle_id and existing.role=link.role);
    end loop;

    update atlas.tasks set title='Pot up · '||g.subject,effort_units=total_effort,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'task_work_shape','batch','batch_key',g.batch_key,'batch_item_kind','tray','batch_item_count',item_count,
        'batch_total_quantity',total_quantity,'batch_quantity_unit','plants','display_action','Pot up','display_subject',g.subject,
        'display_detail',item_count||' trays · '||total_quantity||' plants','execution_checklist_template_key',template_key,
        'execution_checklist_kicker','Pot up','execution_checklist_title',g.subject||' · '||item_count||' trays',
        'execution_checklist_completion_label',g.subject||' is potted up','batch_consolidated_at',now()),updated_at=now()
    where id=parent_task.id;

    update atlas.tasks task set status='archived',completed_at=null,
      metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object('task_work_shape','batch_member_archived',
        'consolidated_into_task_id',parent_task.id,'consolidated_at',now(),'archived_reason','Consolidated into one crop pot-up task before work began.'),updated_at=now()
    where task.farm_id=g.farm_id and task.id<>parent_task.id and task.status in ('open','blocked')
      and task.metadata->>'schedule_batch_key'=g.batch_key and task.due_date is not distinct from g.due_date
      and task.action_key=g.action_key and task.metadata->>'display_subject'=g.subject;

    update atlas.planned_work_occurrences occurrence set state='cancelled',
      metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object('cancelledBy','batch_task_consolidation_v1','cancelledAt',now(),'consolidatedIntoTaskId',parent_task.id),updated_at=now()
    where occurrence.released_task_id in(select task.id from atlas.tasks task where task.farm_id=g.farm_id and task.id<>parent_task.id and task.metadata->>'consolidated_into_task_id'=parent_task.id::text);
  end loop;
end;$batch_cleanup$;

create unique index if not exists tasks_one_active_batch_work_unit_v1
on atlas.tasks(farm_id,(metadata->>'batch_key'),due_date,action_key,(metadata->>'display_subject'))
where status in ('open','blocked') and metadata->>'task_work_shape'='batch';