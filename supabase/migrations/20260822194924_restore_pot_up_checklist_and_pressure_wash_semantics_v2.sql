insert into atlas.task_execution_checklist_items (
  farm_id,task_id,item_key,section_key,section_label,item_label,sort_order,required,checked,metadata
) values
(
  '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid,
  '8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid,
  'tray_1','trays','Trays','Tray 1 · 200',1,true,false,
  jsonb_build_object('tray_number',1,'quantity_unit','plants','source_task_id','8463ad96-d86e-4c48-a6d0-968bb06e522e','target_quantity',200,'source_planned_occurrence_id','f0769bf3-a450-4558-9e96-2aab0e3a90a0')
),
(
  '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid,
  '8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid,
  'tray_2','trays','Trays','Tray 2 · 200',2,true,false,
  jsonb_build_object('tray_number',2,'quantity_unit','plants','source_task_id','d192164a-3920-40af-bcfc-32d384d62e0c','target_quantity',200,'source_planned_occurrence_id','d62387ab-ae3d-4cba-b9d6-959deb02ce6b')
),
(
  '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid,
  '8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid,
  'tray_3','trays','Trays','Tray 3 · 200',3,true,false,
  jsonb_build_object('tray_number',3,'quantity_unit','plants','source_task_id','81293539-93ca-417e-92ab-e086825b7fe0','target_quantity',200,'source_planned_occurrence_id','3440d2f0-88ed-4d3b-b798-a49acc78889b')
)
on conflict (task_id,item_key) do update
set section_key=excluded.section_key,
    section_label=excluded.section_label,
    item_label=excluded.item_label,
    sort_order=excluded.sort_order,
    required=true,
    metadata=excluded.metadata,
    updated_at=now();

create or replace function atlas.ensure_venue_reset_checklist_v1(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_line text;
  v_index integer := 0;
  v_item_key text;
  v_instruction_only boolean := false;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null or coalesce(v_task.metadata->>'task_style','') <> 'venue_reset' then
    return;
  end if;

  v_instruction_only := coalesce(v_task.action_key,'')='pressure_wash'
    and coalesce(v_task.operation_class,'')='clean_restore'
    and coalesce((v_task.metadata->>'simple_completion_task')::boolean,false);

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
      v_task.farm_id,p_task_id,v_item_key,
      case when v_instruction_only then 'method' else 'reset_work' end,
      case when v_instruction_only then 'How' else 'Reset work' end,
      btrim(v_line),v_index*10,not v_instruction_only,false,
      jsonb_build_object(
        'venue_reset_component',true,
        'interaction',case when v_instruction_only then 'information' else 'action' end,
        'source','task.metadata.execution_how',
        'retired','false',
        'method_information',v_instruction_only
      )
    )
    on conflict (task_id,item_key) do update
    set section_key=excluded.section_key,
        section_label=excluded.section_label,
        item_label=excluded.item_label,
        sort_order=excluded.sort_order,
        required=excluded.required,
        checked=case when excluded.required then atlas.task_execution_checklist_items.checked else false end,
        metadata=coalesce(atlas.task_execution_checklist_items.metadata,'{}'::jsonb)||jsonb_build_object(
          'venue_reset_component',true,
          'interaction',case when v_instruction_only then 'information' else 'action' end,
          'source','task.metadata.execution_how',
          'retired','false',
          'method_information',v_instruction_only
        ),
        updated_at=now();
  end loop;
end;
$function$;

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'quick_complete_allowed',true,
      'venue_reset_method_lines_are_information',true,
      'venue_reset_method_semantics_source','ensure_venue_reset_checklist_v1'
    ),
    updated_at=now()
where id='5819edd5-a537-42ba-84aa-151b4eb1a8d8'::uuid;
