-- Atlas project hierarchy + shared Move context.
-- Projects describe why work matters; tasks remain the one canonical executable object.

alter table atlas.projects
  add column if not exists parent_project_id uuid,
  add column if not exists portfolio_type text not null default 'campaign';

do $$
begin
  alter table atlas.projects
    add constraint projects_parent_project_id_fkey
    foreign key (parent_project_id) references atlas.projects(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table atlas.projects
    add constraint projects_portfolio_type_check
    check (portfolio_type = any (array['program','campaign','side_quest','event','incubator']::text[]));
exception when duplicate_object then null;
end $$;

create index if not exists projects_parent_project_id_idx on atlas.projects(parent_project_id);
create index if not exists projects_portfolio_type_idx on atlas.projects(portfolio_type, status);

alter table atlas.project_task_links
  add column if not exists parent_task_id uuid;

do $$
begin
  alter table atlas.project_task_links
    add constraint project_task_links_parent_task_id_fkey
    foreign key (parent_task_id) references atlas.tasks(id) on delete set null;
exception when duplicate_object then null;
end $$;

create index if not exists project_task_links_parent_task_id_idx on atlas.project_task_links(parent_task_id);

update atlas.project_task_links ptl
set parent_task_id = t.parent_task_id
from atlas.tasks t
where t.id = ptl.task_id
  and ptl.parent_task_id is null
  and t.parent_task_id is not null;

create table if not exists atlas.project_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  source_project_id uuid not null references atlas.projects(id) on delete cascade,
  target_project_id uuid not null references atlas.projects(id) on delete cascade,
  relationship_type text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_relationships_distinct_projects check (source_project_id <> target_project_id),
  constraint project_relationships_type_check check (relationship_type = any (array['supports','depends_on','related_to','uses']::text[])),
  constraint project_relationships_unique unique (source_project_id, target_project_id, relationship_type)
);

create index if not exists project_relationships_source_idx on atlas.project_relationships(source_project_id) where active;
create index if not exists project_relationships_target_idx on atlas.project_relationships(target_project_id) where active;

drop trigger if exists project_relationships_set_updated_at_v1 on atlas.project_relationships;
create trigger project_relationships_set_updated_at_v1
before update on atlas.project_relationships
for each row execute function atlas.set_updated_at();

