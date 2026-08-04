-- Checklist templates own the final private capacity profile for clustered Thursday preparation.
-- Run their seeder after the generic task-capacity refresh trigger on future task releases.

begin;

drop trigger if exists seed_task_execution_checklist_v1 on atlas.tasks;
drop trigger if exists zzz_seed_task_execution_checklist_v1 on atlas.tasks;

create trigger zzz_seed_task_execution_checklist_v1
after insert or update of metadata, task_series_key on atlas.tasks
for each row
when ((new.metadata ->> 'execution_checklist_template_key') is not null)
execute function atlas.seed_task_execution_checklist_trigger_v1();

commit;
