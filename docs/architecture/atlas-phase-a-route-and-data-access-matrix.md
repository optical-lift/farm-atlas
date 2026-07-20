# Atlas Phase A — Route and Data-Access Matrix

**Audit date:** July 20, 2026  
**Repository:** `optical-lift/farm-atlas`  
**Purpose:** classify the current application route surface before replacement work begins.

## 1. Classification rules

Every application path is assigned one replacement disposition:

- **KEEP SHELL** — retain the user-facing purpose, but replace its identity and data path.
- **REBUILD** — retain the domain workflow, replace both implementation and authorization.
- **MERGE** — fold duplicate endpoints into one canonical resource or command.
- **INTERNALIZE** — remove from ordinary browser/API access and call only from trusted server or trigger code.
- **RETIRE** — remove after callers are migrated.

Authorization states used below:

- **Session only** — the route is behind the current cookie-presence middleware but does not independently load identity or membership.
- **Identity + membership** — the route calls `getAtlasIdentity()` and resolves an active Elm membership.
- **None in route** — no route-level identity check is present.
- **Not applicable** — login/logout/session infrastructure.

The current middleware is not counted as complete authorization. It checks only whether an Atlas access or refresh cookie exists. A route that uses the global service-role client still bypasses RLS and must perform its own complete authorization.

## 2. Current shared authority paths

| Component | Current authority | Finding | Replacement |
|---|---|---|---|
| `middleware.ts` | Cookie presence | Does not validate session, load profile, load farm membership, or establish farm context | Replace with normalized session middleware/proxy that forwards a verified identity context |
| `lib/atlas-auth.ts` | Custom token cookies + service-role Auth client | Homegrown transport and service-role profile/membership reads | Replace with standard server session client and user-scoped membership query |
| `lib/atlas/supabase-server.ts` | Global service-role client | Ordinary route reads and writes bypass RLS | Split into user-scoped client, narrowly named admin client, and internal job client |
| Root page | Server role redirect | Elm-specific role routing | Replace with farm-context resolver and one role-aware application shell |
| `AtlasRoleHomeRedirect` | Browser role redirect | Duplicates server routing authority | Retire |
| Global patch stack | DOM and route corrections | Presentation layer changes behavior after render | Remove during shell replacement; salvage only isolated styles/components |

## 3. API route matrix

### 3.1 Identity

| Route | Methods | Current authorization | Data/system touched | Risk | Disposition |
|---|---|---|---|---|---|
| `/api/atlas/auth/login` | POST | Credential check; no existing session required | Supabase Auth, `user_profiles`, `farm_memberships`, custom cookies | Contains account-specific temporary password mapping in public source | REBUILD first; remove compatibility branch and rotate credential |
| `/api/atlas/auth/logout` | POST | Cookie clear only | Atlas cookies | Low, but belongs to custom session stack | REBUILD with standard sign-out |
| `/api/atlas/auth/session` | GET | `getAtlasIdentity()` | Auth user, profile, memberships | Browser-facing duplicate interpretation of session | MERGE into one server session/farm-context resource |

### 3.2 Broad reads and dashboards

| Route | Methods | Current authorization | Data/system touched | Risk | Disposition |
|---|---|---|---|---|---|
| `/api/atlas/dashboard` | GET | None in route | `v_dashboard_zones` through service role | Returns whole-farm aggregate for hardcoded Elm Farm | REBUILD as membership-scoped farm summary |
| `/api/atlas/farm-snapshot` | GET | None in route | `farms`, `growing_objects`, `object_contents`, `object_activity_events`, `field_logs` | Broad service-role farm read; event table currently lacks RLS | MERGE into canonical farm summary read model |
| `/api/atlas/closeout` | GET, POST | None in route | `farms`, `field_logs`, `object_activity_events`, `task_outcome_events`, `tasks`; POST inserts `field_logs` | Reads and writes whole-farm history with service role | REBUILD as authorized closeout command + scoped summary query |
| `/api/atlas/crop-profiles` | GET | None in route | `crop_profiles` | Registry is global today; access policy is undefined | KEEP SHELL, classify registry as authenticated shared reference or farm-scoped reference |
| `/api/atlas/projects` | GET | Session only unless route has local check not yet normalized | Project views/tables | Project visibility must follow farm membership | REBUILD through farm read model |
| `/api/atlas/production-dashboard` | GET | Session only unless route has local check not yet normalized | Production plans/successions/cycles/forecast views | Whole-farm production and revenue context | REBUILD owner/manager read model |
| `/api/atlas/zone-registry` | GET | Session only unless route has local check not yet normalized | `zones`, `growing_objects`, state/content summaries | Farm registry must never be selected only by client key | KEEP SHELL with membership-scoped registry query |
| `/api/atlas/weather` | GET | Session only | External weather source/cache | Not a farm authorization source, but should be bounded and cached | KEEP as contextual service after identity pipeline |