-- Build Elm's useful project structure from stable keys, never generated ids.
with anchor as (
  select organization_id, farm_id
  from atlas.projects
  where stable_key = 'elm_finish_renovation_pool'
  limit 1
), desired(stable_key,title,workstream,portfolio_type,goal_text,outcome_text,current_milestone,sort_order) as (
  values
    ('elm_thursdays_at_elm_program','Thursdays at Elm','hospitality','program','Make Thursdays a recognizable, repeatable reason for people to come to Elm.','Elm has a repeatable Thursday rhythm that can hold community mornings and paid seasonal evenings without rebuilding the system every week.','Establish the repeatable Thursday system while the first paid event proves it in real life.',200),
    ('elm_thursdays_operating_system','Establish the Thursdays at Elm System','hospitality','campaign','Build the reusable hospitality, sourcing, setup, and outreach system behind Thursdays at Elm.','Future Thursdays can be launched from an established operating pattern instead of invented from scratch.','Capture the reusable pieces being created for the first ticketed Thursday.',210),
    ('elm_make_visible','Make Elm Visible','marketing','campaign','Make Elm consistently visible enough that people can understand, remember, and choose to come to the farm.','Elm has an owner-manageable public voice and a sustainable content rhythm that supports events, bookings, and farm identity.','Release only the next useful visibility Move instead of accumulating a social-media debt pile.',300),
    ('elm_thursdays_public_launch','Launch Thursdays at Elm Publicly','marketing','side_quest','Give Thursdays at Elm a clear public identity and invitation system.','People can recognize what Thursdays at Elm is, see the current invitation, and know how to participate.','Finish the reusable program-level invitation pieces while marketing the Aug. 13 event.',310),
    ('elm_make_productive','Make Elm Productive','farm_operations','campaign','Make the farm reliably produce the flowers and supporting inputs that Elm’s public-facing work depends on.','Elm’s production systems support events and sales without treating every routine farm operation as a project.','Protect productive beds and clarify the growing system where current losses are limiting output.',400),
    ('elm_finish_event_spaces','Finish the Event Spaces','hospitality','side_quest','Make Elm’s indoor guest spaces read as intentionally finished and usable for events.','The event-facing interior can host people without unfinished-room friction.','Finish the bounded room-level side quests rather than carrying one undifferentiated renovation list.',110),
    ('elm_finish_lounge_ready','Get the Lounge Ready for Events','hospitality','side_quest','Finish the lounge as a usable, intentional part of the event experience.','The lounge is physically finished and guest-ready as part of Elm’s venue.','Resume the lounge finish sequence when an on-site work window exists.',111),
    ('elm_finish_conference_room_ready','Get the Conference Room Ready for Events','hospitality','side_quest','Finish the conference room as a flexible event room.','The conference room is lit, finished, and ready to stage real gatherings.','Use the Aug. 13 event to finish only the conference-room pieces that create lasting venue value.',112),
    ('elm_finish_guest_restroom_route','Finish the Guest Restroom + Route','hospitality','side_quest','Make the available guest restroom and the route to it clear, clean, and intentional.','Guests can reach and use the restroom without the route reading as unfinished or confusing.','Make the current basement route genuinely guest-ready while the long-term venue continues to evolve.',113),
    ('elm_finish_arrival_exterior','Finish Arrival + Exterior','hospitality','side_quest','Make arrival, porches, lighting, parking, and visible exterior areas feel intentional.','A guest’s first and last view of Elm reads as cared-for and event-ready.','Collect exterior finish work here and let real events create useful urgency without duplicating tasks.',120),
    ('elm_finish_gardens_visible_grounds','Finish Gardens + Visible Grounds','hospitality','side_quest','Finish the gardens, paths, and visible grounds that are part of Elm’s guest experience.','Guest-facing grounds read as intentional even while Elm remains a working farm.','Move one bounded guest-facing garden area at a time.',130)
)
insert into atlas.projects (
  organization_id,farm_id,stable_key,title,status,goal_text,sort_order,metadata,workstream,project_kind,outcome_text,current_milestone,health_status,target_date,portfolio_type
)
select a.organization_id,a.farm_id,d.stable_key,d.title,'active',d.goal_text,d.sort_order,
       jsonb_build_object('created_from','real_project_hierarchy_20260809','hierarchy_version','elm_real_projects_v1'),
       d.workstream,'farm',d.outcome_text,d.current_milestone,
       case when d.stable_key='elm_finish_lounge_ready' then 'quiet' else 'moving' end,
       null,d.portfolio_type
from anchor a cross join desired d
on conflict (organization_id,stable_key) do update set
  title=excluded.title,
  goal_text=excluded.goal_text,
  outcome_text=excluded.outcome_text,
  current_milestone=excluded.current_milestone,
  sort_order=excluded.sort_order,
  workstream=excluded.workstream,
  portfolio_type=excluded.portfolio_type,
  metadata=atlas.projects.metadata || excluded.metadata,
  updated_at=now();

update atlas.projects set portfolio_type='campaign', parent_project_id=null, updated_at=now()
where stable_key='elm_finish_renovation_pool';

update atlas.projects set portfolio_type='event', updated_at=now()
where stable_key='elm_first_ticketed_thursday_bloom_bar_2026_08_13';

update atlas.projects set portfolio_type='side_quest', updated_at=now()
where stable_key='deer_protection_bed_boundaries';

update atlas.projects set portfolio_type='incubator', status='paused', health_status='quiet', updated_at=now()
where stable_key in ('waiting_room_ada_compliant_ward','elm_airbnb_launch','rehabilitation_house_funding_caregiver_pathways');

update atlas.projects child
set parent_project_id=parent.id, updated_at=now()
from atlas.projects parent
where (child.stable_key,parent.stable_key) in (
  ('elm_thursdays_operating_system','elm_thursdays_at_elm_program'),
  ('elm_first_ticketed_thursday_bloom_bar_2026_08_13','elm_thursdays_at_elm_program'),
  ('elm_thursdays_public_launch','elm_make_visible'),
  ('deer_protection_bed_boundaries','elm_make_productive'),
  ('elm_finish_event_spaces','elm_finish_renovation_pool'),
  ('elm_finish_lounge_ready','elm_finish_event_spaces'),
  ('elm_finish_conference_room_ready','elm_finish_event_spaces'),
  ('elm_finish_guest_restroom_route','elm_finish_event_spaces'),
  ('elm_finish_arrival_exterior','elm_finish_renovation_pool'),
  ('elm_finish_gardens_visible_grounds','elm_finish_renovation_pool')
)
and child.organization_id=parent.organization_id;

