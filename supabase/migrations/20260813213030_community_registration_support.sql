alter table atlas.community_events
  drop constraint if exists community_events_event_kind_check;

alter table atlas.community_events
  add constraint community_events_event_kind_check
  check (event_kind in (
    'free_community_morning',
    'ticketed_seasonal_evening',
    'special_fifth_thursday',
    'church_group_visit',
    'family_field_club_session'
  ));

create or replace function atlas.set_community_registration_updated_at_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, atlas
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists community_registration_offerings_updated_at on atlas.community_registration_offerings;
create trigger community_registration_offerings_updated_at
before update on atlas.community_registration_offerings
for each row execute function atlas.set_community_registration_updated_at_v1();

drop trigger if exists community_registrations_updated_at on atlas.community_registrations;
create trigger community_registrations_updated_at
before update on atlas.community_registrations
for each row execute function atlas.set_community_registration_updated_at_v1();

drop trigger if exists community_registration_participants_updated_at on atlas.community_registration_participants;
create trigger community_registration_participants_updated_at
before update on atlas.community_registration_participants
for each row execute function atlas.set_community_registration_updated_at_v1();

drop trigger if exists community_registration_payments_updated_at on atlas.community_registration_payments;
create trigger community_registration_payments_updated_at
before update on atlas.community_registration_payments
for each row execute function atlas.set_community_registration_updated_at_v1();
