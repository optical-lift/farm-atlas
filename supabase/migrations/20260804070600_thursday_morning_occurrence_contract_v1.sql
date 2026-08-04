-- Keep every future regular Thursday-morning Wednesday close on the same visible checklist contract.

begin;

create or replace function atlas.normalize_thursday_morning_prep_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_metadata jsonb;
begin
  if new.occurrence_key not like 'community_thursday_wednesday_setup:%' then
    return new;
  end if;

  v_metadata := (coalesce(new.task_payload -> 'metadata','{}'::jsonb) - 'detail_lines') || jsonb_build_object(
    'execution_checklist_template_key','community_thursday_morning_v1',
    'execution_checklist_title','Wednesday closing round',
    'execution_checklist_completion_label','Elm is ready for Thursday morning',
    'hide_details',true,
    'task_instruction','Prepare Elm for Thursday Morning',
    'display_action','Prepare',
    'display_subject','Elm for Thursday morning',
    'display_detail','Wednesday closing round',
    'collection_label','Thursday Morning Prep',
    'display_location','Bathroom · Coffee Bar · Library · Meeting Room',
    'checklist_visibility','fully_visible_on_task_card',
    'paid_event_scope',false
  );

  new.title := 'Prepare Elm for Thursday Morning';
  new.task_payload := coalesce(new.task_payload,'{}'::jsonb)
    || jsonb_build_object('title','Prepare Elm for Thursday Morning','priority','high','metadata',v_metadata);
  new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'executionChecklistTemplateKey','community_thursday_morning_v1',
    'normalizedBy','normalize_thursday_morning_prep_occurrence_v1'
  );
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists normalize_thursday_morning_prep_occurrence_v1 on atlas.planned_work_occurrences;
create trigger normalize_thursday_morning_prep_occurrence_v1
before insert or update of occurrence_key, task_payload, title
on atlas.planned_work_occurrences
for each row
execute function atlas.normalize_thursday_morning_prep_occurrence_v1();

commit;