insert into atlas.project_relationships (organization_id,source_project_id,target_project_id,relationship_type,metadata)
select s.organization_id,s.id,t.id,r.relationship_type,jsonb_build_object('source','real_project_hierarchy_20260809')
from (values
  ('elm_make_visible','elm_thursdays_at_elm_program','supports'),
  ('elm_thursdays_public_launch','elm_first_ticketed_thursday_bloom_bar_2026_08_13','supports'),
  ('elm_thursdays_operating_system','elm_first_ticketed_thursday_bloom_bar_2026_08_13','supports'),
  ('elm_first_ticketed_thursday_bloom_bar_2026_08_13','elm_finish_renovation_pool','uses')
) r(source_key,target_key,relationship_type)
join atlas.projects s on s.stable_key=r.source_key
join atlas.projects t on t.stable_key=r.target_key and t.organization_id=s.organization_id
on conflict (source_project_id,target_project_id,relationship_type) do update set active=true,updated_at=now();

-- Child Finish Elm side quests inherit the current project visibility model.
insert into atlas.project_contributors (project_id,user_id,contribution_role,active,can_create_tasks,can_complete_tasks,can_submit_results,permissions)
select child.id,pc.user_id,pc.contribution_role,pc.active,pc.can_create_tasks,pc.can_complete_tasks,pc.can_submit_results,
       pc.permissions || jsonb_build_object('inherited_from_project','elm_finish_renovation_pool')
from atlas.projects parent
join atlas.project_contributors pc on pc.project_id=parent.id and pc.active=true
join atlas.projects child on child.parent_project_id=parent.id or child.parent_project_id in (select id from atlas.projects where parent_project_id=parent.id)
where parent.stable_key='elm_finish_renovation_pool'
on conflict (project_id,user_id) do update set active=true,updated_at=now();

-- The Thursday program remains visible to contributors who can see the concrete event.
insert into atlas.project_contributors (project_id,user_id,contribution_role,active,can_create_tasks,can_complete_tasks,can_submit_results,permissions)
select parent.id,pc.user_id,'reviewer',true,false,false,false,
       jsonb_build_object('inherited_from_event','elm_first_ticketed_thursday_bloom_bar_2026_08_13','view_scope','program_context')
from atlas.projects event
join atlas.project_contributors pc on pc.project_id=event.id and pc.active=true
join atlas.projects parent on parent.stable_key='elm_thursdays_at_elm_program' and parent.organization_id=event.organization_id
where event.stable_key='elm_first_ticketed_thursday_bloom_bar_2026_08_13'
on conflict (project_id,user_id) do update set active=true,updated_at=now();

-- Merge the nine duplicated Bloom Bar worker tasks. The farm-operation row is canonical
-- because it owns Day/release history; project membership belongs in project_task_links.
with mapping as (
  select pt.id duplicate_id, ft.id canonical_id, ptl.project_id, ptl.sort_order,
         coalesce(ptl.parent_task_id,pt.parent_task_id) project_parent_task_id
  from atlas.projects p
  join atlas.project_task_links ptl on ptl.project_id=p.id
  join atlas.tasks pt on pt.id=ptl.task_id and pt.task_scope='project'
  join atlas.tasks ft on ft.farm_id=pt.farm_id
    and ft.task_scope='farm_operation'
    and ft.assigned_user_id is not distinct from pt.assigned_user_id
    and ft.due_date is not distinct from pt.due_date
    and ft.title=pt.title
    and ft.status <> 'archived'
  where p.stable_key='elm_first_ticketed_thursday_bloom_bar_2026_08_13'
    and pt.title in (
      'Check + cut Elm bouquet extras',
      'Condition + sort Thursday flower buckets',
      'Hang conference-room café lights + porch solar lights',
      'Make basement restroom route guest-ready',
      'Set bloom bar — round table by windows',
      'Set cold-brew drink station',
      'Set finished-bouquet holding line — staircase console',
      'Set snips + stripping station — final round table',
      'Set wrapping station — round table by clock'
    )
)
insert into atlas.project_task_links (project_id,task_id,link_role,sort_order,source,metadata,parent_task_id)
select project_id,canonical_id,'belongs_to',sort_order,'duplicate_merge_20260809',
       jsonb_build_object('merged_project_task_id',duplicate_id),project_parent_task_id
from mapping
on conflict (project_id,task_id) do update set
  sort_order=least(atlas.project_task_links.sort_order,excluded.sort_order),
  parent_task_id=coalesce(atlas.project_task_links.parent_task_id,excluded.parent_task_id),
  metadata=atlas.project_task_links.metadata || excluded.metadata,
  updated_at=now();

