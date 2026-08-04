begin;

create or replace function atlas.bell_event_is_worthy_v1(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select coalesce((
    select case
      when event.event_kind = 'owner_decision' then true
      when event.event_kind = 'rhythm_warning' then false
      when event.event_kind in ('rhythm_due', 'rhythm_failure') then
        atlas.operational_rhythm_surface_v1(event.id) in ('owner_attention', 'exception')
      when event.importance = 'critical' then true
      when event.event_kind in ('unlock', 'production_change') then true
      when event.event_kind = 'task_result'
        and event.source_event in ('reopened', 'blocked') then true
      when event.importance = 'attention' then true
      else false
    end
    from atlas.journal_event_index event
    where event.id = p_event_id
  ), false);
$function$;

comment on function atlas.bell_event_is_worthy_v1(uuid) is
  'Bell worthiness contract: operational rhythm routing is evaluated before generic importance, so a critical clock remains quiet when Atlas already owns it in monitoring, queue, or Work.';

commit;
