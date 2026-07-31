alter table atlas.workflow_events drop constraint if exists workflow_events_source_kind_check;
alter table atlas.workflow_events add constraint workflow_events_source_kind_check
check (source_kind in ('task','object','maintenance','crop_cycle','production_succession','field_log','rhythm_state','project'));