with mapping as (
  select pt.id duplicate_id, ft.id canonical_id
  from atlas.projects p
  join atlas.project_task_links ptl on ptl.project_id=p.id
  join atlas.tasks pt on pt.id=ptl.task_id and pt.task_scope='project'
  join atlas.tasks ft on ft.farm_id=pt.farm_id and ft.task_scope='farm_operation'
    and ft.assigned_user_id is not distinct from pt.assigned_user_id
    and ft.due_date is not distinct from pt.due_date and ft.title=pt.title and ft.status <> 'archived'
  where p.stable_key='elm_first_ticketed_thursday_bloom_bar_2026_08_13'
    and pt.title in ('Check + cut Elm bouquet extras','Condition + sort Thursday flower buckets','Hang conference-room café lights + porch solar lights','Make basement restroom route guest-ready','Set bloom bar — round table by windows','Set cold-brew drink station','Set finished-bouquet holding line — staircase console','Set snips + stripping station — final round table','Set wrapping station — round table by clock')
), rewritten as (
  select tp.farm_id,
         coalesce(md.canonical_id,tp.downstream_task_id) downstream_task_id,
         coalesce(mp.canonical_id,tp.prerequisite_task_id) prerequisite_task_id,
         tp.required_status,tp.hold_mode,tp.sequence_order,tp.active,tp.metadata
  from atlas.task_prerequisites tp
  left join mapping md on md.duplicate_id=tp.downstream_task_id
  left join mapping mp on mp.duplicate_id=tp.prerequisite_task_id
  where md.duplicate_id is not null or mp.duplicate_id is not null
)
insert into atlas.task_prerequisites (farm_id,downstream_task_id,prerequisite_task_id,required_status,hold_mode,sequence_order,active,metadata)
select farm_id,downstream_task_id,prerequisite_task_id,required_status,hold_mode,sequence_order,active,
       metadata || jsonb_build_object('rewritten_from_duplicate',true,'rewritten_at','2026-08-09')
from rewritten
where downstream_task_id <> prerequisite_task_id
on conflict (downstream_task_id,prerequisite_task_id) do update set
  required_status=excluded.required_status,
  hold_mode=excluded.hold_mode,
  sequence_order=least(atlas.task_prerequisites.sequence_order,excluded.sequence_order),
  active=excluded.active,
  metadata=atlas.task_prerequisites.metadata || excluded.metadata,
  updated_at=now();

with mapping as (
  select pt.id duplicate_id
  from atlas.projects p
  join atlas.project_task_links ptl on ptl.project_id=p.id
  join atlas.tasks pt on pt.id=ptl.task_id and pt.task_scope='project'
  where p.stable_key='elm_first_ticketed_thursday_bloom_bar_2026_08_13'
    and pt.title in ('Check + cut Elm bouquet extras','Condition + sort Thursday flower buckets','Hang conference-room café lights + porch solar lights','Make basement restroom route guest-ready','Set bloom bar — round table by windows','Set cold-brew drink station','Set finished-bouquet holding line — staircase console','Set snips + stripping station — final round table','Set wrapping station — round table by clock')
)
delete from atlas.task_prerequisites tp
using mapping m
where tp.downstream_task_id=m.duplicate_id or tp.prerequisite_task_id=m.duplicate_id;

with mapping as (
  select pt.id duplicate_id,ft.id canonical_id
  from atlas.projects p
  join atlas.project_task_links ptl on ptl.project_id=p.id
  join atlas.tasks pt on pt.id=ptl.task_id and pt.task_scope='project'
  join atlas.tasks ft on ft.farm_id=pt.farm_id and ft.task_scope='farm_operation'
    and ft.assigned_user_id is not distinct from pt.assigned_user_id
    and ft.due_date is not distinct from pt.due_date and ft.title=pt.title and ft.status <> 'archived'
  where p.stable_key='elm_first_ticketed_thursday_bloom_bar_2026_08_13'
    and pt.title in ('Check + cut Elm bouquet extras','Condition + sort Thursday flower buckets','Hang conference-room café lights + porch solar lights','Make basement restroom route guest-ready','Set bloom bar — round table by windows','Set cold-brew drink station','Set finished-bouquet holding line — staircase console','Set snips + stripping station — final round table','Set wrapping station — round table by clock')
)
update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb) || jsonb_build_object('merged_into_task_id',m.canonical_id,'duplicate_retired_reason','canonical_shared_move_20260809'),
    status='archived',updated_at=now()
from mapping m
where t.id=m.duplicate_id;

