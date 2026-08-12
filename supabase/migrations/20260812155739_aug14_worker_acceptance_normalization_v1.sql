-- Finish-line normalization for the Aug. 14 Anna acceptance set.
-- This promotes only existing canonical execution facts into the Farm Hand
-- packet, removes a future-availability claim from the florist script, and adds
-- externally verified contact facts without exposing buyer-history strategy.

do $block$
declare
  v_parent atlas.tasks%rowtype;
  v_task atlas.tasks%rowtype;
  v_count integer;
  v_items jsonb;
begin
  select t.* into v_parent
  from atlas.tasks t
  where t.title='Florist calls — batch 1'
    and t.due_date=date '2026-08-14'
    and t.status='open'
    and t.visibility_scope='assigned_worker'
  order by t.created_at desc
  limit 1;

  if v_parent.id is null
     or coalesce(v_parent.metadata->>'buyer_outreach_mode','')<>'sales'
     or coalesce(v_parent.metadata->>'collection_label','')<>'Florist Wholesale · Batch 1' then
    raise exception 'Aug. 14 florist batch identity drifted; refusing worker normalization.';
  end if;

  select count(*) into v_count
  from atlas.tasks t
  where t.parent_task_id=v_parent.id
    and t.status='open'
    and t.visibility_scope='assigned_worker'
    and coalesce(t.metadata->>'buyer_outreach_mode','')='sales';
  if v_count<>5 then
    raise exception 'Expected five open florist child calls, found %.',v_count;
  end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_action','Call',
        'display_subject','Five florist buyers',
        'display_location','Florist Wholesale',
        'execution_do','Call this week’s five florists.',
        'execution_place','Phone calls',
        'execution_how',jsonb_build_array(
          'Use the wholesale florist script below.',
          'Ask who handles flower buying and the best way and day to send Elm availability.',
          'Record a result for each florist in Atlas.'
        ),
        'execution_done_when','A result is recorded for all five florist calls.',
        'outreach_script','Hi, this is Anna with Elm Farm in Marshfield. We grow cut flowers in volume and are setting up our wholesale florist route. Who handles flower buying there? If that is you, I’d love to send you our availability as things come into harvest. What is the best way and day to send that to you?',
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','aug14_worker_acceptance_normalization_v1'
      ),
      updated_at=now()
  where t.id=v_parent.id;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_action','Call','display_subject','Linda''s Flowers','display_location','Florist Wholesale',
        'execution_do','Call Linda''s Flowers about Elm wholesale flowers.','execution_place','Phone call',
        'execution_how',jsonb_build_array('Ask for Josh.','Reconnect Elm as a local wholesale stem source.','Record who you reached, their best contact method and buying day, interest, and the exact next action.'),
        'checklist_label','Linda''s Flowers — ask for Josh',
        'business_phone','417-883-6861','business_address','1255 W Battlefield Rd, Springfield, MO 65807',
        'business_contact_verified_source','Linda''s Flowers official website · verified 2026-08-12',
        'worker_execution_normalized_at',now(),'worker_execution_normalized_source','aug14_worker_acceptance_normalization_v1'
      ),updated_at=now()
  where t.parent_task_id=v_parent.id and t.metadata->>'buyer_relationship_stable_key'='lindas_flowers';
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Linda''s Flowers child call missing or duplicated.'; end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_action','Call','display_subject','Schaffitzel''s','display_location','Florist Wholesale',
        'execution_do','Call Schaffitzel''s about Elm wholesale flowers.','execution_place','Phone call',
        'execution_how',jsonb_build_array('Identify the current flower buyer.','Ask when that buyer is available and the best way and day to send Elm availability.','Record the contact result and exact next action.'),
        'checklist_label','Schaffitzel''s — ask buyer schedule',
        'business_phone','417-866-6222','business_address','1771 E Atlantic, Springfield, MO 65803',
        'business_contact_verified_source','Schaffitzel''s official website · verified 2026-08-12',
        'worker_execution_normalized_at',now(),'worker_execution_normalized_source','aug14_worker_acceptance_normalization_v1'
      ),updated_at=now()
  where t.parent_task_id=v_parent.id and t.metadata->>'buyer_relationship_stable_key'='schaffitzels';
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Schaffitzel''s child call missing or duplicated.'; end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_action','Call','display_subject','Blossoms Floral','display_location','Florist Wholesale',
        'execution_do','Call Blossoms Floral about Elm wholesale flowers.','execution_place','Phone call',
        'execution_how',jsonb_build_array('Ask for Mike or the current flower buyer.','Introduce Elm as a local wholesale stem source.','Record the contact result and exact next action.'),
        'checklist_label','Blossoms Floral — ask for Mike/current buyer',
        'business_phone','417-865-8787','business_address','900 N Glenstone Ave, Ste C, Springfield, MO 65802',
        'business_contact_verified_source','current local business listing · verified 2026-08-12',
        'worker_execution_normalized_at',now(),'worker_execution_normalized_source','aug14_worker_acceptance_normalization_v1'
      ),updated_at=now()
  where t.parent_task_id=v_parent.id and t.metadata->>'buyer_relationship_stable_key'='blossoms_floral';
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Blossoms Floral child call missing or duplicated.'; end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_action','Call','display_subject','Casa Flowers','display_location','Florist Wholesale',
        'execution_do','Call Casa Flowers about Elm wholesale flowers.','execution_place','Phone call',
        'execution_how',jsonb_build_array('Identify the current flower buyer.','Introduce Elm from scratch as a local wholesale stem source.','Record the contact result and exact next action.'),
        'checklist_label','Casa Flowers — new buyer introduction',
        'worker_execution_normalized_at',now(),'worker_execution_normalized_source','aug14_worker_acceptance_normalization_v1'
      ),updated_at=now()
  where t.parent_task_id=v_parent.id and t.metadata->>'buyer_relationship_stable_key'='casa_flowers';
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Casa Flowers child call missing or duplicated.'; end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_action','Call','display_subject','Cassidy Station','display_location','Florist Wholesale',
        'execution_do','Call Cassidy Station about Elm wholesale flowers.','execution_place','Phone call',
        'execution_how',jsonb_build_array('Ask for the current flower buyer.','Ask which day of the week they make flower-buying decisions and the best way to send Elm availability.','Record the contact result and exact next action.'),
        'checklist_label','Cassidy Station — ask buying day + contact method',
        'business_phone','417-350-5835','business_address','5176 N Fremont Rd, Nixa, MO 65714',
        'business_contact_verified_source','Cassidy Station official website · verified 2026-08-12',
        'worker_execution_normalized_at',now(),'worker_execution_normalized_source','aug14_worker_acceptance_normalization_v1'
      ),updated_at=now()
  where t.parent_task_id=v_parent.id and t.metadata->>'buyer_relationship_stable_key'='cassidy_station';
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Cassidy Station child call missing or duplicated.'; end if;

  select t.* into v_task from atlas.tasks t
  where t.title='Echinacea — tray 1 — 130' and t.due_date=date '2026-08-14' and t.status='open' and t.visibility_scope='assigned_worker'
  order by t.created_at desc limit 1;
  if v_task.id is null or coalesce((v_task.metadata->>'target_quantity')::integer,-1)<>130 or coalesce(v_task.metadata->>'container_kind','')<>'200-cell plug tray' then
    raise exception 'Echinacea Aug. 14 pot-up truth drifted.';
  end if;
  update atlas.tasks t set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
    'execution_do','Pot up 130 Echinacea plants.','execution_place','200-cell Pot Up',
    'execution_how',jsonb_build_array('Pot up 130 Echinacea plants into one 200-cell plug tray.'),
    'execution_done_when','The 130 Echinacea plants are potted into the tray.',
    'worker_execution_normalized_at',now(),'worker_execution_normalized_source','aug14_worker_acceptance_normalization_v1'
  ),updated_at=now() where t.id=v_task.id;

  select t.* into v_task from atlas.tasks t
  where t.title='Pot up · Creeping thyme' and t.due_date=date '2026-08-14' and t.status='open' and t.visibility_scope='assigned_worker'
  order by t.created_at desc limit 1;
  if v_task.id is null or coalesce((v_task.metadata->>'batch_item_count')::integer,-1)<>3 or coalesce((v_task.metadata->>'batch_total_quantity')::integer,-1)<>480 then
    raise exception 'Creeping thyme batch truth drifted.';
  end if;
  select jsonb_agg(jsonb_build_object('item_key',i.item_key,'item_label',i.item_label,'target_quantity',i.metadata->>'target_quantity') order by i.sort_order) into v_items
  from atlas.task_execution_checklist_items i where i.task_id=v_task.id;
  if v_items<>jsonb_build_array(
    jsonb_build_object('item_key','tray_1','item_label','Tray 1 · 200','target_quantity','200'),
    jsonb_build_object('item_key','tray_2','item_label','Tray 2 · 200','target_quantity','200'),
    jsonb_build_object('item_key','tray_3','item_label','Tray 3 · 80','target_quantity','80')
  ) then raise exception 'Creeping thyme tray checklist drifted.'; end if;
  update atlas.tasks t set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
    'execution_do','Pot up 480 Creeping thyme plants in 3 trays.','execution_place','200-cell Pot Up',
    'execution_how',jsonb_build_array('Tray 1: 200 plants.','Tray 2: 200 plants.','Tray 3: 80 plants.'),
    'execution_done_when','All 3 trays / 480 Creeping thyme plants are potted up.',
    'worker_execution_normalized_at',now(),'worker_execution_normalized_source','aug14_worker_acceptance_normalization_v1'
  ),updated_at=now() where t.id=v_task.id;

  select t.* into v_task from atlas.tasks t
  where t.title='Relocate Pool Pathway Bricks and Stones to MG Diamond' and t.due_date=date '2026-08-14' and t.status='open' and t.visibility_scope='assigned_worker'
  order by t.created_at desc limit 1;
  if v_task.id is null or coalesce(v_task.metadata->>'source_location','')<>'Pathway beside pool' or coalesce(v_task.metadata->>'target_location','')<>'MG Center Diamond' then
    raise exception 'Pool-path relocation truth drifted.';
  end if;
  update atlas.tasks t set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
    'display_action','Relocate','display_subject','Pool pathway bricks + stones','display_location','Pathway beside pool → MG Center Diamond',
    'execution_do','Relocate the pool-pathway bricks and stones to MG Center Diamond.','execution_place','Pathway beside pool → MG Center Diamond',
    'execution_how',v_task.metadata->'detail_lines',
    'worker_execution_normalized_at',now(),'worker_execution_normalized_source','aug14_worker_acceptance_normalization_v1'
  ),updated_at=now() where t.id=v_task.id;

  select t.* into v_task from atlas.tasks t
  where t.title='Sutton’s Apricot foxglove — tray 1 — 190' and t.due_date=date '2026-08-14' and t.status='open' and t.visibility_scope='assigned_worker'
  order by t.created_at desc limit 1;
  if v_task.id is null or coalesce((v_task.metadata->>'target_quantity')::integer,-1)<>190 or coalesce(v_task.metadata->>'container_kind','')<>'200-cell plug tray' then
    raise exception 'Sutton''s Apricot foxglove Aug. 14 pot-up truth drifted.';
  end if;
  update atlas.tasks t set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
    'execution_do','Pot up 190 Sutton’s Apricot foxglove plants.','execution_place','200-cell Pot Up',
    'execution_how',jsonb_build_array('Pot up 190 Sutton’s Apricot foxglove plants into one 200-cell plug tray.'),
    'execution_done_when','The 190 Sutton’s Apricot foxglove plants are potted into the tray.',
    'worker_execution_normalized_at',now(),'worker_execution_normalized_source','aug14_worker_acceptance_normalization_v1'
  ),updated_at=now() where t.id=v_task.id;
end;
$block$;
