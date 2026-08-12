insert into atlas.worker_day_cues(
  id,organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,scheduled_at,
  title,body,payload,result_contract,status,recovery_policy,available_from,expires_at,created_by_user_id,created_at,updated_at
)
select gen_random_uuid(),t.organization_id,t.farm_id,t.assigned_membership_id,date '2026-08-12','briefing','first_open',null,null,
       'SOW TODAY — ProCut Horizon · BW7 + BW8',
       'This sowing owns today. Open it before moving on.',
       jsonb_build_object(
         'stableKey','hard_stop_sowing:3b0f91e6-d421-433e-b345-4d1a3ae1068a:2026-08-12',
         'actionLabel','Open sowing',
         'taskId',t.id,
         'hardStop',true,
         'commitmentKind','hard_date'
       ),
       '{}'::jsonb,'available','expire',now(),timestamptz '2026-08-13 05:00:00+00',null,now(),now()
from atlas.tasks t
where t.id='3b0f91e6-d421-433e-b345-4d1a3ae1068a'
  and not exists (
    select 1 from atlas.worker_day_cues c
    where c.payload->>'stableKey'='hard_stop_sowing:3b0f91e6-d421-433e-b345-4d1a3ae1068a:2026-08-12'
  );