delete from atlas.project_task_links ptl
using atlas.tasks t
where ptl.task_id=t.id
  and t.status='archived'
  and t.metadata->>'duplicate_retired_reason'='canonical_shared_move_20260809';

-- The old Owner placeholder attempted to contain the whole event as one task.
update atlas.tasks
set status='archived',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('absorbed_into_project','elm_first_ticketed_thursday_bloom_bar_2026_08_13','absorbed_at','2026-08-09'),
    updated_at=now()
where metadata->>'task_key'='owner_20260810_make_bloom_bar_real'
  and status <> 'archived';

-- Remove accidental Finish Elm links that are admin/farm operations, not venue finishing work.
delete from atlas.project_task_links ptl
using atlas.projects p, atlas.tasks t
where ptl.project_id=p.id and ptl.task_id=t.id
  and p.stable_key='elm_finish_renovation_pool'
  and (t.metadata->>'task_key'='owner_20260804_reimburse_melody' or t.title='Marshall — Call Kendal About Haying');

-- Current shared Move mappings.
insert into atlas.project_task_links (project_id,task_id,link_role,sort_order,source,metadata)
select p.id,t.id,'advances',100,'real_project_mapping_20260809',jsonb_build_object('mapping','shared_move_v1')
from atlas.projects p
join atlas.tasks t on t.farm_id=p.farm_id
where p.stable_key='elm_finish_gardens_visible_grounds'
  and t.metadata->>'task_key'='owner_20260804_assign_main_garden_work_to_anna'
on conflict (project_id,task_id) do nothing;

insert into atlas.project_task_links (project_id,task_id,link_role,sort_order,source,metadata)
select p.id,t.id,'advances',100,'real_project_mapping_20260809',jsonb_build_object('mapping','shared_move_v1')
from atlas.projects p
join atlas.tasks t on t.farm_id=p.farm_id and t.status <> 'archived'
where (
  t.title='Hang conference-room café lights + porch solar lights' and p.stable_key in ('elm_finish_renovation_pool','elm_finish_event_spaces','elm_finish_conference_room_ready','elm_finish_arrival_exterior')
) or (
  t.title='Make basement restroom route guest-ready' and p.stable_key in ('elm_finish_renovation_pool','elm_finish_event_spaces','elm_finish_guest_restroom_route')
)
on conflict (project_id,task_id) do nothing;

insert into atlas.project_task_links (project_id,task_id,link_role,sort_order,source,metadata)
select p.id,t.id,'advances',100,'real_project_mapping_20260809',jsonb_build_object('mapping','shared_move_v1')
from atlas.projects p
join atlas.tasks t on t.farm_id=p.farm_id and t.status <> 'archived'
where p.stable_key='elm_thursdays_operating_system'
  and t.title in ('Set cold-brew drink station','Set finished-bouquet holding line — staircase console','Set snips + stripping station — final round table','Set wrapping station — round table by clock')
on conflict (project_id,task_id) do nothing;

insert into atlas.project_task_links (project_id,task_id,link_role,sort_order,source,metadata)
select p.id,t.id,'advances',100,'real_project_mapping_20260809',jsonb_build_object('mapping','shared_move_v1')
from atlas.projects p
join atlas.tasks t on t.farm_id=p.farm_id and t.status <> 'archived'
where p.stable_key in ('elm_thursdays_at_elm_program','elm_thursdays_operating_system')
  and (
    t.metadata->>'task_key' in ('owner_20260803_find_thursday_pastry_supplier','owner_20260810_source_paid_thursday_savories','network_20260725_call_10_churches','anna_20260812_church_outreach_batch_2')
    or t.title in ('Network — Invite 5 Local Church Groups to Elm','Network — Invite 5 More Local Church Groups to Elm')
  )
on conflict (project_id,task_id) do nothing;

insert into atlas.project_task_links (project_id,task_id,link_role,sort_order,source,metadata)
select p.id,t.id,'advances',100,'real_project_mapping_20260809',jsonb_build_object('mapping','shared_move_v1')
from atlas.projects p
join atlas.tasks t on t.farm_id=p.farm_id and t.status <> 'archived'
where p.stable_key='elm_make_visible'
  and (
    t.metadata->>'release_queue_key'='owner_social_content_queue'
    or t.metadata->>'release_queue_key'='owner_venue_marketing_queue'
    or t.title in ('Design garden-photo event graphic','Publish + boost Facebook event post','Share bloom-bar invitation to local Facebook groups','Tuesday Reel — prep the garden for Thursday','Wednesday Story — remaining seats','Thursday Reel — seven buckets become tonight’s bloom bar','Capture event proof for the next Thursday')
  )
