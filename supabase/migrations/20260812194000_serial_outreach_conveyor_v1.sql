begin;

update atlas.tasks t
set title=case t.metadata->>'task_key'
      when 'anna_florist_wholesale_batch_1_20260810' then 'Call · Florist buyers — batch 1'
      when 'anna_20260810_find_free_woodchips_weed_suppression' then 'Call · Free wood-chip sources'
      when 'anna_restaurant_bud_vase_outreach_batch_1' then 'Call · Restaurants — weekly bud vases'
      when 'network_20260725_call_10_churches' then 'Call · Church groups — Thursdays at Elm'
      when 'anna_florist_wholesale_batch_2_20260817' then 'Call · Florist buyers — batch 2'
      when 'anna_florist_wholesale_batch_3_20260824' then 'Call · Florist buyers — batch 3'
      when 'anna_florist_wholesale_batch_4_20260831' then 'Call · Florist buyers — batch 4'
      when 'anna_florist_wholesale_batch_5_20260907' then 'Call · Florist buyers — batch 5'
      else t.title end,
    task_type='network_outreach', action_key='call',
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object('checklist_mode','network_outreach','operation_family','outreach','operation_move','call','display_action','Call','work_route','network','outreach_queue_key','anna_outreach_conveyor','outreach_conveyor_version','serial_outreach_conveyor_v1'),
    updated_at=now()
where t.metadata->>'task_key' in ('anna_florist_wholesale_batch_1_20260810','anna_20260810_find_free_woodchips_weed_suppression','anna_restaurant_bud_vase_outreach_batch_1','network_20260725_call_10_churches','anna_florist_wholesale_batch_2_20260817','anna_florist_wholesale_batch_3_20260824','anna_florist_wholesale_batch_4_20260831','anna_florist_wholesale_batch_5_20260907');

update atlas.tasks set metadata=metadata||jsonb_build_object('next_batch_task_key','anna_20260810_find_free_woodchips_weed_suppression') where metadata->>'task_key'='anna_florist_wholesale_batch_1_20260810';
update atlas.tasks set metadata=metadata||jsonb_build_object('next_batch_task_key','anna_restaurant_bud_vase_outreach_batch_1') where metadata->>'task_key'='anna_20260810_find_free_woodchips_weed_suppression';
update atlas.tasks set metadata=metadata||jsonb_build_object('next_batch_task_key','network_20260725_call_10_churches') where metadata->>'task_key'='anna_restaurant_bud_vase_outreach_batch_1';
update atlas.tasks set metadata=metadata||jsonb_build_object('next_batch_task_key','anna_florist_wholesale_batch_2_20260817') where metadata->>'task_key'='network_20260725_call_10_churches';
update atlas.tasks set metadata=metadata||jsonb_build_object('next_batch_task_key','anna_florist_wholesale_batch_3_20260824') where metadata->>'task_key'='anna_florist_wholesale_batch_2_20260817';
update atlas.tasks set metadata=metadata||jsonb_build_object('next_batch_task_key','anna_florist_wholesale_batch_4_20260831') where metadata->>'task_key'='anna_florist_wholesale_batch_3_20260824';
update atlas.tasks set metadata=metadata||jsonb_build_object('next_batch_task_key','anna_florist_wholesale_batch_5_20260907') where metadata->>'task_key'='anna_florist_wholesale_batch_4_20260831';
update atlas.tasks set metadata=metadata-'next_batch_task_key' where metadata->>'task_key'='anna_florist_wholesale_batch_5_20260907';

update atlas.tasks t
set status='blocked', due_date=null, blocker_text='Waiting for the previous outreach batch to be completed.', metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object('outreach_release_state','queued','queued_at',now()), updated_at=now()
where t.metadata->>'task_key' in ('anna_20260810_find_free_woodchips_weed_suppression','anna_restaurant_bud_vase_outreach_batch_1','network_20260725_call_10_churches','anna_florist_wholesale_batch_2_20260817','anna_florist_wholesale_batch_3_20260824','anna_florist_wholesale_batch_4_20260831','anna_florist_wholesale_batch_5_20260907') and t.status not in ('done','archived');

update atlas.tasks child
set status='blocked',due_date=null,blocker_text='Waiting for this outreach batch to be released.',metadata=coalesce(child.metadata,'{}'::jsonb)||jsonb_build_object('outreach_release_state','queued','outreach_conveyor_version','serial_outreach_conveyor_v1'),updated_at=now()
where child.parent_task_id in (select parent.id from atlas.tasks parent where parent.metadata->>'task_key' in ('anna_restaurant_bud_vase_outreach_batch_1','network_20260725_call_10_churches','anna_florist_wholesale_batch_2_20260817','anna_florist_wholesale_batch_3_20260824','anna_florist_wholesale_batch_4_20260831','anna_florist_wholesale_batch_5_20260907')) and child.status not in ('done','archived');

update atlas.tasks t set status='open',due_date=date '2026-08-14',blocker_text=null,metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object('outreach_release_state','released','execution_date','2026-08-14'),updated_at=now() where t.metadata->>'task_key'='anna_florist_wholesale_batch_1_20260810' and t.status not in ('done','archived');
update atlas.tasks child set status='open',due_date=date '2026-08-14',blocker_text=null,metadata=coalesce(child.metadata,'{}'::jsonb)||jsonb_build_object('outreach_release_state','released','execution_date','2026-08-14'),updated_at=now() where child.parent_task_id=(select id from atlas.tasks where metadata->>'task_key'='anna_florist_wholesale_batch_1_20260810' order by created_at desc limit 1) and child.status not in ('done','archived');

