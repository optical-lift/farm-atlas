begin;

-- Retire the incorrect California Giant House South succession at its source.
update atlas.production_successions ps
set state='skipped',
    skip_reason='Owner correction 2026-08-12: House South West California Giant succession was not an approved plan; dwarf landscape zinnias were the real earlier decision.',
    metadata=coalesce(ps.metadata,'{}'::jsonb)||jsonb_build_object('retired_by','rhythmic_work_live_schedule_correction_v1','retired_at',now(),'owner_correction',true),
    updated_at=now()
where ps.id in (
  select pwo.source_id
  from atlas.planned_work_occurrences pwo
  join atlas.tasks t on t.planned_occurrence_id=pwo.id
  where t.metadata->>'task_key'='zinnia_2026_s5_house_south_sow' and pwo.source_kind='production_succession'
);

update atlas.work_definitions wd
set active=false,
    metadata=coalesce(wd.metadata,'{}'::jsonb)||jsonb_build_object('retired_by','rhythmic_work_live_schedule_correction_v1','retired_at',now(),'retired_reason','Owner correction: succession was not an approved planting plan.'),
    updated_at=now()
where wd.id in (
  select pwo.work_definition_id from atlas.planned_work_occurrences pwo join atlas.tasks t on t.planned_occurrence_id=pwo.id where t.metadata->>'task_key'='zinnia_2026_s5_house_south_sow'
);

update atlas.planned_work_occurrences pwo
set state='cancelled',
    metadata=coalesce(pwo.metadata,'{}'::jsonb)||jsonb_build_object('cancelledBy','rhythmic_work_live_schedule_correction_v1','cancelledAt',now(),'cancelledReason','Owner correction: California Giant House South West sowing was not approved.'),
    updated_at=now()
where pwo.id in (select t.planned_occurrence_id from atlas.tasks t where t.metadata->>'task_key'='zinnia_2026_s5_house_south_sow');

update atlas.tasks t
set status='archived', due_date=null, blocker_text=null,
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object('archived_by','rhythmic_work_live_schedule_correction_v1','archived_at',now(),'owner_correction','Not an approved sowing plan; preserve completed dwarf-zinnia history instead.'),
    updated_at=now()
where t.metadata->>'task_key'='zinnia_2026_s5_house_south_sow' and t.status in ('open','blocked');

-- Keep the same active pressure-wash queue item, but move its execution to Monday Aug 17.
update atlas.tasks t
set due_date=date '2026-08-17', work_lane='process_continuation', commitment_kind='persistent',
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object('execution_date','2026-08-17','rescheduled_by','rhythmic_work_live_schedule_correction_v1','rescheduled_at',now(),'rescheduled_reason','Owner moved pressure washing out of Wed-Sat and into Monday.'),
    updated_at=now()
where t.metadata->>'task_key'='anna_20260811_gentle_pressure_wash_detached_garage_face' and t.status in ('open','blocked');

update atlas.planned_work_occurrences pwo
set planned_due_date=date '2026-08-17', not_before_date=date '2026-08-17',
    metadata=coalesce(pwo.metadata,'{}'::jsonb)||jsonb_build_object('executionDateOverride','2026-08-17','rescheduledBy','rhythmic_work_live_schedule_correction_v1','rescheduledAt',now()), updated_at=now()
where pwo.id in (select t.planned_occurrence_id from atlas.tasks t where t.metadata->>'task_key'='anna_20260811_gentle_pressure_wash_detached_garage_face');

-- Friday owns the current pot-up backlog.
update atlas.tasks t
set due_date=date '2026-08-14',
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object('execution_date','2026-08-14','rescheduled_by','rhythmic_work_live_schedule_correction_v1','rescheduled_at',now(),'rescheduled_reason','Owner moved current pot-up backlog to Friday.'), updated_at=now()
where t.metadata->>'task_key' in ('anna_20260810_pot_up_200_cell_sweet_william_tray_1','anna_20260811_pot_up_200_cell_shasta_daisy_tray_1','anna_20260811_pot_up_200_cell_tetra_feverfew_oregano_tray_1') and t.status in ('open','blocked');