on conflict (project_id,task_id) do nothing;

insert into atlas.project_task_links (project_id,task_id,link_role,sort_order,source,metadata)
select p.id,t.id,'advances',100,'real_project_mapping_20260809',jsonb_build_object('mapping','shared_move_v1')
from atlas.projects p
join atlas.tasks t on t.farm_id=p.farm_id and t.status <> 'archived'
where p.stable_key='elm_thursdays_public_launch'
  and (
    t.metadata->>'task_key'='owner_20260808_make_thursdays_at_elm_poster'
    or t.title in ('Design garden-photo event graphic','Publish + boost Facebook event post','Share bloom-bar invitation to local Facebook groups','Tuesday Reel — prep the garden for Thursday','Wednesday Story — remaining seats','Thursday Reel — seven buckets become tonight’s bloom bar','Capture event proof for the next Thursday')
  )
on conflict (project_id,task_id) do nothing;

insert into atlas.project_task_links (project_id,task_id,link_role,sort_order,source,metadata)
select p.id,t.id,'advances',100,'real_project_mapping_20260809',jsonb_build_object('mapping','shared_move_v1')
from atlas.projects p
join atlas.tasks t on t.farm_id=p.farm_id
where p.stable_key='elm_thursdays_at_elm_program'
  and t.metadata->>'task_key'='owner_20260808_make_thursdays_at_elm_poster'
on conflict (project_id,task_id) do nothing;

-- Preserve the real lounge/conference history inside the nested project tree.
insert into atlas.project_task_links (project_id,task_id,link_role,sort_order,source,metadata)
select p.id,t.id,'history',500,'real_project_mapping_20260809',jsonb_build_object('mapping','historical_side_quest_v1')
from atlas.projects p
join atlas.tasks t on t.farm_id=p.farm_id
where p.stable_key in ('elm_finish_renovation_pool','elm_finish_event_spaces','elm_finish_lounge_ready')
  and lower(coalesce(t.metadata->>'collection_label','') || ' ' || coalesce(t.metadata->>'collection_zone','') || ' ' || t.title) like '%lounge%'
on conflict (project_id,task_id) do nothing;

insert into atlas.project_task_links (project_id,task_id,link_role,sort_order,source,metadata)
select p.id,t.id,'history',500,'real_project_mapping_20260809',jsonb_build_object('mapping','historical_side_quest_v1')
from atlas.projects p
join atlas.tasks t on t.farm_id=p.farm_id
where p.stable_key in ('elm_finish_renovation_pool','elm_finish_event_spaces','elm_finish_conference_room_ready')
  and lower(coalesce(t.metadata->>'collection_label','') || ' ' || coalesce(t.metadata->>'collection_zone','') || ' ' || t.title) like '%conference%'
on conflict (project_id,task_id) do nothing;

create or replace function atlas.project_path_v1(p_project_id uuid)
returns jsonb
language sql
stable security definer
set search_path='pg_catalog','atlas'
as $$
  with recursive chain as (
    select p.id,p.parent_project_id,p.stable_key,p.title,p.portfolio_type,0 as depth
    from atlas.projects p where p.id=p_project_id
    union all
    select parent.id,parent.parent_project_id,parent.stable_key,parent.title,parent.portfolio_type,chain.depth+1
    from atlas.projects parent join chain on chain.parent_project_id=parent.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'projectId',id,'projectKey',stable_key,'title',title,'portfolioType',portfolio_type
  ) order by depth desc),'[]'::jsonb)
  from chain;
$$;