update atlas.tasks child
set title=case when parent.metadata->>'task_key'='anna_restaurant_bud_vase_outreach_batch_1' then regexp_replace(child.title,'^Checklist\s*[—-]\s*','Call ')||' — weekly bud vases' when parent.metadata->>'task_key'='network_20260725_call_10_churches' then regexp_replace(child.title,'^Checklist\s*[—-]\s*','Call ')||' — Thursdays at Elm' else child.title end,
    task_type='network_outreach_contact',action_key='call',metadata=coalesce(child.metadata,'{}'::jsonb)||jsonb_build_object('operation_family','outreach','operation_move','call','display_action','Call'),updated_at=now()
from atlas.tasks parent
where child.parent_task_id=parent.id and parent.metadata->>'task_key' in ('anna_restaurant_bud_vase_outreach_batch_1','network_20260725_call_10_churches');

create or replace function atlas.release_network_outreach_batch_v1(p_task_id uuid,p_next_task_key text,p_effective_membership_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','atlas' as $function$
declare
  v_task atlas.tasks%rowtype; v_next atlas.tasks%rowtype; v_role text; v_incomplete integer; v_released_children integer:=0; v_now timestamptz:=now(); v_idempotency_key text; v_timezone text:='America/Chicago'; v_source_date date; v_release_date date;
begin
  if nullif(btrim(coalesce(p_next_task_key,'')),'') is null then raise exception using errcode='22023',message='Next outreach batch is required.'; end if;
  select * into v_task from atlas.tasks where id=p_task_id for update;
  if not found then raise exception using errcode='P0002',message='Outreach batch not found.'; end if;
  select role into v_role from atlas.farm_memberships where id=p_effective_membership_id and farm_id=v_task.farm_id and active=true;
  if v_role is null then raise exception using errcode='42501',message='No active farm membership is available.'; end if;
  if p_effective_membership_id is distinct from v_task.assigned_membership_id and v_role not in ('owner','manager') then raise exception using errcode='42501',message='This outreach batch belongs to another worker.'; end if;
  if coalesce(v_task.metadata->>'checklist_mode','')<>'network_outreach' and coalesce(v_task.metadata->>'operation_family','')<>'outreach' then raise exception using errcode='22023',message='This is not an outreach batch.'; end if;
  if v_task.status<>'done' then raise exception using errcode='22023',message='Finish this outreach batch before releasing the next one.'; end if;
  select count(*) into v_incomplete from atlas.tasks child where child.parent_task_id=v_task.id and child.status not in ('done','archived');
  if v_incomplete>0 then raise exception using errcode='22023',message='Record a result for every outreach contact first.'; end if;
  select * into v_next from atlas.tasks t where t.farm_id=v_task.farm_id and t.metadata->>'task_key'=p_next_task_key order by t.created_at desc limit 1 for update;
  if not found then raise exception using errcode='P0002',message='Next outreach batch not found.'; end if;
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone from atlas.farms f where f.id=v_task.farm_id;
  v_source_date:=coalesce((v_task.completed_at at time zone v_timezone)::date,(v_now at time zone v_timezone)::date);
  v_release_date:=atlas.next_worker_day_v1(v_task.farm_id,v_next.assigned_membership_id,v_source_date);
  update atlas.tasks set status='open',due_date=v_release_date,blocker_text=null,released_at=coalesce(released_at,v_now),release_reason='previous_outreach_batch_complete',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('prerequisite_gate_state','released','prerequisite_released_at',v_now,'prerequisite_source_task_id',v_task.id,'outreach_release_state','released','execution_date',v_release_date,'released_for_next_worker_day',true),updated_at=v_now where id=v_next.id;
  update atlas.tasks set status='open',due_date=v_release_date,blocker_text=null,released_at=coalesce(released_at,v_now),release_reason=coalesce(release_reason,'parent_outreach_batch_released'),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('outreach_release_state','released','execution_date',v_release_date),updated_at=v_now where parent_task_id=v_next.id and status='blocked';
  get diagnostics v_released_children=row_count;
  update atlas.planned_work_occurrences pwo set planned_due_date=v_release_date,not_before_date=v_release_date,metadata=coalesce(pwo.metadata,'{}'::jsonb)||jsonb_build_object('outreachExecutionDate',v_release_date,'outreachReleasedFromTaskId',v_task.id),updated_at=v_now where pwo.id=v_next.planned_occurrence_id;
  v_idempotency_key:=v_next.id::text||':network-outreach-release:'||v_task.id::text;
  insert into atlas.task_transitions(farm_id,task_id,transition,previous_status,next_status,action_key,work_class,reason,idempotency_key,payload,created_by,actor_membership_id,actor_role,created_at) values(v_task.farm_id,v_next.id,'released',v_next.status,'open','call',coalesce(v_next.work_class,'standard'),'Previous outreach batch completed',v_idempotency_key,jsonb_build_object('source_task_id',v_task.id,'release_source','outreach_conveyor','released_children',v_released_children,'release_date',v_release_date),'outreach_conveyor',p_effective_membership_id,v_role,v_now) on conflict (farm_id,idempotency_key) do nothing;
  return jsonb_build_object('ok',true,'sourceTaskId',v_task.id,'nextTaskId',v_next.id,'releasedChildren',v_released_children,'releaseDate',v_release_date,'alreadyOpen',v_next.status='open');
end;
$function$;

commit;
