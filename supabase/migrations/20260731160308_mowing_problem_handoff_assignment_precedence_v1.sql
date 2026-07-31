-- Let explicit Clock problem handoffs override the ordinary Anna maintenance assignment policy.

create or replace function atlas.assign_anna_maintenance_collection_task_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_anna_membership_id uuid;
  v_is_anna_maintenance boolean;
begin
  v_is_anna_maintenance :=
    new.status in ('open','blocked')
    and lower(coalesce(new.metadata->>'owner_task','false')) not in ('true','yes','1')
    and lower(coalesce(new.metadata->>'mowing_owner_handoff','false')) not in ('true','yes','1')
    and lower(coalesce(new.metadata->>'owner_problem_handoff_open','false')) not in ('true','yes','1')
    and (
      (new.metadata->>'work_collection_key'='weeding'
       and lower(coalesce(new.metadata->>'canonical_maintenance_delivery','false')) in ('true','yes','1'))
      or
      (new.metadata->>'work_collection_key'='mowing'
       and lower(coalesce(new.metadata->>'canonical_collection_task','false')) in ('true','yes','1'))
    );

  if not v_is_anna_maintenance then return new; end if;

  select fm.id into v_anna_membership_id
  from atlas.farm_memberships fm
  where fm.farm_id=new.farm_id
    and fm.worker_key='anna'
    and fm.role='farm_hand'
    and fm.active=true
  order by fm.created_at
  limit 1;

  if v_anna_membership_id is null then return new; end if;

  new.assigned_membership_id:=v_anna_membership_id;
  new.visibility_scope:='assigned_worker';
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'assigned_to','Anna',
    'anna_task',true,
    'owner_task',false,
    'maintenance_assignment_policy','anna_rotation',
    'maintenance_assignment_repaired_at',now()
  );

  return new;
end;
$$;