### 3.3 Task read paths

| Route | Methods | Current authorization | Current scope rule | Risk | Disposition |
|---|---|---|---|---|---|
| `/api/atlas/home-task-cards` | GET | None in route | Hardcoded Anna filter from task metadata | A signed-in Owner can receive the Anna-only feed; endpoint independently defines privacy | RETIRE after canonical task query exists |
| `/api/atlas/task-cards` | GET | Identity + active Elm membership | Owner/manager receive all rows; farm hand filtered by `worker_key` and metadata | Best current route-level check, but still service-role read and metadata-based assignment | REBUILD as canonical task query; preserve response contract temporarily |
| `/api/atlas/task-list-cards` | GET | Identity + active Elm membership | Owner gets all; other roles filtered by worker metadata | Manager behavior differs from `/task-cards`; duplicates task-card shaping | MERGE into canonical task query |
| `/api/atlas/rhythm` | GET | Session only unless route has local check not yet normalized | Reads rhythm/template-derived work | Underlying `rhythm_templates` lacks RLS; rhythm is another task authority | MERGE into canonical daily-work query |
| `/api/atlas/maintenance-plan` | GET | Session only unless route has local check not yet normalized | Derived maintenance work | Can create a second daily-work truth beside tasks | MERGE into canonical work-plan read model |
| `/api/atlas/maintenance-preview` | GET | Session only unless route has local check not yet normalized | Scheduler preview RPC/view | Preview functions currently have broad execution grants | INTERNALIZE planner; expose only authorized read result |

### 3.4 Task mutations

| Route | Methods | Current authorization | Data/system touched | Side effects | Disposition |
|---|---|---|---|---|---|
| `/api/atlas/task-transition` | POST | No identity or membership in route; origin/intent validation only | Service-role `record_task_transition_v1` RPC; task context; triggered sequences | Can update task status/date, create field logs/outcomes/children/follow-ups | Make this the canonical command only after membership, task visibility, actor, and role checks are added |
| `/api/atlas/task-outcome` | POST | Session only unless local check exists | Task outcome events and task state | Overlaps transition/result behavior | MERGE into canonical task command |
| `/api/atlas/task-result` | POST | Session only unless local check exists | Legacy task result path | Duplicate completion authority | RETIRE |
| `/api/atlas/task-unfinished` | POST | Session only unless local check exists | Task/date/result state | Duplicate transition behavior | RETIRE |
| `/api/atlas/task-reschedule` | POST | Session only unless local check exists | Task due date/status | Duplicate transition behavior | RETIRE |
| `/api/atlas/task-note` | POST | Session only unless local check exists | Task note/transition memory | Must enforce task visibility and actor attribution | MERGE into canonical task command |
| `/api/atlas/task-child-toggle` | POST | Session only unless local check exists | Child task status; parent triggers may fire | Trigger-heavy task table can create downstream changes | MERGE into canonical task command |
| `/api/atlas/task-crop` | POST | Session only unless local check exists | Task-to-crop-cycle links and crop state | Underlying join table lacks RLS | REBUILD as authorized task/crop command |

### 3.5 Field, object, and crop observations

| Route | Methods | Current authorization | Data/system touched | Risk | Disposition |
|---|---|---|---|---|---|
| `/api/atlas/field-log` | POST | None in route | Inserts `field_logs`; links `field_log_objects`; updates `object_state`; accepts client `createdBy` | Service-role multi-step write is not transactional; client can supply attribution; partial failure can leave orphaned state | REBUILD as one transactional authorized command; actor comes from session |
| `/api/atlas/germination-check` | GET, POST | None in route | `tasks`, `task_objects`, `crop_profiles`; updates tasks; creates thinning/patch/harvest tasks | Looks up by task title or ID without farm membership; hardcodes Anna assignment; causes multiple downstream task triggers | REBUILD as crop observation command tied to visible task and crop cycle |
| `/api/atlas/germination-history` | GET | Session only unless local check exists | Crop/object/task history | Historical read must be object/farm scoped | MERGE into object/crop timeline |
| `/api/atlas/inbox` | GET, POST | Session only unless local check exists | `inbox_items` | Underlying table has RLS disabled | REBUILD after inbox policy exists |
| `/api/atlas/objects/[objectKey]` | GET | Session only unless local check exists | Object workbench/timeline views | Object key alone must not establish farm access | KEEP SHELL with membership-scoped object resource |
| `/api/atlas/objects/[objectKey]/events` | GET, POST | Session only unless local check exists | `object_activity_events` and object state/cycles | Event table has RLS disabled; write functions are security definer and broadly executable | REBUILD through authorized object-event command |
| `/api/atlas/objects/[objectKey]/observations` | POST | Session only unless local check exists | Crop observations, cycles, state, events | Security-definer observation RPC currently executable outside intended server path | REBUILD through authorized crop-observation command |

