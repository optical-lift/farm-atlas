create or replace view atlas.production_seed_to_seedling_lineage_v1 as
select
  pl.farm_id,pl.id production_lot_id,pl.stable_key production_lot_key,pl.lot_label,pl.current_stage,pl.lifecycle_status,
  pl.planned_input_quantity,pl.current_quantity,pl.current_unit,pl.actual_sow_date,
  coalesce(alloc.allocated_quantity,0) allocated_seeds,coalesce(cons.consumed_quantity,0) consumed_seeds,
  tb.id tray_batch_id,tb.batch_number,tb.tray_count,tb.seeds_sown,tb.status tray_batch_status,tb.viable_seedlings,
  tb.expected_germination_start,tb.expected_germination_end,tb.germinated_date,tb.crop_cycle_id,
  next_task.task_id next_task_id,next_task.title next_task_title,next_task.task_type next_task_type,next_task.due_date next_task_due_date
from atlas.production_lots pl
left join lateral (select sum(allocated_quantity) allocated_quantity from atlas.seed_lot_allocations where production_lot_id=pl.id and allocation_status not in ('released','cancelled')) alloc on true
left join lateral (select sum(quantity_consumed) consumed_quantity from atlas.seed_allocation_consumptions where production_lot_id=pl.id) cons on true
left join lateral (select * from atlas.production_tray_batches where production_lot_id=pl.id order by batch_number desc limit 1) tb on true
left join lateral (
  select t.id task_id,t.title,t.task_type,t.due_date
  from atlas.production_lot_tasks plt join atlas.tasks t on t.id=plt.task_id
  where plt.production_lot_id=pl.id and t.status in ('open','blocked')
  order by t.due_date nulls last,t.created_at limit 1
) next_task on true;

alter table atlas.production_tray_batches enable row level security;
alter table atlas.seed_allocation_consumptions enable row level security;
alter table atlas.production_stage_observations enable row level security;
revoke all on atlas.production_tray_batches,atlas.seed_allocation_consumptions,atlas.production_stage_observations from public,anon,authenticated;
revoke all on atlas.production_seed_to_seedling_lineage_v1 from public,anon,authenticated;
revoke execute on function atlas.record_production_sowing_v1(uuid,numeric,numeric,date,text,text) from public,anon,authenticated;
revoke execute on function atlas.record_production_germination_v1(uuid,text,numeric,date,text,text) from public,anon,authenticated;
revoke execute on function atlas.prevent_production_stage_record_mutation_v1() from public,anon,authenticated;
revoke execute on function atlas.validate_production_tray_batch_v1() from public,anon,authenticated;
revoke execute on function atlas.validate_seed_allocation_consumption_v1() from public,anon,authenticated;
revoke execute on function atlas.validate_production_stage_observation_v1() from public,anon,authenticated;
grant select,insert,update,delete on atlas.production_tray_batches,atlas.seed_allocation_consumptions,atlas.production_stage_observations to service_role;
grant select on atlas.production_seed_to_seedling_lineage_v1 to service_role;
grant execute on function atlas.record_production_sowing_v1(uuid,numeric,numeric,date,text,text) to service_role;
grant execute on function atlas.record_production_germination_v1(uuid,text,numeric,date,text,text) to service_role;