update atlas.planned_work_occurrences pwo
set planned_due_date=date '2026-08-14', not_before_date=date '2026-08-14',
    metadata=coalesce(pwo.metadata,'{}'::jsonb)||jsonb_build_object('executionDateOverride','2026-08-14','rescheduledBy','rhythmic_work_live_schedule_correction_v1','rescheduledAt',now()), updated_at=now()
where pwo.id in (select t.planned_occurrence_id from atlas.tasks t where t.metadata->>'task_key' in ('anna_20260810_pot_up_200_cell_sweet_william_tray_1','anna_20260811_pot_up_200_cell_shasta_daisy_tray_1','anna_20260811_pot_up_200_cell_tetra_feverfew_oregano_tray_1'));

-- Home Depot: Friday is the planned opportunity, but order readiness is the execution gate.
update atlas.tasks t
set due_date=date '2026-08-14', status='blocked', blocker_text='Home Depot order is not ready for pickup yet.',
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object('execution_date','2026-08-14','external_readiness_required',true,'external_readiness_state','waiting','external_readiness_label','Home Depot order ready for pickup','rescheduled_by','rhythmic_work_live_schedule_correction_v1','rescheduled_at',now()), updated_at=now()
where t.metadata->>'task_key'='anna_20260807_home_depot_curbside_pickup' and t.status in ('open','blocked');

update atlas.planned_work_occurrences pwo
set planned_due_date=date '2026-08-14', not_before_date=date '2026-08-14',
    metadata=coalesce(pwo.metadata,'{}'::jsonb)||jsonb_build_object('executionDateOverride','2026-08-14','externalReadinessState','waiting','rescheduledBy','rhythmic_work_live_schedule_correction_v1','rescheduledAt',now()), updated_at=now()
where pwo.id in (select t.planned_occurrence_id from atlas.tasks t where t.metadata->>'task_key'='anna_20260807_home_depot_curbside_pickup');

-- Replace the rejected basement-restroom-route plan with the actual sign task.
update atlas.tasks t
set title='Post bathroom under-construction sign', task_type='event_setup', action_key='post', note=null, blocker_text=null,
    metadata=(coalesce(t.metadata,'{}'::jsonb)-'execution_details'-'display_detail')||jsonb_build_object('execution_do','Post the bathroom under-construction sign.','execution_how',jsonb_build_array('Write “Under construction, ready soon!” on a piece of paper.','Tape it to the bathroom door.'),'execution_done_when','The bathroom door is clearly marked unavailable to guests.','display_action','Post','display_subject','Bathroom under-construction sign','display_location','Bathroom door','operation_family','host','operation_move','mark_unavailable','normalized_by','rhythmic_work_live_schedule_correction_v1','normalized_at',now()), updated_at=now()
where t.title='Make basement restroom route guest-ready' and t.due_date=date '2026-08-13' and t.status in ('open','blocked');

update atlas.planned_work_occurrences pwo
set title='Post bathroom under-construction sign',
    task_payload=jsonb_set(jsonb_set(jsonb_set(coalesce(pwo.task_payload,'{}'::jsonb),'{title}',to_jsonb('Post bathroom under-construction sign'::text),true),'{action_key}',to_jsonb('post'::text),true),'{metadata}',coalesce(pwo.task_payload->'metadata','{}'::jsonb)||jsonb_build_object('execution_do','Post the bathroom under-construction sign.','execution_how',jsonb_build_array('Write “Under construction, ready soon!” on a piece of paper.','Tape it to the bathroom door.'),'execution_done_when','The bathroom door is clearly marked unavailable to guests.','display_action','Post','display_subject','Bathroom under-construction sign','display_location','Bathroom door','operation_family','host','operation_move','mark_unavailable'),true),
    metadata=coalesce(pwo.metadata,'{}'::jsonb)||jsonb_build_object('normalizedBy','rhythmic_work_live_schedule_correction_v1','normalizedAt',now()), updated_at=now()
where pwo.released_task_id in (select id from atlas.tasks where title='Post bathroom under-construction sign' and due_date=date '2026-08-13');