### 3.6 Maintenance and production control

| Route | Methods | Current authorization | Data/system touched | Risk | Disposition |
|---|---|---|---|---|---|
| `/api/atlas/maintenance-completion` | POST | Session only unless local check exists | Maintenance object/history; task bridge | Must validate visible maintenance object and allowed outcome | REBUILD as authorized maintenance command |
| `/api/atlas/maintenance-control` | POST | Session only unless local check exists | Maintenance condition/settings/scheduler state | Manager/Owner control surface; not farm-hand general mutation | REBUILD with role permission checks |
| `/api/atlas/operational-reconcile` | POST | Session only unless local check exists | Broad reconciliation RPC across tasks/cycles/maintenance | High-impact engine command should not be a normal browser RPC | INTERNALIZE as owner/admin job |
| `/api/atlas/production-plans` | GET, POST | Session only unless local check exists | `production_plans`, `production_successions` | Both tables currently allow unrestricted anonymous/authenticated writes through permissive RLS policies | Lock down before replacement UI; REBUILD owner/manager command |
| `/api/atlas/production-rules` | GET | Session only unless local check exists | `production_rule_templates`, crop profiles | Rule registry should be read-only to normal users | KEEP read path; INTERNALIZE writes |

## 4. Application route matrix

| Route | Current purpose | Current authority problem | Replacement disposition |
|---|---|---|---|
| `/` | Role redirect | Server redirect and global browser redirect both decide destination | REBUILD as verified farm-context entry |
| `/login` | Custom Atlas login | Coupled to custom cookies and temporary credential mapping | REBUILD first |
| `/owner` | Owner task dashboard | Owner presentation sits on duplicate task feeds and broad service-role reads | KEEP purpose; REBUILD on owner read model |
| `/marshall` | Manager lens | Legacy static role page; no complete manager account path yet | REBUILD only after manager membership contract |
| `/children` | Legacy children lens | Children are not a defined farm membership role | RETIRE or model as a task audience, never an auth role |
| `/day` | Worker day overview | Legacy Anna-centric task view | KEEP purpose; REBUILD from canonical work query |
| `/overview/week` | Weekly task overview | Reads task-centric duplicate authority | MERGE into role-aware work calendar |
| `/overview/month` | Monthly task overview | Reads task-centric duplicate authority | MERGE into role-aware work calendar |
| `/task-focus/[taskId]` | Focused task work | Task ID must be checked against membership and assignment | KEEP SHELL with canonical task resource |
| `/task/[...slug]` | Legacy task detail | Catch-all compatibility and old routing rules | RETIRE after links migrate |
| `/task` | Legacy redirect | Compatibility only | RETIRE |
| `/closeout` | Day/week/month closeout | Current API has unscoped service-role reads/writes | KEEP workflow; REBUILD command/query |
| `/field` | Field command interface | Calls broad mutation routes with no unified actor/farm context | KEEP workflow; REBUILD on command layer |
| `/zones` | Zone registry | Must be membership scoped | KEEP SHELL |
| `/zones/[zoneKey]` | Zone detail | Zone key alone currently acts as locator and implied scope | KEEP SHELL with farm-qualified resource |
| `/zones/berry-walk-map` | Static specialized map | One-off route and duplicated zone presentation | MERGE into zone map component |
| `/zones/main-garden-map` | Static specialized map | One-off route and duplicated zone presentation | MERGE into zone map component |
| `/objects/[objectKey]` | Object workbench/timeline | Must be farm qualified and role scoped | KEEP SHELL; high-value replacement vertical slice candidate |
| `/collections/germination` | Germination queue | Current command hardcodes Anna and bypasses membership | KEEP workflow; derive from crop-cycle state and assignment |
| `/collections/maintenance` | Maintenance collection | Separate maintenance truth can conflict with tasks | MERGE into canonical work plan |
| `/collections/mowing` | Mowing collection | Specialized duplicate collection | MERGE into maintenance/work filters |
| `/collections/weeding` | Weeding collection | Specialized duplicate collection | MERGE into maintenance/work filters |
| `/production` | Production planning | Current write policies are unsafe | KEEP owner/manager workflow after policy replacement |
| `/production/dashboard` | Production dashboard | Whole-farm aggregate needs owner/manager scope | KEEP purpose; REBUILD read model |
| `/lineages` | Plant lineage interface | Farm membership and mutation permissions must be explicit | KEEP after identity foundation |
| `/integrity` | Data integrity inspection | Should be owner/admin only | KEEP as privileged diagnostic surface |
| `/onboarding/map` | Legacy map onboarding | Does not belong in the operational shell unless redefined | RETIRE or redesign later |

