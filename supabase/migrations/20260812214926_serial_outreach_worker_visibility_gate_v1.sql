begin;

create or replace function atlas.sync_outreach_worker_visibility_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if coalesce(new.metadata->>'outreach_queue_key','')='anna_outreach_conveyor' then
    if new.status='open'
       and new.due_date is not null
       and coalesce(new.metadata->>'outreach_release_state','')='released' then
      new.visibility_scope:='assigned_worker';
    elsif new.status='blocked'
       and new.due_date is null
       and coalesce(new.metadata->>'outreach_release_state','')='queued' then
      new.visibility_scope:='system_internal';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sync_outreach_worker_visibility_v1 on atlas.tasks;
create trigger trg_sync_outreach_worker_visibility_v1
before insert or update of status,due_date,metadata,visibility_scope on atlas.tasks
for each row execute function atlas.sync_outreach_worker_visibility_v1();

update atlas.tasks parent
set visibility_scope=case
      when parent.status='open' and parent.due_date is not null and coalesce(parent.metadata->>'outreach_release_state','')='released' then 'assigned_worker'
      else 'system_internal'
    end,
    metadata=coalesce(parent.metadata,'{}'::jsonb)||jsonb_build_object('outreach_queue_key','anna_outreach_conveyor'),
    updated_at=now()
where parent.metadata->>'task_key' in (
  'anna_florist_wholesale_batch_1_20260810',
  'anna_20260810_find_free_woodchips_weed_suppression',
  'anna_restaurant_bud_vase_outreach_batch_1',
  'network_20260725_call_10_churches',
  'anna_florist_wholesale_batch_2_20260817',
  'anna_florist_wholesale_batch_3_20260824',
  'anna_florist_wholesale_batch_4_20260831',
  'anna_florist_wholesale_batch_5_20260907'
);

update atlas.tasks child
set visibility_scope=case
      when parent.status='open' and parent.due_date is not null and coalesce(parent.metadata->>'outreach_release_state','')='released' then 'assigned_worker'
      else 'system_internal'
    end,
    metadata=coalesce(child.metadata,'{}'::jsonb)||jsonb_build_object(
      'outreach_queue_key','anna_outreach_conveyor',
      'outreach_release_state',coalesce(parent.metadata->>'outreach_release_state','queued')
    ),
    updated_at=now()
from atlas.tasks parent
where child.parent_task_id=parent.id
  and parent.metadata->>'task_key' in (
    'anna_florist_wholesale_batch_1_20260810',
    'anna_20260810_find_free_woodchips_weed_suppression',
    'anna_restaurant_bud_vase_outreach_batch_1',
    'network_20260725_call_10_churches',
    'anna_florist_wholesale_batch_2_20260817',
    'anna_florist_wholesale_batch_3_20260824',
    'anna_florist_wholesale_batch_4_20260831',
    'anna_florist_wholesale_batch_5_20260907'
  );

commit;
