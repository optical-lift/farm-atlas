select atlas.ensure_crop_destination_resolution_v1(cc.id)
from atlas.crop_cycles cc
where cc.lifecycle_status='active'
  and cc.cycle_state='hardening_off'
  and not exists(select 1 from atlas.crop_destination_claims dc where dc.crop_cycle_id=cc.id and dc.status='active');

select atlas.ensure_task_destination_resolution_v1(t.id)
from atlas.tasks t
where t.status in ('open','blocked')
  and t.task_type in ('transplanting','production_transplant')
  and coalesce((atlas.task_execution_destination_readiness_v1(t.id)->>'ready')::boolean,false)=false;