## 5. Confirmed high-risk findings

### 5.1 Cookie middleware is not an authorization boundary

The current middleware passes a request when either custom cookie exists. It does not establish a valid user, active profile, membership, role, farm, or worker identity.

### 5.2 Service role is the ordinary application data client

The global Atlas Supabase client uses `SUPABASE_SERVICE_ROLE_KEY`. Therefore RLS does not protect ordinary application routes. Each endpoint currently succeeds or fails based on its own local filtering discipline.

### 5.3 Three task feeds independently define privacy

- `home-task-cards` hardcodes Anna.
- `task-cards` treats owner and manager alike and filters farm hands.
- `task-list-cards` treats owner differently and filters other roles.

These are not presentation differences over one authorized query. They are three separate authorization interpretations.

### 5.4 Task transition validation is not identity validation

`task-transition` validates origin, an intent header, payload shape, transition vocabulary, and idempotency. It does not load the signed-in user or verify that the task belongs to a farm the user may access. The underlying server helper then invokes a security-definer RPC through service role and can launch triggered sequences.

### 5.5 Field-log and germination writes are compound, unscoped service-role commands

`field-log` can insert a field log, link zones/objects, and update object state in separate operations. `germination-check` can reschedule or complete a task and create multiple follow-up tasks. Neither route currently establishes identity or farm membership.

### 5.6 Database policy baseline is incomplete

Eight Atlas tables have RLS disabled:

- `inbox_items`
- `object_activity_events`
- `rhythm_templates`
- `project_task_links`
- `crop_cycle_impacts`
- `crop_profile_aliases`
- `crop_observation_types`
- `task_crop_cycles`

Additionally, `production_plans` and `production_successions` have unrestricted write policies for anonymous and authenticated roles. Most RLS-enabled Atlas tables have no policies. Multiple security-definer functions remain executable by anonymous or authenticated users.

## 6. Canonical replacement surface

The route inventory reduces to seven application capabilities:

1. **Session and farm context** — verified user, active profile, active farm membership, role, worker key, permissions.
2. **Farm read model** — owner/manager farm summary, zones, objects, crop cycles, production and maintenance state.
3. **Work query** — one authorized task/work resource with role-based projection, not role-based source queries.
4. **Task command** — one command endpoint for done, partial, blocked, rescheduled, note, checklist, and plan-change transitions.
5. **Field/object event command** — one transactional command for observations, work logs, crop events, state updates, and actor attribution.
6. **Planning engines** — maintenance, production, and reconciliation functions callable only through trusted server jobs or privileged commands.
7. **Reference registries** — crop profiles, rules, zone/object registries, observation vocabularies, and other bounded read-only reference data.

## 7. First replacement vertical-slice contract

The first replacement slice should be **verified session → farm context → canonical task query → one safe task transition**.

Acceptance requirements:

1. One server function resolves the current authenticated user and active farm membership.
2. The browser cannot choose a broader role, worker key, or farm scope than the membership provides.
3. The task query accepts a farm ID only after membership resolution.
4. Owner sees the full farm work set.
5. Manager sees the configured manager work set.
6. Farm hand sees only work assigned to the membership worker identity or explicitly shared farm-hand work.
7. Task detail uses the same query/authorization rule as task lists.
8. The transition command verifies that the actor can see and act on the task before invoking domain behavior.
9. Actor identity is written from the session, never from client payload.
10. The command remains idempotent and preserves existing task-trigger behavior behind an internal boundary.
11. Tests cover forged cookies, expired sessions, wrong-farm IDs, altered worker keys, owner-only tasks, manager-only tasks, and direct task-ID access.
12. Existing legacy endpoints may temporarily proxy to this slice, but may not retain independent authorization logic.

## 8. Immediate implementation order after Phase A

1. Remove the temporary password mapping and rotate the Owner credential.
2. Create the normalized server session/farm-context helper.
3. Define the table-by-role policy matrix before enabling or changing RLS.
4. Revoke direct anonymous execution from Atlas security-definer functions; explicitly re-grant only intentional public helpers.
5. Remove unrestricted production-plan write policies.
6. Build the canonical task query and task command.
7. Point Owner and farm-hand task screens at the canonical slice.
8. Retire duplicate task feed and mutation endpoints.
9. Repeat the same pattern for object events, field logs, maintenance, and production.