create or replace function atlas.portfolio_project_card_v1(p_project_id uuid)
returns jsonb
language sql
stable security definer
set search_path='pg_catalog','atlas'
as $$
  select jsonb_build_object(
    'projectId', p.id,
    'projectKey', p.stable_key,
    'title', p.title,
    'status', p.status,
    'projectKind', p.project_kind,
    'portfolioType', p.portfolio_type,
    'parentProjectId', p.parent_project_id,
    'parentProjectKey', parent.stable_key,
    'parentProjectTitle', parent.title,
    'projectPath', atlas.project_path_v1(p.id),
    'workstream', p.workstream,
    'outcome', coalesce(p.outcome_text, p.goal_text),
    'currentMilestone', p.current_milestone,
    'health', p.health_status,
    'targetDate', p.target_date,
    'lastMovementAt', p.last_movement_at,
    'farmId', f.id,
    'farmKey', f.stable_key,
    'farmName', f.name,
    'myRole', (select pc.contribution_role from atlas.project_contributors pc where pc.project_id=p.id and pc.user_id=auth.uid() and pc.active=true limit 1),
    'canCreateTasks', atlas.can_contribute_to_project(p.id),
    'openTaskCount', (select count(*) from atlas.project_task_links ptl join atlas.tasks t on t.id=ptl.task_id where ptl.project_id=p.id and t.status in ('open','blocked')),
    'blockedTaskCount', (select count(*) from atlas.project_task_links ptl join atlas.tasks t on t.id=ptl.task_id where ptl.project_id=p.id and t.status='blocked'),
    'openAttentionCount', (select count(*) from atlas.project_attention_items pai where pai.project_id=p.id and pai.status='open'),
    'targets', coalesce((select jsonb_agg(jsonb_build_object('targetRole',pt.target_role,'farmId',tf.id,'farmName',tf.name,'placeId',pl.id,'placeLabel',pl.label,'placeType',pl.place_type,'zoneId',z.id,'zoneLabel',z.label) order by pt.created_at) from atlas.project_targets pt left join atlas.farms tf on tf.id=pt.farm_id left join atlas.places pl on pl.id=pt.place_id left join atlas.zones z on z.id=pt.zone_id where pt.project_id=p.id),'[]'::jsonb),
    'trail', atlas.project_trail_context_v2(p.id)
  )
  from atlas.projects p
  left join atlas.projects parent on parent.id=p.parent_project_id
  left join atlas.farms f on f.id=p.farm_id
  where p.id=p_project_id;
$$;

-- Project detail uses project-specific task nesting so one canonical Day task can have
-- different structural meaning in multiple projects without becoming a hidden child task.
create or replace function atlas.project_detail_v1(p_project_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path='pg_catalog','atlas'
as $$
declare v_result jsonb;
begin
  if not atlas.can_read_project(p_project_id) then
    raise exception 'Project access is not active.' using errcode='42501';
  end if;
  select jsonb_build_object(
    'project',atlas.portfolio_project_card_v1(p.id),
    'permissions',jsonb_build_object('canCreateTasks',atlas.can_contribute_to_project(p.id),'isOrganizationOwner',atlas.is_organization_owner(p.organization_id)),
    'tasks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'taskId',t.id,'title',t.title,'status',t.status,'priority',t.priority,'dueDate',t.due_date,'note',t.note,'blockerText',t.blocker_text,
        'taskType',t.task_type,'taskScope',t.task_scope,'metadata',t.metadata,
        'assignedToViewer',t.assigned_user_id=auth.uid(),'createdByViewer',t.created_by_user_id=auth.uid(),
        'assigneeName',(select up.display_name from atlas.user_profiles up where up.user_id=t.assigned_user_id limit 1),
        'parentTaskId',coalesce(ptl.parent_task_id,t.parent_task_id),'sortOrder',ptl.sort_order,
        'prerequisites',coalesce((select jsonb_agg(jsonb_build_object('taskId',tp.prerequisite_task_id,'requiredStatus',tp.required_status,'holdMode',tp.hold_mode,'sequenceOrder',tp.sequence_order) order by tp.sequence_order,tp.prerequisite_task_id) from atlas.task_prerequisites tp where tp.downstream_task_id=t.id and tp.active=true),'[]'::jsonb),
        'originKind',t.origin_kind,'createdAt',t.created_at,'updatedAt',t.updated_at,'completedAt',t.completed_at
      ) order by case when t.status in ('open','blocked') then 0 else 1 end,t.due_date nulls last,ptl.sort_order,t.created_at)
      from atlas.project_task_links ptl join atlas.tasks t on t.id=ptl.task_id where ptl.project_id=p.id
    ),'[]'::jsonb),
    'steps',coalesce((select jsonb_agg(jsonb_build_object('stepId',ps.id,'title',ps.title,'status',ps.status,'stepOrder',ps.step_order,'linkedTaskId',ps.linked_task_id,'note',ps.note) order by ps.step_order,ps.created_at) from atlas.project_steps ps where ps.project_id=p.id),'[]'::jsonb),
    'attention',coalesce((select jsonb_agg(jsonb_build_object('attentionId',pai.id,'kind',pai.attention_type,'title',pai.title,'detail',pai.detail,'dueDate',pai.due_date,'status',pai.status) order by pai.due_date nulls last,pai.created_at) from atlas.project_attention_items pai where pai.project_id=p.id and pai.status='open'),'[]'::jsonb),
    'relationships',coalesce((
      select jsonb_agg(jsonb_build_object(
        'relationshipId',pr.id,'relationshipType',pr.relationship_type,
        'direction',case when pr.source_project_id=p.id then 'outbound' else 'inbound' end,
        'project',atlas.portfolio_project_card_v1(case when pr.source_project_id=p.id then pr.target_project_id else pr.source_project_id end)
      ) order by pr.relationship_type,pr.created_at)
      from atlas.project_relationships pr
      where pr.active=true and (pr.source_project_id=p.id or pr.target_project_id=p.id)
    ),'[]'::jsonb),
    'children',coalesce((select jsonb_agg(atlas.portfolio_project_card_v1(child.id) order by child.sort_order,child.title) from atlas.projects child where child.parent_project_id=p.id and child.status <> 'archived'),'[]'::jsonb)
  ) into v_result
  from atlas.projects p where p.id=p_project_id;
  return v_result;
