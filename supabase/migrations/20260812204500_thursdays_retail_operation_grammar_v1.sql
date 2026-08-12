begin;

insert into atlas.work_definitions(
  id,farm_id,stable_key,title_template,task_type,source_kind,action_key,work_class,default_priority,default_visibility_scope,active,metadata,created_at,updated_at
)
values
  (gen_random_uuid(),'6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f','thursdays_retail_display_bouquet_flowers','Display bouquet flowers for guests','retail_fulfillment','community_program','display','standard','high','assigned_worker',true,jsonb_build_object('program','Thursdays at Elm','operation_family','fulfill','operation_move','merchandise_display','recurring_motion',true,'schedule_owner','event_instance'),now(),now()),
  (gen_random_uuid(),'6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f','thursdays_retail_stock_wrapping_station','Stock bouquet wrapping station','retail_fulfillment','community_program','stock','standard','high','assigned_worker',true,jsonb_build_object('program','Thursdays at Elm','operation_family','fulfill','operation_move','stock_finish_station','recurring_motion',true,'schedule_owner','event_instance'),now(),now()),
  (gen_random_uuid(),'6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f','thursdays_retail_stock_bouquet_tools','Stock bouquet tool station','retail_fulfillment','community_program','stock','standard','high','assigned_worker',true,jsonb_build_object('program','Thursdays at Elm','operation_family','fulfill','operation_move','stock_build_station','recurring_motion',true,'schedule_owner','event_instance'),now(),now()),
  (gen_random_uuid(),'6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f','thursdays_retail_stage_finished_pickup','Stage finished bouquets for pickup','retail_fulfillment','community_program','stage','standard','high','assigned_worker',true,jsonb_build_object('program','Thursdays at Elm','operation_family','fulfill','operation_move','stage_pickup','recurring_motion',true,'schedule_owner','event_instance'),now(),now()),
  (gen_random_uuid(),'6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f','thursdays_host_stock_cold_brew_station','Stock cold-brew drink station','hospitality_service','community_program','stock','standard','high','assigned_worker',true,jsonb_build_object('program','Thursdays at Elm','operation_family','host','operation_move','stock_beverage_station','recurring_motion',true,'schedule_owner','event_instance'),now(),now())
