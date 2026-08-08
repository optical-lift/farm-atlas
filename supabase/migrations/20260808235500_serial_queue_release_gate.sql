-- Serial queues own release truth for their enrolled occurrences.
create or replace function atlas.work_occurrence_gate_satisfied_v1(p_occurrence_id uuid,p_as_of_date date)
returns boolean language sql stable security definer set search_path=pg_catalog,atlas as $function$
  select case
    when occurrence.id is null then false
    when exists(select 1 from atlas.task_release_queue_items qi where qi.planned_occurrence_id=occurrence.id and qi.state='queued') then exists(
      select 1 from atlas.task_release_queue_items qi
      where qi.planned_occurrence_id=occurrence.id and qi.state='queued'
        and not exists(select 1 from atlas.task_release_queue_items active_item where active_item.farm_id=qi.farm_id and active_item.queue_key=qi.queue_key and active_item.state='active')
        and qi.position=(select min(head.position) from atlas.task_release_queue_items head where head.farm_id=qi.farm_id and head.queue_key=qi.queue_key and head.state='queued')
        and (occurrence.not_before_date is null or occurrence.not_before_date<=p_as_of_date)
    )
    when coalesce(occurrence.task_payload->>'action_key','')='weed'
      and exists(select 1 from atlas.farm_memberships anna where anna.id=nullif(occurrence.task_payload->>'assigned_membership_id','')::uuid and anna.farm_id=occurrence.farm_id and anna.worker_key='anna' and anna.active=true)
      and exists(select 1 from atlas.task_release_queue_items qi where qi.farm_id=occurrence.farm_id and qi.queue_key='anna_weeding_rotation' and qi.state in ('active','queued'))
      and not exists(select 1 from atlas.task_release_queue_items qi where qi.planned_occurrence_id=occurrence.id and qi.queue_key='anna_weeding_rotation' and qi.state='active')
    then false
    when occurrence.state='eligible' then true
    when policy.gate_type in ('immediate','time_window','serial_queue') then occurrence.not_before_date is null or occurrence.not_before_date<=p_as_of_date
    when policy.gate_type='predecessor' then occurrence.gate_satisfied_at is not null or (occurrence.parent_occurrence_id is not null and exists(select 1 from atlas.planned_work_occurrences parent where parent.id=occurrence.parent_occurrence_id and parent.state in ('released','completed')))
    else occurrence.gate_satisfied_at is not null
  end
  from atlas.planned_work_occurrences occurrence join atlas.work_release_policies policy on policy.id=occurrence.release_policy_id
  where occurrence.id=p_occurrence_id
$function$;

create unique index if not exists task_release_queue_items_one_serial_active_v1
on atlas.task_release_queue_items(farm_id,queue_key) where state='active' and initial_batch=false;