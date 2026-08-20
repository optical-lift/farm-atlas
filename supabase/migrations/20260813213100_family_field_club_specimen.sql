insert into atlas.projects (
  farm_id, organization_id, stable_key, title, status, goal_text,
  workstream, project_kind, outcome_text, current_milestone,
  health_status, target_date, last_movement_at, portfolio_type,
  reality_state, reality_state_reason, metadata
)
select
  f.id, f.organization_id, 'elm_family_field_club', 'Elm Family Field Club', 'active',
  'Create a repeatable family sports program at Elm that gives homeschool families a reason to gather at the farm on weekday evenings, with parents participating rather than sitting on the sidelines.',
  'hospitality', 'farm',
  'Elm has a repeatable family field-sports program that can run in bounded seasons without being reinvented each week. Families come to Elm to play together, build relationships, spend an evening outside, and experience the farm through sunset.',
  'Launch and fill the first six-week Elm Family Ultimate season for Fall 2026.',
  'moving', date '2026-09-08', now(), 'program', 'making_real',
  'The first season, audience, six-week structure, household price, and physical experience are defined; registration and host confirmation are the current execution edge.',
  jsonb_build_object(
    'created_from','owner_direction_20260813',
    'program_family','Elm Family Field Club',
    'first_season','Elm Family Ultimate — Fall 2026',
    'worker_owner_boundary','Anna is not the program host or owner.',
    'host_status','unresolved'
  )
from atlas.farms f
where f.stable_key='elm_farm'
on conflict (organization_id, stable_key) do update set
  title=excluded.title,status=excluded.status,goal_text=excluded.goal_text,
  outcome_text=excluded.outcome_text,current_milestone=excluded.current_milestone,
  health_status=excluded.health_status,target_date=excluded.target_date,
  last_movement_at=excluded.last_movement_at,portfolio_type=excluded.portfolio_type,
  reality_state=excluded.reality_state,reality_state_reason=excluded.reality_state_reason,
  metadata=atlas.projects.metadata || excluded.metadata,updated_at=now();

insert into atlas.community_programs(farm_id,stable_key,title,active,timezone_name,cadence,metadata)
select
  f.id,'elm_family_field_club','Elm Family Field Club',true,'America/Chicago',
  jsonb_build_object('kind','seasonal_series','first_season','fall_2026_ultimate','weekday','Tuesday','session_start_local','18:00','session_end_local','19:30'),
  jsonb_build_object(
    'audience','homeschool families',
    'participation_model','parents and children participate simultaneously on adjacent play areas',
    'public_age_range',null,'public_capacity',null,'sunset_is_part_of_experience',true,
    'first_sport','Ultimate Frisbee','season_fee_per_household',60,
    'host_status','unresolved','anna_program_owner',false,'source','owner_direction_20260813'
  )
from atlas.farms f where f.stable_key='elm_farm'
on conflict (farm_id,stable_key) do update set
  title=excluded.title,active=excluded.active,timezone_name=excluded.timezone_name,
  cadence=excluded.cadence,metadata=atlas.community_programs.metadata || excluded.metadata,updated_at=now();

insert into atlas.community_events(
  farm_id,program_id,stable_key,title,event_kind,event_date,start_local_time,end_local_time,
  timezone_name,status,visibility_scope,capacity,metadata
)
select
  p.farm_id,p.id,'elm_family_ultimate_2026_' || to_char(d.event_date,'MM_DD'),
  'Elm Family Ultimate','family_field_club_session',d.event_date,time '18:00',time '19:30',
  'America/Chicago','planned','farm_shared',null,
  jsonb_build_object(
    'season','fall_2026','sport','Ultimate Frisbee','household_program',true,
    'adult_and_child_parallel_play',true,'sunset_is_part_of_experience',true,
    'time_source','working_public_time_from_program_design_20260813'
  )
from atlas.community_programs p
cross join (values
  (date '2026-09-08'),(date '2026-09-15'),(date '2026-09-22'),
  (date '2026-09-29'),(date '2026-10-06'),(date '2026-10-13')
) as d(event_date)
where p.stable_key='elm_family_field_club'
on conflict (farm_id,stable_key) do update set
  title=excluded.title,event_kind=excluded.event_kind,event_date=excluded.event_date,
  start_local_time=excluded.start_local_time,end_local_time=excluded.end_local_time,
  timezone_name=excluded.timezone_name,status=excluded.status,visibility_scope=excluded.visibility_scope,
  capacity=null,metadata=atlas.community_events.metadata || excluded.metadata,updated_at=now();