on conflict (farm_id,stable_key) do update
set title_template=excluded.title_template,task_type=excluded.task_type,source_kind=excluded.source_kind,action_key=excluded.action_key,work_class=excluded.work_class,default_priority=excluded.default_priority,default_visibility_scope=excluded.default_visibility_scope,active=true,metadata=coalesce(atlas.work_definitions.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now();

update atlas.tasks
set title='Display bouquet flowers for guests',task_type='retail_fulfillment',action_key='display',note=null,operation_class='fulfill_display',
    metadata=(coalesce(metadata,'{}'::jsonb)-'execution_details')||jsonb_build_object(
      'execution_do','Display the bouquet flowers for guests.',
      'execution_how',jsonb_build_array('Put the conditioned florist buckets on the round table by the windows.','Include the sister-garden flowers plus Elm lemon basil and any ready goldenrod, yarrow, or lamb’s ear.','Keep the table flower-first and uncluttered.'),
      'execution_done_when','Conditioned flower buckets are displayed and ready for guests to choose from.',
      'display_action','Display','display_subject','Bouquet flowers for guests','display_location','Round table by the windows','operation_family','fulfill','operation_move','merchandise_display','work_definition_key','thursdays_retail_display_bouquet_flowers','recurring_motion',true,'normalized_by','thursdays_retail_operation_grammar_v1','normalized_at',now()),updated_at=now()
where id='1ca6c7e6-93bf-4b13-9c3d-48f1e440a643';

update atlas.tasks
set title='Stock bouquet wrapping station',task_type='retail_fulfillment',action_key='stock',note=null,operation_class='fulfill_stock',
    metadata=(coalesce(metadata,'{}'::jsonb)-'execution_details')||jsonb_build_object(
      'execution_do','Stock the bouquet wrapping station.',
      'execution_how',jsonb_build_array('Put pre-cut brown paper, Elm stamp + ink, green rubber bands, flower-food packets, and the tape dispenser on the round table by the clock.','Add a Sharpie for writing each guest’s name on the wrap.'),
      'execution_done_when','Wrapping supplies are stocked and ready to finish and name guest bouquets.',
      'display_action','Stock','display_subject','Bouquet wrapping station','display_location','Round table by the clock','operation_family','fulfill','operation_move','stock_finish_station','work_definition_key','thursdays_retail_stock_wrapping_station','recurring_motion',true,'normalized_by','thursdays_retail_operation_grammar_v1','normalized_at',now()),updated_at=now()
where id='b1213eab-ff51-4e7f-9955-28a707edc144';

update atlas.tasks
set title='Stock bouquet tool station',task_type='retail_fulfillment',action_key='stock',note=null,operation_class='fulfill_stock',
    metadata=(coalesce(metadata,'{}'::jsonb)-'execution_details')||jsonb_build_object(
      'execution_do','Stock the bouquet tool station.',
      'execution_how',jsonb_build_array('Put the 5 new snips plus any existing usable snips on the final round table.','Add one black florist stripping bucket for leaves and trim waste.'),
      'execution_done_when','Snips and the stripping bucket are stocked and ready for bouquet building.',
      'display_action','Stock','display_subject','Bouquet tool station','display_location','Final round table','operation_family','fulfill','operation_move','stock_build_station','work_definition_key','thursdays_retail_stock_bouquet_tools','recurring_motion',true,'normalized_by','thursdays_retail_operation_grammar_v1','normalized_at',now()),updated_at=now()
where id='c294d4c6-2723-447f-917f-d610a29ccd0a';

update atlas.tasks
set title='Stock cold-brew drink station',task_type='hospitality_service',action_key='stock',note=null,operation_class='host_stock',
    metadata=(coalesce(metadata,'{}'::jsonb)-'execution_details')||jsonb_build_object(
      'execution_do','Stock the cold-brew drink station.',
      'execution_how',jsonb_build_array('Put out the cold brew carafe, milk carafe, brown sugar syrup, strawberry syrup, cups, ice/water, and the items already used for Elm’s coffee service.'),
      'execution_done_when','The cold-brew station is stocked and ready to serve guests.',
      'display_action','Stock','display_subject','Cold-brew drink station','display_location','Elm event drink station','operation_family','host','operation_move','stock_beverage_station','work_definition_key','thursdays_host_stock_cold_brew_station','recurring_motion',true,'normalized_by','thursdays_retail_operation_grammar_v1','normalized_at',now()),updated_at=now()
where id='16d66dbd-aa61-4111-b1c6-33cbf1dd252d';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('work_definition_key','thursdays_retail_stage_finished_pickup','recurring_motion',true,'operation_family','fulfill','operation_move','stage_pickup'),updated_at=now()
where id='8246fdf4-3a47-457c-a547-1468695a7eb9';

update atlas.planned_work_occurrences p
set title=t.title,work_definition_id=wd.id,
    task_payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(coalesce(p.task_payload,'{}'::jsonb),'{title}',to_jsonb(t.title),true),'{task_type}',to_jsonb(t.task_type),true),'{action_key}',to_jsonb(t.action_key),true),'{metadata}',coalesce(p.task_payload->'metadata','{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
      'execution_do',t.metadata->>'execution_do','execution_how',t.metadata->'execution_how','execution_done_when',t.metadata->>'execution_done_when','display_action',t.metadata->>'display_action','display_subject',t.metadata->>'display_subject','display_location',t.metadata->>'display_location','operation_family',t.metadata->>'operation_family','operation_move',t.metadata->>'operation_move','work_definition_key',t.metadata->>'work_definition_key','recurring_motion',true
    )),true),
    metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('normalizedBy','thursdays_retail_operation_grammar_v1','normalizedAt',now()),updated_at=now()
from atlas.tasks t
join atlas.work_definitions wd on wd.farm_id=t.farm_id and wd.stable_key=t.metadata->>'work_definition_key'
where p.id=t.planned_occurrence_id
  and t.id in ('1ca6c7e6-93bf-4b13-9c3d-48f1e440a643','b1213eab-ff51-4e7f-9955-28a707edc144','c294d4c6-2723-447f-917f-d610a29ccd0a','16d66dbd-aa61-4111-b1c6-33cbf1dd252d','8246fdf4-3a47-457c-a547-1468695a7eb9');

commit;