end;
$$;

-- Batch Move context used by Day cards: WHY / UNLOCKS / ADVANCES / WAITING ON.
create or replace function atlas.task_move_context_batch_v1(p_task_ids uuid[])
returns jsonb
language plpgsql
stable security definer
set search_path='pg_catalog','atlas','auth'
as $$
declare v_user_id uuid:=auth.uid(); v_result jsonb;
begin
  if v_user_id is null then raise exception 'Sign in required.' using errcode='42501'; end if;

  select coalesce(jsonb_object_agg(t.id::text,jsonb_build_object(
    'projects',coalesce((
      select jsonb_agg(jsonb_build_object(
        'projectId',p.id,'projectKey',p.stable_key,'title',p.title,'portfolioType',p.portfolio_type,
        'targetDate',p.target_date,'linkRole',ptl.link_role,'path',atlas.project_path_v1(p.id)
      ) order by case p.portfolio_type when 'event' then 0 when 'side_quest' then 1 when 'campaign' then 2 when 'program' then 3 else 4 end,p.sort_order,p.title)
      from atlas.project_task_links ptl join atlas.projects p on p.id=ptl.project_id
      where ptl.task_id=t.id and p.status <> 'archived'
        and (t.assigned_user_id=v_user_id or atlas.can_read_project(p.id) or atlas.is_organization_owner(p.organization_id))
    ),'[]'::jsonb),
    'unlocks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'taskId',d.id,'title',d.title,'status',d.status,'assigneeName',coalesce(up.display_name,'Unassigned'),
        'requiredStatus',tp.required_status,'holdMode',tp.hold_mode
      ) order by tp.sequence_order,d.due_date nulls last,d.title)
      from atlas.task_prerequisites tp
      join atlas.tasks d on d.id=tp.downstream_task_id
      left join atlas.user_profiles up on up.user_id=d.assigned_user_id
      where tp.prerequisite_task_id=t.id and tp.active=true and tp.satisfied_at is null and d.status not in ('done','skipped','archived')
    ),'[]'::jsonb),
    'waitingOn',coalesce((
      select jsonb_agg(jsonb_build_object(
        'taskId',pre.id,'title',pre.title,'status',pre.status,'assigneeName',coalesce(up.display_name,'Unassigned'),
        'requiredStatus',tp.required_status,'holdMode',tp.hold_mode
      ) order by tp.sequence_order,pre.due_date nulls last,pre.title)
      from atlas.task_prerequisites tp
      join atlas.tasks pre on pre.id=tp.prerequisite_task_id
      left join atlas.user_profiles up on up.user_id=pre.assigned_user_id
      where tp.downstream_task_id=t.id and tp.active=true and tp.satisfied_at is null
    ),'[]'::jsonb)
  )),'{}'::jsonb)
  into v_result
  from atlas.tasks t
  where t.id=any(coalesce(p_task_ids,array[]::uuid[]))
    and (
      t.assigned_user_id=v_user_id
      or exists(select 1 from atlas.farm_memberships fm where fm.farm_id=t.farm_id and fm.user_id=v_user_id and fm.active=true)
      or exists(select 1 from atlas.project_task_links ptl where ptl.task_id=t.id and atlas.can_read_project(ptl.project_id))
    );
  return v_result;
end;
$$;

revoke all on function atlas.project_path_v1(uuid) from public;
revoke all on function atlas.task_move_context_batch_v1(uuid[]) from public;
grant execute on function atlas.project_path_v1(uuid) to authenticated;
grant execute on function atlas.task_move_context_batch_v1(uuid[]) to authenticated;
