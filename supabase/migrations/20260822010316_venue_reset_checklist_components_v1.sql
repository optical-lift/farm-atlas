create or replace function atlas.ensure_venue_reset_checklist_v1(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_line text;
  v_index integer := 0;
  v_item_key text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null or coalesce(v_task.metadata->>'task_style','') <> 'venue_reset' then
    return;
  end if;

  update atlas.task_execution_checklist_items
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('retired','true'),
      updated_at=now()
  where task_id=p_task_id
    and coalesce(metadata->>'venue_reset_component','false')='true';

  if jsonb_typeof(v_task.metadata->'execution_how') <> 'array' then
    return;
  end if;

  for v_line in select value from jsonb_array_elements_text(v_task.metadata->'execution_how')
  loop
    v_index := v_index + 1;
    if nullif(btrim(v_line),'') is null then
      continue;
    end if;
    v_item_key := 'reset_work_'||lpad(v_index::text,2,'0');

    insert into atlas.task_execution_checklist_items (
      farm_id,task_id,item_key,section_key,section_label,item_label,sort_order,required,checked,metadata
    ) values (
      v_task.farm_id,p_task_id,v_item_key,'reset_work','Reset work',btrim(v_line),v_index*10,true,false,
      jsonb_build_object('venue_reset_component',true,'interaction','action','source','task.metadata.execution_how','retired','false')
    )
    on conflict (task_id,item_key) do update
    set section_key=excluded.section_key,
        section_label=excluded.section_label,
        item_label=excluded.item_label,
        sort_order=excluded.sort_order,
        required=excluded.required,
        metadata=coalesce(atlas.task_execution_checklist_items.metadata,'{}'::jsonb)||jsonb_build_object(
          'venue_reset_component',true,'interaction','action','source','task.metadata.execution_how','retired','false'
        ),
        updated_at=now();
  end loop;
end;
$$;

create or replace function atlas.sync_venue_reset_checklist_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.ensure_venue_reset_checklist_v1(new.id);
  return new;
end;
$$;

drop trigger if exists sync_venue_reset_checklist_v1 on atlas.tasks;
create trigger sync_venue_reset_checklist_v1
after insert or update of metadata on atlas.tasks
for each row
when ((new.metadata->>'task_style')='venue_reset')
execute function atlas.sync_venue_reset_checklist_v1();

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('execution_checklist_template_key','venue_reset_v1'),
    updated_at=now()
where metadata->>'task_style'='venue_reset';

select atlas.ensure_venue_reset_checklist_v1(id)
from atlas.tasks
where metadata->>'task_style'='venue_reset';
