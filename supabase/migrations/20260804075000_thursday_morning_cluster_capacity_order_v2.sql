begin;

-- Capacity profiles are refreshed by a generic task trigger. Run the themed
-- checklist seeder after that refresh so the Owner's private cluster estimates
-- remain authoritative without appearing on Anna's task card.
drop trigger if exists seed_task_execution_checklist_v1 on atlas.tasks;
drop trigger if exists zzzz_seed_task_execution_checklist_v2 on atlas.tasks;
create trigger zzzz_seed_task_execution_checklist_v2
after insert or update of metadata, task_series_key on atlas.tasks
for each row
when ((new.metadata ->> 'execution_checklist_template_key') is not null)
execute function atlas.seed_task_execution_checklist_trigger_v1();

select atlas.seed_task_execution_checklist_v1(task.id)
from atlas.tasks task
where task.status in ('open','blocked')
  and task.metadata ->> 'execution_checklist_template_key' in (
    'community_thursday_morning_outdoor_v2',
    'community_thursday_morning_coffee_water_v2',
    'community_thursday_morning_rooms_v2',
    'community_thursday_morning_trash_v2'
  );

commit;
