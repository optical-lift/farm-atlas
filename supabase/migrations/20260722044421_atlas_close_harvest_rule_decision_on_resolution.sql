create or replace function atlas.close_harvest_rule_decision_on_resolution_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_task_id uuid;v_result jsonb;
begin
  select t.id into v_task_id
  from atlas.production_lot_tasks plt join atlas.tasks t on t.id=plt.task_id
  where plt.production_lot_id=new.production_lot_id and plt.link_role='harvest_rules_decision' and t.status in ('open','blocked')
  order by t.created_at desc limit 1;
  if v_task_id is not null then
    v_result:=atlas.record_task_transition_v1_internal(v_task_id,'done',left('production-harvest-rules-resolved:'||new.id::text||':'||coalesce(new.idempotency_key,'manual'),160),null,
      'Pinch requirement and harvest-watch window recorded.',null,'decide','production_lot',
      jsonb_build_object('production_lot_id',new.production_lot_id,'harvest_rule_id',new.id,'pinch_required',new.pinch_required,'harvest_watch_start',new.harvest_watch_start,'harvest_watch_end',new.harvest_watch_end),null);
  end if;
  return new;
end; $$;
create trigger trg_close_harvest_rule_decision_on_resolution after insert or update of pinch_required,harvest_watch_start,harvest_watch_end on atlas.production_harvest_rules for each row execute function atlas.close_harvest_rule_decision_on_resolution_v1();