-- Current Corral mowing must land before the Thursday event, never the evening default.
update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object('work_window_key','afternoon','work_order_anchor','afternoon','must_finish_before_local','2026-08-13T17:45:00-05:00','temporal_constraint_kind','must_finish_before','temporal_constraint_anchor','Bloom Bar Open House — Aug. 13','temporal_constraint_source','rhythmic_work_live_schedule_correction_v1'), updated_at=now()
where t.metadata->>'task_key'='anna_20260713_mow_corral_weekly' and t.due_date=date '2026-08-13' and t.status in ('open','blocked');

update atlas.planned_work_occurrences pwo
set task_payload=jsonb_set(coalesce(pwo.task_payload,'{}'::jsonb),'{metadata}',coalesce(pwo.task_payload->'metadata','{}'::jsonb)||jsonb_build_object('work_window_key','afternoon','work_order_anchor','afternoon','must_finish_before_local','2026-08-13T17:45:00-05:00','temporal_constraint_kind','must_finish_before','temporal_constraint_anchor','Bloom Bar Open House — Aug. 13'),true),
    metadata=coalesce(pwo.metadata,'{}'::jsonb)||jsonb_build_object('temporalConstraintNormalizedBy','rhythmic_work_live_schedule_correction_v1'), updated_at=now()
where pwo.released_task_id in (select id from atlas.tasks where metadata->>'task_key'='anna_20260713_mow_corral_weekly' and due_date=date '2026-08-13');

-- Rebind this week's Elm harvest event-specific copy to the canonical weekly Thursday harvest occurrence.
with oneoff as (
  select t.id as task_id from atlas.tasks t where t.title='Check + cut Elm bouquet extras' and t.due_date=date '2026-08-13' and t.status in ('open','blocked') order by t.created_at desc limit 1
), recurring as (
  select p.id as occurrence_id,p.release_policy_id,p.occurrence_key from atlas.planned_work_occurrences p where p.occurrence_key='recurring:anna_harvest_thursday_weekly:2026-08-13' limit 1
)
update atlas.tasks t
set title='Harvest — Cut Back Anything Blooming', due_date=date '2026-08-12', planned_occurrence_id=recurring.occurrence_id, release_policy_id=recurring.release_policy_id, work_lane='rhythm', commitment_kind='hard_date', task_series_key='anna_harvest_thursday_weekly', engine_instance_key=recurring.occurrence_key,
    metadata=(coalesce(t.metadata,'{}'::jsonb)-'release_reason')||jsonb_build_object('task_key','anna_harvest_thursday_weekly_20260813','repeat_rule','weekly','repeat_weekday','Thursday','weekly_routine',true,'schedule_source','fixed_calendar','completion_independent_schedule',true,'canonical_occurrence_date','2026-08-13','execution_date','2026-08-12','early_execution',true,'work_lane','rhythm','commitment_kind','hard_date','work_window_key','evening','work_order_anchor','evening','planned_occurrence_id',recurring.occurrence_id::text,'release_policy_id',recurring.release_policy_id::text,'display_action','Harvest','display_subject','Cut Back Anything Blooming','display_location','Elm Farm','execution_do','Harvest across Elm Farm for the weekly Thursday harvest.','execution_how',jsonb_build_array('Harvest copious lemon basil.','Check whether goldenrod has started and cut usable stems.','Add yarrow and lamb’s ear only if they are genuinely harvest-ready.','Harvest across the property; these are this week’s priorities, not a separate event-only harvest.'),'rebound_to_recurring_rhythm_by','rhythmic_work_live_schedule_correction_v1','rebound_at',now()), updated_at=now()
from oneoff,recurring where t.id=oneoff.task_id;

update atlas.planned_work_occurrences oldp
set state='cancelled', released_task_id=null,
    metadata=coalesce(oldp.metadata,'{}'::jsonb)||jsonb_build_object('cancelledBy','rhythmic_work_live_schedule_correction_v1','cancelledAt',now(),'cancelledReason','Event-specific Elm harvest copy replaced by the canonical weekly Thursday harvest rhythm.'), updated_at=now()
where oldp.occurrence_key like 'owner_project:%' and oldp.title='Check + cut Elm bouquet extras' and oldp.planned_due_date=date '2026-08-13';

update atlas.planned_work_occurrences recurring
set state='released', released_at=coalesce(recurring.released_at,now()), released_task_id=t.id,
    metadata=coalesce(recurring.metadata,'{}'::jsonb)||jsonb_build_object('releasedBy','rhythmic_work_live_schedule_correction_v1','releasedExecutionDate','2026-08-12','earlyExecution',true,'earlyExecutionReason','Anna chose to harvest Elm Wednesday evening before the Thursday event.'), updated_at=now()
from atlas.tasks t
where recurring.occurrence_key='recurring:anna_harvest_thursday_weekly:2026-08-13' and t.planned_occurrence_id=recurring.id and t.task_series_key='anna_harvest_thursday_weekly';

insert into atlas.worker_day_task_placements(id,organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,placement_source,placement_reason,state,owner_actor_user_id,created_at,updated_at)
select gen_random_uuid(),t.organization_id,t.farm_id,t.assigned_membership_id,t.id,date '2026-08-12','evening',76000,'owner','Weekly Thursday Elm harvest is executing early Wednesday evening this week.','placed',null,now(),now()
from atlas.tasks t
where t.task_series_key='anna_harvest_thursday_weekly' and t.metadata->>'canonical_occurrence_date'='2026-08-13'
on conflict (task_id) do update set service_date=excluded.service_date,day_window=excluded.day_window,sort_order=excluded.sort_order,placement_source=excluded.placement_source,placement_reason=excluded.placement_reason,state='placed',updated_at=now();

-- First Fulfillment grammar specimen: finished bouquets are staged for guest pickup.
update atlas.tasks t
set title='Stage finished bouquets for pickup', task_type='retail_fulfillment', action_key='stage', note=null, operation_class='fulfill_hold',
    metadata=(coalesce(t.metadata,'{}'::jsonb)-'execution_details')||jsonb_build_object('execution_do','Stage finished bouquets for pickup.','execution_how',jsonb_build_array('Line up florist buckets along the staircase console.','Fill florist buckets with 3” water.','Put finished, name-marked bouquets into the holding buckets until guests leave.'),'execution_done_when','Finished bouquets are held by guest name and ready for pickup.','display_action','Stage','display_subject','Finished bouquets for pickup','display_location','Staircase console','operation_family','fulfill','operation_move','stage_pickup','normalized_by','rhythmic_work_live_schedule_correction_v1','normalized_at',now()), updated_at=now()
where t.title='Set finished-bouquet holding line — staircase console' and t.due_date=date '2026-08-13' and t.status in ('open','blocked');

update atlas.planned_work_occurrences pwo
set title='Stage finished bouquets for pickup',
    task_payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(coalesce(pwo.task_payload,'{}'::jsonb),'{title}',to_jsonb('Stage finished bouquets for pickup'::text),true),'{task_type}',to_jsonb('retail_fulfillment'::text),true),'{action_key}',to_jsonb('stage'::text),true),'{metadata}',coalesce(pwo.task_payload->'metadata','{}'::jsonb)||jsonb_build_object('execution_do','Stage finished bouquets for pickup.','execution_how',jsonb_build_array('Line up florist buckets along the staircase console.','Fill florist buckets with 3” water.','Put finished, name-marked bouquets into the holding buckets until guests leave.'),'execution_done_when','Finished bouquets are held by guest name and ready for pickup.','display_action','Stage','display_subject','Finished bouquets for pickup','display_location','Staircase console','operation_family','fulfill','operation_move','stage_pickup'),true),
    metadata=coalesce(pwo.metadata,'{}'::jsonb)||jsonb_build_object('normalizedBy','rhythmic_work_live_schedule_correction_v1','normalizedAt',now()), updated_at=now()
where pwo.released_task_id in (select id from atlas.tasks where title='Stage finished bouquets for pickup' and due_date=date '2026-08-13');

commit;
